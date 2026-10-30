import { outputMode, type OutputOptions } from './mode.js';

export function theme(args: OutputOptions = {}) {
  const mode = outputMode(args);
  const paint = (value: string, code: number) => mode.color ? `\u001b[${code}m${value}\u001b[0m` : value;
  return {
    plain: mode.plain,
    success: mode.plain ? '' : paint('✓', 32),
    warning: mode.plain ? 'Warning:' : paint('!', 33),
    error: mode.plain ? 'Error:' : paint('✗', 31),
    primary: (value: string) => paint(value, 1),
    command: (value: string) => paint(value, 36),
  };
}
