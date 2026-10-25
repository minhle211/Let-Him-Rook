import test from 'node:test';
import assert from 'node:assert/strict';
import { pointToBoardSquare } from '@let-him-rook/shared';
import {
  DEFAULT_CALIBRATION,
  PinchTracker,
  isOpenPalm,
  findLeftHand,
  findRightHand,
  computeWholeHandTilt,
} from '../../apps/web/src/gestures/calibration.ts';
import { ChessGestureController } from '../../apps/web/src/gestures/chessGestures.ts';
import {
  CombatGestureDetector,
  LeftHandCameraController,
  TorsoLeanController,
} from '../../apps/web/src/gestures/combatGestures.ts';
import type { Landmark3D } from '../../apps/web/src/vision/visionManager.ts';

test('Board Coordinates: pointToBoardSquare maps perspective and respects margins', () => {
  // Center of camera (0.5, 0.5)
  // For White, center is around d4/e4/d5/e5
  const sqW = pointToBoardSquare({ x: 0.5, y: 0.5 }, 'w');
  assert.ok(sqW === 'd4' || sqW === 'e4' || sqW === 'd5' || sqW === 'e5');

  // For Black, board is flipped
  const sqB = pointToBoardSquare({ x: 0.5, y: 0.5 }, 'b');
  assert.ok(sqB === 'd4' || sqB === 'e4' || sqB === 'd5' || sqB === 'e5');

  // Points outside middle 80% (e.g. x < 0.1 or y > 0.9) return null
  assert.equal(pointToBoardSquare({ x: 0.05, y: 0.5 }, 'w'), null);
  assert.equal(pointToBoardSquare({ x: 0.95, y: 0.5 }, 'w'), null);
  assert.equal(pointToBoardSquare({ x: 0.5, y: 0.05 }, 'w'), null);
  assert.equal(pointToBoardSquare({ x: 0.5, y: 0.95 }, 'w'), null);
});

test('Board Coordinates: Hysteresis preserves previous square across small border jitter', () => {
  // Select a target square
  const initial = pointToBoardSquare({ x: 0.5, y: 0.5 }, 'w');
  assert.ok(initial);

  // Small boundary jitter (slight offset that would barely touch adjacent boundary)
  const jittered = pointToBoardSquare({ x: 0.51, y: 0.51 }, 'w', initial);
  assert.equal(jittered, initial, 'Hysteresis must hold target square across jitter');

  // Deliberate large crossing changes square
  const moved = pointToBoardSquare({ x: 0.25, y: 0.25 }, 'w', initial);
  assert.notEqual(moved, initial, 'Deliberate motion must update target square');
});

test('Pinch Tracker: debounces release and tolerates brief tracking gap', () => {
  const tracker = new PinchTracker({ close: 0.38, open: 0.50 });

  // Arm tracker with open hand (2 frames to settle median)
  tracker.update(0.60, 950);
  assert.equal(tracker.update(0.60, 1000), 'hover');

  // Pinch closed (2 frames to settle median)
  tracker.update(0.25, 1040);
  assert.equal(tracker.update(0.25, 1080), 'start');
  assert.equal(tracker.update(0.25, 1120), 'draw');

  // Brief opening spike (< 120ms) is held, does not release
  tracker.update(0.55, 1150);
  assert.equal(tracker.update(0.55, 1180), 'hold');

  // Sustained opening (> 120ms) confirms release
  assert.equal(tracker.update(0.55, 1320), 'end');
});

