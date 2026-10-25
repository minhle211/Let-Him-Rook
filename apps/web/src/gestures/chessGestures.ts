import {
  pointToBoardSquare,
  type BoardSquare,
  type PlayerColor,
  type PromotionPieceClass,
} from '@let-him-rook/shared';
import type { Landmark3D } from '../vision/visionManager.ts';
import {
  PinchTracker,
  isOpenPalm,
  type CalibrationProfile,
} from './calibration.ts';
import { PinchMotionTracker, adaptPinchThresholds, type PinchMotionSample } from './pinchMotion.ts';

/** A grab/drop target lock never outlives this unless the fingers are still closing/opening. */
const TARGET_LOCK_MAX_MS = 400;

type PinchAction = ReturnType<PinchTracker['update']>;

interface TargetLock {
  point: { x: number; y: number };
  since: number;
  kind: 'grab' | 'drop';
}

export interface ChessGestureIntent {
  from: BoardSquare;
  to: BoardSquare;
}

export { isOpenPalm };

export class ChessGestureController {
  private pinchTracker = new PinchTracker();
  private motion = new PinchMotionTracker();
  private lock: TargetLock | null = null;
  private lastPoint: { x: number; y: number } | null = null;
  public hoverSquare: BoardSquare | null = null;
  public selectedSquare: BoardSquare | null = null;
  /** Smoothed thumb–index midpoint, frozen while a grab/drop is in progress. */
  public cursorPoint: { x: number; y: number } | null = null;
  public isPinching: boolean = false;
  private openPalmFrames: number = 0;

  /**
   * Pinch point + adaptive pinch detection for one frame.
   * - The cursor is the midpoint between thumb and index tips, so the fingers
   *   meet where the cursor already is instead of dragging it toward the thumb.
   * - When the fingers close (or open) faster than the hand moves, the target is
   *   locked to where the cursor was when that started, so hand drift during the
   *   pinch can't change the grabbed/dropped square.
   * - While the hand is being repositioned, pinch thresholds tighten so motion
   *   doesn't register as a grab or drop.
   */
  private trackPinch(hand: Landmark3D[], calibration: CalibrationProfile, now: number): PinchAction {
    const sample = this.motion.update(hand, now);
    this.updateLock(sample, now);

    const base = calibration?.pinchThresholds ?? this.pinchTracker.thresholds;
    this.pinchTracker.thresholds = adaptPinchThresholds(base, sample);
    const action = this.pinchTracker.update(sample.ratio, now);
    this.isPinching = this.pinchTracker.pinched;

    this.cursorPoint = this.lock ? { ...this.lock.point } : sample.point;
    this.lastPoint = sample.point;
    return action;
  }

  private updateLock(sample: PinchMotionSample, now: number): void {
    const pinched = this.pinchTracker.pinched;
    const onset = this.lastPoint ?? sample.point;
    if (!pinched && sample.intent === 'closing') {
      this.lock ??= { point: onset, since: now, kind: 'grab' };
    } else if (pinched && sample.intent === 'opening') {
      this.lock ??= { point: onset, since: now, kind: 'drop' };
    }
    if (!this.lock) return;
    const stillActive = sample.intent === (this.lock.kind === 'grab' ? 'closing' : 'opening');
    const expired = !stillActive && now - this.lock.since > TARGET_LOCK_MAX_MS;
    // Fingers stopped closing and the hand is travelling: the player is repositioning, not grabbing.
    const abandonedGrab = this.lock.kind === 'grab' && sample.intent === 'moving';
    if (expired || abandonedGrab) {
      this.lock = null;
    }
  }

  private clearTracking(): void {
    this.motion.reset();
    this.lock = null;
    this.lastPoint = null;
  }

