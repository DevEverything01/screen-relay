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
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
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
  for (const [url, safe] of [
    ['https://user:abc@def@[?token=secret', 'https:'],
    ['https://user:abc def@[', 'https:'],
    ['https://user:abc@example.com/path?token=secret', 'https://example.com/path'],
  ]) {
    const result = spawnSync(process.execPath, [cli, 'status', '--url', url], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, /user|abc|def|secret/);
    assert.ok(result.stderr.includes(`Invalid server URL: ${safe}`));
  }
});

test('invalid URL recovery is a sentence in human mode and has no next command in --json', () => {
  const env = { ...process.env, RELAY_URL: '', RELAY_TOKEN_FILE: '' };
  const json = spawnSync(process.execPath, [cli, 'status', '--url', 'ftp://example.com', '--json'], { encoding: 'utf8', timeout: 15000, env });
  assert.ifError(json.error);
  assert.equal(json.status, 2);
  assert.equal(JSON.parse(json.stderr).next, undefined);
  const human = spawnSync(process.execPath, [cli, 'status', '--url', 'ftp://example.com'], { encoding: 'utf8', timeout: 15000, env });
  assert.ifError(human.error);
  assert.equal(human.status, 2);
  assert.match(human.stderr, /\n {2}Use an HTTPS origin or a local address:\n {4}Pass --url https:\/\/desktop\.example\.com or --url http:\/\/127\.0\.0\.1:8080\.\n$/);
});

test('RELAY_AGENT forces the agent block or the pointer line', () => {
  const help = (value) => spawnSync(process.execPath, [cli, '--help'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, RELAY_AGENT: value },
  });
  const agent = help('1');
  assert.ifError(agent.error);
  assert.equal(agent.status, 0);
  assert.match(agent.stdout, /Start here \(for AI agents\):/);
  assert.doesNotMatch(agent.stdout, /For AI agents: relay skills get core/);
  const human = help('0');
  assert.ifError(human.error);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /For AI agents: relay skills get core/);
  assert.doesNotMatch(human.stdout, /Start here \(for AI agents\):/);
});

test('plain output contains no ANSI escape codes', () => {
  for (const argv of [['--help'], ['click', '--help'], ['status', '--url', 'https://user:x y@[']]) {
    const result = spawnSync(process.execPath, [cli, ...argv], {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, RELAY_AGENT: '0' },
    });
    assert.ifError(result.error);
    assert.doesNotMatch(result.stdout + result.stderr, /\u001b\[/);
  }
});
