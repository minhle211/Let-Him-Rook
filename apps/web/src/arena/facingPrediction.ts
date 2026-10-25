import { FIGHTER_TURN_SPEED } from '@let-him-rook/shared';

/**
 * While turning, the authoritative facing trails the local prediction by roughly
 * (network latency × turn speed). Up to this much disagreement is expected, not error.
 * 0.25 rad ≈ 14°, i.e. ~225 ms of turning at FIGHTER_TURN_SPEED.
 */
export const TURNING_TOLERANCE_RAD = 0.25;
/** Settling speed onto the server facing once the player stops turning (1/s; ~170 ms time constant). */
export const SETTLE_RATE = 6;
/** How quickly divergence beyond the tolerance is corrected mid-turn (1/s). */
export const TURNING_CORRECTION_RATE = 5;

export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/**
 * Advance the locally predicted facing by one render frame.
 *
 * The prediction turns at exactly the server's FIGHTER_TURN_SPEED, so while a turn is held it
 * is only corrected if it drifts beyond what latency explains. Pulling it toward the (lagging,
 * 60 Hz-stepped) server value every frame instead drags the turn and makes the aim camera stutter.
 * Once the turn stops, it settles smoothly onto the authoritative facing (frame-rate independent).
 */
export function stepPredictedFacing(predicted: number, serverFacing: number, turnDir: number, dtSec: number): number {
  const turning = Math.abs(turnDir) >= 0.1;
  let next = turning ? predicted + Math.sign(turnDir) * FIGHTER_TURN_SPEED * dtSec : predicted;
  const err = wrapAngle(serverFacing - next);
  if (turning) {
    const excess = Math.abs(err) - TURNING_TOLERANCE_RAD;
    if (excess > 0) next += Math.sign(err) * excess * (1 - Math.exp(-dtSec * TURNING_CORRECTION_RATE));
  } else {
    next += err * (1 - Math.exp(-dtSec * SETTLE_RATE));
  }
  return wrapAngle(next);
}
