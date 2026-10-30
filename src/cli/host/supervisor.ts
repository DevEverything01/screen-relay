import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { accessSync, closeSync, constants, fchmodSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { createClient } from '../../sdk/index.js';
import { Failure } from '../output.js';
import { HostArgs, LAUNCHER_DIR, spawnCleared, which } from './common.js';
import { identity, SessionData, tail, writeSession } from './state.js';

export const HINTS: Record<string, string> = {
  display: 'Check Xvfb and /tmp/.X11-unix with `relay doctor`.',
  dbus: 'Read `relay logs dbus` and check dbus-daemon is installed.',
  desktop: 'Run `relay doctor` (icon decoding, D-Bus) and read `relay logs desktop`.',
  engine: 'If the port is taken, pick another with --port; otherwise run `relay doctor`.',
};

export type SessionArgs = HostArgs & {
  name: string;
  port: number;
  display?: string;
  desktop?: string;
  public?: string;
  bind?: string;
  resolution: string;
  fps: number;
  bitrateMin: number;
  bitrateStart: number;
  bitrateMax: number;
  timeout?: number;
  'tls-cert'?: string;
  'tls-key'?: string;
  keyboardLayout?: string;
};

type EngineTarget = { url: string; token?: string | null; caFile?: string | null; connect?: string | null };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitSpawn(child: ChildProcess): Promise<void> {
  if (child.pid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });
}

function readLine(stream: Readable, timeout: number, check: () => void): Promise<string> {
  stream.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setInterval(() => {
      try {
        check();
        if (Date.now() > deadline) finish(reject, new Error('timeout'));
      } catch (error) {
        finish(reject, error);
      }
    }, 200);
    const deadline = Date.now() + timeout;
    const finish = (done: (value: any) => void, value: any) => {
      clearInterval(timer);
      done(value);
    };
    stream.on('data', (chunk: string) => {
      text += chunk;
      if (text.includes('\n')) finish(resolve, text.split(/\r?\n/)[0]);
      else if (text.length > 4096) finish(reject, new Error('overflow'));
    });
    stream.once('end', () => finish(reject, new Error('closed')));
    stream.once('error', (error) => finish(reject, error));
  });
}

export async function startXvfb(
  start: (command: string[], options: SpawnOptions) => ChildProcess,
  auth: string,
  resolution = '1280x720',
): Promise<string> {
  const cookie = (await import('node:crypto')).randomBytes(16).toString('hex');
  const authorize = (display: string) => {
    const result = spawnSync('xauth', ['-f', auth, 'add', display, '.', cookie], { stdio: 'ignore' });
    if (result.status !== 0) throw new Failure('component_failed', 'Cannot authorize X display', HINTS.display, { component: 'display' });
  };
  authorize(':0');
  const child = start(['Xvfb', '-displayfd', '3', '-screen', '0', `${resolution}x24`, '-nolisten', 'tcp', '-noreset', '-s', '0', '-auth', auth], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
  });
  const pipe = child.stdio[3] as Readable;
  let text: string;
  try {
    await waitSpawn(child);
    text = await readLine(pipe, 15000, () => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Failure('component_failed', `display exited with code ${child.exitCode ?? child.signalCode}`, HINTS.display, { component: 'display' });
    });
  } catch (error) {
    if (error instanceof Failure) throw error;
    if (error instanceof Error && error.message === 'timeout') throw new Failure('timeout', 'Xvfb did not report a display', HINTS.display, { component: 'display' });
    throw new Failure('component_failed', 'Xvfb did not report a display', HINTS.display, { component: 'display' });
  } finally {
    pipe.destroy();
  }
  if (!/^\d+$/.test(text.trim())) throw new Failure('component_failed', 'Xvfb did not allocate a display', HINTS.display, { component: 'display' });
  const display = `:${text.trim()}`;
  authorize(display);
  return display;
}

export function xQuery(env: NodeJS.ProcessEnv, ...command: string[]): string {
  try {
    return spawnSync(command[0], command.slice(1), { env, encoding: 'utf8', timeout: 5000 }).stdout ?? '';
  } catch {
    return '';
  }
}

