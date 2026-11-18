import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = mkdtempSync(join(root, '.cli-windows-test-'));
const home = join(directory, 'home');
mkdirSync(home, { recursive: true });
Object.assign(process.env, { XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'), XDG_CONFIG_HOME: join(home, 'config') });
after(() => rmSync(directory, { recursive: true, force: true }));

const bundle = buildSync({
  stdin: {
    contents: "export { cmdDoctor } from './src/cli/host/doctor.ts'; export { cmdInstall } from './src/cli/host/setup.ts'; export { cmdDown, cmdLogs, cmdRun, cmdUp } from './src/cli/host/session_commands.ts'; export { engineDirectory, requireHost, which } from './src/cli/host/common.ts'; export { compiledBackends, findEngine, requestedBackend, Session } from './src/cli/host/supervisor.ts'; export { alive, identity, lock, stateDir, writeSession } from './src/cli/host/state.ts'; export { killTree, windowsSessionId } from './src/cli/host/windows.ts';",
    resolveDir: root,
  },
  bundle: true,
  external: ['yaml'],
  platform: 'node',
  format: 'esm',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  write: false,
});
const bundlePath = join(directory, 'windows.mjs');
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const { alive, cmdDown, cmdInstall, cmdLogs, cmdRun, cmdUp, compiledBackends, engineDirectory, findEngine, identity, killTree, lock, requestedBackend, requireHost, Session, stateDir, which, windowsSessionId, writeSession } = await import(pathToFileURL(bundlePath).href);

function onWindowsProcess(script) {
  const probe = `Object.defineProperty(process, 'platform', { value: 'win32' });
const { cmdDoctor, cmdInstall, cmdUp } = await import(${JSON.stringify(pathToFileURL(bundlePath).href)});
${script}`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', timeout: 60000 });
}

async function onPlatform(platform, run) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}

async function withEnv(name, value, run) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function writeEngine(script) {
  mkdirSync(engineDirectory(), { recursive: true });
  const engine = join(engineDirectory(), 'relay-engine.exe');
  writeFileSync(engine, script, { mode: 0o755 });
  return engine;
}

test('Windows defaults to the windows backend', async () => {
  assert.equal(await onPlatform('win32', () => requestedBackend(undefined)), 'windows');
});

test('the x11 backend is refused on Windows and the hint names windows', async () => {
  await onPlatform('win32', () => assert.throws(() => requestedBackend('x11'), { reason: 'invalid_input', hint: /windows/ }));
});

test('the windows backend is refused on Linux', async () => {
  await onPlatform('linux', () => assert.throws(() => requestedBackend('windows'), { reason: 'invalid_input' }));
});

test('up refuses --display on Windows', async () => {
  await onPlatform('win32', () => assert.rejects(cmdUp({ command: 'up', json: false, name: 'desk', display: ':1' }), { reason: 'invalid_input' }));
});

test('Windows ignores display.resolution with a warning', () => {
  const config = join(home, 'resolution.yaml');
  writeFileSync(config, 'display:\n  resolution: 1920x1080\n');
  const result = onWindowsProcess(`await cmdUp({ command: 'up', json: false, name: 'desk', config: ${JSON.stringify(config)}, port: 0 }).catch(() => {});`);
  assert.match(result.stderr, /display\.resolution is ignored on Windows/);
});

test('findEngine finds relay-engine.exe in the engine directory on Windows', async () => {
  const engine = writeEngine('#!/bin/sh\nexit 0\n');
  assert.equal(await onPlatform('win32', () => findEngine()), engine);
});

test('compiledBackends starts a Windows engine in its own folder', { skip: process.platform === 'win32' }, async () => {
  writeEngine('#!/bin/sh\necho "Compiled backends: $(pwd)"\n');
  const backends = await onPlatform('win32', () => compiledBackends());
  assert.equal(backends.length, 1);
  assert.equal(realpathSync(backends[0]), realpathSync(engineDirectory()));
});

test('a Windows engine that exits names its log in the failure', { skip: process.platform === 'win32' }, async () => {
  writeEngine(`#!/bin/sh
if [ "$1" = --help ]; then echo 'Compiled backends: windows'; exit 0; fi
echo 'No display is attached to this session; start relay in the signed-in desktop session' >&2
exit 1
`);
  const sessionDir = join(home, 'state', 'screen-relay', 'win');
  mkdirSync(sessionDir, { recursive: true });
  const session = new Session({ command: 'up', json: true, name: 'win', port: 8080, resolution: '1280x720', fps: 60, bitrateMin: 1000000, bitrateStart: 8000000, bitrateMax: 40000000, timeout: 5 }, sessionDir);
  await onPlatform('win32', async () => {
    try {
      await assert.rejects(session.start(), { reason: 'component_failed', message: /No display is attached to this session/ });
    } finally {
      await session.cleanup();
    }
  });
});

test('doctor on Windows reports the platform, Windows version, MSYS2, engine and desktop session', () => {
  const result = onWindowsProcess(`await cmdDoctor({ command: 'doctor', json: true, name: 'default' });`);
  const names = JSON.parse(result.stdout).checks.map((check) => check.name);
  for (const name of ['platform', 'windows version', 'msys2', 'engine', 'desktop session']) {
    assert.ok(names.includes(name), `${name} missing from ${names.join(', ')}`);
  }
});

test('run refuses --restart on Windows', async () => {
  await onPlatform('win32', () => assert.rejects(cmdRun({ command: 'run', json: false, name: 'desk', app: 'notepad', args: [], restart: true }), { reason: 'invalid_input' }));
});

test('run starts an app found by name on Windows', { skip: process.platform !== 'win32' }, async () => {
  const name = 'run-windows';
  const directory = stateDir(name);
  mkdirSync(directory, { recursive: true });
  const supervisor = spawn(process.execPath, ['-e', sleeper]);
  await once(supervisor, 'spawn');
  const appDirectory = join(home, 'run-windows-app');
  mkdirSync(appDirectory, { recursive: true });
  copyFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), join(appDirectory, 'relay-probe.exe'));
  const path = process.env.PATH;
  process.env.PATH = `${appDirectory}${delimiter}${path}`;
  try {
    writeSession(directory, { name, state: 'ready', backend: 'windows', ownsDisplay: false, supervisor: identity(supervisor.pid), components: {} });
    assert.equal(await cmdRun({ command: 'run', json: true, name, app: 'relay-probe', args: [] }), 0);
    const log = join(directory, 'apps.log');
    for (let attempt = 0; attempt < 50 && !readFileSync(log, 'utf8').includes('\\'); attempt++) await delay(100);
    assert.match(readFileSync(log, 'utf8'), /\\/);
  } finally {
    process.env.PATH = path;
    supervisor.kill();
    await once(supervisor, 'exit');
  }
});

