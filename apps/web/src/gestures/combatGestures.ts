import {
  LEAN_DEADZONE,
  type AbilityType,
  type PieceClass,
} from '@let-him-rook/shared';
import type { Landmark3D } from '../vision/visionManager.ts';
import {
  bodyMetrics,
  computeEffectiveDepthRatio,
  computeTorsoMetrics,
  computeWholeHandTilt,
  findLeftHand,
  findRightHand,
  DEFAULT_MOVEMENT_SENSITIVITY,
  isOpenPalm,
  type CalibrationProfile,
} from './calibration.ts';

export interface CombatMovementIntent {
  moveX: number;
  moveZ: number;
}

export interface CombatAbilityIntent {
  ability: AbilityType;
  parryHolding?: boolean;
}

export interface CameraTurnIntent {
  turnDir: -1 | 0 | 1;
  tilt: number;
  active: boolean;
}

/**
 * Adaptive 1€ (One-Euro) Low-Pass Filter with filtered derivative (velocity) estimation.
 * Heavy smoothing at rest / low speed (minCutoff) to suppress posture/camera jitter,
 * and near-zero phase lag during purposeful movement (beta scales cutoff with |velocity|).
 */
export class OneEuroFilter {
  public minCutoff: number;
  public beta: number;
  public dCutoff: number;
  public gapTimeoutMs: number;
  public restValue: number;
  private value: number;
  private dx: number = 0;
  private lastTime: number = -Infinity;

  constructor(minCutoff = 1.8, beta = 0.35, dCutoff = 1.2, gapTimeoutMs = 300, restValue = 0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.gapTimeoutMs = gapTimeoutMs;
    this.restValue = restValue;
    this.value = restValue;
  }

  private alpha(cutoffHz: number, dtSec: number): number {
    const tau = 1 / (2 * Math.PI * Math.max(0.05, cutoffHz));
    return 1 / (1 + tau / Math.max(1e-4, dtSec));
  }

  public reset(): void {
    this.value = this.restValue;
    this.dx = 0;
    this.lastTime = -Infinity;
  }

  public update(rawValue: number, now: number): { value: number; velocity: number } {
    if (!Number.isFinite(this.lastTime) || now - this.lastTime > this.gapTimeoutMs) {
      this.value = this.restValue;
      this.dx = 0;
      this.lastTime = now;
      const dtSec = 1 / 60;
      const rawDx = (rawValue - this.value) / dtSec;
      const aDeriv = this.alpha(this.dCutoff, dtSec);
      this.dx = aDeriv * rawDx;
      const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
      const aVal = this.alpha(cutoff, dtSec);
      this.value = aVal * rawValue + (1 - aVal) * this.value;
      return { value: this.value, velocity: this.dx };
    }

    const dtMs = now - this.lastTime;
    if (dtMs <= 0) {
      return { value: this.value, velocity: this.dx };
    }
    const dtSec = Math.max(0.002, dtMs / 1000);
    this.lastTime = now;

    const rawDx = (rawValue - this.value) / dtSec;
    const aDeriv = this.alpha(this.dCutoff, dtSec);
    this.dx = aDeriv * rawDx + (1 - aDeriv) * this.dx;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const aVal = this.alpha(cutoff, dtSec);
    this.value = aVal * rawValue + (1 - aVal) * this.value;

    return { value: this.value, velocity: this.dx };
  }
}

export const LEFT_CAMERA_GESTURE = {
  tiltActivate: 0.45,
  tiltRelease: 0.26,
  smoothingMs: 35,
  activationMs: 45,
  minCutoff: 1.8,
  beta: 0.35,
};

export class LeftHandCameraController {
  private lastTime = -Infinity;
  private smoothedTilt = 0;
  private tiltFilter = new OneEuroFilter(
    LEFT_CAMERA_GESTURE.minCutoff,
    LEFT_CAMERA_GESTURE.beta,
    1.2,
    250
  );
  private turnDir: -1 | 0 | 1 = 0;
  private candidateDir: -1 | 0 | 1 = 0;
  private candidateSince = 0;

  public reset(): void {
    this.lastTime = -Infinity;
    this.smoothedTilt = 0;
    this.tiltFilter.reset();
    this.turnDir = 0;
    this.candidateDir = 0;
    this.candidateSince = 0;
  }

