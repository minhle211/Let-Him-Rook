import {
  DUEL_INTRO_DURATION_MS,
  DUEL_RESULT_DURATION_MS,
  RECONNECT_GRACE_MS,
  type AbilityType,
  type AiBehaviorMode,
  type BoardSquare,
  type DuelEvent,
  type MatchMode,
  type MatchPhase,
  type MatchSnapshot,
  type MatchWinner,
  type PendingCapture,
  type PieceClass,
  type PlayerColor,
  type PlayerStatus,
  type PromotionPieceClass,
  type SandboxConfig,
} from '@let-him-rook/shared';
import { Chess } from '../chess/chess.ts';
import {
  applyNonCaptureMove,
  createInitialFen,
  freeMovePiece,
  getLegalMoves,
  getPieceAt,
  isCaptureMove,
  removePieceFromSquare,
  resolveCaptureOutcome,
  setPieceOnSquare,
  validateMove,
  type MoveResult,
} from '../chess/chessEngine.ts';
import {
  applyAbilityIntent,
  applyMovementIntent,
  createDuel,
  getDuelSnapshot,
  resetDuelSimulation,
  respawnObstacles,
  stepDuel,
  type DuelSimulation,
} from '../combat/duelSimulator.ts';

export class MatchMachine {
  public roomId: string;
  public mode: MatchMode;
  public revision: number = 0;
  public phase: MatchPhase = 'lobby';
  public fen: string = createInitialFen();
  public winner: MatchWinner = null;
  public winReason?: string;
  public pendingCapture: PendingCapture | null = null;
  public duel: DuelSimulation | null = null;

  public duelIntroEndsAt: number = 0;
  public duelResultEndsAt: number = 0;
  public cachedMoveResult: MoveResult | null = null;

  public players: Record<PlayerColor, PlayerStatus>;
  private processedActionIds: Set<string> = new Set();
  public unreadDuelEvents: DuelEvent[] = [];

  public sandboxConfig: SandboxConfig = {
    rulesEnforced: true,
    godMode: false,
    noCooldowns: false,
    moveSpeedMultiplier: 1.0,
    aiBehavior: 'dummy',
    isStandaloneDuel: false,
  };

  constructor(roomId: string, mode: MatchMode = 'pvp') {
    this.roomId = roomId;
    this.mode = mode;
    this.players = {
      w: {
        color: 'w',
        connected: false,
        calibrated: mode === 'sandbox',
        pingMs: 0,
      },
      b: {
        color: 'b',
        connected: mode === 'bot' || mode === 'sandbox',
        calibrated: mode === 'bot' || mode === 'sandbox',
        pingMs: 0,
      },
    };
  }

  public get turn(): PlayerColor {
    return (this.fen.split(' ')[1] as PlayerColor) || 'w';
  }

  public setPlayerConnected(color: PlayerColor, connected: boolean, now = Date.now()): void {
    const p = this.players[color];
    p.connected = connected;
    if (!connected) {
      p.disconnectedAt = now;
    } else {
      delete p.disconnectedAt;
      if (this.mode === 'sandbox' && (this.phase === 'calibration' || this.phase === 'lobby')) {
        this.phase = 'chess_turn';
      }
    }
    this.revision++;
  }

  public setCalibrationReady(color: PlayerColor, ready: boolean): void {
    this.players[color].calibrated = ready;
    this.revision++;

    if (this.phase === 'calibration' || this.phase === 'lobby') {
      const wReady = this.players.w.calibrated && this.players.w.connected;
      const bReady =
        this.mode === 'bot' ||
        this.mode === 'sandbox' ||
        (this.players.b.calibrated && this.players.b.connected);
      if (wReady && bReady) {
        this.phase = 'chess_turn';
        this.revision++;
      }
    }
  }

