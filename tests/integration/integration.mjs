import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const container = process.env.TEST_CONTAINER;
assert(container, 'Set TEST_CONTAINER to the existing native container');
const url = process.env.TEST_URL || 'http://127.0.0.1:18094';
const wsURL = url.replace(/^http/, 'ws') + '/stream';
const results = fileURLToPath(new URL('../results/', import.meta.url));
mkdirSync(results, {recursive: true});
const tag = `nsl-integration-${process.pid}-${Date.now()}`;
const statePath = `/tmp/${tag}.json`;
const fixturePath = `/tmp/${tag}.py`;
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', timeout: 15000});
const at = async (x, y) => {
  const box = await page.locator('#screen').boundingBox();
  return [box.x + x * box.width / 1280, box.y + y * box.height / 720];
};
const state = () => JSON.parse(docker('exec', container, 'cat', statePath));
const report = {url, container, started: new Date().toISOString(), checks: []};
let browser, page, fixturePID, pausedFixtures = [];
async function poll(read, predicate, timeout = 8000) {
  const end = Date.now() + timeout;
  let value, error;
  while (Date.now() < end) {
    try { value = await read(); if (predicate(value)) return value; } catch (e) { error = e; }
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`Condition timed out: ${JSON.stringify(value)} ${error || ''}`);
}
async function check(name, fn) {
  const start = Date.now();
  try { const evidence = await fn(); report.checks.push({name, passed: true, ms: Date.now()-start, evidence}); }
  catch (e) { report.checks.push({name, passed: false, error: e.stack}); throw e; }
}
async function live(p = page) {
  await p.waitForFunction(() => window.nativeStats?.drawn > 0 && document.querySelector('#status').textContent.startsWith('Live'), {timeout: 12000});
  assert.equal(await p.evaluate(() => nativeStats.decodeerrors), 0);
}
async function pixel(expected) {
  return poll(() => page.evaluate(() => [...document.querySelector('#screen').getContext('2d').getImageData(800, 400, 1, 1).data]),
    p => expected.every((v, i) => Math.abs(v-p[i]) < 35));
}
// A raw receiver exercises server framing and timeout without relying on the viewer's parser or ACK code.
async function rawProbe(mode, origin) {
  const context = await browser.newContext({permissions: ['local-network-access']});
  const p = await context.newPage();
  const diagnostics = [];
  p.on('console', m => diagnostics.push(m.text()));
  await p.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Protocol probe</title>'}));
  await p.goto(origin || url);
  try {
    const result = await p.evaluate(({wsURL, mode}) => new Promise((resolve, reject) => {
      let opened = false, frames = 0, firstAt, first, timer, invalidTimer;
      const received = [];
      const start = performance.now(), ws = new WebSocket(wsURL);
      ws.binaryType = 'arraybuffer';
      timer = setTimeout(() => {ws.close(); reject(new Error('Socket did not close within 7s'));}, 7000);
      ws.onopen = () => {opened = true;};
      ws.onmessage = e => {
        const header = new DataView(e.data);
        if (header.getUint8(5) === 6) return; // Cursor changes do not consume video credit.
        frames++;
        received.push({generation: header.getUint32(8), sequence: header.getUint32(12), bytes: e.data.byteLength, at: performance.now()-start});
        if (frames !== 1) return;
        firstAt = performance.now();
        const v = new DataView(e.data);
        first = {magic: v.getUint32(0), type: v.getUint8(5), flags: v.getUint16(6), generation: v.getUint32(8), sequence: v.getUint32(12)};
        if (mode === 'malformed') ws.send(new Uint8Array(36));
        if (mode === 'oversized') ws.send(new Uint8Array(65537));
        if (mode === 'pipeline') {
          const ack = (generation, sequence) => {
            const b = new ArrayBuffer(20), v = new DataView(b);
            v.setUint32(0,0x4e534c31); v.setUint8(4,1); v.setUint8(5,2);
            v.setUint32(8,generation); v.setUint32(12,sequence); ws.send(b);
          };
          setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ack(first.generation, first.sequence);
            invalidTimer = setInterval(() => {
              if (ws.readyState !== WebSocket.OPEN) return;
              ack(first.generation, first.sequence); // Duplicate retired frame.
              ack(first.generation, received.at(-1).sequence + 1000); // Never sent.
              ack(first.generation + 1, received.at(-1).sequence); // Wrong generation.
            }, 70);
          }, 120);
        }
        if (mode === 'stall' || mode === 'pipeline') {
          for (const [event, code] of [[1,225],[4,1]]) {
            const b = new ArrayBuffer(36), input = new DataView(b);
            input.setUint32(0,0x4e534c31); input.setUint8(4,1); input.setUint8(5,3);
            input.setUint32(8,first.generation); input.setUint32(16,16);
            input.setUint8(20,event); input.setUint16(22,code);
            input.setUint16(28,40000); input.setUint16(30,40000);
            ws.send(b);
          }
        }
      };
      ws.onerror = () => {};
      ws.onclose = e => {clearTimeout(timer); clearInterval(invalidTimer); resolve({opened, frames, first, received, code: e.code, elapsed: performance.now()-start, afterFrame: firstAt && performance.now()-firstAt});};
    }), {wsURL, mode});
    assert(!diagnostics.some(s => s.includes('LOCAL_NETWORK_ACCESS')), diagnostics.join('\n'));
    return {...result, diagnostics};
  } finally {await context.close();}
}
try {
  // The dedicated container's benchmark producer must not create hidden-window damage during idle proof.
  pausedFixtures = JSON.parse(docker('exec', container, 'python3', '-c', `
import os, signal, json
paused = []
for name in os.listdir('/proc'):
    if not name.isdigit(): continue
    try:
        args = open('/proc/' + name + '/cmdline', 'rb').read().split(b'\\0')
        status = open('/proc/' + name + '/status').read()
        if b'/opt/bench/fixture.py' in args and '\\nState:\\tT' not in status:
            os.kill(int(name), signal.SIGSTOP)
            paused.append(int(name))
    except (FileNotFoundError, ProcessLookupError): pass
print(json.dumps(paused))`));
  docker('cp', fileURLToPath(new URL('./input_fixture.py', import.meta.url)), `${container}:${fixturePath}`);
  docker('exec', '-d', '-e', 'DISPLAY=:1', container, 'python3', fixturePath, statePath);
  fixturePID = (await poll(state, s => s.pid)).pid;
  browser = await chromium.launch({channel: 'chrome', headless: true});
  page = await browser.newPage({viewport: {width: 1280, height: 800}});
  report.browserErrors = [];
  page.on('pageerror', e => report.browserErrors.push(e.stack));
  await page.goto(url);
  await check('decoded canvas contains independent X11 fixture pixels', async () => {
    await live(); const rgba = await pixel([32,176,96]);
    await page.screenshot({path: results+'initial.png'});
    return {rgba, stats: await page.evaluate(() => nativeStats)};
  });
  await check('metrics match independent cgroup CPU counters and preserve live video', async () => {
    const cpuUsage = () => {
      const text = docker('exec', container, 'cat', '/sys/fs/cgroup/cpu.stat');
      const match = /^usage_usec\s+(\d+)$/m.exec(text);
      assert(match, 'Independent cgroup cpu.stat has no usage_usec');
      const usage = Number(match[1]);
      assert(Number.isSafeInteger(usage) && usage > 0, 'Running container must have positive CPU usage');
      return usage;
    };
    const samples = [];
    for (let i = 0; i < 2; i++) {
      const before = cpuUsage();
      const response = await page.evaluate(async () => {
        const r = await fetch('/metrics', {cache: 'no-store', signal: AbortSignal.timeout(5000)});
        return {status: r.status, contentType: r.headers.get('content-type'),
          cacheControl: r.headers.get('cache-control'), body: await r.json()};
      });
      const after = cpuUsage();
      assert.equal(response.status, 200);
      assert.match(response.contentType || '', /^application\/json(?:;|$)/i);
      assert.match(response.cacheControl || '', /(?:^|,)\s*no-store\s*(?:,|$)/i);
      for (const key of ['usage_usec', 'memory_current', 'inactive_file']) {
        assert(Number.isSafeInteger(response.body[key]) && response.body[key] >= 0, `Invalid ${key}`);
      }
      assert(before <= response.body.usage_usec && response.body.usage_usec <= after,
        `HTTP CPU counter ${response.body.usage_usec} outside independent [${before}, ${after}]`);
      samples.push({before, response, after});
    }
    const hud = await poll(() => page.locator('#hud').textContent(), text =>
      /Cgroup CPU \(one core\): [\d.]+%/.test(text) && /Cgroup RAM: [\d.]+ MiB/.test(text));
    const drawn = await page.evaluate(() => nativeStats.drawn);
    await page.mouse.click(...await at(200,130));
    await poll(() => page.evaluate(() => nativeStats), s => s.drawn > drawn && s.decodeerrors === 0);
    return {samples, hud, statsAfterMetrics: await page.evaluate(() => nativeStats)};
  });
  await check('viewer pointer, keyboard, modifiers and wheel reach X11 application', async () => {
    await page.mouse.click(...await at(200,130));
    await page.keyboard.type('native42');
    await page.keyboard.down('Shift'); await page.keyboard.press('KeyA'); await page.keyboard.up('Shift');
    await page.mouse.move(...await at(800,400)); await page.mouse.wheel(0,100);
    const s = await poll(state, s => s.entry === 'native42A' && s.events.some(e => e.type === 'ButtonPress' && e.button === '5'));
    assert(Math.abs(s.pointer[0]-800) < 3 && Math.abs(s.pointer[1]-400) < 3);
    return s;
  });
  await check('held controls release on canvas blur with independent X server state', async () => {
    await page.locator('#screen').focus(); await page.keyboard.down('Shift');
    await page.mouse.move(...await at(800,400)); await page.mouse.down();
    await poll(state, s => s.shift && s.button1);
    await page.locator('#toolbar-toggle').focus();
    const s = await poll(state, s => !s.shift && !s.button1);
    await page.keyboard.up('Shift'); await page.mouse.up();
    return {shift: s.shift, button1: s.button1};
  });
  await check('second viewer rejected while first remains live', async () => {
    const rejection = await rawProbe('reject');
    assert.equal(rejection.opened, false);
    docker('exec', container, 'kill', '-USR1', String(fixturePID));
    const rgba = await pixel([192,48,176]); await live();
    return {rejection, rgba};
  });
  await check('continuous X11 damage decodes changing pixels and settles when damage stops', async () => {
    const before = await page.evaluate(() => nativeStats.drawn);
    docker('exec', container, 'kill', '-USR2', String(fixturePID));
    const readPatch = () => page.evaluate(() => [...document.querySelector('#screen').getContext('2d').getImageData(1000,150,1,1).data]);
    let yellow, blue;
    try {
      yellow = await poll(readPatch, p => Math.abs(p[0]-224) < 35 && Math.abs(p[1]-160) < 35 && p[2] < 70);
      blue = await poll(readPatch, p => p[0] < 70 && Math.abs(p[1]-64) < 35 && Math.abs(p[2]-224) < 35);
      await poll(() => page.evaluate(() => nativeStats), s => s.drawn >= before + 5 && s.decodeerrors === 0);
    } finally {
      docker('exec', container, 'kill', '-USR2', String(fixturePID));
      await poll(state, s => !s.animating);
    }
    await page.waitForTimeout(500);
    const settled = await page.evaluate(() => nativeStats.drawn);
    await page.waitForTimeout(1000);
    const final = await page.evaluate(() => nativeStats);
    assert(final.drawn - settled <= 2, `Idle desktop keeps producing frames: ${JSON.stringify({settled, final})}`);
    assert.equal(final.decodeerrors, 0);
    return {yellow, blue, settled, final};
  });
  await check('disconnect releases held controls and reconnect renders fresh desktop', async () => {
    await page.locator('#screen').focus(); await page.keyboard.down('Shift');
    await page.mouse.move(...await at(800,400)); await page.mouse.down();
    await poll(state, s => s.shift && s.button1);
    await page.close();
    await poll(state, s => !s.shift && !s.button1);
    page = await browser.newPage({viewport: {width:1280,height:800}});
    await page.goto(url); await live(); const rgba = await pixel([192,48,176]);
    await page.screenshot({path: results+'reconnected.png'});
    await page.close();
    return {rgba};
  });
  for (const mode of ['malformed','oversized','stall']) {
    await check(`${mode} receiver closes and subsequent session recovers`, async () => {
      // Browser close completion can precede the server consuming its close frame.
      const probe = poll(() => rawProbe(mode), r => r.opened);
      if (mode === 'stall') await poll(state, s => s.shift && s.button1, 2500);
      const r = await probe;
      assert(r.opened && r.frames === 1, JSON.stringify(r));
      assert.deepEqual({...r.first, generation:1}, {magic:0x4e534c31,type:1,flags:1,generation:1,sequence:1});
      assert(r.first.generation > 0);
      if (mode === 'stall') assert(r.afterFrame >= 2800 && r.afterFrame < 6000, JSON.stringify(r));
      else assert(r.afterFrame < 2000, JSON.stringify(r));
      if (mode === 'stall') await poll(state, s => !s.shift && !s.button1);
      page = await browser.newPage(); await page.goto(url); await live(); await pixel([192,48,176]); await page.close();
      return r;
    });
  }
  await check('pipeline admits multiple frames and invalid ACKs cannot replenish credits or extend ownership', async () => {
    docker('exec', container, 'kill', '-USR2', String(fixturePID));
    await poll(state, s => s.animating && s.animationTick > 3);
    let r;
    try {
      const probe = poll(() => rawProbe('pipeline'), value => value.opened);
      await poll(state, s => s.shift && s.button1, 2500);
      r = await probe;
    } finally {
      docker('exec', container, 'kill', '-USR2', String(fixturePID));
      await poll(state, s => !s.animating);
    }
    assert(r.frames >= 3, `One ACK must admit multiple actual damage frames: ${JSON.stringify(r)}`);
    assert.equal(r.first.flags & 1, 1, 'A new session must start with an IDR frame');
    assert(r.frames <= 9, `Invalid ACKs replenished the eight-frame window: ${JSON.stringify(r)}`);
    assert(r.afterFrame >= 2900 && r.afterFrame < 6000, `Invalid ACKs changed no-progress timeout: ${JSON.stringify(r)}`);
    for (let i = 0; i < r.received.length; i++) {
      const f = r.received[i];
      assert.equal(f.generation, r.first.generation);
      assert.equal(f.sequence, i + 1);
      assert(f.bytes > 32 && f.bytes <= 8*1024*1024 + 32);
    }
    assert(r.received.slice(1).reduce((n, f) => n + f.bytes - 32, 0) <= 8*1024*1024);
    await poll(state, s => !s.shift && !s.button1);
    page = await browser.newPage(); await page.goto(url); await live(); await pixel([192,48,176]);
    await page.close();
    return r;
  });
  await check('non-loopback origin rejected at handshake', async () => {
    const r = await rawProbe('reject', 'https://untrusted.invalid'); assert.equal(r.opened,false); return r;
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({path: results+'failure.png'}).catch(() => {});
} finally {
  await browser?.close();
  if (fixturePID) {
    try {report.finalFixture = state(); docker('exec', container, 'kill', String(fixturePID));}
    catch (e) {report.cleanupError = e.message; process.exitCode = 1;}
  }
  for (const pid of pausedFixtures) {
    try { docker('exec', container, 'kill', '-CONT', String(pid)); }
    catch (e) {report.cleanupError = e.message; process.exitCode = 1;}
  }
  report.finished = new Date().toISOString();
  writeFileSync(results+'integration.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