  public update(
    hands: Landmark3D[][],
    pose: Landmark3D[] | null,
    now = performance.now(),
    calibration?: CalibrationProfile
  ): CameraTurnIntent {
    // 1. Guard against two-handed abilities (crossed/clasped wrists)
    if (pose && pose[15] && pose[16]) {
      const wristDist = Math.hypot(pose[15].x - pose[16].x, pose[15].y - pose[16].y);
      if (wristDist < 0.14) {
        this.reset();
        return { turnDir: 0, tilt: 0, active: false };
      }
    }

    // 2. Find left hand
    const leftHand = findLeftHand(hands, pose);
    if (!leftHand) {
      if (now - this.lastTime > 250) {
        this.reset();
      }
      return { turnDir: 0, tilt: 0, active: false };
    }

    // 3. Compute whole-hand tilt
    const rawTiltValue = computeWholeHandTilt(leftHand);
    if (rawTiltValue === null) {
      if (now - this.lastTime > 250) {
        this.reset();
      }
      return { turnDir: 0, tilt: 0, active: false };
    }

    // 4. Subtract calibrated baseline tilt and clamp to [-1, 1]
    const baseline = calibration?.cameraBaselineTilt ?? 0;
    const rawTilt = Math.max(-1, Math.min(1, rawTiltValue - baseline));

    const filtered = this.tiltFilter.update(rawTilt, now);
    this.smoothedTilt = filtered.value;
    this.lastTime = now;

    // 5. Sensitivity-scaled thresholds
    const thresholds = movementThresholds(calibration?.movementSensitivity);
    const tiltActivate = thresholds.camera;
    const tiltRelease = thresholds.cameraRelease;

    // Desired turn direction with hysteresis
    let desired: -1 | 0 | 1 = 0;
    if (this.turnDir === -1) {
      desired = this.smoothedTilt >= -tiltRelease ? 0 : -1;
    } else if (this.turnDir === 1) {
      desired = this.smoothedTilt <= tiltRelease ? 0 : 1;
    } else {
      if (this.smoothedTilt <= -tiltActivate) {
        desired = -1;
      } else if (this.smoothedTilt >= tiltActivate) {
        desired = 1;
      }
    }

    // Debounce
    if (desired !== this.candidateDir) {
      this.candidateDir = desired;
      this.candidateSince = now;
    }

    if (desired === 0) {
      this.turnDir = 0;
    } else if (now - this.candidateSince >= LEFT_CAMERA_GESTURE.activationMs) {
      this.turnDir = desired;
    }

    return {
      turnDir: this.turnDir,
      tilt: this.smoothedTilt,
      active: true,
    };
  }
}

export interface TorsoLeanFilterParams {
  useLegacyEma?: boolean;
  smoothingMs: number;
  activationMs: number;
  fastActivationMs: number;
  minCutoff: number;
  beta: number;
  dCutoff: number;
  velocityLeadMs: number;
  reboundGuardMs: number;
}

export const BODY_MOVEMENT = {
  forward: 1.20,
  forwardRelease: 1.08,
  backward: 0.85,
  backwardRelease: 0.94,
  lateral: 0.60,
  lateralRelease: 0.40,
  smoothingMs: 25,
  activationMs: 35,
  fastActivationMs: 15,
  minCutoff: 1.8,
  beta: 0.40,
  dCutoff: 3.5,
  velocityLeadMs: 25,
  reboundGuardMs: 90,
};

export function movementThresholds(sensitivity: CalibrationProfile['movementSensitivity']) {
  const s = { ...DEFAULT_MOVEMENT_SENSITIVITY, ...sensitivity };
  const cameraSens = typeof s.camera === 'number' && Number.isFinite(s.camera) ? s.camera : 1;
  const camera = Math.max(0.12, Math.min(0.75, LEFT_CAMERA_GESTURE.tiltActivate * cameraSens));
  const cameraRelease = Math.max(0.06, Math.min(camera - 0.05, LEFT_CAMERA_GESTURE.tiltRelease * cameraSens));
  return {
    forward: 1 + 0.20 * s.forward,
    forwardRelease: 1 + 0.08 * s.forward,
    backward: Math.max(0.40, Math.min(0.95, 1 - 0.15 * s.backward)),
    backwardRelease: Math.max(0.50, Math.min(0.98, 1 - 0.06 * s.backward)),
    left: 0.60 * s.left,
    leftRelease: 0.40 * s.left,
    right: 0.60 * s.right,
    rightRelease: 0.40 * s.right,
    camera,
    cameraRelease,
  };
}

