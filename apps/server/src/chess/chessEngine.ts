import {
  type BoardSquare,
  type PendingCapture,
  type PieceClass,
  type PlayerColor,
  type PromotionPieceClass,
} from '@let-him-rook/shared';
import { Chess, type Color, type PieceSymbol } from './chess.ts';

const CLASS_TO_SYMBOL: Record<PieceClass, PieceSymbol> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

const SYMBOL_TO_CLASS: Record<PieceSymbol, PieceClass> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

const PROMO_TO_SYMBOL: Record<PromotionPieceClass, PieceSymbol> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};

export interface MoveResult {
  fen: string;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isGameOver: boolean;
  winner: PlayerColor | 'draw' | null;
  reason?: string;
}

export function createInitialFen(): string {
  return new Chess().fen();
}

export function getPieceAt(
  fen: string,
  square: BoardSquare
): { color: PlayerColor; pieceClass: PieceClass } | null {
  const chess = new Chess(fen);
  const p = chess.get(square);
  if (!p) return null;
  return {
    color: p.color as PlayerColor,
    pieceClass: SYMBOL_TO_CLASS[p.type],
  };
}

export function getLegalMoves(
  fen: string,
  square?: BoardSquare
): Record<BoardSquare, BoardSquare[]> {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true, square }) as Array<{ from: string; to: string }>;
  const result: Partial<Record<BoardSquare, BoardSquare[]>> = {};

  for (const m of moves) {
    const from = m.from as BoardSquare;
    const to = m.to as BoardSquare;
    if (!result[from]) {
      result[from] = [];
    }
    result[from]!.push(to);
  }

  return result as Record<BoardSquare, BoardSquare[]>;
}

export function isCaptureMove(fen: string, from: BoardSquare, to: BoardSquare): boolean {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true, square: from }) as Array<{
    from: string;
    to: string;
    captured?: string;
    flags: string;
  }>;
  const match = legal.find(m => m.from === from && m.to === to);
  if (!match) return false;
  return !!match.captured || match.flags.includes('e') || match.flags.includes('c');
}

export function validateMove(
  fen: string,
  from: BoardSquare,
  to: BoardSquare,
  promotion?: PromotionPieceClass
): boolean {
  const chess = new Chess(fen);
  const promoSymbol = promotion ? PROMO_TO_SYMBOL[promotion] : undefined;
  const legal = chess.moves({ verbose: true, square: from }) as Array<{
    from: string;
    to: string;
    promotion?: string;
  }>;
  return legal.some(
    m => m.from === from && m.to === to && (!promoSymbol || m.promotion === promoSymbol)
  );
}

export function applyNonCaptureMove(
  fen: string,
  move: { from: BoardSquare; to: BoardSquare; promotion?: PromotionPieceClass }
): MoveResult {
  const chess = new Chess(fen);
  const currentTurn = chess.turn() as PlayerColor;
  const promoSymbol = move.promotion ? PROMO_TO_SYMBOL[move.promotion] : undefined;
  const applied = chess.move({
    from: move.from,
    to: move.to,
    promotion: promoSymbol,
  });

  if (!applied) {
    throw new Error(`Illegal non-capture move: ${move.from}->${move.to}`);
  }

  const isCheck = chess.isCheck();
  const isCheckmate = chess.isCheckmate();
  const isStalemate = chess.isStalemate();
  const isDraw = chess.isDraw();
  const isGameOver = chess.isGameOver();
  const winner = isCheckmate ? currentTurn : isDraw ? 'draw' : null;

  return {
    fen: chess.fen(),
    isCheck,
    isCheckmate,
    isStalemate,
    isDraw,
    isGameOver,
    winner,
    reason: isCheckmate ? 'checkmate' : isStalemate ? 'stalemate' : isDraw ? 'draw' : undefined,
  };
}

