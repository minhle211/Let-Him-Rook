/**
 * Zero-dependency self-signed TLS certificate for LAN hosting.
 *
 * Browsers only expose the webcam on HTTPS (or localhost), so the guest laptop
 * needs an HTTPS origin. This builds a minimal X.509 v3 certificate (EC P-256,
 * ECDSA-SHA256) with node:crypto and a tiny DER encoder, so hosting works the
 * same on macOS and Windows without openssl/mkcert or npm dependencies.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TlsMaterial {
  cert: string;
  key: string;
}

const VALIDITY_DAYS = 30;
const RENEW_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;

// --- Minimal DER encoder -----------------------------------------------------

function der(tag: number, content: Buffer): Buffer {
  const len = content.length;
  let header: Buffer;
  if (len < 0x80) {
    header = Buffer.from([tag, len]);
  } else {
    const bytes: number[] = [];
    for (let n = len; n > 0; n >>= 8) bytes.unshift(n & 0xff);
    header = Buffer.from([tag, 0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([header, content]);
}

const seq = (...items: Buffer[]) => der(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => der(0x31, Buffer.concat(items));
const octets = (content: Buffer) => der(0x04, content);
const bitString = (content: Buffer) => der(0x03, Buffer.concat([Buffer.from([0]), content]));
const explicit = (n: number, content: Buffer) => der(0xa0 + n, content);

function integer(value: Buffer): Buffer {
  let v = value;
  while (v.length > 1 && v[0] === 0 && (v[1] & 0x80) === 0) v = v.subarray(1);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
  return der(0x02, v);
}

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [];
    let n = part;
    do {
      chunk.unshift(n & 0x7f);
      n = Math.floor(n / 128);
    } while (n > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

function utcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const s =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return der(0x17, Buffer.from(s, 'ascii'));
}

function commonName(cn: string): Buffer {
  return seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn, 'utf8')))));
}

function ipv4Bytes(ip: string): Buffer {
  return Buffer.from(ip.split('.').map(Number));
}

// --- Certificate -------------------------------------------------------------

export function createSelfSignedCert(ipAddresses: string[], dnsNames: string[] = ['localhost']): TlsMaterial {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecdsaWithSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const name = commonName('Let Him Rook LAN Host');
  const notBefore = new Date(Date.now() - 60 * 60 * 1000); // tolerate small clock skew between laptops
  const notAfter = new Date(Date.now() + VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  const serial = randomBytes(16);
  serial[0] &= 0x7f;

  const altNames = Buffer.concat([
    ...dnsNames.map(dns => der(0x82, Buffer.from(dns, 'ascii'))),
    ...ipAddresses.map(ip => der(0x87, ipv4Bytes(ip))),
  ]);
  const extensions = explicit(
    3,
    seq(
      seq(oid('2.5.29.17'), octets(der(0x30, altNames))), // subjectAltName
      seq(oid('2.5.29.19'), octets(seq())), // basicConstraints: not a CA
      seq(oid('2.5.29.15'), der(0x01, Buffer.from([0xff])), octets(der(0x03, Buffer.from([0x07, 0x80])))), // keyUsage: digitalSignature (critical)
      seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))) // extKeyUsage: serverAuth
    )
  );

  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(serial),
    ecdsaWithSha256,
    name,
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions
  );
  const signature = sign('sha256', tbs, privateKey); // DER-encoded ECDSA signature, as X.509 expects
  const certDer = seq(tbs, ecdsaWithSha256, bitString(signature));

  const b64 = certDer.toString('base64').match(/.{1,64}/g)!.join('\n');
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/**
 * Reuse the cached certificate while it is valid and covers every current LAN
 * IP (so a guest who already accepted it isn't prompted again); otherwise
 * create a new one.
 */
export function loadOrCreateCert(dir: string, ipAddresses: string[]): TlsMaterial & { created: boolean } {
  const certPath = join(dir, 'host-cert.pem');
  const keyPath = join(dir, 'host-key.pem');
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = readFileSync(certPath, 'utf8');
      const key = readFileSync(keyPath, 'utf8');
      const x509 = new X509Certificate(cert);
      const fresh = new Date(x509.validTo).getTime() - Date.now() > RENEW_BEFORE_MS;
      const coversIps = ipAddresses.every(ip => x509.checkIP(ip) !== undefined);
      const keyMatches = x509.checkPrivateKey(createPrivateKey(key)) && x509.verify(createPublicKey(key));
      if (fresh && coversIps && keyMatches) return { cert, key, created: false };
    } catch {
      // Corrupt or unreadable: regenerate below.
    }
  }
  const material = createSelfSignedCert(ipAddresses);
  mkdirSync(dir, { recursive: true });
  writeFileSync(certPath, material.cert);
  writeFileSync(keyPath, material.key, { mode: 0o600 });
  return { ...material, created: true };
}