export class TorsoLeanController {
  private last = -Infinity;
  private x = 0;
  private r = 1;
  private filterX: OneEuroFilter;
  private filterR: OneEuroFilter;
  private axes = [0, 0];
  private candidates = [0, 0];
  private since = [0, 0];
  private lastReleaseDir = [0, 0];
  private lastReleaseAt = [-Infinity, -Infinity];
  private inferredHeadBase?: {
    headSpan: number;
    noseRelY: number;
    noseEarY: number;
    noseRelZ: number;
  };
  private profile = '';
  public readonly params: TorsoLeanFilterParams;

  constructor(customParams?: Partial<TorsoLeanFilterParams>) {
    this.params = {
      useLegacyEma: false,
      smoothingMs: BODY_MOVEMENT.smoothingMs,
      activationMs: BODY_MOVEMENT.activationMs,
      fastActivationMs: BODY_MOVEMENT.fastActivationMs,
      minCutoff: BODY_MOVEMENT.minCutoff,
      beta: BODY_MOVEMENT.beta,
      dCutoff: BODY_MOVEMENT.dCutoff,
      velocityLeadMs: BODY_MOVEMENT.velocityLeadMs,
      reboundGuardMs: BODY_MOVEMENT.reboundGuardMs,
      ...customParams,
    };
    this.filterX = new OneEuroFilter(this.params.minCutoff, this.params.beta, this.params.dCutoff, 300, 0);
    this.filterR = new OneEuroFilter(
      this.params.minCutoff,
      this.params.beta * 2.2,
      this.params.dCutoff,
      300,
      1
    );
  }

  public reset(): void {
    this.last = -Infinity;
    this.x = 0;
    this.r = 1;
    this.filterX.reset();
    this.filterR.reset();
    this.axes = [0, 0];
    this.candidates = [0, 0];
    this.since = [0, 0];
    this.lastReleaseDir = [0, 0];
    this.lastReleaseAt = [-Infinity, -Infinity];
    this.inferredHeadBase = undefined;
  }

