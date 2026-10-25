import type {
  BoardSquare,
  DuelEvent,
  DuelSnapshot,
  MatchSnapshot,
  PlayerColor,
  PromotionPieceClass,
} from '@let-him-rook/shared';
import {
  buildFightRecord,
  emptyTally,
  fightEndFromSnapshot,
  loadJournal,
  noteDuelEvents,
  saveJournal,
  type FightRecord,
  type FightTally,
} from '../review/fightReview.ts';

export interface InterpolatedFighter {
  x: number;
  z: number;
  facingRad: number;
  hp: number;
  isParrying: boolean;
  isChilled: boolean;
}

export interface InterpolationState {
  prevDuel: DuelSnapshot | null;
  targetDuel: DuelSnapshot | null;
  prevReceivedAt: number;
  targetReceivedAt: number;
}

export interface VisualDuelEffect {
  id: string;
  event: DuelEvent;
  createdAt: number;
}

export interface MatchState {
  snapshot: MatchSnapshot | null;
  localColor: PlayerColor | null;
  token: string | null;
  hoverSquare: BoardSquare | null;
  selectedSquare: BoardSquare | null;
  promotionMove: { from: BoardSquare; to: BoardSquare } | null;
  promotionHover: PromotionPieceClass | null;
  cursorPoint: { x: number; y: number } | null;
  isPinching: boolean;
  feedbackToast: { message: string; isError: boolean; timestamp: number } | null;
  aiAdvice: string | null;
  interpolation: InterpolationState;
  fightJournal: FightRecord[];
  fightReview: FightRecord | null;
  reviewOpen: boolean;
  localMoveIntent: {
    moveX: number;
    moveZ: number;
    turnDir: number;
    updatedAt: number;
  };
  visualEffects: VisualDuelEffect[];
}

export type StateListener = (state: MatchState) => void;

class MatchStoreManager {
  private state: MatchState = {
    snapshot: null,
    localColor: null,
    token: null,
    hoverSquare: null,
    selectedSquare: null,
    promotionMove: null,
    promotionHover: null,
    cursorPoint: null,
    isPinching: false,
    feedbackToast: null,
    aiAdvice: null,
    interpolation: {
      prevDuel: null,
      targetDuel: null,
      prevReceivedAt: 0,
      targetReceivedAt: 0,
    },
    localMoveIntent: {
      moveX: 0,
      moveZ: 0,
      turnDir: 0,
      updatedAt: 0,
    },
    visualEffects: [],
    fightJournal: loadJournal(),
    fightReview: null,
    reviewOpen: false,
  };

  private listeners: Set<StateListener> = new Set();
  private effectCounter = 0;
  private fightTally: FightTally = emptyTally();
  private finalizedDuelKey: number | null = null;

