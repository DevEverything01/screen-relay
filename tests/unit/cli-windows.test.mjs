import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
    contents: "export { cmdDoctor } from './src/cli/host/doctor.ts'; export { cmdUp } from './src/cli/host/session_commands.ts'; export { engineDirectory, requireHost } from './src/cli/host/common.ts'; export { findEngine, requestedBackend, Session } from './src/cli/host/supervisor.ts';",
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
const { cmdUp, engineDirectory, findEngine, requestedBackend, requireHost, Session } = await import(pathToFileURL(bundlePath).href);

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

test('requireHost still refuses other platforms', async () => {
  await onPlatform('freebsd', () => assert.throws(() => requireHost(), { reason: 'unsupported_platform' }));
});
