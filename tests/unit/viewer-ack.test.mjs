import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

function viewer() {
  const listeners = {}, elements = {}, sockets = [];
  const element = () => ({
    style: {}, classList: { toggle() {} }, hidden: false, width: 1280, height: 720,
    textContent: '', value: '', getContext: () => ({ drawImage() {} }),
    addEventListener() {}, setAttribute() {}, querySelector: () => element(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }),
  });
  class Socket {
    static OPEN = 1;
    static CLOSING = 2;
    constructor() { this.readyState = Socket.OPEN; this.events = []; sockets.push(this); }
    send(data) { const view = new DataView(data); this.events.push([view.getUint8(5), view.getUint32(12)]); }
    close() { this.events.push('close'); this.readyState = Socket.CLOSING; }
  }
  class Decoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'configured'; }
    configure() {}
    decode(chunk) { this.callbacks.output({ timestamp: chunk.timestamp, close() {} }); }
    close() { this.state = 'closed'; }
  }
  const document = {
    hidden: false, body: element(), documentElement: element(),
    querySelector: (selector) => elements[selector] ||= element(),
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  const context = createContext({
    document, window: { VideoDecoder: Decoder, EncodedVideoChunk: true, addEventListener() {} },
    location: { protocol: 'http:', hostname: 'localhost', host: 'localhost', hash: '' },
    URLSearchParams, WebSocket: Socket, VideoDecoder: Decoder,
    EncodedVideoChunk: class { constructor(options) { Object.assign(this, options); } },
    MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    performance: { now: () => 0 }, setInterval: () => 1, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  });
  runInContext(readFileSync('viewer/viewer.js', 'utf8'), context);
  const frame = (seq) => runInContext(`(() => {
    const data = new ArrayBuffer(40), view = new DataView(data);
    view.setUint32(0, 0x4e534c31); view.setUint8(4, 1); view.setUint8(5, 1);
    view.setUint16(6, ${seq === 1 ? 1 : 0}); view.setUint32(8, 1); view.setUint32(12, ${seq});
    view.setUint32(16, 20); view.setUint16(20, 1280); view.setUint16(22, 720);
    view.setBigUint64(24, ${seq}n); new Uint8Array(data, 32).set([0, 0, 1, 103, 66, 0, 30, 0]);
    socket.onmessage({ data });
  })()`, context);
  return { context, document, listeners, sockets, frame };
}

test('voluntary reconnect and hiding ACK queued frames on the old socket', () => {
  const app = viewer();
  app.frame(1); app.frame(2); app.frame(3);
  runInContext('connect()', app.context);
  assert.deepEqual(app.sockets[0].events.filter((event) => event === 'close' || event[0] === 2),
    [[2, 1], [2, 2], [2, 3], 'close']);
  assert.deepEqual(app.sockets[1].events, []);
  app.frame(1); app.frame(2);
  app.document.hidden = true; app.listeners.visibilitychange();
  assert.deepEqual(app.sockets[1].events.filter((event) => event === 'close' || event[0] === 2),
    [[2, 1], [2, 2], 'close']);
});

test('broken sockets do not receive or replay queued ACKs', () => {
  const app = viewer();
  app.frame(1); app.frame(2);
  app.sockets[0].onerror();
  runInContext('connect()', app.context);
  assert.deepEqual(app.sockets[0].events.filter((event) => event === 'close' || event[0] === 2),
    [[2, 1], 'close']);
  assert.deepEqual(app.sockets[1].events, []);
});
