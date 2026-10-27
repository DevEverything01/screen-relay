#!/usr/bin/env node
import { capabilities, connect, status } from './index.js';

const [command, ...args] = process.argv.slice(2);
const options = { url: process.env.NATIVE_STREAM_URL || 'http://127.0.0.1:8080' };
const help = 'Usage: native-stream capabilities | status | snapshot <file.png> | input <JSON array>\nSet NATIVE_STREAM_URL to a loopback HTTP origin. Input example: [{"type":"keyDown","key":4},{"type":"keyUp","key":4}]';
try {
  let result;
  if (command === '--help' || command === 'help') { console.log(help); }
  else if (command === 'capabilities' && !args.length) result = await capabilities(options);
  else if (command === 'status' && !args.length) result = await status(options);
  else if ((command === 'snapshot' || command === 'input') && args.length === 1) {
    let events;
    if (command === 'input') {
      events = JSON.parse(args[0]);
      if (!Array.isArray(events)) throw new Error('Input must be a JSON array');
    }
    const session = await connect(options);
    try {
      if (command === 'snapshot') {
        const bytes = await session.snapshot(args[0]);
        result = { path: args[0], bytes: bytes.length, ...session.surface };
      } else {
        for (const event of events) await session.input(event);
        result = { sent: events.length };
      }
    } finally { session.close(); }
  } else throw new Error(help);
  if (result !== undefined) console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ error: { code: error.code || 'INVALID_ARGUMENT', message: error.message } }));
  process.exitCode = 1;
}
