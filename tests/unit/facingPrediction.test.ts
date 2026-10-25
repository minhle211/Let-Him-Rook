import test from 'node:test';
import assert from 'node:assert/strict';
import { FIGHTER_TURN_SPEED } from '@let-him-rook/shared';
import { stepPredictedFacing, wrapAngle } from '../../apps/web/src/arena/facingPrediction.ts';

/** The previous reconciliation: turn locally, then lerp toward the server facing every render frame. */
function legacyStep(pred: number, server: number, turnDir: number, dt: number): number {
  let next = Math.abs(turnDir) >= 0.1 ? wrapAngle(pred + Math.sign(turnDir) * FIGHTER_TURN_SPEED * dt) : pred;
  return next + wrapAngle(server - next) * Math.min(1, dt * 10);
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hold a left-hand turn from 0.5 s to 2.5 s. Vision samples the gesture at 30 FPS, intents and
 * snapshots each take 40 ms ± 10 ms over the network, the server ticks at 60 Hz, and the client
 * renders at ~60 FPS with ±3 ms frame jitter. Returns the rendered facing per frame.
 */
function simulate(step: typeof stepPredictedFacing, seed = 7) {
  const rand = mulberry32(seed);
  const latency = () => 0.04 + (rand() - 0.5) * 0.02;
  const gesture = (t: number) => (t >= 0.5 && t < 2.5 ? 1 : 0);
  const visionAt = (t: number) => gesture(Math.floor(t * 30) / 30); // last 30 FPS vision sample

  const intents: Array<{ at: number; turnDir: number }> = [];
  const snapshots: Array<{ at: number; facing: number }> = [];
  for (let t = 0; t < 4.2; t += 1 / 30) intents.push({ at: t + latency(), turnDir: visionAt(t) });

  let serverFacing = 0;
  for (let t = 0; t < 4.2; t += 1 / 60) {
    const live = intents.filter(i => i.at <= t).sort((a, b) => a.at - b.at).at(-1);
    serverFacing = wrapAngle(serverFacing + (live?.turnDir ?? 0) * FIGHTER_TURN_SPEED / 60);
    snapshots.push({ at: t + latency(), facing: serverFacing });
  }

  const frames: Array<{ t: number; dt: number; facing: number; server: number }> = [];
  let pred = 0;
  for (let t = 0; t < 4; ) {
    const dt = (16.67 + (rand() - 0.5) * 6) / 1000;
    t += dt;
    const server = snapshots.filter(s => s.at <= t).at(-1)?.facing ?? 0;
    pred = step(pred, server, visionAt(t), dt);
    frames.push({ t, dt, facing: pred, server });
  }
  return { frames, finalServer: serverFacing };
}

function turnQuality(run: ReturnType<typeof simulate>) {
  const steady = [];
  for (let i = 1; i < run.frames.length; i++) {
    const f = run.frames[i];
    if (f.t > 1.0 && f.t < 2.3) steady.push(wrapAngle(f.facing - run.frames[i - 1].facing) / f.dt / FIGHTER_TURN_SPEED);
  }
  const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
  const jitter = Math.sqrt(steady.reduce((a, b) => a + (b - mean) ** 2, 0) / steady.length);
  const backwards = steady.filter(w => w < 0).length;
  const settleError = Math.abs(wrapAngle(run.frames.at(-1)!.facing - run.finalServer));
  return { mean, jitter, backwards, settleError };
}

test('aim turning: rendered facing turns evenly at the server turn speed (no per-frame stutter)', t => {
  const next = turnQuality(simulate(stepPredictedFacing));
  const old = turnQuality(simulate(legacyStep));
  t.diagnostic(`turn-rate jitter: new ${(next.jitter * 100).toFixed(2)}% vs old ${(old.jitter * 100).toFixed(2)}% | speed new ${next.mean.toFixed(3)}x old ${old.mean.toFixed(3)}x | backwards frames new ${next.backwards} old ${old.backwards} | settle error new ${next.settleError.toFixed(4)} old ${old.settleError.toFixed(4)} rad`);
  assert.ok(Math.abs(next.mean - 1) < 0.02, `turn speed should match the server (got ${next.mean.toFixed(3)}x)`);
  assert.ok(next.jitter < 0.02, `per-frame turn-rate jitter ${(next.jitter * 100).toFixed(1)}% should be under 2%`);
  assert.ok(next.jitter < old.jitter / 3, `new jitter ${(next.jitter * 100).toFixed(1)}% vs old ${(old.jitter * 100).toFixed(1)}%`);
  assert.equal(next.backwards, 0, 'the aim must never jerk backwards mid-turn');
});

test('aim turning: after the turn stops the prediction settles onto the server facing', () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    const q = turnQuality(simulate(stepPredictedFacing, seed));
    assert.ok(q.settleError < 0.01, `seed ${seed}: settled ${q.settleError.toFixed(4)} rad away from the server`);
  }
});

test('aim turning: large divergence (e.g. server-side knockback) is still corrected while turning', () => {
  let pred = 0;
  const server = 1.0; // way beyond what latency explains
  for (let i = 0; i < 120; i++) pred = stepPredictedFacing(pred, server + i * FIGHTER_TURN_SPEED / 60, 1, 1 / 60);
  const serverNow = server + 119 * FIGHTER_TURN_SPEED / 60;
  assert.ok(Math.abs(wrapAngle(serverNow - pred)) < 0.3, `still ${wrapAngle(serverNow - pred).toFixed(3)} rad off after 2 s`);
});
