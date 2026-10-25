import type { Landmark3D } from '../vision/visionManager.ts';

export interface PinchThresholds {
  close: number;
  open: number;
}

export interface BodyBaseline {
  version: 1;
  noseX: number;
  shoulderWidth: number;
  headSpan?: number;
  noseRelY?: number;
  noseEarY?: number;
  noseRelZ?: number;
}

export interface CalibrationProfile {
  bodyCalibrated?: boolean;
  bodyBaseline?: BodyBaseline;
  movementSensitivity?: { forward: number; backward: number; left: number; right: number; camera?: number };
  cameraBaselineTilt?: number;
  neutralTorsoCenter: { x: number; y: number };
  shoulderWidth: number;
  pinchThresholds: PinchThresholds;
  isCalibrated: boolean;
}

export const DEFAULT_CALIBRATION: CalibrationProfile = {
  neutralTorsoCenter: { x: 0.5, y: 0.55 },
  shoulderWidth: 0.25,
  pinchThresholds: { close: 0.38, open: 0.52 },
  isCalibrated: false,
  cameraBaselineTilt: 0,
  movementSensitivity: { forward: 1, backward: 1, left: 1, right: 1, camera: 1 },
};

const STORAGE_KEY = 'rook_calibration_v4';

export function loadSavedCalibration(): CalibrationProfile | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('rook_calibration_v3');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalibrationProfile;
    if (
      parsed &&
      typeof parsed.shoulderWidth === 'number' &&
      parsed.shoulderWidth > 0.05 &&
      parsed.neutralTorsoCenter &&
      typeof parsed.neutralTorsoCenter.x === 'number' &&
      typeof parsed.neutralTorsoCenter.y === 'number' &&
      parsed.pinchThresholds &&
      typeof parsed.pinchThresholds.close === 'number' &&
      typeof parsed.pinchThresholds.open === 'number' &&
      parsed.pinchThresholds.open > parsed.pinchThresholds.close
    ) {
      if (!parsed.bodyBaseline || parsed.bodyBaseline.version !== 1 || !Number.isFinite(parsed.bodyBaseline.noseX) || !Number.isFinite(parsed.bodyBaseline.shoulderWidth) || parsed.bodyBaseline.shoulderWidth < 0.05) { parsed.bodyCalibrated = false; delete parsed.bodyBaseline; }
      return parsed;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export function saveCalibrationProfile(profile: CalibrationProfile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage quota/privacy errors
  }
}

export function clearSavedCalibration(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export const DEFAULT_MOVEMENT_SENSITIVITY = { forward: 1, backward: 1, left: 1, right: 1, camera: 1 };

export function isOpenPalm(hand: Landmark3D[]): boolean {
  if (!hand || hand.length < 21) return false;
  const wrist = hand[0];
  const tips = [hand[4], hand[8], hand[12], hand[16], hand[20]];
  const mcps = [hand[2], hand[5], hand[9], hand[13], hand[17]];

  for (let i = 0; i < 5; i++) {
    const tip = tips[i];
    const mcp = mcps[i];
    if (!tip || !mcp) return false;
    const tipDist2D = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const mcpDist2D = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
    const hasZ = Number.isFinite(tip.z) && Number.isFinite(wrist.z) && Number.isFinite(mcp.z);
    const tipDist3D = hasZ
      ? Math.hypot(tip.x - wrist.x, tip.y - wrist.y, (tip.z! - wrist.z!))
      : tipDist2D;
    const mcpDist3D = hasZ
      ? Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y, (mcp.z! - wrist.z!))
      : mcpDist2D;

    const tipDist = Math.max(tipDist2D, tipDist3D);
    const mcpDist = Math.min(mcpDist2D, mcpDist3D);
    if (tipDist < mcpDist * 1.1) {
      return false; // Finger is curled
    }
  }
  return true;
}