export function displaySize(env: NodeJS.ProcessEnv): string | null {
  const match = /dimensions:\s+(\d+)x(\d+)/.exec(xQuery(env, 'xdpyinfo'));
  return match ? `${match[1]}x${match[2]}` : null;
}

export function connectHost(bind?: string | null): string | null {
  if (!bind || ['127.0.0.1', '0.0.0.0', '::'].includes(bind)) return null;
  return bind;
}

export class Session {
  readonly args: SessionArgs;
  readonly dir: string;
  readonly children = new Map<string, ChildProcess>();
  readonly logs: number[] = [];
  readonly errors = new Map<string, Error>();
  env: NodeJS.ProcessEnv = {};
  data: SessionData;

  constructor(args: SessionArgs, directory: string) {
    this.args = args;
    this.dir = directory;
    this.data = { name: args.name, state: 'starting', supervisor: identity(process.pid), logs: directory, port: args.port, components: {} };
  }

  save(changes: Record<string, unknown> = {}): void {
    Object.assign(this.data, changes);
    writeSession(this.dir, this.data);
  }

  spawn(name: string, command: string[], options: SpawnOptions = {}): ChildProcess {
    const log = openSync(join(this.dir, `${name}.log`), name === 'apps' ? 'a' : 'w', 0o600);
    this.logs.push(log);
    let child: ChildProcess;
    try {
      child = spawnCleared(command, {
        env: this.env,
        detached: true,
        ...options,
        stdio: ['ignore', log, log, ...((options.stdio as any[] | undefined) ?? []).slice(3)],
      });
    } catch (error) {
      closeSync(log);
      throw new Failure('component_failed', `Cannot start ${name}: ${String(error)}`, HINTS[name] ?? '', { component: name });
    }
    child.once('error', (error) => this.errors.set(name, error));
    this.children.set(name, child);
    if (child.pid) {
      this.data.components[name] = identity(child.pid);
      this.save();
    }
    return child;
  }

  failure(name: string, code: string, message: string): Failure {
    return new Failure(code, message, HINTS[name] ?? '', { component: name, log: tail(join(this.dir, `${name}.log`)), logs: this.dir });
  }

  checkChildren(): void {
    for (const [name, child] of this.children) {
      const error = this.errors.get(name);
      if (error) throw this.failure(name, 'component_failed', `Cannot start ${name}: ${error.message}`);
      if (child.exitCode !== null || child.signalCode !== null) {
        const code = child.exitCode ?? -1;
        throw this.failure(name, 'component_failed', `${name} exited with code ${code}`);
      }
    }
  }

  async startBus(): Promise<void> {
    const child = this.spawn('dbus', ['dbus-daemon', '--session', '--nofork', '--print-address=3'], {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    });
    await waitSpawn(child);
    try {
      const address = await readLine(child.stdio[3] as Readable, 5000, () => this.checkChildren());
      this.env.DBUS_SESSION_BUS_ADDRESS = address;
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw this.failure('dbus', error instanceof Error && error.message === 'timeout' ? 'timeout' : 'component_failed', 'Session bus did not report its address');
    }
  }

