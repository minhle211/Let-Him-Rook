/**
 * Starts the native CoreML vision helper (apps/vision-native) on macOS.
 *
 * First run creates a Python virtualenv next to the helper and installs its pinned
 * requirements; later runs reuse it (re-installing only when requirements.txt changes).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const VISION_PORT = Number(process.env.ROOK_VISION_PORT || 3101);
const PYTHON_CANDIDATES = ['python3.13', 'python3.12', 'python3.11', 'python3'];

function findPython(): string | null {
  for (const cmd of PYTHON_CANDIDATES) {
    const res = spawnSync(cmd, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
    if (res.status !== 0) continue;
    const [major, minor] = res.stdout.trim().split('.').map(Number);
    if (major === 3 && minor >= 11 && minor <= 13) return cmd; // numpy 2.5 needs 3.11+, coremltools 9 wheels up to 3.13
  }
  return null;
}

function ensureVenv(helperDir: string): string | null {
  const venvPython = join(helperDir, '.venv', 'bin', 'python');
  const reqPath = join(helperDir, 'requirements.txt');
  const stampPath = join(helperDir, '.venv', '.requirements-sha256');
  const reqHash = createHash('sha256').update(readFileSync(reqPath)).digest('hex');
  if (existsSync(venvPython) && existsSync(stampPath) && readFileSync(stampPath, 'utf8') === reqHash) {
    return venvPython;
  }
  const python = findPython();
  if (!python) {
    console.error('[vision] Python 3.11-3.13 not found (install with `brew install python@3.13`).');
    return null;
  }
  console.log('[vision] First run: installing the CoreML vision helper (about a minute)...');
  const steps: Array<[string, string[]]> = [
    [python, ['-m', 'venv', join(helperDir, '.venv')]],
    [venvPython, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']],
    [venvPython, ['-m', 'pip', 'install', '--quiet', '-r', reqPath]],
  ];
  for (const [cmd, args] of steps) {
    if (spawnSync(cmd, args, { stdio: 'inherit' }).status !== 0) {
      console.error(`[vision] Setup step failed: ${cmd} ${args.join(' ')}`);
      return null;
    }
  }
  writeFileSync(stampPath, reqHash);
  return venvPython;
}

/** Returns the helper process, or null when unsupported (the browser falls back to in-browser MediaPipe). */
export function startVisionHelper(repoRoot: string): ChildProcess | null {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    console.log('[vision] Native CoreML helper needs an Apple Silicon Mac; using in-browser vision instead.');
    return null;
  }
  const helperDir = join(repoRoot, 'apps', 'vision-native');
  const python = ensureVenv(helperDir);
  if (!python) return null;

  // ROOK_CAMERA: camera index (default 0) or a video file (looped), e.g. for testing without a webcam.
  const cam = process.env.ROOK_CAMERA;
  const extra = cam ? ['--source', cam, ...(/^\d+$/.test(cam) ? [] : ['--loop'])] : [];
  const child = spawn(python, ['-I', join(helperDir, 'server.py'), '--port', String(VISION_PORT), ...extra], {
    cwd: helperDir,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM') console.error(`[vision] helper exited (${signal ?? code}); in-browser vision will be used.`);
  });
  return child;
}