export function computeWholeHandTilt(hand: Landmark3D[]): number | null {
  if (!hand || hand.length < 21) return null;
  // Camera gesture requires all five fingers of the left hand open pointing at camera
  if (!isOpenPalm(hand)) return null;

  const wrist = hand[0];
  const middleMcp = hand[9];
  const middleTip = hand[12];
  if (!wrist || !middleMcp || !middleTip) return null;
  if (
    !Number.isFinite(wrist.x) || !Number.isFinite(wrist.y) ||
    !Number.isFinite(middleMcp.x) || !Number.isFinite(middleMcp.y) ||
    !Number.isFinite(middleTip.x) || !Number.isFinite(middleTip.y)
  ) {
    return null;
  }

  const midX = (middleMcp.x + middleTip.x) / 2;
  const midY = (middleMcp.y + middleTip.y) / 2;

  const vx = midX - wrist.x;
  const vy = wrist.y - midY; // Positive upward in inverted screen coordinates

  const len = Math.hypot(vx, vy);
  if (vy <= 0.01 || len < 0.04) {
    return null;
  }

  return Math.max(-1, Math.min(1, vx / len));
}

export function findLeftHand(hands: Landmark3D[][], pose?: Landmark3D[] | null): Landmark3D[] | null {
  const validHands = hands.filter(h => h && h.length >= 21);
  if (validHands.length === 0) return null;

  const hasPoseLeft = Boolean(
    pose && pose[15] && Number.isFinite(pose[15].x) && Number.isFinite(pose[15].y) && (pose[15].visibility ?? 1) > 0.3
  );
  const hasPoseRight = Boolean(
    pose && pose[16] && Number.isFinite(pose[16].x) && Number.isFinite(pose[16].y) && (pose[16].visibility ?? 1) > 0.3
  );

  if (hasPoseLeft || hasPoseRight) {
    const lWrist = hasPoseLeft ? pose![15] : null;
    const rWrist = hasPoseRight ? pose![16] : null;
    const distinctWrists = Boolean(
      lWrist && rWrist && Math.hypot(lWrist.x - rWrist.x, lWrist.y - rWrist.y) >= 0.08
    );

    let bestHand: Landmark3D[] | null = null;
    let bestDist = 0.25;

    for (const hand of validHands) {
      const dL = lWrist ? Math.hypot(hand[0].x - lWrist.x, hand[0].y - lWrist.y) : Infinity;
      const dR = rWrist ? Math.hypot(hand[0].x - rWrist.x, hand[0].y - rWrist.y) : Infinity;

      if (distinctWrists) {
        if (dL < bestDist && dL < dR) {
          bestDist = dL;
          bestHand = hand;
        }
      } else if (lWrist) {
        if (dL < bestDist) {
          bestDist = dL;
          bestHand = hand;
        }
      }
    }
    if (bestHand) return bestHand;
    if (distinctWrists) return null;
  }

  if (validHands.length === 1) {
    return validHands[0][0].x < 0.50 ? validHands[0] : null;
  }
  const sorted = [...validHands].sort((a, b) => a[0].x - b[0].x);
  return sorted[0][0].x < 0.55 ? sorted[0] : null;
}

export function findRightHand(hands: Landmark3D[][], pose?: Landmark3D[] | null): Landmark3D[] | null {
  const validHands = hands.filter(h => h && h.length >= 21);
  if (validHands.length === 0) return null;

  const hasPoseLeft = Boolean(
    pose && pose[15] && Number.isFinite(pose[15].x) && Number.isFinite(pose[15].y) && (pose[15].visibility ?? 1) > 0.3
  );
  const hasPoseRight = Boolean(
    pose && pose[16] && Number.isFinite(pose[16].x) && Number.isFinite(pose[16].y) && (pose[16].visibility ?? 1) > 0.3
  );

  if (hasPoseLeft || hasPoseRight) {
    const lWrist = hasPoseLeft ? pose![15] : null;
    const rWrist = hasPoseRight ? pose![16] : null;
    const distinctWrists = Boolean(
      lWrist && rWrist && Math.hypot(lWrist.x - rWrist.x, lWrist.y - rWrist.y) >= 0.08
    );

    let bestHand: Landmark3D[] | null = null;
    let bestDist = 0.25;

    for (const hand of validHands) {
      const dL = lWrist ? Math.hypot(hand[0].x - lWrist.x, hand[0].y - lWrist.y) : Infinity;
      const dR = rWrist ? Math.hypot(hand[0].x - rWrist.x, hand[0].y - rWrist.y) : Infinity;

      if (distinctWrists) {
        if (dR < bestDist && dR < dL) {
          bestDist = dR;
          bestHand = hand;
        }
      } else if (rWrist) {
        if (dR < bestDist) {
          bestDist = dR;
          bestHand = hand;
        }
      }
    }
    if (bestHand) return bestHand;
    if (distinctWrists) return null;
  }

  if (validHands.length === 1) {
    return validHands[0][0].x > 0.50 ? validHands[0] : null;
  }
  const sorted = [...validHands].sort((a, b) => b[0].x - a[0].x);
  return sorted[0][0].x > 0.45 ? sorted[0] : null;
}

