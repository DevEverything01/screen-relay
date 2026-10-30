import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import {
  RelayError, responseError, baseUrl, integer, encodeInput, encodeInputBatch, comboEvents, textEvents,
  batches, parseHeader, HEADER_SIZE, MESSAGE_TYPES, MAX_INPUT_BATCH, MAX_INPUT_PENDING,
  type InputEvent,
} from '../protocol/index.js';

export { RelayError, ERROR_REASONS } from '../protocol/index.js';
export type { ErrorClass, ErrorReason, ErrorOptions, NextCommand } from '../protocol/index.js';
export type { InputEvent };
export type Input = InputEvent;
export interface ClientOptions { url?: string; token?: string; timeout?: number; ca?: string; connect?: string; signal?: AbortSignal }
export type Options = ClientOptions;
export interface InputResult { events: number }
export type Status = Record<string, unknown>;
export interface Capabilities {
  version: number; backend: string; width: number; height: number; fps: number;
  input: { keyboard: boolean; pointer: boolean; buttons: boolean; wheel: boolean };
  screenshot: string; control: string; wayland: boolean; max_input_pending: number;
  input_endpoint: string; max_input_batch: number;
  cursor: boolean; audio: boolean; clipboard: boolean; resize: boolean; ime: boolean;
}
export interface Client {
  status(): Promise<Status>;
  capabilities(): Promise<Capabilities>;
  screenshot(): Promise<Uint8Array>;
  click(x: number, y: number, options?: { button?: 'left' | 'middle' | 'right' }): Promise<InputResult>;
  move(x: number, y: number): Promise<InputResult>;
  scroll(x: number, y: number, options?: { dx?: number; dy?: number }): Promise<InputResult>;
  key(...combos: string[]): Promise<InputResult>;
  type(text: string): Promise<InputResult>;
  input(events: InputEvent[]): Promise<InputResult>;
}
export interface Session {
  surface: { width: number; height: number };
  capabilities(): Promise<Capabilities>;
  status(): Promise<Status>;
  screenshot(path?: string): Promise<Uint8Array>;
  input(event: InputEvent): Promise<void>;
  close(): void;
}

function target({ url = 'http://127.0.0.1:8080', timeout = 10000, token, ca, connect, signal }: ClientOptions) {
  return { base: baseUrl(url, token), timeout: integer(timeout, 1, 2147483647, 'timeout'), token, ca, connect, signal };
}

type Server = ReturnType<typeof target>;

function headers(server: Server, body?: Uint8Array): Record<string, string> {
  const result: Record<string, string> = server.token ? { Authorization: `Bearer ${server.token}` } : {};
  if (body !== undefined) result['Content-Type'] = 'application/octet-stream';
  return result;
}

function decode<Result>(data: Buffer, binary: boolean): Result {
  if (binary) return data as Result;
  try { return JSON.parse(data.toString('utf8')) as Result; }
  catch { throw new RelayError('PROTOCOL_ERROR', 'Invalid JSON response'); }
}

