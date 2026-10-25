import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CALIBRATION, type CalibrationProfile } from '../../apps/web/src/gestures/calibration.ts';
import {
  BODY_MOVEMENT,
  CombatGestureDetector,
  LeftHandCameraController,
  OneEuroFilter,
  TorsoLeanController,
  type TorsoLeanFilterParams,
} from '../../apps/web/src/gestures/combatGestures.ts';
import type { Landmark3D } from '../../apps/web/src/vision/visionManager.ts';

const DT_60FPS = 1000 / 60; // 16.6667ms

const BASE_PROFILE: CalibrationProfile = {
  ...DEFAULT_CALIBRATION,
  bodyCalibrated: true,
  bodyBaseline: {
    version: 1,
    noseX: 0.5,
    shoulderWidth: 0.3,
    headSpan: 0.12,
    noseRelY: -0.18,
    noseEarY: 0.01,
    noseRelZ: -0.08,
  },
};

interface SyntheticPoseOptions {
  noseX?: number;
  shoulderWidth?: number;
  headSpan?: number;
  noseRelY?: number;
  noseEarY?: number;
  noseRelZ?: number;
  shoulderY?: number;
}

function makeRichPose(opts: SyntheticPoseOptions = {}): Landmark3D[] {
  const noseX = opts.noseX ?? 0.5;
  const shoulderWidth = opts.shoulderWidth ?? 0.3;
  const headSpan = opts.headSpan ?? 0.12;
  const shoulderY = opts.shoulderY ?? 0.55;
  const noseRelY = opts.noseRelY ?? -0.18;
  const noseEarY = opts.noseEarY ?? 0.01;
  const noseRelZ = opts.noseRelZ ?? -0.08;

  const noseY = shoulderY + noseRelY;
  const earY = noseY - noseEarY;

  const landmarks: Landmark3D[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: shoulderY,
    z: 0,
    visibility: 0.98,
  }));

  // Nose (0)
  landmarks[0] = { x: noseX, y: noseY, z: noseRelZ, visibility: 0.99 };
  // Eyes (2, 5)
  const eyeSpan = headSpan / 1.8;
  landmarks[2] = { x: noseX - eyeSpan / 2, y: earY - 0.01, z: noseRelZ + 0.01, visibility: 0.98 };
  landmarks[5] = { x: noseX + eyeSpan / 2, y: earY - 0.01, z: noseRelZ + 0.01, visibility: 0.98 };
  // Ears (7, 8)
  landmarks[7] = { x: noseX - headSpan / 2, y: earY, z: noseRelZ + 0.03, visibility: 0.95 };
  landmarks[8] = { x: noseX + headSpan / 2, y: earY, z: noseRelZ + 0.03, visibility: 0.95 };
  // Shoulders (11, 12)
  landmarks[11] = { x: 0.5 - shoulderWidth / 2, y: shoulderY, z: 0, visibility: 0.99 };
  landmarks[12] = { x: 0.5 + shoulderWidth / 2, y: shoulderY, z: 0, visibility: 0.99 };

  return landmarks;
}

interface BenchmarkMetrics {
  fastLateralLatencyMs: number;
  fastForwardLatencyMs: number;
  fastHeadForwardLatencyMs: number;
  gradualLatencyMs: number;
  releaseLatencyMs: number;
  falsePositives: number;
  reboundOvershoots: number;
  diagonalLeaks: number;
  score: number;
}

