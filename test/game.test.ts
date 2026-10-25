import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cast, createGame, legalDestinations, legalMove, move, piece, tick, RULES, type Game } from '../src/game.ts';

function duel(): Game {
  const g = createGame(); g.board.fill(null);
  g.board[0] = piece('rook', 'white'); g.board[8] = piece('pawn', 'black');
  move(g, 'white', 0, 8, 1000); return g;
}
test('initial position has twenty legal moves and blocked sliding pieces', () => {
  const g = createGame();
  assert.equal(g.board.filter(Boolean).length, 32);
  assert.equal(g.board.reduce((sum, _, i) => sum + legalDestinations(g, i).length, 0), 20);
  assert.equal(legalMove(g, 0, 24), false);
  assert.equal(legalMove(g, -1, 0), false);
});
test('turns, pawn capture rules, and invalid moves', () => {
  const g = createGame();
  assert.throws(() => move(g, 'black', 48, 40, 0));
  assert.equal(legalMove(g, 8, 17), false);
  move(g, 'white', 12, 28, 0);
  assert.equal(g.turn, 'black');
  assert.equal(g.board[12], null);
  assert.equal(g.board[28]?.kind, 'pawn');
});
test('all pieces follow movement geometry and path blocking', () => {
  const g = createGame(); g.board.fill(null);
  for (const [kind, valid, invalid] of [['rook', 31, 36], ['bishop', 54, 31], ['queen', 54, 44], ['knight', 44, 36], ['king', 36, 45]] as const) {
    g.board[27] = piece(kind, 'white');
    assert.equal(legalMove(g, 27, valid), true, kind);
    assert.equal(legalMove(g, 27, invalid), false, kind);
  }
  g.board[27] = piece('bishop', 'white'); g.board[36] = piece('pawn', 'black');
  assert.equal(legalMove(g, 27, 54), false);
});
test('projectiles travel, shields block, cooldowns are enforced', () => {
  const g = duel(), id = g.battle!.id;
  cast(g, 'white', id, 'attack', 1000);
  assert.throws(() => cast(g, 'white', id, 'attack', 1100));
  tick(g, 1699); assert.equal(g.board[8]!.hp, 80);
  cast(g, 'black', id, 'defense', 1600);
  tick(g, 1700); assert.equal(g.board[8]!.hp, 80);
  cast(g, 'white', id, 'attack', 2200); tick(g, 2900);
  assert.equal(g.board[8]!.hp, 55);
});
test('attacker wins, retains damage, and turn switches', () => {
  const g = duel(), id = g.battle!.id;
  cast(g, 'black', id, 'attack', 1000); tick(g, 1700);
  for (const now of [2000, 3200, 4400, 5600]) { cast(g, 'white', id, 'attack', now); tick(g, now + 700); }
  assert.equal(g.phase, 'board'); assert.equal(g.turn, 'black');
  assert.equal(g.board[0], null); assert.equal(g.board[8]!.color, 'white');
  assert.equal(g.board[8]!.hp, 115);
  assert.throws(() => cast(g, 'white', id, 'attack', 8000));
});
test('defender wins and still receives next board turn', () => {
  const g = duel(), id = g.battle!.id;
  g.board[0]!.hp = 25;
  cast(g, 'black', id, 'attack', 1000); tick(g, 1700);
  assert.equal(g.board[0], null); assert.equal(g.board[8]!.color, 'black');
  assert.equal(g.turn, 'black'); assert.equal(g.phase, 'board');
});
test('king loss ends the game even when the king attacks', () => {
  const g = createGame(); g.board.fill(null);
  g.board[0] = piece('king', 'white'); g.board[8] = piece('rook', 'black'); g.board[0]!.hp = 25;
  move(g, 'white', 0, 8, 1000);
  cast(g, 'black', g.battle!.id, 'attack', 1000); tick(g, 1700);
  assert.equal(g.winner, 'black'); assert.equal(g.phase, 'finished');
  assert.throws(() => move(g, 'black', 8, 16, 2000));
});
test('timeout, pawn empowerment, rook shield, and promotion', () => {
  const g = duel(), id = g.battle!.id;
  cast(g, 'black', id, 'special', 1000); cast(g, 'black', id, 'attack', 1000);
  cast(g, 'white', id, 'special', 1100); tick(g, 1700);
  assert.equal(g.board[0]!.hp, 140);
  tick(g, 1000 + RULES.battleTimeoutMs);
  assert.equal(g.board[8]!.color, 'black');
  const p = createGame(); p.board.fill(null); p.board[48] = piece('pawn', 'white'); p.board[48]!.hp = 35;
  move(p, 'white', 48, 56, 0);
  assert.equal(p.board[56]!.kind, 'queen'); assert.equal(p.board[56]!.hp, 35);
});