  async start(): Promise<Record<string, unknown>> {
    const runtime = join(this.dir, 'runtime');
    rmSync(runtime, { recursive: true, force: true });
    mkdirSync(runtime, { mode: 0o700 });
    this.env = this.args.display
      ? { ...process.env, RELAY_SESSION: this.dir }
      : desktopEnv(this.dir);
    const engine = findEngine();
    if (!engine) throw new Failure('missing_dependency', 'relay-engine not found', 'Run ./install.sh first.', { component: 'engine' });
    const desktop = this.args.desktop || (this.args.display ? 'none' : 'xfce');
    let desktopCommand = desktop === 'xfce' ? ['xfce4-session'] : desktop === 'none' ? [] : splitCommand(desktop);
    const layout = this.args.keyboardLayout ?? 'us';
    const needed = [...(this.args.display ? [] : ['Xvfb', 'xauth']), ...(desktopCommand.length ? ['xprop', 'xwininfo', desktopCommand[0]] : []), ...(!this.args.display && layout !== 'us' ? ['setxkbmap'] : [])];
    const missing = needed.filter((program) => !which(program));
    const ownBus = Boolean(desktopCommand.length && !this.args.display && which('dbus-daemon'));
    if (desktopCommand.length && !this.args.display && !ownBus && which('dbus-run-session')) desktopCommand = ['dbus-run-session', '--', ...desktopCommand];
    else if (desktop === 'xfce' && !this.args.display && !ownBus) missing.push('dbus-run-session');
    if (missing.length) throw new Failure('missing_dependency', `Missing ${missing.join(', ')}`, 'Run ./install.sh, or check with `relay doctor`.');
    let resolution: string | null;
    if (this.args.display) {
      this.env.DISPLAY = this.args.display;
      resolution = displaySize(this.env);
    } else {
      const auth = join(this.dir, 'Xauthority');
      writeFileSync(auth, '');
      const fd = openSync(auth, 'r+');
      fchmodSync(fd, 0o600);
      closeSync(fd);
      this.env.XAUTHORITY = auth;
      try {
        this.env.DISPLAY = await startXvfb((command, options) => this.spawn('display', command, options), auth, this.args.resolution);
      } catch (error) {
        const failure = error instanceof Failure ? error : this.failure('display', 'component_failed', String(error));
        throw this.failure('display', failure.code, failure.message);
      }
      if (layout !== 'us') {
        const result = spawnSync('setxkbmap', ['-layout', layout], { env: this.env, stdio: 'ignore' });
        if (result.status !== 0) throw this.failure('display', 'component_failed', `Cannot set keyboard layout ${layout}`);
      }
      resolution = this.args.resolution;
    }
    if (ownBus) await this.startBus();
    const environment: Record<string, string> = {};
    for (const key of ['DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'ICEAUTHORITY']) {
      const value = this.env[key];
      if (value) environment[key] = value;
    }
    this.save({ display: this.env.DISPLAY, xauthority: this.env.XAUTHORITY ?? null, ownsDisplay: !this.args.display, desktop, environment, resolution, fps: this.args.fps });
    if (desktopCommand.length) await waitSpawn(this.spawn('desktop', desktopCommand));
    const bind = this.args.bind || (this.args.public ? '0.0.0.0' : '127.0.0.1');
    let token: string | null = null;
    const engineCommand = [engine, '--bind', bind, '--port', String(this.args.port), '--fps', String(this.args.fps), '--bitrate-min', String(this.args.bitrateMin), '--bitrate-start', String(this.args.bitrateStart), '--bitrate-max', String(this.args.bitrateMax)];
    if (bind !== '127.0.0.1' || this.args.public) {
      token = (await import('node:crypto')).randomBytes(32).toString('hex');
      const tokenFile = join(this.dir, 'token');
      const descriptor = openSync(tokenFile, 'w', 0o600);
      fchmodSync(descriptor, 0o600);
      writeFileSync(descriptor, `${token}\n`);
      closeSync(descriptor);
      engineCommand.push('--token-file', tokenFile);
      this.data.tokenFile = tokenFile;
    }
    if (this.args.public) engineCommand.push('--public-origin', this.args.public);
    if (this.args['tls-cert']) engineCommand.push('--tls-cert', this.args['tls-cert'], '--tls-key', this.args['tls-key'] ?? '');
    else if (this.args.public) engineCommand.push('--behind-tls-proxy');
    const scheme = this.args['tls-cert'] ? 'https' : 'http';
    const localUrl = `${scheme}://127.0.0.1:${this.args.port}`;
    this.save({ bind, localUrl, url: this.args.public || localUrl, tlsCert: this.args['tls-cert'] ?? null });
    const engineChild = this.spawn('engine', engineCommand);
    await waitSpawn(engineChild);
    await this.waitReady(engineChild.pid!, { url: localUrl, token, caFile: this.data.tlsCert, connect: connectHost(bind) }, desktop);
    this.save({ state: 'ready', ready: Date.now() / 1000 });
    const url = this.data.url as string;
    return {
      ready: true, name: this.args.name, url, viewer: token ? `${url}/#token=${token}` : url,
      token, display: this.env.DISPLAY, xauthority: this.env.XAUTHORITY ?? null, logs: this.dir,
      pid: process.pid, enginePid: engineChild.pid, bind, port: this.args.port, public: Boolean(this.args.public),
    };
  }

  async engineReady(pid: number, where: EngineTarget): Promise<boolean> {
    for (const line of tail(join(this.dir, 'engine.log'), 50).split(/\r?\n/)) {
      if (!line.startsWith('{')) continue;
      try {
        const message = JSON.parse(line);
        if (message.ready === true && message.pid === pid) {
          const image = await createClient({
            url: where.url, token: where.token ?? undefined, ca: where.caFile ?? undefined, connect: where.connect ?? undefined, timeout: 3000,
          }).screenshot();
          return Buffer.from(image).subarray(0, 8).equals(PNG);
        }
      } catch {}
    }
    return false;
  }

  desktopReady(desktop: string): boolean {
    if (desktop === 'xfce') return (xQuery(this.env, 'xprop', '-root', '_NET_SUPPORTING_WM_CHECK', '_NET_CLIENT_LIST').match(/window id # 0x/g) ?? []).length >= 2;
    const match = /(\d+) child/.exec(xQuery(this.env, 'xwininfo', '-root', '-children'));
    return Boolean(match && Number(match[1]) > 0);
  }

  async waitReady(pid: number, where: EngineTarget, desktop: string): Promise<void> {
    const deadline = Date.now() + (this.args.timeout ?? 30) * 1000;
    const pending = ['engine', ...(desktop !== 'none' ? ['desktop'] : [])];
    while (pending.length) {
      this.checkChildren();
      const ready = pending[0] === 'engine' ? await this.engineReady(pid, where) : this.desktopReady(desktop);
      if (ready) pending.shift();
      else if (Date.now() > deadline) throw this.failure(pending[0], 'timeout', `${pending[0]} not ready after ${this.args.timeout ?? 30}s`);
      else await sleep(200);
    }
  }

  async supervise(shouldStop: () => boolean): Promise<void> {
    while (!shouldStop()) {
      this.checkChildren();
      await sleep(200);
    }
  }

  async cleanup(): Promise<void> {
    const engine = this.children.get('engine');
    if (engine && engine.exitCode === null) {
      engine.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => engine.once('exit', resolve)), sleep(3000)]);
    }
    const processes = [...this.children.values()].reverse();
    for (const child of processes) {
      if (!child.pid) continue;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    }
    for (const child of processes) {
      if (!child.pid) continue;
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = await Promise.race([new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))), sleep(3000).then(() => false)]);
      if (!exited && child.exitCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        await new Promise((resolve) => child.once('exit', resolve));
      }
    }
    await import('./state.js').then(({ sweep }) => sweep(this.dir));
    for (const fd of this.logs) {
      try { closeSync(fd); } catch {}
    }
  }
}

