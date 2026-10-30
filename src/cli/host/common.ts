import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Failure } from '../output.js';

export const DEFAULT_PORT = 8080;
export const COMPONENTS: string[] = ['display', 'dbus', 'desktop', 'engine', 'apps'];
export const LAUNCHER_DIR = dirname(fileURLToPath(import.meta.url));

export type HostArgs = Record<string, unknown> & { command: string; json: boolean; name: string };

export function isLinux(): boolean {
  return process.platform.startsWith('linux');
}

export function requireLinux(): void {
  if (!isLinux()) {
    throw new Failure('unsupported_platform', 'Host commands run on Linux only',
      'Run this on the Linux machine; client commands (status, screenshot, click, ...) work anywhere with --url.');
  }
}

export function which(program: string): string | undefined {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory || '.', program);
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {}
  }
  return undefined;
}

/** Prefixes a command so it runs without inheritable or ambient capabilities, as delivered apps expect. */
export function clearedCommand(command: string[]): [string, ...string[]] {
  return ['setpriv', '--inh-caps=-all', '--ambient-caps=-all', ...command];
}

export function spawnCleared(command: string[], options: SpawnOptions = {}): ChildProcess {
  const [program, ...args] = clearedCommand(command);
  return spawn(program, args, options);
}

export function run(command: string[], options: SpawnOptions = {}) {
  return spawnSync(command[0], command.slice(1), { encoding: 'utf8', ...options });
}
