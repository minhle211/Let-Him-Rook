/**
 * `npm run vision` — run only the native CoreML hand/pose tracker on this Mac.
 * For the guest in LAN PvP: open the host's invite link in your browser while this runs.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVisionHelper, VISION_PORT } from './visionHelper.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const helper = startVisionHelper(repoRoot);
if (!helper) process.exit(1);
console.log(`[vision] Camera tracking for this Mac on ws://127.0.0.1:${VISION_PORT}. Open the host's invite link; Ctrl+C to stop.`);
const stop = () => { helper.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
helper.on('exit', code => process.exit(code ?? 1));
