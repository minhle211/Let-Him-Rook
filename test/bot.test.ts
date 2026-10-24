import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, move, piece, cast, legalMove } from '../src/game.ts';
import { createBot, stepBot, chooseBotMove, BOT_TIMING } from '../src/bot.ts';

test('bot waits its turn and makes one delayed legal move', () => {
  const game = createGame(), bot = createBot();
  stepBot(game, bot, 0); assert.equal(game.revision, 0);
  move(game, 'white', 12, 28, 0);
  const choice = chooseBotMove(game, () => 0)!;
  assert.equal(legalMove(game, choice.from, choice.to), true);
  stepBot(game, bot, 100);
  stepBot(game, bot, 100 + BOT_TIMING.moveMs - 1); assert.equal(game.revision, 1);
  stepBot(game, bot, 100 + BOT_TIMING.moveMs, () => 0);
  assert.equal(game.revision, 2); assert.equal(game.turn, 'white');
  stepBot(game, bot, 5000); assert.equal(game.revision, 2);
});

function duel() {
  const game = createGame(); game.board.fill(null);
  game.board[0] = piece('rook', 'white'); game.board[8] = piece('pawn', 'black');
  move(game, 'white', 0, 8, 0);
  return game;
}
test('bot casts with a reaction delay and respects cooldowns', () => {
  const game = duel(), bot = createBot();
  stepBot(game, bot, 0);
  stepBot(game, bot, 1499); assert.equal(game.battle!.projectiles.length, 0);
  stepBot(game, bot, 1500); assert.equal(game.battle!.projectiles.length, 1);
  assert.equal(game.battle!.defender.cooldowns.attack, 2700);
  stepBot(game, bot, 1600); assert.equal(game.battle!.projectiles.length, 1);
  stepBot(game, bot, 2500);
  assert.equal(game.battle!.defender.empowered, true);
  stepBot(game, bot, 3500);
  assert.equal(game.battle!.projectiles[0].damage, 40);
});
test('bot can shield a visible projectile and can finish a battle', () => {
  const game = duel(), bot = createBot();
  stepBot(game, bot, 0);
  cast(game, 'white', game.battle!.id, 'attack', 1400);
  stepBot(game, bot, 1500, () => 0);
  assert.equal(game.battle!.defender.shield, 30);
  game.board[0]!.hp = 25;
  stepBot(game, bot, 2500, () => 1);
  stepBot(game, bot, 3200);
  assert.equal(game.board[0], null); assert.equal(game.board[8]!.color, 'black');
  assert.equal(game.phase, 'board'); assert.equal(game.turn, 'black');
});
test('bot prioritizes king captures, handles no moves, and stops after game over', () => {
  const game = createGame(); game.board.fill(null); game.turn = 'black';
  assert.equal(chooseBotMove(game), null);
  game.board[8] = piece('rook', 'black'); game.board[0] = piece('king', 'white'); game.board[9] = piece('pawn', 'white');
  assert.deepEqual(chooseBotMove(game, () => 0), {from:8,to:0});
  game.phase = 'finished'; game.winner = 'white';
  const before = structuredClone(game);
  stepBot(game, createBot(), 10000);
  assert.deepEqual(game, before);
});
