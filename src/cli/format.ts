import type { OutputOptions } from './mode.js';
import { theme } from './theme.js';

export function row(label: string, value: unknown, glyph = ' '): string {
  return `${glyph} ${label.padEnd(16)}${String(value ?? '')}`;
}

export function receipt(label: string, value: unknown, args: OutputOptions = {}): string {
  const style = theme(args);
  return style.plain ? `${style.primary(label)} ${String(value ?? '')}` : row(style.primary(label.padEnd(16)), value, style.success);
}

export function nextStep(benefit: string, command: string, args: OutputOptions = {}): string {
  return `\n  ${benefit}:\n    ${theme(args).command(command)}`;
}

export function sessionCommand(command: string, name: string): string {
  const quoted = /^[A-Za-z0-9_.-]+$/.test(name) ? name : `'${name.replaceAll("'", "'\\''")}'`;
  return `relay ${command}${name === 'default' ? '' : ` --name ${quoted}`}`;
}

export function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

export function duration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m${rounded % 60 ? ` ${rounded % 60}s` : ''}`;
}

export function size(bytes: number): string {
  return bytes < 1000 ? count(bytes, 'byte') : bytes < 1e6 ? `${(bytes / 1000).toFixed(1)} kB` : `${(bytes / 1e6).toFixed(1)} MB`;
}