export class CombinedCalibrationCapture {
  private body: NonNullable<ReturnType<typeof bodyMetrics>>[] = [];
  private open: number[] = [];
  private pinched: number[] = [];
  private leftTilts: number[] = [];
  private lastAt = -Infinity;

  update(frame: { pose: Landmark3D[] | null; hands: Landmark3D[][] }, elapsedMs: number, now: number): void {
    if (elapsedMs < 0 || elapsedMs >= 5000 || now - this.lastAt < 50) return;
    this.lastAt = now;
    const metrics = bodyMetrics(frame.pose);
    if (metrics) this.body.push(metrics);
    const ratio = frame.hands.map(computePinchRatio).find(value => Number.isFinite(value) && value > 0.02 && value < 2);
    if (ratio !== undefined) (elapsedMs < 2500 ? this.open : this.pinched).push(ratio);

    const leftHand = findLeftHand(frame.hands, frame.pose);
    if (leftHand) {
      const tilt = computeWholeHandTilt(leftHand);
      if (tilt !== null && Number.isFinite(tilt)) {
        this.leftTilts.push(tilt);
      }
    }
  }

  finish(): { baseline?: CalibrationProfile['bodyBaseline']; center?: CalibrationProfile['neutralTorsoCenter']; pinch?: PinchThresholds; cameraBaselineTilt?: number; errors: string[] } {
    const errors: string[] = [];
    let baseline: CalibrationProfile['bodyBaseline'];
    let center: CalibrationProfile['neutralTorsoCenter'] | undefined;
    if (this.body.length < 50) errors.push('Body tracking was insufficient. Keep your face and shoulders in the outline.');
    else {
      const mean = (key: keyof (typeof this.body)[number]) => this.body.reduce((sum, sample) => sum + sample[key], 0) / this.body.length;
      const width = mean('width');
      if (['noseX', 'width'].some(key => Math.sqrt(this.body.reduce((sum, sample) => sum + (sample[key as 'noseX' | 'width'] - mean(key as 'noseX' | 'width')) ** 2, 0) / this.body.length) > width * 0.05)) {
        errors.push('Body stance moved too much. Stand still and try again.');
      } else {
        baseline = {
          version: 1,
          noseX: mean('noseX'),
          shoulderWidth: width,
          headSpan: mean('headSpan'),
          noseRelY: mean('noseRelY'),
          noseEarY: mean('noseEarY'),
          noseRelZ: mean('noseRelZ'),
        };
        center = { x: mean('x'), y: mean('y') };
      }
    }
    let pinch: PinchThresholds | undefined;
    if (this.open.length < 15 || this.pinched.length < 15) errors.push('Hand tracking was insufficient. Show your hand while open and pinched.');
    else {
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const contact = median(this.pinched), release = median(this.open);
      if (release - contact < 0.15) errors.push('Open and pinch poses were too similar. Separate your fingers, then pinch firmly.');
      else pinch = { close: Number((contact + (release - contact) * 0.25).toFixed(3)), open: Number((contact + (release - contact) * 0.65).toFixed(3)) };
    }

    let cameraBaselineTilt: number | undefined;
    if (this.leftTilts.length >= 10) {
      const mean = this.leftTilts.reduce((sum, v) => sum + v, 0) / this.leftTilts.length;
      const variance = this.leftTilts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / this.leftTilts.length;
      const std = Math.sqrt(variance);
      if (std > 0.20) {
        errors.push('Left hand moved too much during calibration. Hold all 5 fingers open pointing steady at the camera.');
      } else {
        const sorted = [...this.leftTilts].sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        cameraBaselineTilt = Math.max(-0.35, Math.min(0.35, Number(med.toFixed(3))));
      }
    } else {
      cameraBaselineTilt = 0;
    }

    return { baseline, center, pinch, cameraBaselineTilt, errors };
  }
}

