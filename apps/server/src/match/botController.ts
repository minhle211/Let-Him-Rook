import {
  type AbilityType,
  type AiBehaviorMode,
  type BoardSquare,
  type PieceClass,
  type PromotionPieceClass,
} from '@let-him-rook/shared';
import { getLegalMoves, getPieceAt, isCaptureMove } from '../chess/chessEngine.ts';
import type { MatchMachine } from './matchMachine.ts';

export class BotController {
  private nextActionAt: number = 0;
  private nextAbilityAt: number = 0;
  private actionCounter: number = 0;

  public tick(match: MatchMachine, now = Date.now()): void {
    if (match.mode !== 'bot' && match.mode !== 'sandbox') return;

    // In calibration, bot is automatically ready
    if (match.phase === 'calibration' || match.phase === 'lobby') {
      if (!match.players.b.calibrated) {
        match.setCalibrationReady('b', true);
      }
      return;
    }

    // In chess_turn, make move if it is Black's turn (bot mode only; user controls both sides in sandbox)
    if (match.mode === 'bot' && match.phase === 'chess_turn' && match.turn === 'b') {
      if (this.nextActionAt === 0) {
        this.nextActionAt = now + 750;
        return;
      }
      if (now >= this.nextActionAt) {
        this.nextActionAt = 0;
        const move = this.chooseMove(match.fen);
        if (move) {
          const actionId = `bot_move_${++this.actionCounter}`;
          match.handleChessMove(
            'b',
            move.from,
            move.to,
            move.promotion,
            actionId,
            now
          );
        }
      }
      return;
    }

    // In active_duel, fight as Black
    if (match.phase === 'active_duel' && match.duel) {
      const aiBehavior: AiBehaviorMode =
        match.mode === 'sandbox'
          ? (match.sandboxConfig?.aiBehavior ?? 'dummy')
          : 'aggressive';

      if (aiBehavior === 'dummy') {
        // Dummy: zero movement and no abilities
        match.handleDuelMove('b', 0, 0, `bot_mv_${now}`, now);
        return;
      }

      const fighter = match.duel.defender.color === 'b' ? match.duel.defender : match.duel.attacker;
      const opponent = match.duel.defender.color === 'b' ? match.duel.attacker : match.duel.defender;

      const dist = Math.hypot(opponent.x - fighter.x, opponent.z - fighter.z);
      let moveZ = 0;
      let moveX = Math.sin(now / 650) * 0.55;

      if (aiBehavior === 'passive') {
        // Passive: strafe/move around but never trigger attacks or parry
        if (dist > 3.0) {
          moveZ = -0.6;
        } else if (dist < 1.6) {
          moveZ = 0.5;
        }
        match.handleDuelMove('b', moveX, moveZ, `bot_mv_${now}`, now);
        return;
      }

      if (fighter.pieceClass === 'pawn') {
        // Melee class: must close into < 1.8u so 2.2u sweep hits reliably
        if (dist > 1.75) {
          moveZ = -0.95; // Advance aggressively
          moveX *= 0.4;
        } else if (dist < 1.15) {
          moveZ = 0.4;
        }
      } else if (fighter.pieceClass === 'knight') {
        // Knight cleave teleports from up to 4.5u
        if (dist > 4.1) {
          moveZ = -0.9;
        } else if (dist < 1.8) {
          moveZ = 0.5;
        }
      } else {
        // Ranged / Summoner classes (rook, bishop, queen, king)
        if (dist > 4.2) {
          moveZ = -0.75;
        } else if (dist < 2.2) {
          moveZ = 0.7;
        }
      }

      match.handleDuelMove('b', moveX, moveZ, `bot_mv_${now}`, now);

      // Trigger ability on cooldown
      if (now >= this.nextAbilityAt && now >= fighter.cooldowns.primary) {
        this.nextAbilityAt = now + 450;
        const ability = this.pickAbility(fighter.pieceClass, dist);
        if (ability) {
          match.handleDuelAbility('b', ability, undefined, `bot_ab_${++this.actionCounter}`, now);
        }
      }

      // Pawn parry reaction if projectile incoming or enemy pawn in melee range
      if (fighter.pieceClass === 'pawn') {
        const incomingProjectile = match.duel.projectiles.some(
          p => p.owner !== 'b' && Math.hypot(p.x - fighter.x, p.z - fighter.z) < 2.4
        );
        if (incomingProjectile && !fighter.isParrying && now >= fighter.cooldowns.secondary) {
          match.handleDuelAbility('b', 'pawn_parry', true, `bot_parry_${now}`, now);
        } else if (!incomingProjectile && fighter.isParrying) {
          match.handleDuelAbility('b', 'pawn_parry', false, `bot_unparry_${now}`, now);
        }
      }
    }
  }

  private pickAbility(pieceClass: PieceClass, dist: number): AbilityType | null {
    switch (pieceClass) {
      case 'pawn':
        return dist <= 2.15 ? 'pawn_sweep' : null;
      case 'rook':
        return 'rook_shot';
      case 'knight':
        return dist <= 4.4 ? 'knight_cleave' : null;
      case 'bishop':
        return 'bishop_ice_bolt';
      case 'queen':
        return 'queen_volley';
      case 'king':
        return 'king_summon';
    }
  }

  private chooseMove(
    fen: string
  ): { from: BoardSquare; to: BoardSquare; promotion?: PromotionPieceClass } | null {
    const legal = getLegalMoves(fen);
    const candidateMoves: { from: BoardSquare; to: BoardSquare; score: number }[] = [];

    const pieceValues: Record<PieceClass, number> = {
      pawn: 1,
      knight: 3,
      bishop: 3,
      rook: 5,
      queen: 9,
      king: 100,
    };

    for (const [from, destinations] of Object.entries(legal)) {
      const fromSq = from as BoardSquare;
      const piece = getPieceAt(fen, fromSq);
      if (!piece || piece.color !== 'b') continue;

      for (const to of destinations) {
        let score = 0;
        const isCap = isCaptureMove(fen, fromSq, to);
        if (isCap) {
          const target = getPieceAt(fen, to);
          if (target) {
            score += 10 + pieceValues[target.pieceClass] - pieceValues[piece.pieceClass] * 0.1;
          } else {
            score += 10; // En passant
          }
        }

        // Pawns advancing towards promotion
        if (piece.pieceClass === 'pawn') {
          const rank = parseInt(to[1], 10);
          score += (8 - rank) * 0.5;
        }

        score += Math.random() * 1.5;
        candidateMoves.push({ from: fromSq, to, score });
      }
    }

    if (candidateMoves.length === 0) return null;

    candidateMoves.sort((a, b) => b.score - a.score);
    const chosen = candidateMoves[0];

    const piece = getPieceAt(fen, chosen.from);
    let promotion: PromotionPieceClass | undefined;
    if (piece?.pieceClass === 'pawn' && chosen.to[1] === '1') {
      promotion = 'queen';
    }

    return {
      from: chosen.from,
      to: chosen.to,
      promotion,
    };
  }
}
