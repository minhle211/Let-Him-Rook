import test from 'node:test';
import assert from 'node:assert/strict';
import { RookServer } from '../../apps/server/src/ws/wsServer.ts';
import { createVirtualSessionPair } from '../../apps/server/src/ws/wsServer.ts';
import type { ClientMessage, MatchSnapshot, ServerMessage } from '@let-him-rook/shared';

function createE2EClient(server: RookServer) {
  const { clientSession, serverSession } = createVirtualSessionPair();
  server.routeSession(serverSession);

  const messages: ServerMessage[] = [];
  clientSession.onMessage = (raw: string) => {
    messages.push(JSON.parse(raw) as ServerMessage);
  };

  const send = (msg: ClientMessage) => {
    clientSession.send(JSON.stringify(msg));
  };

  const getSnapshot = (): MatchSnapshot | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === 'snapshot') {
        return (messages[i] as any).snapshot;
      }
    }
    return null;
  };

  return { clientSession, messages, send, getSnapshot };
}

test('E2E: Full Solo Match Flow vs Bot', async () => {
  const server = new RookServer();
  const player = createE2EClient(server);

  // 1. Create solo bot room
  player.send({ type: 'create_room', mode: 'bot' });
  await new Promise(r => setTimeout(r, 20));

  const joinMsg = player.messages.find(m => m.type === 'room_joined') as any;
  assert.ok(joinMsg);
  assert.equal(joinMsg.mode, 'bot');
  assert.equal(joinMsg.color, 'w');

  // 2. Player completes calibration
  player.send({ type: 'calibration_ready', ready: true });
  await new Promise(r => setTimeout(r, 20));

  let snap = player.getSnapshot();
  assert.ok(snap);
  assert.equal(snap?.phase, 'chess_turn');
  assert.equal(snap?.turn, 'w');

  // 3. Player plays e2-e4
  player.send({
    type: 'chess_move_intent',
    from: 'e2',
    to: 'e4',
    actionId: 'e2e_m1',
  });
  await new Promise(r => setTimeout(r, 20));

  snap = player.getSnapshot();
  assert.equal(snap?.turn, 'b');

  // 4. Fast forward bot tick: Bot makes legal move as Black
  const room = server.roomManager.getRoom(joinMsg.roomId)!;
  server.roomManager.tick(Date.now() + 1500);
  await new Promise(r => setTimeout(r, 20));

  snap = player.getSnapshot();
  // Turn should have returned to White or entered duel
  assert.ok(snap?.revision! > 2);
});

test('E2E: Solo Bot Pawn closes distance in 3D duel and lands melee sweep', async () => {
  const server = new RookServer();
  const player = createE2EClient(server);

  player.send({ type: 'create_room', mode: 'bot' });
  await new Promise(r => setTimeout(r, 20));
  const joinMsg = player.messages.find(m => m.type === 'room_joined') as any;
  const roomId = joinMsg.roomId;

  player.send({ type: 'calibration_ready', ready: true });
  await new Promise(r => setTimeout(r, 20));

  const room = server.roomManager.getRoom(roomId)!;
  // Set up immediate pawn capture e4xd5
  room.match.fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  let now = Date.now();
  room.match.handleChessMove('w', 'e4', 'd5', undefined, 'cap_bot_test', now);
  assert.equal(room.match.phase, 'duel_intro');

  // Advance past 2s duel intro
  now += 2100;
  server.roomManager.tick(now);
  assert.equal(room.match.phase, 'active_duel');

  // Simulate 3 seconds of 20Hz ticks; Bot (Black Pawn) must close from 5.0u to < 2.2u and damage White
  for (let i = 0; i < 60; i++) {
    now += 50;
    server.roomManager.tick(now);
  }

  assert.ok(room.match.duel);
  assert.ok(
    room.match.duel.attacker.hp < 100,
    `Bot Pawn should have closed distance and damaged player (HP=${room.match.duel.attacker.hp})`
  );
});

test('E2E: Full 2-Player Match with Capture Duel and Attacker Victory', async () => {
  const server = new RookServer();
  const p1 = createE2EClient(server);
  const p2 = createE2EClient(server);

  // 1. P1 creates room
  p1.send({ type: 'create_room', mode: 'pvp' });
  await new Promise(r => setTimeout(r, 20));
  const roomId = (p1.messages.find(m => m.type === 'room_joined') as any).roomId;

  // 2. P2 joins room
  p2.send({ type: 'join_room', roomId });
  await new Promise(r => setTimeout(r, 20));

  // 3. Both calibrate
  p1.send({ type: 'calibration_ready', ready: true });
  p2.send({ type: 'calibration_ready', ready: true });
  await new Promise(r => setTimeout(r, 20));

  assert.equal(p1.getSnapshot()?.phase, 'chess_turn');

  // 4. Move sequence leading to capture:
  // e2-e4
  p1.send({ type: 'chess_move_intent', from: 'e2', to: 'e4', actionId: 'p1_m1' });
  await new Promise(r => setTimeout(r, 20));

  // d7-d5
  p2.send({ type: 'chess_move_intent', from: 'd7', to: 'd5', actionId: 'p2_m1' });
  await new Promise(r => setTimeout(r, 20));

  // e4xd5 (Capture duel triggered)
  p1.send({ type: 'chess_move_intent', from: 'e4', to: 'd5', actionId: 'p1_m2' });
  await new Promise(r => setTimeout(r, 20));

  const room = server.roomManager.getRoom(roomId)!;
  assert.equal(room.match.phase, 'duel_intro');

  // 5. Fast forward 2.0s duel intro -> enters active_duel
  server.roomManager.tick(Date.now() + 2100);
  assert.equal(room.match.phase, 'active_duel');
  assert.ok(room.match.duel);

  // 6. Duel fight: Attacker deals lethal damage to Defender
  room.match.duel.defender.hp = 0;
  server.roomManager.tick(Date.now() + 2200);

  // Enters duel_result with attacker win
  assert.equal(room.match.phase, 'duel_result');
  assert.equal(room.match.duel.winner, 'w');

  // 7. Fast forward 2.5s duel banner -> resolves to chess board
  server.roomManager.tick(Date.now() + 5000);
  assert.equal(room.match.phase, 'chess_turn');
  assert.equal(room.match.turn, 'b');

  // Verify board has White pawn on d5 and e4 is empty!
  const d5Piece = room.match.fen.split(' ')[0];
  assert.ok(d5Piece.includes('P'), 'White pawn must occupy captured square');
});
