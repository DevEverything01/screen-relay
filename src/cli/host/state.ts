import { closeSync, fstatSync, openSync, readFileSync, readdirSync, readSync, renameSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Failure } from '../output.js';

export type ProcessIdentity = { pid: number; start: string | null };
export type SessionData = Record<string, any>;

export function stateDir(name: string): string {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(name)) {
    throw new Failure('invalid_input', `Invalid session name "${name}"`, 'Use letters, digits, ".", "_" or "-".');
  }
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'relay', name);
}

export function readSession(name: string): SessionData | null {
  try {
    return JSON.parse(readFileSync(join(stateDir(name), 'session.json'), 'utf8')) as SessionData;
  } catch {
    return null;
  }
}

export function writeSession(directory: string, data: SessionData): void {
  const temporary = join(directory, 'session.json.tmp');
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temporary, join(directory, 'session.json'));
}

export function tail(path: string, lines = 20): string {
  try {
    const descriptor = openSync(path, 'r');
    try {
      const size = fstatSync(descriptor).size;
      const buffer = Buffer.alloc(Math.min(size, 65536));
      readSync(descriptor, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      return buffer.toString().split(/\r?\n/).slice(-lines).join('\n');
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return '';
  }
}

export function startTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/);
    return fields[0] === 'Z' ? null : fields[19] ?? null;
  } catch {
    return null;
  }
}

export function alive(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const value = record as Partial<ProcessIdentity>;
  return typeof value.pid === 'number' && value.start !== undefined && startTime(value.pid) === value.start;
}

export function identity(pid: number): ProcessIdentity {
  return { pid, start: startTime(pid) };
}

export async function sweep(directory: string, signal?: AbortSignal): Promise<void> {
  const marker = Buffer.from(`RELAY_SESSION=${directory}`);
  for (const killSignal of ['SIGTERM', 'SIGKILL'] as const) {
    signal?.throwIfAborted();
    const found: number[] = [];
    let entries: string[];
    try {
      entries = readdirSync('/proc');
    } catch {
      return;
    }
    for (const entry of entries) {
      const pid = Number(entry);
      if (!Number.isInteger(pid) || pid === process.pid) continue;
      try {
        const environment = readFileSync(`/proc/${entry}/environ`);
        if (environment.toString().split('\0').some((entry) => entry === marker.toString())) {
          process.kill(pid, killSignal);
          found.push(pid);
        }
      } catch {}
    }
    if (!found.length) return;
    await delay(500, undefined, { signal });
  }
}

export async function reap(directory: string, session: SessionData | null, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  for (const record of Object.values(session?.components ?? {}) as unknown[]) {
    if (alive(record)) {
      try {
        process.kill(-Number((record as ProcessIdentity).pid), 'SIGKILL');
      } catch {}
    }
  }
  await sweep(directory, signal);
}

/** Holds the kernel session lock until close. */
export async function lock(name: string, directory: string): Promise<{ close(): Promise<void> }> {
  const file = join(directory, 'lock');
  const busy = () => new Failure('already_running', `Session "${name}" is already running`,
    'Stop it with `relay down --name ' + name + '` or pick another --name.');
  const child = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', file, 'sh', '-c', 'printf .; cat'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const acquired = new Promise<void>((resolve, reject) => {
    let ready = false;
    child.stdout.on('data', () => {
      if (!ready) { ready = true; resolve(); }
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(code === 75 ? busy() : new Failure('internal', `Cannot lock ${file}`, 'Check the state directory permissions with `relay doctor`.')));
  });
  try {
    await acquired;
  } catch (error) {
    child.stdin.destroy();
    if (error instanceof Failure) throw error;
    throw new Failure('internal', `Cannot lock ${file}: ${String(error)}`, 'Check the state directory permissions with `relay doctor`.');
  }
  return {
    close() {
      child.stdin.end();
      return new Promise((resolve) => child.once('exit', () => resolve()));
    },
  };
}
