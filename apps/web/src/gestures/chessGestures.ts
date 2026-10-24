import {
  pointToBoardSquare,
  type BoardSquare,
  type PlayerColor,
  type PromotionPieceClass,
} from '@let-him-rook/shared';
import type { Landmark3D } from '../vision/visionManager.ts';
import {
  PinchTracker,
  computePinchRatio,
  isOpenPalm,
  type CalibrationProfile,
} from './calibration.ts';

export interface ChessGestureIntent {
  from: BoardSquare;
  to: BoardSquare;
}

export { isOpenPalm };

export class ChessGestureController {
  private pinchTracker = new PinchTracker();
  public hoverSquare: BoardSquare | null = null;
  public selectedSquare: BoardSquare | null = null;
  public cursorPoint: { x: number; y: number } | null = null;
  public isPinching: boolean = false;
  private openPalmFrames: number = 0;

  public update(
    hand: Landmark3D[] | null,
    color: PlayerColor,
    legalMoves: Record<BoardSquare, BoardSquare[]>,
    calibration: CalibrationProfile,
    now = performance.now()
  ): { intent: ChessGestureIntent | null; cancelled: boolean } {
    if (calibration?.pinchThresholds) {
      this.pinchTracker.thresholds = { ...calibration.pinchThresholds };
    }

    if (!hand || hand.length < 21) {
      const pinchAction = this.pinchTracker.update(NaN, now);
      this.isPinching = this.pinchTracker.pinched;
      if (pinchAction === 'cancel') {
        this.hoverSquare = null;
        this.selectedSquare = null;
        this.cursorPoint = null;
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
        this.isPinching = false;
        return { intent: null, cancelled: true };
      }
    } else {
      this.openPalmFrames = 0;
    }

    // 2. Pinch tracking first so we can freeze target square during release confirmation
    const ratio = computePinchRatio(hand);
    const pinchAction = this.pinchTracker.update(ratio, now);
    this.isPinching = this.pinchTracker.pinched;

    // 3. Map index fingertip (landmark 8) to board square
    const indexTip = hand[8];
    this.cursorPoint = { x: indexTip.x, y: indexTip.y };

    if (pinchAction === 'end' && pointToBoardSquare(this.cursorPoint, color) === null) {
      this.hoverSquare = null;
    } else if (pinchAction !== 'hold' && pinchAction !== 'end') {
      this.hoverSquare = pointToBoardSquare(this.cursorPoint, color, this.hoverSquare);
    }

    if (pinchAction === 'start') {
      if (this.hoverSquare && legalMoves[this.hoverSquare]?.length) {
        this.selectedSquare = this.hoverSquare;
      }
    } else if (pinchAction === 'end') {
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
    if (calibration?.pinchThresholds) {
      this.pinchTracker.thresholds = { ...calibration.pinchThresholds };
    }
    if (!hand || hand.length < 21) {
      this.pinchTracker.update(NaN, now);
      this.isPinching = this.pinchTracker.pinched;
      return { hover: null, selected: null };
    }

    const indexTip = hand[8];
    this.cursorPoint = { x: indexTip.x, y: indexTip.y };
    const ratio = computePinchRatio(hand);
    const pinchAction = this.pinchTracker.update(ratio, now);
    this.isPinching = this.pinchTracker.pinched;

    const x = (indexTip.x - 0.15) / 0.7;
    const y = (indexTip.y - 0.15) / 0.7;
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
  }
}
