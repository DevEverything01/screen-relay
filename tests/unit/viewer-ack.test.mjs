import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

function viewer({ devicePixelRatio = 1, storage, deferDecode = false } = {}) {
  const listeners = {}, elements = {}, sockets = [], trace = [], animationFrames = new Map();
  const decodeQueue = [];
  let now = 0, nextAnimationFrame = 1;
  const element = () => ({
    style: { setProperty(name, value) { this[name] = value; } }, classList: { toggle() {} }, hidden: false, width: 1280, height: 720,
    value: '', attributes: {}, handlers: {}, text: '', textWrites: 0,
    get textContent() { return this.text; },
    set textContent(value) { this.text = value; this.textWrites++; },
    getContext: () => ({ drawImage(frame) { trace.push(['draw', frame.timestamp]); } }),
    addEventListener(name, callback) { this.handlers[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = String(value); }, focus() {}, querySelector: () => element(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }),
  });
  class Socket {
    static OPEN = 1;
    static CLOSING = 2;
    constructor() { this.readyState = Socket.OPEN; this.events = []; this.inputs = []; sockets.push(this); }
    send(data) {
      const offset = data instanceof ArrayBuffer ? 0 : data.byteOffset;
      const length = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
      const view = new DataView(data instanceof ArrayBuffer ? data : data.buffer, offset, length), type = view.getUint8(5);
      if (type === 2 && this.failAck === view.getUint32(12)) throw new Error('send failed');
      this.events.push([type, view.getUint32(12)]);
      if (type === 2) trace.push(['ack', view.getUint32(12)]);
      if (type === 3) this.inputs.push({ event: view.getUint8(20), code: view.getUint16(22), modifiers: view.getUint16(34) });
    }
    close() { this.events.push('close'); this.readyState = Socket.CLOSING; }
  }
  class Decoder {
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'configured'; }
    configure() {}
    decode(chunk) {
      const output = () => this.callbacks.output({ timestamp: chunk.timestamp, close() { trace.push(['close', chunk.timestamp]); } });
      if (deferDecode) decodeQueue.push(output);
      else output();
    }
    close() { this.state = 'closed'; }
  }
  const document = {
    hidden: false, body: element(), documentElement: element(),
    querySelector: (selector) => elements[selector] ||= element(),
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  const context = createContext({
    document, window: { devicePixelRatio, VideoDecoder: Decoder, EncodedVideoChunk: true, addEventListener() {} },
    location: { protocol: 'http:', hostname: 'localhost', host: 'localhost', hash: '' },
    URLSearchParams, WebSocket: Socket, VideoDecoder: Decoder,
    EncodedVideoChunk: class { constructor(options) { Object.assign(this, options); } },
    MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    performance: { now: () => now }, setInterval: () => 1, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {},
    requestAnimationFrame(callback) { const id = nextAnimationFrame++; animationFrames.set(id, callback); return id; },
    cancelAnimationFrame(id) { animationFrames.delete(id); },
    fetch: async () => ({ ok: false, status: 401 }), localStorage: storage,
  });
  runInContext(readFileSync('dist/viewer/viewer.js', 'utf8'), context);
  const frame = (seq, width = 1280, height = 720, payloadLength = 8) => runInContext(`(() => {
    const data = new ArrayBuffer(${32 + payloadLength}), view = new DataView(data);
    view.setUint32(0, 0x4e534c31); view.setUint8(4, 1); view.setUint8(5, 1);
    view.setUint16(6, ${seq === 1 ? 1 : 0}); view.setUint32(8, 1); view.setUint32(12, ${seq});
    view.setUint32(16, ${12 + payloadLength}); view.setUint16(20, ${width}); view.setUint16(22, ${height});
    view.setBigUint64(24, ${seq}n); new Uint8Array(data, 32).set([0, 0, 1, 103, 66, 0, 30, 0]);
    relayViewer.socket.onmessage({ data });
  })()`, context);
  const tick = (time) => {
    now = time;
    assert.equal(animationFrames.size, 1);
    const [id, callback] = animationFrames.entries().next().value;
    animationFrames.delete(id);
    callback(now);
  };
  return { context, document, listeners, sockets, trace, frame, tick, setTime: (time) => { now = time; }, decodeAll: () => { while (decodeQueue.length) decodeQueue.shift()(); } };
}

const traced = (app, type) => app.trace.filter((event) => event[0] === type).map((event) => event[1]);