  public handleChessMove(
    color: PlayerColor,
    from: BoardSquare,
    to: BoardSquare,
    promotion: PromotionPieceClass | undefined,
    actionId: string,
    now = Date.now()
  ): { accepted: boolean; reason?: string } {
    if (this.processedActionIds.has(actionId)) {
      return { accepted: true }; // Deduplicated
    }

    if (this.phase !== 'chess_turn') {
      return { accepted: false, reason: 'not_chess_turn_phase' };
    }

    // In sandbox mode, the local user can play moves for either side
    if (this.mode !== 'sandbox' && color !== this.turn) {
      return { accepted: false, reason: 'not_your_turn' };
    }

    // In sandbox mode with rules not enforced, bypass chess legality check
    if (this.mode === 'sandbox' && !this.sandboxConfig.rulesEnforced) {
      this.processedActionIds.add(actionId);
      const piece = getPieceAt(this.fen, from);
      if (!piece) {
        return { accepted: false, reason: 'no_piece_on_from' };
      }
      const target = getPieceAt(this.fen, to);
      if (target && target.color !== piece.color) {
        // Staged capture: start duel
        this.sandboxConfig.isStandaloneDuel = false;
        this.pendingCapture = {
          from,
          to,
          attackerColor: piece.color,
          attackerClass: piece.pieceClass,
          defenderClass: target.pieceClass,
          promotion,
        };
        this.phase = 'duel_intro';
        this.duelIntroEndsAt = now + DUEL_INTRO_DURATION_MS;
        this.duel = createDuel(this.fen, this.pendingCapture, this.duelIntroEndsAt);
        this.duel.sandboxOptions = {
          godMode: this.sandboxConfig.godMode,
          noCooldowns: this.sandboxConfig.noCooldowns,
          moveSpeedMultiplier: this.sandboxConfig.moveSpeedMultiplier,
        };
        this.cachedMoveResult = null;
        this.revision++;
        return { accepted: true };
      } else {
        // Free move piece
        this.fen = freeMovePiece(this.fen, from, to);
        this.revision++;
        return { accepted: true };
      }
    }

    if (!validateMove(this.fen, from, to, promotion)) {
      return { accepted: false, reason: 'illegal_move' };
    }

    this.processedActionIds.add(actionId);

    const isCapture = isCaptureMove(this.fen, from, to);
    if (!isCapture) {
      // Immediate non-capture move
      const res = applyNonCaptureMove(this.fen, { from, to, promotion });
      this.fen = res.fen;
      if (res.isGameOver) {
        this.phase = 'match_over';
        this.winner = res.winner;
        this.winReason = res.reason;
      }
      this.revision++;
      return { accepted: true };
    }

    // Capture move: initiate duel
    if (this.mode === 'sandbox') {
      this.sandboxConfig.isStandaloneDuel = false;
    }
    const attackerPiece = getPieceAt(this.fen, from)!;
    let defenderPiece = getPieceAt(this.fen, to);
    if (!defenderPiece) {
      // Must be an en passant capture: defender pawn is on [to.file, from.rank]
      const epSquare = `${to[0]}${from[1]}` as BoardSquare;
      defenderPiece = getPieceAt(this.fen, epSquare);
    }

    this.pendingCapture = {
      from,
      to,
      attackerColor: color,
      attackerClass: attackerPiece.pieceClass,
      defenderClass: defenderPiece ? defenderPiece.pieceClass : 'pawn',
      promotion,
    };

    this.phase = 'duel_intro';
    this.duelIntroEndsAt = now + DUEL_INTRO_DURATION_MS;
    this.duel = createDuel(this.fen, this.pendingCapture, this.duelIntroEndsAt);
    if (this.mode === 'sandbox') {
      this.duel.sandboxOptions = {
        godMode: this.sandboxConfig.godMode,
        noCooldowns: this.sandboxConfig.noCooldowns,
        moveSpeedMultiplier: this.sandboxConfig.moveSpeedMultiplier,
      };
    }
    this.cachedMoveResult = null;
    this.revision++;

    return { accepted: true };
  }

  public handleDuelMove(
    color: PlayerColor,
    moveX: number,
    moveZ: number,
    actionId: string,
    now = Date.now()
  ): { accepted: boolean; reason?: string } {
    if (this.phase !== 'active_duel' || !this.duel) {
      return { accepted: false, reason: 'not_active_duel' };
    }
    applyMovementIntent(this.duel, color, moveX, moveZ, now);
    return { accepted: true };
  }

