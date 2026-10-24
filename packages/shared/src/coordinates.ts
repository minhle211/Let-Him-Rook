import { TABLE_HALF_EXTENT } from './constants.ts';
import type { BoardSquare, PieceClass, PlayerColor } from './types.ts';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export function squareToIndex(square: BoardSquare): number {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0
  const rank = square.charCodeAt(1) - 49; // '1' -> 0
  return rank * 8 + file;
}

export function indexToSquare(index: number): BoardSquare {
  if (index < 0 || index > 63) {
    throw new Error(`Invalid square index: ${index}`);
  }
  const file = FILES[index % 8];
  const rank = RANKS[Math.floor(index / 8)];
  return `${file}${rank}` as BoardSquare;
}

/**
 * 3D Tabletop Coordinates:
 * Tabletop center is (0, 0).
 * Chessboard is [-4, 4] in X and Z.
 * White pieces start at rank 1 (positive Z = +3.5), facing negative Z.
 * Black pieces start at rank 8 (negative Z = -3.5), facing positive Z.
 * Files a -> h correspond to X: -3.5 -> +3.5.
 */
export function squareToTableCoords(square: BoardSquare): { x: number; z: number } {
  const fileIndex = square.charCodeAt(0) - 97; // 0..7
  const rankIndex = square.charCodeAt(1) - 49; // 0..7
  const x = fileIndex - 3.5;
  const z = 3.5 - rankIndex;
  return { x, z };
}

export interface BoardPiece {
  square: BoardSquare;
  color: PlayerColor;
  pieceClass: PieceClass;
}

const CHAR_TO_CLASS: Record<string, PieceClass> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export function getBoardPiecesFromFen(fen: string): BoardPiece[] {
  if (!fen) return [];
  const [position] = fen.trim().split(/\s+/);
  const rows = position.split('/');
  if (rows.length !== 8) return [];

  const pieces: BoardPiece[] = [];
  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    let fileIdx = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') {
        fileIdx += parseInt(ch, 10);
      } else {
        const file = String.fromCharCode(97 + fileIdx);
        const square = `${file}${rank}` as BoardSquare;
        const color: PlayerColor = ch === ch.toUpperCase() ? 'w' : 'b';
        const pieceClass = CHAR_TO_CLASS[ch.toLowerCase()];
        if (pieceClass) {
          pieces.push({ square, color, pieceClass });
        }
        fileIdx++;
      }
    }
  }
  return pieces;
}

export function getPieceFromFen(fen: string, square: BoardSquare): BoardPiece | null {
  const pieces = getBoardPiecesFromFen(fen);
  return pieces.find(p => p.square === square) || null;
}

export function tableCoordsToSquare(x: number, z: number): BoardSquare | null {
  if (x < -4 || x > 4 || z < -4 || z > 4) {
    return null;
  }
  const fileIndex = Math.floor(x + 4);
  const rankIndex = Math.floor(3.5 - z + 0.5); // rankIndex in 0..7
  if (fileIndex < 0 || fileIndex > 7 || rankIndex < 0 || rankIndex > 7) {
    return null;
  }
  return `${FILES[fileIndex]}${RANKS[rankIndex]}` as BoardSquare;
}

export function clampToTabletop(
  x: number,
  z: number,
  radius = 0
): { x: number; z: number } {
  const limit = Math.max(0, TABLE_HALF_EXTENT - radius);
  return {
    x: Math.max(-limit, Math.min(limit, x)),
    z: Math.max(-limit, Math.min(limit, z)),
  };
}

/**
 * Maps webcam normalized coordinates (point.x, point.y in [0, 1])
 * to a chessboard square, adapting for player perspective (White vs Black)
 * with edge hysteresis to prevent flickering near square borders.
 */
export function pointToBoardSquare(
  point: { x: number; y: number } | null,
  color: PlayerColor,
  previous: BoardSquare | null = null
): BoardSquare | null {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }

  // Use the middle 80% of the camera so edge squares are comfortable to reach.
  const x = (point.x - 0.1) / 0.8;
  const y = (point.y - 0.1) / 0.8;
  if (x < 0 || y < 0 || x >= 1 || y >= 1) {
    return null;
  }

  if (previous !== null) {
    const prevIdx = squareToIndex(previous);
    const row = color === 'w' ? 7 - Math.floor(prevIdx / 8) : Math.floor(prevIdx / 8);
    const col = color === 'w' ? prevIdx % 8 : 7 - (prevIdx % 8);

    // Keep the current target through small movements across a square boundary (hysteresis margin)
    if (
      x * 8 >= col - 0.12 &&
      x * 8 < col + 1.12 &&
      y * 8 >= row - 0.12 &&
      y * 8 < row + 1.12
    ) {
      return previous;
    }
  }

  const row = Math.floor(y * 8);
  const col = Math.floor(x * 8);
  const index = color === 'w' ? (7 - row) * 8 + col : row * 8 + 7 - col;

  if (index < 0 || index > 63) {
    return null;
  }
  return indexToSquare(index);
}
