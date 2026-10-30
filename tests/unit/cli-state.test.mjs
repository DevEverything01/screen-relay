import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

test('an empty lock file remains busy rather than being reclaimed', () => {
  const lockDir = join(directory, 'lock-race');
  mkdirSync(lockDir);
  const lockFile = join(lockDir, 'lock');
  writeFileSync(lockFile, '');
  assert.throws(() => state.lock('desk', lockDir), (error) => error.reason === 'already_running');
  assert.equal(readFileSync(lockFile, 'utf8'), '');
});
