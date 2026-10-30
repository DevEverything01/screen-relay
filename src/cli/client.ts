import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, RelayError, type Client } from '../sdk/index.js';
import { MAX_INPUT_BATCH, isLoopback, validToken } from '../protocol/index.js';
import { DEFAULT_PORT } from './host/common.js';
import { connectHost } from './host/supervisor.js';
import { readSession } from './host/state.js';
import { emit, Failure } from './output.js';

type Args = Record<string, any> & { command: string; json: boolean; name: string };

interface Target { url: string; token?: string; ca?: string; connect?: string; timeout: number }

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CLIENT_CODES: Record<string, string> = {
  INVALID_ARGUMENT: 'invalid_input', UNAUTHORIZED: 'unauthorized', BUSY: 'busy', UNSUPPORTED: 'invalid_input', IO_ERROR: 'invalid_input',
};

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidUrl(url: string): Failure {
  return new Failure('invalid_input', `Invalid server URL: ${url}`, 'Use an HTTPS origin or http://127.0.0.1:PORT.');
}

function checkUrl(url: string, token?: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw invalidUrl(url); }
  const local = isLoopback(parsed.hostname);
  if (!['http:', 'https:'].includes(parsed.protocol) || (!local && parsed.protocol !== 'https:') ||
      parsed.username || parsed.password || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) {
    throw invalidUrl(url);
  }
  if ((token !== undefined && !validToken(token)) || (!local && !token)) {
    throw new Failure('invalid_input', 'Remote servers need a 64-character lowercase hex token', 'Pass --token-file FILE or set RELAY_TOKEN_FILE.');
  }
  return url.replace(/\/$/, '');
}

/** Resolves the engine a client command talks to from flags, the environment, or the local session. */
export function resolveTarget(args: Args): Target {
  let url = typeof args.url === 'string' ? args.url : process.env.RELAY_URL;
  let tokenFile = typeof args['token-file'] === 'string' ? args['token-file'] : process.env.RELAY_TOKEN_FILE;
  let ca: string | undefined, connect: string | undefined;
  if (!url) {
    const session = readSession(String(args.name));
    if (session?.state === 'ready') {
      url = session.localUrl;
      ca = session.tlsCert ?? undefined;
      connect = connectHost(session.bind) ?? undefined;
      tokenFile = tokenFile || session.tokenFile;
    } else {
      url = `http://127.0.0.1:${DEFAULT_PORT}`;
    }
  }
  let token: string | undefined;
  if (tokenFile) {
    try { token = readFileSync(tokenFile, 'utf8').trim(); }
    catch (error) { throw new Failure('invalid_input', `Cannot read token file: ${detail(error)}`, 'Check --token-file.'); }
  }
  return { url: checkUrl(String(url), token), token, ca, connect, timeout: Number(args.timeout ?? 10) };
}

/** Turns an SDK error into the CLI failure shape the documented commands and exit codes use. */
export function clientFailure(error: unknown, url: string, timeout: number): Failure {
  if (error instanceof Failure) return error;
  if (error instanceof RelayError) {
    if (error.code === 'TIMEOUT') return new Failure('timeout', `No reply from ${url} within ${timeout}s`, 'Raise --timeout or check the engine.');
    if (error.code === 'NETWORK_ERROR') return new Failure('unreachable', `Cannot reach ${url}: ${error.message}`, 'Start a session with `relay up` or pass --url.');
    const applied = (error as RelayError & { applied?: number }).applied;
    return new Failure(CLIENT_CODES[error.code] ?? 'internal', error.message, error.hint ?? '', applied === undefined ? {} : { applied });
  }
  return new Failure('internal', detail(error));
}

function open(target: Target): Client {
  return createClient({ url: target.url, token: target.token, ca: target.ca, connect: target.connect, timeout: target.timeout * 1000 });
}

async function withClient<Result>(args: Args, action: (client: Client) => Promise<Result>): Promise<Result> {
  const target = resolveTarget(args);
  try { return await action(open(target)); }
  catch (error) { throw clientFailure(error, target.url, target.timeout); }
}

