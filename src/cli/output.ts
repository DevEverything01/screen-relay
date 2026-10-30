import { outputMode, type OutputOptions } from './mode.js';
import { nextStep, receipt, row, sessionCommand } from './format.js';
import { theme } from './theme.js';
import { ERROR_REASONS, RelayError, type ErrorOptions, type ErrorReason } from '../protocol/errors.js';

export { count, duration, nextStep, receipt, row, sessionCommand, size } from './format.js';

export type FailurePayload = {
  code: string;
  message: string;
  hint?: string;
  [key: string]: unknown;
};

export class Failure extends RelayError {
  readonly hint: string;
  readonly extra: Record<string, unknown>;

  constructor(code: string, message: string, hint = '', extra: Record<string, unknown> = {}, options: ErrorOptions = {}) {
    const errorClass = ERROR_REASONS[code as ErrorReason]?.class;
    super(code, message, {
      status: errorClass === 'usage' || errorClass === 'missing_input' ? 'action_required' : 'error',
      ...options, hint, data: extra,
    });
    this.name = 'Failure';
    this.hint = hint;
    this.extra = extra;
  }

  payload(): FailurePayload {
    return { code: this.reason, message: this.message, hint: this.hint, ...this.extra };
  }
}

export function emit(args: OutputOptions, data: unknown, text: string, mutation?: { identifier?: string }): void {
  if (args.json) {
    process.stdout.write(`${JSON.stringify(data, null, outputMode(args).pretty ? 2 : undefined)}\n`);
    return;
  }
  const stream = mutation ? process.stderr : process.stdout;
  if (text) stream.write(`${text}\n`);
  if (mutation?.identifier !== undefined && !outputMode(args, process.stdout).tty) process.stdout.write(`${mutation.identifier}\n`);
}

export function writeText(text: string): void {
  process.stdout.write(text);
}

export function printWarning(text: string, args: OutputOptions = {}): void {
  if (!args.json) process.stderr.write(`${theme(args).warning} ${text}\n`);
}

export function printNext(args: OutputOptions, benefit: string, command: string): void {
  if (!args.json) process.stderr.write(`${nextStep(benefit, command, args)}\n`);
}

export function formatReady(info: Record<string, any>, args: Record<string, any>, background = false): string {
  const lines = [receipt('Started', info.name, args), row('Viewer', info.viewer), row('Display', info.display)];
  if (info.resolution) lines.push(row('Resolution', `${info.resolution}${info.fps ? ` at ${info.fps} fps` : ''}`));
  lines.push(row('Logs', info.logs));
  if (info.public) {
    if (!args['tls-cert']) lines.push(row('TLS proxy', `Forward ${info.url} to http://<HOST>:${info.port}`));
  } else if (info.bind !== '127.0.0.1') {
    lines.push(row('Listening', `${info.bind}:${info.port}; use a loopback port publish or SSH tunnel`));
  }
  lines.push(nextStep(background ? 'Stop it' : 'Stop it (or press Ctrl-C)', sessionCommand('down', String(info.name)), args));
  return lines.join('\n');
}

export function formatStatus(name: string, session: Record<string, any>): string {
  const lines = [row('Session', name), row('State', session.state)];
  for (const key of ['url', 'display', 'resolution', 'fps', 'logs', 'token']) {
    if (session[key] !== undefined) lines.push(row(key[0].toUpperCase() + key.slice(1), session[key]));
  }
  if (session.error) {
    lines.push(row('Error', session.error.message));
  }
  if (session.health) lines.push(row('Health', session.health.message));
  return lines.join('\n');
}

export function formatStopped(name: string, stopped: boolean, args: OutputOptions = {}): string {
  return receipt(stopped ? 'Stopped' : 'Unchanged', name, args);
}

export function formatStarted(command: string, pid: number, display: string, log: string, args: OutputOptions = {}): string {
  return [receipt('Started', command, args), row('PID', pid), row('Display', display), row('Logs', log)].join('\n');
}

export function formatDoctor(checks: Array<{ status: string; name: string; detail: string; fix: string }>): string {
  const lines: string[] = [];
  for (const item of checks) {
    lines.push(row('Check', `${item.name}: ${item.status}; ${item.detail}`));
    if (item.fix) lines.push(row('Fix', item.fix));
  }
  return lines.join('\n');
}

export function printFailure(failure: RelayError, jsonMode: boolean, args: OutputOptions = {}): void {
  const data = failure.data ?? {};
  const command = failure.hint?.match(/`([^`]+)`/)?.[1];
  const next = failure.next ?? (command ? [{ command: command.split(' ')[0], argv: command.split(' ').slice(1) }] : undefined);
  if (jsonMode) {
    process.stderr.write(`${JSON.stringify({ status: failure.status, reason: failure.reason, message: failure.message, ...(next ? { next } : {}), ...(Object.keys(data).length ? { data } : {}) })}\n`);
    return;
  }
  const lines = [`${theme(args).error} ${failure.message.replace(/[\r\n]+/g, ' ')}`];
  for (const key of ['component', 'logs', 'applied']) if (data[key] !== undefined) lines.push(row(key[0].toUpperCase() + key.slice(1), data[key]));
  const recovery = next?.[0];
  if (recovery) lines.push(nextStep('Try this', [recovery.command, ...recovery.argv.map((value) => /^[A-Za-z0-9_./:=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)].join(' '), args));
  else if (failure.hint) lines.push(row('Recovery', failure.hint.replace(/[\r\n]+/g, ' ')));
  process.stderr.write(`${lines.slice(0, 6).join('\n')}\n`);
}
