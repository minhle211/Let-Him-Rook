import test from 'node:test';
import assert from 'node:assert/strict';
import { pointToBoardSquare } from '@let-him-rook/shared';
import {
  DEFAULT_CALIBRATION,
  PinchTracker,
  isOpenPalm,
} from '../../apps/web/src/gestures/calibration.ts';
import { ChessGestureController } from '../../apps/web/src/gestures/chessGestures.ts';
import {
  CombatGestureDetector,
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

  // Mock hand pointing at e2 (y = 0.75 maps to rank 2 for White)
  const mockHand: Landmark3D[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.75, z: 0 }));
  mockHand[0] = { x: 0.5, y: 0.9, z: 0 };
  mockHand[5] = { x: 0.5, y: 0.7, z: 0 };
  mockHand[8] = { x: 0.5, y: 0.75, z: 0 }; // Index tip

  // 1. Arm with open pose (2 frames for median)
  mockHand[4] = { x: 0.3, y: 0.75, z: 0 }; // Thumb far away
  controller.update(mockHand, 'w', legalMoves as any, DEFAULT_CALIBRATION, 950);
  controller.update(mockHand, 'w', legalMoves as any, DEFAULT_CALIBRATION, 1000);

  // 2. Pinch at e2 (thumb and index touch, 2 frames for median)
  mockHand[4] = { x: 0.5, y: 0.75, z: 0 };
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

test('Torso Lean Controller: Deadzone filter and tracking loss cutoff', () => {
  const controller = new TorsoLeanController();
  const calib = {
    ...DEFAULT_CALIBRATION,
    neutralTorsoCenter: { x: 0.5, y: 0.5 },
    shoulderWidth: 0.3,
  };

  // Pose with minimal deviation (inside 0.12 deadzone)
  const neutralPose: Landmark3D[] = Array.from({ length: 15 }, () => ({ x: 0, y: 0, z: 0 }));
  neutralPose[11] = { x: 0.35, y: 0.5, z: 0 }; // Left shoulder
  neutralPose[12] = { x: 0.65, y: 0.5, z: 0 }; // Right shoulder (center = 0.5, 0.5)

  const idleLean = controller.update(neutralPose, calib, 1000);
  assert.equal(idleLean.moveX, 0);
  assert.equal(idleLean.moveZ, 0);

  // Leaning to the right
  const rightPose = JSON.parse(JSON.stringify(neutralPose));
  rightPose[11] = { x: 0.45, y: 0.5, z: 0 };
  rightPose[12] = { x: 0.75, y: 0.5, z: 0 }; // Center = 0.60 -> dx = +0.10
  const rightLean = controller.update(rightPose, calib, 1050);
  assert.ok(rightLean.moveX > 0.4, 'Must register rightward lean');

  // Tracking loss < 300ms: holds last movement intent across dropped frame
  const graceLean = controller.update(null, calib, 1150);
  assert.ok(graceLean.moveX > 0.4, 'Must hold intent during < 300ms grace window');

  // Tracking loss > 300ms: zeroes movement intent
  const lostLean = controller.update(null, calib, 1400);
  assert.equal(lostLean.moveX, 0);
  assert.equal(lostLean.moveZ, 0);
});

test('Combat Gesture Detector: Rook extended arm trigger and WAIT_RELEASE re-arming', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  mockPose[12] = { x: 0.5, y: 0.5, z: 0 }; // Right shoulder
  mockPose[14] = { x: 0.3, y: 0.6, z: 0 }; // Right elbow (bent to side)
  mockPose[16] = { x: 0.5, y: 0.55, z: 0 }; // Right wrist (curled to chest)

  // Arm bent: no trigger
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1000), null);

  // Fully extend right arm forward
  mockPose[14] = { x: 0.5, y: 0.75, z: 0 };
  mockPose[16] = { x: 0.5, y: 1.0, z: 0 }; // Fully extended

  detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1040);
  detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1080);
  const shot = detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1120);
  assert.ok(shot);
  assert.equal(shot.ability, 'rook_shot');

  // Holding extended arm does NOT spam shots: requires dropping arm (WAIT_RELEASE)
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1160), null);
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1200), null);

  // Drop arm to neutral
  mockPose[14] = { x: 0.3, y: 0.6, z: 0 };
  mockPose[16] = { x: 0.5, y: 0.55, z: 0 };
  detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1250);

  // Extend again: fires 2nd shot!
  mockPose[14] = { x: 0.5, y: 0.75, z: 0 };
  mockPose[16] = { x: 0.5, y: 1.0, z: 0 };
  detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1300);
  detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1340);
  const shot2 = detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1380);
  assert.ok(shot2);
  assert.equal(shot2.ability, 'rook_shot');
});