  public update(
    pose: Landmark3D[] | null,
    calibration: CalibrationProfile,
    now = performance.now()
  ): CombatMovementIntent {
    const key = JSON.stringify([calibration.bodyBaseline, calibration.movementSensitivity]);
    if (key !== this.profile) {
      this.reset();
      this.profile = key;
    }
    const m = bodyMetrics(pose);
    const base = calibration.bodyBaseline;
    if (!m || !base || !calibration.bodyCalibrated) {
      this.reset();
      return { moveX: 0, moveZ: 0 };
    }

    if (now - this.last > 300) {
      this.reset();
    }

    // If profile was calibrated with legacy baseline lacking head fields, capture neutral head baseline
    if (
      base.headSpan === undefined &&
      base.noseRelY === undefined &&
      this.inferredHeadBase === undefined
    ) {
      const initNormX = (m.noseX - base.noseX) / base.shoulderWidth;
      const initShoulderRatio = m.width / base.shoulderWidth;
      const initEarPitch = Math.abs(m.noseEarY) / base.shoulderWidth;
      if (
        Math.abs(initNormX) < 0.15 &&
        Math.abs(initShoulderRatio - 1) < 0.08 &&
        initEarPitch < 0.12
      ) {
        this.inferredHeadBase = {
          headSpan: m.headSpan,
          noseRelY: m.noseRelY,
          noseEarY: m.noseEarY,
          noseRelZ: m.noseRelZ,
        };
      }
    }

    const rawNormX = (m.noseX - base.noseX) / base.shoulderWidth;
    const rawNormR = computeEffectiveDepthRatio(m, base, this.inferredHeadBase);

    let vx = 0;
    let vr = 0;

    if (this.params.useLegacyEma) {
      if (!Number.isFinite(this.last)) {
        this.x = rawNormX;
        this.r = rawNormR;
      } else {
        const dtSec = Math.max(0.002, (now - this.last) / 1000);
        const alpha = 1 - Math.exp(-(now - this.last) / this.params.smoothingMs);
        const nextX = this.x + alpha * (rawNormX - this.x);
        const nextR = this.r + alpha * (rawNormR - this.r);
        vx = (nextX - this.x) / dtSec;
        vr = (nextR - this.r) / dtSec;
        this.x = nextX;
        this.r = nextR;
      }
    } else {
      const fx = this.filterX.update(rawNormX, now);
      const fr = this.filterR.update(rawNormR, now);
      this.x = fx.value;
      this.r = fr.value;
      vx = fx.velocity;
      vr = fr.velocity;
    }
    this.last = now;

    const t = movementThresholds(calibration.movementSensitivity);
    const leadSec = this.params.velocityLeadMs / 1000;

    // Apply kinematic velocity lead ONLY when moving outward away from neutral
    // and outside the inner neutral deadband, preventing jitter amplification and snap-back overshoot.
    const inReboundX = now - this.lastReleaseAt[0] < this.params.reboundGuardMs;
    const inReboundZ = now - this.lastReleaseAt[1] < this.params.reboundGuardMs;

    const canLeadX =
      leadSec > 0 &&
      Math.abs(this.x) > t.rightRelease * 0.65 &&
      this.x * vx > 0 &&
      Math.abs(vx) > 0.35 &&
      !(inReboundX && Math.sign(this.x) === -this.lastReleaseDir[0]);

    const depthExcursion = this.r - 1;
    const minDepthDeadband = Math.min(t.forwardRelease - 1, 1 - t.backwardRelease) * 0.65;
    const canLeadZ =
      leadSec > 0 &&
      Math.abs(depthExcursion) > minDepthDeadband &&
      depthExcursion * vr > 0 &&
      Math.abs(vr) > 0.12 &&
      !(inReboundZ && Math.sign(-depthExcursion) === -this.lastReleaseDir[1]);

    const evalX = canLeadX ? this.x + vx * leadSec : this.x;
    const evalR = canLeadZ ? this.r + vr * leadSec : this.r;

    let rawX = evalX >= t.right ? 1 : evalX <= -t.left ? -1 : 0;
    let rawZ = evalR >= t.forward ? -1 : evalR <= t.backward ? 1 : 0;

    let ratioX = 0;
    if (rawX > 0) ratioX = evalX / t.right;
    else if (rawX < 0) ratioX = Math.abs(evalX) / t.left;

    let ratioZ = 0;
    if (rawZ < 0) ratioZ = (evalR - 1) / Math.max(1e-4, t.forward - 1);
    else if (rawZ > 0) ratioZ = (1 - evalR) / Math.max(1e-4, 1 - t.backward);

    // Suppress diagonal candidate: select single dominant cardinal axis
    if (rawX !== 0 && rawZ !== 0) {
      if (this.axes[0] !== 0 && this.axes[1] === 0) {
        if (ratioZ > ratioX * 1.25) rawX = 0;
        else rawZ = 0;
      } else if (this.axes[1] !== 0 && this.axes[0] === 0) {
        if (ratioX > ratioZ * 1.25) rawZ = 0;
        else rawX = 0;
      } else {
        if (ratioX >= ratioZ) rawZ = 0;
        else rawX = 0;
      }
    }

    const desired = [rawX, rawZ];
    const ratios = [ratioX, ratioZ];
    const outwardSpeeds = [
      rawX !== 0 && Math.sign(vx) === rawX ? Math.abs(vx) / Math.max(0.1, t.right) : 0,
      rawZ < 0 && vr > 0
        ? vr / Math.max(0.05, t.forward - 1)
        : rawZ > 0 && vr < 0
        ? Math.abs(vr) / Math.max(0.05, 1 - t.backward)
        : 0,
    ];

    // Release uses inward velocity projection when returning to neutral for instant 1-frame stop
    const releaseX = !this.params.useLegacyEma && this.axes[0] * vx < 0 ? this.x + vx * leadSec : this.x;
    const releaseR = !this.params.useLegacyEma && -this.axes[1] * vr < 0 ? this.r + vr * leadSec : this.r;
    const release = [
      this.axes[0] > 0
        ? releaseX <= t.rightRelease
        : this.axes[0] < 0
        ? releaseX >= -t.leftRelease
        : true,
      this.axes[1] < 0
        ? releaseR <= t.forwardRelease
        : this.axes[1] > 0
        ? releaseR >= t.backwardRelease
        : true,
    ];

    for (let i = 0; i < 2; i++) {
      if (release[i] && this.axes[i] !== 0) {
        this.lastReleaseDir[i] = this.axes[i];
        this.lastReleaseAt[i] = now;
        this.axes[i] = 0;
      }
      if (desired[i] !== this.candidates[i]) {
        this.candidates[i] = desired[i];
        this.since[i] = now;
      }
      if (desired[i] !== 0) {
        const isOppositeRebound =
          now - this.lastReleaseAt[i] < this.params.reboundGuardMs &&
          desired[i] === -this.lastReleaseDir[i];
        const isDecisive =
          !this.params.useLegacyEma &&
          !isOppositeRebound &&
          (ratios[i] >= 1.18 || (ratios[i] >= 1.02 && outwardSpeeds[i] >= 1.8));
        const requiredHoldMs = isDecisive
          ? this.params.fastActivationMs
          : this.params.activationMs;

        if (now - this.since[i] >= requiredHoldMs) {
          this.axes[i] = desired[i];
          this.axes[1 - i] = 0;
          this.candidates[1 - i] = 0;
        }
      }
    }

    // Safety guarantee: only single cardinal direction active
    if (this.axes[0] !== 0 && this.axes[1] !== 0) {
      if (ratioX >= ratioZ) this.axes[1] = 0;
      else this.axes[0] = 0;
    }

    return { moveX: this.axes[0], moveZ: this.axes[1] };
  }
}

