import type {
  BoardSquare,
  DuelEvent,
  DuelSnapshot,
  MatchSnapshot,
  PlayerColor,
  PromotionPieceClass,
} from '@let-him-rook/shared';

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
    visualEffects: [],
  };

  private listeners: Set<StateListener> = new Set();
  private effectCounter = 0;

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
      visualEffects: [],
    };
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
    const prevReceivedAt = isContinuityValid ? oldReceivedAt : now - 50;

    // Prune visual effects older than 1.2s
    const activeEffects = this.state.visualEffects.filter(e => now - e.createdAt < 1200);

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
    };
    this.emit();
  }

  public addDuelEvents(events: DuelEvent[]): void {
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
}

export const matchStore = new MatchStoreManager();
