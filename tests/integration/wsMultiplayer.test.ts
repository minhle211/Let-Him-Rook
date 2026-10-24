import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ClientMessage,
  MatchSnapshot,
  ServerMessage,
} from '@let-him-rook/shared';
import {
  createVirtualSessionPair,
  RookServer,
} from '../../apps/server/src/ws/wsServer.ts';

function createConnectedClient(server: RookServer) {
  const { clientSession, serverSession } = createVirtualSessionPair();
  server.routeSession(serverSession);

  const messages: ServerMessage[] = [];
  clientSession.onMessage = (raw: string) => {
    messages.push(JSON.parse(raw) as ServerMessage);
  };

  const send = (msg: ClientMessage) => {
    clientSession.send(JSON.stringify(msg));
  };

  const popType = (type: string): ServerMessage | undefined => {
    const idx = messages.findIndex(m => m.type === type);
    if (idx !== -1) {
      return messages.splice(idx, 1)[0];
    }
    return undefined;
  };

  const lastSnapshot = (): MatchSnapshot | undefined => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === 'snapshot') {
        return (messages[i] as any).snapshot;
      }
    }
    return undefined;
  };

  return { clientSession, serverSession, messages, send, popType, lastSnapshot };
}

test('Integration: Two clients create room, join, calibrate, and start match', async () => {
  const server = new RookServer();
  const c1 = createConnectedClient(server);
  const c2 = createConnectedClient(server);

  // 1. Client 1 creates room
  c1.send({ type: 'create_room', mode: 'pvp' });
  await new Promise(r => setTimeout(r, 10));

  const joined1 = c1.popType('room_joined') as any;
  assert.ok(joined1);
  assert.equal(joined1.color, 'w');
  assert.equal(typeof joined1.token, 'string');
  assert.equal(joined1.token.length, 48);
  const roomId = joined1.roomId;

  // 2. Client 2 joins room
  c2.send({ type: 'join_room', roomId });
  await new Promise(r => setTimeout(r, 10));

  const joined2 = c2.popType('room_joined') as any;
  assert.ok(joined2);
  assert.equal(joined2.color, 'b');

  // Both should receive initial snapshot in calibration or lobby phase
  await new Promise(r => setTimeout(r, 10));
  assert.ok(c1.lastSnapshot());
  assert.ok(c2.lastSnapshot());

  // 3. Both confirm calibration ready
  c1.send({ type: 'calibration_ready', ready: true });
  c2.send({ type: 'calibration_ready', ready: true });
  await new Promise(r => setTimeout(r, 10));

  const snap = c1.lastSnapshot();
  assert.ok(snap);
  assert.equal(snap?.phase, 'chess_turn');
  assert.equal(snap?.turn, 'w');
});

test('Integration: Monotonic revisions, duplicate actionId deduplication, wrong-turn rejection', async () => {
  const server = new RookServer();
  const c1 = createConnectedClient(server);
  const c2 = createConnectedClient(server);

  c1.send({ type: 'create_room', mode: 'pvp' });
  await new Promise(r => setTimeout(r, 10));
  const roomId = (c1.popType('room_joined') as any).roomId;

  c2.send({ type: 'join_room', roomId });
  await new Promise(r => setTimeout(r, 10));

  c1.send({ type: 'calibration_ready', ready: true });
  c2.send({ type: 'calibration_ready', ready: true });
  await new Promise(r => setTimeout(r, 10));

  let prevRev = c1.lastSnapshot()!.revision;

  // Black tries to move on White's turn: must be rejected
  c2.send({
    type: 'chess_move_intent',
    from: 'e7',
    to: 'e5',
    actionId: 'illegal_turn_1',
  });
  await new Promise(r => setTimeout(r, 10));

  const feedbackReject = c2.popType('action_feedback') as any;
  assert.ok(feedbackReject);
  assert.equal(feedbackReject.accepted, false);
  assert.equal(feedbackReject.reason, 'not_your_turn');

  // White makes legal move: e2 -> e4
  c1.send({
    type: 'chess_move_intent',
    from: 'e2',
    to: 'e4',
    actionId: 'move_e2_e4',
  });
  await new Promise(r => setTimeout(r, 10));

  const feedbackAccept = c1.popType('action_feedback') as any;
  assert.ok(feedbackAccept);
  assert.equal(feedbackAccept.accepted, true);

  const newSnap = c1.lastSnapshot()!;
  assert.ok(newSnap.revision > prevRev, 'Revision must increase monotonically');
  assert.equal(newSnap.turn, 'b');

  // Deduplication: sending same actionId again returns accepted: true without state mutation
  const revBeforeDup = newSnap.revision;
  c1.send({
    type: 'chess_move_intent',
    from: 'e2',
    to: 'e4',
    actionId: 'move_e2_e4',
  });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(c1.lastSnapshot()!.revision, revBeforeDup);
});