test('Open Palm Detection: detects extended fingers and rejects curled fist', () => {
  // Create mock hand with extended fingers (tips far from wrist)
  const openHand: Landmark3D[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  openHand[0] = { x: 0.5, y: 0.8, z: 0 }; // Wrist at bottom
  // Knuckles
  openHand[2] = { x: 0.45, y: 0.65, z: 0 };
  openHand[5] = { x: 0.48, y: 0.60, z: 0 };
  openHand[9] = { x: 0.50, y: 0.58, z: 0 };
  openHand[13] = { x: 0.52, y: 0.60, z: 0 };
  openHand[17] = { x: 0.55, y: 0.63, z: 0 };
  // Tips extended high up
  openHand[4] = { x: 0.40, y: 0.40, z: 0 };
  openHand[8] = { x: 0.48, y: 0.30, z: 0 };
  openHand[12] = { x: 0.50, y: 0.28, z: 0 };
  openHand[16] = { x: 0.52, y: 0.30, z: 0 };
  openHand[20] = { x: 0.56, y: 0.35, z: 0 };

  assert.equal(isOpenPalm(openHand), true);

  // Curled fist (tips curled down near knuckles)
  const fist: Landmark3D[] = JSON.parse(JSON.stringify(openHand));
  fist[8] = { x: 0.48, y: 0.65, z: 0 }; // index tip curled below knuckle
  assert.equal(isOpenPalm(fist), false);
});

test('Chess Gestures: Pick, hover, and release executes legal move; Open Palm cancels', () => {
  const controller = new ChessGestureController();
  const legalMoves = {
    e2: ['e4' as const],
    e4: [],
  };

  // Mock hand whose pinch point (thumb–index midpoint) is on e2 (x = 0.53, y = 0.75 for White)
  const mockHand: Landmark3D[] = Array.from({ length: 21 }, () => ({ x: 0.53, y: 0.75, z: 0 }));
  mockHand[0] = { x: 0.53, y: 0.9, z: 0 };
  mockHand[5] = { x: 0.53, y: 0.7, z: 0 };

  // 1. Arm with open pose (2 frames for median): thumb and index apart, centered on e2
  mockHand[4] = { x: 0.47, y: 0.75, z: 0 }; // Thumb tip
  mockHand[8] = { x: 0.59, y: 0.75, z: 0 }; // Index tip
  controller.update(mockHand, 'w', legalMoves as any, DEFAULT_CALIBRATION, 950);
  controller.update(mockHand, 'w', legalMoves as any, DEFAULT_CALIBRATION, 1000);

  // 2. Pinch at e2 (thumb and index meet in the middle, 2 frames for median)
  mockHand[4] = { x: 0.53, y: 0.75, z: 0 };
  mockHand[8] = { x: 0.53, y: 0.75, z: 0 };
  controller.update(mockHand, 'w', legalMoves as any, DEFAULT_CALIBRATION, 1040);
  controller.update(mockHand, 'w', legalMoves as any, DEFAULT_CALIBRATION, 1080);
  assert.equal(controller.selectedSquare, 'e2');

  // 3. Open palm cancels selection
  // Set extended open palm
  for (let i = 0; i < 5; i++) {
    mockHand[[4, 8, 12, 16, 20][i]] = { x: 0.5, y: 0.2, z: 0 };
    mockHand[[2, 5, 9, 13, 17][i]] = { x: 0.5, y: 0.6, z: 0 };
  }
  for (let f = 0; f < 5; f++) {
    controller.update(mockHand, 'w', legalMoves as any, DEFAULT_CALIBRATION, 1120 + f * 40);
  }
  assert.equal(controller.selectedSquare, null, 'Open palm hold must cancel selection');
});

test('Combat Gesture Detector: Rook extended arm trigger and WAIT_RELEASE re-arming', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  mockPose[12] = { x: 0.5, y: 0.5, z: 0 }; // Right shoulder
  mockPose[14] = { x: 0.3, y: 0.6, z: 0 }; // Right elbow (bent to side)
  mockPose[16] = { x: 0.5, y: 0.55, z: 0 }; // Right wrist (curled to chest)

  // Arm bent: no trigger
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1000), null);

  // Fully extend right arm forward (triggers on 2nd frame)
  mockPose[14] = { x: 0.5, y: 0.75, z: 0 };
  mockPose[16] = { x: 0.5, y: 1.0, z: 0 }; // Fully extended

  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1040), null);
  const shot = detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1080);
  assert.ok(shot);
  assert.equal(shot.ability, 'rook_shot');

  // Holding extended arm does NOT spam shots: requires dropping arm (WAIT_RELEASE)
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1120), null);
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1160), null);

  // Drop arm to neutral
  mockPose[14] = { x: 0.3, y: 0.6, z: 0 };
  mockPose[16] = { x: 0.5, y: 0.55, z: 0 };
  detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1250);

  // Extend again: fires 2nd shot on 2nd frame!
  mockPose[14] = { x: 0.5, y: 0.75, z: 0 };
  mockPose[16] = { x: 0.5, y: 1.0, z: 0 };
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1300), null);
  const shot2 = detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1340);
  assert.ok(shot2);
  assert.equal(shot2.ability, 'rook_shot');
});