function evaluateParams(params: Partial<TorsoLeanFilterParams>): BenchmarkMetrics {
  // 1. Fast decisive lateral lean (60ms ramp from 0 to 1.45x right threshold = +0.261 noseX offset)
  const cLat = new TorsoLeanController(params);
  let t = 0;
  for (; t < 300; t += DT_60FPS) {
    cLat.update(makeRichPose(), BASE_PROFILE, t);
  }
  const leanStartAt = t;
  let rawCrossedAt = Infinity;
  let activatedAt = Infinity;
  for (; t <= leanStartAt + 400; t += DT_60FPS) {
    const progress = Math.min(1, (t - leanStartAt) / 60);
    const offset = progress * (0.60 * 0.3 * 1.45); // 1.45x right threshold
    if (offset >= 0.60 * 0.3 && rawCrossedAt === Infinity) {
      rawCrossedAt = t;
    }
    const intent = cLat.update(makeRichPose({ noseX: 0.5 + offset }), BASE_PROFILE, t);
    if (intent.moveX === 1 && activatedAt === Infinity) {
      activatedAt = t;
      break;
    }
  }
  const fastLateralLatencyMs = activatedAt - rawCrossedAt;

  // 2. Fast decisive torso forward lean (60ms ramp to 1.45x forward threshold)
  const cFwd = new TorsoLeanController(params);
  t = 0;
  for (; t < 300; t += DT_60FPS) {
    cFwd.update(makeRichPose(), BASE_PROFILE, t);
  }
  const fwdStartAt = t;
  let fwdRawCrossedAt = Infinity;
  let fwdActivatedAt = Infinity;
  for (; t <= fwdStartAt + 400; t += DT_60FPS) {
    const progress = Math.min(1, (t - fwdStartAt) / 60);
    const width = 0.3 * (1 + progress * 0.20 * 1.45);
    if (width >= 0.3 * 1.20 && fwdRawCrossedAt === Infinity) {
      fwdRawCrossedAt = t;
    }
    const intent = cFwd.update(makeRichPose({ shoulderWidth: width }), BASE_PROFILE, t);
    if (intent.moveZ === -1 && fwdActivatedAt === Infinity) {
      fwdActivatedAt = t;
      break;
    }
  }
  const fastForwardLatencyMs = fwdActivatedAt - fwdRawCrossedAt;

  // 3. Fast decisive head-only forward lean (head depth + pitch over 60ms)
  const cHead = new TorsoLeanController(params);
  t = 0;
  for (; t < 300; t += DT_60FPS) {
    cHead.update(makeRichPose(), BASE_PROFILE, t);
  }
  const headStartAt = t;
  let headRawCrossedAt = Infinity;
  let headActivatedAt = Infinity;
  for (; t <= headStartAt + 400; t += DT_60FPS) {
    const progress = Math.min(1, (t - headStartAt) / 60);
    const headSpan = 0.12 * (1 + progress * 0.22);
    const noseEarY = 0.01 + progress * 0.03;
    if (progress >= 0.68 && headRawCrossedAt === Infinity) {
      headRawCrossedAt = t;
    }
    const intent = cHead.update(makeRichPose({ headSpan, noseEarY }), BASE_PROFILE, t);
    if (intent.moveZ === -1 && headActivatedAt === Infinity) {
      headActivatedAt = t;
      break;
    }
  }
  const fastHeadForwardLatencyMs = headActivatedAt - headRawCrossedAt;

  // 4. Gradual deliberate lean (200ms ramp to 1.30x threshold)
  const cGrad = new TorsoLeanController(params);
  t = 0;
  for (; t < 300; t += DT_60FPS) {
    cGrad.update(makeRichPose(), BASE_PROFILE, t);
  }
  const gradStartAt = t;
  let gradRawCrossedAt = Infinity;
  let gradActivatedAt = Infinity;
  for (; t <= gradStartAt + 600; t += DT_60FPS) {
    const progress = Math.min(1, (t - gradStartAt) / 200);
    const offset = progress * (0.60 * 0.3 * 1.30);
    if (offset >= 0.60 * 0.3 && gradRawCrossedAt === Infinity) {
      gradRawCrossedAt = t;
    }
    const intent = cGrad.update(makeRichPose({ noseX: 0.5 - offset }), BASE_PROFILE, t);
    if (intent.moveX === -1 && gradActivatedAt === Infinity) {
      gradActivatedAt = t;
      break;
    }
  }
  const gradualLatencyMs = gradActivatedAt - gradRawCrossedAt;

  // 5. Snap-back rebound & stop latency
  const cRebound = new TorsoLeanController(params);
  t = 0;
  for (; t < 400; t += DT_60FPS) {
    cRebound.update(makeRichPose({ noseX: 0.5 + 0.25 }), BASE_PROFILE, t);
  }
  const snapBackAt = t;
  let releasedAt = Infinity;
  let reboundOvershoots = 0;
  for (let step = 0; step < 30; step++) {
    t += DT_60FPS;
    // Rapid return to neutral with slight underdamped physical sway (-28% of left threshold) on frames 2..5
    const sway = step >= 1 && step <= 4 ? -(0.60 * 0.3 * 0.28) : 0;
    const intent = cRebound.update(makeRichPose({ noseX: 0.5 + sway }), BASE_PROFILE, t);
    if (intent.moveX === 0 && releasedAt === Infinity) {
      releasedAt = t;
    }
    if (intent.moveX === -1) {
      reboundOvershoots++;
    }
  }
  const releaseLatencyMs = releasedAt - snapBackAt;

  // 6. Noisy neutral posture (600 frames = 10s of breathing + camera jitter + single-frame glitch)
  const cNoise = new TorsoLeanController(params);
  let falsePositives = 0;
  for (let i = 0; i < 600; i++) {
    const timeMs = i * DT_60FPS;
    const breathingX = Math.sin(timeMs * 0.0025) * (0.60 * 0.3 * 0.22);
    const jitterX = Math.sin(i * 1.9 + Math.cos(i * 0.7)) * (0.60 * 0.3 * 0.25);
    // Single-frame camera landmark glitch at frame 250 (105% of threshold for 1 frame)
    const glitchX = i === 250 ? 0.60 * 0.3 * 1.05 : 0;
    const breathingW = Math.cos(timeMs * 0.002) * (0.3 * 0.20 * 0.25);
    const jitterW = Math.sin(i * 2.3) * (0.3 * 0.20 * 0.22);

    const intent = cNoise.update(
      makeRichPose({
        noseX: 0.5 + breathingX + jitterX + glitchX,
        shoulderWidth: 0.3 + breathingW + jitterW,
      }),
      BASE_PROFILE,
      timeMs
    );
    if (intent.moveX !== 0 || intent.moveZ !== 0) {
      falsePositives++;
    }
  }

  // 7. Diagonal leak check across slanted trajectories
  let diagonalLeaks = 0;
  const slantedAngles = [0.4, 0.7, 0.9, 1.1, 1.9, 2.3, 2.7, -0.8, -2.2];
  for (const ang of slantedAngles) {
    const cDiag = new TorsoLeanController(params);
    for (let f = 0; f < 25; f++) {
      const intent = cDiag.update(
        makeRichPose({
          noseX: 0.5 + Math.cos(ang) * 0.24,
          shoulderWidth: 0.3 + Math.sin(ang) * 0.09,
        }),
        BASE_PROFILE,
        f * DT_60FPS
      );
      if (intent.moveX !== 0 && intent.moveZ !== 0) {
        diagonalLeaks++;
      }
    }
  }

  const penalty = (falsePositives + reboundOvershoots + diagonalLeaks) * 10000;
  const score =
    fastLateralLatencyMs * 0.35 +
    fastForwardLatencyMs * 0.25 +
    fastHeadForwardLatencyMs * 0.20 +
    gradualLatencyMs * 0.10 +
    releaseLatencyMs * 0.10 +
    penalty;

  return {
    fastLateralLatencyMs,
    fastForwardLatencyMs,
    fastHeadForwardLatencyMs,
    gradualLatencyMs,
    releaseLatencyMs,
    falsePositives,
    reboundOvershoots,
    diagonalLeaks,
    score,
  };
}

