import { cast, legalDestinations, move, tick, type Game, type Spell } from './game.ts';

export type Bot = { context: string; nextActionAt: number };
export const BOT_TIMING = { moveMs: 1000, firstCastMs: 1500, castMs: 1000 };
export function createBot(): Bot { return { context: '', nextActionAt: 0 }; }

// A small practice opponent, not a chess engine. Captures and forward progress
// are preferred, with some randomness so repeated games differ.
export function chooseBotMove(game: Game, random = Math.random): { from: number; to: number } | null {
  if (game.phase !== 'board' || game.turn !== 'black') return null;
  const values = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
  let best: { from: number; to: number } | null = null, bestScore = -Infinity;
  const king = game.board.findIndex(p => p?.color === 'white' && p.kind === 'king');
  const distance = (at: number) => king < 0 ? 0 : Math.abs(at % 8 - king % 8) + Math.abs(Math.floor(at / 8) - Math.floor(king / 8));
  for (let from = 0; from < 64; from++) {
    if (game.board[from]?.color !== 'black') continue;
    for (const to of legalDestinations(game, from)) {
      const target = game.board[to], actor = game.board[from]!;
      const score = (target ? 10 + values[target.kind] + (actor.hp - target.hp) / 50 : 0)
        + (distance(from) - distance(to)) * 0.8
        + (actor.kind === 'pawn' && to < 8 ? 8 : 0)
        + random() * 2;
      if (score > bestScore) { bestScore = score; best = { from, to }; }
    }
  }
  return best;
}
export function stepBot(game: Game, bot: Bot, now: number, random = Math.random): void {
  tick(game, now);
  if (game.phase === 'finished' || (game.phase === 'board' && game.turn !== 'black')) {
    bot.context = ''; return;
  }
  const context = game.battle ? 'battle:' + game.battle.id : 'board:' + game.revision;
  if (context !== bot.context) {
    bot.context = context;
    bot.nextActionAt = now + (game.battle ? BOT_TIMING.firstCastMs : BOT_TIMING.moveMs);
    return;
  }
  if (now < bot.nextActionAt) return;
  if (game.phase === 'board') {
    const choice = chooseBotMove(game, random);
    if (choice) move(game, 'black', choice.from, choice.to, now);
    bot.nextActionAt = now + BOT_TIMING.moveMs;
    return;
  }
  const battle = game.battle!;
  const fighter = battle.attacker.piece.color === 'black' ? battle.attacker : battle.defender;
  const available = (spell: Spell) => fighter.cooldowns[spell] <= now;
  const incoming = battle.projectiles.some(shot => shot.target === 'black' && shot.arrivesAt > now);
  const shielded = fighter.shield > 0 && fighter.shieldUntil > now;
  let spell: Spell | null = null;
  if (incoming && !shielded && available('defense') && random() < 0.55) spell = 'defense';
  else if (available('attack')) spell = 'attack';
  else if (available('special') && !fighter.empowered && (fighter.piece.kind !== 'rook' || !shielded)) spell = 'special';
  if (spell) cast(game, 'black', battle.id, spell, now);
  bot.nextActionAt = now + BOT_TIMING.castMs;
}
