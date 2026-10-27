#!/usr/bin/env node
import { capabilities, connect, snapshot, status } from './index.js';
import { readFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);
const options = { url: process.env.NATIVE_STREAM_URL || 'http://127.0.0.1:8080' };
const help = 'Usage: native-stream capabilities | status | snapshot <file.png> | input <JSON array>\nSet NATIVE_STREAM_URL to an HTTPS origin or loopback HTTP origin. For authenticated access set NATIVE_STREAM_TOKEN_FILE. Input example: [{"type":"keyDown","key":4},{"type":"keyUp","key":4}]';
try {
  if (process.env.NATIVE_STREAM_TOKEN_FILE) options.token = readFileSync(process.env.NATIVE_STREAM_TOKEN_FILE, 'utf8').trim();
  let result;
  if (command === '--help' || command === 'help') { console.log(help); }
  else if (command === 'capabilities' && !args.length) result = await capabilities(options);
  else if (command === 'status' && !args.length) result = await status(options);
  else if (command === 'snapshot' && args.length === 1) {
    const bytes = await snapshot(options, args[0]);
    result = { path: args[0], bytes: bytes.length };
  } else if (command === 'input' && args.length === 1) {
    const events = JSON.parse(args[0]);
    if (!Array.isArray(events)) throw new Error('Input must be a JSON array');
    const session = await connect(options);
    try {
      for (const event of events) await session.input(event);
      result = { sent: events.length };
    } finally { session.close(); }
  } else throw new Error(help);
  if (result !== undefined) console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ error: { code: error.code || 'INVALID_ARGUMENT', message: error.message } }));
  process.exitCode = 1;
}