test('Combat Gesture Detector: Knight right-hand overhead raise and downward chop triggers cleave with re-arming', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  mockPose[12] = { x: 0.6, y: 0.5, z: 0 }; // Right shoulder

  // Right wrist raised above shoulder (y = 0.40 < 0.50 - 0.05)
  mockPose[16] = { x: 0.6, y: 0.40, z: 0 };
  detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1000);

  // Rapid downward chop (y = 0.72 > 0.50 + 0.18) within 600ms
  mockPose[16] = { x: 0.6, y: 0.72, z: 0 };
  const cleave = detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1200);
  assert.ok(cleave);
  assert.equal(cleave.ability, 'knight_cleave');

  // Holding wrist down does not spam cleave
  assert.equal(detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1240), null);

  // Return wrist to neutral (y = 0.55 <= 0.50 + 0.12)
  mockPose[16] = { x: 0.6, y: 0.55, z: 0 };
  detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1300);

  // Raise again and chop down: fires 2nd cleave!
  mockPose[16] = { x: 0.6, y: 0.40, z: 0 };
  detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1350);

  mockPose[16] = { x: 0.6, y: 0.72, z: 0 };
  const cleave2 = detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1500);
  assert.ok(cleave2);
  assert.equal(cleave2.ability, 'knight_cleave');
});

test('Combat Gesture Detector: Bishop palm cocked and forward thrust triggers ice bolt with re-arming', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  mockPose[12] = { x: 0.5, y: 0.5, z: 0 }; // Right shoulder

  // Palm cocked near shoulder (dist < 0.15)
  mockPose[16] = { x: 0.55, y: 0.52, z: 0 }; // Right wrist near shoulder
  detector.update('bishop', mockPose, [], DEFAULT_CALIBRATION, 1000);

  // Forward thrust away from shoulder (dist = 0.40)
  mockPose[16] = { x: 0.5, y: 0.90, z: 0 };
  const bolt = detector.update('bishop', mockPose, [], DEFAULT_CALIBRATION, 1200);
  assert.ok(bolt);
  assert.equal(bolt.ability, 'bishop_ice_bolt');

  // Holding hand thrust forward does NOT spam
  assert.equal(detector.update('bishop', mockPose, [], DEFAULT_CALIBRATION, 1240), null);

  // Retract hand back toward body (dist < 0.25)
  mockPose[16] = { x: 0.55, y: 0.65, z: 0 };
  detector.update('bishop', mockPose, [], DEFAULT_CALIBRATION, 1300);

  // Cock and thrust again: fires 2nd ice bolt!
  mockPose[16] = { x: 0.55, y: 0.52, z: 0 };
  detector.update('bishop', mockPose, [], DEFAULT_CALIBRATION, 1350);

  mockPose[16] = { x: 0.5, y: 0.90, z: 0 };
  const bolt2 = detector.update('bishop', mockPose, [], DEFAULT_CALIBRATION, 1500);
  assert.ok(bolt2);
  assert.equal(bolt2.ability, 'bishop_ice_bolt');
});

const createRightHandLandmarks = (isOpen = true, handX = 0.65): Landmark3D[] => {
  const hand: Landmark3D[] = Array.from({ length: 21 }, () => ({ x: handX, y: 0.6, z: 0 }));
  hand[0] = { x: handX, y: 0.7, z: 0 };
  if (isOpen) {
    for (let i = 0; i < 5; i++) {
      hand[[4, 8, 12, 16, 20][i]] = { x: handX, y: 0.3, z: 0 };
      hand[[2, 5, 9, 13, 17][i]] = { x: handX, y: 0.55, z: 0 };
    }
  } else {
    for (let i = 0; i < 5; i++) {
      hand[[4, 8, 12, 16, 20][i]] = { x: handX, y: 0.65, z: 0 };
      hand[[2, 5, 9, 13, 17][i]] = { x: handX, y: 0.60, z: 0 };
    }
  }
  return hand;
};