export class MedianFilter3 {
  private values: number[] = [];
  private lastAt: number = 0;

  public update(val: number, now = performance.now()): number {
    if (!Number.isFinite(val)) {
      this.values = [];
      return NaN;
    }
    if (now - this.lastAt > 300) {
      this.values = [];
    }
    this.lastAt = now;
    this.values.push(val);
    if (this.values.length > 3) {
      this.values.shift();
    }
    const sorted = [...this.values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];
    if (sorted.length === 2) return (sorted[0] + sorted[1]) / 2;
    return sorted[1];
  }

  public reset(): void {
    this.values = [];
  }
}

export class PinchTracker {
  public thresholds: PinchThresholds = { ...DEFAULT_CALIBRATION.pinchThresholds };
  private filter = new MedianFilter3();
  private isPinched: boolean = false;
  private isArmed: boolean = false;
  private openSince: number | null = null;
  private lastSeenAt: number = 0;

  constructor(thresholds?: PinchThresholds) {
    if (thresholds) {
      this.thresholds = { ...thresholds };
    }
  }

  public get pinched(): boolean {
    return this.isPinched;
  }

  public update(
    rawRatio: number,
    now = performance.now()
  ): 'hover' | 'start' | 'draw' | 'hold' | 'end' | 'cancel' {
    const ratio = this.filter.update(rawRatio, now);

    if (!Number.isFinite(ratio)) {
      this.openSince = null;
      if (this.lastSeenAt > 0 && now - this.lastSeenAt <= 300) {
        return 'hold';
      }
      this.reset();
      return 'cancel';
    }

    this.lastSeenAt = now;

    if (ratio > this.thresholds.open) {
      if (!this.isPinched) {
        this.isArmed = true;
        return 'hover';
      }
      this.openSince ??= now;
      if (now - this.openSince < 120) {
        return 'hold';
      }
      this.isPinched = false;
      this.isArmed = true;
      this.openSince = null;
      return 'end';
    }

    this.openSince = null;
    if (ratio < this.thresholds.close && this.isArmed && !this.isPinched) {
      this.isPinched = true;
      return 'start';
    }

    return this.isPinched ? 'draw' : 'hover';
  }

  public reset(): void {
    this.isPinched = false;
    this.isArmed = false;
    this.openSince = null;
    this.filter.reset();
  }
}

/**
 * Computes pinch ratio from hand landmarks:
 * Distance between thumb tip (4) and index tip (8),
 * divided by hand scale reference (wrist 0 to index MCP 5 or middle MCP 9).
 */
export function computePinchRatio(hand: Landmark3D[]): number {
  if (!hand || hand.length < 21) return NaN;
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const wrist = hand[0];
  const indexMcp = hand[5];
  const middleMcp = hand[9];

  const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
  const scaleIndex = Math.hypot(wrist.x - indexMcp.x, wrist.y - indexMcp.y);
  const scaleMiddle = middleMcp ? Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) : 0;
  const handScale = Math.max(0.08, scaleIndex, scaleMiddle);
  return pinchDist / handScale;
}

export function computeTorsoMetrics(pose: Landmark3D[] | null): {
  center: { x: number; y: number };
  shoulderWidth: number;
} | null {
  if (!pose || pose.length < 13) return null;
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  if (!leftShoulder || !rightShoulder) return null;

  const center = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
  };
  const shoulderWidth = Math.hypot(
    leftShoulder.x - rightShoulder.x,
    leftShoulder.y - rightShoulder.y
  );

  return { center, shoulderWidth: Math.max(0.1, shoulderWidth) };
}




