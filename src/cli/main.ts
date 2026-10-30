#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { cmdClick, cmdInput, cmdKey, cmdMove, cmdScreenshot, cmdScroll, cmdType } from './client.js';
import { cmdDoctor } from './host/doctor.js';
import { cmdDown, cmdLogs, cmdRun, cmdStatus, cmdUp, COMPONENTS } from './host/session_commands.js';
import { Failure, formatUsage, printFailure, writeText } from './output.js';

type Args = Record<string, unknown> & { command: string; json: boolean; name: string };
type Command = { help: string; options?: Record<string, { type: 'boolean' | 'string'; short?: string }>; positionals?: string[]; minimumPositionals?: number; run: (args: Args) => number | Promise<number> };

class UsageFailure extends Failure {}

const common = { json: { type: 'boolean' as const }, name: { type: 'string' as const } };
const client = { ...common, url: { type: 'string' as const }, 'token-file': { type: 'string' as const }, timeout: { type: 'string' as const } };

export const commands: Record<string, Command> = {
  up: { help: 'start a display, desktop and engine (foreground; -d for background)', options: { ...common, detach: { type: 'boolean', short: 'd' }, config: { type: 'string' }, port: { type: 'string' }, desktop: { type: 'string' }, display: { type: 'string' }, public: { type: 'string' }, 'tls-cert': { type: 'string' }, 'tls-key': { type: 'string' }, bind: { type: 'string' }, timeout: { type: 'string' } }, run: cmdUp },
  down: { help: 'stop a session (safe to repeat)', options: common, run: cmdDown },
  status: { help: 'show a local session, or a remote engine with --url', options: { ...client, 'show-token': { type: 'boolean' } }, run: cmdStatus },
  logs: { help: 'print component logs', options: { ...common, follow: { type: 'boolean', short: 'f' } }, positionals: ['component'], run: cmdLogs },
  doctor: { help: 'check this machine and print fix commands', options: { json: { type: 'boolean' } }, run: cmdDoctor },
  run: { help: 'start an app on the session desktop (output: logs apps)', options: { ...common, restart: { type: 'boolean' } }, positionals: ['app'], run: cmdRun },
  screenshot: { help: 'save a PNG of the screen', options: client, positionals: ['file'], run: cmdScreenshot },
  click: { help: 'click at X Y', options: { ...client, button: { type: 'string' } }, positionals: ['x', 'y'], minimumPositionals: 2, run: cmdClick },
  move: { help: 'move the pointer to X Y', options: client, positionals: ['x', 'y'], minimumPositionals: 2, run: cmdMove },
  scroll: { help: 'scroll at X Y by wheel notches', options: { ...client, dx: { type: 'string' }, dy: { type: 'string' } }, positionals: ['x', 'y'], minimumPositionals: 2, run: cmdScroll },
  key: { help: 'press key combos such as ctrl+l or Enter', options: client, positionals: ['combos'], minimumPositionals: 1, run: cmdKey },
  type: { help: 'type text', options: { ...client, stdin: { type: 'boolean' } }, positionals: ['text'], run: cmdType },
  input: { help: 'send a JSON array of SDK input events', options: { ...client, stdin: { type: 'boolean' } }, positionals: ['events'], run: cmdInput },
};

function invalid(message: string, command?: string): Failure {
  return new Failure('invalid_input', message, `Run \`relay${command ? ` ${command}` : ''} --help\`.`);
}

