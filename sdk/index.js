import { writeFile } from 'node:fs/promises';

export class RelayError extends Error {
  constructor(code, message) { super(message); this.name = 'RelayError'; this.code = code; }
}
const fail = (code, message) => new RelayError(code, message);
const integer = (value, min, max, name) => {
  if (!Number.isInteger(value) || value < min || value > max) throw fail('INVALID_ARGUMENT', `Invalid ${name}`);
  return value;
};
const coordinate = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw fail('INVALID_ARGUMENT', `Invalid ${name}`);
  return Math.round(value * 65535);
};
function encodeInput(event, generation, sequence) {
  if (!event || typeof event !== 'object') throw fail('INVALID_ARGUMENT', 'Input must be an object');
  const types = { keyDown: 1, keyUp: 2, pointerMove: 3, buttonDown: 4, buttonUp: 5, wheel: 6, releaseAll: 7 };
  if (typeof event.type !== 'string' || !Object.hasOwn(types, event.type)) throw fail('INVALID_ARGUMENT', 'Unknown input type');
  const type = types[event.type];
  const b = Buffer.alloc(36);
  b.write('NSL1'); b[4] = 1; b[5] = 3; b.writeUInt32BE(generation, 8); b.writeUInt32BE(sequence, 12); b.writeUInt32BE(16, 16); b[20] = type;
  if (type <= 2) b.writeUInt16BE(integer(event.key, 0, 231, 'key'), 22);
  if (type >= 3 && type <= 6) {
    b.writeUInt16BE(coordinate(event.x, 'x'), 28); b.writeUInt16BE(coordinate(event.y, 'y'), 30);
  }
  if (type === 4 || type === 5) b.writeUInt16BE(integer(event.button, 1, 3, 'button'), 22);
  if (type === 6) {
    if (event.axis !== 'vertical' && event.axis !== 'horizontal') throw fail('INVALID_ARGUMENT', 'Invalid wheel axis');
    const delta = integer(event.delta, -1200, 1200, 'wheel delta');
    if (delta % 120) throw fail('INVALID_ARGUMENT', 'Wheel delta must be a multiple of 120');
    b.writeUInt16BE(event.axis === 'vertical' ? 0 : 1, 22); b.writeInt32BE(delta, 24);
  }
  return b;
}
function baseUrl(url, token) {
  let parsed;
  try { parsed = new URL(url); } catch { throw fail('INVALID_ARGUMENT', 'Invalid server URL'); }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (!['http:', 'https:'].includes(parsed.protocol) || (!local && parsed.protocol !== 'https:') ||
      parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw fail('INVALID_ARGUMENT', 'Server URL must be an HTTPS origin or loopback HTTP origin');
  if ((token !== undefined && (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token))) || (!local && !token))
    throw fail('INVALID_ARGUMENT', 'Remote connections require a 64-character hexadecimal token');
  return parsed;
}
async function request(base, path, timeout, binary = false, token) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(fail('TIMEOUT', 'Request timed out')); }, timeout);
  });
  const operation = (async () => {
    try {
      const response = await fetch(new URL(path, base), { signal: controller.signal, redirect: 'error',
        headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) {
        let body;
        try { body = await response.json(); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
        throw fail(response.status === 401 ? 'UNAUTHORIZED' : body?.error === 'busy' || response.status === 429 || response.status === 409 ? 'BUSY' : 'HTTP_ERROR', `Server returned HTTP ${response.status}`);
      }
      if (!binary) {
        try { return await response.json(); }
        catch (error) { if (error instanceof SyntaxError) throw fail('PROTOCOL_ERROR', 'Invalid JSON response'); throw error; }
      }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) throw fail('PROTOCOL_ERROR', 'Snapshot exceeds 8 MiB');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (error instanceof RelayError) throw error;
      if (controller.signal.aborted) throw fail('TIMEOUT', 'Request timed out');
      throw fail('NETWORK_ERROR', `Request failed: ${error.message}`);
    }
  })();
  try { return await Promise.race([operation, deadline]); } finally { clearTimeout(timer); }
}

