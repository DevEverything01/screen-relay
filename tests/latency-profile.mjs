import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../desktop-stream-bench/node_modules/playwright/index.mjs';

const container = process.env.TEST_CONTAINER;
assert(container, 'Set TEST_CONTAINER to the existing native container running bench/fixture.py');
const url = process.env.TEST_URL || 'http://127.0.0.1:18094';
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', timeout: 15000});
const source = () => JSON.parse(docker('exec', container, 'cat', '/tmp/bench-status.json'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(directory, {recursive: true});
const report = {url, container, started: new Date().toISOString(), trials: [], errors: [], limits: [
  'Instrumented diagnostic only; do not compare its CPU or latency directly with uninstrumented runs.',
  'Arrival is browser WebSocket message dispatch, not network packet arrival. Input-to-arrival combines viewer/server/network work.',
  'Decoder output timestamps include browser scheduling. Draw completion is canvas submission, not physical presentation.',
  'First changed pixel is sampled on requestAnimationFrame; its gap from draw includes sampling quantization.',
  'The one-bit flash is correlated with sequential inputs and exact independent native toggle increments; this is not a general multi-input correlation protocol.',
]};
let browser, page;
try {
  const token = `idle ${Date.now()}`;
  docker('exec', container, 'python3', '-c', `from pathlib import Path; Path('/tmp/bench-mode').write_text(${JSON.stringify(token)})`);
  await delay(2200);
  const geometry = source();
  assert.equal(geometry.mode, 'idle');
  assert.equal(geometry.fps_marker, false);
  report.geometry = {x: geometry.x, y: geometry.y};
  browser = await chromium.launch({channel: 'chrome', headless: true});
  page = await browser.newPage({viewport: {width: 1280, height: 720}, deviceScaleFactor: 1});
  page.on('pageerror', error => report.errors.push(error.stack));
  await page.addInitScript(({x, y}) => {
    const trace = window.latencyTrace = {frames: [], inputs: [], rafTimes: [], active: null};
    const byTimestamp = new Map();
    const pixel = () => {
      const c = document.querySelector('#screen');
      if (!c) return null;
      const p = c.getContext('2d').getImageData(x + 1050, y + 565, 1, 1).data;
      return {green: p[1] > p[0], contrast: Math.abs(p[1] - p[0])};
    };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 33) return;
          const v = new DataView(event.data);
          if (v.getUint32(0) !== 0x4e534c31 || v.getUint8(5) !== 1) return;
          const timestamp = Number(v.getBigUint64(24));
          const frame = {timestamp, generation: v.getUint32(8), sequence: v.getUint32(12), arrival: performance.now()};
          byTimestamp.set(timestamp, frame); trace.frames.push(frame);
        });
      }
    };
    const NativeDecoder = window.VideoDecoder;
    if (NativeDecoder) window.VideoDecoder = class extends NativeDecoder {
      constructor(init) {
        super({...init, output(frame) {
          const item = byTimestamp.get(frame.timestamp);
          if (item) item.output = performance.now();
          // The production output callback draws synchronously and closes the VideoFrame.
          init.output(frame);
          if (!item) return;
          item.draw = performance.now();
          const after = pixel();
          item.pixel = after;
          const trial = trace.active;
          if (trial && !trial.changedFrame && after?.contrast > 100 && after.green !== trial.before.green) {
            trial.changedFrame = {...item};
          }
        }});
      }
      decode(chunk) {
        const item = byTimestamp.get(chunk.timestamp);
        if (item) item.decode = performance.now();
        return super.decode(chunk);
      }
    };
    window.addEventListener('pointerdown', event => {
      if (!trace.armed || event.target.id !== 'screen') return;
      trace.armed = false;
      const before = pixel();
      const trial = {input: performance.now(), before, changedFrame: null, sampled: null};
      trace.inputs.push(trial); trace.active = trial;
      function sample(now) {
        trace.rafTimes.push(now);
        const after = pixel();
        if (after?.contrast > 100 && before && after.green !== before.green) {
          trial.sampled = performance.now(); trial.sampledPixel = after; trace.active = null;
        } else if (performance.now() - trial.input < 3000) requestAnimationFrame(sample);
        else {trial.timeout = true; trace.active = null;}
      }
      requestAnimationFrame(sample);
    }, true);
  }, report.geometry);
  await page.goto(url);
  await page.waitForFunction(() => window.nativeStats?.drawn > 0 && document.querySelector('#status').textContent.startsWith('Live'), null, {timeout: 12000});
  await page.mouse.move(10, 700);
  await delay(700);
  report.userAgent = await page.evaluate(() => navigator.userAgent);
  const initial = source();
  for (let i = 0; i < 20; i++) {
    const before = source();
    assert.equal(before.toggles, initial.toggles + i, 'Unexpected native input before trial');
    await page.evaluate(() => {latencyTrace.armed = true;});
    await page.mouse.click(geometry.x + 1050, geometry.y + 565);
    await page.waitForFunction(index => {
      const trial = latencyTrace.inputs[index];
      return trial && (trial.sampled !== null || trial.timeout);
    }, i, {timeout: 4000});
    const trial = await page.evaluate(index => latencyTrace.inputs[index], i);
    trial.index = i; trial.sourceBefore = before.toggles;
    const nativeDeadline = Date.now() + 1500;
    let after;
    do {after = source(); if (after.toggles > before.toggles) break; await delay(25);} while (Date.now() < nativeDeadline);
    trial.sourceAfter = after.toggles;
    report.trials.push(trial);
    assert.equal(after.toggles, before.toggles + 1, 'Native toggle increment must equal one');
    assert(!trial.timeout && trial.before?.contrast > 100 && trial.changedFrame, 'Missing correlated changed frame');
    const f = trial.changedFrame;
    assert([trial.input, f.arrival, f.decode, f.output, f.draw, trial.sampled].every(Number.isFinite));
    assert(trial.input <= f.arrival && f.arrival <= f.decode && f.decode <= f.output && f.output <= f.draw && f.draw <= trial.sampled, 'Phase timestamps are not ordered');
    trial.phasesMs = {inputToArrival: f.arrival-trial.input, arrivalToDecode: f.decode-f.arrival, decodeToOutput: f.output-f.decode, outputToDraw: f.draw-f.output, drawToRafPixel: trial.sampled-f.draw, inputToRafPixel: trial.sampled-trial.input};
    await delay(170);
  }
  const final = source();
  report.nativeToggleDelta = final.toggles-initial.toggles;
  assert.equal(report.nativeToggleDelta, 20);
  report.trace = await page.evaluate(() => latencyTrace);
  report.nativeStats = await page.evaluate(() => nativeStats);
  assert.equal(report.nativeStats.decodeerrors, 0);
  assert.equal(report.errors.length, 0);
  const summary = values => {
    const sorted = [...values].sort((a,b) => a-b);
    return {median: (sorted[9]+sorted[10])/2, p95: sorted[Math.ceil(sorted.length*.95)-1], min: sorted[0], max: sorted.at(-1)};
  };
  report.phasesMs = Object.fromEntries(Object.keys(report.trials[0].phasesMs).map(key => [key, summary(report.trials.map(t => t.phasesMs[key]))]));
  report.passed = true;
} catch (error) {
  report.passed = false; report.errors.push(error.stack); process.exitCode = 1;
} finally {
  if (page && !page.isClosed()) {
    try {report.trace = await page.evaluate(() => window.latencyTrace);}
    catch (error) {report.errors.push(`Trace collection failed: ${error.message}`); report.passed = false; process.exitCode = 1;}
  }
  try {await browser?.close();} catch (error) {report.errors.push(error.stack); report.passed = false; process.exitCode = 1;}
  report.finished = new Date().toISOString();
  const output = `${directory}latency-profile-${Date.now()}.json`;
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({...report, output}, null, 2));
}