test('Combat Gesture Detector: Pawn right-hand slash, parry hold/release, and mutual exclusion', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  const rightOpenPalm = createRightHandLandmarks(true, 0.6);

  // 1. Stationary open right palm -> Parry hold
  mockPose[16] = { x: 0.6, y: 0.5, z: 0 };
  const parryStart = detector.update('pawn', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1000);
  assert.ok(parryStart);
  assert.equal(parryStart.ability, 'pawn_parry');
  assert.equal(parryStart.parryHolding, true);

  // 2. Mutual exclusion: while parrying, rapid wrist sweep causes parry to release and DOES NOT fire slash on same frame
  mockPose[16] = { x: 0.2, y: 0.5, z: 0 }; // dx = -0.4 in 50ms => vx = -8.0
  const parryReleaseOnSweep = detector.update('pawn', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1050);
  assert.ok(parryReleaseOnSweep);
  assert.equal(parryReleaseOnSweep.ability, 'pawn_parry');
  assert.equal(parryReleaseOnSweep.parryHolding, false);

  // Settle wrist to neutral speed (vx < 1.0)
  mockPose[16] = { x: 0.2, y: 0.5, z: 0 };
  detector.update('pawn', mockPose, [], DEFAULT_CALIBRATION, 1100);

  // 3. Normal slash from IDLE
  mockPose[16] = { x: 0.6, y: 0.5, z: 0 }; // vx = 8.0
  const sweep = detector.update('pawn', mockPose, [], DEFAULT_CALIBRATION, 1150);
  assert.ok(sweep);
  assert.equal(sweep.ability, 'pawn_sweep');

  // 4. Parry is blocked for 200ms after slash
  mockPose[16] = { x: 0.6, y: 0.5, z: 0 };
  const blockedParry = detector.update('pawn', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1250);
  assert.equal(blockedParry, null);

  // After 200ms (1150 + 250 = 1400), parry can activate again
  const parryAfterCooldown = detector.update('pawn', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1400);
  assert.ok(parryAfterCooldown);
  assert.equal(parryAfterCooldown.ability, 'pawn_parry');
  assert.equal(parryAfterCooldown.parryHolding, true);

  // Lower hand -> parry release
  const parryRelease = detector.update('pawn', mockPose, [], DEFAULT_CALIBRATION, 1450);
  assert.ok(parryRelease);
  assert.equal(parryRelease.ability, 'pawn_parry');
  assert.equal(parryRelease.parryHolding, false);
});

test('Combat Gesture Detector: Queen right open palm raised near shoulder triggers volley with re-arming', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  mockPose[12] = { x: 0.6, y: 0.5, z: 0 }; // Right shoulder
  mockPose[16] = { x: 0.65, y: 0.48, z: 0 }; // Right wrist near shoulder (<= 0.5 + 0.10)
  const rightOpenPalm = createRightHandLandmarks(true, 0.65);

  // Held raised with open palm for 2 frames
  assert.equal(detector.update('queen', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1000), null);
  const volley = detector.update('queen', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1040);
  assert.ok(volley);
  assert.equal(volley.ability, 'queen_volley');

  // Holding raised does not spam
  assert.equal(detector.update('queen', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1120), null);

  // Lower hand (y = 0.70)
  mockPose[16] = { x: 0.65, y: 0.70, z: 0 };
  detector.update('queen', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1200);

  // Raise again for 2 frames: fires 2nd volley
  mockPose[16] = { x: 0.65, y: 0.48, z: 0 };
  assert.equal(detector.update('queen', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1250), null);
  const volley2 = detector.update('queen', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1290);
  assert.ok(volley2);
  assert.equal(volley2.ability, 'queen_volley');
});

test('Combat Gesture Detector: King closed right fist at chest center held for 220ms triggers summon', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  mockPose[11] = { x: 0.4, y: 0.5, z: 0 }; // Left shoulder
  mockPose[12] = { x: 0.6, y: 0.5, z: 0 }; // Right shoulder
  // chestCenter = { x: 0.5, y: 0.56 }
  mockPose[16] = { x: 0.51, y: 0.55, z: 0 }; // Right wrist at chest (dist ≈ 0.014 < 0.15)
  const rightFist = createRightHandLandmarks(false, 0.51);

  // Held for 150ms (< 220ms): not yet ready
  assert.equal(detector.update('king', mockPose, [rightFist], DEFAULT_CALIBRATION, 1000), null);
  assert.equal(detector.update('king', mockPose, [rightFist], DEFAULT_CALIBRATION, 1150), null);

  // Held for >= 220ms: triggers summon!
  const summon = detector.update('king', mockPose, [rightFist], DEFAULT_CALIBRATION, 1250);
  assert.ok(summon);
  assert.equal(summon.ability, 'king_summon');

  // Move away (dist > 0.22) re-arms
  mockPose[16] = { x: 0.8, y: 0.55, z: 0 };
  detector.update('king', mockPose, [rightFist], DEFAULT_CALIBRATION, 1500);

  // Move back to chest and hold >= 220ms
  mockPose[16] = { x: 0.51, y: 0.55, z: 0 };
  detector.update('king', mockPose, [rightFist], DEFAULT_CALIBRATION, 1550);
  const summon2 = detector.update('king', mockPose, [rightFist], DEFAULT_CALIBRATION, 1800);
  assert.ok(summon2);
  assert.equal(summon2.ability, 'king_summon');
});

