import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { createClient } from '../../sdk/index.js';
import { clientFailure, cmdRemoteStatus } from '../client.js';
import { applyTo, loadConfig } from '../config.js';
import { emit, Failure, formatReady, formatStarted, formatStatus, formatStopped, printWarning } from '../output.js';
import { COMPONENTS, HostArgs, requireLinux, spawnCleared, which } from './common.js';
import { alive, lock, readSession, reap, stateDir, tail, writeSession } from './state.js';
import { connectHost, desktopEnv, Session } from './supervisor.js';
import { startWatcher } from './watcher.js';

export { COMPONENTS };

type Args = HostArgs & Record<string, any>;

export async function cmdUp(args: Args): Promise<number> {
  requireLinux();
  const [settings, , present] = loadConfig(typeof args.config === 'string' ? args.config : undefined);
  if (args.display && present.has('display.resolution')) printWarning('display.resolution is ignored with --display; the existing display size is used');
  applyTo(args, settings, present);
  const port = Number(args.port ?? 8080);
  const timeout = Number(args.timeout ?? 30);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Failure('invalid_input', 'Port must be between 1 and 65535');
  if (args.public && !/^https:\/\/[^/?#@\\\s]+$/.test(String(args.public))) {
    throw new Failure('invalid_input', '--public must be an HTTPS origin like https://desk.example.com', 'No path, query or credentials.');
  }
  if (Boolean(args['tls-cert']) !== Boolean(args['tls-key'])) throw new Failure('invalid_input', '--tls-cert and --tls-key go together');
  const directory = stateDir(args.name);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { chmodSync } = await import('node:fs');
  chmodSync(directory, 0o700);
  const readyFd = Number(process.env.RELAY_READY_FD ?? -1);
  delete process.env.RELAY_READY_FD;
  if (args.detach && readyFd < 0) return detach(args, directory, timeout);
  let pipeFd = readyFd;
  const report = (data: unknown): boolean => {
    if (pipeFd < 0) return false;
    try { writeFileSync(pipeFd, `${JSON.stringify(data)}\n`); } finally { closeSync(pipeFd); pipeFd = -1; }
    return true;
  };
  let stopping = false;
  const stop = () => { stopping = true; };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, stop);
  let held: Awaited<ReturnType<typeof lock>> | undefined;
  let session: Session | undefined;
  let final: Record<string, unknown> = { state: 'stopped' };
  try {
    try { held = await lock(args.name, directory); }
    catch (error) {
      if (error instanceof Failure) report({ error: error.payload() });
      throw error;
    }
    await reap(directory, readSession(args.name));
    session = new Session({
      ...args,
      port,
      timeout,
      resolution: String(args.resolution),
      fps: Number(args.fps),
      bitrateMin: Number(args.bitrateMin),
      bitrateStart: Number(args.bitrateStart),
      bitrateMax: Number(args.bitrateMax),
      keyboardLayout: String(args.keyboardLayout ?? 'us'),
    }, directory);
    session.save();
    const info = await session.start();
    if (!report(info)) emit(args, info, formatReady(info, args));
    await session.supervise(() => stopping);
  } catch (error) {
    if (stopping) return 0;
    const failure = error instanceof Failure ? error : new Failure('internal', `${error instanceof Error ? error.name : 'Error'}: ${String(error)}`, 'Run `relay doctor`.', { logs: directory });
    final = { state: 'failed', error: failure.payload() };
    report({ error: failure.payload() });
    throw failure;
  } finally {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.off(signal, stop);
    if (session) {
      await session.cleanup();
      session.save({ stopped: Date.now() / 1000, ...final });
    }
    await held?.close();
  }
  return 0;
}

async function detach(args: Args, directory: string, timeout: number): Promise<number> {
  const probe = await lock(args.name, directory);
  await probe.close();
  const logPath = join(directory, 'supervisor.log');
  const log = openSync(logPath, 'w', 0o600);
  const child = spawn(process.execPath, [process.argv[1] ?? '', ...process.argv.slice(2)], {
    cwd: process.cwd(), env: { ...process.env, RELAY_READY_FD: '3' }, detached: true,
    stdio: ['ignore', log, log, 'pipe'],
  });
  closeSync(log);
  const stream = child.stdio[3] as Readable;
  let data = '';
  const result = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(data), (timeout + 30) * 1000);
    stream.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    stream.once('end', () => { clearTimeout(timer); resolve(data); });
    child.once('exit', () => { clearTimeout(timer); resolve(data); });
    child.once('error', () => { clearTimeout(timer); resolve(data); });
  });
  if (!result) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      throw new Failure('timeout', 'Background supervisor did not report readiness in time', `See ${logPath}.`, { component: 'supervisor', log: tail(logPath), logs: directory });
    }
    throw new Failure('component_failed', 'Background supervisor exited before it was ready', `See ${logPath}.`, { component: 'supervisor', log: tail(logPath), logs: directory });
  }
  const payload = JSON.parse(result.trim().split(/\r?\n/).at(-1) ?? '{}');
  if (payload.error) {
    const { code, message, hint, ...extra } = payload.error;
    throw new Failure(code, message, hint ?? '', extra);
  }
  emit(args, payload, formatReady(payload, args, true));
  child.unref();
  stream.destroy();
  return 0;
}

