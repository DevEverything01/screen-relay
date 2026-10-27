import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { startProxy } from './network.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('delay relays small messages with approximately 50ms round trip', async () => {
  const server = net.createServer(socket => socket.pipe(socket));
  const targetPort = await listen(server);
  const listenPort = await freePort();
  const proxy = await startProxy({ listenPort, targetPort, profile: 'delay' });
  try {
    const socket = net.createConnection(listenPort, '127.0.0.1');
    const start = performance.now();
    socket.write('hello');
    const data = await new Promise((resolve, reject) => { socket.once('data', resolve); socket.once('error', reject); });
    assert.equal(data.toString(), 'hello');
    assert.ok(performance.now() - start >= 40);
    socket.end();
  } finally {
    await proxy.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('bandwidth preserves bytes, limits upload rate and bounds the queue', async () => {
  const server = net.createServer(socket => socket.pipe(socket));
  const targetPort = await listen(server);
  const listenPort = await freePort();
  const proxy = await startProxy({ listenPort, targetPort, profile: 'bandwidth' });
  try {
    const input = Buffer.allocUnsafe(384 * 1024);
    for (let i = 0; i < input.length; i++) input[i] = i % 251;
    const socket = net.createConnection(listenPort, '127.0.0.1');
    const chunks = [];
    const start = performance.now();
    const received = new Promise((resolve, reject) => {
      socket.on('data', chunk => { chunks.push(chunk); if (Buffer.concat(chunks).length === input.length) resolve(Buffer.concat(chunks)); });
      socket.once('error', reject);
    });
    socket.end(input);
    assert.deepEqual(await received, input);
    assert.ok(performance.now() - start >= 1400, 'upload should be shaped near 2 Mbps');
    const stats = proxy.stats();
    assert.ok(stats.up.maxQueuedBytes <= stats.queueLimitBytes);
    assert.ok(stats.down.maxQueuedBytes <= stats.queueLimitBytes);
  } finally {
    await proxy.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('closing aborts active connections promptly', async () => {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const targetPort = await listen(server);
  const listenPort = await freePort();
  const proxy = await startProxy({ listenPort, targetPort, profile: 'bandwidth' });
  const socket = net.createConnection(listenPort, '127.0.0.1');
  socket.on('error', error => { if (error.code !== 'ECONNRESET') throw error; });
  await new Promise(resolve => socket.once('connect', resolve));
  const closed = new Promise(resolve => socket.once('close', resolve));
  socket.write(Buffer.alloc(512 * 1024));
  await proxy.close();
  await closed;
  for (const peer of sockets) peer.destroy();
  await new Promise(resolve => server.close(resolve));
  assert.equal(proxy.stats().activeConnections, 0);
});

test('bandwidth limits download independently of upload', async () => {
  const input = Buffer.alloc(512 * 1024, 42);
  const server = net.createServer(socket => socket.end(input));
  const targetPort = await listen(server);
  const listenPort = await freePort();
  const proxy = await startProxy({ listenPort, targetPort, profile: 'bandwidth' });
  try {
    const socket = net.createConnection(listenPort, '127.0.0.1');
    const start = performance.now();
    const chunks = [];
    await new Promise((resolve, reject) => {
      socket.on('data', chunk => chunks.push(chunk));
      socket.once('end', resolve);
      socket.once('error', reject);
    });
    assert.deepEqual(Buffer.concat(chunks), input);
    assert.ok(performance.now() - start >= 490, 'download should be shaped near 8 Mbps');
    socket.end();
  } finally {
    await proxy.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('bandwidth is shared by simultaneous connections', async () => {
  const payload = Buffer.alloc(256 * 1024, 19);
  const server = net.createServer(socket => socket.end(payload));
  const targetPort = await listen(server);
  const listenPort = await freePort();
  const proxy = await startProxy({ listenPort, targetPort, profile: 'bandwidth' });
  try {
    const start = performance.now();
    const receive = () => new Promise((resolve, reject) => {
      const socket = net.createConnection(listenPort, '127.0.0.1');
      const chunks = [];
      socket.on('data', chunk => chunks.push(chunk));
      socket.once('end', () => { socket.end(); resolve(Buffer.concat(chunks)); });
      socket.once('error', reject);
    });
    const results = await Promise.all([receive(), receive()]);
    for (const result of results) assert.deepEqual(result, payload);
    assert.ok(performance.now() - start >= 490, 'combined download should be limited to 8 Mbps');
  } finally {
    await proxy.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('disconnecting a queued sender does not reserve bandwidth for its backlog', async () => {
  const server = net.createServer(socket => socket.pipe(socket));
  const targetPort = await listen(server);
  const listenPort = await freePort();
  const proxy = await startProxy({ listenPort, targetPort, profile: 'bandwidth' });
  try {
    const first = net.createConnection(listenPort, '127.0.0.1');
    first.on('error', () => {});
    await new Promise(resolve => first.once('connect', resolve));
    first.write(Buffer.alloc(1024 * 1024));
    await new Promise(resolve => setTimeout(resolve, 50));
    first.destroy();
    const second = net.createConnection(listenPort, '127.0.0.1');
    const start = performance.now();
    second.write('ping');
    const data = await new Promise((resolve, reject) => { second.once('data', resolve); second.once('error', reject); });
    assert.equal(data.toString(), 'ping');
    assert.ok(performance.now() - start < 400, 'discarded backlog must not reserve future bandwidth');
    second.destroy();
  } finally {
    await proxy.close();
    await new Promise(resolve => server.close(resolve));
  }
});
