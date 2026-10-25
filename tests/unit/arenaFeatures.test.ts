import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIGHTER_MAX_HP,
  PUDDLES,
  PUDDLE_SLOW_FACTOR,
  TOWER,
  TREES,
  TUNNEL,
  isInsideCastle,
  type ProjectileState,
} from '@let-him-rook/shared';
import { applyMovementIntent, createDuel, stepDuel, type DuelSimulation } from '../../apps/server/src/combat/duelSimulator.ts';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Rook vs rook with the board pieces cleared away, so only the arena features remain. */
function arenaDuel(): DuelSimulation {
  const duel = createDuel(
    FEN,
    { from: 'e2', to: 'e7', attackerColor: 'w', attackerClass: 'rook', defenderClass: 'rook' },
    1000
  );
  duel.obstacles = duel.obstacles.filter(o => o.type !== 'piece');
  return duel;
}

const tower = (duel: DuelSimulation) => duel.obstacles.find(o => o.type === 'tower')!;

/** Point at `dist` from the tower centre in world direction `deg` (atan2(z, x)); -45 deg is the solid wall between the gates. */
const around = (deg: number, dist: number): [number, number] => [
  TOWER.x + Math.cos((deg * Math.PI) / 180) * dist,
  TOWER.z + Math.sin((deg * Math.PI) / 180) * dist,
];

function place(duel: DuelSimulation, color: 'w' | 'b', x: number, z: number) {
  const f = color === duel.attacker.color ? duel.attacker : duel.defender;
  f.x = x;
  f.z = z;
}

/** Fires a white shot from (x, z) straight at (tx, tz) and steps until it is gone. */
function shoot(duel: DuelSimulation, x: number, z: number, tx: number, tz: number) {
  const len = Math.hypot(tx - x, tz - z);
  const shot: ProjectileState = {
    id: 'test_shot', type: 'rook_shot', owner: 'w', x, z,
    vx: ((tx - x) / len) * 12, vz: ((tz - z) / len) * 12, radius: 0.2, damage: 20,
  };
  duel.projectiles.push(shot);
  for (let i = 0; i < 120 && duel.projectiles.length; i++) stepDuel(duel, duel.now + 16);
}

test('Arena: glasses and vases are replaced by indestructible trees and a 6-hit castle tower', () => {
  const duel = arenaDuel();
  assert.equal(duel.obstacles.filter(o => o.type === 'tree').length, TREES.length);
  assert.equal(duel.obstacles.filter(o => o.type === 'tower').length, 1);
  assert.equal(duel.obstacles.length, TREES.length + 1, 'nothing else (no glasses or vases)');
  assert.ok(duel.obstacles.filter(o => o.type === 'tree').every(t => t.indestructible));
  assert.equal(tower(duel).hitsRemaining, TOWER.maxHits);
});

test('Arena: castle walls shield a fighter inside; the shot damages the tower instead', () => {
  const duel = arenaDuel();
  place(duel, 'b', TOWER.x, TOWER.z);
  const [sx, sz] = around(-45, 4); // solid wall between the two gates
  place(duel, 'w', sx, sz);
  shoot(duel, sx, sz, TOWER.x, TOWER.z);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP, 'fighter inside the walls must not be hit');
  assert.equal(tower(duel).hitsRemaining, TOWER.maxHits - 1);
});

test('Arena: a shot straight down a tunnel and through its gate still reaches the fighter inside', () => {
  const duel = arenaDuel();
  place(duel, 'b', TOWER.x, TOWER.z);
  const mouth = TOWER.x + TOWER.radius + TUNNEL.length + 1;
  place(duel, 'w', mouth, TOWER.z);
  shoot(duel, mouth, TOWER.z, TOWER.x, TOWER.z); // down the tunnel and through the +x gate
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP - 20);
  assert.equal(tower(duel).hitsRemaining, TOWER.maxHits);
});

test('Arena: walls block walking; fighters enter and leave only through the gates', () => {
  const duel = arenaDuel();
  place(duel, 'w', TOWER.x, TOWER.z);
  place(duel, 'b', 3, -3);
  duel.attacker.facingRad = Math.PI; // facing +z, toward the solid back wall
  for (let i = 0; i < 90; i++) {
    applyMovementIntent(duel, 'w', 0, -1, duel.now, 0);
    stepDuel(duel, duel.now + 16);
  }
  assert.ok(isInsideCastle(duel.attacker.x, duel.attacker.z, TOWER.x, TOWER.z), 'solid wall must hold');

  duel.attacker.facingRad = Math.PI / 2; // facing +x, out through the gate facing the board
  for (let i = 0; i < 90; i++) {
    applyMovementIntent(duel, 'w', 0, -1, duel.now, 0);
    stepDuel(duel, duel.now + 16);
  }
  assert.ok(duel.attacker.x > TOWER.x + TOWER.radius + 0.4, `left through the gate into the tunnel (x=${duel.attacker.x.toFixed(2)})`);
});