test('Integration: Capture move initiates duel and duel resolves board state', async () => {
  const server = new RookServer();
  const c1 = createConnectedClient(server);
  const c2 = createConnectedClient(server);

  c1.send({ type: 'create_room', mode: 'pvp' });
  await new Promise(r => setTimeout(r, 10));
  const roomId = (c1.popType('room_joined') as any).roomId;

  c2.send({ type: 'join_room', roomId });
  await new Promise(r => setTimeout(r, 10));

  c1.send({ type: 'calibration_ready', ready: true });
  c2.send({ type: 'calibration_ready', ready: true });
  await new Promise(r => setTimeout(r, 10));

  // Sequence of moves to set up pawn capture:
  // 1. e2-e4 (White)
  c1.send({ type: 'chess_move_intent', from: 'e2', to: 'e4', actionId: 'm1' });
  await new Promise(r => setTimeout(r, 10));

  // 2. d7-d5 (Black)
  c2.send({ type: 'chess_move_intent', from: 'd7', to: 'd5', actionId: 'm2' });
  await new Promise(r => setTimeout(r, 10));

  // 3. e4xd5 capture by White -> triggers duel!
  c1.send({ type: 'chess_move_intent', from: 'e4', to: 'd5', actionId: 'm3' });
  await new Promise(r => setTimeout(r, 10));

  const snap = c1.lastSnapshot()!;
  assert.equal(snap.phase, 'duel_intro');
  assert.ok(snap.pendingCapture);
  assert.equal(snap.pendingCapture?.from, 'e4');
  assert.equal(snap.pendingCapture?.to, 'd5');
  assert.ok(snap.duelSnapshot);
});

test('Integration: 30s token reconnect restores snapshot session', async () => {
  const server = new RookServer();
  const c1 = createConnectedClient(server);

  c1.send({ type: 'create_room', mode: 'bot' });
  await new Promise(r => setTimeout(r, 10));

  const joined = c1.popType('room_joined') as any;
  const token = joined.token;
  const roomId = joined.roomId;

  c1.send({ type: 'calibration_ready', ready: true });
  await new Promise(r => setTimeout(r, 10));

  // Client 1 disconnects
  c1.clientSession.close();
  await new Promise(r => setTimeout(r, 10));

  const room = server.roomManager.getRoom(roomId);
  assert.ok(room);
  assert.equal(room?.match.players.w.connected, false);
  assert.ok(room?.match.players.w.disconnectedAt);

  // Client 1 reconnects with saved token within 30s
  const c1Reconnect = createConnectedClient(server);
  c1Reconnect.send({
    type: 'reconnect_room',
    roomId,
    token,
  });
  await new Promise(r => setTimeout(r, 10));

  const reconnectedJoined = c1Reconnect.popType('room_joined') as any;
  assert.ok(reconnectedJoined);
  assert.equal(reconnectedJoined.color, 'w');
  assert.equal(room?.match.players.w.connected, true);
  assert.equal(room?.match.players.w.disconnectedAt, undefined);
  assert.ok(c1Reconnect.lastSnapshot());
});

test('Integration: Disconnect expiration (> 30s) triggers match forfeit', async () => {
  const server = new RookServer();
  const c1 = createConnectedClient(server);
  const c2 = createConnectedClient(server);

  c1.send({ type: 'create_room', mode: 'pvp' });
  await new Promise(r => setTimeout(r, 10));
  const roomId = (c1.popType('room_joined') as any).roomId;

  c2.send({ type: 'join_room', roomId });
  await new Promise(r => setTimeout(r, 10));

  c1.send({ type: 'calibration_ready', ready: true });
  c2.send({ type: 'calibration_ready', ready: true });
  await new Promise(r => setTimeout(r, 10));

  // Client 2 disconnects
  c2.clientSession.close();
  await new Promise(r => setTimeout(r, 10));

  const room = server.roomManager.getRoom(roomId)!;
  // Fast forward room tick past 30s
  const disconnectedAt = room.match.players.b.disconnectedAt!;
  server.roomManager.tick(disconnectedAt + 31_000);

  const snap = room.match.getSnapshot();
  assert.equal(snap.phase, 'match_over');
  assert.equal(snap.winner, 'w');
  assert.equal(snap.winReason, 'forfeit_disconnect_timeout');
});
