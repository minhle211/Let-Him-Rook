import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CALIBRATION, computePinchRatio } from '../../apps/web/src/gestures/calibration.ts';
import { ChessGestureController } from '../../apps/web/src/gestures/chessGestures.ts';
import { OneEuroFilter, PinchMotionTracker, adaptPinchThresholds } from '../../apps/web/src/gestures/pinchMotion.ts';
import type { Landmark3D } from '../../apps/web/src/vision/visionManager.ts';

const FRAME_MS = 50; // ~20 FPS, the game's vision rate

/**
 * Synthetic hand with realistic proportions (hand scale 0.2 of the frame):
 * the thumb and index tips sit symmetrically around the pinch point (px, py),
 * `aperture` is the pinch ratio (thumb–index distance / hand scale), and
 * `thumbBias` shifts how much of the closing the thumb vs the index does.
 */
function makeHand(px: number, py: number, aperture: number, thumbBias = 0.5): Landmark3D[] {
  const scale = 0.2; // wrist→middle MCP and wrist→index MCP are both exactly this long
  const gap = aperture * scale;
  const hand: Landmark3D[] = Array.from({ length: 21 }, () => ({ x: px, y: py + 0.1, z: 0 })); // curled fingers
  hand[0] = { x: px, y: py + 0.25, z: 0 }; // wrist
  hand[5] = { x: px - 0.03, y: py + 0.25 - Math.sqrt(scale ** 2 - 0.03 ** 2), z: 0 }; // index MCP
  hand[9] = { x: px, y: py + 0.05, z: 0 }; // middle MCP
  hand[17] = { x: px + 0.06, y: py + 0.07, z: 0 }; // pinky MCP
  hand[4] = { x: px - gap * thumbBias, y: py, z: 0 }; // thumb tip
  hand[8] = { x: px + gap * (1 - thumbBias), y: py, z: 0 }; // index tip
  return hand;
}

// Board centers for White (camera middle 80% → 8x8): file e = x 0.55, f = 0.65; rank 2 = y 0.75, rank 4 = 0.55, rank 5 = 0.45
const E = 0.55;
const F = 0.65;
const RANK2 = 0.75;
const RANK4 = 0.55;
const RANK5 = 0.45;

test('synthetic hand reproduces the requested pinch ratio', () => {
  assert.ok(Math.abs(computePinchRatio(makeHand(0.5, 0.5, 0.6)) - 0.6) < 1e-9);
});

test('One Euro filter: smooths jitter when still, follows fast motion with little lag', () => {
  const still = new OneEuroFilter();
  let rawVar = 0;
  let outVar = 0;
  for (let i = 0; i < 60; i++) {
    const noise = (i % 2 === 0 ? 1 : -1) * 0.004; // ±4px-ish landmark jitter at 1000px
    const out = still.filter(0.5 + noise, i * FRAME_MS);
    if (i > 10) {
      rawVar += noise ** 2;
      outVar += (out - 0.5) ** 2;
    }
  }
  assert.ok(outVar < rawVar / 9, `jitter should drop >3x in amplitude (raw ${rawVar}, filtered ${outVar})`);

  const moving = new OneEuroFilter();
  let out = 0;
  let raw = 0;
  for (let i = 0; i <= 10; i++) {
    raw = 0.2 + i * 0.03; // sweeping 0.6 of the frame per second
    out = moving.filter(raw, i * FRAME_MS);
  }
  assert.ok(raw - out < 0.02, `lag while sweeping should stay under 2% of the frame (lag ${raw - out})`);
});