export async function capabilities({ url = 'http://127.0.0.1:8080', timeout = 5000, token } = {}) {
  return request(baseUrl(url, token), '/capabilities', integer(timeout, 1, 2147483647, 'timeout'), false, token);
}
export async function status({ url = 'http://127.0.0.1:8080', timeout = 5000, token } = {}) {
  return request(baseUrl(url, token), '/metrics', integer(timeout, 1, 2147483647, 'timeout'), false, token);
}
export async function snapshot({ url = 'http://127.0.0.1:8080', timeout = 5000, token } = {}, path) {
  const bytes = await request(baseUrl(url, token), '/snapshot.png', integer(timeout, 1, 2147483647, 'timeout'), true, token);
  if (path !== undefined) {
    try { await writeFile(path, bytes); } catch (error) { throw fail('IO_ERROR', `Snapshot write failed: ${error.message}`); }
  }
  return bytes;
}

export async function connect({ url = 'http://127.0.0.1:8080', timeout = 5000, token } = {}) {
  const base = baseUrl(url, token);
  integer(timeout, 1, 2147483647, 'timeout');
  const wsUrl = new URL('/control', base); wsUrl.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(wsUrl, token ? ['nsl1', `bearer.${token}`] : 'nsl1'); socket.binaryType = 'arraybuffer';
  let generation = 0, sequence = 0, closed = false, ready = false;
  const pending = new Map();
  let resolveReady, rejectReady;
  const initial = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const finish = (error) => {
    if (closed) return;
    closed = true;
    if (!ready) rejectReady(error);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
    if (socket.readyState < WebSocket.CLOSING) socket.close();
  };
  socket.addEventListener('error', () => finish(fail('NETWORK_ERROR', 'Control connection failed')));
  socket.addEventListener('close', () => finish(fail('DISCONNECTED', 'Control connection closed')));
  socket.addEventListener('message', ({ data }) => {
    try {
      if (!(data instanceof ArrayBuffer)) throw new Error('Non-binary message');
      const b = Buffer.from(data);
      if (b.length < 20 || b.toString('ascii', 0, 4) !== 'NSL1' || b[4] !== 1 || b.readUInt16BE(6) !== 0 || b.readUInt32BE(16) !== b.length - 20) throw new Error('Invalid envelope');
      const gen = b.readUInt32BE(8), seq = b.readUInt32BE(12);
      if (!ready) {
        if (b[5] !== 4 || b.length !== 24 || !gen || seq || !b.readUInt16BE(20) || !b.readUInt16BE(22)) throw new Error('Invalid ready message');
        generation = gen; ready = true; resolveReady({ width: b.readUInt16BE(20), height: b.readUInt16BE(22) }); return;
      }
      if (b[5] !== 5 || b.length !== 21 || gen !== generation || !seq || !pending.has(seq) || b[20] > 2) throw new Error('Invalid input response');
      const item = pending.get(seq); pending.delete(seq); clearTimeout(item.timer);
      if (b[20]) item.reject(fail(b[20] === 1 ? 'INVALID_ARGUMENT' : 'UNSUPPORTED', 'Input rejected by server'));
      else item.resolve();
    } catch (error) { finish(fail('PROTOCOL_ERROR', error.message)); }
  });
  const timer = setTimeout(() => finish(fail('TIMEOUT', 'Control connection timed out')), timeout);
  let surface;
  try { surface = await initial; } finally { clearTimeout(timer); }
  return {
    surface,
    async capabilities() { return request(base, '/capabilities', timeout, false, token); },
    async status() { return request(base, '/metrics', timeout, false, token); },
    async snapshot(path) {
      if (closed) throw fail('DISCONNECTED', 'Control connection closed');
      return snapshot({ url: base.href, timeout, token }, path);
    },
    input(event) {
      if (closed) return Promise.reject(fail('DISCONNECTED', 'Control connection closed'));
      if (pending.size >= 32) return Promise.reject(fail('BUSY', 'Too many pending input requests'));
      if (sequence === 0xffffffff) return Promise.reject(fail('PROTOCOL_ERROR', 'Input sequence exhausted; reconnect'));
      let message;
      try { message = encodeInput(event, generation, sequence + 1); } catch (error) { return Promise.reject(error); }
      sequence++;
      return new Promise((resolve, reject) => {
        const requestSequence = sequence;
        const timer = setTimeout(() => { pending.delete(requestSequence); reject(fail('TIMEOUT', 'Input acknowledgement timed out')); finish(fail('DISCONNECTED', 'Control connection timed out')); }, timeout);
        pending.set(requestSequence, { resolve, reject, timer });
        try { socket.send(message); } catch (error) { clearTimeout(timer); pending.delete(requestSequence); reject(fail('NETWORK_ERROR', error.message)); finish(fail('DISCONNECTED', 'Control connection failed')); }
      });
    },
    close() { finish(fail('DISCONNECTED', 'Control connection closed')); },
  };
}