test('Brute-Force Grid-Search Benchmark: Sweeps filter & debounce parameter space and verifies Pareto-optimal low-latency configuration', () => {
  // 1. Measure legacy baseline (100ms EMA + 100ms fixed debounce, no velocity lead)
  const legacyMetrics = evaluateParams({
    useLegacyEma: true,
    smoothingMs: 100,
    activationMs: 100,
    fastActivationMs: 100,
    velocityLeadMs: 0,
  });

  // 2. Brute-force sweep over 1€ Filter + Velocity Lead + Velocity-Adaptive Debounce parameter grid
  const minCutoffs = [0.8, 1.2, 1.8, 2.5, 3.5];
  const betas = [0.05, 0.15, 0.35, 0.55, 0.80];
  const velocityLeads = [0, 15, 25, 35];
  const fastActivations = [15, 25, 35];

  let bestScore = Infinity;
  let bestCandidate: { params: Partial<TorsoLeanFilterParams>; metrics: BenchmarkMetrics } | null = null;
  let totalEvaluated = 0;
  let zeroDefectCount = 0;

  for (const minCutoff of minCutoffs) {
    for (const beta of betas) {
      for (const velocityLeadMs of velocityLeads) {
        for (const fastActivationMs of fastActivations) {
          totalEvaluated++;
          const candidateParams: Partial<TorsoLeanFilterParams> = {
            useLegacyEma: false,
            minCutoff,
            beta,
            velocityLeadMs,
            fastActivationMs,
            activationMs: Math.max(35, fastActivationMs + 15),
          };
          const metrics = evaluateParams(candidateParams);
          if (
            metrics.falsePositives === 0 &&
            metrics.reboundOvershoots === 0 &&
            metrics.diagonalLeaks === 0
          ) {
            zeroDefectCount++;
          }
          if (metrics.score < bestScore) {
            bestScore = metrics.score;
            bestCandidate = { params: candidateParams, metrics };
          }
        }
      }
    }
  }

  assert.equal(totalEvaluated, 300, 'Grid search must evaluate all 300 parameter combinations');
  assert.ok(zeroDefectCount > 50, 'Multiple parameter sets must achieve 0 false positives and 0 rebound overshoots');
  assert.ok(bestCandidate, 'Must find a Pareto-optimal candidate');

  // 3. Evaluate production BODY_MOVEMENT default parameters
  const prodMetrics = evaluateParams(BODY_MOVEMENT);

  // Verify zero stability regressions
  assert.equal(prodMetrics.falsePositives, 0, 'Production parameters must have 0 false positives under posture noise + single-frame glitch');
  assert.equal(prodMetrics.reboundOvershoots, 0, 'Production parameters must have 0 opposite-axis rebound overshoots');
  assert.equal(prodMetrics.diagonalLeaks, 0, 'Production parameters must have 0 diagonal leaks');

  // Verify massive latency improvement over legacy 100ms EMA + 100ms debounce
  assert.ok(
    prodMetrics.fastLateralLatencyMs <= 35 &&
      prodMetrics.fastLateralLatencyMs < legacyMetrics.fastLateralLatencyMs * 0.3,
    `Expected fast lateral latency <= 35ms (got ${prodMetrics.fastLateralLatencyMs.toFixed(1)}ms vs legacy ${legacyMetrics.fastLateralLatencyMs.toFixed(1)}ms)`
  );
  assert.ok(
    prodMetrics.fastForwardLatencyMs <= 35 &&
      prodMetrics.fastForwardLatencyMs < legacyMetrics.fastForwardLatencyMs * 0.3,
    `Expected fast forward latency <= 35ms (got ${prodMetrics.fastForwardLatencyMs.toFixed(1)}ms vs legacy ${legacyMetrics.fastForwardLatencyMs.toFixed(1)}ms)`
  );
  assert.ok(
    prodMetrics.fastHeadForwardLatencyMs <= 35,
    `Expected fast head-driven forward latency <= 35ms (got ${prodMetrics.fastHeadForwardLatencyMs.toFixed(1)}ms)`
  );
  assert.ok(
    prodMetrics.releaseLatencyMs <= 25 &&
      prodMetrics.releaseLatencyMs < legacyMetrics.releaseLatencyMs,
    `Expected release latency <= 25ms (got ${prodMetrics.releaseLatencyMs.toFixed(1)}ms vs legacy ${legacyMetrics.releaseLatencyMs.toFixed(1)}ms)`
  );
});