test('a deferred decoder accepts and presents a burst larger than eight frames', () => {
  const app = viewer({ deferDecode: true });
  for (let sequence = 1; sequence <= 9; sequence++) app.frame(sequence);
  assert.equal(app.context.window.nativeStats.decodeerrors, 0);
  assert.equal(app.context.window.nativeStats.outstanding, 9);
  assert.equal(app.context.window.nativeStats.pendingHighWater, 9);
  app.decodeAll();
  for (let sequence = 2; sequence <= 9; sequence++) app.tick(sequence * 16);
  assert.equal(app.context.window.nativeStats.outstanding, 0);
  assert.equal(app.context.window.nativeStats.decodeerrors, 0);
  assert.deepEqual(traced(app, 'ack'), Array.from({ length: 9 }, (_, index) => index + 1));
});

test('the deferred decoder count guard matches the sender maximum', () => {
  const app = viewer({ deferDecode: true });
  for (let sequence = 1; sequence <= 360; sequence++) app.frame(sequence);
  assert.equal(app.context.window.nativeStats.outstanding, 360);
  assert.equal(app.context.window.nativeStats.decodeerrors, 0);
  app.frame(361);
  assert.equal(app.context.window.nativeStats.decodeerrors, 1);
  assert.equal(app.context.window.nativeStats.outstanding, 0);
  assert.equal(app.context.window.nativeStats.pendingBytes, 0);
  assert.equal(app.sockets[0].events.at(-1), 'close');
});

test('the pending byte guard still rejects an oversized deferred backlog', () => {
  const app = viewer({ deferDecode: true });
  app.frame(1, 1280, 720, 8388608);
  assert.equal(app.context.window.nativeStats.pendingBytes, 8388608);
  app.frame(2);
  assert.equal(app.context.window.nativeStats.decodeerrors, 1);
});

test('the sequence guard still rejects a gap', () => {
  const app = viewer({ deferDecode: true });
  app.frame(1);
  app.frame(3);
  assert.equal(app.context.window.nativeStats.decodeerrors, 1);
});

test('a burst of six frames draws in order across six animation frames', () => {
  const app = viewer();
  app.frame(1);
  for (let sequence = 2; sequence <= 7; sequence++) app.frame(sequence);
  assert.deepEqual(app.trace, [['draw', 1], ['close', 1], ['ack', 1]]);
  for (let sequence = 2; sequence <= 7; sequence++) {
    app.tick((sequence - 1) * 16);
    assert.deepEqual(app.trace.slice(-3), [['draw', sequence], ['close', sequence], ['ack', sequence]]);
  }
  assert.equal(app.context.window.nativeStats.superseded, 0);
  app.tick(112);
  app.frame(8);
  assert.deepEqual(app.trace.slice(-3), [['draw', 8], ['close', 8], ['ack', 8]]);
  app.frame(9);
  assert.deepEqual(traced(app, 'draw'), [1, 2, 3, 4, 5, 6, 7, 8]);
  app.tick(128);
  assert.deepEqual(app.trace.slice(-3), [['draw', 9], ['close', 9], ['ack', 9]]);
});

test('sustained backlog skips at most once every 250 ms after 500 ms', () => {
  const app = viewer();
  let sequence = 1;
  for (; sequence <= 8; sequence++) app.frame(sequence);
  const step = (time) => { app.tick(time); app.frame(sequence++); };
  for (let time = 20; time <= 480; time += 20) step(time);
  step(499);
  assert.equal(app.context.window.nativeStats.superseded, 0);
  step(500);
  assert.equal(app.context.window.nativeStats.superseded, 1);
  for (let time = 520; time <= 740; time += 20) step(time);
  step(749);
  assert.equal(app.context.window.nativeStats.superseded, 1);
  step(750);
  assert.equal(app.context.window.nativeStats.superseded, 2);
  const drawn = traced(app, 'draw'), closed = traced(app, 'close'), acked = traced(app, 'ack');
  assert.equal(closed.filter((frame) => !drawn.includes(frame)).length, 2);
  assert.deepEqual(acked, Array.from({ length: acked.length }, (_, index) => index + 1));
  assert.deepEqual(closed, acked);
});

test('the catch-up timer restarts when the queue falls to two frames', () => {
  const app = viewer();
  let sequence = 1;
  for (; sequence <= 6; sequence++) app.frame(sequence);
  const step = (time) => { app.tick(time); app.frame(sequence++); };
  for (let time = 20; time <= 480; time += 20) step(time);
  app.tick(490); app.tick(491); app.tick(492);
  app.frame(sequence++); app.frame(sequence++); app.frame(sequence++);
  for (let time = 500; time <= 980; time += 20) step(time);
  step(991);
  assert.equal(app.context.window.nativeStats.superseded, 0);
  step(992);
  assert.equal(app.context.window.nativeStats.superseded, 1);
});