export function bodyMetrics(pose: Landmark3D[] | null) {
  const points = [pose?.[0], pose?.[11], pose?.[12]];
  if (
    points.some(
      p =>
        !p ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x <= 0 ||
        p.x >= 1 ||
        p.y <= 0 ||
        p.y >= 1 ||
        !(p.visibility! >= 0.6)
    )
  ) {
    return null;
  }
  const [nose, left, right] = points as Landmark3D[];
  const width = Math.abs(left.x - right.x);
  if (width < 0.05) return null;

  const shoulderX = (left.x + right.x) / 2;
  const shoulderY = (left.y + right.y) / 2;
  const shoulderZ =
    ((Number.isFinite(left.z) ? left.z : 0) + (Number.isFinite(right.z) ? right.z : 0)) / 2;

  const lEar = pose?.[7];
  const rEar = pose?.[8];
  const lEye = pose?.[2];
  const rEye = pose?.[5];
  const validLm = (p: Landmark3D | undefined) =>
    Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= 0.4);

  const earSpan =
    validLm(lEar) && validLm(rEar) ? Math.hypot(lEar!.x - rEar!.x, lEar!.y - rEar!.y) : 0;
  const eyeSpan =
    validLm(lEye) && validLm(rEye) ? Math.hypot(lEye!.x - rEye!.x, lEye!.y - rEye!.y) : 0;

  let headSpan = 0;
  if (earSpan > 0.015 && eyeSpan > 0.008) {
    headSpan = earSpan * 0.65 + eyeSpan * 1.8 * 0.35;
  } else if (earSpan > 0.015) {
    headSpan = earSpan;
  } else if (eyeSpan > 0.008) {
    headSpan = eyeSpan * 1.8;
  }

  const noseRelY = nose.y - shoulderY;
  const earMidY =
    earSpan > 0.015 && lEar && rEar
      ? (lEar.y + rEar.y) / 2
      : eyeSpan > 0.008 && lEye && rEye
      ? (lEye.y + rEye.y) / 2
      : nose.y;
  const noseEarY = nose.y - earMidY;
  const noseZ = Number.isFinite(nose.z) ? nose.z : 0;
  const noseRelZ = noseZ - shoulderZ;

  return {
    noseX: nose.x,
    width,
    x: shoulderX,
    y: shoulderY,
    headSpan,
    noseRelY,
    noseEarY,
    noseRelZ,
  };
}

/**
 * Fuses Shoulder Depth + Head Depth (ear/eye span scale & nose relative Z) + Head Pitch
 * (nodding/tilting head forward/back relative to shoulders and ears) into a unified
 * forward/backward depth ratio (neutral = 1.0, >1.0 = Forward, <1.0 = Backward).
 */
export function computeEffectiveDepthRatio(
  m: NonNullable<ReturnType<typeof bodyMetrics>>,
  base: BodyBaseline,
  inferredHeadBase?: { headSpan: number; noseRelY: number; noseEarY: number; noseRelZ: number }
): number {
  const sw = Math.max(0.05, base.shoulderWidth);
  const shoulderDelta = m.width / sw - 1;

  // 1. Head Depth Delta (Ear/Eye span scale + Nose relative Z)
  const refHeadSpan = base.headSpan ?? inferredHeadBase?.headSpan ?? 0;
  const spanDelta =
    m.headSpan > 0.015 && refHeadSpan > 0.015 ? m.headSpan / refHeadSpan - 1 : 0;

  const refNoseRelZ = base.noseRelZ ?? inferredHeadBase?.noseRelZ ?? 0;
  const zDiff = -(m.noseRelZ - refNoseRelZ);
  const zDelta = Math.abs(zDiff) > 0.008 ? (zDiff / Math.max(0.18, sw)) * 0.48 : 0;

  let headDepthDelta = 0;
  if (spanDelta !== 0 && zDelta !== 0 && Math.sign(spanDelta) === Math.sign(zDelta)) {
    headDepthDelta =
      Math.abs(spanDelta) >= Math.abs(zDelta)
        ? spanDelta + zDelta * 0.5
        : zDelta + spanDelta * 0.5;
  } else {
    headDepthDelta = spanDelta + zDelta;
  }

  // 2. Head Pitch Delta (Nodding forward/down -> positive; tilting head back/up -> negative)
  // Attenuate pitch when leaning laterally so sideways head tilt never triggers forward/backward.
  const lateralNormX = (m.noseX - base.noseX) / sw;
  const lateralAttenuation = Math.max(0, 1 - (Math.abs(lateralNormX) / 0.42) ** 2);

  const hasExplicitRelY = base.noseRelY !== undefined || inferredHeadBase !== undefined;
  const refNoseRelY = base.noseRelY ?? inferredHeadBase?.noseRelY ?? 0;
  const relYDiff = hasExplicitRelY ? (m.noseRelY - refNoseRelY) / sw : 0;

  const refNoseEarY = base.noseEarY ?? inferredHeadBase?.noseEarY ?? 0;
  const earYDiff = m.headSpan > 0.015 ? (m.noseEarY - refNoseEarY) / sw : 0;

  const rawPitchDelta = relYDiff * 0.95 + earYDiff * 1.35;
  const headPitchDelta = Math.max(-0.35, Math.min(0.35, rawPitchDelta * lateralAttenuation));

  // 3. Fuse Torso Shoulder Depth + Head Depth + Head Pitch
  const headTotalDelta = headDepthDelta + headPitchDelta;
  let fusedDelta: number;
  if (
    shoulderDelta === 0 ||
    headTotalDelta === 0 ||
    Math.sign(shoulderDelta) === Math.sign(headTotalDelta)
  ) {
    fusedDelta =
      Math.abs(shoulderDelta) >= Math.abs(headTotalDelta)
        ? shoulderDelta + headTotalDelta * 0.65
        : headTotalDelta + shoulderDelta * 0.65;
  } else {
    fusedDelta = shoulderDelta + headTotalDelta * 0.85;
  }

  return Math.max(0.25, Math.min(2.5, 1 + fusedDelta));
}

