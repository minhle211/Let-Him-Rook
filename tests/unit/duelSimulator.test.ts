import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASS_ABILITY_CONFIG,
  DUEL_DURATION_MS,
  FIGHTER_MAX_HP,
  OBSTACLE_MAX_HITS,
  SPAWN_CLEAR_RADIUS,
  SPAWN_SEPARATION,
  TABLE_HALF_EXTENT,
} from '@let-him-rook/shared';
import {
  applyAbilityIntent,
  applyMovementIntent,
  createDuel,
  getDuelSnapshot,
  stepDuel,
} from '../../apps/server/src/combat/duelSimulator.ts';

const DUMMY_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

test('Duel Simulator: Spawning respects 5.0u separation and 2.5u obstacle clearance', () => {
  const pending = {
    from: 'e2' as const,
    to: 'e7' as const,
    attackerColor: 'w' as const,
    attackerClass: 'pawn' as const,
    defenderClass: 'pawn' as const,
  };

  const duel = createDuel(DUMMY_FEN, pending);
  const sep = Math.hypot(
    duel.attacker.x - duel.defender.x,
    duel.attacker.z - duel.defender.z
  );
  assert.ok(Math.abs(sep - SPAWN_SEPARATION) < 0.1, `Separation ${sep} should be close to 5.0`);

  // Verify all board obstacles are at least SPAWN_CLEAR_RADIUS (2.5u) away from midpoint
  const midX = (duel.attacker.x + duel.defender.x) / 2;
  const midZ = (duel.attacker.z + duel.defender.z) / 2;

  for (const obs of duel.obstacles) {
    if (obs.type === 'piece') {
      const d = Math.hypot(obs.x - midX, obs.z - midZ);
      assert.ok(
        d >= SPAWN_CLEAR_RADIUS - 0.05,
        `Obstacle ${obs.id} at ${d}u must be outside 2.5u spawn clearance`
      );
    }
  }

  // Verify 4 tabletop props are present
  assert.equal(duel.obstacles.filter(o => o.type === 'glass').length, 2);
  assert.equal(duel.obstacles.filter(o => o.type === 'vase').length, 2);
});

test('Duel Simulator: Tabletop hard perimeter [-7, 7] clamp on movement', () => {
  const pending = {
    from: 'e4' as const,
    to: 'e5' as const,
    attackerColor: 'w' as const,
    attackerClass: 'rook' as const,
    defenderClass: 'rook' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending);

  // Push attacker hard to the right (moveX = 1.0) for 10 seconds
  let time = duel.startedAt;
  for (let i = 0; i < 200; i++) {
    time += 50;
    applyMovementIntent(duel, 'w', 1.0, 0, time);
    stepDuel(duel, time);
  }

  assert.ok(
    duel.attacker.x <= TABLE_HALF_EXTENT && duel.attacker.x >= -TABLE_HALF_EXTENT,
    `Attacker x ${duel.attacker.x} must stay within table boundary`
  );
  assert.ok(
    duel.attacker.z <= TABLE_HALF_EXTENT && duel.attacker.z >= -TABLE_HALF_EXTENT,
    `Attacker z ${duel.attacker.z} must stay within table boundary`
  );
});

test('Duel Simulator: Tracking loss > 300ms stops movement velocity', () => {
  const pending = {
    from: 'e4' as const,
    to: 'e5' as const,
    attackerColor: 'w' as const,
    attackerClass: 'rook' as const,
    defenderClass: 'rook' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending);

  applyMovementIntent(duel, 'w', 0.8, -0.8, duel.startedAt);
  assert.notEqual(duel.attacker.vx, 0);

  // Step 350ms without new movement intent
  stepDuel(duel, duel.startedAt + 350);
  assert.equal(duel.attacker.vx, 0);
  assert.equal(duel.attacker.vz, 0);
});