  public handleDuelAbility(
    color: PlayerColor,
    ability: AbilityType,
    parryHolding: boolean | undefined,
    actionId: string,
    now = Date.now()
  ): { accepted: boolean; reason?: string } {
    if (this.processedActionIds.has(actionId)) {
      return { accepted: true };
    }
    if (this.phase !== 'active_duel' || !this.duel) {
      return { accepted: false, reason: 'not_active_duel' };
    }

    const res = applyAbilityIntent(this.duel, color, ability, parryHolding, now);
    if (res.accepted) {
      this.processedActionIds.add(actionId);
    }
    return res;
  }

  public tick(now = Date.now()): void {
    // 1. Reconnect grace timeout check (30s) - disabled in sandbox mode
    if (this.mode !== 'sandbox') {
      for (const color of ['w', 'b'] as PlayerColor[]) {
        if (this.mode === 'bot' && color === 'b') continue;
        const p = this.players[color];
        if (!p.connected && p.disconnectedAt && this.phase !== 'match_over') {
          if (now - p.disconnectedAt >= RECONNECT_GRACE_MS) {
            this.phase = 'match_over';
            this.winner = color === 'w' ? 'b' : 'w';
            this.winReason = 'forfeit_disconnect_timeout';
            this.revision++;
            return;
          }
        }
      }
    }

    // 2. State machine transitions
    if (this.phase === 'duel_intro') {
      if (now >= this.duelIntroEndsAt) {
        this.phase = 'active_duel';
        this.revision++;
      }
    } else if (this.phase === 'active_duel' && this.duel) {
      stepDuel(this.duel, now);

      if (this.duel.events.length > 0) {
        this.unreadDuelEvents.push(...this.duel.events);
        this.duel.events = [];
      }

      if (this.duel.isFinished) {
        this.phase = 'duel_result';
        this.duelResultEndsAt = now + DUEL_RESULT_DURATION_MS;

        // Resolve capture outcome only if not a standalone duel
        if (!(this.mode === 'sandbox' && this.sandboxConfig.isStandaloneDuel)) {
          const outcome =
            this.duel.winner === 'draw'
              ? 'tie_draw'
              : this.duel.winner === this.pendingCapture!.attackerColor
              ? 'attacker_win'
              : 'defender_win';

          this.cachedMoveResult = resolveCaptureOutcome(
            this.fen,
            this.pendingCapture!,
            outcome
          );
        }
        this.revision++;
      }
    } else if (this.phase === 'duel_result') {
      // In standalone sandbox duel, hold in duel_result without modifying fen until reset or exit
      if (this.mode === 'sandbox' && this.sandboxConfig.isStandaloneDuel) {
        return;
      }

      if (now >= this.duelResultEndsAt && this.cachedMoveResult) {
        const res = this.cachedMoveResult;
        this.fen = res.fen;
        this.pendingCapture = null;
        this.duel = null;
        this.cachedMoveResult = null;

        if (res.isGameOver) {
          this.phase = 'match_over';
          this.winner = res.winner;
          this.winReason = res.reason;
        } else {
          this.phase = 'chess_turn';
        }
        this.revision++;
      }
    }
  }

  public handleSandboxSetFen(fen: string): boolean {
    if (this.mode !== 'sandbox') return false;
    try {
      const c = new Chess(fen);
      this.fen = c.fen();
      if (this.phase === 'match_over') {
        this.phase = 'chess_turn';
        this.winner = null;
        this.winReason = undefined;
      }
      this.revision++;
      return true;
    } catch {
      return false;
    }
  }

  public handleSandboxPlacePiece(
    square: BoardSquare,
    pieceClass: PieceClass | null,
    color: PlayerColor = 'w'
  ): boolean {
    if (this.mode !== 'sandbox') return false;
    if (pieceClass === null) {
      this.fen = removePieceFromSquare(this.fen, square);
    } else {
      this.fen = setPieceOnSquare(this.fen, square, pieceClass, color);
    }
    if (this.phase === 'match_over') {
      this.phase = 'chess_turn';
      this.winner = null;
      this.winReason = undefined;
    }
    this.revision++;
    return true;
  }

