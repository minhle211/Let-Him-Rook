import { randomUUID } from 'node:crypto';

export type Color = 'white' | 'black';
export type Kind = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king';
export type Spell = 'attack' | 'defense' | 'special';
export type Piece = { id: string; color: Color; kind: Kind; hp: number; maxHp: number };
export type Fighter = { piece: Piece; shieldUntil: number; shield: number; empowered: boolean; cooldowns: Record<Spell, number> };
export type Battle = { id: string; from: number; to: number; attacker: Fighter; defender: Fighter; startedAt: number; projectiles: { target: Color; damage: number; arrivesAt: number }[] };
export type Game = { board: (Piece | null)[]; turn: Color; phase: 'board' | 'battle' | 'finished'; winner: Color | null; battle: Battle | null; revision: number };
export const RULES = { projectileMs: 700, shieldMs: 1000, attackCooldownMs: 1200, defenseCooldownMs: 1800, specialCooldownMs: 5000, battleTimeoutMs: 60000 };
const other = (color: Color): Color => color === 'white' ? 'black' : 'white';
export function piece(kind: Kind, color: Color): Piece {
  const maxHp = kind === 'rook' ? 140 : kind === 'pawn' ? 80 : 100;
  return { id: randomUUID(), kind, color, hp: maxHp, maxHp };
}
export function createGame(): Game {
  const board: (Piece | null)[] = Array(64).fill(null);
  const back: Kind[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  for (let x = 0; x < 8; x++) {
    board[x] = piece(back[x], 'white'); board[8 + x] = piece('pawn', 'white');
    board[48 + x] = piece('pawn', 'black'); board[56 + x] = piece(back[x], 'black');
  }
  return { board, turn: 'white', phase: 'board', winner: null, battle: null, revision: 0 };
}
function square(n: number): boolean { return Number.isInteger(n) && n >= 0 && n < 64; }
export function legalMove(game: Game, from: number, to: number): boolean {
  if (!square(from) || !square(to) || from === to || game.phase !== 'board') return false;
  const p = game.board[from], target = game.board[to];
  if (!p || p.color !== game.turn || target?.color === p.color) return false;
  const x = from % 8, y = Math.floor(from / 8), dx = to % 8 - x, dy = Math.floor(to / 8) - y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (p.kind === 'pawn') {
    const direction = p.color === 'white' ? 1 : -1;
    if (target) return ax === 1 && dy === direction;
    return dx === 0 && (dy === direction || (y === (p.color === 'white' ? 1 : 6) && dy === 2 * direction && !game.board[from + 8 * direction]));
  }
  if (p.kind === 'knight') return ax * ay === 2;
  if (p.kind === 'king') return Math.max(ax, ay) === 1;
  const straight = dx === 0 || dy === 0, diagonal = ax === ay;
  if (!(p.kind === 'rook' ? straight : p.kind === 'bishop' ? diagonal : straight || diagonal)) return false;
  for (let step = 1; step < Math.max(ax, ay); step++) {
    if (game.board[(y + Math.sign(dy) * step) * 8 + x + Math.sign(dx) * step]) return false;
  }
  return true;
}
export function legalDestinations(game: Game, from: number): number[] {
  return Array.from({ length: 64 }, (_, i) => i).filter(to => legalMove(game, from, to));
}
function promote(p: Piece, at: number) {
  if (p.kind === 'pawn' && Math.floor(at / 8) === (p.color === 'white' ? 7 : 0)) p.kind = 'queen';
}
export function move(game: Game, color: Color, from: number, to: number, now: number): void {
  if (color !== game.turn || !legalMove(game, from, to)) throw new Error('Illegal move');
  const attacker = game.board[from]!, defender = game.board[to];
  if (defender) {
    const fighter = (p: Piece): Fighter => ({ piece: p, shieldUntil: 0, shield: 0, empowered: false, cooldowns: { attack: 0, defense: 0, special: 0 } });
    game.battle = { id: randomUUID(), from, to, attacker: fighter(attacker), defender: fighter(defender), startedAt: now, projectiles: [] };
    game.phase = 'battle';
  } else {
    game.board[to] = attacker; game.board[from] = null; promote(attacker, to); game.turn = other(game.turn);
  }
  game.revision++;
}
function finishBattle(game: Game, attackerWon: boolean) {
  const b = game.battle!;
  const loser = attackerWon ? b.defender.piece : b.attacker.piece;
  const winner = attackerWon ? b.attacker.piece : b.defender.piece;
  game.board[b.from] = null;
  if (attackerWon) { game.board[b.to] = winner; promote(winner, b.to); }
  game.turn = other(game.turn);
  game.battle = null;
  game.phase = loser.kind === 'king' ? 'finished' : 'board';
  if (game.phase === 'finished') game.winner = winner.color;
  game.revision++;
}
export function tick(game: Game, now: number): void {
  const b = game.battle;
  if (!b) return;
  while (b.projectiles.length && b.projectiles[0].arrivesAt <= Math.min(now, b.startedAt + RULES.battleTimeoutMs)) {
    const shot = b.projectiles.shift()!;
    const target = b.attacker.piece.color === shot.target ? b.attacker : b.defender;
    const blocked = target.shieldUntil > shot.arrivesAt ? Math.min(target.shield, shot.damage) : 0;
    target.shield -= blocked;
    target.piece.hp = Math.max(0, target.piece.hp - (shot.damage - blocked));
    game.revision++;
    if (target.piece.hp === 0) { finishBattle(game, target === b.defender); return; }
  }
  // A timeout favors the higher remaining health percentage; a tie favors the defender.
  if (now >= b.startedAt + RULES.battleTimeoutMs) finishBattle(game, b.attacker.piece.hp / b.attacker.piece.maxHp > b.defender.piece.hp / b.defender.piece.maxHp);
}
export function cast(game: Game, color: Color, battleId: string, spell: Spell, now: number): void {
  tick(game, now);
  const b = game.battle;
  if (!b || b.id !== battleId) throw new Error('Battle is no longer active');
  if (!['attack', 'defense', 'special'].includes(spell)) throw new Error('Unknown spell');
  const f = b.attacker.piece.color === color ? b.attacker : b.defender;
  if (now < f.cooldowns[spell]) throw new Error('Spell is cooling down');
  if (spell === 'attack') {
    b.projectiles.push({ target: other(color), damage: f.empowered ? 40 : 25, arrivesAt: now + RULES.projectileMs });
    f.empowered = false;
    f.cooldowns.attack = now + RULES.attackCooldownMs;
  } else if (spell === 'defense') {
    f.shield = 30; f.shieldUntil = now + RULES.shieldMs;
    f.cooldowns.defense = now + RULES.defenseCooldownMs;
  } else {
    if (f.piece.kind === 'rook') { f.shield = 60; f.shieldUntil = now + 1600; }
    else f.empowered = true;
    f.cooldowns.special = now + RULES.specialCooldownMs;
  }
  game.revision++;
}
