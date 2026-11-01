import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inspect, TextDecoder } from 'node:util';
import { parseDocument } from 'yaml';
import { Failure } from './output.js';

export const BACKENDS = ['x11', 'wayland'] as const;

export type ConfigSettings = {
  display: { resolution: string };
  stream: { fps: number; bitrate: { min: number; start: number; max: number } };
  server: { port: number; bind: string; public: string | null; tls_cert: string | null; tls_key: string | null };
  keyboard: { layout: string };
  desktop: string;
  backend?: string;
};

type Mapping = Record<string, unknown>;
type ConfigSection = 'display' | 'stream' | 'server' | 'keyboard';

const SECTIONS: Record<ConfigSection, readonly string[]> = {
  display: ['resolution'],
  stream: ['fps', 'bitrate'],
  server: ['port', 'bind', 'public', 'tls_cert', 'tls_key'],
  keyboard: ['layout'],
};
const ROOT_KEYS = ['display', 'stream', 'server', 'keyboard', 'desktop', 'backend'];
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
  if (path !== undefined) return [expandUser(path), true];
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
    const document = parseDocument(text, { intAsBigInt: true });
    if (document.errors.length) {
      throw new Failure('invalid_input', document.errors.map((error) => error.message).join('\n'), 'Fix the YAML syntax.');
    }
    data = document.toJS();
  } catch (error) {
    if (error instanceof Failure) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Failure('invalid_input', `Cannot parse config file ${source}: ${detail}`, 'Fix the YAML syntax.');
  }
  if (data === null) return {};
  if (!isMapping(data)) throw new Failure('invalid_input', `Config file ${source} must be a mapping at the top level`);
  return data;
}

function checkKeys(data: Mapping, allowed: readonly string[], prefix: string, errors: Failure[]): void {
  const base = prefix ? `${prefix}.` : '';
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) {
      errors.push(new Failure('invalid_input', `Unknown config key "${base}${key}"`, `Valid keys at ${prefix || 'the top level'}: ${allowed.join(', ')}.`));
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
  if (!value.trim()) wrong(path, value, 'a non-empty string');
  return value;
}