test('Duel Simulator: 90s timeout favors higher HP, equal HP draws', () => {
  const pending = {
    from: 'e4' as const,
    to: 'e5' as const,
    attackerColor: 'w' as const,
    attackerClass: 'knight' as const,
    defenderClass: 'knight' as const,
  };

  // Higher HP wins
  const duel1 = createDuel(DUMMY_FEN, pending);
  duel1.attacker.hp = 80;
  duel1.defender.hp = 60;
  stepDuel(duel1, duel1.startedAt + DUEL_DURATION_MS + 10);
  assert.equal(duel1.isFinished, true);
  assert.equal(duel1.winner, 'w');
  assert.equal(duel1.resolutionReason, 'timeout_higher_hp');

  // Equal HP draws match
  const duel2 = createDuel(DUMMY_FEN, pending);
  duel2.attacker.hp = 75;
  duel2.defender.hp = 75;
  stepDuel(duel2, duel2.startedAt + DUEL_DURATION_MS + 10);
  assert.equal(duel2.isFinished, true);
  assert.equal(duel2.winner, 'draw');
  assert.equal(duel2.resolutionReason, 'duel_timeout_tie');
});

test('Duel Simulator: Pawn sweep damage and parry 100% negation', () => {
  const pending = {
    from: 'e4' as const,
    to: 'e5' as const,
    attackerColor: 'w' as const,
    attackerClass: 'pawn' as const,
    defenderClass: 'pawn' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending);

  // Position defender close (within 1.5u) directly in front of attacker
  duel.attacker.x = 0;
  duel.attacker.z = 0;
  duel.defender.x = 0;
  duel.defender.z = -1.5;
  duel.attacker.facingRad = 0; // facing negative Z

  // Normal sweep without parry
  const res1 = applyAbilityIntent(duel, 'w', 'pawn_sweep', undefined, duel.startedAt);
  assert.equal(res1.accepted, true);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP - CLASS_ABILITY_CONFIG.pawn.sweep.damage);

  // Defender activates parry
  applyAbilityIntent(duel, 'b', 'pawn_parry', true, duel.startedAt + 1500);
  assert.equal(duel.defender.isParrying, true);

  // Attacker sweeps again while defender parries: 0 damage taken!
  const hpBefore = duel.defender.hp;
  applyAbilityIntent(duel, 'w', 'pawn_sweep', undefined, duel.startedAt + 1500);
  assert.equal(duel.defender.hp, hpBefore, 'Parry must negate 100% of damage');
});

test('Duel Simulator: Rook fires shot and every 3rd shot is Cannon Bomb', () => {
  const pending = {
    from: 'a1' as const,
    to: 'a8' as const,
    attackerColor: 'w' as const,
    attackerClass: 'rook' as const,
    defenderClass: 'rook' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending, 1000);

  // Shot 1
  applyAbilityIntent(duel, 'w', 'rook_shot', undefined, 1000);
  assert.equal(duel.projectiles.length, 1);
  assert.equal(duel.projectiles[0].type, 'rook_shot');

  // Shot 2
  applyAbilityIntent(duel, 'w', 'rook_shot', undefined, 2600);
  assert.equal(duel.projectiles.length, 2);
  assert.equal(duel.projectiles[1].type, 'rook_shot');

  // Shot 3: Must be Cannon Bomb!
  applyAbilityIntent(duel, 'w', 'rook_shot', undefined, 4200);
  assert.equal(duel.projectiles.length, 3);
  assert.equal(duel.projectiles[2].type, 'rook_cannon_bomb');
  assert.equal(duel.projectiles[2].damage, CLASS_ABILITY_CONFIG.rook.cannonBomb.damage);
  assert.equal(duel.projectiles[2].splashRadius, CLASS_ABILITY_CONFIG.rook.cannonBomb.splashRadius);
});

test('Duel Simulator: Knight cleave teleport and range/obstacle validation', () => {
  const pending = {
    from: 'b1' as const,
    to: 'c3' as const,
    attackerColor: 'w' as const,
    attackerClass: 'knight' as const,
    defenderClass: 'knight' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending, 1000);

  // Place opponent too far (> 7 units)
  duel.attacker.x = -4.0;
  duel.defender.x = 4.0;
  const failRes = applyAbilityIntent(duel, 'w', 'knight_cleave', undefined, 1000);
  assert.equal(failRes.accepted, false);
  assert.equal(failRes.reason, 'blocked_or_out_of_range');
  assert.equal(duel.attacker.cooldowns.primary, 0, 'Failed cleave must NOT consume cooldown');

  // Place opponent within reach (3.0 units)
  duel.attacker.x = 0;
  duel.attacker.z = 0;
  duel.defender.x = 0;
  duel.defender.z = -3.0;

  const passRes = applyAbilityIntent(duel, 'w', 'knight_cleave', undefined, 1000);
  assert.equal(passRes.accepted, true);
  assert.ok(duel.attacker.teleportWindupRemainingMs > 0, 'Should start windup');

  // Step through 350ms windup
  stepDuel(duel, 1000 + 400);
  assert.equal(duel.attacker.teleportWindupRemainingMs, 0);
  assert.equal(duel.defender.hp, FIGHTER_MAX_HP - CLASS_ABILITY_CONFIG.knight.cleave.damage);
});

