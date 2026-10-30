import { determineAgent } from '@vercel/detect-agent';

export interface OutputOptions { json?: boolean; 'no-color'?: boolean; color?: boolean }

const detection = await determineAgent();
const override = process.env.RELAY_AGENT;

export const agentName: string | undefined = detection.isAgent ? detection.agent.name : undefined;
export const agent = override === '1' ? true : override === '0' ? false : detection.isAgent;

export function outputMode(args: OutputOptions = {}, stream: NodeJS.WriteStream = process.stderr) {
  const plain = agent || !stream.isTTY || process.env.TERM === 'dumb';
  const forced = process.env.FORCE_COLOR;
  const color = !agent && !args['no-color'] && args.color !== false && !process.env.NO_COLOR && (forced !== undefined ? forced !== '0' : !plain);
  return { tty: !agent && Boolean(stream.isTTY), plain, color: color && !plain && !args.json, pretty: Boolean(process.stdout.isTTY) };
}
