import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent, type AgentOptions } from 'node:https';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import { checkServerIdentity, type PeerCertificate, type TLSSocket } from 'node:tls';
import { RelayError } from '../protocol/index.js';

interface TransportTarget {
  url: URL;
  ca?: string;
  certificate?: string;
  connect?: string;
}

interface PinnedCertificate {
  der: Buffer;
  validFrom: number;
  validTo: number;
}

/** How the client authenticates the server's TLS certificate. */
type Trust =
  | { kind: 'system' }
  | { kind: 'authority'; bundle: Buffer }
  | { kind: 'certificate'; certificate: PinnedCertificate };

/** The address a request dials, and the host name its certificate must match. */
interface Route {
  dial: string;
  identity: string;
  servername?: string;
}

export type Plan =
  | { kind: 'fetch' }
  | { kind: 'node'; dial: string; agent: HttpAgent | HttpsAgent };

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/;

function readCertificates(path: string): Buffer {
  try { return readFileSync(path); }
  catch (error) {
    throw new RelayError('io_error', `Cannot read certificate ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function leafCertificate(pem: Buffer, path: string): PinnedCertificate {
  const block = PEM_CERTIFICATE.exec(pem.toString())?.[0];
  if (!block) throw new RelayError('io_error', `Cannot read certificate ${path}: the file contains no certificate`);
  try {
    const certificate = new X509Certificate(block);
    return {
      der: certificate.raw,
      validFrom: Date.parse(certificate.validFrom),
      validTo: Date.parse(certificate.validTo),
    };
  } catch (error) {
    throw new RelayError('io_error', `Cannot read certificate ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Reads the certificate file into the trust mode the options ask for. */
function trust(target: TransportTarget): Trust {
  if (target.certificate) {
    return { kind: 'certificate', certificate: leafCertificate(readCertificates(target.certificate), target.certificate) };
  }
  if (target.ca) return { kind: 'authority', bundle: readCertificates(target.ca) };
  return { kind: 'system' };
}

function verifyPin(pin: PinnedCertificate, peer: PeerCertificate): Error | undefined {
  if (!peer.raw || !peer.raw.equals(pin.der)) return new Error('The server certificate does not match the pinned certificate.');
  const now = Date.now();
  if (!Number.isFinite(pin.validFrom) || !Number.isFinite(pin.validTo) || now < pin.validFrom || now > pin.validTo) {
    return new Error('The pinned certificate is not valid.');
  }
  return undefined;
}

/** An HTTPS agent that admits only the pinned certificate, checked after the handshake and before the request is written. */
class PinnedAgent extends HttpsAgent {
  readonly pin: PinnedCertificate;

  constructor(pin: PinnedCertificate, options: AgentOptions) {
    super(options);
    this.pin = pin;
  }

  createConnection(
    options: Parameters<HttpsAgent['createConnection']>[0],
    callback?: (error: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    const socket = super.createConnection({ ...options, rejectUnauthorized: false }) as TLSSocket | null | undefined;
    if (!socket || !callback) return socket;
    const finish = callback as (error: Error | null, stream?: Duplex) => void;
    const fail = (error: Error) => finish(error);
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      socket.removeListener('error', fail);
      const error = verifyPin(this.pin, socket.getPeerCertificate());
      if (error) {
        socket.destroy();
        finish(error);
        return;
      }
      finish(null, socket);
    });
    return undefined;
  }
}

/** Separates the address to dial from the host name the certificate must name. */
function route(target: TransportTarget): Route {
  const identity = target.url.hostname.replace(/^\[|\]$/g, '');
  return { dial: target.connect ?? identity, identity, ...(isIP(identity) ? {} : { servername: identity }) };
}

function httpsAgent(where: Route, trust: Trust): HttpsAgent {
  const servername = where.servername ? { servername: where.servername } : {};
  if (trust.kind === 'certificate') {
    return new PinnedAgent(trust.certificate, { keepAlive: true, rejectUnauthorized: false, ...servername });
  }
  const verify = (_dialed: string, certificate: PeerCertificate) => checkServerIdentity(where.identity, certificate);
  return new HttpsAgent({
    keepAlive: true,
    ...servername,
    checkServerIdentity: verify,
    ...(trust.kind === 'authority' ? { ca: trust.bundle } : {}),
  });
}

/** Chooses the transport and prepares its TLS settings. A CA file never turns off host name checking. */
export function plan(target: TransportTarget): Plan {
  if (!target.ca && !target.certificate && !target.connect) return { kind: 'fetch' };
  const where = route(target);
  if (target.url.protocol !== 'https:') return { kind: 'node', dial: where.dial, agent: new HttpAgent({ keepAlive: true }) };
  return { kind: 'node', dial: where.dial, agent: httpsAgent(where, trust(target)) };
}
