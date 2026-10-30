export type FailurePayload = {
  code: string;
  message: string;
  hint?: string;
  [key: string]: unknown;
};

export class Failure extends Error {
  readonly code: string;
  readonly hint: string;
  readonly extra: Record<string, unknown>;

  constructor(code: string, message: string, hint = '', extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'Failure';
    this.code = code;
    this.hint = hint;
    this.extra = extra;
  }

  payload(): FailurePayload {
    return { code: this.code, message: this.message, hint: this.hint, ...this.extra };
  }
}

export function emit(args: { json?: boolean }, data: unknown, text: string): void {
  process.stdout.write(`${args.json ? JSON.stringify(data) : text}\n`);
}

export function writeText(text: string): void {
  process.stdout.write(text);
}

export function printWarning(text: string): void {
  process.stderr.write(`${text}\n`);
}

export function formatUsage(commands: Record<string, { help: string; options?: Record<string, unknown> }>, command?: string): string {
  if (command && commands[command]) {
    const entry = commands[command];
    const common = ['json', ...(entry.options?.name ? ['name'] : [])];
    return `usage: relay ${command} [options]\n\n${entry.help}\n\nOptions: ${common.map((key) => `--${key}${key === 'name' ? ' NAME' : ''}`).join(' ')}${Object.keys(entry.options ?? {}).filter((key) => !common.includes(key)).map((key) => ` --${key}`).join('')}\n`;
  }
  return `usage: relay COMMAND [options]\n\nStart a streamed Linux desktop and drive it from anywhere.\n\nCommands:\n${Object.entries(commands).map(([name, entry]) => `  ${name.padEnd(12)} ${entry.help}`).join('\n')}\n\nCoordinates are fractions of the screen from 0 to 1. Run relay COMMAND --help for details.\n`;
}

export function formatReady(info: Record<string, any>, args: Record<string, any>, background = false): string {
  const lines = [`relay "${info.name}" is ready`, `  url:     ${info.url}`, `  viewer:  ${info.viewer}`];
  if (info.token) lines.push(`  token:   ${info.token}  (shown once; status --show-token prints it again)`);
  lines.push(`  display: ${info.display}`, `  logs:    ${info.logs}`);
  if (info.public) {
    if (!args['tls-cert']) lines.push(`Expects a TLS proxy in front: forward ${info.url} to http://<this host>:${info.port}.`);
  } else if (info.bind !== '127.0.0.1') {
    lines.push(`Listening on ${info.bind}:${info.port}; reach it through a loopback port publish or SSH tunnel.`);
  }
  lines.push(background ? `Running in the background; stop with relay down --name ${info.name}.` : 'Stop with Ctrl-C or relay down.');
  return lines.join('\n');
}

export function formatStatus(name: string, session: Record<string, any>): string {
  const lines = [`${name}: ${session.state}`];
  for (const key of ['url', 'display', 'resolution', 'fps', 'logs', 'token']) {
    if (session[key]) lines.push(`  ${`${key}:`.padEnd(12)}${session[key]}`);
  }
  if (session.error) {
    lines.push(`  error:   ${session.error.message}`, `  hint:    ${session.error.hint ?? ''}`);
    if (session.error.log) lines.push(`  last log lines:\n${String(session.error.log).split(/\r?\n/).map((line: string) => `    ${line}`).join('\n')}`);
  }
  return lines.join('\n');
}

export function formatStopped(name: string, stopped: boolean): string {
  return stopped ? `Stopped "${name}"` : `"${name}" was not running`;
}

export function formatStarted(command: string, pid: number, display: string, log: string): string {
  return `Started ${command} (pid ${pid}) on ${display}; output in ${log}`;
}

export function formatDoctor(checks: Array<{ status: string; name: string; detail: string; fix: string }>): string {
  const lines: string[] = [];
  for (const item of checks) {
    lines.push(`${item.status.padEnd(5)} ${item.name.padEnd(17)} ${item.detail}`);
    if (item.fix) lines.push(`${''.padEnd(23)}fix: ${item.fix}`);
  }
  return lines.join('\n');
}

export function printFailure(failure: Failure, jsonMode: boolean): void {
  if (jsonMode) {
    process.stderr.write(`${JSON.stringify({ error: failure.payload() })}\n`);
    return;
  }
  process.stderr.write(`error: ${failure.message}\n`);
  if (failure.hint) process.stderr.write(`hint: ${failure.hint}\n`);
  if (failure.extra.log) {
    process.stderr.write(`last lines of the ${String(failure.extra.component ?? '')} log:\n${String(failure.extra.log)}\n`);
  }
}
