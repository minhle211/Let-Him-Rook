import test from 'node:test';
import assert from 'node:assert/strict';
import type { DuelEvent, PlayerColor } from '../../packages/shared/src/index.ts';
import {
  buildFightRecord,
  emptyTally,
  loadJournal,
  noteDuelEvents,
  saveJournal,
  type FightEnd,
  type JournalStorage,
} from '../../apps/web/src/review/fightReview.ts';

function memory(): JournalStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function end(overrides: Partial<FightEnd> = {}): FightEnd {
  return {
    roomId: 'ROOM1',
    square: 'e4',
    localColor: 'w',
    localClass: 'pawn',
    opponentClass: 'knight',
    role: 'attacker',
    winner: 'b',
    reason: 'knockout',
    durationMs: 12000,
    localHp: 0,
    opponentHp: 64,
    ...overrides,
  };
}

function hit(target: PlayerColor, damage: number, extra: Record<string, unknown> = {}): DuelEvent {
  return { type: 'melee_hit', timestamp: 1, data: { target, damage, ...extra } };
}

test('pawn who never parries gets a parry drawback and a three-step plan', () => {
  let tally = emptyTally();
  tally = noteDuelEvents(
    tally,
    [hit('b', 18), hit('b', 18), hit('w', 18), hit('w', 18), hit('w', 18)],
    'w'
  );
  const record = buildFightRecord(tally, end(), 1000);
  assert.equal(record.result, 'loss');
  assert.equal(record.hitsLanded, 2);
  assert.equal(record.hitsTaken, 3);
  assert.match(record.drawbacks.join(' '), /never parried/);
  assert.equal(record.plan.length, 3);
  assert.match(record.plan[1], /parry/i);
  assert.match(record.improvements.join(' '), /open right palm/);
});

test('rook shots that hit props call out the aim leak', () => {
  let tally = emptyTally();
  tally = noteDuelEvents(
    tally,
    [
      { type: 'projectile_spawn', timestamp: 1, data: { owner: 'w', projectileType: 'rook_shot' } },
      { type: 'projectile_spawn', timestamp: 2, data: { owner: 'w', projectileType: 'rook_shot' } },
      { type: 'projectile_spawn', timestamp: 3, data: { owner: 'w', projectileType: 'rook_shot' } },
      { type: 'projectile_hit', timestamp: 4, data: { target: 'b', damage: 16, projectileType: 'rook_shot' } },
      { type: 'obstacle_damage', timestamp: 5, data: { obstacleId: 'glass_1', hitsRemaining: 2 } },
      { type: 'obstacle_damage', timestamp: 6, data: { obstacleId: 'vase_1', hitsRemaining: 2 } },
    ],
    'w'
  );
  const record = buildFightRecord(
    tally,
    end({
      localClass: 'rook',
      winner: 'b',
      reason: 'timeout_higher_hp',
      localHp: 40,
      opponentHp: 70,
    }),
    2000
  );
  assert.match(record.drawbacks.join(' '), /props/);
  assert.match(record.drawbacks.join(' '), /Time ran out/);
  assert.match(record.improvements.join(' '), /glass or vase/);
});

test('a clean win does not invent a failure', () => {
  let tally = emptyTally();
  tally = noteDuelEvents(tally, [hit('b', 18), hit('b', 18), { type: 'parry_blocked', timestamp: 3, data: { defender: 'w' } }], 'w');
  const record = buildFightRecord(
    tally,
    end({ winner: 'w', reason: 'knockout', localHp: 80, opponentHp: 0 }),
    3000
  );
  assert.equal(record.result, 'win');
  assert.match(record.drawbacks[0], /No clear leak/);
  assert.equal(record.plan.length, 3);
  assert.match(record.plan[2], /stop pressing/);
});

test('ally hits and ally targets are not counted as the player landing or taking the blow', () => {
  const tally = noteDuelEvents(
    emptyTally(),
    [
      hit('b', 10, { attackerId: 'ally-1' }),
      { type: 'projectile_hit', timestamp: 2, data: { target: 'w', damage: 14, targetAllyId: 'ally-2', projectileType: 'bishop_ice_bolt' } },
    ],
    'w'
  );
  assert.equal(tally.hitsLanded, 0);
  assert.equal(tally.hitsTaken, 0);
  assert.equal(tally.iceHitsTaken, 0);
});

test('journal keeps the newest fights and ignores corrupt storage', () => {
  const storage = memory();
  assert.deepEqual(loadJournal(storage), []);
  const record = buildFightRecord(emptyTally(), end(), 4000);
  saveJournal([record], storage);
  assert.equal(loadJournal(storage)[0].id, record.id);
  storage.setItem('rook_fight_journal_v1', '{not json');
  assert.deepEqual(loadJournal(storage), []);
});