export function desktopEnv(directory: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_RUNTIME_DIR: join(directory, 'runtime'),
    XDG_CONFIG_HOME: join(directory, 'config'),
    XDG_CACHE_HOME: join(directory, 'cache'),
    ICEAUTHORITY: join(directory, 'ICEauthority'),
    RELAY_SESSION: directory,
  };
  delete env.DBUS_SESSION_BUS_ADDRESS;
  return env;
}

export function findEngine(): string | null {
  for (const candidate of [join(LAUNCHER_DIR, 'relay-engine'), join(LAUNCHER_DIR, '..', 'relay-engine')]) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return which('relay-engine') ?? null;
}

function splitCommand(value: string): string[] {
  const result: string[] = [];
  let token = '';
  let quote = '';
  let escaped = false;
  for (const char of value) {
    if (escaped) { token += char; escaped = false; }
    else if (char === '\\' && quote !== "'") escaped = true;
    else if (quote) { if (char === quote) quote = ''; else token += char; }
    else if (char === '"' || char === "'") quote = char;
    else if (/\s/.test(char)) { if (token) result.push(token); token = ''; }
    else token += char;
  }
  if (escaped) token += '\\';
  if (quote) throw new Failure('invalid_input', 'Invalid desktop command quoting');
  if (token) result.push(token);
  return result;
}