test('Combat Gesture Detector: Knight crossed forearms and rapid separation triggers cleave with re-arming', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));

  // Cross wrists in front of chest (wristDist = 0.04)
  mockPose[15] = { x: 0.48, y: 0.5, z: 0 }; // Left wrist
  mockPose[16] = { x: 0.52, y: 0.5, z: 0 }; // Right wrist
  detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1000);

  // Rapid horizontal separation (wristDist = 0.40)
  mockPose[15] = { x: 0.30, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.70, y: 0.5, z: 0 };
  const cleave = detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1200);
  assert.ok(cleave);
  assert.equal(cleave.ability, 'knight_cleave');

  // Holding wrists separated does not spam cleave
  assert.equal(detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1240), null);

  // Return wrists to neutral (< 0.28)
  mockPose[15] = { x: 0.40, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.60, y: 0.5, z: 0 };
  detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1300);

  // Cross again and separate: fires 2nd cleave!
  mockPose[15] = { x: 0.48, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.52, y: 0.5, z: 0 };
  detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 1350);

  mockPose[15] = { x: 0.30, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.70, y: 0.5, z: 0 };
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

test('Combat Gesture Detector: Pawn sweep velocity and parry hold/release', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));

  // Frame 1: right wrist at x = 0.2
  mockPose[16] = { x: 0.2, y: 0.5, z: 0 };
  detector.update('pawn', mockPose, [], DEFAULT_CALIBRATION, 1000);

  // Frame 2: rapid horizontal sweep across torso (dx = 0.4 in 50ms => vx = 8.0)
  mockPose[16] = { x: 0.6, y: 0.5, z: 0 };
  const sweep = detector.update('pawn', mockPose, [], DEFAULT_CALIBRATION, 1050);
  assert.ok(sweep);
  assert.equal(sweep.ability, 'pawn_sweep');

  // Left hand open palm raised -> Parry hold
  const openLeftHand: Landmark3D[] = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.5, z: 0 }));
  openLeftHand[0] = { x: 0.3, y: 0.7, z: 0 };
  for (let i = 0; i < 5; i++) {
    openLeftHand[[4, 8, 12, 16, 20][i]] = { x: 0.3, y: 0.3, z: 0 }; // Extended high
    openLeftHand[[2, 5, 9, 13, 17][i]] = { x: 0.3, y: 0.6, z: 0 };
  }

  const parryStart = detector.update('pawn', mockPose, [openLeftHand], DEFAULT_CALIBRATION, 1100);
  assert.ok(parryStart);
  assert.equal(parryStart.ability, 'pawn_parry');
  assert.equal(parryStart.parryHolding, true);

  // Lower hand -> Parry release
  const parryEnd = detector.update('pawn', mockPose, [], DEFAULT_CALIBRATION, 1200);
  assert.ok(parryEnd);
  assert.equal(parryEnd.ability, 'pawn_parry');
  assert.equal(parryEnd.parryHolding, false);
});

test('Combat Gesture Detector: Queen both palms raised and pushed forward triggers volley', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
  mockPose[11] = { x: 0.4, y: 0.5, z: 0 }; // Left shoulder
  mockPose[12] = { x: 0.6, y: 0.5, z: 0 }; // Right shoulder
  mockPose[15] = { x: 0.35, y: 0.45, z: 0 }; // Left wrist raised
  mockPose[16] = { x: 0.65, y: 0.45, z: 0 }; // Right wrist raised

  const mockHands: Landmark3D[][] = [
    Array.from({ length: 21 }, () => ({ x: 0.35, y: 0.45, z: 0 })),
    Array.from({ length: 21 }, () => ({ x: 0.65, y: 0.45, z: 0 })),
  ];

  // Held raised for 4 frames
  detector.update('queen', mockPose, mockHands, DEFAULT_CALIBRATION, 1000);
  detector.update('queen', mockPose, mockHands, DEFAULT_CALIBRATION, 1040);
  detector.update('queen', mockPose, mockHands, DEFAULT_CALIBRATION, 1080);
  const volley = detector.update('queen', mockPose, mockHands, DEFAULT_CALIBRATION, 1120);
  assert.ok(volley);
  assert.equal(volley.ability, 'queen_volley');

  // Holding hands raised does not spam
  assert.equal(detector.update('queen', mockPose, mockHands, DEFAULT_CALIBRATION, 1160), null);
});

test('Combat Gesture Detector: King hands clasped at chest held for 400ms triggers summon', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));

  // Hands clasped at chest center (< 0.10)
  mockPose[15] = { x: 0.48, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.51, y: 0.5, z: 0 };

  // Held for 200ms: not yet ready
  assert.equal(detector.update('king', mockPose, [], DEFAULT_CALIBRATION, 1000), null);
  assert.equal(detector.update('king', mockPose, [], DEFAULT_CALIBRATION, 1200), null);

  // Held for 450ms: triggers summon!
  const summon = detector.update('king', mockPose, [], DEFAULT_CALIBRATION, 1450);
  assert.ok(summon);
  assert.equal(summon.ability, 'king_summon');
});