export class BodyCalibrationCapture {
  samples: NonNullable<ReturnType<typeof bodyMetrics>>[] = [];
  private last = -Infinity;
  private requiredSamples: number;
  constructor(requiredSamples = 75) { this.requiredSamples = requiredSamples; }
  update(pose: Landmark3D[] | null, now: number) {
    if (now - this.last > 300) this.samples = [];
    const m = bodyMetrics(pose);
    if (!m || now - this.last < 50) return null;
    this.last = now;
    this.samples.push(m);
    if (this.samples.length < this.requiredSamples) return null;
    const mean = (key: keyof typeof m) => this.samples.reduce((a,b) => a+b[key],0)/this.samples.length;
    const width = mean('width'), noseX = mean('noseX');
    const unstable = ['width','noseX'].some(key => Math.sqrt(this.samples.reduce((a,b)=>a+(b[key as keyof typeof m]-mean(key as keyof typeof m))**2,0)/this.samples.length) > width*0.05);
    const center = {x:mean('x'),y:mean('y')};
    const headSpan = mean('headSpan'), noseRelY = mean('noseRelY'), noseEarY = mean('noseEarY'), noseRelZ = mean('noseRelZ');
    this.samples = [];
    return unstable ? { error: true as const } : { error: false as const, baseline: {version: 1 as const,noseX,shoulderWidth:width,headSpan,noseRelY,noseEarY,noseRelZ}, center };
  }
}

export class LeftHandCalibrationCapture {
  public samples: number[] = [];
  private last = -Infinity;
  private requiredSamples: number;

  constructor(requiredSamples = 15) {
    this.requiredSamples = requiredSamples;
  }

  update(
    hands: Landmark3D[][],
    pose: Landmark3D[] | null,
    now: number
  ): { error: true } | { error: false; cameraBaselineTilt: number } | null {
    if (now - this.last > 400) this.samples = [];
    const leftHand = findLeftHand(hands, pose);
    if (!leftHand) return null;
    const tilt = computeWholeHandTilt(leftHand);
    if (tilt === null || !Number.isFinite(tilt) || now - this.last < 40) return null;

    this.last = now;
    this.samples.push(tilt);
    if (this.samples.length < this.requiredSamples) return null;

    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const variance = this.samples.reduce((a, b) => a + (b - mean) ** 2, 0) / this.samples.length;
    const std = Math.sqrt(variance);

    this.samples = [];
    if (std > 0.15) {
      return { error: true };
    }
    const cameraBaselineTilt = Math.max(-0.35, Math.min(0.35, Number(mean.toFixed(3))));
    return { error: false, cameraBaselineTilt };
  }

  get sampleCount(): number {
    return this.samples.length;
  }
}

