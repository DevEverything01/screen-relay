import { spawn } from 'node:child_process';
import { closeSync, fstatSync, openSync, readFileSync, readdirSync, readSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Failure } from '../output.js';

export type ProcessIdentity = { pid: number; start: string | null };
export type SessionData = Record<string, any>;

const LOCK_SCRIPT = [
  'import fcntl,os,sys,time',
  'handle=open(sys.argv[1],"a")',
  'try: fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)',
  'except BlockingIOError: print("busy",flush=True); sys.exit(1)',
  'print("locked",flush=True)',
  'parent=os.getppid()',
  'while os.getppid()==parent and os.path.exists(f"/proc/{parent}"): time.sleep(0.1)',
].join('\n');

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

export async function sweep(directory: string): Promise<void> {
  const marker = Buffer.from(`RELAY_SESSION=${directory}`);
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
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
        if (environment.includes(marker)) {
          process.kill(pid, signal);
          found.push(pid);
        }
      } catch {}
    }
    if (!found.length) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function reap(directory: string, session: SessionData | null): Promise<void> {
  for (const record of Object.values(session?.components ?? {}) as unknown[]) {
    if (alive(record)) {
      try {
        process.kill(-Number((record as ProcessIdentity).pid), 'SIGKILL');
      } catch {}
    }
  }
  await sweep(directory);
}

export async function lock(name: string, directory: string): Promise<{ close(): Promise<void> }> {
  const file = join(directory, 'lock');
  const child = spawn('python3', ['-c', LOCK_SCRIPT, file], { stdio: ['ignore', 'pipe', 'ignore'] });
  const response = await new Promise<{ line: string; error?: Error }>((resolve) => {
    child.stdout?.once('data', (data: Buffer) => resolve({ line: data.toString().trim() }));
    child.once('error', (error) => resolve({ line: '', error }));
    child.once('exit', () => resolve({ line: '' }));
  });
  if (response.error) throw new Failure('missing_dependency', 'python3 is required for session locking', 'Install python3 and run `relay doctor`.');
  if (response.line !== 'locked') {
    throw new Failure('already_running', `Session "${name}" is already running`,
      'Stop it with `relay down --name ' + name + '` or pick another --name.');
  }
  return {
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    },
  };
}
