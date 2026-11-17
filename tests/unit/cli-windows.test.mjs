import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
    contents: "export { cmdDoctor } from './src/cli/host/doctor.ts'; export { cmdDown, cmdLogs, cmdRun, cmdUp } from './src/cli/host/session_commands.ts'; export { engineDirectory, requireHost } from './src/cli/host/common.ts'; export { findEngine, requestedBackend, Session } from './src/cli/host/supervisor.ts'; export { alive, identity, lock, stateDir, writeSession } from './src/cli/host/state.ts'; export { killTree } from './src/cli/host/windows.ts';",
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
const { alive, cmdDown, cmdLogs, cmdRun, cmdUp, engineDirectory, findEngine, identity, killTree, lock, requestedBackend, requireHost, Session, stateDir, writeSession } = await import(pathToFileURL(bundlePath).href);

function onWindowsProcess(script) {
  const probe = `Object.defineProperty(process, 'platform', { value: 'win32' });
const { cmdDoctor, cmdUp } = await import(${JSON.stringify(pathToFileURL(bundlePath).href)});
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

test('a Windows session lock rejects a second holder until the first closes', { skip: process.platform !== 'win32' }, async () => {
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
