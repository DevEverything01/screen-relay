import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilities, connect } from './index.js';

function packet(type, generation, sequence, payload) {
  const b = Buffer.alloc(20 + payload.length);
  b.write('NSL1'); b[4] = 1; b[5] = type;
  b.writeUInt32BE(generation, 8); b.writeUInt32BE(sequence, 12); b.writeUInt32BE(payload.length, 16); payload.copy(b, 20);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
class FakeSocket extends EventTarget {
  static CLOSING = 2;
  constructor(url, protocol) {
    super(); assert.equal(url.pathname, '/control'); assert.equal(protocol, 'nsl1');
    this.readyState = 1;
    FakeSocket.current = this;
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: packet(4, 7, 0, Buffer.from([5, 0, 2, 208])) })));
  }
  send(data) { this.sent = Buffer.from(data); }
  reply(sequence, status = 0) { this.dispatchEvent(new MessageEvent('message', { data: packet(5, 7, sequence, Buffer.from([status])) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

test('control input uses the protocol and awaits its matching acknowledgement', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = FakeSocket;
  try {
    const session = await connect();
    assert.deepEqual(session.surface, { width: 1280, height: 720 });
    const pending = session.input({ type: 'buttonDown', button: 1, x: 0.5, y: 1 });
    const b = FakeSocket.current.sent;
    assert.equal(b.readUInt32BE(8), 7); assert.equal(b.readUInt32BE(12), 1);
    assert.equal(b[20], 4); assert.equal(b.readUInt16BE(22), 1);
    assert.equal(b.readUInt16BE(28), 32768); assert.equal(b.readUInt16BE(30), 65535);
    FakeSocket.current.reply(1); await pending;
    const rejected = session.input({ type: 'keyDown', key: 4 });
    FakeSocket.current.reply(2, 2);
    await assert.rejects(rejected, { code: 'UNSUPPORTED' });
    await assert.rejects(session.input({ type: 'pointerMove', x: NaN, y: 0 }), { code: 'INVALID_ARGUMENT' });
    for (const type of ['__proto__', 'toString', null]) await assert.rejects(session.input({ type }), { code: 'INVALID_ARGUMENT' });
    session.close();
    await assert.rejects(session.input({ type: 'releaseAll' }), { code: 'DISCONNECTED' });
  } finally { globalThis.WebSocket = original; }
});

test('input timeout closes the session and rejects other pending input', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = FakeSocket;
  try {
    const session = await connect({ timeout: 30 });
    const first = session.input({ type: 'releaseAll' });
    const second = session.input({ type: 'releaseAll' });
    const results = await Promise.allSettled([first, second]);
    assert.equal(results[0].reason.code, 'TIMEOUT');
    assert.equal(results[1].reason.code, 'DISCONNECTED');
    assert.equal(FakeSocket.current.readyState, 3);
  } finally { globalThis.WebSocket = original; }
});

test('malformed response closes session and rejects pending input', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = FakeSocket;
  try {
    const session = await connect();
    const pending = session.input({ type: 'releaseAll' });
    FakeSocket.current.dispatchEvent(new MessageEvent('message', { data: packet(5, 99, 1, Buffer.from([0])) }));
    await assert.rejects(pending, { code: 'PROTOCOL_ERROR' });
    assert.equal(FakeSocket.current.readyState, 3);
  } finally { globalThis.WebSocket = original; }
});

test('control bounds outstanding input and rejects it when closed', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = FakeSocket;
  try {
    const session = await connect();
    const pending = Array.from({ length: 32 }, () => session.input({ type: 'releaseAll' }));
    const results = Promise.allSettled(pending);
    await assert.rejects(session.input({ type: 'releaseAll' }), { code: 'BUSY' });
    session.close();
    assert.ok((await results).every(result => result.reason.code === 'DISCONNECTED'));
  } finally { globalThis.WebSocket = original; }
});

test('disconnect rejects in-flight input', async () => {
  const original = globalThis.WebSocket; globalThis.WebSocket = FakeSocket;
  try {
    const session = await connect();
    const pending = session.input({ type: 'releaseAll' });
    FakeSocket.current.close();
    await assert.rejects(pending, { code: 'DISCONNECTED' });
  } finally { globalThis.WebSocket = original; }
});

test('connection failure closes the socket before rejecting', async () => {
  const original = globalThis.WebSocket;
  class FailedSocket extends EventTarget {
    static CLOSING = 2;
    constructor() { super(); this.readyState = 0; FailedSocket.current = this; queueMicrotask(() => this.dispatchEvent(new Event('error'))); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  globalThis.WebSocket = FailedSocket;
  try {
    await assert.rejects(connect(), { code: 'NETWORK_ERROR' });
    assert.equal(FailedSocket.current.readyState, 3);
  } finally { globalThis.WebSocket = original; }
});

test('JSON parse errors and body timeouts have stable codes', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{');
    await assert.rejects(capabilities(), { code: 'PROTOCOL_ERROR' });
    globalThis.fetch = async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }));
    await assert.rejects(capabilities({ timeout: 20 }), { code: 'TIMEOUT' });
  } finally { globalThis.fetch = original; }
});

test('HTTP error bodies distinguish snapshot contention from service failure', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"error":"busy"}', { status: 503 });
    await assert.rejects(capabilities(), { code: 'BUSY' });
    globalThis.fetch = async () => new Response('{"error":"snapshot_unavailable"}', { status: 503 });
    await assert.rejects(capabilities(), { code: 'HTTP_ERROR' });
  } finally { globalThis.fetch = original; }
});

test('snapshot body failures and file failures have stable codes', async () => {
  const originalSocket = globalThis.WebSocket, originalFetch = globalThis.fetch;
  globalThis.WebSocket = FakeSocket;
  try {
    const session = await connect();
    globalThis.fetch = async () => new Response(new ReadableStream({ pull(controller) { controller.error(new Error('broken body')); } }));
    await assert.rejects(session.snapshot(), { code: 'NETWORK_ERROR' });
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]));
    await assert.rejects(session.snapshot('/nonexistent-directory/screen.png'), { code: 'IO_ERROR' });
    session.close();
  } finally { globalThis.WebSocket = originalSocket; globalThis.fetch = originalFetch; }
});
