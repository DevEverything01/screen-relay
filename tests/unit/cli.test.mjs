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
  loader: { '.tsv': 'text' },
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

test('a skill name used as the skills action points at its get command', () => {
  const env = { ...process.env, RELAY_AGENT: '0', RELAY_URL: '', RELAY_TOKEN_FILE: '' };
  const human = spawnSync(process.execPath, [cli, 'skills', 'core'], { encoding: 'utf8', timeout: 15000, env });
  assert.ifError(human.error);
  assert.equal(human.status, 2);
  assert.match(human.stderr, /relay skills get core/);
  const json = spawnSync(process.execPath, [cli, 'skills', 'core', '--json'], { encoding: 'utf8', timeout: 15000, env });
  assert.ifError(json.error);
  assert.equal(json.status, 2);
  assert.deepEqual(JSON.parse(json.stderr).next, [{ command: 'relay skills get core', argv: ['relay', 'skills', 'get', 'core'] }]);
});

const help = (value, argv = ['--help']) => spawnSync(process.execPath, [cli, ...argv], {
  encoding: 'utf8',
  timeout: 15000,
  env: { ...process.env, RELAY_AGENT: value },
});

test('human help is piped plain text with the command hint', () => {
  for (const argv of [['--help'], ['click', '--help'], ['skills', '--help']]) {
    const result = help('0', argv);
    assert.ifError(result.error);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /\u001b\[/);
    assert.doesNotMatch(result.stdout, /Start here \(for AI agents\):/);
  }
  const root = help('0');
  assert.match(root.stdout, /^relay \d+\.\d+\.\d+\n\n▲ relay \[options\] <command>\n\nFor command help, run `relay <command> --help`\n\nVM commands \(run on the Linux machine that shows the desktop\):\n\n {4}up /);
  const click = help('0', ['click', '--help']);
  assert.match(click.stdout, /^click\n\n▲ relay click <x> <y> \[options\]\n\nClick at screen coordinates\nRuns on the VM, or on another machine with --url and a token file\.\n\nOptions:\n\n {4}--button <BUTTON> +Select the mouse button\. Values: left, middle, right \[default: left\]\n/);
  assert.match(click.stdout, /– Click the center\n\n {2}\$ relay click 0\.5 0\.5\n\n$/);
});

test('human help lists up under the VM section and click under the client section', () => {
  const result = help('0');
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  const vm = result.stdout.slice(result.stdout.indexOf('VM commands'), result.stdout.indexOf('Client commands'));
  assert.match(vm, /^ {4}up /m);
  assert.doesNotMatch(vm, /^ {4}click /m);
  const client = result.stdout.slice(result.stdout.indexOf('Client commands'), result.stdout.indexOf('Other commands'));
  assert.match(client, /^ {4}click /m);
  assert.doesNotMatch(client, /^ {4}up /m);
});

test('human help shows command notes before the examples', () => {
  const result = help('0', ['up', '--help']);
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\n\nNotes:\n\n {4}Without --detach, Ctrl\+C stops the session\.\n/);
  assert.ok(result.stdout.indexOf('Notes:') < result.stdout.indexOf('Examples:'));
});

test('RELAY_AGENT=1 help keeps the agent block as plain text', () => {
  const result = help('1');
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Start here \(for AI agents\):/);
  assert.doesNotMatch(result.stdout, /For command help, run/);
  assert.doesNotMatch(result.stdout, /\u001b\[/);
});

test('agent detection changes help only', () => {
  const run = (value) => spawnSync(process.execPath, [cli, 'status', '--url', 'ftp://example.com'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, RELAY_AGENT: value, RELAY_URL: '', RELAY_TOKEN_FILE: '' },
  });
  const off = run('0');
  const on = run('1');
  assert.ifError(off.error);
  assert.ifError(on.error);
  assert.equal(on.status, off.status);
  assert.equal(on.stdout, off.stdout);
  assert.equal(on.stderr, off.stderr);
});

test('piped help and errors contain no ANSI escape codes', () => {
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