export function backendValue(value: unknown, path: string): (typeof BACKENDS)[number] {
  const text = textValue(value, path);
  const backend = BACKENDS.find((candidate) => candidate === text);
  if (!backend) wrong(path, value, BACKENDS.join(' or '));
  return backend;
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

function collect(errors: Failure[], validate: () => void): void {
  try {
    validate();
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    errors.push(error);
  }
}

function report(errors: Failure[], source: string, reason = 'invalid_config'): void {
  if (!errors.length) return;
  throw new Failure(reason, errors.map((error) => `${source}: ${error.message}.`).join(' '),
    [...new Set(errors.map((error) => error.hint).filter(Boolean))].join(' ') || 'Correct the values, then retry.',
    { errors: errors.map((error) => ({ source, ...error.payload() })) });
}

function bitrates(settings: ConfigSettings, block: unknown, errors: Failure[]): void {
  if (!isMapping(block)) wrong('stream.bitrate', block, 'a mapping with min, start and max');
  checkKeys(block, BITRATE_KEYS, 'stream.bitrate', errors);
  const previousErrors = errors.length;
  for (const key of BITRATE_KEYS) {
    if (Object.hasOwn(block, key)) collect(errors, () => {
      settings.stream.bitrate[key as keyof ConfigSettings['stream']['bitrate']] = bitrate(block[key], `stream.bitrate.${key}`);
    });
  }
  if (errors.length === previousErrors) collect(errors, () => checkBitrateOrder(settings));
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
  'server.public': (value, path) => {
    const origin = textValue(value, path);
    if (!/^https:\/\/[^/?#@\\\s]+$/.test(origin)) wrong(path, value, 'an HTTPS origin without a path, query or credentials');
    return origin;
  },
  'server.tls_cert': textValue,
  'server.tls_key': textValue,
  'keyboard.layout': (value, path) => {
    const layout = textValue(value, path);
    if (!/^[A-Za-z0-9_,-]+$/.test(layout)) {
      wrong(path, value, 'a comma-separated layout using letters, digits, "_" or "-"');
    }
    return layout;
  },
  backend: backendValue,
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
  if (source !== null) {
    if (!isFile(source)) {
      if (required) throw new Failure('invalid_config', `${source}: Config file not found.`, 'Check --config or RELAY_CONFIG.');
      loadedSource = null;
    } else {
      const errors: Failure[] = [];
      collect(errors, () => applyConfig(settings, readConfig(source), present, errors));
      report(errors, source);
    }
  }
  return [settings, loadedSource, present];
}

function applyConfig(settings: ConfigSettings, data: Mapping, present: Set<string>, errors: Failure[]): void {
  checkKeys(data, ROOT_KEYS, '', errors);
  for (const [section, allowed] of Object.entries(SECTIONS) as [ConfigSection, readonly string[]][]) {
    if (!Object.hasOwn(data, section)) continue;
    const block = data[section];
    if (!isMapping(block)) {
      collect(errors, () => wrong(section, block, 'a mapping'));
      continue;
    }
    checkKeys(block, allowed, section, errors);
    for (const key of allowed) {
      if (!Object.hasOwn(block, key)) continue;
      const path = `${section}.${key}`;
      collect(errors, () => {
        if (key === 'bitrate') bitrates(settings, block[key], errors);
        else (settings[section] as unknown as Mapping)[key] = validators[path](block[key], path);
      });
      present.add(path);
    }
  }
  if (Object.hasOwn(data, 'desktop')) {
    collect(errors, () => { settings.desktop = textValue(data.desktop, 'desktop'); });
    present.add('desktop');
  }
  if (Object.hasOwn(data, 'backend')) collect(errors, () => { settings.backend = validators.backend(data.backend, 'backend') as string; });
}

export function applyTo(args: Record<string, unknown>, settings: ConfigSettings, present: Set<string>): void {
  const fields: [string, string, string, unknown][] = [
    ['port', 'RELAY_PORT', 'server.port', settings.server.port],
    ['bind', 'RELAY_BIND', 'server.bind', present.has('server.bind') ? settings.server.bind : undefined],
    ['public', 'RELAY_PUBLIC', 'server.public', settings.server.public],
    ['tls-cert', 'RELAY_TLS_CERT', 'server.tls_cert', settings.server.tls_cert],
    ['tls-key', 'RELAY_TLS_KEY', 'server.tls_key', settings.server.tls_key],
    ['desktop', 'RELAY_DESKTOP', 'desktop', present.has('desktop') ? settings.desktop : undefined],
    ['backend', 'RELAY_BACKEND', 'backend', settings.backend],
    ['resolution', 'RELAY_RESOLUTION', 'display.resolution', settings.display.resolution],
    ['fps', 'RELAY_FPS', 'stream.fps', settings.stream.fps],
    ['bitrateMin', 'RELAY_BITRATE_MIN', 'stream.bitrate.min', settings.stream.bitrate.min],
    ['bitrateStart', 'RELAY_BITRATE_START', 'stream.bitrate.start', settings.stream.bitrate.start],
    ['bitrateMax', 'RELAY_BITRATE_MAX', 'stream.bitrate.max', settings.stream.bitrate.max],
    ['keyboardLayout', 'RELAY_KEYBOARD_LAYOUT', 'keyboard.layout', settings.keyboard.layout],
  ];
  const resolved: Mapping = {};
  const errors: Failure[] = [];
  for (const [key, environment, path, fallback] of fields) {
    const explicit = args[key] !== undefined;
    const fromEnvironment = !explicit && process.env[environment] !== undefined;
    const value = explicit ? args[key] : fromEnvironment ? process.env[environment] : fallback;
    if (!explicit && !fromEnvironment) {
      resolved[key] = value;
      continue;
    }
    collect(errors, () => {
      const label = fromEnvironment ? environment : `--${key}`;
      let input = value;
      if (path === 'server.port' || path === 'stream.fps') {
        if (typeof input === 'number' && Number.isSafeInteger(input)) input = BigInt(input);
        else if (typeof input === 'string' && /^[0-9]+$/.test(input)) input = BigInt(input);
      } else if (path.startsWith('stream.bitrate.') && typeof input === 'number' && Number.isSafeInteger(input)) input = BigInt(input);
      const validate = path.startsWith('stream.bitrate.') ? bitrate : path === 'desktop' ? textValue : validators[path];
      resolved[key] = validate(input, label);
    });
  }
  if (!errors.some((error) => /bitrate|BITRATE/.test(error.message))) collect(errors, () => {
    checkBitrateOrder({ ...settings, stream: { ...settings.stream, bitrate: {
      min: resolved.bitrateMin as number, start: resolved.bitrateStart as number, max: resolved.bitrateMax as number,
    } } });
  });
  if (Boolean(resolved['tls-cert']) !== Boolean(resolved['tls-key'])) {
    errors.push(new Failure('invalid_input', 'server.tls_cert and server.tls_key must be set together', 'Set both or neither.'));
  }
  report(errors, 'Settings', 'invalid_input');
  Object.assign(args, resolved);
}
