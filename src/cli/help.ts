import { commands, globalOptions, type Parameter } from './commands.js';

const docs = 'https://github.com/vercel-labs/relay/blob/main/docs/cli.md';

function syntax(parameter: Parameter, option = false): string {
  if (option) return `${parameter.short ? `-${parameter.short}, ` : ''}--${parameter.name}${parameter.valueHint ? ` ${parameter.valueHint}` : ''}`;
  const value = `${parameter.valueHint ?? `<${parameter.name.toUpperCase()}>`}${parameter.repeat === 'collect' ? '...' : ''}`;
  return parameter.required ? value : `[${value}]`;
}

function wrap(text: string, indent = '  '): string[] {
  const lines: string[] = [];
  let line = indent;
  for (const word of text.split(/\s+/)) {
    if (line.length > indent.length && line.length + word.length + 1 > 80) { lines.push(line); line = indent; }
    line += `${line === indent ? '' : ' '}${word}`;
  }
  if (line.trim()) lines.push(line);
  return lines;
}

function rows(parameters: Parameter[], option: boolean): string[] {
  return [...parameters].sort((left, right) => option ? left.name.localeCompare(right.name) : 0).flatMap((parameter) => {
    const label = syntax(parameter, option);
    const description = `${parameter.summary}${parameter.default !== undefined ? ` (default: ${parameter.default})` : ''}${parameter.acceptedValues ? `. Values: ${parameter.acceptedValues.join(', ')}` : ''}${parameter.environment ? `. Environment: ${parameter.environment}` : ''}`;
    return label.length + description.length + 4 <= 80 ? [`  ${label}  ${description}`] : [`  ${label}`, ...wrap(description, '    ')];
  });
}

export function helpDocument(name = ''): Record<string, unknown> {
  const command = commands[name];
  const publicParameter = ({ validate, deferredDefault, missingReason, ...parameter }: Parameter) => ({ repeat: 'last', ...parameter });
  return {
    path: name ? `relay ${name}` : 'relay',
    summary: command?.summary ?? 'Start a streamed Linux desktop and control it',
    arguments: command?.arguments.map(publicParameter) ?? [],
    options: [...(command?.options ?? []), ...globalOptions].map(publicParameter),
    examples: command?.examples ?? [{ description: 'Start a session', command: 'relay up -d' }],
    notes: command?.notes ?? [],
    resultSchema: command?.resultSchema ?? {},
    ...(!name ? { commands: Object.entries(commands).map(([name, entry]) => ({ name, summary: entry.summary, group: entry.group })) } : {}),
  };
}

export function formatHelp(name = ''): string {
  const command = commands[name];
  const lines = [command ? `Usage: relay ${name}${command.arguments.length ? ` ${command.arguments.map((argument) => syntax(argument)).join(' ')}` : ''} [options]` : 'Usage: relay <command> [options]', '', command?.summary ?? 'Start a streamed Linux desktop and control it'];
  if (command?.arguments.length) lines.push('', 'Arguments:', ...rows(command.arguments, false));
  if (command?.options.length) lines.push('', 'Options:', ...rows(command.options, true));
  if (!command) for (const group of ['Session', 'Control', 'Machine']) lines.push('', `${group}:`, ...Object.entries(commands).filter(([, entry]) => entry.group === group).map(([name, entry]) => `  ${name.padEnd(12)} ${entry.summary}`));
  lines.push('', 'Global Options:', ...(command ? ['  Run relay help for the full list of global options.'] : rows(globalOptions, true)));
  const examples = command?.examples ?? [{ description: 'Start a session in the background', command: 'relay up -d' }];
  if (examples.length) lines.push('', 'Examples:', ...examples.flatMap((example) => [...wrap(example.description), `    ${example.command}`]));
  if (command?.notes.length) lines.push('', 'Notes:', ...command.notes.flatMap((note) => wrap(note)));
  lines.push('', 'Learn more:', `  ${docs}`);
  return `${lines.join('\n')}\n`;
}
