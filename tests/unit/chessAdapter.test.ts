import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNonCaptureMove,
  createInitialFen,
  getLegalMoves,
  getPieceAt,
  isCaptureMove,
  resolveCaptureOutcome,
  validateMove,
} from '../../apps/server/src/chess/chessEngine.ts';
import { Chess } from '../../apps/server/src/chess/chess.ts';
import { getBoardPiecesFromFen, getPieceFromFen } from '@let-him-rook/shared';
import { MatchMachine } from '../../apps/server/src/match/matchMachine.ts';

test('Chess Engine: initial position has 20 legal moves for White', () => {
  const fen = createInitialFen();
  const moves = getLegalMoves(fen);
  let total = 0;
  for (const dests of Object.values(moves)) {
    total += dests.length;
  }
  assert.equal(total, 20);
});

test('Chess Engine: non-capture moves apply immediately and update turn', () => {
  const fen = createInitialFen();
  assert.equal(validateMove(fen, 'e2', 'e4'), true);
  assert.equal(validateMove(fen, 'e2', 'e5'), false);

  const res = applyNonCaptureMove(fen, { from: 'e2', to: 'e4' });
  assert.equal(res.isGameOver, false);
  assert.equal(res.fen.includes(' w '), false);
  assert.equal(res.fen.includes(' b '), true);
});

test('Chess Engine: castling both kingside and queenside works legally', () => {
  // White can castle kingside: e1g1
  const fenKingside = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQK2R w KQkq - 0 1';
  // Move bishop and knight out of the way
  const chessK = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const movesK = chessK.moves({ verbose: true });
  assert.ok(movesK.some(m => m.from === 'e1' && m.to === 'g1'));
  assert.ok(movesK.some(m => m.from === 'e1' && m.to === 'c1'));

  // Castle kingside
  const resK = chessK.move({ from: 'e1', to: 'g1' });
  assert.ok(resK);
  assert.equal(chessK.get('g1')?.type, 'k');
  assert.equal(chessK.get('f1')?.type, 'r');
});

test('Chess Engine: en passant capture is recognized and legal', () => {
  // White pawn on e5, Black pawn plays d7->d5
  const fen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
  assert.equal(isCaptureMove(fen, 'e5', 'd6'), true);
  assert.equal(validateMove(fen, 'e5', 'd6'), true);
});

test('Chess Engine: all 4 promotion choices are validated', () => {
  const promoFen = '8/4P3/8/8/8/8/8/4K2k w - - 0 1';
  assert.equal(validateMove(promoFen, 'e7', 'e8', 'queen'), true);
  assert.equal(validateMove(promoFen, 'e7', 'e8', 'rook'), true);
  assert.equal(validateMove(promoFen, 'e7', 'e8', 'bishop'), true);
  assert.equal(validateMove(promoFen, 'e7', 'e8', 'knight'), true);
});

test('Capture Adapter: Attacker Win commits legal capture on the board', () => {
  // White pawn captures Black pawn on d5
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  assert.equal(isCaptureMove(fen, 'e4', 'd5'), true);

  const pending = {
    from: 'e4' as const,
    to: 'd5' as const,
    attackerColor: 'w' as const,
    attackerClass: 'pawn' as const,
    defenderClass: 'pawn' as const,
  };

  const outcome = resolveCaptureOutcome(fen, pending, 'attacker_win');
  assert.equal(outcome.isGameOver, false);
  const p = getPieceAt(outcome.fen, 'd5');
  assert.equal(p?.color, 'w');
  assert.equal(p?.pieceClass, 'pawn');
  assert.equal(getPieceAt(outcome.fen, 'e4'), null);
});

test('Capture Adapter: Defender Win removes attacker piece, keeps defender, passes turn', () => {
  // White knight on c3 captures Black pawn on d5
  const fen = 'rnbqkbnr/ppp1pppp/8/3p4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 2';
  const pending = {
    from: 'c3' as const,
    to: 'd5' as const,
    attackerColor: 'w' as const,
    attackerClass: 'knight' as const,
    defenderClass: 'pawn' as const,
  };

  const outcome = resolveCaptureOutcome(fen, pending, 'defender_win');
  assert.equal(outcome.isGameOver, false);

  // White knight at c3 is gone!
  assert.equal(getPieceAt(outcome.fen, 'c3'), null);
  // Black pawn at d5 remains intact!
  const def = getPieceAt(outcome.fen, 'd5');
  assert.equal(def?.color, 'b');
  assert.equal(def?.pieceClass, 'pawn');
  // Turn passed to Black (defender)
  assert.ok(outcome.fen.includes(' b '));
});

test('Capture Adapter: Attacking King that loses duel immediately loses match (King Duel Rule)', () => {
  const fen = '8/8/8/3p4/4K3/8/8/7k w - - 0 1';
  const pending = {
    from: 'e4' as const,
    to: 'd5' as const,
    attackerColor: 'w' as const,
    attackerClass: 'king' as const,
    defenderClass: 'pawn' as const,
  };

  const outcome = resolveCaptureOutcome(fen, pending, 'defender_win');
  assert.equal(outcome.isGameOver, true);
  assert.equal(outcome.winner, 'b');
  assert.equal(outcome.reason, 'king_duel_lost');
});