test('Head Movement Detection: Head Depth (ear/eye scale & nose Z) and Head Pitch (nodding forward/back) trigger Forward and Backward only', () => {
  const controller = new TorsoLeanController();

  // 1. Neutral stance -> { moveX: 0, moveZ: 0 }
  assert.deepEqual(controller.update(makeRichPose(), BASE_PROFILE, 0), { moveX: 0, moveZ: 0 });

  // 2. Head Depth Forward: Leaning head toward camera (headSpan increases +25% and noseRelZ moves closer) while shoulders stay still
  let intent = { moveX: 0, moveZ: 0 };
  for (let t = DT_60FPS; t <= 120; t += DT_60FPS) {
    intent = controller.update(
      makeRichPose({ headSpan: 0.152, noseRelZ: -0.16, shoulderWidth: 0.3 }),
      BASE_PROFILE,
      t
    );
  }
  assert.deepEqual(intent, { moveX: 0, moveZ: -1 }, 'Head leaning toward camera must trigger Forward (moveZ: -1)');

  // Return to neutral -> stops immediately
  controller.reset();
  controller.update(makeRichPose(), BASE_PROFILE, 200);

  // 3. Head Depth Backward: Leaning head away from camera (headSpan shrinks -20% and noseRelZ moves further) while shoulders stay still
  for (let t = 200 + DT_60FPS; t <= 320; t += DT_60FPS) {
    intent = controller.update(
      makeRichPose({ headSpan: 0.094, noseRelZ: 0.02, shoulderWidth: 0.3 }),
      BASE_PROFILE,
      t
    );
  }
  assert.deepEqual(intent, { moveX: 0, moveZ: 1 }, 'Head leaning away from camera must trigger Backward (moveZ: 1)');

  // 4. Head Pitch Forward: Nodding/tilting head forward relative to shoulders and ears while shoulderWidth & headSpan stay constant
  controller.reset();
  controller.update(makeRichPose(), BASE_PROFILE, 400);
  for (let t = 400 + DT_60FPS; t <= 520; t += DT_60FPS) {
    intent = controller.update(
      makeRichPose({
        shoulderWidth: 0.3,
        headSpan: 0.12,
        noseRelY: -0.13, // nose drops +0.05 closer to shoulders
        noseEarY: 0.045, // nose pitches +0.035 below ears
      }),
      BASE_PROFILE,
      t
    );
  }
  assert.deepEqual(intent, { moveX: 0, moveZ: -1 }, 'Nodding head forward must trigger Forward (moveZ: -1)');

  // 5. Head Pitch Backward: Tilting head backward/up relative to shoulders and ears while shoulderWidth & headSpan stay constant
  controller.reset();
  controller.update(makeRichPose(), BASE_PROFILE, 600);
  for (let t = 600 + DT_60FPS; t <= 720; t += DT_60FPS) {
    intent = controller.update(
      makeRichPose({
        shoulderWidth: 0.3,
        headSpan: 0.12,
        noseRelY: -0.225, // nose lifts -0.045 higher above shoulders
        noseEarY: -0.025, // nose tilts -0.035 above ears
      }),
      BASE_PROFILE,
      t
    );
  }
  assert.deepEqual(intent, { moveX: 0, moveZ: 1 }, 'Tilting head backward must trigger Backward (moveZ: 1)');

  // 6. Lateral head tilt does NOT false-trigger Forward/Backward when nose drops slightly from sideways neck tilt
  controller.reset();
  controller.update(makeRichPose(), BASE_PROFILE, 800);
  for (let t = 800 + DT_60FPS; t <= 920; t += DT_60FPS) {
    intent = controller.update(
      makeRichPose({
        noseX: 0.5 + 0.22, // strong right lean
        shoulderWidth: 0.3,
        noseRelY: -0.15, // slight natural vertical drop from sideways tilt
        noseEarY: 0.025,
      }),
      BASE_PROFILE,
      t
    );
  }
  assert.deepEqual(intent, { moveX: 1, moveZ: 0 }, 'Lateral lean with natural neck drop must resolve strictly to Right');

  // 7. Extreme head nod cannot overpower a strong opposite torso lean (headPitchDelta is safely clamped)
  controller.reset();
  controller.update(makeRichPose(), BASE_PROFILE, 1000);
  for (let t = 1000 + DT_60FPS; t <= 1150; t += DT_60FPS) {
    intent = controller.update(
      makeRichPose({
        shoulderWidth: 0.3 * 1.48, // strong +48% torso forward lean
        headSpan: 0.12 * 1.15, // head also closer
        noseRelY: -0.45, // extreme upward head pitch
        noseEarY: -0.25,
      }),
      BASE_PROFILE,
      t
    );
  }
  assert.deepEqual(intent, { moveX: 0, moveZ: -1 }, 'Strong torso forward lean must not be inverted into Backward by extreme head pitch');

  // 8. Legacy profile lacking head baseline fields does NOT infer a corrupted neutral baseline if user starts while nodding heavily
  const legacyProfile: CalibrationProfile = {
    ...DEFAULT_CALIBRATION,
    bodyCalibrated: true,
    bodyBaseline: {
      version: 1,
      noseX: 0.5,
      shoulderWidth: 0.3,
    },
  };
  const legacyController = new TorsoLeanController();
  // Frame 0: user's shoulders are centered, but head is pitched down heavily (noseEarY = 0.08 -> initEarPitch = 0.267 > 0.12)
  legacyController.update(makeRichPose({ noseEarY: 0.08, noseRelY: -0.10 }), legacyProfile, 0);
  // Frame 1: user returns head to true neutral (noseEarY = 0.01, noseRelY = -0.18) -> now inferred as neutral!
  for (let t = DT_60FPS; t <= 150; t += DT_60FPS) {
    intent = legacyController.update(makeRichPose(), legacyProfile, t);
  }
  assert.deepEqual(intent, { moveX: 0, moveZ: 0 }, 'True neutral stance must remain neutral even if user started frame 0 with head pitched');
});

