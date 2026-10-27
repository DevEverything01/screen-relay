import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const container = process.env.TEST_CONTAINER;
assert(container, 'Set TEST_CONTAINER to a dedicated clean XFCE container');
const url = process.env.TEST_URL || 'http://127.0.0.1:18098';
const output = fileURLToPath(new URL('../results/', import.meta.url));
mkdirSync(output, {recursive: true});
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', timeout: 15000});
const run = (...args) => docker('exec', '-e', 'DISPLAY=:1', container, ...args);
const observer = `/tmp/cursor-observe-${process.pid}.py`;
docker('cp', fileURLToPath(new URL('./cursor-observe.py', import.meta.url)), `${container}:${observer}`);
const nativeCursor = () => JSON.parse(run('python3', observer));
const report = {url, container, checks: []};
let browser, page;
const wire = [];
async function poll(read, accept, timeout = 6000) {
  const end = Date.now() + timeout;
  let value, error;
  while (Date.now() < end) {
    try { value = await read(); if (accept(value)) return value; } catch (e) {error = e;}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`Timed out: ${error?.message || JSON.stringify(value)?.slice(0, 400)}`);
}
async function check(name, fn) {
  try {report.checks.push({name, passed: true, evidence: await fn()});}
  catch (error) {report.checks.push({name, passed: false, error: error.stack}); throw error;}
}
async function compareCursor(name, px, py, expectedName) {
  await page.mouse.move(px, py);
  await poll(nativeCursor, c => Math.abs(c.x - px * 1280 / page.viewportSize().width) <= 1 &&
    Math.abs(c.y - py * 1280 / page.viewportSize().width) <= 1 && c.name === expectedName);
  const source = nativeCursor();
  const rendered = await poll(() => page.evaluate(() => {
    const c = document.querySelector('#cursor');
    if (!c || c.hidden) return null;
    const r = c.getBoundingClientRect(), screen = document.querySelector('#screen');
    return {width: c.width, height: c.height, left: r.left, top: r.top,
      cssWidth: r.width, cssHeight: r.height, localCursor: getComputedStyle(screen).cursor,
      rgba: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data]};
  }), value => {
    if (!value || value.width !== source.width || value.height !== source.height) return false;
    return source.argb.every((argb, i) => {
      const alpha = argb >>> 24;
      return value.rgba[i * 4 + 3] === alpha && [16, 8, 0].every((shift, channel) =>
        Math.abs(Math.round(value.rgba[i * 4 + channel] * alpha / 255) - ((argb >>> shift) & 255)) <= 1);
    });
  });
  const scale = page.viewportSize().width / 1280;
  assert.equal(rendered.localCursor, 'none');
  assert(Math.abs(rendered.left + source.xhot * scale - px) < 0.1, 'X hotspot misaligned');
  assert(Math.abs(rendered.top + source.yhot * scale - py) < 0.1, 'Y hotspot misaligned');
  assert.equal(rendered.cssWidth, source.width * scale);
  assert.equal(rendered.cssHeight, source.height * scale);
  const evidence = {...source, rendered};
  writeFileSync(`${output}/cursor-${name}.json`, JSON.stringify(evidence, null, 2));
  await page.screenshot({path: `${output}/cursor-${name}.png`});
  return {name: source.name, serial: source.serial, width: source.width, height: source.height,
    hotspot: [source.xhot, source.yhot], pixelsMatch: true, scale};
}
try {
  browser = await chromium.launch({channel: 'chrome', headless: true});
  page = await browser.newPage({viewport: {width: 1280, height: 800}});
  page.on('websocket', socket => socket.on('framereceived', ({payload}) => {
    if (!Buffer.isBuffer(payload) || payload.length < 20) return;
    wire.push({type: payload[5], generation: payload.readUInt32BE(8), sequence: payload.readUInt32BE(12)});
  }));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Live'));
  await check('actual desktop arrow pixels and hotspot', () => compareCursor('arrow', 1100, 600, 'left_ptr'));
  docker('exec', '-d', '-e', 'DISPLAY=:1', container, 'thunar', '/home/bench');
  const window = await poll(() => run('xdotool', 'search', '--onlyvisible', '--class', 'Thunar').trim().split('\n')[0], Boolean);
  run('xdotool', 'windowsize', window, '760', '480');
  run('xdotool', 'windowmove', window, '160', '110');
  run('xdotool', 'windowactivate', '--sync', window);
  const info = run('xwininfo', '-id', window);
  const clientX = Number(info.match(/Absolute upper-left X:\s+(\d+)/)[1]);
  const clientY = Number(info.match(/Absolute upper-left Y:\s+(\d+)/)[1]);
  await page.mouse.click(clientX + 300, clientY + 200);
  await page.keyboard.press('Control+l');
  await check('real Thunar address-field text cursor', () => compareCursor('text', clientX + 280, clientY + 60, 'text'));
  await check('real XFCE window-border resize cursor', () => compareCursor('resize', clientX - 2, clientY + 220, 'left_side'));
  assert.equal(new Set(report.checks.map(c => c.evidence.serial)).size, 3, 'Arrow, text and resize must be different native shapes');
  await check('stationary cursor is resent on reconnect', async () => {
    const oldGeneration = wire.at(-1).generation;
    await page.getByRole('button', {name: 'Reconnect', exact: true}).click();
    await poll(() => wire.filter(m => m.type === 6).at(-1), m => m?.generation > oldGeneration);
    return compareCursor('reconnected', clientX - 2, clientY + 220, 'left_side');
  });
  await check('scaled desktop preserves cursor image and hotspot', async () => {
    await page.setViewportSize({width: 640, height: 450});
    return compareCursor('scaled', (clientX + 280) / 2, (clientY + 60) / 2, 'text');
  });
  await check('cursor leaves the desktop without an overlay ghost', async () => {
    await page.mouse.move(500, 410);
    assert.equal(await page.locator('#cursor').isVisible(), false);
    return {hiddenOutsideDesktop: true};
  });
  await check('cursor messages use independent sequencing', async () => {
    assert(wire.filter(m => m.type === 6).length >= 4);
    for (const message of wire.filter(m => m.type === 6)) assert.equal(message.sequence, 0);
    for (const generation of new Set(wire.map(m => m.generation))) {
      const messages = wire.filter(m => m.generation === generation);
      assert.equal(messages[0].type, 1);
      messages.filter(m => m.type === 1).forEach((m, index) => assert.equal(m.sequence, index + 1));
    }
    assert.equal(await page.evaluate(() => nativeStats.decodeerrors), 0);
    return {messages: wire.length, cursorMessages: wire.filter(m => m.type === 6).length};
  });
  await page.close();
  await check('cursor changes while video has no ACK credit', async () => {
    page = await browser.newPage({viewport: {width: 1280, height: 800}});
    await page.routeWebSocket('**/stream', route => {
      const upstream = route.connectToServer();
      route.onMessage(message => {
        if (!Buffer.isBuffer(message) || message[5] !== 2) upstream.send(message);
      });
    });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Live'));
    await poll(async () => (await fetch(url + '/metrics')).json(), m => m.oldest_frame_ms >= 300);
    const evidence = await compareCursor('video-paused', clientX - 2, clientY + 220, 'left_side');
    assert.equal(await page.evaluate(() => nativeStats.received), 1, 'Cursor updates must not require another video frame');
    await page.close();
    return {...evidence, videoFrames: 1};
  });
  for (const [name, corrupt] of [
    ['oversized dimensions', b => {b.writeUInt16BE(257, 20); return b;}],
    ['hotspot outside image', b => {b.writeUInt16BE(b.readUInt16BE(20), 24); return b;}],
    ['wrong generation', b => {b.writeUInt32BE(b.readUInt32BE(8) + 1, 8); return b;}],
    ['video sequence on cursor', b => {b.writeUInt32BE(1, 12); return b;}],
    ['truncated pixels', b => {b.writeUInt32BE(b.length - 21, 16); return b.subarray(0, -1);}],
  ]) {
    await check(`rejects cursor with ${name}`, async () => {
      page = await browser.newPage();
      let injected = false;
      await page.routeWebSocket('**/stream', route => {
        const upstream = route.connectToServer();
        upstream.onMessage(message => {
          if (Buffer.isBuffer(message) && message[5] === 6) {
            injected = true; route.send(corrupt(Buffer.from(message)));
          } else route.send(message);
        });
      });
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Invalid cursor'));
      assert(injected, 'Fault must reach the production cursor parser');
      assert.equal(await page.locator('#cursor').isVisible(), false);
      assert.equal(await page.locator('#screen').evaluate(c => getComputedStyle(c).cursor), 'default');
      await page.close();
      return {rejected: true, staleCursorCleared: true};
    });
  }
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser?.close();
  writeFileSync(process.env.TEST_REPORT || `${output}/cursor-integration.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
