import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect } from '../../dist/sdk/index.js';

const scripts = fileURLToPath(new URL('../../scripts', import.meta.url));
const python = (code, input) => JSON.parse(execFileSync('python3', ['-c', `import json,sys,types
sys.path.insert(0,sys.argv[1])
from relaycli import common,keys
ns=types.SimpleNamespace(Failure=common.Failure,encode=keys.encode,type_groups=keys.type_groups,combo_events=keys.combo_events)
data=json.load(sys.stdin)
${code}`, scripts], { input: JSON.stringify(input), encoding: 'utf8' }));

async function sdkRecords(events) {
  const original = globalThis.WebSocket;
  let socket;
  globalThis.WebSocket = class extends EventTarget {
    static CLOSING = 2;
    constructor() {
      super(); socket = this; this.readyState = 1;
      const ready = Buffer.from('NSL1\x01\x04\0\0\0\0\0\x07\0\0\0\0\0\0\0\x04\x05\0\x02\xd0', 'latin1');
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: ready.buffer.slice(ready.byteOffset, ready.byteOffset + ready.length) })));
    }
    send(data) { this.sent = Buffer.from(data); }
    close() { this.readyState = 3; }
  };
  try {
    const session = await connect();
    const records = events.map(event => { session.input(event).catch(() => {}); return socket.sent.subarray(20).toString('hex'); });
    session.close();
    return records;
  } finally { globalThis.WebSocket = original; }
}

test('Python input records match the SDK encoding byte for byte', async () => {
  const events = [
    { type: 'keyDown', key: 4 }, { type: 'keyUp', key: 231 },
    { type: 'pointerMove', x: 0.5, y: 1 }, { type: 'pointerMove', x: 200 / 1279, y: 130 / 719 },
    { type: 'buttonDown', button: 1, x: 0, y: 0.25 }, { type: 'buttonUp', button: 3, x: 1 / 3, y: 2 / 3 },
    { type: 'wheel', axis: 'vertical', delta: -360, x: 0.1, y: 0.9 }, { type: 'wheel', axis: 'horizontal', delta: 1200, x: 0.5, y: 0.5 },
    { type: 'releaseAll' },
  ];
  assert.deepEqual(python('print(json.dumps([ns.encode(e).hex() for e in data]))', events), await sdkRecords(events));
  for (const bad of [{ type: 'keyDown', key: 232 }, { type: 'pointerMove', x: 1.5, y: 0 }, { type: 'wheel', axis: 'vertical', delta: 100, x: 0, y: 0 },
    { type: 'buttonDown', button: true, x: 0, y: 0 }, { type: 'toString' }])
    assert.equal(python('try: ns.encode(data); print(0)\nexcept ns.Failure: print(1)', bad), 1, JSON.stringify(bad));
});

test('text and combos map to US-layout HID keys with shift where needed', () => {
  const keys = python('print(json.dumps([[e["type"][3], e["key"]] for g in ns.type_groups(data[0]) + [ns.combo_events(c) for c in data[1]] for e in g]))',
    ['aA!\n', ['ctrl+l', 'shift+Tab', 'ctrl++']]);
  const press = (key, ...mods) => [...mods.map(m => ['D', m]), ['D', key], ['U', key], ...mods.reverse().map(m => ['U', m])];
  assert.deepEqual(keys, [...press(4), ...press(4, 225), ...press(30, 225), ...press(40),
    ...press(15, 224), ...press(43, 225), ...press(46, 224, 225)]);
  assert.equal(python('try: ns.type_groups(data); print(0)\nexcept ns.Failure as f: print(int("é" in f.message))', 'café'), 1);
});
