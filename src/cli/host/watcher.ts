import type { Readable } from 'node:stream';
import { Failure } from '../output.js';
import { LAUNCHER_DIR, spawnCleared } from './common.js';

const WATCHER_SCRIPT = `
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
let readyFd = Number(process.argv[1]);
const command = process.argv.slice(2);
const caps = 'import ctypes,os,sys; ctypes.CDLL(None).prctl(47,4,0,0,0); os.execvp(sys.argv[0],sys.argv)';
const stopping = { value: false };
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { stopping.value = true; });
function startTime(pid) {
  try {
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\\s+/);
    return fields[0] === 'Z' ? null : fields[19] ?? null;
  } catch { return null; }
}
function alive(record) { return Boolean(record) && startTime(record.pid) === record.start; }
function sessionSupervisor() {
  try { return JSON.parse(fs.readFileSync(process.env.RELAY_SESSION + '/session.json', 'utf8')).supervisor; }
  catch { return null; }
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sendReady(data) {
  if (!Number.isInteger(readyFd) || readyFd < 0) return;
  fs.writeSync(readyFd, JSON.stringify(data) + '\\n');
  fs.closeSync(readyFd);
  readyFd = -1;
}
async function main() {
  let supervisor = sessionSupervisor();
  let processChild = null;
  let delay = 1000;
  try {
    while (!stopping.value && alive(supervisor)) {
      const started = Date.now();
      try {
        processChild = spawn('setpriv', ['--inh-caps=-all', '--ambient-caps=-all', ...command], {
          cwd: os.homedir(), env: process.env, detached: true,
          stdio: ['ignore', 'inherit', 'inherit']
        });
        await new Promise((resolve, reject) => {
          processChild.once('spawn', resolve);
          processChild.once('error', reject);
        });
      } catch (error) {
        if (readyFd >= 0) {
          sendReady({ error: String(error) });
          return 1;
        }
        console.log('relay: cannot restart ' + command[0] + ': ' + String(error));
      }
      if (processChild && processChild.pid) {
        if (readyFd >= 0) sendReady({ pid: processChild.pid });
        else console.log('relay: restarted ' + command[0] + ' (pid ' + processChild.pid + ')');
        while (!stopping.value && alive(supervisor) && processChild.exitCode === null && processChild.signalCode === null) await sleep(100);
        if (!stopping.value && alive(supervisor) && Date.now() - started >= 60000) delay = 1000;
        if (!stopping.value && alive(supervisor)) console.log('relay: ' + command[0] + ' exited with code ' + processChild.exitCode + '; restarting in ' + delay / 1000 + 's');
      }
      if (stopping.value || !alive(supervisor)) break;
      await sleep(delay);
      delay = Math.min(delay * 2, 30000);
      supervisor = sessionSupervisor();
    }
  } finally {
    if (readyFd >= 0) fs.closeSync(readyFd);
    if (processChild && processChild.exitCode === null && processChild.signalCode === null && processChild.pid) {
      try { process.kill(-processChild.pid, 'SIGTERM'); } catch {}
      await sleep(200);
      try { process.kill(-processChild.pid, 'SIGKILL'); } catch {}
      await new Promise(resolve => processChild.once('exit', resolve));
    }
  }
  return 0;
}
main().then(code => { process.exitCode = code; });
`;

export async function startWatcher(command: string[], env: NodeJS.ProcessEnv, logFd: number, signal?: AbortSignal): Promise<number> {
  const watcher = spawnCleared([
    process.execPath,
    '--input-type=module',
    '-e',
    WATCHER_SCRIPT,
    '3',
    ...command,
  ], {
    cwd: LAUNCHER_DIR,
    env,
    detached: true,
    signal,
    stdio: ['ignore', logFd, logFd, 'pipe'],
  });
  const stream = watcher.stdio[3] as Readable;
  let exited = false;
  watcher.once('exit', () => { exited = true; });
  const result = await new Promise<string>((resolve) => {
    let data = '';
    const timeout = setTimeout(() => resolve(''), 10000);
    stream.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.includes('\n')) {
        clearTimeout(timeout);
        resolve(data.split(/\r?\n/)[0]);
      }
    });
    watcher.once('exit', () => {
      clearTimeout(timeout);
      resolve(data.split(/\r?\n/)[0] ?? '');
    });
    watcher.once('error', () => {
      clearTimeout(timeout);
      resolve('');
    });
  });
  stream.destroy();
  if (!result) {
    watcher.kill('SIGTERM');
    if (!exited) await new Promise<void>((resolve) => watcher.once('exit', () => resolve()));
    throw new Failure('timeout', 'App watcher did not report startup', 'Read `relay logs apps`.');
  }
  let response: { pid?: number; error?: string };
  try {
    response = JSON.parse(result) as { pid?: number; error?: string };
  } catch {
    throw new Failure('spawn_failed', 'App watcher exited before starting the app', 'Read `relay logs apps`.');
  }
  if (response.error) throw new Failure('spawn_failed', `Cannot start ${command[0]}: ${response.error}`);
  if (typeof response.pid !== 'number') throw new Failure('spawn_failed', 'App watcher exited before starting the app', 'Read `relay logs apps`.');
  watcher.unref();
  return response.pid;
}