function normalizeNumber(args: Args, key: string, integer = false): void {
  if (args[key] === undefined) return;
  const number = Number(args[key]);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) throw new UsageFailure('invalid_input', `Invalid ${key}: ${String(args[key])}`, `Run \`relay --help\`.`);
  args[key] = number;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const jsonMode = argv.includes('--json');
  const [name, ...rest] = argv;
  if (!name || name === '-h' || name === '--help') {
    writeText(formatUsage(commands));
    return name ? 0 : 2;
  }
  const command = commands[name];
  if (!command) {
    printFailure(invalid(`invalid choice: '${name}'`), jsonMode);
    return 2;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    writeText(formatUsage(commands, name));
    return 0;
  }
  try {
    const parsed = parseArgs({ args: rest, options: command.options ?? {}, allowPositionals: true, strict: true, tokens: true });
    const args = { ...parsed.values, command: name, json: Boolean(parsed.values.json), name: String(parsed.values.name ?? 'default') } as Args;
    if (parsed.positionals.length < (command.minimumPositionals ?? 0)) throw new UsageFailure('invalid_input', `missing required argument${(command.minimumPositionals ?? 0) > 1 ? 's' : ''}`, `Run \`relay ${name} --help\`.`);
    if (['up', 'down', 'status', 'logs', 'run'].includes(name) && !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/.test(args.name)) {
      throw new Failure('invalid_input', `Invalid session name "${args.name}"`, 'Use letters, digits, ".", "_" or "-".');
    }
    for (const [index, positional] of parsed.positionals.entries()) {
      const key = name === 'run' ? 'app' : name === 'key' ? 'combos' : command.positionals?.[index];
      if (!key) throw invalid(`unexpected argument: ${positional}`, name);
      const current = args[key];
      args[key] = current === undefined ? positional : Array.isArray(current) ? [...current, positional] : [current, positional];
    }
    if (name === 'run' && typeof args.app === 'string') args.app = [args.app];
    if (name === 'logs' && args.component !== undefined && !COMPONENTS.includes(String(args.component))) throw new UsageFailure('invalid_input', `invalid choice: '${args.component}'`, `Run \`relay logs --help\`.`);
    if (name === 'click' && !['left', 'middle', 'right'].includes(String(args.button ?? 'left'))) throw new UsageFailure('invalid_input', `invalid choice: '${String(args.button)}'`, `Run \`relay click --help\`.`);
    if (name === 'click') args.button ??= 'left';
    if (name === 'type' && Array.isArray(args.text)) throw new UsageFailure('invalid_input', 'too many arguments', `Run \`relay type --help\`.`);
    if (name === 'input' && Array.isArray(args.events)) throw new UsageFailure('invalid_input', 'too many arguments', `Run \`relay input --help\`.`);
    if (name === 'screenshot' && Array.isArray(args.file)) throw new UsageFailure('invalid_input', 'too many arguments', `Run \`relay screenshot --help\`.`);
    if (name === 'screenshot' && args.file === undefined) args.file = 'screen.png';
    for (const key of ['port', 'timeout', 'x', 'y', 'dx', 'dy']) normalizeNumber(args, key, key === 'port' || key === 'dx' || key === 'dy');
    if (args.timeout === undefined && command.options?.timeout && name !== 'up') args.timeout = 10;
    if (name === 'up' && args.timeout === undefined) args.timeout = 30;
    if (name === 'click' && args.button === undefined) args.button = 'left';
    if (name === 'scroll') { args.dx ??= 0; args.dy ??= 0; }
    if (args.url === undefined && process.env.RELAY_URL) args.url = process.env.RELAY_URL;
    if (args['token-file'] === undefined && process.env.RELAY_TOKEN_FILE) args['token-file'] = process.env.RELAY_TOKEN_FILE;
    return (await command.run(args)) || 0;
  } catch (error) {
    if (error instanceof UsageFailure) {
      printFailure(error, jsonMode || argv.includes('--json'));
      return 2;
    }
    if (error instanceof Failure) {
      printFailure(error, jsonMode || argv.includes('--json'));
      return 1;
    }
    if (error instanceof Error && (error.name === 'TypeError' || error.message.includes('Unknown option') || error.message.includes('option requires'))) {
      printFailure(invalid(error.message, name), jsonMode);
      return 2;
    }
    if (error instanceof Error && error.name === 'AbortError') return 130;
    printFailure(new Failure('internal', error instanceof Error ? error.message : String(error)), jsonMode);
    return 1;
  }
}

main().then((code) => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
