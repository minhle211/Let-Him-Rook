import type { Landmark3D } from '../vision/visionManager.ts';
import { computePinchRatio, type PinchThresholds } from './calibration.ts';

/**
 * One Euro filter (Casiez et al. 2012): an adaptive low-pass filter. It smooths
 * heavily while the signal is slow (kills landmark jitter when the hand is
 * still) and barely at all while it is fast (no lag when sweeping the hand).
 */
export class OneEuroFilter {
  private value: number | null = null;
  private derivative = 0;
  private lastAt = 0;
  private readonly minCutoffHz: number;
  private readonly beta: number;
  private readonly derivativeCutoffHz: number;

  /**
   * @param minCutoffHz smoothing when still (lower = smoother, more lag)
   * @param beta how quickly smoothing relaxes with speed (higher = less lag when moving)
   */
  constructor(minCutoffHz = 1.2, beta = 12, derivativeCutoffHz = 1.0) {
    this.minCutoffHz = minCutoffHz;
    this.beta = beta;
    this.derivativeCutoffHz = derivativeCutoffHz;
  }

  private static alpha(cutoffHz: number, dtSec: number): number {
    return 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtSec));
  }

  public filter(raw: number, now: number): number {
    const dtSec = (now - this.lastAt) / 1000;
    if (this.value === null || dtSec <= 0 || dtSec > 0.3) {
      // First sample or after a tracking gap: start fresh instead of smearing across the gap.
      this.value = raw;
      this.derivative = 0;
      this.lastAt = now;
      return raw;
    }
    this.lastAt = now;
    const rawDerivative = (raw - this.value) / dtSec;
    this.derivative += OneEuroFilter.alpha(this.derivativeCutoffHz, dtSec) * (rawDerivative - this.derivative);
    const cutoff = this.minCutoffHz + this.beta * Math.abs(this.derivative);
    this.value += OneEuroFilter.alpha(cutoff, dtSec) * (raw - this.value);
    return this.value;
  }

  public reset(): void {
    this.value = null;
    this.derivative = 0;
  }
}

export type PinchIntent = 'steady' | 'moving' | 'closing' | 'opening';

export interface PinchMotionSample {
  /** Smoothed midpoint between thumb tip and index tip: where the fingers will meet. */
  point: { x: number; y: number };
  /** Thumb–index distance divided by hand size (same units as the calibration thresholds). */
  ratio: number;
  /** Palm translation speed in hand-lengths per second. */
  handSpeed: number;
  /** d(ratio)/dt in hand-lengths per second; negative = fingers closing. */
  apertureVelocity: number;
  intent: PinchIntent;
}

/** Palm speed (hand-lengths/s) below which the hand counts as steady. */
export const HAND_STEADY_SPEED = 0.8;
/** Palm speed at which pinch thresholds are fully tightened for "moving". */
export const HAND_FAST_SPEED = 2.5;
/** Aperture speed (hand-lengths/s) that counts as the fingers actively closing/opening. */
export const APERTURE_ACTIVE_SPEED = 0.6;

const SPEED_SMOOTHING_MS = 80;
const APERTURE_SMOOTHING_MS = 60;

function emaAlpha(dtMs: number, tauMs: number): number {
  return 1 - Math.exp(-dtMs / tauMs);
}

/**
 * Tracks the pinch point and separates "the fingers are pinching" from "the
 * whole hand is moving". Fingertip closing speed and palm speed are both in
 * hand-lengths per second, so they compare directly at any camera distance.
 */
export class PinchMotionTracker {
  private readonly filterX = new OneEuroFilter();
  private readonly filterY = new OneEuroFilter();
  private lastPalm: { x: number; y: number } | null = null;
  private lastRatio = NaN;
  private lastAt = 0;
  private handSpeed = 0;
  private apertureVelocity = 0;

  public update(hand: Landmark3D[], now: number): PinchMotionSample {
    const thumbTip = hand[4];
    const indexTip = hand[8];
    const point = {
      x: this.filterX.filter((thumbTip.x + indexTip.x) / 2, now),
      y: this.filterY.filter((thumbTip.y + indexTip.y) / 2, now),
    };
    const ratio = computePinchRatio(hand);

    // Palm center from the wrist + knuckles: unaffected by the fingers pinching.
    const palm = {
      x: (hand[0].x + hand[5].x + hand[17].x) / 3,
      y: (hand[0].y + hand[5].y + hand[17].y) / 3,
    };
    const handScale = Math.max(0.05, Math.hypot(hand[0].x - hand[9].x, hand[0].y - hand[9].y));

    const dtMs = now - this.lastAt;
    if (this.lastPalm && dtMs > 0 && dtMs <= 300) {
      const instantSpeed = Math.hypot(palm.x - this.lastPalm.x, palm.y - this.lastPalm.y) / handScale / (dtMs / 1000);
      this.handSpeed += emaAlpha(dtMs, SPEED_SMOOTHING_MS) * (instantSpeed - this.handSpeed);
      if (Number.isFinite(ratio) && Number.isFinite(this.lastRatio)) {
        const instantAperture = (ratio - this.lastRatio) / (dtMs / 1000);
        this.apertureVelocity += emaAlpha(dtMs, APERTURE_SMOOTHING_MS) * (instantAperture - this.apertureVelocity);
      }
    } else {
      this.handSpeed = 0;
      this.apertureVelocity = 0;
    }
    this.lastPalm = palm;
    this.lastRatio = ratio;
    this.lastAt = now;

    return { point, ratio, handSpeed: this.handSpeed, apertureVelocity: this.apertureVelocity, intent: this.classify() };
  }

  private classify(): PinchIntent {
    const fingerSpeed = Math.abs(this.apertureVelocity);
    // The fingers count as pinching only if they move faster than the whole hand travels.
    if (fingerSpeed >= APERTURE_ACTIVE_SPEED && fingerSpeed > this.handSpeed) {
      return this.apertureVelocity < 0 ? 'closing' : 'opening';
    }
    return this.handSpeed > HAND_STEADY_SPEED ? 'moving' : 'steady';
  }

  public reset(): void {
    this.filterX.reset();
    this.filterY.reset();
    this.lastPalm = null;
    this.lastRatio = NaN;
    this.handSpeed = 0;
    this.apertureVelocity = 0;
  }
}

/**
 * While the hand is being repositioned, require a firmer pinch to grab and a
 * wider opening to drop: motion blur and wrist rotation briefly shrink or
 * stretch the 2D thumb–index distance without the player meaning to pinch.
 * A deliberate pinch (fingers closing faster than the hand moves) keeps the
 * calibrated thresholds.
 */
export function adaptPinchThresholds(base: PinchThresholds, sample: PinchMotionSample): PinchThresholds {
  if (sample.intent === 'closing' || sample.intent === 'opening') return { ...base };
  const t = Math.min(1, Math.max(0, (sample.handSpeed - HAND_STEADY_SPEED) / (HAND_FAST_SPEED - HAND_STEADY_SPEED)));
  return { close: base.close * (1 - 0.25 * t), open: base.open * (1 + 0.2 * t) };
}