test('CombatGestureDetector Low-Latency Confirmation: Rook 2-frame & 1-frame snap, Queen 2-frame, King 220ms, and velocity-assisted Knight/Bishop', () => {
  const detector = new CombatGestureDetector();
  const mockPose: Landmark3D[] = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));

  // 1a. Rook fires on 2nd frame (~16.7ms at 60 FPS) when starting extended from cold start
  mockPose[12] = { x: 0.5, y: 0.5, z: 0 };
  mockPose[14] = { x: 0.5, y: 0.75, z: 0 };
  mockPose[16] = { x: 0.5, y: 1.0, z: 0 };
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1000), null);
  const rookShot = detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1016);
  assert.equal(rookShot?.ability, 'rook_shot');

  // 1b. Rook fires on 1st extended frame when snapping rapidly from bent arm at 60 FPS (ratio > 0.88, vRatio > 8)
  detector.reset();
  mockPose[12] = { x: 0.5, y: 0.5, z: 0 };
  mockPose[14] = { x: 0.35, y: 0.6, z: 0 };
  mockPose[16] = { x: 0.5, y: 0.58, z: 0 }; // bent arm (ratio < 0.72)
  assert.equal(detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1500), null);
  mockPose[14] = { x: 0.5, y: 0.75, z: 0 };
  mockPose[16] = { x: 0.5, y: 1.0, z: 0 }; // snap to full extension in 16ms
  const snapRookShot = detector.update('rook', mockPose, [], DEFAULT_CALIBRATION, 1516);
  assert.equal(snapRookShot?.ability, 'rook_shot', 'High-velocity Rook arm snap must fire on 1st extended frame');

  // 2. Knight velocity-assisted chop triggers immediately on high-speed downward crossing
  detector.reset();
  mockPose[12] = { x: 0.6, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.6, y: 0.42, z: 0 }; // raised above shoulder
  assert.equal(detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 2000), null);
  mockPose[16] = { x: 0.6, y: 0.62, z: 0 }; // fast downward chop (relY = +0.12, vy = +12.0)
  const knightCleave = detector.update('knight', mockPose, [], DEFAULT_CALIBRATION, 2016);
  assert.equal(knightCleave?.ability, 'knight_cleave');

  // 3. Bishop velocity-assisted thrust triggers immediately on high-speed outward thrust
  detector.reset();
  mockPose[12] = { x: 0.5, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.54, y: 0.52, z: 0 }; // cocked near shoulder
  assert.equal(detector.update('bishop', mockPose, [], DEFAULT_CALIBRATION, 3000), null);
  mockPose[16] = { x: 0.5, y: 0.79, z: 0 }; // fast thrust (dist = 0.29, vDist > 10)
  const bishopBolt = detector.update('bishop', mockPose, [], DEFAULT_CALIBRATION, 3016);
  assert.equal(bishopBolt?.ability, 'bishop_ice_bolt');

  // 4. King summons after 220ms chest hold (down from 400ms)
  detector.reset();
  mockPose[11] = { x: 0.4, y: 0.5, z: 0 };
  mockPose[12] = { x: 0.6, y: 0.5, z: 0 };
  mockPose[16] = { x: 0.5, y: 0.56, z: 0 };
  assert.equal(detector.update('king', mockPose, [], DEFAULT_CALIBRATION, 4000), null);
  assert.equal(detector.update('king', mockPose, [], DEFAULT_CALIBRATION, 4150), null);
  const kingSummon = detector.update('king', mockPose, [], DEFAULT_CALIBRATION, 4230);
  assert.equal(kingSummon?.ability, 'king_summon');

  // 5. Cold-start OneEuroFilter attenuates a 1-frame spike on frame 0 instead of snapping unfiltered
  const filter = new OneEuroFilter(1.8, 0.35, 1.2, 300, 0);
  const coldStep = filter.update(0.50, 1000);
  assert.ok(coldStep.value < 0.50, 'Cold-start frame must be low-pass filtered against restValue rather than bypassing filter');
});
