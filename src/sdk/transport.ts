import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';
import type { RequestOptions } from 'node:https';
import { RelayError } from '../protocol/index.js';

export interface TransportTarget {
  url: URL;
  ca?: string;
  certificate?: string;
  connect?: string;
}

/** How the client authenticates the server's TLS certificate. */
export type Trust =
  | { kind: 'system' }
  | { kind: 'authority'; bundle: Buffer }
  | { kind: 'certificate'; certificate: { der: Buffer; pem: string } };

/** The address a request dials, and the host name its certificate must match. */
export interface Route {
  dial: string;
  identity: string;
  servername?: string;
}

export type TlsOptions = Pick<RequestOptions, 'ca' | 'allowPartialTrustChain' | 'checkServerIdentity' | 'servername'>;

export type Plan =
  | { kind: 'fetch' }
  | { kind: 'node'; dial: string; tls: TlsOptions };

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/;

function readCertificates(path: string): Buffer {
  try { return readFileSync(path); }
  catch (error) {
    throw new RelayError('io_error', `Cannot read certificate ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function leafCertificate(pem: Buffer, path: string): { der: Buffer; pem: string } {
  const block = PEM_CERTIFICATE.exec(pem.toString())?.[0];
  if (!block) throw new RelayError('io_error', `Cannot read certificate ${path}: the file contains no certificate`);
  try { return { der: new X509Certificate(block).raw, pem: block }; }
  catch (error) {
    throw new RelayError('io_error', `Cannot read certificate ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Reads the certificate file into the trust mode the options ask for. */
export function trust(target: TransportTarget): Trust {
  if (target.certificate) {
    return { kind: 'certificate', certificate: leafCertificate(readCertificates(target.certificate), target.certificate) };
  }
  if (target.ca) return { kind: 'authority', bundle: readCertificates(target.ca) };
  return { kind: 'system' };
}

function named(identity: string, certificate: PeerCertificate): Error | undefined {
  return checkServerIdentity(identity, certificate);
}

function pinned(certificate: Buffer, peer: PeerCertificate): Error | undefined {
  return peer.raw.equals(certificate) ? undefined : new Error('The server certificate does not match the pinned certificate.');
}

/** Separates the address to dial from the host name the certificate must name. */
export function route(target: TransportTarget): Route {
  const identity = target.url.hostname.replace(/^\[|\]$/g, '');
  return { dial: target.connect ?? identity, identity, ...(isIP(identity) ? {} : { servername: identity }) };
}

function tls(route: Route, trust: Trust): TlsOptions {
  const servername = route.servername ? { servername: route.servername } : {};
  switch (trust.kind) {
    case 'system':
      return { ...servername, checkServerIdentity: (_dialed, certificate) => named(route.identity, certificate) };
    case 'authority':
      return { ca: trust.bundle, ...servername, checkServerIdentity: (_dialed, certificate) => named(route.identity, certificate) };
    case 'certificate':
      return {
        ca: trust.certificate.pem,
        allowPartialTrustChain: true,
        ...servername,
        checkServerIdentity: (_dialed, certificate) => pinned(trust.certificate.der, certificate),
      };
  }
}

/** Chooses the transport and prepares its TLS settings. A CA file never turns off host name checking. */
export function plan(target: TransportTarget): Plan {
  if (!target.ca && !target.certificate && !target.connect) return { kind: 'fetch' };
  const where = route(target);
  return {
    kind: 'node',
    dial: where.dial,
    tls: target.url.protocol === 'https:' ? tls(where, trust(target)) : {},
  };
}
