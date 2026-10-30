import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeInputRecord, encodeInput, encodeInputBatch, comboEvents, textEvents, batches, baseUrl, parseHeader, RelayError } from '../../dist/protocol/index.js';
const hex = bytes => Buffer.from(bytes).toString('hex');

test('input records and WebSocket envelope match golden bytes', () => {
  for (const [event, expected] of [
    [{ type: 'keyDown', key: 224 }, '010000e0000000000000000000000000'],
    [{ type: 'keyUp', key: 4 }, '02000004000000000000000000000000'],
    [{ type: 'pointerMove', x: 0.5, y: 1 }, '03000000000000008000ffff00000000'],
    [{ type: 'buttonDown', button: 3, x: 0, y: 1, buttons: 4, modifiers: 2 }, '04000003000000000000ffff00040002'],
    [{ type: 'buttonUp', button: 1, x: 1, y: 0 }, '0500000100000000ffff000000000000'],
    [{ type: 'wheel', axis: 'horizontal', delta: -120, x: 0, y: 0 }, '06000001ffffff880000000000000000'],
    [{ type: 'releaseAll' }, '07000000000000000000000000000000'],
    [{ type: 'text', codepoint: 0x1f600 }, '080000000001f6000000000000000000'],
  ]) assert.equal(hex(encodeInputRecord(event)), expected);
  const message = encodeInput({ type: 'text', codepoint: 233 }, 2, 3);
  assert.equal(hex(message), '4e534c310103000000000002000000030000001008000000000000e90000000000000000');
  assert.deepEqual(parseHeader(message), { type: 3, flags: 0, generation: 2, sequence: 3, payloadLength: 16 });
  assert.equal(hex(encodeInputBatch(textEvents('é😀'))), '08000000000000e90000000000000000080000000001f6000000000000000000');
});

test('combos preserve physical keys, modifier aliases and release order', () => {
  const events = keys => [...keys.map(key => ({ type: 'keyDown', key })), ...keys.toReversed().map(key => ({ type: 'keyUp', key }))];
  assert.deepEqual(comboEvents('ctrl+l'), events([224, 15]));
  assert.deepEqual(comboEvents('cmd+shift+t'), events([227, 225, 23]));
  assert.deepEqual(comboEvents('meta+F24'), events([227, 115]));
  assert.deepEqual(comboEvents('ctrl++'), events([224, 225, 46]));
  assert.deepEqual(comboEvents('+'), events([225, 46]));
  assert.deepEqual(comboEvents('A'), events([225, 4]));
  assert.deepEqual(comboEvents('ctrl+control+a'), events([224, 4]));
  const first = comboEvents('ctrl+l'), second = comboEvents('enter');
  assert.deepEqual(batches([first, second], 5), [first, second]);
  assert.deepEqual(batches([first, second], 6), [[...first, ...second]]);
  assert.throws(() => batches([first], 3), RelayError);
  for (const spec of ['', '+a', 'ctrl+', 'ctrl+++', 'wat+a', 'é', 'toString']) assert.throws(() => comboEvents(spec), RelayError);
});

test('rejects invalid records, malformed envelopes and invalid Unicode before sending', () => {
  for (const event of [null, { type: 'toString' }, { type: 'pointerMove', y: 0 }, { type: 'pointerMove', x: NaN, y: 0 },
    { type: 'keyDown', key: 232 }, { type: 'buttonDown', button: 4, x: 0, y: 0 },
    { type: 'wheel', axis: 'vertical', delta: 1, x: 0, y: 0 }, { type: 'wheel', axis: 'bad', delta: 120, x: 0, y: 0 },
    { type: 'releaseAll', modifiers: 1 }, { type: 'text', codepoint: 0 }, { type: 'text', codepoint: 0xd800 },
    { type: 'text', codepoint: 0x110000 }, { type: 'text', codepoint: 1, buttons: 1 }]) assert.throws(() => encodeInputRecord(event), RelayError);
  for (const text of ['\0', '\ud800', 'ok\udfff']) assert.throws(() => textEvents(text), RelayError);
  assert.deepEqual(textEvents(''), []);
  assert.throws(() => encodeInputBatch([]), RelayError);
  assert.throws(() => encodeInputBatch(Array(257).fill({ type: 'releaseAll' })), RelayError);
  for (const offset of [0, 4, 5, 6, 16]) {
    const bytes = encodeInput({ type: 'releaseAll' }, 1, 1);
    bytes[offset] = 255;
    assert.throws(() => parseHeader(bytes), RelayError);
  }
  const zeroGeneration = encodeInput({ type: 'releaseAll' }, 1, 1);
  zeroGeneration[11] = 0;
  assert.throws(() => parseHeader(zeroGeneration), RelayError);
  assert.throws(() => parseHeader(new Uint8Array(19)), RelayError);
});

test('origin and token rules reject unsafe targets', () => {
  assert.equal(baseUrl('http://localhost:8080').origin, 'http://localhost:8080');
  assert.equal(baseUrl('https://example.com', 'a'.repeat(64)).origin, 'https://example.com');
  for (const [url, token] of [
    ['http://example.com', 'a'.repeat(64)], ['https://example.com'], ['http://localhost/path'],
    ['http://user:pass@localhost'], ['http://localhost?x=1'], ['http://localhost#token'],
    ['http://localhost', 'A'.repeat(64)], ['ws://localhost'], ['not a URL'],
  ]) assert.throws(() => baseUrl(url, token), RelayError);
});