function nodeRequest<Result>(server: Server, path: string, binary: boolean, body?: Uint8Array): Promise<Result> {
  const base = server.base;
  let ca: Buffer | undefined;
  if (server.ca) {
    try { ca = readFileSync(server.ca); }
    catch (error) { return Promise.reject(new RelayError('IO_ERROR', `Cannot read certificate ${server.ca}: ${error instanceof Error ? error.message : String(error)}`)); }
  }
  const hostname = server.connect ?? base.hostname.replace(/^\[|\]$/g, '');
  const requestHeaders = headers(server, body);
  if (body !== undefined) requestHeaders['Content-Length'] = String(body.length);
  if (server.connect) requestHeaders.Host = base.host;
  const options: RequestOptions = {
    protocol: base.protocol,
    hostname,
    port: Number(base.port || (base.protocol === 'https:' ? 443 : 80)),
    path: `${base.pathname === '/' ? '' : base.pathname}${path}`,
    method: body === undefined ? 'GET' : 'POST',
    headers: requestHeaders,
    timeout: server.timeout,
    signal: server.signal,
  };
  if (ca) {
    options.ca = ca;
    options.checkServerIdentity = () => undefined;
  }
  return new Promise((resolve, reject) => {
    const transport = base.protocol === 'https:' ? httpsRequest : httpRequest;
    const sent = transport(options, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) sent.destroy(new RelayError('PROTOCOL_ERROR', 'Response exceeds 8 MiB'));
        else chunks.push(chunk);
      });
      response.once('end', () => {
        const status = response.statusCode ?? 0;
        const data = Buffer.concat(chunks);
        if (status >= 400) {
          let detail: { error?: string; index?: number } | null = null;
          try { detail = JSON.parse(data.toString('utf8')); } catch {}
          reject(responseError(status, detail));
          return;
        }
        if (status >= 300) {
          reject(new RelayError('HTTP_ERROR', 'Server answered with a redirect; refusing to follow it'));
          return;
        }
        try { resolve(decode<Result>(data, binary)); } catch (error) { reject(error); }
      });
    });
    sent.once('timeout', () => sent.destroy(new RelayError('TIMEOUT', 'Request timed out')));
    sent.once('error', (error) => {
      if (server.signal?.aborted) reject(new RelayError('canceled', 'Request canceled.'));
      else if (error instanceof RelayError) reject(error);
      else reject(new RelayError('NETWORK_ERROR', `Request failed: ${error.message}`));
    });
    if (body !== undefined) sent.write(Buffer.from(body));
    sent.end();
  });
}

