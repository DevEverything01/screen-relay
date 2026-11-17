import { run } from './common.js';

/** Root of the MSYS2 install that `screen-relay install` sets up on Windows. */
export const MSYS2_ROOT = 'C:\\msys64';

/** The Windows session id of this process, or null when PowerShell cannot report it. */
export function windowsSessionId(): number | null {
  const result = run(['powershell', '-NoProfile', '-NonInteractive', '-Command', '[System.Diagnostics.Process]::GetCurrentProcess().SessionId'], { timeout: 5000 });
  const text = result.stdout?.trim() ?? '';
  return result.status === 0 && /^\d+$/.test(text) ? Number(text) : null;
}