export class CombatGestureDetector {
  private state: 'IDLE' | 'CANDIDATE' | 'ACTIVE' | 'WAIT_RELEASE' = 'IDLE';
  private candidateFrames: number = 0;
  private candidateStartedAt: number = 0;
  private isParryActive: boolean = false;
  private lastSlashAt: number = 0;
  private prevWristPos: { x: number; y: number } | null = null;
  private prevWristTime: number = 0;
  private prevRookRatio: number | null = null;
  private prevRookTime: number = 0;
  private prevKnightRelY: number | null = null;
  private prevKnightTime: number = 0;
  private prevBishopDist: number | null = null;
  private prevBishopTime: number = 0;

  public update(
    pieceClass: PieceClass,
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    calibration: CalibrationProfile,
    now = performance.now()
  ): CombatAbilityIntent | null {
    switch (pieceClass) {
      case 'pawn':
        return this.updatePawn(pose, hands, now);
      case 'rook':
        return this.updateRook(pose, hands, now);
      case 'knight':
        return this.updateKnight(pose, hands, now);
      case 'bishop':
        return this.updateBishop(pose, hands, now);
      case 'queen':
        return this.updateQueen(pose, hands, now);
      case 'king':
        return this.updateKing(pose, hands, now);
      default:
        return null;
    }
  }

  private updatePawn(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[16]) {
      if (this.isParryActive) {
        this.isParryActive = false;
        return { ability: 'pawn_parry', parryHolding: false };
      }
      return null;
    }

    const wrist = pose[16];
    let vx = 0;
    if (this.prevWristPos) {
      const dt =
        this.prevWristTime > 0 && now - this.prevWristTime <= 300
          ? (now - this.prevWristTime) / 1000
          : 0.05;
      vx = (wrist.x - this.prevWristPos.x) / (dt || 0.05);
    }
    this.prevWristPos = { x: wrist.x, y: wrist.y };
    this.prevWristTime = now;

    const rightHand = findRightHand(hands, pose);
    const isRightPalmOpen = rightHand ? isOpenPalm(rightHand) : false;

    // 1. If currently parrying
    if (this.isParryActive) {
      if (!isRightPalmOpen || Math.abs(vx) >= 1.2) {
        this.isParryActive = false;
        return { ability: 'pawn_parry', parryHolding: false };
      }
      return null;
    }