  public getState(): MatchState {
    return this.state;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) {
      l(this.state);
    }
  }

  public setLocalMoveIntent(moveX: number, moveZ: number, turnDir: number): void {
    this.state.localMoveIntent = {
      moveX,
      moveZ,
      turnDir,
      updatedAt: performance.now(),
    };
  }

  public setSession(localColor: PlayerColor, token: string): void {
    this.state = { ...this.state, localColor, token };
    this.emit();
  }

  public clearSession(): void {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('rook_room_id');
      sessionStorage.removeItem('rook_token');
    }
    this.state = {
      ...this.state,
      snapshot: null,
      localColor: null,
      token: null,
      hoverSquare: null,
      selectedSquare: null,
      promotionMove: null,
      promotionHover: null,
      aiAdvice: null,
      interpolation: {
        prevDuel: null,
        targetDuel: null,
        prevReceivedAt: 0,
        targetReceivedAt: 0,
      },
      localMoveIntent: {
        moveX: 0,
        moveZ: 0,
        turnDir: 0,
        updatedAt: 0,
      },
      visualEffects: [],
      reviewOpen: false,
    };
    this.fightTally = emptyTally();
    this.finalizedDuelKey = null;
    this.emit();
  }

  public setSnapshot(newSnapshot: MatchSnapshot): void {
    const now = performance.now();
    const nextDuel = newSnapshot.duelSnapshot ? { ...newSnapshot.duelSnapshot } : null;
    const oldTarget = this.state.interpolation.targetDuel;
    const oldReceivedAt = this.state.interpolation.targetReceivedAt;

    // Prevent stale >150ms gaps (such as after 2s duel_intro) from slowing interpolation
    const isContinuityValid =
      oldTarget !== null &&
      nextDuel !== null &&
      oldTarget.startedAt === nextDuel.startedAt &&
      now - oldReceivedAt < 180;

    const prevDuel = isContinuityValid ? oldTarget : nextDuel;
    const prevReceivedAt = isContinuityValid ? oldReceivedAt : now - 16.7;

    // Prune visual effects older than 1.2s
    const activeEffects = this.state.visualEffects.filter(e => now - e.createdAt < 1200);
    const reviewPatch = this.collectFightReview(newSnapshot);

    this.state = {
      ...this.state,
      snapshot: newSnapshot,
      interpolation: {
        prevDuel,
        targetDuel: nextDuel,
        prevReceivedAt,
        targetReceivedAt: now,
      },
      visualEffects: activeEffects,
      ...reviewPatch,
    };
    this.emit();
  }

  /**
   * Events for a finishing duel arrive before the duel_result snapshot.
   * Fold them in addDuelEvents, then write the saved review here once.
   */
  private collectFightReview(next: MatchSnapshot): Partial<MatchState> {
    const prev = this.state.snapshot;
    const prevStarted = prev?.duelSnapshot?.startedAt ?? null;
    const nextStarted = next.duelSnapshot?.startedAt ?? null;

    if (prev?.phase !== 'duel_intro' && next.phase === 'duel_intro') {
      this.fightTally = emptyTally();
      this.finalizedDuelKey = null;
    } else if (
      nextStarted !== null &&
      prevStarted !== null &&
      nextStarted !== prevStarted &&
      next.phase !== 'duel_result'
    ) {
      this.fightTally = emptyTally();
    }

    if (
      prev?.phase === 'duel_result' ||
      next.phase !== 'duel_result' ||
      !next.duelSnapshot ||
      !this.state.localColor ||
      this.finalizedDuelKey === next.duelSnapshot.startedAt
    ) {
      return {};
    }

    const end = fightEndFromSnapshot(next, this.state.localColor);
    if (!end) return {};
    const record = buildFightRecord(this.fightTally, end);
    this.finalizedDuelKey = next.duelSnapshot.startedAt;
    const fightJournal = [record, ...this.state.fightJournal].slice(0, 12);
    saveJournal(fightJournal);
    return { fightJournal, fightReview: record, reviewOpen: true };
  }

  public addDuelEvents(events: DuelEvent[]): void {
    if (this.state.localColor) {
      this.fightTally = noteDuelEvents(this.fightTally, events, this.state.localColor);
    }
    const now = performance.now();
    const added: VisualDuelEffect[] = events.map(event => ({
      id: `vfx_${++this.effectCounter}_${now}`,
      event,
      createdAt: now,
    }));
    const active = [...this.state.visualEffects.filter(e => now - e.createdAt < 1200), ...added];
    this.state = { ...this.state, visualEffects: active };
    this.emit();
  }

  public setHoverSquare(sq: BoardSquare | null): void {
    if (this.state.hoverSquare !== sq) {
      this.state = { ...this.state, hoverSquare: sq };
      this.emit();
    }
  }

  public setSelectedSquare(sq: BoardSquare | null): void {
    if (this.state.selectedSquare !== sq) {
      this.state = { ...this.state, selectedSquare: sq };
      this.emit();
    }
  }

  public setCursorState(point: { x: number; y: number } | null, isPinching: boolean): void {
    this.state = { ...this.state, cursorPoint: point, isPinching };
    this.emit();
  }

  public setPromotionMove(move: { from: BoardSquare; to: BoardSquare } | null): void {
    this.state = { ...this.state, promotionMove: move, promotionHover: null };
    this.emit();
  }

  public setPromotionHover(hover: PromotionPieceClass | null): void {
    if (this.state.promotionHover !== hover) {
      this.state = { ...this.state, promotionHover: hover };
      this.emit();
    }
  }

  public showToast(message: string, isError = false): void {
    this.state = {
      ...this.state,
      feedbackToast: { message, isError, timestamp: Date.now() },
    };
    this.emit();
  }

  public setAiAdvice(advice: string | null): void {
    this.state = { ...this.state, aiAdvice: advice };
    this.emit();
  }

  public dismissFightReview(): void {
    if (!this.state.reviewOpen) return;
    this.state = { ...this.state, reviewOpen: false };
    this.emit();
  }

  public toggleFightReview(): void {
    const reviewOpen = !this.state.reviewOpen;
    this.state = {
      ...this.state,
      reviewOpen,
      fightReview: reviewOpen
        ? this.state.fightReview ?? this.state.fightJournal[0] ?? null
        : this.state.fightReview,
    };
    this.emit();
  }
}

export const matchStore = new MatchStoreManager();
