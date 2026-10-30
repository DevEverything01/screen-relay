import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';

const cli = fileURLToPath(new URL('../../dist/cli/relay.mjs', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = mkdtempSync(join(root, '.cli-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const bundle = buildSync({
  stdin: {
    contents: "export { commands } from './src/cli/commands.ts'; export { parseCommand } from './src/cli/parser.ts';",
    resolveDir: root,
  },
  bundle: true,
  external: ['yaml'],
  platform: 'node',
  format: 'esm',
  write: false,
});
const bundlePath = join(directory, 'parser.mjs');
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const { commands, parseCommand } = await import(pathToFileURL(bundlePath).href);

test('every metadata example parses through the command parser', () => {
  for (const [name, command] of Object.entries(commands)) {
    assert.ok(command.examples.length > 0, name);
    for (const example of command.examples) {
      const argv = [...example.command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
        .map(match => match[1] ?? match[2] ?? match[3]);
      assert.equal(argv.shift(), 'relay', example.command);
      assert.equal(parseCommand(argv, {}).command, name, example.command);
    }
  }
});

test('an empty RELAY_CONFIG is treated as unset', () => {
  assert.equal(parseCommand(['up'], { RELAY_CONFIG: '' }).config, undefined);
});

test('--json failures write one JSON line to stderr and nothing to stdout', () => {
  for (const [argv, exit] of [
    [['frob'], 2],
    [['click', '2', '0.5'], 2],
    [['status', '--url', 'http://127.0.0.1:1'], 1],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...argv, '--json'], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, RELAY_URL: '', RELAY_TOKEN_FILE: '' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, exit, `${argv.join(' ')}: ${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^[^\r\n]+\n$/);
    const error = JSON.parse(result.stderr);
    assert.ok(['error', 'action_required'].includes(error.status));
    assert.match(error.reason, /^[a-z][a-z0-9_]*$/);
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0);
  }
});

test('invalid URL diagnostics redact credentials and query strings', () => {
  const result = spawnSync(process.execPath, [cli, 'status', '--url', 'https://user:abc@def@[?token=secret'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stderr, /user|abc|def|secret/);
  assert.match(result.stderr, /\[redacted\]/);
});
