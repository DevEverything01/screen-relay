import { commands, globalOptions, type Parameter, type Subcommand } from './commands.js';
import { agent, type OutputOptions } from './mode.js';
import { theme } from './theme.js';

const docs = 'https://github.com/vercel-labs/relay/blob/main/docs/cli.md';
const summary = 'Start a streamed Linux desktop and control it';
const width = 80;
const labelLimit = 24;

declare const __RELAY_VERSION__: string;
export const version = typeof __RELAY_VERSION__ === 'string' ? __RELAY_VERSION__ : '0.0.0';

type Style = ReturnType<typeof theme>;

function argumentSyntax(parameter: Parameter): string {
  const value = parameter.valueHint ?? `<${parameter.name.toUpperCase()}>`;
  const repeated = parameter.repeat === 'collect' ? `${value}...` : value;
  return parameter.brackets ?? !parameter.required ? `[${repeated}]` : repeated;
}

function optionSyntax(parameter: Parameter): string {
  return `${parameter.short ? `-${parameter.short}, ` : ''}--${parameter.name}${parameter.valueHint ? ` ${parameter.valueHint}` : ''}`;
}

function description(parameter: Parameter): string {
  const showDefault = parameter.default !== undefined && parameter.default !== false;
  return `${parameter.summary}${showDefault ? ` (default: ${parameter.default})` : ''}${parameter.acceptedValues ? `. Values: ${parameter.acceptedValues.join(', ')}` : ''}${parameter.environment ? `. Environment: ${parameter.environment}` : ''}`;
}

function wrapWords(text: string, limit: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > limit) { lines.push(line); line = word; }
    else line += `${line ? ' ' : ''}${word}`;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function align(entries: { label: string; text: string }[]): string[] {
  const column = 2 + Math.min(Math.max(0, ...entries.map((entry) => entry.label.length)), labelLimit) + 2;
  const lines: string[] = [];
  for (const { label, text } of entries) {
    if (2 + label.length + 2 <= column) {
      const words = wrapWords(text, width - column);
      lines.push(`  ${label.padEnd(column - 4)}  ${words[0]}`);
      for (const word of words.slice(1)) lines.push(`${' '.repeat(column)}${word}`);
    } else {
      lines.push(`  ${label}`);
      for (const word of wrapWords(text, width - 4)) lines.push(`    ${word}`);
    }
  }
  return lines;
}

function parameterRows(parameters: Parameter[], option: boolean): string[] {
  return align([...parameters]
    .sort((left, right) => option ? left.name.localeCompare(right.name) : 0)
    .map((parameter) => ({ label: option ? optionSyntax(parameter) : argumentSyntax(parameter), text: description(parameter) })));
}

function subcommandRows(subcommands: Subcommand[]): string[] {
  return align(subcommands.map((subcommand) => ({ label: subcommand.name, text: subcommand.summary })));
}

export function helpDocument(name = ''): Record<string, unknown> {
  const command = commands[name];
  const publicParameter = ({ validate, deferredDefault, missingReason, brackets, ...parameter }: Parameter) => ({ repeat: 'last', ...parameter });
  return {
    path: name ? `relay ${name}` : 'relay',
    summary: command?.summary ?? summary,
    arguments: command?.arguments.map(publicParameter) ?? [],
    options: [...(command?.options ?? []), ...globalOptions].map(publicParameter),
    examples: command?.examples ?? [],
    notes: command?.notes ?? [],
    resultSchema: command?.resultSchema ?? {},
    ...(command?.subcommands ? { subcommands: command.subcommands.map((subcommand) => ({ name: subcommand.name, summary: subcommand.summary, examples: subcommand.examples })) } : {}),
    ...(!name ? { commands: Object.entries(commands).map(([key, entry]) => ({ name: key, summary: entry.summary, group: entry.group })) } : {}),
  };
}

function usage(name: string, style: Style): string {
  const command = commands[name];
  const head = `▲ ${style.strong('relay')}`;
  if (!command) return `${head} <command> [options]`;
  const tail = command.usageTail ?? command.arguments.map(argumentSyntax).join(' ');
  return `${head} ${name}${command.separator ? ` ${command.separator}` : ''}${tail ? ` ${tail}` : ''} [options]`;
}

const startHere = [
  'Start here (for AI agents):',
  '  relay skills get core',
  '',
  '  Skills ship with the CLI, so their instructions always match the',
  '  installed version. Load one to control the desktop or a sandbox.',
  '',
  '  relay skills list',
  '  relay skills get core',
  '  relay skills get core --full',
  '  relay skills get <name>',
  '  relay skills path [name]',
];

const agentPointer = 'For AI agents: relay skills get core';

export function formatHelp(name = '', args: OutputOptions = {}): string {
  const style = theme(args, process.stdout);
  const command = commands[name];
  const lines = [style.muted(`relay ${version}`), '', usage(name, style), ''];
  if (command) lines.push(command.summary);
  else if (agent) lines.push(summary, '', ...startHere);
  else lines.push(agentPointer, '', summary);
  if (command?.arguments.length) lines.push('', 'Arguments:', ...parameterRows(command.arguments, false));
  if (command?.options.length) lines.push('', 'Options:', ...parameterRows(command.options, true));
  if (!command) for (const group of ['Session', 'Control', 'Machine']) {
    lines.push('', `${group}:`, ...align(Object.entries(commands)
      .filter(([, entry]) => entry.group === group)
      .map(([key, entry]) => ({ label: key, text: entry.summary }))));
  }
  if (command?.subcommands?.length) lines.push('', 'Commands:', ...subcommandRows(command.subcommands));
  lines.push('', 'Global Options:', ...(command ? ['  Run relay help for the full list of global options.'] : parameterRows(globalOptions, true)));
  if (command?.examples.length) lines.push('', 'Examples:', ...command.examples.flatMap((entry) => [...wrapWords(entry.description, width - 2).map((line) => `  ${line}`), `    ${entry.command}`]));
  if (command?.notes.length) lines.push('', 'Notes:', ...command.notes.flatMap((note) => wrapWords(note, width - 2).map((line) => `  ${line}`)));
  lines.push('', 'Learn more:', `  ${docs}`);
  return `${lines.join('\n')}\n`;
}
