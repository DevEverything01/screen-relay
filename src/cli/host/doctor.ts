import { spawnSync, type ChildProcess } from 'node:child_process';
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { deflateSync } from 'node:zlib';
import { loadConfig } from '../config.js';
import { emit, Failure, formatDoctor } from '../output.js';
import { DEFAULT_PORT, clearedCommand, isLinux, run, spawnCleared, which } from './common.js';
import type { HostArgs } from './common.js';
import { detectFamily, installCommand, packagesFor, type Family } from './packages.js';
import { stateDir } from './state.js';
import { BACKEND_PROGRAMS, findEngine, resolveBackend, startXvfb, xQuery } from './supervisor.js';

const TINY_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function tinyPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function findLibrary(name: string): string | null {
  const prefix = `lib${name}.so`;
  const output = run(['ldconfig', '-p']).stdout ?? '';
  const match = new RegExp(`^\\s*(lib${name}\\.so[^\\s]*)`, 'm').exec(output);
  if (match) return match[1];
  for (const directory of ['/lib', '/usr/lib', '/usr/local/lib', '/usr/lib64']) {
    try {
      const library = readdirSync(directory, { withFileTypes: true }).find((entry) => entry.name.startsWith(prefix) && (entry.isFile() || entry.isSymbolicLink()));
      if (library) return library.name;
    } catch {}
  }
  return null;
}

const ICON_TOOLS: Record<string, (image: string) => string[]> = {
  'gdk-pixbuf-thumbnailer': (image) => ['-s', '16', image, `${image}.out.png`],
  'gdk-pixbuf-pixdata': (image) => [image, `${image}.out`],
};

function iconTool(): string | undefined {
  return Object.keys(ICON_TOOLS).find((program) => which(program));
}

