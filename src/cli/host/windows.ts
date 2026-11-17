import { run } from './common.js';

/** Root of the MSYS2 install that `screen-relay install` sets up on Windows. */
export const MSYS2_ROOT = 'C:\\msys64';

/** MSYS2's bash, which runs build commands in its UCRT64 environment. */
export const MSYS2_SHELL = `${MSYS2_ROOT}\\usr\\bin\\bash.exe`;

/** The environment that runs relay-engine, with MSYS2's UCRT64 libraries first on PATH on Windows. Other platforms get the environment unchanged. */
export function engineEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return env;
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...env, [key]: [`${MSYS2_ROOT}\\ucrt64\\bin`, env[key]].filter(Boolean).join(';') };
}

/** The Windows session id of this process, or null when PowerShell cannot report it. */
export function windowsSessionId(): number | null {
  const result = run(['powershell', '-NoProfile', '-NonInteractive', '-Command', '[System.Diagnostics.Process]::GetCurrentProcess().SessionId'], { timeout: 15000 });
  const text = result.stdout?.trim() ?? '';
  return result.status === 0 && /^\d+$/.test(text) ? Number(text) : null;
}

/** The creation time of a Windows process as a FILETIME string, or null when it cannot be read. */
export function windowsStartTime(pid: number): string | null {
  const result = run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`], { timeout: 15000 });
  const text = result.stdout?.trim() ?? '';
  return result.status === 0 && /^\d+$/.test(text) ? text : null;
}

/** Ends a process and every process it started. A failure is ignored because the process may already be gone. */
export function killTree(pid: number): void {
  run(['taskkill', '/PID', String(pid), '/T', '/F'], { timeout: 10000 });
}