export async function cmdDown(args: Args): Promise<number> {
  requireLinux();
  const directory = stateDir(args.name);
  let session = readSession(args.name);
  const supervisor = session?.supervisor;
  const running = alive(supervisor);
  if (running) {
    process.kill(supervisor.pid, 'SIGTERM');
    const deadline = Date.now() + 20000;
    while (alive(supervisor) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    if (alive(supervisor)) {
      process.kill(supervisor.pid, 'SIGKILL');
      while (alive(supervisor)) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (session) {
    let held: Awaited<ReturnType<typeof lock>> | undefined;
    try { held = await lock(args.name, directory); } catch {}
    if (held) {
      try {
        session = readSession(args.name) ?? {};
        if (JSON.stringify(session.supervisor) === JSON.stringify(supervisor)) {
          await reap(directory, session);
          if (['starting', 'ready'].includes(session.state)) writeSession(directory, { ...session, state: 'stopped', stopped: Date.now() / 1000 });
        }
      } finally { await held.close(); }
    }
  }
  emit(args, { name: args.name, stopped: running }, formatStopped(args.name, running));
  return 0;
}

export async function cmdStatus(args: Args): Promise<number> {
  if (args.url || process.env.RELAY_URL) return cmdRemoteStatus(args);
  const session = readSession(args.name);
  if (!session) throw new Failure('not_running', `No session named "${args.name}"`, 'Start one with `relay up -d`.');
  const running = alive(session.supervisor);
  if (['starting', 'ready'].includes(session.state) && !running) session.state = 'dead';
  delete session.components;
  session.running = running && session.state === 'ready';
  if (args['show-token'] && session.tokenFile && running) session.token = readFileSync(session.tokenFile, 'utf8').trim();
  if (session.running) {
    try {
      let token: string | null = null;
      if (session.tokenFile) token = readFileSync(session.tokenFile, 'utf8').trim();
      const timeout = Number(args.timeout ?? 10);
      session.capabilities = await createClient({
        url: session.localUrl, token: token ?? undefined, ca: session.tlsCert ?? undefined, connect: connectHost(session.bind) ?? undefined, timeout: timeout * 1000,
      }).capabilities();
    } catch (error) {
      session.health = clientFailure(error, String(session.localUrl), Number(args.timeout ?? 10)).payload();
    }
  }
  emit(args, session, formatStatus(args.name, session));
  return session.running ? 0 : 3;
}

export async function cmdLogs(args: Args): Promise<number> {
  const directory = stateDir(args.name);
  const components = args.component ? [String(args.component)] : COMPONENTS;
  const files = components.map((component) => join(directory, `${component}.log`)).filter(existsSync);
  if (!files.length) throw new Failure('not_running', `No logs for "${args.name}"`, 'Start a session with `relay up`.');
  if (args.json) {
    if (args.follow) throw new Failure('invalid_input', '--follow cannot be combined with --json');
    emit(args, Object.fromEntries(files.map((file) => [file.slice(file.lastIndexOf('/') + 1, -4), tail(file, 200)])), '');
    return 0;
  }
  const child = spawn('tail', ['-n', '200', ...(args.follow ? ['-F'] : []), ...files], { stdio: 'inherit' });
  return await new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

export async function cmdRun(args: Args): Promise<number> {
  requireLinux();
  const command = Array.isArray(args.app) ? args.app.map(String) : args.app ? [String(args.app)] : [];
  if (command[0] === '--') command.shift();
  if (!command.length) throw new Failure('invalid_option', 'Name the app to start', 'Example: relay run -- mousepad notes.txt');
  if (!which(command[0])) throw new Failure('missing_dependency', `${command[0]} not found`, `Install it first, for example: sudo apt install ${command[0]}`);
  const session = readSession(args.name);
  if (!session || session.state !== 'ready' || !alive(session.supervisor)) throw new Failure('not_found', `No running session named "${args.name}"`, 'Start one with `relay up -d`.');
  const directory = stateDir(args.name);
  const env = session.ownsDisplay === false
    ? { ...process.env, RELAY_SESSION: directory }
    : { ...desktopEnv(directory), ...(session.environment ?? {}) };
  env.DISPLAY = session.display;
  if (session.xauthority) env.XAUTHORITY = session.xauthority;
  const path = join(directory, 'apps.log');
  const log = openSync(path, 'a', 0o600);
  let pid: number;
  try {
    if (args.restart) pid = await startWatcher(command, env, log);
    else {
      const child = spawnCleared(command, { cwd: homedir(), env, stdio: ['ignore', log, log], detached: true });
      await new Promise<void>((resolve, reject) => { child.once('spawn', () => resolve()); child.once('error', reject); });
      pid = child.pid!;
      const code = await Promise.race([new Promise<number | null>((resolve) => child.once('exit', (status: number | null) => resolve(status))), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))]);
      if (code) throw new Failure('component_failed', `${command[0]} exited with code ${code}`, 'Read `relay logs apps`.', { component: 'apps', log: tail(path) });
      child.unref();
    }
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure('spawn_failed', `Cannot start ${command[0]}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    closeSync(log);
  }
  emit(args, { pid, command, display: session.display, log: path }, formatStarted(command[0], pid, session.display, path));
  return 0;
}