function iconProbe(tool: string, suffix: string, data: Buffer): [boolean, string] {
  const directory = mkdtempSync(join(tmpdir(), 'relay-icon-'));
  const image = join(directory, `probe${suffix}`);
  try {
    writeFileSync(image, data);
    const command = clearedCommand([tool, ...ICON_TOOLS[tool](image)]);
    const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8', timeout: 20000 });
    return [result.status === 0, result.stderr?.trim() || (result.status === 0 ? '' : 'probe crashed or timed out')];
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function checkProgram(name: string, ok: boolean, detail: string, fix: string, level = 'fail') {
  return { name, status: ok ? 'ok' : level, detail, fix: ok ? '' : fix };
}

export async function cmdDoctor(args: HostArgs): Promise<number> {
  const checks: Array<{ name: string; status: string; detail: string; fix: string }> = [];
  const check = (name: string, ok: boolean, detail: string, fix = '', level = 'fail') => {
    checks.push(checkProgram(name, ok, detail, fix, level));
    return ok;
  };
  const linux = check('platform', isLinux(), process.platform, 'Run doctor on the Linux host; this machine can use client commands with --url.');
  if (linux) {
    const root = typeof process.getuid === 'function' && process.getuid() === 0;
    const sudo = root ? '' : 'sudo ';
    let family: Family | undefined;
    try { family = detectFamily(readFileSync('/etc/os-release', 'utf8')); } catch {}
    const packageHint = (names: string[]) => family
      ? installCommand(family, packagesFor(family, names), sudo)
      : `Install ${names.join(' ')} with your system package manager.`;
    let configuredBackend: string | undefined;
    try {
      configuredBackend = loadConfig(typeof args.config === 'string' && args.config ? args.config : undefined)[0].backend;
    } catch (error) {
      if (!(error instanceof Failure)) throw error;
      check('config', false, error.message, error.hint);
    }
    const backend = resolveBackend(process.env.RELAY_BACKEND ?? configuredBackend);
    const x11 = backend === 'x11';
    check('user', true, root ? 'root' : `uid ${process.getuid?.() ?? -1}`);
    check('node', Number(process.versions.node.split('.')[0]) >= 26, process.versions.node, './install.sh');
    check('setpriv', Boolean(which('setpriv')), which('setpriv') ?? 'not found', packageHint(['setpriv']));
    let homeWritable = true;
    try { accessSync(homedir(), constants.W_OK); } catch { homeWritable = false; }
    check('home', homeWritable, homedir(), 'export HOME=/path/to/a/writable/dir');
    const state = join(stateDir('default'), '..');
    let writable = true;
    try { mkdirSync(state, { recursive: true }); accessSync(state, constants.W_OK); } catch { writable = false; }
    check('state dir', writable, state, 'export XDG_STATE_HOME=/path/to/a/writable/dir');
    const engine = findEngine();
    const engineRuns = Boolean(engine && run([engine, '--help']).status === 0);
    check('engine', engineRuns, engine ?? 'relay-engine not found', './install.sh');
    const x264 = findLibrary('x264');
    const rpmFusionCommand = `${sudo}dnf -y install https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm`;
    const x264Hint = family === 'apt'
      ? installCommand(family, ["$(apt-cache search --names-only '^libx264-[0-9]+$' | cut -d' ' -f1)"], sudo)
      : family === 'dnf'
        ? `Enable RPM Fusion Free with ${rpmFusionCommand}, then install with ${packageHint(['x264-dev'])}`
        : packageHint(['x264-dev']);
    check('libx264', Boolean(x264), x264 ?? 'not found', x264Hint);
    for (const program of BACKEND_PROGRAMS[backend]) {
      check(program, Boolean(which(program)), which(program) ?? 'not found', packageHint([program === 'swaymsg' ? 'sway' : program]));
    }
    if (x11) {
      check('dbus-run-session', Boolean(which('dbus-run-session')), which('dbus-run-session') ?? 'not found', packageHint(['dbus-run-session']), 'warn');
      const xfcePackages = ['xfce4-session', 'xfwm4', 'xfce4-panel', 'xfdesktop'];
      check('xfce4-session', Boolean(which('xfce4-session')), which('xfce4-session') ?? 'not found (use --desktop none)', `./install.sh (or ${packageHint(xfcePackages)})`, 'warn');
      let socketUsable = false;
      try {
        const info = statSync('/tmp/.X11-unix');
        socketUsable = (info.mode & 0o1777) === 0o1777 || info.uid === process.getuid?.();
      } catch {
        try { accessSync('/tmp', constants.W_OK); socketUsable = true; } catch {}
      }
      check('/tmp/.X11-unix', socketUsable, socketUsable ? 'usable' : 'not writable for Xvfb', `${sudo}mkdir -p /tmp/.X11-unix && ${sudo}chmod 1777 /tmp/.X11-unix`);
    }
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.listen(DEFAULT_PORT, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    check('port', free, `127.0.0.1:${DEFAULT_PORT} ${free ? 'free' : 'in use'}`, `relay up --port ${DEFAULT_PORT + 1}`, 'warn');
    if (x11 && which('Xvfb') && which('xauth') && which('xdpyinfo')) {
      const scratch = mkdtempSync(join(tmpdir(), 'relay-doctor-'));
      const auth = join(scratch, 'auth');
      const children: ChildProcess[] = [];
      writeFileSync(auth, '');
      try {
        const display = await startXvfb((command, options) => {
          const child = spawnCleared(command, { ...options, detached: true });
          children.push(child);
          return child;
        }, auth);
        const output = xQuery({ ...process.env, DISPLAY: display, XAUTHORITY: auth }, 'xdpyinfo');
        const missing = ['XTEST', 'DAMAGE', 'XFIXES', 'MIT-SHM'].filter((extension) => !output.includes(extension));
        check('X extensions', !missing.length, missing.length ? `missing ${missing.join(', ')}` : 'XTEST DAMAGE XFIXES MIT-SHM', 'Use the distribution Xvfb; MIT-SHM also needs SysV shared memory (shared IPC namespace).');
      } catch (error) {
        const failure = error instanceof Failure ? error : new Failure('component_failed', String(error));
        check('X extensions', false, failure.message, failure.hint);
      } finally {
        for (const child of children) {
          if (child.pid) try { process.kill(-child.pid, 'SIGTERM'); } catch {}
          if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once('exit', resolve));
        }
        rmSync(scratch, { recursive: true, force: true });
      }
    }
    const capLine = readFileSync('/proc/self/status', 'utf8').split(/\r?\n/).find((line) => line.startsWith('CapAmb:'))?.split(/\s+/)[1] ?? '0';
    check('ambient caps', BigInt(`0x${capLine}`) === 0n, capLine === '0' ? 'none' : `${capLine}: apps that inherit them crash on icons`, 'Start apps with `relay run -- APP`, which clears them; the desktop and its menus already do.', 'warn');
    if (x11) {
      const library = findLibrary('gdk_pixbuf-2.0');
      const tool = iconTool();
      const gdkPixbufHint = family === 'apt' ? './install.sh' : packageHint(['gdk-pixbuf-bin']);
      if (!library) check('icon decoding', false, 'gdk-pixbuf not installed (desktop not installed)', gdkPixbufHint, 'warn');
      else if (!tool) check('icon decoding', false, `gdk-pixbuf tools not installed (${Object.keys(ICON_TOOLS).join(' or ')})`, gdkPixbufHint, 'warn');
      else {
        let [ok, message] = iconProbe(tool, '.png', tinyPng());
        let kind = 'PNG';
        if (ok) { [ok, message] = iconProbe(tool, '.svg', TINY_SVG); kind = 'SVG'; }
        const defaultFix = 'See the detail; read `relay logs desktop` after a failed start.';
        let aptGlycinMissing = false;
        if (!ok && family === 'apt') {
          const glycinPackage = packagesFor(family, ['glycin-loaders'])[0];
          aptGlycinMissing = run(['apt-cache', 'show', glycinPackage]).status === 0 && run(['dpkg', '-s', glycinPackage]).status !== 0;
        }
        let bubblewrapNeedsUserNamespaces = false;
        if (!ok && !aptGlycinMissing && which('bwrap')) {
          const command = clearedCommand(['bwrap', '--ro-bind', '/', '/', '--unshare-user', 'true']);
          const sandbox = spawnSync(command[0], command.slice(1), { encoding: 'utf8' });
          if (sandbox.status !== 0) {
            message += `; bubblewrap failed: ${sandbox.stderr?.trim() ?? ''}`;
            bubblewrapNeedsUserNamespaces = true;
          }
        }
        let fix: string;
        if (aptGlycinMissing) {
          fix = packageHint(['glycin-loaders']);
        } else if (bubblewrapNeedsUserNamespaces) {
          fix = 'Image loaders sandbox with bubblewrap, which needs unprivileged user namespaces: allow them for bwrap (AppArmor profile or kernel.unprivileged_userns_clone=1). relay never disables sandboxing.';
        } else if (!ok && family !== 'apt' && kind === 'SVG') {
          fix = packageHint(['glycin-loaders']);
        } else {
          fix = defaultFix;
        }
        check('icon decoding', ok, ok ? 'gdk-pixbuf decodes PNG and SVG' : `${kind}: ${message}`, fix, kind === 'SVG' ? 'warn' : 'fail');
      }
    }
  }
  const failed = checks.some((item) => item.status === 'fail');
  const summary = {
    ok: !failed,
    passed: checks.filter((item) => item.status === 'ok').length,
    warnings: checks.filter((item) => item.status === 'warn').length,
    failed: checks.filter((item) => item.status === 'fail').length,
  };
  emit(args, { checks, summary }, formatDoctor(checks, args));
  return failed ? 1 : 0;
}
