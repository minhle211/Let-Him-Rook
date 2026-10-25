/**
 * `npm run host` — turn this laptop into the game server for LAN PvP.
 *
 * Builds the web client, then serves the page and the WebSocket game server
 * from a single HTTPS port (default 3001), so a guest only needs a browser and
 * one link. Works the same on macOS and Windows (no shell syntax, no openssl).
 *
 *   npm run host            # build + serve on https://<lan-ip>:3001
 *   npm run host -- --no-build
 *   PORT=4000 npm run host  # (Windows PowerShell: $env:PORT=4000; npm run host)
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RookServer, getLanAddresses } from './ws/wsServer.ts';
import { loadOrCreateCert } from './net/selfSignedCert.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
process.chdir(repoRoot); // the server resolves apps/web/dist relative to cwd

const port = Number(process.env.PORT || 3001);
const skipBuild = process.argv.includes('--no-build');

if (!skipBuild) {
  console.log('Building web client...');
  const { build } = await import('vite');
  await build({ root: join(repoRoot, 'apps/web'), logLevel: 'error' });
}

const lanAddresses = getLanAddresses();
const tls = loadOrCreateCert(join(repoRoot, 'certs'), lanAddresses);
const server = new RookServer({ tls });

try {
  await server.start(port, '0.0.0.0');
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(
    code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Close the other server or run with a different PORT.`
      : `Could not start server: ${(err as Error).message}`
  );
  process.exit(1);
}

const urls = lanAddresses.map(ip => `https://${ip}:${port}`);
console.log(`
Let Him Rook is hosting on port ${port}${tls.created ? ' (new HTTPS certificate created)' : ''}

  This laptop:   https://localhost:${port}
  Other laptop:  ${urls.length ? urls.join('\n                 ') : '(no LAN address found: are you connected to Wi-Fi?)'}

1. Open the link, click "Create PvP Duel Room", then "Copy invite link" and send it.
2. Browsers will warn about the self-signed certificate: click Advanced -> Proceed
   (Chrome/Edge) or Show Details -> visit this website (Safari). This is expected.
3. If the other laptop can't connect, allow Node.js through the firewall
   (Windows: tick "Public networks" too, eduroam is usually Public).

Press Ctrl+C to stop.`);

const shutdown = () => {
  server.stop().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