test('more than 12 queued frames skips down to two and ACKs in order', () => {
  const app = viewer();
  for (let sequence = 1; sequence <= 13; sequence++) app.frame(sequence);
  assert.equal(app.context.window.nativeStats.superseded, 0);
  app.frame(14);
  assert.equal(app.context.window.nativeStats.superseded, 11);
  assert.deepEqual(traced(app, 'draw'), [1]);
  assert.deepEqual(traced(app, 'close'), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.deepEqual(traced(app, 'ack'), traced(app, 'close'));
  app.tick(16); app.tick(32);
  assert.deepEqual(traced(app, 'draw'), [1, 13, 14]);
  assert.deepEqual(traced(app, 'ack'), Array.from({ length: 14 }, (_, index) => index + 1));
});

test('a frame older than 200 ms skips the backlog down to two', () => {
  const app = viewer();
  for (let sequence = 1; sequence <= 6; sequence++) app.frame(sequence);
  app.setTime(200); app.frame(7);
  assert.equal(app.context.window.nativeStats.superseded, 0);
  app.tick(201);
  assert.equal(app.context.window.nativeStats.superseded, 4);
  assert.deepEqual(traced(app, 'draw'), [1, 6]);
  assert.deepEqual(traced(app, 'close'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(traced(app, 'ack'), [1, 2, 3, 4, 5, 6]);
  app.tick(217);
  assert.deepEqual(traced(app, 'draw'), [1, 6, 7]);
  assert.deepEqual(traced(app, 'ack'), [1, 2, 3, 4, 5, 6, 7]);
});

test('an arriving frame also triggers the age bound without an animation frame', () => {
  const app = viewer();
  for (let sequence = 1; sequence <= 4; sequence++) app.frame(sequence);
  app.setTime(201); app.frame(5);
  assert.equal(app.context.window.nativeStats.superseded, 2);
  assert.deepEqual(traced(app, 'draw'), [1]);
  assert.deepEqual(traced(app, 'close'), [1, 2, 3]);
  assert.deepEqual(traced(app, 'ack'), [1, 2, 3]);
  app.tick(202); app.tick(218);
  assert.deepEqual(traced(app, 'draw'), [1, 4, 5]);
  assert.deepEqual(traced(app, 'ack'), [1, 2, 3, 4, 5]);
});

test('a failed skipped-frame ACK closes the remaining queue and connection', () => {
  const app = viewer();
  for (let sequence = 1; sequence <= 13; sequence++) app.frame(sequence);
  app.sockets[0].failAck = 2;
  app.frame(14);
  assert.equal(app.context.window.nativeStats.decodeerrors, 1);
  assert.deepEqual(traced(app, 'ack'), [1]);
  assert.deepEqual(traced(app, 'close'), Array.from({ length: 14 }, (_, index) => index + 1));
  assert.equal(app.sockets[0].events.at(-1), 'close');
});

test('drawing updates status only when its text changes', () => {
  const app = viewer();
  const status = app.document.querySelector('#status');
  app.frame(1);
  const liveWrites = status.textWrites;
  app.frame(2); app.tick(16);
  assert.equal(status.textWrites, liveWrites);
  app.sockets[0].onerror();
  assert.equal(status.textContent, 'Connection error');
  app.frame(3); app.tick(32);
  assert.equal(status.textContent, 'Live · click to control');
  assert.equal(status.textWrites, liveWrites + 2);
});

test('voluntary reconnect and hiding ACK queued frames on the old socket', () => {
  const app = viewer();
  app.frame(1); app.frame(2); app.frame(3);
  runInContext('relayViewer.connect()', app.context);
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
  runInContext('relayViewer.connect()', app.context);
  assert.deepEqual(app.sockets[0].events.filter((event) => event === 'close' || event[0] === 2),
    [[2, 1], 'close']);
  assert.deepEqual(app.sockets[1].events, []);
});

test('frames up to 1920x1080 are drawn and size the canvas; wider frames are rejected', () => {
  const app = viewer();
  app.frame(1, 1920, 1080);
  const canvas = app.document.querySelector('#screen');
  assert.deepEqual([app.context.window.nativeStats.drawn, canvas.width, canvas.height], [1, 1920, 1080]);
  app.frame(2, 1922, 1080);
  assert.equal(app.context.window.nativeStats.decodeerrors, 1);
});

test('actual size is one stream pixel per device pixel and follows density changes', () => {
  const app = viewer({ devicePixelRatio: 2 });
  const canvas = app.document.querySelector('#screen');
  runInContext('relayViewer.setScale("actual")', app.context);
  assert.deepEqual([canvas.style.width, canvas.style.height], ['640px', '360px']);
  app.context.window.devicePixelRatio = 1;
  runInContext('relayViewer.watchDpr()', app.context);
  assert.deepEqual([canvas.style.width, canvas.style.height], ['1280px', '720px']);
});

test('scale mode and sharp pixels survive a reload; blocked storage still works', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = viewer({ devicePixelRatio: 2, storage });
  runInContext('relayViewer.setScale("actual"); relayViewer.toggleSharp()', first.context);
  const reloaded = viewer({ devicePixelRatio: 2, storage });
  const canvas = reloaded.document.querySelector('#screen');
  assert.deepEqual([canvas.style.width, canvas.style.height, canvas.style.imageRendering], ['640px', '360px', 'pixelated']);
  assert.equal(reloaded.document.querySelector('[data-scale="actual"]').attributes['aria-pressed'], 'true');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const fallback = viewer({ devicePixelRatio: 2, storage: blocked });
  runInContext('relayViewer.setScale("actual")', fallback.context);
  assert.equal(fallback.document.querySelector('#screen').style.width, '640px');
});

function key(app, type, code, capsLock = false) {
  app.document.querySelector('#screen').handlers[type]({
    code, repeat: false, preventDefault() {},
    getModifierState: (name) => name === 'CapsLock' ? capsLock : false,
  });
}

const inputBytes = (app) => app.sockets[0].inputs.map(({ event, code }) => [event, code]);

test('a latched modifier stays down through a matching shortcut', () => {
  const app = viewer();
  app.frame(1);
  const panel = app.document.querySelector('#keys-panel');
  const hold = { dataset: { hold: 'AltLeft' }, setAttribute(name, value) { this[name] = value; } };
  panel.handlers.click({ target: { closest: (selector) => selector === '[data-hold]' ? hold : null } });
  const shortcut = { dataset: { keys: 'AltLeft+Tab' } };
  panel.handlers.click({ target: { closest: (selector) => selector === '[data-keys]' ? shortcut : null } });
  assert.deepEqual(inputBytes(app), [[1, 226], [1, 43], [2, 43], [2, 226]]);
  assert.equal(app.sockets[0].inputs[1].modifiers, 4);
  assert.equal(hold['aria-pressed'], 'false');
});

test('toolbar keys bypass the physical keyboard mapping', () => {
  const app = viewer();
  app.frame(1);
  runInContext('relayViewer.toggleMeta()', app.context);
  const panel = app.document.querySelector('#keys-panel');
  const press = (kind, name) => {
    const button = { dataset: { [kind]: name }, setAttribute() {} };
    panel.handlers.click({ target: { closest: (selector) => selector === `[data-${kind}]` ? button : null } });
  };
  press('hold', 'ControlLeft');
  press('hold', 'ControlLeft');
  press('hold', 'AltLeft');
  press('hold', 'AltLeft');
  press('hold', 'MetaLeft');
  press('keys', 'MetaLeft');
  press('hold', 'MetaLeft');
  press('keys', 'ControlLeft+KeyC');
  press('keys', 'ControlLeft+AltLeft+Delete');
  press('keys', 'MetaLeft+KeyD');
  key(app, 'keydown', 'MetaLeft');
  key(app, 'keyup', 'MetaLeft');
  assert.deepEqual(inputBytes(app), [
    [7, 0], [1, 224], [2, 224], [1, 226], [2, 226], [1, 227], [2, 227],
    [1, 224], [1, 6], [2, 6], [2, 224],
    [1, 224], [1, 226], [1, 76], [2, 76], [2, 226], [2, 224],
    [1, 227], [1, 7], [2, 7], [2, 227], [1, 224], [2, 224],
  ]);
});

test('macOS Caps Lock keydown and keyup each toggle the remote once', () => {
  const app = viewer();
  app.frame(1);
  key(app, 'keydown', 'CapsLock', true);
  key(app, 'keyup', 'CapsLock', false);
  key(app, 'keydown', 'CapsLock', true);
  key(app, 'keyup', 'CapsLock', false);
  assert.deepEqual(inputBytes(app), [[1, 57], [2, 57], [1, 57], [2, 57], [1, 57], [2, 57], [1, 57], [2, 57]]);
});

test('Windows Caps Lock keydown and keyup per press produce one tap', () => {
  const app = viewer();
  app.frame(1);
  key(app, 'keydown', 'CapsLock', true);
  key(app, 'keyup', 'CapsLock', true);
  key(app, 'keydown', 'CapsLock', false);
  key(app, 'keyup', 'CapsLock', false);
  assert.deepEqual(inputBytes(app), [[1, 57], [2, 57], [1, 57], [2, 57]]);
});

test('a letter typed with Caps Lock already on sends the tap before the letter', () => {
  const app = viewer();
  app.frame(1);
  key(app, 'keydown', 'KeyA', true);
  assert.deepEqual(inputBytes(app), [[1, 57], [2, 57], [1, 4]]);
});

test('a held modifier toggle wraps exactly the next key and then releases', () => {
  const app = viewer();
  app.frame(1);
  const panel = app.document.querySelector('#keys-panel');
  const button = { dataset: { hold: 'MetaLeft' }, setAttribute(name, value) { this[name] = value; } };
  const toggle = () => panel.handlers.click({ target: { closest: (selector) => selector === '[data-hold]' ? button : null } });
  toggle();
  assert.equal(button['aria-pressed'], 'true');
  key(app, 'keydown', 'KeyL');
  key(app, 'keyup', 'KeyL');
  assert.deepEqual(inputBytes(app), [[1, 227], [1, 15], [2, 227], [2, 15]]);
  assert.equal(button['aria-pressed'], 'false');
  key(app, 'keydown', 'KeyM');
  key(app, 'keyup', 'KeyM');
  assert.deepEqual(inputBytes(app).slice(4), [[1, 16], [2, 16]]);
  toggle();
  assert.equal(button['aria-pressed'], 'true');
  toggle();
  assert.equal(button['aria-pressed'], 'false');
  assert.deepEqual(inputBytes(app).slice(6), [[1, 227], [2, 227]]);
});

test('Caps Lock tracking resets with the generation', () => {
  const app = viewer();
  app.frame(1);
  key(app, 'keydown', 'CapsLock', true);
  runInContext('relayViewer.reset()', app.context);
  app.frame(1);
  key(app, 'keydown', 'KeyA', true);
  assert.deepEqual(inputBytes(app), [[1, 57], [2, 57], [7, 0], [1, 57], [2, 57], [1, 4]]);
});

test('a Caps Lock tap dropped while not ready is retried by the next key', () => {
  const app = viewer();
  key(app, 'keydown', 'KeyA', true);
  assert.deepEqual(inputBytes(app), []);
  assert.equal(runInContext('relayViewer.capsLock', app.context), false);
  app.frame(1);
  key(app, 'keydown', 'KeyB', true);
  assert.deepEqual(inputBytes(app), [[1, 57], [2, 57], [1, 5]]);
  assert.equal(runInContext('relayViewer.capsLock', app.context), true);
});

test('keys-panel buttons keep the canvas focus so hold latches survive clicks', () => {
  const app = viewer();
  app.frame(1);
  const panel = app.document.querySelector('#keys-panel');
  const canvas = app.document.querySelector('#screen');
  const blocked = (type, button) => {
    let prevented = false;
    panel.handlers[type]({ target: button, preventDefault() { prevented = true; } });
    if (!prevented) canvas.handlers.blur();
    assert.equal(prevented, true, `${type} on a keys-panel button did not keep the canvas focus`);
  };
  const press = (kind, name) => {
    const button = {
      dataset: { [kind]: name }, setAttribute(name, value) { this[name] = value; },
      closest: (selector) => selector === `[data-${kind}]` ? button : null,
    };
    blocked('pointerdown', button);
    blocked('mousedown', button);
    panel.handlers.click({ target: button });
    return button;
  };
  press('hold', 'ControlLeft');
  press('hold', 'ShiftLeft');
  assert.deepEqual(inputBytes(app), [[1, 224], [1, 225]]);
  key(app, 'keydown', 'KeyA');
  assert.deepEqual(inputBytes(app), [[1, 224], [1, 225], [1, 4], [2, 224], [2, 225]]);
  assert.equal(app.sockets[0].inputs[2].modifiers, 3);
  press('hold', 'ControlLeft');
  press('hold', 'ControlLeft');
  assert.deepEqual(inputBytes(app).slice(5), [[1, 224], [2, 224]]);
  press('hold', 'ControlLeft');
  press('keys', 'Escape');
  assert.deepEqual(inputBytes(app).slice(7), [[1, 224], [1, 41], [2, 41], [2, 224]]);
});
