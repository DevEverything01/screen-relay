import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'relay-state-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const bundle = buildSync({ entryPoints: [join(root, 'src/cli/host/state.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const bundlePath = join(directory, 'state.mjs');
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const state = await import(pathToFileURL(bundlePath).href);
const supervisorBundle = buildSync({ entryPoints: [join(root, 'src/cli/host/supervisor.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const supervisorPath = join(directory, 'supervisor.mjs');
writeFileSync(supervisorPath, supervisorBundle.outputFiles[0].contents);
const { splitCommand } = await import(pathToFileURL(supervisorPath).href);

test('desktop command parsing preserves quoted empty arguments', () => {
  assert.deepEqual(splitCommand('my-desktop --profile "" --fullscreen'), ['my-desktop', '--profile', '', '--fullscreen']);
});

test('session sweep does not match a longer RELAY_SESSION value', { skip: !existsSync('/proc/self/environ') }, async () => {
  const session = join(directory, 'desk');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env: { ...process.env, RELAY_SESSION: `${session}2` },
    stdio: 'ignore',
  });
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await state.sweep(session);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill('SIGKILL');
  }
});

test('closing an exited lock holder resolves', { skip: spawnSync('flock', ['--version'], { stdio: 'ignore' }).status !== 0 }, async () => {
  const sessionDirectory = join(directory, 'exited-holder');
  mkdirSync(sessionDirectory);
  const held = await state.lock('exited-holder', sessionDirectory);
  await held.close();
  await held.close();
});

test('the regular lock file serializes concurrent acquisitions', { skip: spawnSync('flock', ['--version'], { stdio: 'ignore' }).status !== 0 }, async () => {
  const lockDir = join(directory, 'lock-race');
  mkdirSync(lockDir);
  const lockFile = join(lockDir, 'lock');
  writeFileSync(lockFile, '');
  const acquisitions = await Promise.allSettled([state.lock('desk', lockDir), state.lock('desk', lockDir)]);
  const acquired = acquisitions.filter((result) => result.status === 'fulfilled');
  const rejected = acquisitions.filter((result) => result.status === 'rejected');
  assert.equal(acquired.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.reason, 'already_running');
  assert.equal(readFileSync(lockFile, 'utf8'), '');
  await acquired[0].value.close();
  await (await state.lock('desk', lockDir)).close();
});
