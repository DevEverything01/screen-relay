import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inspect, TextDecoder } from 'node:util';
import { parse } from 'yaml';
import { Failure } from './output.js';

export type ConfigSettings = {
  display: { resolution: string };
  stream: { fps: number; bitrate: { min: number; start: number; max: number } };
  server: { port: number; bind: string; public: string | null; tls_cert: string | null; tls_key: string | null };
  keyboard: { layout: string };
  desktop: string;
};

type Mapping = Record<string, unknown>;
type ConfigSection = 'display' | 'stream' | 'server' | 'keyboard';

const SECTIONS: Record<ConfigSection, readonly string[]> = {
  display: ['resolution'],
  stream: ['fps', 'bitrate'],
  server: ['port', 'bind', 'public', 'tls_cert', 'tls_key'],
  keyboard: ['layout'],
};
const ROOT_KEYS = ['display', 'stream', 'server', 'keyboard', 'desktop'];
const BITRATE_KEYS = ['min', 'start', 'max'];
const RESOLUTION = /^([0-9]+)x([0-9]+)$/;
const BITRATE = /^([0-9]+)([kM]?)$/;

function expandUser(path: string): string {
  if (path === '~') return homedir();
  return path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function locate(path?: string): [string | null, boolean] {
  if (path) return [expandUser(path), true];
  const environment = process.env.RELAY_CONFIG;
  if (environment) return [expandUser(environment), true];
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const defaultPath = join(configHome, 'relay', 'config.yaml');
  return [isFile(defaultPath) ? defaultPath : null, false];
}

function isMapping(value: unknown): value is Mapping {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Date) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function valueRepr(value: unknown): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string') return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n').replaceAll('\r', '\\r')}'`;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'object') return inspect(value, { depth: 3, colors: false });
  return String(value);
}

function readConfig(source: string): Mapping {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(source));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Failure('invalid_input', `Cannot read config file ${source}: ${detail}`, 'Check --config or RELAY_CONFIG.');
  }
  let data: unknown;
  try {
    data = parse(text, { intAsBigInt: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Failure('invalid_input', `Cannot parse config file ${source}: ${detail}`, 'Fix the YAML syntax.');
  }
  if (data === null) return {};
  if (!isMapping(data)) throw new Failure('invalid_input', `Config file ${source} must be a mapping at the top level`);
  return data;
}

function checkKeys(data: Mapping, allowed: readonly string[], prefix: string): void {
  const base = prefix ? `${prefix}.` : '';
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) {
      throw new Failure('invalid_input', `Unknown config key "${base}${key}"`, `Valid keys at ${prefix || 'the top level'}: ${allowed.join(', ')}.`);
    }
  }
}

function wrong(path: string, value: unknown, expected: string): never {
  throw new Failure('invalid_input', `Invalid config value for ${path}: ${valueRepr(value)}; expected ${expected}`);
}

function outOfRange(path: string, value: unknown, low: number, high: number): never {
  throw new Failure('invalid_input', `Invalid config value for ${path}: ${valueRepr(value)}; allowed ${low}..${high}`, `Set ${path} between ${low} and ${high}.`);
}

function integer(value: unknown, path: string, low: number, high: number): number {
  if (typeof value !== 'bigint') wrong(path, value, 'an integer');
  if (value < BigInt(low) || value > BigInt(high)) outOfRange(path, value, low, high);
  return Number(value);
}

function textValue(value: unknown, path: string): string {
  if (typeof value !== 'string') wrong(path, value, 'a string');
  return value;
}

function resolution(value: unknown, path: string): string {
  if (typeof value !== 'string') wrong(path, value, 'WIDTHxHEIGHT such as 1280x720');
  const match = RESOLUTION.exec(value.trim());
  if (!match) wrong(path, value, 'WIDTHxHEIGHT such as 1280x720');
  const width = BigInt(match[1]);
  const height = BigInt(match[2]);
  if (width % 2n || height % 2n) {
    throw new Failure('invalid_input', `Invalid config value for ${path}: ${valueRepr(value)}; width and height must be even`);
  }
  if (width < 320n || width > 1920n || height < 240n || height > 1080n) {
    throw new Failure('invalid_input', `Invalid config value for ${path}: ${valueRepr(value)}; allowed width 320..1920, height 240..1080`);
  }
  return `${width}x${height}`;
}

