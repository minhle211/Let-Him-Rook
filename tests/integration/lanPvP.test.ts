import test from 'node:test';
import assert from 'node:assert/strict';
import { RookServer } from '../../apps/server/src/ws/wsServer.ts';
import { MatchMachine } from '../../apps/server/src/match/matchMachine.ts';
import type { ServerMessage } from '@let-him-rook/shared';

function connect(port: number): Promise<{ ws: WebSocket; messages: ServerMessage[]; waitFor: (predicate: (m: ServerMessage) => boolean) => Promise<ServerMessage> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: ServerMessage[] = [];
    const waiters: Array<{ predicate: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
    const waitFor = (predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> => {
      const found = messages.find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise(resolve => waiters.push({ predicate, resolve }));
    };
    ws.addEventListener('open', () => resolve({ ws, messages, waitFor }), { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      messages.push(message);
      for (const waiter of [...waiters]) if (waiter.predicate(message)) {
        waiter.resolve(message);
        waiters.splice(waiters.indexOf(waiter), 1);
      }
    });
  });
}

test('real WebSockets play opposite first moves with the same action ID', async () => {
  const server = new RookServer();
  const port = await server.start(0, '127.0.0.1');
  const sockets: WebSocket[] = [];
  try {
    const white = await connect(port); sockets.push(white.ws);
    white.ws.send(JSON.stringify({ type: 'create_room', mode: 'pvp' }));
    const joined = await white.waitFor(m => m.type === 'room_joined');
    assert.equal(joined.type, 'room_joined');
    const black = await connect(port); sockets.push(black.ws);
    black.ws.send(JSON.stringify({ type: 'join_room', roomId: joined.roomId }));
    const blackJoined = await black.waitFor(m => m.type === 'room_joined');
    assert.equal(blackJoined.type, 'room_joined');
    white.ws.send(JSON.stringify({ type: 'calibration_ready', ready: true }));
    black.ws.send(JSON.stringify({ type: 'calibration_ready', ready: true }));
    await white.waitFor(m => m.type === 'snapshot' && m.snapshot.phase === 'chess_turn');
    white.ws.send(JSON.stringify({ type: 'chess_move_intent', from: 'e2', to: 'e4', actionId: 'move_1' }));
    await black.waitFor(m => m.type === 'snapshot' && m.snapshot.turn === 'b');
    black.ws.send(JSON.stringify({ type: 'chess_move_intent', from: 'd7', to: 'd5', actionId: 'move_1' }));
    const after = await white.waitFor(m => m.type === 'snapshot' && m.snapshot.fen.includes('3p4/4P3'));
    assert.equal(after.type, 'snapshot');
    assert.match(after.snapshot.fen, /3p4\/4P3/);
    white.ws.send(JSON.stringify({ type: 'chess_move_intent', from: 'e4', to: 'd5', actionId: 'capture' }));
    await black.waitFor(m => m.type === 'snapshot' && m.snapshot.phase === 'duel_intro');
    black.ws.close();
    await white.waitFor(m => m.type === 'snapshot' && m.snapshot.paused);
    const returned = await connect(port); sockets.push(returned.ws);
    returned.ws.send(JSON.stringify({ type: 'reconnect_room', roomId: joined.roomId, token: blackJoined.token }));
    await returned.waitFor(m => m.type === 'room_joined');
    await white.waitFor(m => m.type === 'snapshot' && !m.snapshot.paused && m.snapshot.phase === 'duel_intro' && m.snapshot.players.b.connected);
  } finally {
    for (const socket of sockets) socket.close();
    await server.stop();
  }
});

test('PvP pause freezes duel time and resumes without a large simulation step', () => {
  const match = new MatchMachine('PAUSE', 'pvp');
  const at = Date.now();
  match.setPlayerConnected('w', true, at);
  match.setPlayerConnected('b', true, at);
  match.setCalibrationReady('w', true);
  match.setCalibrationReady('b', true);
  match.handleChessMove('w', 'e2', 'e4', undefined, 'same', at);
  assert.equal(match.handleChessMove('b', 'd7', 'd5', undefined, 'same', at + 50).accepted, true);
  assert.equal(match.turn, 'w');
  match.handleChessMove('w', 'e4', 'd5', undefined, 'capture', at + 100);
  match.tick(at + 2200);
  assert.equal(match.phase, 'active_duel');
  match.setPlayerConnected('b', false, at + 2250);
  const frozen = match.getSnapshot(at + 5000);
  match.tick(at + 5000);
  assert.equal(match.phase, 'active_duel');
  assert.equal(match.getSnapshot(at + 5000).simulationTime, frozen.simulationTime);
  assert.equal(match.getSnapshot(at + 5000).duelSnapshot?.remainingMs, frozen.duelSnapshot?.remainingMs);
  match.setPlayerConnected('b', true, at + 5000);
  match.tick(at + 5050);
  assert.equal(match.paused, false);
  assert.equal(match.phase, 'active_duel');
});
