import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const image = process.env.RELAY_E2E_IMAGE ?? 'relay-e2e';
const container = `relay-e2e-${process.pid}`;
const work = mkdtempSync(join(tmpdir(), 'relay-e2e-'));
let browser = null;
let context = null;

function run(file, args, options = {}) {
  return execFileSync(file, args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...options });
}
function text(value) {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}
function docker(args, options = {}) {
  return run('docker', args, options);
}
function execIn(args, options = {}) {
  return run('docker', ['exec', container, ...args], options);
}
function execInRoot(args, options = {}) {
  return run('docker', ['exec', '-u', 'root', container, ...args], options);
}
async function poll(read, accept, timeout, message) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (accept(last)) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  assert.fail(`${message} (last value: ${typeof last === 'string' ? last : JSON.stringify(last)})`);
}
function appsLog() {
  try {
    return text(execIn(['relay', 'logs', 'apps'])).trim().split('\n').slice(-20).join('\n');
  } catch {
    return 'unavailable';
  }
}

try {
  if (!process.env.RELAY_E2E_IMAGE) {
    console.log(`building ${image}`);
    docker(['build', '-t', image, '.'], { stdio: 'inherit' });
  }

  const config = join(work, 'config.yaml');
  writeFileSync(config, 'display:\n  resolution: 1920x1080\n');

  docker(['run', '-d', '--name', container, '-p', '127.0.0.1::8080', '-e', 'LANG=C.UTF-8',
    '-v', `${config}:/relay-config.yaml:ro`, '-e', 'RELAY_CONFIG=/relay-config.yaml', image], { stdio: 'inherit' });
  const published = text(docker(['port', container, '8080'])).trim().split('\n')[0];
  const port = Number(published.slice(published.lastIndexOf(':') + 1));
  assert.ok(Number.isInteger(port) && port > 0, `could not read the published port from "${published}"`);
  console.log(`container ${container} on port ${port}`);

  execInRoot(['sh', '-c', 'apt-get update -qq && env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends xdotool'],
    { stdio: ['ignore', 'ignore', 'inherit'] });

  const session = await poll(
    () => JSON.parse(text(execIn(['relay', 'status', '--show-token', '--json']))).session,
    (value) => value?.running === true && /^[0-9a-f]{64}$/.test(value?.token ?? ''),
    120000,
    'the session did not become ready with a token',
  );
  assert.equal(session.resolution, '1920x1080', `the session resolution is ${session.resolution}, expected 1920x1080`);
  assert.ok(session.display && session.xauthority, `status has no display or X authority: ${JSON.stringify(session)}`);
  console.log(`session ready on ${session.display}, ${session.resolution}`);
  const xdotool = (args) => text(run('docker', ['exec', '-e', `DISPLAY=${session.display}`, '-e', `XAUTHORITY=${session.xauthority}`,
    container, 'xdotool', ...args]));

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/#token=${session.token}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => window.nativeStats?.drawn > 0, null, { timeout: 30000 });
  } catch {
    const statusText = await page.locator('#status').textContent().catch(() => null);
    assert.fail(`the viewer drew no frames: ${statusText ?? 'no status text'}`);
  }
  const view = await page.evaluate(() => ({
    drawn: window.nativeStats.drawn,
    decodeerrors: window.nativeStats.decodeerrors,
    width: document.querySelector('#screen').width,
    height: document.querySelector('#screen').height,
  }));
  assert.ok(view.drawn > 0, `the viewer drew ${view.drawn} frames`);
  assert.equal(view.decodeerrors, 0, `the viewer reported ${view.decodeerrors} decode errors`);
  assert.equal(view.width, 1920, `the canvas is ${view.width} pixels wide, expected 1920`);
  assert.equal(view.height, 1080, `the canvas is ${view.height} pixels high, expected 1080`);
  console.log(`viewer live: ${view.drawn} frames drawn, ${view.width}x${view.height}`);

  const box = await page.locator('#screen').boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, 'the viewer canvas has no layout box');
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
  await poll(
    () => {
      const out = xdotool(['getmouselocation']);
      const match = /x:(\d+) y:(\d+)/.exec(out);
      if (!match) throw new Error(`unexpected xdotool output: ${out}`);
      return { x: Number(match[1]), y: Number(match[2]) };
    },
    (point) => point.x === 480 && point.y === 810,
    10000,
    'a click at 25% x 75% of the canvas did not land at X 480, Y 810',
  );
  console.log('click landed at 480,810');

  async function openTerminal(command) {
    text(execIn(['relay', 'run', '--json', '--', 'xfce4-terminal', '-x', 'sh', '-c', command]));
    let id;
    try {
      id = await poll(
        () => text(xdotool(['search', '--onlyvisible', '--class', '[Xx]fce4-[Tt]erminal'])).trim().split(/\s+/).filter(Boolean).at(-1),
        Boolean,
        30000,
        `xfce4-terminal did not open for: ${command}`,
      );
    } catch (error) {
      assert.fail(`${error.message}\napps log:\n${appsLog()}`);
    }
    xdotool(['windowmove', id, '0', '0']);
    xdotool(['windowsize', id, '1900', '1000']);
    xdotool(['windowactivate', '--sync', id]);
    await sleep(500);
    return id;
  }
  async function clickCenter() {
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await sleep(300);
  }
  async function waitForFile(path) {
    await poll(() => { execIn(['test', '-e', path]); return true; }, Boolean, 10000, `${path} did not appear`);
  }

  const typedWindow = await openTerminal('cat > /tmp/out');
  await waitForFile('/tmp/out');
  await clickCenter();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await poll(
    () => text(execIn(['cat', '/tmp/out'])),
    (value) => value.includes('hello'),
    10000,
    'the viewer did not type "hello" into the terminal',
  );
  console.log('viewer typed hello');

  await page.locator('#toolbar-toggle').click();
  await page.locator('[data-action="keys"]').click();
  if (await page.locator('#meta-ctrl').getAttribute('aria-pressed') !== 'true') await page.locator('#meta-ctrl').click();
  assert.equal(await page.locator('#meta-ctrl').getAttribute('aria-pressed'), 'true', 'the "Use ⌘ as Ctrl" setting is off');

  const ctrlWindow = await openTerminal('stty -icanon -echo; cat -v > /tmp/ctrl');
  await waitForFile('/tmp/ctrl');
  await clickCenter();
  await page.keyboard.press('Meta+a');
  await poll(
    () => text(execIn(['cat', '/tmp/ctrl'])),
    (value) => value.includes('^A'),
    10000,
    'Meta+a with "Use ⌘ as Ctrl" on did not arrive as Ctrl+A',
  );
  console.log('Meta+a arrived as Ctrl+A');

  xdotool(['windowclose', ctrlWindow]);
  xdotool(['windowactivate', '--sync', typedWindow]);
  await page.goto('about:blank');
  await sleep(1000);

  text(execIn(['relay', 'type', 'héllo €']));
  text(execIn(['relay', 'key', 'Enter']));
  await poll(
    () => execIn(['cat', '/tmp/out'], { encoding: null }),
    (value) => value.includes(Buffer.from('héllo €')),
    10000,
    'relay type from the CLI did not deliver the UTF-8 text "héllo €"',
  );
  console.log('CLI typed héllo €');
  console.log('PASS');
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  try {
    docker(['rm', '-f', container], { stdio: 'ignore' });
  } catch {}
  rmSync(work, { recursive: true, force: true });
}