test('LeftHandCameraController: Five fingers open pointing at camera acts as neutral position, tilting left/right steers camera', () => {
  const controller = new LeftHandCameraController();

  const createOpenLeftHand = (tiltRatio: number, handX = 0.3, openFingers = true): Landmark3D[] => {
    const hand: Landmark3D[] = Array.from({ length: 21 }, () => ({ x: handX, y: 0.6, z: 0 }));
    const wristY = 0.75;
    hand[0] = { x: handX, y: wristY, z: 0 };
    const t = Math.max(-0.95, Math.min(0.95, tiltRatio));
    const cosT = Math.sqrt(1 - t * t);

    const rotate = (rx: number, ry: number) => ({
      x: handX + rx * cosT - ry * t,
      y: wristY + rx * t + ry * cosT,
      z: 0,
    });

    // Knuckles relative to wrist when upright (ry < 0 is upward)
    hand[2] = rotate(-0.06, -0.10); // Thumb MCP
    hand[5] = rotate(-0.03, -0.15); // Index MCP
    hand[9] = rotate(0, -0.16);     // Middle MCP
    hand[13] = rotate(0.03, -0.15); // Ring MCP
    hand[17] = rotate(0.05, -0.13); // Pinky MCP

    if (openFingers) {
      // Extended fingertips (tips far from wrist)
      hand[4] = rotate(-0.09, -0.22); // Thumb tip
      hand[8] = rotate(-0.03, -0.32); // Index tip
      hand[12] = rotate(0, -0.35);    // Middle tip
      hand[16] = rotate(0.03, -0.32); // Ring tip
      hand[20] = rotate(0.05, -0.28); // Pinky tip
    } else {
      // Curled fist (tips close to knuckles/wrist)
      hand[4] = rotate(-0.04, -0.08);
      hand[8] = rotate(-0.02, -0.11);
      hand[12] = rotate(0, -0.12);
      hand[16] = rotate(0.02, -0.11);
      hand[20] = rotate(0.04, -0.10);
    }
    return hand;
  };

  // 1. Upright five fingers open pointing at camera (tiltRatio = 0) is neutral
  const upright = createOpenLeftHand(0);
  const res1 = controller.update([upright], null, 1000);
  assert.equal(res1.active, true);
  assert.equal(res1.turnDir, 0);

  // 2. Closed fist (five fingers not open) is inactive
  const fist = createOpenLeftHand(0, 0.3, false);
  const fistRes = controller.update([fist], null, 1020);
  assert.equal(fistRes.active, false);
  assert.equal(fistRes.turnDir, 0);

  // 3. Tilted left with five fingers open (tiltRatio = -0.55 => reaches activate threshold 0.45 after smoothing and 120ms debounce)
  const tiltLeft = createOpenLeftHand(-0.55);
  controller.update([tiltLeft], null, 1050);
  controller.update([tiltLeft], null, 1150);
  controller.update([tiltLeft], null, 1250);
  const leftRes = controller.update([tiltLeft], null, 1400);
  assert.equal(leftRes.turnDir, -1);

  // 4. Hysteresis: tilt recovers to -0.30 (still within release threshold 0.26), does NOT prematurely drop
  const partialLeft = createOpenLeftHand(-0.30);
  const stillLeft = controller.update([partialLeft], null, 1450);
  assert.equal(stillLeft.turnDir, -1);

  // Tilt recovers back upright (tiltRatio = 0) -> drops to neutral
  controller.update([upright], null, 1500);
  const released = controller.update([upright], null, 1550);
  assert.equal(released.turnDir, 0);

  // 5. Tilted right with five fingers open (tiltRatio = +0.55 => reaches activate threshold 0.45 after smoothing and debounce)
  const tiltRight = createOpenLeftHand(0.55);
  controller.update([tiltRight], null, 1600);
  controller.update([tiltRight], null, 1700);
  controller.update([tiltRight], null, 1800);
  const rightRes = controller.update([tiltRight], null, 1950);
  assert.equal(rightRes.turnDir, 1);

  // 6. Baseline tilt offset: if calibrated baseline is +0.20, raw tilt +0.20 is treated as 0 (neutral)
  controller.reset();
  const profileWithBaseline = { ...DEFAULT_CALIBRATION, cameraBaselineTilt: 0.20 };
  const rawTilt20 = createOpenLeftHand(0.20);
  const baselineRes = controller.update([rawTilt20], null, 2000, profileWithBaseline);
  assert.equal(baselineRes.turnDir, 0);
  assert.ok(Math.abs(baselineRes.tilt) < 0.05);

  // 7. Camera sensitivity scaling: 1.5x requires higher tilt angle to trigger
  controller.reset();
  const lowSensProfile = { ...DEFAULT_CALIBRATION, movementSensitivity: { forward: 1, backward: 1, left: 1, right: 1, camera: 1.5 } };
  const tilt55 = createOpenLeftHand(0.55);
  controller.update([tilt55], null, 2100, lowSensProfile);
  controller.update([tilt55], null, 2200, lowSensProfile);
  controller.update([tilt55], null, 2300, lowSensProfile);
  const lowSensRes = controller.update([tilt55], null, 2450, lowSensProfile);
  assert.equal(lowSensRes.turnDir, 0);

  // 8. Crossed wrists suppresses turning
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  mockPose[15] = { x: 0.49, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.51, y: 0.5, z: 0 }; // wristDist = 0.02
  const crossedRes = controller.update([tiltLeft], mockPose, 2500);
  assert.equal(crossedRes.active, false);
  assert.equal(crossedRes.turnDir, 0);
});