test('Capture Adapter: Discovered check on attacker King awards match to defender (King Safety Rule)', () => {
  // White King is on e1. White Rook is on e4. Black Rook is on e8.
  // White Rook attacks d4 (pawn) and LOSES duel!
  // Removing White Rook from e4 leaves file e wide open between Black Rook e8 and White King e1!
  // Turn passes to Black, but White King would be exposed to discovered check!
  const fen = '4r2k/8/8/8/3p4/8/8/4K3 w - - 0 1';
  // Let's set White rook on e4
  const chess = new Chess();
  chess.load('4r2k/8/8/8/3pR3/8/8/4K3 w - - 0 1');

  const pending = {
    from: 'e4' as const,
    to: 'd4' as const,
    attackerColor: 'w' as const,
    attackerClass: 'rook' as const,
    defenderClass: 'pawn' as const,
  };

  const outcome = resolveCaptureOutcome(chess.fen(), pending, 'defender_win');
  assert.equal(outcome.isGameOver, true);
  assert.equal(outcome.winner, 'b');
  assert.equal(outcome.reason, 'king_exposed_after_failed_capture');
});

test('Capture Adapter: Duel tie/draw ends match in draw', () => {
  const fen = createInitialFen();
  const pending = {
    from: 'e2' as const,
    to: 'e4' as const,
    attackerColor: 'w' as const,
    attackerClass: 'pawn' as const,
    defenderClass: 'pawn' as const,
  };

  const outcome = resolveCaptureOutcome(fen, pending, 'tie_draw');
  assert.equal(outcome.isGameOver, true);
  assert.equal(outcome.winner, 'draw');
  assert.equal(outcome.reason, 'duel_timeout_tie');
});

test('FEN Parsing: getBoardPiecesFromFen and getPieceFromFen correctly parse piece positions', () => {
  const fen = createInitialFen();
  const pieces = getBoardPiecesFromFen(fen);
  assert.equal(pieces.length, 32);

  const whitePawn = getPieceFromFen(fen, 'e2');
  assert.equal(whitePawn?.color, 'w');
  assert.equal(whitePawn?.pieceClass, 'pawn');

  const blackQueen = getPieceFromFen(fen, 'd8');
  assert.equal(blackQueen?.color, 'b');
  assert.equal(blackQueen?.pieceClass, 'queen');

  // Verify a Rook on the 7th rank is identified as a rook, not a pawn
  const rookOn7thFen = 'rnbqkbnr/Rppppppp/8/8/8/8/1PPPPPPP/1NBQKBNR w Kkq - 0 1';
  const rookPiece = getPieceFromFen(rookOn7thFen, 'a7');
  assert.equal(rookPiece?.pieceClass, 'rook');
  assert.notEqual(rookPiece?.pieceClass, 'pawn');
});

test('En Passant: MatchMachine initiates duel and handles attacker/defender victory without crashing', () => {
  // Position with White pawn e5, Black pawn d5, ep target d6
  const epFen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2';
  const match = new MatchMachine('ep_test_room', 'pvp');
  match.fen = epFen;
  match.phase = 'chess_turn';
  match.players.w.connected = true;
  match.players.b.connected = true;
  match.players.w.calibrated = true;
  match.players.b.calibrated = true;

  // White plays en passant e5 -> d6
  const res = match.handleChessMove('w', 'e5', 'd6', undefined, 'ep_move_1');
  assert.equal(res.accepted, true);
  assert.equal(match.phase, 'duel_intro');
  assert.ok(match.pendingCapture);
  assert.equal(match.pendingCapture?.from, 'e5');
  assert.equal(match.pendingCapture?.to, 'd6');
  assert.equal(match.pendingCapture?.attackerClass, 'pawn');
  assert.equal(match.pendingCapture?.defenderClass, 'pawn');

  // Test Attacker Win commits en passant: d5 pawn is captured and White pawn moves to d6
  const attackerWinRes = resolveCaptureOutcome(epFen, match.pendingCapture!, 'attacker_win');
  assert.equal(attackerWinRes.isGameOver, false);
  assert.equal(getPieceAt(attackerWinRes.fen, 'd5'), null, 'Captured black pawn at d5 must be removed');
  const newWhitePawn = getPieceAt(attackerWinRes.fen, 'd6');
  assert.equal(newWhitePawn?.color, 'w');
  assert.equal(newWhitePawn?.pieceClass, 'pawn');

  // Test Defender Win removes attacker e5 and leaves defender d5 intact
  const defenderWinRes = resolveCaptureOutcome(epFen, match.pendingCapture!, 'defender_win');
  assert.equal(defenderWinRes.isGameOver, false);
  assert.equal(getPieceAt(defenderWinRes.fen, 'e5'), null, 'Defeated attacking white pawn must be removed');
  const survivingBlackPawn = getPieceAt(defenderWinRes.fen, 'd5');
  assert.equal(survivingBlackPawn?.color, 'b');
  assert.equal(survivingBlackPawn?.pieceClass, 'pawn');
  assert.ok(defenderWinRes.fen.includes(' b '));
});
