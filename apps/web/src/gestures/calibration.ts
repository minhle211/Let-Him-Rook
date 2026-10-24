import type { Landmark3D } from '../vision/visionManager.ts';

export interface PinchThresholds {
  close: number;
  open: number;
}

export interface CalibrationProfile {
  bodyCalibrated?: boolean;
  bodyBaseline?: { version: 1; noseX: number; shoulderWidth: number };
  movementSensitivity?: { forward: number; backward: number; left: number; right: number };
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

export const DEFAULT_MOVEMENT_SENSITIVITY = { forward: 1, backward: 1, left: 1, right: 1 };

export class CombinedCalibrationCapture {
  private body: NonNullable<ReturnType<typeof bodyMetrics>>[] = [];
  private open: number[] = [];
  private pinched: number[] = [];
  private lastAt = -Infinity;

  update(frame: { pose: Landmark3D[] | null; hands: Landmark3D[][] }, elapsedMs: number, now: number): void {
    if (elapsedMs < 0 || elapsedMs >= 5000 || now - this.lastAt < 50) return;
    this.lastAt = now;
    const metrics = bodyMetrics(frame.pose);
    if (metrics) this.body.push(metrics);
    const ratio = frame.hands.map(computePinchRatio).find(value => Number.isFinite(value) && value > 0.02 && value < 2);
    if (ratio !== undefined) (elapsedMs < 2500 ? this.open : this.pinched).push(ratio);
  }

  finish(): { baseline?: CalibrationProfile['bodyBaseline']; center?: CalibrationProfile['neutralTorsoCenter']; pinch?: PinchThresholds; errors: string[] } {
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
        baseline = { version: 1, noseX: mean('noseX'), shoulderWidth: width };
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
    return { baseline, center, pinch, errors };
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

export function isOpenPalm(hand: Landmark3D[]): boolean {
  if (!hand || hand.length < 21) return false;
  const wrist = hand[0];
  const tips = [hand[4], hand[8], hand[12], hand[16], hand[20]];
  const mcps = [hand[2], hand[5], hand[9], hand[13], hand[17]];

  for (let i = 0; i < 5; i++) {
    const tipDist = Math.hypot(tips[i].x - wrist.x, tips[i].y - wrist.y);
    const mcpDist = Math.hypot(mcps[i].x - wrist.x, mcps[i].y - wrist.y);
    if (tipDist < mcpDist * 1.1) {
      return false; // Finger is curled
    }
  }
  return true;
}


export function bodyMetrics(pose: Landmark3D[] | null) {
  const points = [pose?.[0], pose?.[11], pose?.[12]];
  if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x <= 0 || p.x >= 1 || p.y <= 0 || p.y >= 1 || !(p.visibility! >= 0.6))) return null;
  const [nose, left, right] = points as Landmark3D[];
  const width = Math.abs(left.x - right.x);
  return width >= 0.05 ? { noseX: nose.x, width, x: (left.x + right.x)/2, y: (left.y + right.y)/2 } : null;
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
    this.samples = [];
    return unstable ? { error: true as const } : { error: false as const, baseline: {version: 1 as const,noseX,shoulderWidth:width}, center };
  }
}