test('findLeftHand and findRightHand resolve hand ambiguity via pose wrists without crosstalk', () => {
  const makeHand = (x: number, y: number): Landmark3D[] => {
    const hand = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
    hand[0] = { x, y, z: 0 };
    return hand;
  };

  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));

  // 1. Single hand at center (x = 0.50) matching right wrist pose[16]
  mockPose[15] = { x: 0.25, y: 0.85, z: 0, visibility: 0.9 }; // left wrist down
  mockPose[16] = { x: 0.50, y: 0.55, z: 0, visibility: 0.9 }; // right wrist at chest
  const rightChestHand = makeHand(0.50, 0.55);

  const matchedRight = findRightHand([rightChestHand], mockPose);
  assert.equal(matchedRight, rightChestHand, 'Must match right hand at right wrist');

  const crosstalkLeft = findLeftHand([rightChestHand], mockPose);
  assert.equal(crosstalkLeft, null, 'Must NOT misclassify right wrist hand as left hand');

  // 2. Single hand at center-left (x = 0.45) matching left wrist pose[15]
  mockPose[15] = { x: 0.45, y: 0.50, z: 0, visibility: 0.9 }; // left wrist raised
  mockPose[16] = { x: 0.75, y: 0.85, z: 0, visibility: 0.9 }; // right wrist down
  const leftRaisedHand = makeHand(0.45, 0.50);

  const matchedLeft = findLeftHand([leftRaisedHand], mockPose);
  assert.equal(matchedLeft, leftRaisedHand, 'Must match left hand at left wrist');

  const crosstalkRight = findRightHand([leftRaisedHand], mockPose);
  assert.equal(crosstalkRight, null, 'Must NOT misclassify left wrist hand as right hand');

  // 3. Both hands on left side of screen (x < 0.50)
  mockPose[15] = { x: 0.20, y: 0.50, z: 0, visibility: 0.9 };
  mockPose[16] = { x: 0.40, y: 0.50, z: 0, visibility: 0.9 };
  const handA = makeHand(0.20, 0.50);
  const handB = makeHand(0.40, 0.50);

  assert.equal(findLeftHand([handA, handB], mockPose), handA);
  assert.equal(findRightHand([handA, handB], mockPose), handB);
});