test('Duel Simulator: Bishop Ice Bolt freezes obstacle and creates 1.5u ice hazard', () => {
  const pending = {
    from: 'c1' as const,
    to: 'd2' as const,
    attackerColor: 'w' as const,
    attackerClass: 'bishop' as const,
    defenderClass: 'bishop' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending, 1000);

  // Place obstacle directly in projectile path
  const targetObs = duel.obstacles[0];
  duel.attacker.x = targetObs.x;
  duel.attacker.z = targetObs.z + 2.0;
  duel.defender.x = targetObs.x;
  duel.defender.z = targetObs.z - 4.0;
  duel.attacker.facingRad = 0; // facing negative Z directly at obstacle

  applyAbilityIntent(duel, 'w', 'bishop_ice_bolt', undefined, 1000);
  assert.equal(duel.projectiles.length, 1);

  // Step projectile into obstacle
  stepDuel(duel, 1300);

  // Obstacle took damage, is frozen, and ice hazard spawned
  assert.equal(targetObs.hitsRemaining, OBSTACLE_MAX_HITS - 1);
  assert.ok(targetObs.frozenRemainingMs > 0, 'Obstacle must be frozen');
  assert.equal(duel.iceHazards.length, 1);
  assert.equal(duel.iceHazards[0].radius, CLASS_ABILITY_CONFIG.bishop.iceBolt.hazardRadius);
});

test('Duel Simulator: Queen 3-orb volley inflicts 3 hits and breaks a 3-hit obstacle', () => {
  const pending = {
    from: 'd1' as const,
    to: 'd8' as const,
    attackerColor: 'w' as const,
    attackerClass: 'queen' as const,
    defenderClass: 'queen' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending, 1000);

  const targetObs = duel.obstacles[0];
  targetObs.hitsRemaining = 3;

  // Fire Queen volley
  duel.attacker.x = targetObs.x;
  duel.attacker.z = targetObs.z + 1.5;
  duel.defender.x = targetObs.x;
  duel.defender.z = targetObs.z - 3.0;
  duel.attacker.facingRad = 0; // facing negative Z directly at obstacle

  applyAbilityIntent(duel, 'w', 'queen_volley', undefined, 1000);
  assert.equal(duel.projectiles.length, 3);

  // Move projectiles into obstacle
  for (let t = 1050; t <= 1600; t += 50) {
    stepDuel(duel, t);
  }

  assert.equal(targetObs.hitsRemaining, 0, 'Full Queen volley must break 3-hit obstacle');
});

test('Duel Simulator: King summons 1-HP ally that approaches and attacks enemy', () => {
  const pending = {
    from: 'e1' as const,
    to: 'e8' as const,
    attackerColor: 'w' as const,
    attackerClass: 'king' as const,
    defenderClass: 'king' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending, 1000);

  const summonRes = applyAbilityIntent(duel, 'w', 'king_summon', undefined, 1000);
  assert.equal(summonRes.accepted, true);
  assert.equal(duel.allies.length, 1);
  assert.equal(duel.allies[0].hp, 1);

  // Cannot summon second ally while first is active
  const secondRes = applyAbilityIntent(duel, 'w', 'king_summon', undefined, 7500);
  assert.equal(secondRes.accepted, false);
  assert.equal(secondRes.reason, 'max_allies_active');

  // Step simulation for 2.5 seconds: ally approaches and attacks enemy
  const enemyHpBefore = duel.defender.hp;
  for (let t = 1050; t <= 3500; t += 50) {
    stepDuel(duel, t);
  }

  assert.ok(duel.defender.hp < enemyHpBefore, 'Summoned ally must damage enemy');
});