function bitrate(value: unknown, path: string): number {
  let amount: bigint;
  if (typeof value === 'bigint') amount = value;
  else if (typeof value === 'string') {
    const match = BITRATE.exec(value.trim());
    if (!match) wrong(path, value, 'an integer in bits per second, or one with a k or M suffix such as 8M');
    amount = BigInt(match[1]) * BigInt(match[2] === 'k' ? 1000 : match[2] === 'M' ? 1000000 : 1);
  } else wrong(path, value, 'an integer in bits per second, or one with a k or M suffix');
  if (amount < 250000n || amount > 100000000n) outOfRange(path, value, 250000, 100000000);
  return Number(amount);
}

function bitrates(settings: ConfigSettings, block: unknown): void {
  if (!isMapping(block)) wrong('stream.bitrate', block, 'a mapping with min, start and max');
  checkKeys(block, BITRATE_KEYS, 'stream.bitrate');
  for (const key of BITRATE_KEYS) {
    if (Object.hasOwn(block, key)) settings.stream.bitrate[key as keyof ConfigSettings['stream']['bitrate']] = bitrate(block[key], `stream.bitrate.${key}`);
  }
}

function checkBitrateOrder(settings: ConfigSettings): void {
  const { min, start, max } = settings.stream.bitrate;
  if (min > start || start > max) {
    throw new Failure('invalid_input', `Invalid config value for stream.bitrate: min ${min}, start ${start}, max ${max}; require min <= start <= max`, 'Set stream.bitrate.min, stream.bitrate.start and stream.bitrate.max in that order.');
  }
}

const validators: Record<string, (value: unknown, path: string) => unknown> = {
  'display.resolution': resolution,
  'stream.fps': (value, path) => integer(value, path, 10, 60),
  'server.port': (value, path) => integer(value, path, 1, 65535),
  'server.bind': textValue,
  'server.public': textValue,
  'server.tls_cert': textValue,
  'server.tls_key': textValue,
  'keyboard.layout': (value, path) => {
    const layout = textValue(value, path);
    if (!/^[A-Za-z0-9_,-]+$/.test(layout)) {
      wrong(path, value, 'a comma-separated layout using letters, digits, "_" or "-"');
    }
    return layout;
  },
};

export function loadConfig(path?: string): [ConfigSettings, string | null, Set<string>] {
  const [source, required] = locate(path);
  let loadedSource = source;
  const settings: ConfigSettings = {
    display: { resolution: '1280x720' },
    stream: { fps: 60, bitrate: { min: 1000000, start: 8000000, max: 40000000 } },
    server: { port: 8080, bind: '127.0.0.1', public: null, tls_cert: null, tls_key: null },
    keyboard: { layout: 'us' },
    desktop: 'xfce',
  };
  const present = new Set<string>();
  if (source) {
    if (!isFile(source)) {
      if (required) throw new Failure('invalid_input', `Config file not found: ${source}`, 'Check --config or RELAY_CONFIG.');
      loadedSource = null;
    } else {
      applyConfig(settings, readConfig(source), present);
    }
  }
  return [settings, loadedSource, present];
}

function applyConfig(settings: ConfigSettings, data: Mapping, present: Set<string>): void {
  checkKeys(data, ROOT_KEYS, '');
  for (const [section, allowed] of Object.entries(SECTIONS) as [ConfigSection, readonly string[]][]) {
    if (!Object.hasOwn(data, section)) continue;
    const block = data[section];
    if (!isMapping(block)) wrong(section, block, 'a mapping');
    checkKeys(block, allowed, section);
    for (const key of allowed) {
      if (!Object.hasOwn(block, key)) continue;
      const path = `${section}.${key}`;
      if (key === 'bitrate') bitrates(settings, block[key]);
      else (settings[section] as unknown as Mapping)[key] = validators[path](block[key], path);
      present.add(path);
    }
  }
  if (Object.hasOwn(data, 'desktop')) {
    settings.desktop = textValue(data.desktop, 'desktop');
    present.add('desktop');
  }
  checkBitrateOrder(settings);
}

export function applyTo(args: Record<string, unknown>, settings: ConfigSettings, present: Set<string>): void {
  if (args.port == null) args.port = settings.server.port;
  if (args.bind == null && present.has('server.bind')) args.bind = settings.server.bind;
  if (args.public == null) args.public = settings.server.public;
  if (args['tls-cert'] == null) args['tls-cert'] = settings.server.tls_cert;
  if (args['tls-key'] == null) args['tls-key'] = settings.server.tls_key;
  if (args.desktop == null && present.has('desktop')) args.desktop = settings.desktop;
  args.resolution = settings.display.resolution;
  args.fps = settings.stream.fps;
  args.bitrateMin = settings.stream.bitrate.min;
  args.bitrateStart = settings.stream.bitrate.start;
  args.bitrateMax = settings.stream.bitrate.max;
  args.keyboardLayout = settings.keyboard.layout;
}
