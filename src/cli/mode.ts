export interface OutputOptions { json?: boolean; 'no-color'?: boolean; color?: boolean }

export function outputMode(args: OutputOptions = {}, stream: NodeJS.WriteStream = process.stderr) {
  const plain = !stream.isTTY || process.env.TERM === 'dumb';
  const forced = process.env.FORCE_COLOR;
  const color = args['no-color'] || args.color === false || process.env.NO_COLOR
    ? false : forced !== undefined ? forced !== '0' : !plain;
  return { tty: Boolean(stream.isTTY), plain, color: color && !plain && !args.json, pretty: Boolean(process.stdout.isTTY) };
}
