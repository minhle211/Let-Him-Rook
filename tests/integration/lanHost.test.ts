import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { get as httpGet } from 'node:http';
import { RookServer } from '../../apps/server/src/ws/wsServer.ts';
import { createSelfSignedCert } from '../../apps/server/src/net/selfSignedCert.ts';

function httpsGetJson(port: number, path: string, ca: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Strict verification: trust only our cert and require it to match the IP we dial.
    const req = request({ host: '127.0.0.1', port, path, ca, rejectUnauthorized: true }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.end();
  });
}

test('LAN host: self-signed cert passes strict TLS verification and /lan-info reports HTTPS', async () => {
  const tls = createSelfSignedCert(['127.0.0.1']);
  const server = new RookServer({ tls });
  const port = await server.start(0, '127.0.0.1');
  try {
    const health = (await httpsGetJson(port, '/health', tls.cert)) as { ok: boolean };
    assert.equal(health.ok, true);
    const info = (await httpsGetJson(port, '/lan-info', tls.cert)) as { protocol: string; port: number; addresses: string[] };
    assert.equal(info.protocol, 'https');
    assert.equal(info.port, port);
    assert.ok(Array.isArray(info.addresses));
  } finally {
    await server.stop();
  }
});

test('LAN host: start() rejects when the port is already taken instead of hanging', async () => {
  const first = new RookServer();
  const port = await first.start(0, '127.0.0.1');
  const second = new RookServer();
  try {
    await assert.rejects(second.start(port, '127.0.0.1'), { code: 'EADDRINUSE' });
  } finally {
    await first.stop();
  }
});

test('LAN host: plain http:// on the HTTPS port redirects to https:// instead of an empty response', async () => {
  const tls = createSelfSignedCert(['127.0.0.1']);
  const server = new RookServer({ tls });
  const port = await server.start(0, '127.0.0.1');
  try {
    const res = await new Promise<{ status?: number; location?: string }>((resolve, reject) => {
      httpGet({ host: '127.0.0.1', port, path: '/?room=ABC123' }, r => {
        r.resume();
        resolve({ status: r.statusCode, location: r.headers.location });
      }).on('error', reject);
    });
    assert.equal(res.status, 301);
    assert.equal(res.location, `https://127.0.0.1:${port}/?room=ABC123`);
    // HTTPS on the same port still works after a plain-HTTP connection.
    const health = (await httpsGetJson(port, '/health', tls.cert)) as { ok: boolean };
    assert.equal(health.ok, true);
  } finally {
    await server.stop();
  }
});
