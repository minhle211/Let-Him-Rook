export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Color = 'w' | 'b';

export interface Piece {
  type: PieceSymbol;
  color: Color;
}

export interface Move {
  color: Color;
  from: string;
  to: string;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  flags: string;
  san?: string;
}

export const DEFAULT_POSITION =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const SQUARES = [
  'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
  'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
  'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
  'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
  'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
  'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
  'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
  'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
];

const PROMOTIONS: PieceSymbol[] = ['q', 'r', 'b', 'n'];

const KNIGHT_OFFSETS = [-17, -15, -10, -6, 6, 10, 15, 17];
const BISHOP_OFFSETS = [-9, -7, 7, 9];
const ROOK_OFFSETS = [-8, -1, 1, 8];
const KING_OFFSETS = [-9, -8, -7, -1, 1, 7, 8, 9];

function file(sq: number): number {
  return sq & 7;
}

function rank(sq: number): number {
  return sq >> 3;
}

function algebraic(sq: number): string {
  const f = file(sq);
  const r = 7 - rank(sq);
  return String.fromCharCode(97 + f) + (r + 1);
}

function toIndex(sq: string): number {
  const f = sq.charCodeAt(0) - 97;
  const r = parseInt(sq[1], 10) - 1;
  return (7 - r) * 8 + f;
}

export class Chess {
  private board: (Piece | null)[] = new Array(64).fill(null);
  private _turn: Color = 'w';
  private castling: Record<Color, { k: boolean; q: boolean }> = {
    w: { k: false, q: false },
    b: { k: false, q: false },
  };
  private epSquare: number | null = null;
  private halfMoves: number = 0;
  private moveNumber: number = 1;
  private historyList: Move[] = [];

  constructor(fen = DEFAULT_POSITION) {
    this.load(fen);
  }