    // 2. Parry activation: stationary open right palm, IDLE state, >= 150ms after last slash
    if (
      isRightPalmOpen &&
      Math.abs(vx) < 1.2 &&
      this.state === 'IDLE' &&
      now - this.lastSlashAt >= 150
    ) {
      this.isParryActive = true;
      return { ability: 'pawn_parry', parryHolding: true };
    }

    // 3. Slash activation: rapid horizontal right wrist sweep while NOT parrying
    if (Math.abs(vx) > 2.6) {
      if (this.state === 'IDLE') {
        this.state = 'WAIT_RELEASE';
        this.lastSlashAt = now;
        return { ability: 'pawn_sweep' };
      }
    } else if (Math.abs(vx) < 1.0) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateRook(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[12] || !pose[14] || !pose[16]) return null;
    const rShoulder = pose[12];
    const rElbow = pose[14];
    const rWrist = pose[16];

    // Arm extended forward: distance from shoulder to wrist is near full extension
    const armLen =
      Math.hypot(rShoulder.x - rElbow.x, rShoulder.y - rElbow.y) +
      Math.hypot(rElbow.x - rWrist.x, rElbow.y - rWrist.y);
    const directDist = Math.hypot(rShoulder.x - rWrist.x, rShoulder.y - rWrist.y);
    const ratio = directDist / (armLen || 1);
    const isExtended = ratio > 0.85;

    let vRatio = 0;
    const dtMs = now - this.prevRookTime;
    if (this.prevRookRatio !== null && dtMs > 0 && dtMs <= 250) {
      vRatio = (ratio - this.prevRookRatio) / (dtMs / 1000);
    }
    const prevRatio = this.prevRookRatio;
    this.prevRookRatio = ratio;
    this.prevRookTime = now;

    if (this.state === 'IDLE' && isExtended) {
      this.candidateFrames++;
      // Confirm in 2 frames, OR immediately on 1st frame if high-velocity snap extension (> 0.88 from bent arm)
      const isSnapExtension =
        prevRatio !== null && prevRatio < 0.72 && ratio > 0.88 && vRatio > 8.0 && dtMs <= 25;
      if (this.candidateFrames >= 2 || isSnapExtension) {
        this.state = 'WAIT_RELEASE';
        this.candidateFrames = 0;
        return { ability: 'rook_shot' };
      }
    } else if (this.state === 'WAIT_RELEASE' && !isExtended) {
      this.state = 'IDLE';
    } else if (!isExtended) {
      this.candidateFrames = 0;
    }

