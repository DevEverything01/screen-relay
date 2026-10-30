import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const entryPoint = join(root, 'src/cli/config.ts');
const directory = mkdtempSync(join(root, '.cli-config-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));
const bundle = buildSync({ entryPoints: [entryPoint], bundle: true, external: ['yaml'], platform: 'node', format: 'esm', write: false });
const bundlePath = join(directory, 'config.mjs');
writeFileSync(bundlePath, bundle.outputFiles[0].contents);
const config = await import(pathToFileURL(bundlePath).href);

function write(text) {
  const path = join(directory, 'config.yaml');
  writeFileSync(path, text);
  return path;
}

test('loads validated values and keyboard layout', () => {
  const path = write(`
display:
  resolution: 1600x900
stream:
  fps: 30
  bitrate:
    min: 500k
    start: 4M
    max: 20M
server:
  port: 9090
  bind: 0.0.0.0
  public: https://desk.example.com
  tls_cert: /tmp/fullchain.pem
  tls_key: /tmp/key.pem
keyboard:
  layout: fr,us
desktop: none
`);
  const [settings, source, present] = config.loadConfig(path);
  assert.equal(source, path);
  assert.equal(settings.display.resolution, '1600x900');
  assert.equal(settings.stream.fps, 30);
  assert.deepEqual(settings.stream.bitrate, { min: 500000, start: 4000000, max: 20000000 });
  assert.equal(settings.server.port, 9090);
  assert.equal(settings.server.bind, '0.0.0.0');
  assert.equal(settings.server.public, 'https://desk.example.com');
  assert.equal(settings.server.tls_cert, '/tmp/fullchain.pem');
  assert.equal(settings.server.tls_key, '/tmp/key.pem');
  assert.equal(settings.keyboard.layout, 'fr,us');
  assert.equal(settings.desktop, 'none');
  assert.ok(present.has('display.resolution'));
});

test('rejects unknown keys with their path and valid keys', () => {
  assert.throws(() => config.loadConfig(write('stream:\n  fsp: 30\n')), (error) => {
    assert.equal(error.reason, 'invalid_config');
    assert.match(error.message, /stream\.fsp/);
    assert.match(error.hint, /fps/);
    assert.match(error.hint, /bitrate/);
    return true;
  });
});

test('requires even resolutions within bounds', () => {
  assert.throws(() => config.loadConfig(write('display:\n  resolution: 1281x720\n')), /display\.resolution.*even/);
  assert.throws(() => config.loadConfig(write('display:\n  resolution: 2000x1080\n')), /display\.resolution.*320\.\.1920/);
});

test('validates bitrate suffixes and ordering', () => {
  let [settings] = config.loadConfig(write('stream:\n  bitrate:\n    min: 250k\n    start: 8M\n    max: 40M\n'));
  assert.deepEqual(settings.stream.bitrate, { min: 250000, start: 8000000, max: 40000000 });
  assert.throws(() => config.loadConfig(write('stream:\n  bitrate:\n    min: 10M\n    start: 1M\n    max: 40M\n')), /min <= start <= max/);
  assert.throws(() => config.loadConfig(write('stream:\n  fps: 30.0\n')), /stream\.fps.*an integer/);
});

test('rejects invalid UTF-8 as invalid input', () => {
  const path = join(directory, 'invalid.yaml');
  writeFileSync(path, Buffer.from([0x64, 0x65, 0x73, 0x6b, 0x74, 0x6f, 0x70, 0x3a, 0x20, 0xff, 0xfe, 0x0a]));
  assert.throws(() => config.loadConfig(path), (error) => {
    assert.equal(error.reason, 'invalid_config');
    assert.match(error.message, /Cannot read config file/);
    return true;
  });
});

test('flags override file values and bind comes only from the file when set', () => {
  let [settings, , present] = config.loadConfig(write('server:\n  port: 9090\n  bind: 0.0.0.0\ndesktop: none\n'));
  let args = { port: 9000, bind: undefined, public: undefined, 'tls-cert': undefined, 'tls-key': undefined, desktop: undefined };
  config.applyTo(args, settings, present);
  assert.equal(args.port, 9000);
  assert.equal(args.bind, '0.0.0.0');
  assert.equal(args.desktop, 'none');

  [settings, , present] = config.loadConfig(write('server:\n  port: 9090\n'));
  args = { port: undefined, bind: undefined, public: 'https://desk.example.com', 'tls-cert': undefined, 'tls-key': undefined, desktop: undefined };
  config.applyTo(args, settings, present);
  assert.equal(args.bind, undefined);

  [settings, , present] = config.loadConfig(write('server:\n  bind: 192.168.1.5\n'));
  args = { port: undefined, bind: '10.0.0.1', public: undefined, 'tls-cert': undefined, 'tls-key': undefined, desktop: undefined };
  config.applyTo(args, settings, present);
  assert.equal(args.bind, '10.0.0.1');
});

test('defaults keyboard layout to us and validates its allowed characters', () => {
  assert.equal(config.loadConfig()[0].keyboard.layout, 'us');
  assert.throws(() => config.loadConfig(write('keyboard:\n  layout: fr!\n')), /keyboard\.layout/);
  assert.throws(() => config.loadConfig(write('keyboard:\n  layout: 7\n')), /keyboard\.layout.*a string/);
});