test('Combat Gesture Detector: Pawn counter-attack sweep immediately fires slash on subsequent frame', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  const rightOpenPalm = createRightHandLandmarks(true, 0.6);

  // 1. Stationary open right palm -> Parry hold
  mockPose[16] = { x: 0.6, y: 0.5, z: 0 };
  const parryStart = detector.update('pawn', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1000);
  assert.ok(parryStart);
  assert.equal(parryStart.ability, 'pawn_parry');
  assert.equal(parryStart.parryHolding, true);

  // 2. Rapid sweep begins: frame 1 releases parry
  mockPose[16] = { x: 0.2, y: 0.5, z: 0 }; // dx = -0.4 in 50ms => vx = -8.0
  const parryRelease = detector.update('pawn', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1050);
  assert.ok(parryRelease);
  assert.equal(parryRelease.ability, 'pawn_parry');
  assert.equal(parryRelease.parryHolding, false);

  // 3. Same continuous sweep continues: frame 2 immediately fires slash!
  mockPose[16] = { x: -0.1, y: 0.5, z: 0 }; // dx = -0.3 in 30ms => vx = -10.0
  const counterSlash = detector.update('pawn', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1080);
  assert.ok(counterSlash, 'Counter-attack slash must fire immediately on subsequent sweep frame');
  assert.equal(counterSlash.ability, 'pawn_sweep');

  // 4. Continued sweep does not spam multiple slashes (held in WAIT_RELEASE)
  mockPose[16] = { x: -0.4, y: 0.5, z: 0 }; // vx = -10.0
  assert.equal(detector.update('pawn', mockPose, [rightOpenPalm], DEFAULT_CALIBRATION, 1110), null);

  // 5. Hand slows down to rest (vx < 1.0) -> resets to IDLE
  mockPose[16] = { x: -0.4, y: 0.5, z: 0 };
  assert.equal(detector.update('pawn', mockPose, [], DEFAULT_CALIBRATION, 1150), null);
});

test('LeftHandCameraController: brief frame gap (<250ms) preserves smoothed tilt while sustained gap (>250ms) resets', () => {
  const controller = new LeftHandCameraController();
  const createLeftHand = (tiltRatio: number): Landmark3D[] => {
    const hand: Landmark3D[] = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.6, z: 0 }));
    const wristY = 0.75;
    hand[0] = { x: 0.3, y: wristY, z: 0 };
    const t = Math.max(-0.95, Math.min(0.95, tiltRatio));
    const cosT = Math.sqrt(1 - t * t);
    const rotate = (rx: number, ry: number) => ({
      x: 0.3 + rx * cosT - ry * t,
      y: wristY + rx * t + ry * cosT,
      z: 0,
    });
    hand[2] = rotate(-0.06, -0.10);
    hand[5] = rotate(-0.03, -0.15);
    hand[9] = rotate(0, -0.16);
    hand[13] = rotate(0.03, -0.15);
    hand[17] = rotate(0.05, -0.13);
    hand[4] = rotate(-0.09, -0.22);
    hand[8] = rotate(-0.03, -0.32);
    hand[12] = rotate(0, -0.35);
    hand[16] = rotate(0.03, -0.32);
    hand[20] = rotate(0.05, -0.28);
    return hand;
  };

  const tiltLeft = createLeftHand(-0.55);

  // Engage left turn
  controller.update([tiltLeft], null, 1000);
  controller.update([tiltLeft], null, 1100);
  controller.update([tiltLeft], null, 1200);
  const activeRes = controller.update([tiltLeft], null, 1350);
  assert.equal(activeRes.turnDir, -1);

  // Brief tracking drop (30ms) returns inactive, but does not wipe smoothed state
  const dropRes = controller.update([], null, 1380);
  assert.equal(dropRes.active, false);
  assert.equal(dropRes.turnDir, 0);

  // Tracking resumes at 1410ms (<250ms drop) -> immediately resumes active left turn
  const resumeRes = controller.update([tiltLeft], null, 1410);
  assert.equal(resumeRes.active, true);
  assert.equal(resumeRes.turnDir, -1);

  // Sustained tracking loss (>250ms drop) -> hard resets
  const longDropRes = controller.update([], null, 1750);
  assert.equal(longDropRes.active, false);
  assert.equal(longDropRes.turnDir, 0);

  // Re-entering requires settling and debounce again
  const restartRes = controller.update([tiltLeft], null, 1780);
  assert.equal(restartRes.turnDir, 0, 'Must require re-arming debounce after sustained tracking loss');
});
