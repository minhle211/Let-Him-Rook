import type { Landmark3D } from '../vision/visionManager.ts';

export interface PinchThresholds {
  close: number;
  open: number;
}

export interface CalibrationProfile {
  bodyCalibrated?: boolean;
  bodyBaseline?: { version: 1; noseX: number; shoulderWidth: number };
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
  update(pose: Landmark3D[] | null, now: number) {
    if (now - this.last > 300) this.samples = [];
    const m = bodyMetrics(pose);
    if (!m || now - this.last < 50) return null;
    this.last = now;
    this.samples.push(m);
    if (this.samples.length < 75) return null;
    const mean = (key: keyof typeof m) => this.samples.reduce((a,b) => a+b[key],0)/this.samples.length;
    const width = mean('width'), noseX = mean('noseX');
    const unstable = ['width','noseX'].some(key => Math.sqrt(this.samples.reduce((a,b)=>a+(b[key as keyof typeof m]-mean(key as keyof typeof m))**2,0)/this.samples.length) > width*0.05);
    const center = {x:mean('x'),y:mean('y')};
    this.samples = [];
    return unstable ? { error: true as const } : { error: false as const, baseline: {version: 1 as const,noseX,shoulderWidth:width}, center };
  }
}