function textArgument(args: Args, value: unknown): string {
  if (Boolean(args.stdin) === (value !== undefined)) throw new Failure('invalid_input', 'Give the argument or --stdin, not both or neither');
  return args.stdin ? readFileSync(0, 'utf8') : String(value);
}

function number(value: string): string {
  return String(Number(value));
}

function finish(args: Args, events: number, what: string): number {
  emit(args, { applied: events }, `${what} (${events} events)`);
  return 0;
}

export async function cmdScreenshot(args: Args): Promise<number> {
  const data = await withClient(args, (client) => client.screenshot());
  if (data.length < 24 || !Buffer.from(data).subarray(0, 8).equals(PNG)) throw new Failure('internal', 'Engine did not return a PNG');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (args.file === '-') {
    process.stdout.write(data);
    return 0;
  }
  try { writeFileSync(String(args.file), data); }
  catch (error) { throw new Failure('invalid_input', `Cannot write ${args.file}: ${detail(error)}`); }
  emit(args, { path: resolve(String(args.file)), bytes: data.length, width, height }, `Saved ${args.file} (${width}x${height}, ${data.length} bytes)`);
  return 0;
}

export async function cmdClick(args: Args): Promise<number> {
  const button = String(args.button) as 'left' | 'middle' | 'right';
  const events = await withClient(args, (client) => client.click(Number(args.x), Number(args.y), { button }));
  return finish(args, events.events, `Clicked ${button} at ${number(args.x)},${number(args.y)}`);
}

export async function cmdMove(args: Args): Promise<number> {
  const events = await withClient(args, (client) => client.move(Number(args.x), Number(args.y)));
  return finish(args, events.events, `Moved to ${number(args.x)},${number(args.y)}`);
}

export async function cmdScroll(args: Args): Promise<number> {
  const dx = Number(args.dx ?? 0), dy = Number(args.dy ?? 0);
  if (!dx && !dy) throw new Failure('invalid_input', 'Nothing to scroll', 'Pass --dy N (positive scrolls down) and/or --dx N.');
  const events = await withClient(args, (client) => client.scroll(Number(args.x), Number(args.y), { dx, dy }));
  return finish(args, events.events, `Scrolled dx=${dx} dy=${dy}`);
}

export async function cmdKey(args: Args): Promise<number> {
  const combos = (Array.isArray(args.combos) ? args.combos : [args.combos]).map(String);
  const events = await withClient(args, (client) => client.key(...combos));
  return finish(args, events.events, `Pressed ${combos.join(' ')}`);
}

export async function cmdType(args: Args): Promise<number> {
  const text = textArgument(args, args.text);
  const events = await withClient(args, (client) => client.type(text));
  return finish(args, events.events, `Typed ${Array.from(text).length} characters`);
}

export async function cmdInput(args: Args): Promise<number> {
  let events: unknown;
  try { events = JSON.parse(textArgument(args, args.events)); }
  catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure('invalid_input', `Invalid JSON: ${detail(error)}`, 'Pass a JSON array of SDK input events.');
  }
  if (!Array.isArray(events) || !events.length || events.length > MAX_INPUT_BATCH) {
    throw new Failure('invalid_input', `Input must be a JSON array of 1 to ${MAX_INPUT_BATCH} events`,
      'Example: [{"type":"keyDown","key":4},{"type":"keyUp","key":4}]');
  }
  const result = await withClient(args, (client) => client.input(events as never));
  return finish(args, result.events, 'Sent input');
}

export async function cmdRemoteStatus(args: Args): Promise<number> {
  const target = resolveTarget(args);
  const client = open(target);
  let capabilities: Awaited<ReturnType<Client['capabilities']>>, metrics: Awaited<ReturnType<Client['status']>>;
  try {
    capabilities = await client.capabilities();
    metrics = await client.status();
  } catch (error) { throw clientFailure(error, target.url, target.timeout); }
  emit(args, { url: target.url, capabilities, metrics },
    `${target.url}: up (${capabilities.backend} ${capabilities.width}x${capabilities.height}, ${metrics.frames_encoded} frames encoded)`);
  return 0;
}