    return null;
  }

  private updateKnight(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[12] || !pose[16]) return null;
    const rShoulder = pose[12];
    const rWrist = pose[16];
    const relY = rWrist.y - rShoulder.y;

    let vy = 0;
    const dtMs = now - this.prevKnightTime;
    if (this.prevKnightRelY !== null && dtMs > 0 && dtMs <= 250) {
      vy = (relY - this.prevKnightRelY) / (dtMs / 1000);
    }
    const prevRelY = this.prevKnightRelY;
    this.prevKnightRelY = relY;
    this.prevKnightTime = now;

    // Velocity-assisted single-frame lookback chop: if previous frame was raised above shoulder
    // and current frame already chopped below shoulder at high velocity
    if (
      this.state === 'IDLE' &&
      prevRelY !== null &&
      prevRelY < -0.04 &&
      relY > 0.14 &&
      vy > 1.5
    ) {
      this.state = 'WAIT_RELEASE';
      return { ability: 'knight_cleave' };
    }

    // Arm (CANDIDATE) when right wrist is raised above right shoulder (wrist.y < shoulder.y - 0.05)
    if (this.state === 'IDLE' && relY < -0.05) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
    } else if (this.state === 'CANDIDATE') {
      // Rapid downward chop: rWrist chops below shoulder (relY > 0.16, or relY > 0.10 with high vy) within 600ms
      if (
        (relY > 0.16 || (relY > 0.10 && vy > 1.8)) &&
        now - this.candidateStartedAt < 600
      ) {
        this.state = 'WAIT_RELEASE';
        return { ability: 'knight_cleave' };
      } else if (now - this.candidateStartedAt >= 600) {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && relY <= 0.12) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateBishop(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[12] || !pose[16]) return null;
    const rShoulder = pose[12];
    const rWrist = pose[16];
    const distToShoulder = Math.hypot(rWrist.x - rShoulder.x, rWrist.y - rShoulder.y);

    let vDist = 0;
    const dtMs = now - this.prevBishopTime;
    if (this.prevBishopDist !== null && dtMs > 0 && dtMs <= 250) {
      vDist = (distToShoulder - this.prevBishopDist) / (dtMs / 1000);
    }
    const prevDist = this.prevBishopDist;
    this.prevBishopDist = distToShoulder;
    this.prevBishopTime = now;

    // Velocity-assisted single-frame lookback thrust
    if (
      this.state === 'IDLE' &&
      prevDist !== null &&
      prevDist < 0.16 &&
      distToShoulder > 0.32 &&
      vDist > 1.4
    ) {
      this.state = 'WAIT_RELEASE';
      return { ability: 'bishop_ice_bolt' };
    }

    // Palm cocked near shoulder: dist < 0.16
    if (this.state === 'IDLE' && distToShoulder < 0.16) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
    } else if (this.state === 'CANDIDATE') {
      // Forward thrust: rWrist moves away from shoulder (dist > 0.33, or > 0.27 at high velocity) within 500ms
      if (
        (distToShoulder > 0.33 || (distToShoulder > 0.27 && vDist > 1.6)) &&
        now - this.candidateStartedAt < 500
      ) {
        this.state = 'WAIT_RELEASE';
        return { ability: 'bishop_ice_bolt' };
      } else if (now - this.candidateStartedAt >= 500) {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && distToShoulder < 0.25) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateQueen(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[12] || !pose[16]) return null;
    const rShoulder = pose[12];
    const rWrist = pose[16];
    const rightHand = findRightHand(hands, pose);
    const isRightPalm = rightHand ? isOpenPalm(rightHand) : false;

    // Raised right wrist near/above right shoulder with open palm
    const isRaised = rWrist.y <= rShoulder.y + 0.10 && isRightPalm;

    if (this.state === 'IDLE' && isRaised) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
      this.candidateFrames = 1;
    } else if (this.state === 'CANDIDATE') {
      if (isRaised) {
        this.candidateFrames++;
        if (this.candidateFrames >= 2 && now - this.candidateStartedAt < 700) {
          this.state = 'WAIT_RELEASE';
          return { ability: 'queen_volley' };
        } else if (now - this.candidateStartedAt >= 700) {
          this.state = 'IDLE';
        }
      } else {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && !isRaised) {
      this.state = 'IDLE';
    }

    return null;
  }

  private updateKing(
    pose: Landmark3D[] | null,
    hands: Landmark3D[][],
    now: number
  ): CombatAbilityIntent | null {
    if (!pose || !pose[11] || !pose[12] || !pose[16]) return null;
    const chestCenter = {
      x: (pose[11].x + pose[12].x) / 2,
      y: (pose[11].y + pose[12].y) / 2 + 0.06,
    };
    const dist = Math.hypot(pose[16].x - chestCenter.x, pose[16].y - chestCenter.y);
    const rightHand = findRightHand(hands, pose);
    const isFist = !rightHand || !isOpenPalm(rightHand);

    // Hold closed right fist steady at chest center (< 0.15) for 220ms
    if (this.state === 'IDLE' && dist < 0.15 && isFist) {
      this.state = 'CANDIDATE';
      this.candidateStartedAt = now;
    } else if (this.state === 'CANDIDATE') {
      if (dist < 0.15 && isFist) {
        if (now - this.candidateStartedAt >= 220) {
          this.state = 'WAIT_RELEASE';
          return { ability: 'king_summon' };
        }
      } else {
        this.state = 'IDLE';
      }
    } else if (this.state === 'WAIT_RELEASE' && dist > 0.22) {
      this.state = 'IDLE';
    }

    return null;
  }

  public reset(): void {
    this.state = 'IDLE';
    this.candidateFrames = 0;
    this.candidateStartedAt = 0;
    this.isParryActive = false;
    this.lastSlashAt = 0;
    this.prevWristPos = null;
    this.prevWristTime = 0;
    this.prevRookRatio = null;
    this.prevRookTime = 0;
    this.prevKnightRelY = null;
    this.prevKnightTime = 0;
    this.prevBishopDist = null;
    this.prevBishopTime = 0;
  }
}