async function request<Result>(
  server: Server, path: string, binary = false, body?: Uint8Array,
): Promise<Result> {
  if (server.signal?.aborted) throw new RelayError('canceled', 'Request canceled.');
  if (server.ca || server.connect) return nodeRequest<Result>(server, path, binary, body);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new RelayError('TIMEOUT', 'Request timed out')); }, server.timeout);
  });
  const operation = (async () => {
    try {
      const response = await fetch(new URL(path, server.base), {
        signal: server.signal ? AbortSignal.any([controller.signal, server.signal]) : controller.signal,
        redirect: 'error', headers: headers(server, body),
        method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : Buffer.from(body),
      });
      if (!response.ok) {
        let detail: { error?: string; index?: number } | null = null;
        try { detail = await response.json(); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
        throw responseError(response.status, detail);
      }
      if (!binary) {
        try { return await response.json() as Result; }
        catch (error) { if (error instanceof SyntaxError) throw new RelayError('PROTOCOL_ERROR', 'Invalid JSON response'); throw error; }
      }
      if (!response.body) throw new RelayError('PROTOCOL_ERROR', 'Missing screenshot body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 8 * 1024 * 1024) {
            controller.abort();
            throw new RelayError('PROTOCOL_ERROR', 'Screenshot exceeds 8 MiB');
          }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      return Buffer.concat(chunks, size) as Result;
    } catch (error) {
      if (error instanceof RelayError) throw error;
      if (server.signal?.aborted) throw new RelayError('canceled', 'Request canceled.');
      if (controller.signal.aborted) throw new RelayError('TIMEOUT', 'Request timed out');
      throw new RelayError('NETWORK_ERROR', `Request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
  try { return await Promise.race([operation, deadline]); } finally { clearTimeout(timer); }
}

export async function capabilities(options: ClientOptions = {}): Promise<Capabilities> {
  return request(target(options), '/capabilities');
}

export async function status(options: ClientOptions = {}): Promise<Status> {
  return request(target(options), '/metrics');
}

export async function screenshot(options: ClientOptions = {}, path?: string): Promise<Uint8Array> {
  const bytes = await request<Uint8Array>(target(options), '/screenshot.png', true);
  if (path !== undefined) {
    try { await writeFile(path, bytes); }
    catch (error) { throw new RelayError('IO_ERROR', `Screenshot write failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return bytes;
}

export function createClient(options: ClientOptions = {}): Client {
  const server = target(options);
  const send = async (groups: InputEvent[][]): Promise<InputResult> => {
    if (!groups.length) return { events: 0 };
    const capabilities = await request<Capabilities>(server, '/capabilities');
    const limit = integer(capabilities.max_input_batch, 1, MAX_INPUT_BATCH, 'max_input_batch');
    const payloads = batches(groups, limit).map(events => ({ count: events.length, body: encodeInputBatch(events) }));
    let events = 0;
    for (const payload of payloads) {
      let result: { applied: number };
      try { result = await request<{ applied: number }>(server, '/input', false, payload.body); }
      catch (error) {
        if (error instanceof RelayError) {
          Object.assign(error, { applied: events, data: { ...error.data, applied: events } });
        }
        throw error;
      }
      if (!result || result.applied !== payload.count) throw new RelayError('PROTOCOL_ERROR', 'Invalid input result');
      events += result.applied;
    }
    return { events };
  };
  return {
    capabilities: () => request(server, '/capabilities'),
    status: () => request(server, '/metrics'),
    screenshot: () => request(server, '/screenshot.png', true),
    async click(x, y, { button = 'left' } = {}) {
      const buttons = { left: 1, middle: 2, right: 3 } as const;
      if (!Object.hasOwn(buttons, button)) throw new RelayError('INVALID_ARGUMENT', 'Invalid button');
      const code = buttons[button];
      return send([[{ type: 'buttonDown', button: code, x, y }, { type: 'buttonUp', button: code, x, y }]]);
    },
    async move(x, y) { return send([[{ type: 'pointerMove', x, y }]]); },
    async scroll(x, y, { dx = 0, dy = 0 } = {}) {
      integer(dx, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'dx');
      integer(dy, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'dy');
      if (!dx && !dy) throw new RelayError('INVALID_ARGUMENT', 'Nothing to scroll');
      integer(1 + Math.ceil(Math.abs(dx) / 10) + Math.ceil(Math.abs(dy) / 10), 1, MAX_INPUT_BATCH, 'scroll event count');
      const events: InputEvent[] = [{ type: 'pointerMove', x, y }];
      for (const [axis, notches] of [['vertical', dy], ['horizontal', dx]] as const) {
        let remaining = notches;
        while (remaining) {
          const step = Math.max(-10, Math.min(10, remaining));
          events.push({ type: 'wheel', axis, delta: step * 120, x, y });
          remaining -= step;
        }
      }
      return send([events]);
    },
    async key(...combos) {
      if (!combos.length) throw new RelayError('INVALID_ARGUMENT', 'At least one key combo is required');
      return send(combos.map(comboEvents));
    },
    async type(text) { return send(textEvents(text).map(event => [event])); },
    async input(events) {
      if (!Array.isArray(events) || !events.length) throw new RelayError('INVALID_ARGUMENT', 'Input must be a nonempty array');
      return send(events.map(event => [event]));
    },
  };
}

export async function connect(options: ClientOptions = {}): Promise<Session> {
  const server = target(options);
  if (server.signal?.aborted) throw new RelayError('canceled', 'Control connection canceled.');
  if (typeof WebSocket === 'undefined') throw new RelayError('UNSUPPORTED', 'Control sessions require Node 22 or newer');
  const wsUrl = new URL('/control', server.base);
  wsUrl.protocol = server.base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(wsUrl, server.token ? ['nsl1', `bearer.${server.token}`] : 'nsl1');
  socket.binaryType = 'arraybuffer';
  let generation = 0, sequence = 0, closed = false, ready = false;
  const pending = new Map<number, { resolve: () => void; reject: (error: RelayError) => void; timer: ReturnType<typeof setTimeout> }>();
  let resolveReady!: (surface: Session['surface']) => void;
  let rejectReady!: (error: RelayError) => void;
  const initial = new Promise<Session['surface']>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const finish = (error: RelayError) => {
    if (closed) return;
    closed = true;
    server.signal?.removeEventListener('abort', cancel);
    if (!ready) rejectReady(error);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  };
  const cancel = () => finish(new RelayError('canceled', 'Control connection canceled.'));
  server.signal?.addEventListener('abort', cancel, { once: true });
  socket.addEventListener('error', () => finish(new RelayError('NETWORK_ERROR', 'Control connection failed')));
  socket.addEventListener('close', () => finish(new RelayError('DISCONNECTED', 'Control connection closed')));
  socket.addEventListener('message', ({ data }) => {
    try {
      if (!(data instanceof ArrayBuffer)) throw new Error('Non-binary message');
      const header = parseHeader(data);
      const payload = new DataView(data, HEADER_SIZE);
      if (!ready) {
        if (header.type !== MESSAGE_TYPES.controlReady || header.payloadLength !== 4 || header.sequence || !payload.getUint16(0) || !payload.getUint16(2)) throw new Error('Invalid ready message');
        generation = header.generation;
        ready = true;
        resolveReady({ width: payload.getUint16(0), height: payload.getUint16(2) });
        return;
      }
      if (header.type !== MESSAGE_TYPES.inputResponse || header.payloadLength !== 1 || header.generation !== generation || !header.sequence || !pending.has(header.sequence) || payload.getUint8(0) > 2) throw new Error('Invalid input response');
      const item = pending.get(header.sequence)!;
      pending.delete(header.sequence);
      clearTimeout(item.timer);
      if (payload.getUint8(0)) item.reject(new RelayError(payload.getUint8(0) === 1 ? 'INVALID_ARGUMENT' : 'UNSUPPORTED', 'Input rejected by server'));
      else item.resolve();
    } catch (error) { finish(new RelayError('PROTOCOL_ERROR', error instanceof Error ? error.message : String(error))); }
  });
  const timer = setTimeout(() => finish(new RelayError('TIMEOUT', 'Control connection timed out')), server.timeout);
  let surface: Session['surface'];
  try { surface = await initial; } finally { clearTimeout(timer); }
  return {
    surface,
    capabilities: () => request(server, '/capabilities'),
    status: () => request(server, '/metrics'),
    async screenshot(path) {
      if (closed) throw new RelayError('DISCONNECTED', 'Control connection closed');
      return screenshot({ ...options, url: server.base.href, timeout: server.timeout, token: server.token }, path);
    },
    input(event) {
      if (closed) return Promise.reject(new RelayError('DISCONNECTED', 'Control connection closed'));
      if (pending.size >= MAX_INPUT_PENDING) return Promise.reject(new RelayError('BUSY', 'Too many pending input requests'));
      if (sequence === 0xffffffff) return Promise.reject(new RelayError('PROTOCOL_ERROR', 'Input sequence exhausted; reconnect'));
      let message: Uint8Array;
      try { message = encodeInput(event, generation, sequence + 1); } catch (error) { return Promise.reject(error); }
      sequence++;
      return new Promise<void>((resolve, reject) => {
        const requestSequence = sequence;
        const timer = setTimeout(() => {
          pending.delete(requestSequence);
          reject(new RelayError('TIMEOUT', 'Input acknowledgement timed out'));
          finish(new RelayError('DISCONNECTED', 'Control connection timed out'));
        }, server.timeout);
        pending.set(requestSequence, { resolve, reject, timer });
        try { socket.send(Buffer.from(message)); }
        catch (error) {
          clearTimeout(timer);
          pending.delete(requestSequence);
          reject(new RelayError('NETWORK_ERROR', error instanceof Error ? error.message : String(error)));
          finish(new RelayError('DISCONNECTED', 'Control connection failed'));
        }
      });
    },
    close() { finish(new RelayError('DISCONNECTED', 'Control connection closed')); },
  };
}
