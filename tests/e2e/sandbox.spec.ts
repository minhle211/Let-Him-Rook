import test from 'node:test';
import assert from 'node:assert/strict';
import { RookServer, createVirtualSessionPair } from '../../apps/server/src/ws/wsServer.ts';
import type { ClientMessage, MatchSnapshot, ServerMessage } from '@let-him-rook/shared';
import { getPieceAt } from '../../apps/server/src/chess/chessEngine.ts';

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

test('E2E: Sandbox Mode Full Lifecycle, Direct Board Editing, Cheats, and Standalone Duels', async () => {
  const server = new RookServer();
  const player = createE2EClient(server);

  // ---------------------------------------------------------------------------
  // 1. Create Sandbox Room (Auto-calibrated and enters chess_turn immediately)
  // ---------------------------------------------------------------------------
  player.send({ type: 'create_room', mode: 'sandbox' });
  await new Promise(r => setTimeout(r, 20));

  const joinMsg = player.messages.find(m => m.type === 'room_joined') as any;
  assert.ok(joinMsg, 'Expected room_joined message');
  assert.equal(joinMsg.mode, 'sandbox');
  assert.equal(joinMsg.color, 'w');
  const roomId = joinMsg.roomId;

  let snap = player.getSnapshot();
  assert.ok(snap, 'Expected initial snapshot');
  assert.equal(snap?.phase, 'chess_turn');
  assert.equal(snap?.mode, 'sandbox');
  assert.ok(snap?.players.w.calibrated);
  assert.ok(snap?.players.b.calibrated);
  assert.ok(snap?.sandboxConfig);
  assert.equal(snap?.sandboxConfig?.godMode, false);
  assert.equal(snap?.sandboxConfig?.aiBehavior, 'dummy');

  // ---------------------------------------------------------------------------
  // 2. Reject Second Player Attempting to Join Sandbox Room
  // ---------------------------------------------------------------------------
  const intruder = createE2EClient(server);
  intruder.send({ type: 'join_room', roomId });
  await new Promise(r => setTimeout(r, 20));

  const errorMsg = intruder.messages.find(m => m.type === 'error') as any;
  assert.ok(errorMsg, 'Expected error message for joining solo sandbox room');
  assert.ok(errorMsg.message.includes('Cannot join solo practice room'));

  // ---------------------------------------------------------------------------
  // 3. Interactive Board Editing: Palette Placement, Free Moves, Eraser, Set FEN
  // ---------------------------------------------------------------------------
  // A. Place a Black Queen on d5
  player.send({
    type: 'sandbox_place_piece',
    square: 'd5',
    pieceClass: 'queen',
    pieceColor: 'b',
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.ok(snap);
  assert.deepEqual(getPieceAt(snap.fen, 'd5'), { color: 'b', pieceClass: 'queen' });

  // B. Free Move the piece from d5 to e4 (ignoring chess geometry)
  player.send({
    type: 'sandbox_free_move',
    from: 'd5',
    to: 'e4',
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.ok(snap);
  assert.equal(getPieceAt(snap.fen, 'd5'), null);
  assert.deepEqual(getPieceAt(snap.fen, 'e4'), { color: 'b', pieceClass: 'queen' });

  // C. Eraser tool on e4
  player.send({
    type: 'sandbox_place_piece',
    square: 'e4',
    pieceClass: null,
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.ok(snap);
  assert.equal(getPieceAt(snap.fen, 'e4'), null);

  // D. Set arbitrary custom FEN
  const customFen = '8/8/8/8/8/8/4K3/4k3 w - - 0 1';
  player.send({
    type: 'sandbox_set_fen',
    fen: customFen,
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.ok(snap);
  assert.equal(snap.fen, customFen);

  // ---------------------------------------------------------------------------
  // 4. Update Sandbox Cheats & Arena Config
  // ---------------------------------------------------------------------------
  player.send({
    type: 'sandbox_update_config',
    config: {
      godMode: true,
      noCooldowns: true,
      moveSpeedMultiplier: 1.8,
      aiBehavior: 'dummy',
    },
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.ok(snap);
  assert.equal(snap.sandboxConfig?.godMode, true);
  assert.equal(snap.sandboxConfig?.noCooldowns, true);
  assert.equal(snap.sandboxConfig?.moveSpeedMultiplier, 1.8);
  assert.equal(snap.sandboxConfig?.aiBehavior, 'dummy');

  // ---------------------------------------------------------------------------
  // 5. Standalone Duel Arena Launch, Reset, and Clean Exit
  // ---------------------------------------------------------------------------
  const preDuelFen = snap.fen;

  // Start standalone duel: Knight vs Bishop
  player.send({
    type: 'sandbox_start_duel',
    attackerClass: 'knight',
    defenderClass: 'bishop',
    aiBehavior: 'dummy',
    standalone: true,
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.ok(snap);
  assert.equal(snap.phase, 'active_duel');
  assert.ok(snap.duelSnapshot);
  assert.equal(snap.duelSnapshot.attacker.pieceClass, 'knight');
  assert.equal(snap.duelSnapshot.defender.pieceClass, 'bishop');

  const room = server.roomManager.getRoom(roomId)!;
  assert.ok(room.match.duel);

  // Verify dummy bot does not move or attack
  const botXBefore = room.match.duel.defender.x;
  const botZBefore = room.match.duel.defender.z;
  server.roomManager.tick(Date.now() + 500);
  assert.equal(room.match.duel.defender.x, botXBefore);
  assert.equal(room.match.duel.defender.z, botZBefore);
  assert.equal(room.match.duel.defender.cooldowns.primary, 0);

  // Test speed multiplier on player movement intent
  player.send({
    type: 'duel_move_intent',
    moveX: 0,
    moveZ: -1,
    actionId: 'sb_mv_1',
  });
  await new Promise(r => setTimeout(r, 20));
  const playerSpeed = Math.hypot(room.match.duel.attacker.vx, room.match.duel.attacker.vz);
  assert.ok(playerSpeed > 3.0, `Player speed ${playerSpeed} should reflect 1.8x multiplier`);

  // Damage obstacle and test sandbox_respawn_obstacles
  room.match.duel.obstacles[0].hp = 1;
  player.send({ type: 'sandbox_respawn_obstacles' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(room.match.duel.obstacles[0].hp, room.match.duel.obstacles[0].maxHp);

  // Finish duel by knocking out defender
  room.match.duel.defender.hp = 0;
  room.match.duel.isFinished = true;
  room.match.duel.winner = 'w';
  server.roomManager.tick(Date.now() + 600);
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.phase, 'duel_result');

  // Verify standalone duel holds in duel_result without mutating preDuelFen
  server.roomManager.tick(Date.now() + 10000);
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.phase, 'duel_result');
  assert.equal(snap?.fen, preDuelFen);

  // Reset duel back to active_duel
  player.send({ type: 'sandbox_reset_duel' });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.phase, 'active_duel');
  assert.equal(snap?.duelSnapshot?.attacker.hp, 100);
  assert.equal(snap?.duelSnapshot?.defender.hp, 100);

  // Exit duel back to chess_turn with original board state preserved
  player.send({ type: 'sandbox_exit_duel' });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.phase, 'chess_turn');
  assert.equal(snap?.duelSnapshot, null);
  assert.equal(snap?.fen, preDuelFen);

  // ---------------------------------------------------------------------------
  // 6. User Plays Both Sides in Chess Turns (No Bot Auto-Move Interference)
  // ---------------------------------------------------------------------------
  // Set back standard initial FEN
  player.send({
    type: 'sandbox_set_fen',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  });
  await new Promise(r => setTimeout(r, 20));

  // Play White move e2-e4
  player.send({
    type: 'chess_move_intent',
    from: 'e2',
    to: 'e4',
    actionId: 'sb_chess_1',
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.turn, 'b');

  // Tick room: Bot should NOT make an automated move
  server.roomManager.tick(Date.now() + 2000);
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.turn, 'b', 'Turn must remain Black in sandbox mode without auto-play');

  // Player can make the Black move as well (e.g. e7-e5)
  player.send({
    type: 'chess_move_intent',
    from: 'e7',
    to: 'e5',
    actionId: 'sb_chess_2',
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.turn, 'w');
  assert.deepEqual(getPieceAt(snap!.fen, 'e5'), { color: 'b', pieceClass: 'pawn' });

  // ---------------------------------------------------------------------------
  // 7. Free Placement Capture Duel & Board Reconciliation
  // ---------------------------------------------------------------------------
  // Switch to Free Placement (rulesEnforced: false)
  player.send({
    type: 'sandbox_update_config',
    config: { rulesEnforced: false },
  });
  await new Promise(r => setTimeout(r, 20));

  // Move White Knight from b1 onto Black Pawn at d7 (non-standard chess capture)
  player.send({
    type: 'chess_move_intent',
    from: 'b1',
    to: 'd7',
    actionId: 'sb_free_cap_1',
  });
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.phase, 'duel_intro');

  // Progress into active duel
  server.roomManager.tick(Date.now() + 2000);
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.phase, 'active_duel');

  // Attacker knocks out defender
  room.match.duel!.defender.hp = 0;
  room.match.duel!.isFinished = true;
  room.match.duel!.winner = 'w';
  server.roomManager.tick(Date.now() + 3000);
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.phase, 'duel_result');

  // Reconcile duel onto the board after duel_result duration
  server.roomManager.tick(Date.now() + 10000);
  await new Promise(r => setTimeout(r, 20));
  snap = player.getSnapshot();
  assert.equal(snap?.phase, 'chess_turn');
  assert.equal(getPieceAt(snap!.fen, 'b1'), null);
  assert.deepEqual(getPieceAt(snap!.fen, 'd7'), { color: 'w', pieceClass: 'knight' });
});