  public load(fen: string): void {
    const tokens = fen.trim().split(/\s+/);
    if (tokens.length < 4) {
      throw new Error('Invalid FEN');
    }

    const [position, turn, castling, ep, half, full] = tokens;
    const rows = position.split('/');
    if (rows.length !== 8) {
      throw new Error('Invalid FEN position');
    }

    const newBoard: (Piece | null)[] = new Array(64).fill(null);
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '8') {
          f += parseInt(ch, 10);
        } else {
          const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
          const type = ch.toLowerCase() as PieceSymbol;
          newBoard[r * 8 + f] = { color, type };
          f++;
        }
      }
      if (f !== 8) {
        throw new Error('Invalid FEN row');
      }
    }

    this.board = newBoard;
    this._turn = turn === 'w' ? 'w' : 'b';
    this.castling = {
      w: { k: castling.includes('K'), q: castling.includes('Q') },
      b: { k: castling.includes('k'), q: castling.includes('q') },
    };
    this.epSquare = ep !== '-' && ep ? toIndex(ep) : null;
    this.halfMoves = half ? parseInt(half, 10) : 0;
    this.moveNumber = full ? parseInt(full, 10) : 1;
    this.historyList = [];
  }

  public fen(): string {
    const rows: string[] = [];
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      let row = '';
      for (let f = 0; f < 8; f++) {
        const piece = this.board[r * 8 + f];
        if (!piece) {
          empty++;
        } else {
          if (empty > 0) {
            row += empty;
            empty = 0;
          }
          row += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
        }
      }
      if (empty > 0) {
        row += empty;
      }
      rows.push(row);
    }

    let castling = '';
    if (this.castling.w.k) castling += 'K';
    if (this.castling.w.q) castling += 'Q';
    if (this.castling.b.k) castling += 'k';
    if (this.castling.b.q) castling += 'q';
    if (castling === '') castling = '-';

    const ep = this.epSquare !== null ? algebraic(this.epSquare) : '-';
    return `${rows.join('/')} ${this._turn} ${castling} ${ep} ${this.halfMoves} ${this.moveNumber}`;
  }

  public turn(): Color {
    return this._turn;
  }

  public get(square: string): Piece | null {
    const idx = toIndex(square);
    return this.board[idx] ? { ...this.board[idx]! } : null;
  }

  public put(piece: Piece, square: string): boolean {
    const idx = toIndex(square);
    this.board[idx] = { ...piece };
    return true;
  }

  public remove(square: string): Piece | null {
    const idx = toIndex(square);
    const piece = this.board[idx];
    this.board[idx] = null;
    return piece;
  }

  public isAttacked(square: string, byColor: Color): boolean {
    const targetIdx = toIndex(square);
    return this.isSquareAttacked(targetIdx, byColor);
  }

  private isSquareAttacked(target: number, byColor: Color): boolean {
    const tFile = file(target);
    const tRank = rank(target);

    // Pawns
    const pawnRank = byColor === 'w' ? tRank + 1 : tRank - 1;
    if (pawnRank >= 0 && pawnRank < 8) {
      if (tFile > 0) {
        const p = this.board[pawnRank * 8 + (tFile - 1)];
        if (p && p.color === byColor && p.type === 'p') return true;
      }
      if (tFile < 7) {
        const p = this.board[pawnRank * 8 + (tFile + 1)];
        if (p && p.color === byColor && p.type === 'p') return true;
      }
    }

    // Knights
    for (const offset of KNIGHT_OFFSETS) {
      const sq = target + offset;
      if (sq >= 0 && sq < 64 && Math.abs(file(sq) - tFile) <= 2 && Math.abs(rank(sq) - tRank) <= 2) {
        const p = this.board[sq];
        if (p && p.color === byColor && p.type === 'n') return true;
      }
    }

    // Kings
    for (const offset of KING_OFFSETS) {
      const sq = target + offset;
      if (sq >= 0 && sq < 64 && Math.abs(file(sq) - tFile) <= 1 && Math.abs(rank(sq) - tRank) <= 1) {
        const p = this.board[sq];
        if (p && p.color === byColor && p.type === 'k') return true;
      }
    }

    // Bishops / Queens
    for (const offset of BISHOP_OFFSETS) {
      let sq = target;
      while (true) {
        const prevF = file(sq);
        sq += offset;
        if (sq < 0 || sq >= 64 || Math.abs(file(sq) - prevF) !== 1) break;
        const p = this.board[sq];
        if (p) {
          if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
          break;
        }
      }
    }

    // Rooks / Queens
    for (const offset of ROOK_OFFSETS) {
      let sq = target;
      while (true) {
        const prevF = file(sq);
        const prevR = rank(sq);
        sq += offset;
        if (sq < 0 || sq >= 64) break;
        if (offset === -1 || offset === 1) {
          if (rank(sq) !== prevR) break;
        } else {
          if (file(sq) !== prevF) break;
        }
        const p = this.board[sq];
        if (p) {
          if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
          break;
        }
      }
    }

    return false;
  }

  private findKing(color: Color): number {
    for (let i = 0; i < 64; i++) {
      const p = this.board[i];
      if (p && p.color === color && p.type === 'k') {
        return i;
      }
    }
    return -1;
  }

  public isCheck(): boolean {
    const kingIdx = this.findKing(this._turn);
    if (kingIdx === -1) return false;
    const opponent: Color = this._turn === 'w' ? 'b' : 'w';
    return this.isSquareAttacked(kingIdx, opponent);
  }

  private generatePseudoMoves(us: Color): Move[] {
    const them: Color = us === 'w' ? 'b' : 'w';
    const moves: Move[] = [];

    for (let i = 0; i < 64; i++) {
      const p = this.board[i];
      if (!p || p.color !== us) continue;

      const f = file(i);
      const r = rank(i);

      if (p.type === 'p') {
        const forward = us === 'w' ? -8 : 8;
        const startRank = us === 'w' ? 6 : 1;
        const promoRank = us === 'w' ? 0 : 7;

        // 1 step forward
        const next = i + forward;
        if (next >= 0 && next < 64 && !this.board[next]) {
          if (rank(next) === promoRank) {
            for (const promo of PROMOTIONS) {
              moves.push({
                color: us,
                from: algebraic(i),
                to: algebraic(next),
                piece: 'p',
                promotion: promo,
                flags: 'np',
              });
            }
          } else {
            moves.push({
              color: us,
              from: algebraic(i),
              to: algebraic(next),
              piece: 'p',
              flags: 'n',
            });
            // 2 steps forward
            const doubleStep = i + forward * 2;
            if (r === startRank && !this.board[doubleStep]) {
              moves.push({
                color: us,
                from: algebraic(i),
                to: algebraic(doubleStep),
                piece: 'p',
                flags: 'b',
              });
            }
          }
        }

        // Captures
        for (const capOffset of [forward - 1, forward + 1]) {
          const target = i + capOffset;
          if (target < 0 || target >= 64 || Math.abs(file(target) - f) !== 1) continue;
          const targetPiece = this.board[target];
          if (targetPiece && targetPiece.color === them) {
            if (rank(target) === promoRank) {
              for (const promo of PROMOTIONS) {
                moves.push({
                  color: us,
                  from: algebraic(i),
                  to: algebraic(target),
                  piece: 'p',
                  captured: targetPiece.type,
                  promotion: promo,
                  flags: 'cp',
                });
              }
            } else {
              moves.push({
                color: us,
                from: algebraic(i),
                to: algebraic(target),
                piece: 'p',
                captured: targetPiece.type,
                flags: 'c',
              });
            }
          } else if (this.epSquare !== null && target === this.epSquare) {
            moves.push({
              color: us,
              from: algebraic(i),
              to: algebraic(target),
              piece: 'p',
              captured: 'p',
              flags: 'e',
            });
          }
        }
      } else if (p.type === 'n') {
        for (const offset of KNIGHT_OFFSETS) {
          const target = i + offset;
          if (target < 0 || target >= 64 || Math.abs(file(target) - f) > 2 || Math.abs(rank(target) - r) > 2) continue;
          const targetPiece = this.board[target];
          if (!targetPiece) {
            moves.push({
              color: us,
              from: algebraic(i),
              to: algebraic(target),
              piece: 'n',
              flags: 'n',
            });
          } else if (targetPiece.color === them) {
            moves.push({
              color: us,
              from: algebraic(i),
              to: algebraic(target),
              piece: 'n',
              captured: targetPiece.type,
              flags: 'c',
            });
          }
        }
      } else if (p.type === 'k') {
        for (const offset of KING_OFFSETS) {
          const target = i + offset;
          if (target < 0 || target >= 64 || Math.abs(file(target) - f) > 1 || Math.abs(rank(target) - r) > 1) continue;
          const targetPiece = this.board[target];
          if (!targetPiece) {
            moves.push({
              color: us,
              from: algebraic(i),
              to: algebraic(target),
              piece: 'k',
              flags: 'n',
            });
          } else if (targetPiece.color === them) {
            moves.push({
              color: us,
              from: algebraic(i),
              to: algebraic(target),
              piece: 'k',
              captured: targetPiece.type,
              flags: 'c',
            });
          }
        }

        // Castling
        if (i === (us === 'w' ? 60 : 4)) {
          // Kingside
          if (this.castling[us].k) {
            const sq1 = i + 1;
            const sq2 = i + 2;
            if (
              !this.board[sq1] &&
              !this.board[sq2] &&
              !this.isSquareAttacked(i, them) &&
              !this.isSquareAttacked(sq1, them) &&
              !this.isSquareAttacked(sq2, them)
            ) {
              moves.push({
                color: us,
                from: algebraic(i),
                to: algebraic(sq2),
                piece: 'k',
                flags: 'k',
              });
            }
          }
          // Queenside
          if (this.castling[us].q) {
            const sq1 = i - 1;
            const sq2 = i - 2;
            const sq3 = i - 3;
            if (
              !this.board[sq1] &&
              !this.board[sq2] &&
              !this.board[sq3] &&
              !this.isSquareAttacked(i, them) &&
              !this.isSquareAttacked(sq1, them) &&
              !this.isSquareAttacked(sq2, them)
            ) {
              moves.push({
                color: us,
                from: algebraic(i),
                to: algebraic(sq2),
                piece: 'k',
                flags: 'q',
              });
            }
          }
        }
      } else {
        // Sliding: Bishop, Rook, Queen
        const offsets =
          p.type === 'b' ? BISHOP_OFFSETS : p.type === 'r' ? ROOK_OFFSETS : KING_OFFSETS;
        const isDiagonal = (off: number) => Math.abs(off) === 7 || Math.abs(off) === 9;

        for (const offset of offsets) {
          let target = i;
          while (true) {
            const prevF = file(target);
            const prevR = rank(target);
            target += offset;
            if (target < 0 || target >= 64) break;
            if (isDiagonal(offset)) {
              if (Math.abs(file(target) - prevF) !== 1) break;
            } else {
              if (offset === -1 || offset === 1) {
                if (rank(target) !== prevR) break;
              } else {
                if (file(target) !== prevF) break;
              }
            }

            const targetPiece = this.board[target];
            if (!targetPiece) {
              moves.push({
                color: us,
                from: algebraic(i),
                to: algebraic(target),
                piece: p.type,
                flags: 'n',
              });
            } else {
              if (targetPiece.color === them) {
                moves.push({
                  color: us,
                  from: algebraic(i),
                  to: algebraic(target),
                  piece: p.type,
                  captured: targetPiece.type,
                  flags: 'c',
                });
              }
              break;
            }
          }
        }
      }
    }

    return moves;
  }

  public moves(options?: { verbose?: boolean; square?: string }): Move[] | string[] {
    const pseudo = this.generatePseudoMoves(this._turn);
    const legal: Move[] = [];
    const them: Color = this._turn === 'w' ? 'b' : 'w';

    for (const m of pseudo) {
      if (options?.square && m.from !== options.square) continue;

      // Make move on temp state
      const fromIdx = toIndex(m.from);
      const toIdx = toIndex(m.to);
      const savedFrom = this.board[fromIdx];
      const savedTo = this.board[toIdx];
      let savedEpPiece: Piece | null = null;
      let epCapturedIdx = -1;

      if (m.flags.includes('e')) {
        epCapturedIdx = toIdx + (this._turn === 'w' ? 8 : -8);
        savedEpPiece = this.board[epCapturedIdx];
        this.board[epCapturedIdx] = null;
      }

      this.board[toIdx] = savedFrom;
      this.board[fromIdx] = null;

      const kingIdx = this.findKing(this._turn);
      const inCheck = kingIdx !== -1 && this.isSquareAttacked(kingIdx, them);

      // Revert move
      this.board[fromIdx] = savedFrom;
      this.board[toIdx] = savedTo;
      if (epCapturedIdx !== -1) {
        this.board[epCapturedIdx] = savedEpPiece;
      }

      if (!inCheck) {
        legal.push(m);
      }
    }

    if (options?.verbose) {
      return legal;
    }
    return legal.map(m => m.from + m.to + (m.promotion || ''));
  }

  public move(
    moveObj: { from: string; to: string; promotion?: PieceSymbol } | string
  ): Move | null {
    let from: string;
    let to: string;
    let promo: PieceSymbol | undefined;

    if (typeof moveObj === 'string') {
      from = moveObj.slice(0, 2);
      to = moveObj.slice(2, 4);
      promo = moveObj.length > 4 ? (moveObj[4].toLowerCase() as PieceSymbol) : undefined;
    } else {
      from = moveObj.from;
      to = moveObj.to;
      promo = moveObj.promotion;
    }

    const legal = this.moves({ verbose: true }) as Move[];
    const match = legal.find(
      m => m.from === from && m.to === to && (!promo || m.promotion === promo)
    );

    if (!match) {
      return null;
    }

    // Apply move
    const fromIdx = toIndex(match.from);
    const toIdx = toIndex(match.to);
    const piece = this.board[fromIdx]!;
    const us = this._turn;
    const them: Color = us === 'w' ? 'b' : 'w';

    // En passant capture
    if (match.flags.includes('e')) {
      const epCapturedIdx = toIdx + (us === 'w' ? 8 : -8);
      this.board[epCapturedIdx] = null;
    }

    // Castling rook movement
    if (match.flags.includes('k')) {
      const rookFrom = us === 'w' ? toIndex('h1') : toIndex('h8');
      const rookTo = us === 'w' ? toIndex('f1') : toIndex('f8');
      this.board[rookTo] = this.board[rookFrom];
      this.board[rookFrom] = null;
    } else if (match.flags.includes('q')) {
      const rookFrom = us === 'w' ? toIndex('a1') : toIndex('a8');
      const rookTo = us === 'w' ? toIndex('d1') : toIndex('d8');
      this.board[rookTo] = this.board[rookFrom];
      this.board[rookFrom] = null;
    }

    // Update piece at dest
    if (match.promotion) {
      this.board[toIdx] = { color: us, type: match.promotion };
    } else {
      this.board[toIdx] = piece;
    }
    this.board[fromIdx] = null;

    // Update en passant square
    if (match.flags.includes('b')) {
      this.epSquare = fromIdx + (us === 'w' ? -8 : 8);
    } else {
      this.epSquare = null;
    }

    // Update castling rights
    if (piece.type === 'k') {
      this.castling[us].k = false;
      this.castling[us].q = false;
    } else if (piece.type === 'r') {
      if (fromIdx === toIndex('a1')) this.castling.w.q = false;
      else if (fromIdx === toIndex('h1')) this.castling.w.k = false;
      else if (fromIdx === toIndex('a8')) this.castling.b.q = false;
      else if (fromIdx === toIndex('h8')) this.castling.b.k = false;
    }

    // If opponent rook captured on home square
    if (match.captured === 'r') {
      if (toIdx === toIndex('a1')) this.castling.w.q = false;
      else if (toIdx === toIndex('h1')) this.castling.w.k = false;
      else if (toIdx === toIndex('a8')) this.castling.b.q = false;
      else if (toIdx === toIndex('h8')) this.castling.b.k = false;
    }

    // Counters
    if (piece.type === 'p' || match.captured) {
      this.halfMoves = 0;
    } else {
      this.halfMoves++;
    }

    if (us === 'b') {
      this.moveNumber++;
    }

    this._turn = them;
    this.historyList.push(match);
    return match;
  }

  public isCheckmate(): boolean {
    return this.isCheck() && (this.moves() as string[]).length === 0;
  }

  public isStalemate(): boolean {
    return !this.isCheck() && (this.moves() as string[]).length === 0;
  }

  public isInsufficientMaterial(): boolean {
    const pieces: { type: PieceSymbol; color: Color }[] = [];
    for (const p of this.board) {
      if (p) pieces.push(p);
    }
    if (pieces.length === 2) return true; // K vs K
    if (pieces.length === 3) {
      const minor = pieces.find(p => p.type === 'b' || p.type === 'n');
      if (minor) return true; // K+B vs K or K+N vs K
    }
    return false;
  }

  public isDraw(): boolean {
    return this.isStalemate() || this.isInsufficientMaterial() || this.halfMoves >= 100;
  }

  public isGameOver(): boolean {
    return this.isCheckmate() || this.isDraw();
  }
}