test('Duel Simulator: King summoned 1-HP ally takes damage and is destroyed by enemy attacks', () => {
  const pending = {
    from: 'e1' as const,
    to: 'e8' as const,
    attackerColor: 'w' as const,
    attackerClass: 'king' as const,
    defenderClass: 'king' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending, 1000);

  // White summons 1-HP ally
  applyAbilityIntent(duel, 'w', 'king_summon', undefined, 1000);
  assert.equal(duel.allies.length, 1);
  const ally = duel.allies[0];
  assert.equal(ally.hp, 1);

  // Clear obstacles so projectile directly tests ally hit registration
  duel.obstacles = [];

  // Place enemy projectile heading directly through ally
  duel.projectiles.push({
    id: 'test_enemy_bolt',
    type: 'bishop_ice_bolt',
    owner: 'b',
    x: ally.x,
    z: ally.z - 0.2,
    vx: 0,
    vz: 8.0,
    radius: 0.3,
    damage: 14,
  });

  // Step simulation: projectile collides with ally
  stepDuel(duel, 1050);

  // Ally must take lethal damage and be removed from active allies
  assert.equal(duel.allies.length, 0, '1-HP ally must be destroyed upon taking damage');
});

test('Duel Simulator: Manual rotation and aim-relative movement integration', () => {
  const pending = {
    from: 'e2' as const,
    to: 'e7' as const,
    attackerColor: 'w' as const,
    attackerClass: 'rook' as const,
    defenderClass: 'rook' as const,
  };
  const duel = createDuel(DUMMY_FEN, pending, 1000);

  // Initial facing is set facing opponent, turnRate is 0
  assert.equal(duel.attacker.turnRate, 0);
  const initialFacing = duel.attacker.facingRad;

  // 1. Step without turning: facingRad remains steady, does not snap
  stepDuel(duel, 1050);
  assert.equal(duel.attacker.facingRad, initialFacing);

  // 2. Apply clockwise turn intent (turnDir = 1)
  applyMovementIntent(duel, 'w', 0, 0, 1050, 1);
  assert.ok(duel.attacker.turnRate > 0);

  // Step 100ms (< 300ms tracking loss threshold)
  stepDuel(duel, 1150);
  assert.ok(duel.attacker.facingRad > initialFacing, 'Clockwise turn must increase facingRad');

  // 3. Aim-relative movement: set facingRad directly to PI/2 (East, positive X)
  duel.attacker.facingRad = Math.PI / 2;
  applyMovementIntent(duel, 'w', 0, -1, 1550, 0); // Advance forward (moveZ = -1)
  assert.ok(duel.attacker.vx > 3.0, 'Advancing while facing East must yield positive vx');
  assert.ok(Math.abs(duel.attacker.vz) < 0.1, 'Advancing while facing East must yield near-zero vz');

  // 4. Rook fires shot along current aim (East, positive X)
  applyAbilityIntent(duel, 'w', 'rook_shot', undefined, 1550);
  const proj = duel.projectiles[0];
  assert.ok(proj.vx > 9.0, 'Rook shot should travel along facingRad direction');
  assert.ok(Math.abs(proj.vz) < 0.1);
});


test('Pawn swings emit visuals on misses and blocks, but not rejected cooldown attempts', () => {
  const duel = createDuel(DUMMY_FEN, {
    from: 'e2', to: 'e7', attackerColor: 'w', attackerClass: 'pawn', defenderClass: 'pawn',
  });
  const now = duel.startedAt;
  const initialHp = duel.defender.hp;
  assert.equal(applyAbilityIntent(duel, 'w', 'pawn_sweep', undefined, now).accepted, true);
  assert.equal(duel.defender.hp, initialHp);
  assert.equal(duel.events.filter(e => e.type === 'melee_swing').length, 1);
  assert.equal(applyAbilityIntent(duel, 'w', 'pawn_sweep', undefined, now + 1).accepted, false);
  assert.equal(duel.events.filter(e => e.type === 'melee_swing').length, 1);
  duel.attacker.x = 0;
  duel.attacker.z = 0;
  duel.attacker.facingRad = 0;
  duel.defender.x = 0;
  duel.defender.z = -1;
  duel.defender.isParrying = true;
  assert.equal(applyAbilityIntent(duel, 'w', 'pawn_sweep', undefined, now + 2000).accepted, true);
  assert.equal(duel.events.filter(e => e.type === 'melee_swing').length, 2);
  assert.ok(duel.events.some(e => e.type === 'parry_blocked'));
  assert.equal(duel.defender.hp, initialHp);
});
