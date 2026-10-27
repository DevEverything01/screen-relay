import net from 'node:net';
import { performance } from 'node:perf_hooks';

const QUEUE_LIMIT = 256 * 1024;
const CHUNK = 16 * 1024;
const MAX_CONNECTIONS = 32;
const profiles = {
  delay: { latency: 25, up: Infinity, down: Infinity },
  bandwidth: { latency: 25, up: 2_000_000 / 8, down: 8_000_000 / 8 },
};

function pipe(source, destination, latency, rate, clock, counters, abort) {
  const queue = [];
  let bytes = 0;
  let timer;
  let ended = false;
  let blocked = false;
  let stopped = false;
  let scheduled = false;

  function pull() {
    if (stopped) return;
    while (bytes < QUEUE_LIMIT) {
      const data = source.read(Math.min(CHUNK, QUEUE_LIMIT - bytes, source.readableLength || CHUNK));
      if (data === null) break;
      const ready = performance.now() + latency;
      queue.push({ data, at: ready });
      bytes += data.length;
      counters.maxQueuedBytes = Math.max(counters.maxQueuedBytes, bytes);
    }
    pump();
  }

  function pump() {
    if (stopped || blocked || timer) return;
    if (queue.length) {
      const now = performance.now();
      const delay = Math.max(queue[0].at, clock.nextDeparture) - now;
      if (delay > 0) {
        timer = setTimeout(() => { timer = undefined; pump(); }, delay);
        return;
      }
      const { data } = queue.shift();
      bytes -= data.length;
      counters.bytes += data.length;
      clock.nextDeparture = now + data.length / rate * 1000;
      if (!destination.write(data)) {
        blocked = true;
        destination.once('drain', () => { blocked = false; pull(); });
        return;
      }
      if (!scheduled) {
        scheduled = true;
        setImmediate(() => { scheduled = false; pull(); });
      }
      pump();
      return;
    }
    if (ended) destination.end();
  }
  source.on('readable', pull);
  source.on('end', () => { ended = true; pump(); });
  source.on('error', abort);
  destination.on('error', abort);
  pull();
  return () => { stopped = true; clearTimeout(timer); queue.length = 0; };
}

export async function startProxy({ listenPort = 18093, targetPort = 18098, profile }) {
  const settings = profiles[profile];
  if (!settings) throw new Error(`Unknown network profile: ${profile}`);
  const totals = { up: { bytes: 0, maxQueuedBytes: 0 }, down: { bytes: 0, maxQueuedBytes: 0 }, connections: 0 };
  const clocks = { up: { nextDeparture: 0 }, down: { nextDeparture: 0 } };
  const connections = new Set();
  const server = net.createServer({ allowHalfOpen: true }, client => {
    if (connections.size >= MAX_CONNECTIONS) { client.destroy(); return; }
    const upstream = net.createConnection({ host: '127.0.0.1', port: targetPort, allowHalfOpen: true });
    const pair = { client, upstream, stops: [] };
    connections.add(pair);
    totals.connections++;
    let aborted = false;
    function abort() {
      if (aborted) return;
      aborted = true;
      for (const stop of pair.stops) stop();
      client.destroy();
      upstream.destroy();
      connections.delete(pair);
    }
    pair.stops.push(pipe(client, upstream, settings.latency, settings.up, clocks.up, totals.up, abort));
    pair.stops.push(pipe(upstream, client, settings.latency, settings.down, clocks.down, totals.down, abort));
    let closed = 0;
    for (const socket of [client, upstream]) socket.on('close', hadError => {
      if (hadError || !socket.readableEnded || !socket.writableFinished) abort();
      else if (++closed === 2) { for (const stop of pair.stops) stop(); connections.delete(pair); }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return {
    stats: () => ({ profile, queueLimitBytes: QUEUE_LIMIT, maxConnections: MAX_CONNECTIONS, activeConnections: connections.size, ...structuredClone(totals) }),
    close: () => new Promise((resolve, reject) => {
      for (const pair of connections) { for (const stop of pair.stops) stop(); pair.client.destroy(); pair.upstream.destroy(); }
      connections.clear();
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}
