import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capabilities, createClient } from '../../dist/sdk/index.js';

const skip = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0 ? false : 'openssl is required to generate test certificates';
const token = 'ab'.repeat(32);
const rejected = { reason: 'unreachable', message: 'The TLS certificate was rejected.' };

let directory;
let servers;
const ports = {};

const file = (name) => join(directory, name);

before(async () => {
  if (skip) return;
  directory = mkdtempSync(join(tmpdir(), 'screen-relay-tls-'));
  const openssl = (...args) => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore' });
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=screen-relay-test-ca', '-days', '2');
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'self.key', '-out', 'self.pem', '-subj', '/CN=desktop.example', '-days', '2');
  for (const name of ['localhost', 'other.example']) {
    writeFileSync(file(`${name}.ext`), `subjectAltName=DNS:${name}`);
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name}`);
    openssl('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.ext`);
  }
  writeFileSync(file('fullchain.pem'), Buffer.concat([readFileSync(file('other.example.pem')), readFileSync(file('ca.pem'))]));
  servers = new Map();
  for (const name of ['localhost', 'other.example', 'self']) {
    const server = createServer({ key: readFileSync(file(`${name}.key`)), cert: readFileSync(file(`${name}.pem`)) }, (request, response) => {
      server.requests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ served: name }));
    });
    server.requests = 0;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.set(name, server);
    ports[name] = server.address().port;
  }
});

after(async () => {
  if (!servers) return;
  for (const server of servers.values()) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  rmSync(directory, { recursive: true, force: true });
});

test('a CA file still checks the URL host name', { skip }, async () => {
  await assert.rejects(createClient({ url: `https://localhost:${ports['other.example']}`, connect: '127.0.0.1', ca: file('ca.pem'), token }).status(), rejected);
  await assert.rejects(createClient({ url: `https://127.0.0.1:${ports['other.example']}`, ca: file('ca.pem'), token }).status(), rejected);
  await assert.rejects(createClient({ url: `https://127.0.0.1:${ports['other.example']}`, ca: file('fullchain.pem'), token }).status(), rejected);
  assert.equal(servers.get('other.example').requests, 0);
  assert.deepEqual(await createClient({ url: `https://localhost:${ports.localhost}`, connect: '127.0.0.1', ca: file('ca.pem') }).status(), { served: 'localhost' });
});

test('connect changes the dial address, not the name the certificate must match', { skip }, async () => {
  const before = servers.get('localhost').requests;
  await assert.rejects(createClient({ url: `https://desktop.example:${ports.localhost}`, connect: '127.0.0.1', ca: file('ca.pem'), token }).status(), rejected);
  assert.equal(servers.get('localhost').requests, before);
});

test('a pinned certificate is required exactly and skips the host name check', { skip }, async () => {
  assert.deepEqual(await createClient({ url: `https://127.0.0.1:${ports.self}`, certificate: file('self.pem') }).status(), { served: 'self' });
  assert.deepEqual(await createClient({ url: `https://127.0.0.1:${ports['other.example']}`, certificate: file('fullchain.pem') }).status(), { served: 'other.example' });
  const before = servers.get('other.example').requests;
  await assert.rejects(createClient({ url: `https://127.0.0.1:${ports['other.example']}`, certificate: file('localhost.pem'), token }).status(), rejected);
  assert.equal(servers.get('other.example').requests, before);
});

test('ca and certificate cannot be combined', async () => {
  assert.throws(() => createClient({ url: 'https://127.0.0.1:1', ca: 'ca.pem', certificate: 'cert.pem' }), { code: 'INVALID_ARGUMENT', message: /Pass ca or certificate, not both/ });
});

test('an unreadable certificate file is an io error', async () => {
  await assert.rejects(capabilities({ url: 'https://127.0.0.1:1', certificate: '/nonexistent/relay-cert.pem' }), { code: 'IO_ERROR' });
});