test('Arena: when the tower collapses everyone inside takes 15 damage', () => {
  const duel = arenaDuel();
  tower(duel).hitsRemaining = 1;
  place(duel, 'b', TOWER.x, TOWER.z);
  const [sx, sz] = around(-45, 4);
  place(duel, 'w', sx, sz);
  shoot(duel, sx, sz, TOWER.x, TOWER.z);
  assert.equal(tower(duel).hitsRemaining, 0, 'tower collapsed');
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP - TOWER.collapseDamage);
  assert.equal(duel.attacker.hp, FIGHTER_MAX_HP, 'fighters outside are unharmed');

  // With the tower gone the same shot now goes straight through
  shoot(duel, sx, sz, TOWER.x, TOWER.z);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP - TOWER.collapseDamage - 20);
});

test('Arena: trees block shots and never break', () => {
  const duel = arenaDuel();
  const tree = TREES[0];
  place(duel, 'b', tree.x, tree.z + 2);
  place(duel, 'w', tree.x, tree.z - 1.2);
  for (let k = 0; k < 5; k++) shoot(duel, tree.x, tree.z - 1.2, tree.x, tree.z + 2);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP);
  assert.ok(duel.obstacles.some(o => o.id === tree.id && o.hitsRemaining > 0));
});

test('Arena: puddles slow movement', () => {
  const walk = (x: number, z: number) => {
    const duel = arenaDuel();
    place(duel, 'w', x, z);
    place(duel, 'b', 3, -3);
    duel.attacker.facingRad = 0;
    const start = duel.attacker.z;
    for (let i = 0; i < 6; i++) {
      applyMovementIntent(duel, 'w', 0, -1, duel.now, 0);
      stepDuel(duel, duel.now + 16);
    }
    return Math.abs(duel.attacker.z - start);
  };
  const p = PUDDLES[0];
  const dry = walk(p.x, p.z + 3.5);
  const wet = walk(p.x, p.z);
  assert.ok(Math.abs(wet / dry - PUDDLE_SLOW_FACTOR) < 0.01, `in puddle ${wet.toFixed(3)} vs dry ${dry.toFixed(3)}`);
});

test('Arena: a pawn sweep through a solid wall hits the tower, not the fighter inside', async () => {
  const { applyAbilityIntent } = await import('../../apps/server/src/combat/duelSimulator.ts');
  const duel = createDuel(
    FEN,
    { from: 'e2', to: 'e7', attackerColor: 'w', attackerClass: 'pawn', defenderClass: 'rook' },
    1000
  );
  duel.obstacles = duel.obstacles.filter(o => o.type !== 'piece');
  // Pawn outside the solid wall between the gates, swinging at the defender just inside it
  place(duel, 'b', ...around(-45, 0.4));
  place(duel, 'w', ...around(-45, 1.9));
  duel.attacker.facingRad = -0.75 * Math.PI; // facing the tower centre
  const res = applyAbilityIntent(duel, 'w', 'pawn_sweep', undefined, 2000);
  assert.equal(res.accepted, true);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP, 'the wall blocks the sweep');
  assert.equal(tower(duel).hitsRemaining, TOWER.maxHits - 1, 'the wall takes the hit');
});

test('Arena: the tunnels run from the gates to an open mouth; their walls block walking and shots', () => {
  const duel = arenaDuel();
  const side = TUNNEL.clearWidth / 2 + TUNNEL.wallThickness;
  // Walk the whole east tunnel from inside the tower and out of its mouth
  place(duel, 'w', TOWER.x, TOWER.z);
  place(duel, 'b', 3, -3);
  duel.attacker.facingRad = Math.PI / 2;
  for (let i = 0; i < 160; i++) {
    applyMovementIntent(duel, 'w', 0, -1, duel.now, 0);
    stepDuel(duel, duel.now + 16);
  }
  assert.ok(duel.attacker.x > TOWER.x + TOWER.radius + TUNNEL.length, `came out of the tunnel mouth (x=${duel.attacker.x.toFixed(2)})`);

  // Inside the tunnel, pushing sideways into its wall goes nowhere
  const midX = TOWER.x + TOWER.radius + TUNNEL.length / 2;
  place(duel, 'w', midX, TOWER.z);
  duel.attacker.facingRad = 0; // facing -z, into the tunnel's side wall
  for (let i = 0; i < 60; i++) {
    applyMovementIntent(duel, 'w', 0, -1, duel.now, 0);
    stepDuel(duel, duel.now + 16);
  }
  assert.ok(isInsideCastle(duel.attacker.x, duel.attacker.z, TOWER.x, TOWER.z), 'tunnel wall must hold');

  // A shot fired at the tunnel from the side hits its wall, not the fighter inside
  duel.attacker.hp = FIGHTER_MAX_HP;
  place(duel, 'b', midX, TOWER.z);
  place(duel, 'w', midX, TOWER.z - side - 3);
  shoot(duel, midX, TOWER.z - side - 3, midX, TOWER.z);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP);
  assert.equal(tower(duel).hitsRemaining, TOWER.maxHits - 1, 'the castle takes the hit');
});

test('Arena: a collapsing castle also hurts fighters inside the tunnels', () => {
  const duel = arenaDuel();
  tower(duel).hitsRemaining = 1;
  const inTunnel = TOWER.x + TOWER.radius + TUNNEL.length / 2;
  place(duel, 'b', inTunnel, TOWER.z);
  place(duel, 'w', ...around(-45, 4));
  shoot(duel, ...around(-45, 4), TOWER.x, TOWER.z);
  assert.equal(tower(duel).hitsRemaining, 0);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP - TOWER.collapseDamage);
});