test('cursor is the thumb–index midpoint: a symmetric pinch lands exactly where the cursor was', () => {
  const controller = new ChessGestureController();
  const legal = { e2: ['e4' as const] };
  let t = 0;
  const xs: number[] = [];
  for (const aperture of [0.6, 0.6, 0.6, 0.6, 0.45, 0.3, 0.15, 0.1, 0.1, 0.1, 0.1]) {
    controller.update(makeHand(E, RANK2, aperture), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
    xs.push(controller.cursorPoint!.x);
  }
  assert.ok(xs.every(x => Math.abs(x - E) < 1e-9), `cursor must stay at the pinch point (${xs.map(x => x.toFixed(3))})`);
  assert.equal(controller.selectedSquare, 'e2');
});

test('index-led pinch: the cursor is frozen while the fingers close (the index tip alone travels ~4/5 of a square)', () => {
  const controller = new ChessGestureController();
  const legal = { e2: ['e4' as const] };
  let t = 0;
  const thumbBias = 0.2; // the index finger does 80% of the closing
  for (let i = 0; i < 6; i++) controller.update(makeHand(E, RANK2, 0.6, thumbBias), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  const openCursor = controller.cursorPoint!.x;
  const indexTravel = (0.6 - 0.1) * 0.2 * (1 - thumbBias);
  let maxShift = 0;
  for (const aperture of [0.45, 0.3, 0.15, 0.1]) {
    controller.update(makeHand(E, RANK2, aperture, thumbBias), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
    if (!controller.selectedSquare) maxShift = Math.max(maxShift, Math.abs(controller.cursorPoint!.x - openCursor));
  }
  assert.equal(controller.selectedSquare, 'e2');
  assert.ok(maxShift < 0.002, `cursor moved ${maxShift.toFixed(3)} while the index tip moved ${indexTravel.toFixed(3)}`);
});

test('grab lock: hand drift while the fingers close cannot change the grabbed square', () => {
  const controller = new ChessGestureController();
  const legal = { e2: ['e4' as const], f2: ['f4' as const] };
  const nearEdge = 0.595; // still e2, just left of the e/f border (0.6)
  let t = 0;
  for (let i = 0; i < 6; i++) controller.update(makeHand(nearEdge, RANK2, 0.6), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  assert.equal(controller.hoverSquare, 'e2');

  // Fingers close (3 hand-lengths/s) while the palm drifts right (1 hand-length/s) into f2.
  [0.45, 0.3, 0.15, 0.1, 0.1].forEach((aperture, i) => {
    controller.update(makeHand(nearEdge + 0.01 * (i + 1), RANK2, aperture), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  });
  assert.equal(controller.selectedSquare, 'e2', 'the square under the cursor when the pinch began is grabbed');

  // After the grab the piece follows the hand again: the drifted position really is f2.
  for (let i = 0; i < 6; i++) controller.update(makeHand(nearEdge + 0.05, RANK2, 0.1), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  assert.equal(controller.hoverSquare, 'f2');
});

test('moving vs pinching: a motion-induced aperture dip while sweeping the hand does not grab, the same dip with a steady hand does', () => {
  const legal = { e2: ['e4' as const], f2: ['f4' as const], d2: ['d4' as const] };
  const dip = [0.6, 0.5, 0.33, 0.33, 0.33, 0.5, 0.6]; // dips under the 0.38 close threshold, never a real pinch

  // Sweeping: palm moves 0.03/frame = 3 hand-lengths/s across rank 2.
  const sweeping = new ChessGestureController();
  let t = 0;
  let x = 0.3;
  for (let i = 0; i < 6; i++) sweeping.update(makeHand((x += 0.03), RANK2, 0.6), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  for (const aperture of dip) {
    sweeping.update(makeHand((x += 0.03), RANK2, aperture), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
    assert.equal(sweeping.isPinching, false, `sweep at x=${x.toFixed(2)} must not register as a pinch`);
  }

  const steady = new ChessGestureController();
  t = 0;
  for (let i = 0; i < 6; i++) steady.update(makeHand(E, RANK2, 0.6), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  let pinched = false;
  for (const aperture of dip) {
    steady.update(makeHand(E, RANK2, aperture), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
    pinched ||= steady.isPinching;
  }
  assert.equal(pinched, true, 'a steady hand closing to the calibrated threshold is a deliberate pinch');
});

test('a real, full pinch still grabs while the hand is moving', () => {
  const controller = new ChessGestureController();
  const legal = { e2: ['e4' as const], f2: ['f4' as const], d2: ['d4' as const], c2: ['c4' as const] };
  let t = 0;
  let x = 0.3;
  for (let i = 0; i < 6; i++) controller.update(makeHand((x += 0.03), RANK2, 0.6), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  for (const aperture of [0.4, 0.2, 0.1, 0.1, 0.1]) {
    controller.update(makeHand((x += 0.03), RANK2, aperture), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  }
  assert.equal(controller.isPinching, true);
  assert.ok(controller.selectedSquare, 'a piece is grabbed');
});

test('drop lock: hand drift while the fingers open cannot change the drop square', () => {
  const controller = new ChessGestureController();
  const legal = { e2: ['e4' as const, 'e5' as const] };
  let t = 0;
  for (let i = 0; i < 6; i++) controller.update(makeHand(E, RANK2, 0.6), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  for (const aperture of [0.3, 0.1, 0.1, 0.1]) controller.update(makeHand(E, RANK2, aperture), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  assert.equal(controller.selectedSquare, 'e2');

  // Drag up to e4 and settle there.
  for (let i = 1; i <= 8; i++) {
    const y = RANK2 + ((RANK4 - RANK2) * Math.min(i, 4)) / 4;
    controller.update(makeHand(E, y, 0.1), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
  }
  assert.equal(controller.hoverSquare, 'e4');

  // Open the fingers while the hand drifts up into e5.
  let intent = null;
  const opening = [0.25, 0.45, 0.65, 0.7, 0.7, 0.7, 0.7];
  opening.forEach((aperture, i) => {
    const y = RANK4 - Math.min(0.1, 0.025 * (i + 1));
    const res = controller.update(makeHand(E, y, aperture), 'w', legal as any, DEFAULT_CALIBRATION, (t += FRAME_MS));
    intent ??= res.intent;
  });
  assert.deepEqual(intent, { from: 'e2', to: 'e4' }, `dropped at ${JSON.stringify(intent)} instead of e4`);
  assert.ok(RANK5 < RANK4);
});

test('adaptive thresholds: calibrated when steady or deliberately pinching, firmer while the hand moves', () => {
  const base = { close: 0.38, open: 0.52 };
  const sample = (handSpeed: number, intent: 'steady' | 'moving' | 'closing') =>
    ({ point: { x: 0, y: 0 }, ratio: 0.5, handSpeed, apertureVelocity: 0, intent });
  assert.deepEqual(adaptPinchThresholds(base, sample(0.2, 'steady')), base);
  assert.deepEqual(adaptPinchThresholds(base, sample(3, 'closing')), base);
  const fast = adaptPinchThresholds(base, sample(3, 'moving'));
  assert.ok(fast.close < base.close && fast.open > base.open);
});

test('PinchMotionTracker: palm speed is measured in hand-lengths/s, independent of camera distance', () => {
  const near = new PinchMotionTracker();
  const far = new PinchMotionTracker();
  let a = { handSpeed: 0 };
  let b = { handSpeed: 0 };
  for (let i = 0; i < 10; i++) {
    a = near.update(makeHand(0.3 + i * 0.02, 0.5, 0.6), i * FRAME_MS);
    // Same physical motion seen from twice as far away: half the size, half the on-screen travel.
    const farHand = makeHand(0.3 + i * 0.01, 0.5, 0.6).map(p => ({ ...p, x: 0.3 + i * 0.01 + (p.x - (0.3 + i * 0.01)) / 2, y: 0.5 + (p.y - 0.5) / 2 }));
    b = far.update(farHand, i * FRAME_MS);
  }
  assert.ok(Math.abs(a.handSpeed - b.handSpeed) < 0.05 * a.handSpeed, `near ${a.handSpeed} vs far ${b.handSpeed}`);
});