test('requireHost still refuses other platforms', async () => {
  await onPlatform('freebsd', () => assert.throws(() => requireHost(), { reason: 'unsupported_platform' }));
});

const sleeper = 'setTimeout(() => {}, 60000)';

test('a Windows process identity is alive until the process exits', { skip: process.platform !== 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', sleeper]);
  await once(child, 'spawn');
  const record = identity(child.pid);
  assert.notEqual(record.start, null);
  assert.equal(alive(record), true);
  child.kill();
  await once(child, 'exit');
  assert.equal(alive(record), false);
});

test('a Windows record with another start time is not alive', { skip: process.platform !== 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', sleeper]);
  await once(child, 'spawn');
  try {
    assert.equal(alive({ pid: child.pid, start: '0' }), false);
  } finally {
    child.kill();
    await once(child, 'exit');
  }
});

test('a Windows record with no start time is not alive', async () => {
  await onPlatform('win32', () => assert.equal(alive({ pid: process.pid, start: null }), false));
});

test('which on Windows finds the .exe of a bare name, not an extensionless script', async () => {
  const dir = join(home, 'which-windows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(dir, 'tool.exe'), '', { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${path}`;
  try {
    assert.equal(await onPlatform('win32', () => which('tool')), join(dir, 'tool.exe'));
  } finally {
    process.env.PATH = path;
  }
});

test('windowsSessionId runs PowerShell by its system path, not a same-named file on PATH', { skip: process.platform === 'win32' }, async () => {
  const dir = join(home, 'planted-powershell');
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, 'ran');
  writeFileSync(join(dir, 'powershell'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${path}`;
  try {
    await onPlatform('win32', () => windowsSessionId());
    assert.equal(existsSync(marker), false);
  } finally {
    process.env.PATH = path;
  }
});

test('windowsSessionId ignores a powershell.exe in the working directory', { skip: process.platform !== 'win32' }, () => {
  const dir = join(home, 'planted-exe');
  mkdirSync(dir, { recursive: true });
  const whoami = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe');
  copyFileSync(whoami, join(dir, 'powershell.exe'));
  copyFileSync(whoami, join(dir, 'taskkill.exe'));
  const script = `const { windowsSessionId } = await import(${JSON.stringify(pathToFileURL(bundlePath).href)});
console.log(windowsSessionId());`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.match(result.stdout.trim(), /^\d+$/);
});

test('a Windows session lock rejects a second holder until the first closes',{ skip: process.platform !== 'win32' }, async () => {
  const directory = join(home, 'lock-held');
  mkdirSync(directory, { recursive: true });
  const first = await lock('desk', directory);
  await assert.rejects(lock('desk', directory), { reason: 'already_running' });
  await first.close();
  await (await lock('desk', directory)).close();
});

test('a Windows session lock left by a dead process is reclaimed', { skip: process.platform !== 'win32' }, async () => {
  const directory = join(home, 'lock-stale');
  mkdirSync(directory, { recursive: true });
  const exited = spawn(process.execPath, ['-e', '']);
  await once(exited, 'exit');
  writeFileSync(join(directory, 'lock'), JSON.stringify({ pid: exited.pid, start: '1' }));
  await (await lock('desk', directory)).close();
});

test('killTree ends a Windows process and the child it started', { skip: process.platform !== 'win32' }, async () => {
  const script = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(sleeper)}]);
console.log(child.pid);
${sleeper};`;
  const parent = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const grandchild = { pid: 0 };
  try {
    const [line] = await once(parent.stdout, 'data');
    const record = identity(Number(String(line).trim()));
    grandchild.pid = record.pid;
    assert.equal(alive(record), true);
    killTree(parent.pid);
    for (let attempt = 0; attempt < 50 && alive(record); attempt++) await delay(100);
    assert.equal(alive(record), false);
  } finally {
    parent.kill();
    if (grandchild.pid) try { process.kill(grandchild.pid); } catch {}
  }
});

test('down leaves a Windows process alone when the session records another start time', { skip: process.platform !== 'win32' }, async () => {
  const child = spawn(process.execPath, ['-e', sleeper]);
  await once(child, 'spawn');
  try {
    const name = 'pid-reuse';
    const directory = stateDir(name);
    mkdirSync(directory, { recursive: true });
    writeSession(directory, { name, state: 'ready', supervisor: { pid: child.pid, start: '0' }, components: {} });
    const live = identity(child.pid);
    await cmdDown({ command: 'down', json: true, name });
    assert.equal(alive(live), true);
  } finally {
    child.kill();
    await once(child, 'exit');
  }
});

test('logs prints the last 200 lines of a Windows log without a PATH', { skip: process.platform !== 'win32' }, () => {
  const name = 'logs-windows';
  const directory = stateDir(name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'engine.log'), `${Array.from({ length: 250 }, (_, index) => `line ${index + 1}`).join('\n')}\n`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  env.PATH = '';
  const script = `const { cmdLogs } = await import(${JSON.stringify(pathToFileURL(bundlePath).href)});
await cmdLogs({ command: 'logs', json: false, name: ${JSON.stringify(name)}, component: 'engine', follow: false });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(result.stdout, `${Array.from({ length: 200 }, (_, index) => `line ${index + 51}`).join('\n')}\n`);
});

function withoutEngine() {
  rmSync(engineDirectory(), { recursive: true, force: true });
}

test('install on Windows without a terminal needs --yes before it installs anything', async () => {
  withoutEngine();
  await onPlatform('win32', () => assert.rejects(cmdInstall({ command: 'install', json: true, name: 'default', backend: 'windows' }), { reason: 'missing_input', hint: /--yes/ }));
});

test('install on Windows without MSYS2 or winget names MSYS2 and its download page', { skip: process.platform === 'win32' }, async () => {
  withoutEngine();
  await withEnv('LOCALAPPDATA', undefined, () => onPlatform('win32', () => assert.rejects(cmdInstall({ command: 'install', json: true, name: 'default', backend: 'windows', yes: true }), { reason: 'missing_dependency', message: /MSYS2/, hint: /https:\/\/www\.msys2\.org/ })));
});

test('install on Windows reports unchanged when the engine already has the windows backend', { skip: process.platform === 'win32' }, () => {
  writeEngine('#!/bin/sh\nif [ "$1" = --help ]; then echo \'Compiled backends: windows\'; exit 0; fi\nexit 1\n');
  const result = onWindowsProcess(`await cmdInstall({ command: 'install', json: true, name: 'default', backend: 'windows' });`);
  assert.equal(JSON.parse(result.stdout).outcome, 'unchanged');
});

test('install on Windows stops at the winget step and says to run install again', { skip: process.platform === 'win32' }, async () => {
  withoutEngine();
  const localAppData = join(home, 'local-app-data');
  mkdirSync(join(localAppData, 'Microsoft', 'WindowsApps'), { recursive: true });
  writeFileSync(join(localAppData, 'Microsoft', 'WindowsApps', 'winget.exe'), '#!/bin/sh\n[ "$1" = --version ] && exit 0\nexit 1\n', { mode: 0o755 });
  await withEnv('LOCALAPPDATA', localAppData, () => onPlatform('win32', () => assert.rejects(cmdInstall({ command: 'install', json: true, name: 'default', backend: 'windows', yes: true }), { reason: 'missing_dependency', message: /Installing MSYS2/, hint: /run `screen-relay install` again/ })));
});