  public handleSandboxFreeMove(from: BoardSquare, to: BoardSquare): boolean {
    if (this.mode !== 'sandbox') return false;
    this.fen = freeMovePiece(this.fen, from, to);
    if (this.phase === 'match_over') {
      this.phase = 'chess_turn';
      this.winner = null;
      this.winReason = undefined;
    }
    this.revision++;
    return true;
  }

  public handleSandboxStartDuel(
    attackerClass: PieceClass,
    defenderClass: PieceClass,
    aiBehavior?: AiBehaviorMode,
    standalone = false,
    now = Date.now()
  ): boolean {
    if (this.mode !== 'sandbox') return false;
    if (aiBehavior) {
      this.sandboxConfig.aiBehavior = aiBehavior;
    }
    this.sandboxConfig.isStandaloneDuel = Boolean(standalone);

    this.pendingCapture = {
      from: 'e2' as BoardSquare,
      to: 'e7' as BoardSquare,
      attackerColor: 'w',
      attackerClass,
      defenderClass,
    };

    this.phase = 'active_duel';
    this.winner = null;
    this.winReason = undefined;
    this.duelIntroEndsAt = now;
    this.duel = createDuel(this.fen, this.pendingCapture, now);
    this.duel.sandboxOptions = {
      godMode: this.sandboxConfig.godMode,
      noCooldowns: this.sandboxConfig.noCooldowns,
      moveSpeedMultiplier: this.sandboxConfig.moveSpeedMultiplier,
    };
    this.cachedMoveResult = null;
    this.revision++;
    return true;
  }

  public handleSandboxUpdateConfig(config: Partial<SandboxConfig>): boolean {
    if (this.mode !== 'sandbox') return false;
    this.sandboxConfig = { ...this.sandboxConfig, ...config };
    if (this.duel) {
      this.duel.sandboxOptions = {
        godMode: this.sandboxConfig.godMode,
        noCooldowns: this.sandboxConfig.noCooldowns,
        moveSpeedMultiplier: this.sandboxConfig.moveSpeedMultiplier,
      };
    }
    this.revision++;
    return true;
  }

  public handleSandboxResetDuel(now = Date.now()): boolean {
    if (this.mode !== 'sandbox' || !this.duel) return false;
    resetDuelSimulation(this.duel, now);
    this.duel.sandboxOptions = {
      godMode: this.sandboxConfig.godMode,
      noCooldowns: this.sandboxConfig.noCooldowns,
      moveSpeedMultiplier: this.sandboxConfig.moveSpeedMultiplier,
    };
    this.phase = 'active_duel';
    this.winner = null;
    this.winReason = undefined;
    this.cachedMoveResult = null;
    this.revision++;
    return true;
  }

  public handleSandboxRespawnObstacles(): boolean {
    if (this.mode !== 'sandbox' || !this.duel) return false;
    respawnObstacles(this.duel);
    this.revision++;
    return true;
  }

  public handleSandboxExitDuel(): boolean {
    if (this.mode !== 'sandbox') return false;
    this.sandboxConfig.isStandaloneDuel = false;
    this.duel = null;
    this.pendingCapture = null;
    this.cachedMoveResult = null;
    this.phase = 'chess_turn';
    this.winner = null;
    this.winReason = undefined;
    this.revision++;
    return true;
  }

  public getSnapshot(now = Date.now()): MatchSnapshot {
    let legalMoves = {} as Record<BoardSquare, BoardSquare[]>;
    if (this.phase === 'chess_turn') {
      try {
        legalMoves = getLegalMoves(this.fen);
      } catch {
        legalMoves = {} as Record<BoardSquare, BoardSquare[]>;
      }
    }

    return {
      roomId: this.roomId,
      revision: this.revision,
      phase: this.phase,
      mode: this.mode,
      fen: this.fen,
      turn: this.turn,
      pendingCapture: this.pendingCapture ? { ...this.pendingCapture } : null,
      duelSnapshot: this.duel ? getDuelSnapshot(this.duel) : null,
      players: {
        w: { ...this.players.w },
        b: { ...this.players.b },
      },
      winner: this.winner,
      winReason: this.winReason,
      legalMoves,
      serverTime: now,
      sandboxConfig: this.mode === 'sandbox' ? { ...this.sandboxConfig } : undefined,
    };
  }
}
