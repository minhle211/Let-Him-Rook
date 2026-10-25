import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const https = process.env.ROOK_TLS_CERT && process.env.ROOK_TLS_KEY
  ? { cert: readFileSync(process.env.ROOK_TLS_CERT), key: readFileSync(process.env.ROOK_TLS_KEY) }
  : undefined;
if (Boolean(process.env.ROOK_TLS_CERT) !== Boolean(process.env.ROOK_TLS_KEY)) {
  throw new Error('Set both ROOK_TLS_CERT and ROOK_TLS_KEY for LAN HTTPS');
}

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@let-him-rook/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    https,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/health': {
        target: 'http://localhost:3001',
      },
    },
  },
  build: {
    target: 'es2022',
  },
  worker: {
    // The MediaPipe worker loads its Wasm loader via dynamic import(), which needs a module worker.
    format: 'es',
  },
});