export function resolveCaptureOutcome(
  fen: string,
  pending: PendingCapture,
  outcome: 'attacker_win' | 'defender_win' | 'tie_draw'
): MoveResult {
  if (outcome === 'tie_draw') {
    return {
      fen,
      isCheck: false,
      isCheckmate: false,
      isStalemate: false,
      isDraw: true,
      isGameOver: true,
      winner: 'draw',
      reason: 'duel_timeout_tie',
    };
  }

  const attackerColor = pending.attackerColor;
  const defenderColor: PlayerColor = attackerColor === 'w' ? 'b' : 'w';

  if (outcome === 'attacker_win') {
    // Attacker executes normal move
    const chess = new Chess(fen);
    const promoSymbol = pending.promotion ? PROMO_TO_SYMBOL[pending.promotion] : undefined;
    const applied = chess.move({
      from: pending.from,
      to: pending.to,
      promotion: promoSymbol,
    });

    if (!applied) {
      throw new Error(`Failed to commit legal capture: ${pending.from}->${pending.to}`);
    }

    const isCheck = chess.isCheck();
    const isCheckmate = chess.isCheckmate();
    const isStalemate = chess.isStalemate();
    const isDraw = chess.isDraw();
    const isGameOver = chess.isGameOver();
    const winner = isCheckmate ? attackerColor : isDraw ? 'draw' : null;

    return {
      fen: chess.fen(),
      isCheck,
      isCheckmate,
      isStalemate,
      isDraw,
      isGameOver,
      winner,
      reason: isCheckmate ? 'checkmate' : isStalemate ? 'stalemate' : isDraw ? 'draw' : undefined,
    };
  }

  // outcome === 'defender_win'
  if (pending.attackerClass === 'king') {
    // King initiated capture and lost the duel!
    return {
      fen,
      isCheck: false,
      isCheckmate: true,
      isStalemate: false,
      isDraw: false,
      isGameOver: true,
      winner: defenderColor,
      reason: 'king_duel_lost',
    };
  }

  // Defender wins: Remove attacker piece from 'from'
  const chess = new Chess(fen);
  chess.remove(pending.from);

  // Castling rights update if attacker rook on home square was removed
  const tokens = chess.fen().split(' ');
  let castling = tokens[2];
  if (attackerColor === 'w') {
    if (pending.from === 'a1') castling = castling.replace('Q', '');
    if (pending.from === 'h1') castling = castling.replace('K', '');
  } else {
    if (pending.from === 'a8') castling = castling.replace('q', '');
    if (pending.from === 'h8') castling = castling.replace('k', '');
  }
  if (!castling) castling = '-';

  // Clear en passant, reset halfmoves to 0, advance fullmove if black attacked
  const nextTurn = defenderColor;
  let fullMove = parseInt(tokens[5], 10);
  if (attackerColor === 'b') {
    fullMove++;
  }

  const mutatedFen = `${tokens[0]} ${nextTurn} ${castling} - 0 ${fullMove}`;

  // King Safety Check:
  // Is attacker King now exposed to check from defender?
  // On mutated board, check if attacker's King square is attacked by defender.
  const verifyChess = new Chess(mutatedFen);
  let attackerKingSquare: BoardSquare | null = null;
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (let r = 1; r <= 8; r++) {
    for (const f of files) {
      const sq = `${f}${r}` as BoardSquare;
      const p = verifyChess.get(sq);
      if (p && p.color === attackerColor && p.type === 'k') {
        attackerKingSquare = sq;
        break;
      }
    }
    if (attackerKingSquare) break;
  }

  if (attackerKingSquare && verifyChess.isAttacked(attackerKingSquare, defenderColor as Color)) {
    // Attacker King is in discovered check as turn passes to defender!
    return {
      fen: mutatedFen,
      isCheck: true,
      isCheckmate: true,
      isStalemate: false,
      isDraw: false,
      isGameOver: true,
      winner: defenderColor,
      reason: 'king_exposed_after_failed_capture',
    };
  }

  const isCheck = verifyChess.isCheck();
  const isCheckmate = verifyChess.isCheckmate();
  const isStalemate = verifyChess.isStalemate();
  const isDraw = verifyChess.isDraw();
  const isGameOver = verifyChess.isGameOver();
  const winner = isCheckmate ? attackerColor : isDraw ? 'draw' : null;

  return {
    fen: mutatedFen,
    isCheck,
    isCheckmate,
    isStalemate,
    isDraw,
    isGameOver,
    winner,
    reason: isCheckmate ? 'checkmate' : isStalemate ? 'stalemate' : isDraw ? 'draw' : undefined,
  };
}