  public update(
    hand: Landmark3D[] | null,
    color: PlayerColor,
    legalMoves: Record<BoardSquare, BoardSquare[]>,
    calibration: CalibrationProfile,
    now = performance.now()
  ): { intent: ChessGestureIntent | null; cancelled: boolean } {
    if (!hand || hand.length < 21) {
      const pinchAction = this.pinchTracker.update(NaN, now);
      this.isPinching = this.pinchTracker.pinched;
      if (pinchAction === 'cancel') {
        this.hoverSquare = null;
        this.selectedSquare = null;
        this.cursorPoint = null;
        this.clearTracking();
      }
      return { intent: null, cancelled: false };
    }

    // 1. Check open palm cancel (4 consecutive frames)
    if (isOpenPalm(hand)) {
      this.openPalmFrames++;
      if (this.openPalmFrames >= 4 && this.selectedSquare !== null) {
        this.selectedSquare = null;
        this.openPalmFrames = 0;
        this.pinchTracker.reset();
        this.lock = null;
        this.isPinching = false;
        return { intent: null, cancelled: true };
      }
    } else {
      this.openPalmFrames = 0;
    }

    // 2. Pinch tracking first so we can freeze target square during release confirmation
    const pinchAction = this.trackPinch(hand, calibration, now);
    const cursor = this.cursorPoint!;

    // 3. Map the (possibly locked) pinch point to a board square
    if (pinchAction === 'end' && pointToBoardSquare(cursor, color) === null) {
      this.hoverSquare = null;
    } else if (pinchAction !== 'hold' && pinchAction !== 'end') {
      this.hoverSquare = pointToBoardSquare(cursor, color, this.hoverSquare);
    }

    if (pinchAction === 'start') {
      if (this.hoverSquare && legalMoves[this.hoverSquare]?.length) {
        this.selectedSquare = this.hoverSquare;
      }
      this.lock = null; // grabbed: the piece now follows the hand
    } else if (pinchAction === 'end') {
      this.lock = null;
      if (this.selectedSquare && this.hoverSquare) {
        const from = this.selectedSquare;
        const to = this.hoverSquare;
        const validDests = legalMoves[from];

        this.selectedSquare = null;
        if (validDests && validDests.includes(to)) {
          return { intent: { from, to }, cancelled: false };
        }
      }
      this.selectedSquare = null;
    } else if (pinchAction === 'cancel') {
      this.selectedSquare = null;
      this.lock = null;
    }

    return { intent: null, cancelled: false };
  }

  /**
   * Maps fingertip cursor + pinch to the 2x2 PromotionModal choices:
   * Top-left: queen, Top-right: rook, Bottom-left: bishop, Bottom-right: knight
   */
  public updatePromotionSelection(
    hand: Landmark3D[] | null,
    calibration: CalibrationProfile,
    now = performance.now()
  ): { hover: PromotionPieceClass | null; selected: PromotionPieceClass | null } {
    if (!hand || hand.length < 21) {
      if (this.pinchTracker.update(NaN, now) === 'cancel') this.clearTracking();
      this.isPinching = this.pinchTracker.pinched;
      return { hover: null, selected: null };
    }

    const pinchAction = this.trackPinch(hand, calibration, now);
    if (pinchAction === 'start' || pinchAction === 'end' || pinchAction === 'cancel') this.lock = null;
    const cursor = this.cursorPoint!;

    const x = (cursor.x - 0.15) / 0.7;
    const y = (cursor.y - 0.15) / 0.7;
    if (x < 0 || x > 1 || y < 0 || y > 1) {
      return { hover: null, selected: null };
    }

    const isRight = x >= 0.5;
    const isBottom = y >= 0.5;
    const choice: PromotionPieceClass = !isBottom
      ? isRight
        ? 'rook'
        : 'queen'
      : isRight
      ? 'knight'
      : 'bishop';

    if (pinchAction === 'start' || pinchAction === 'end') {
      return { hover: choice, selected: choice };
    }
    return { hover: choice, selected: null };
  }

  public reset(): void {
    this.hoverSquare = null;
    this.selectedSquare = null;
    this.cursorPoint = null;
    this.isPinching = false;
    this.openPalmFrames = 0;
    this.pinchTracker.reset();
    this.clearTracking();
  }
}
