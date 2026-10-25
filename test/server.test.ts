import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.ts';

test('two clients join, authenticate, stream, move, and reject stale commands', async () => {
  const { server } = createApp(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, token = '', data = {}) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    for (const [asset, contentType] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css'], ['/gestures.js', 'text/javascript'], ['/board-hand.mjs', 'text/javascript'], ['/recognizer.mjs', 'text/javascript'], ['/hand-worker.js', 'text/javascript']]) {
      const response = await fetch(base + asset);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type')?.startsWith(contentType));
      assert.ok((await response.text()).length > 0);
    }
    assert.equal((await fetch(base + '/src/server.ts')).status, 404);
    const first = await (await post('/rooms')).json(); const path = `/rooms/${first.roomId}`;
    assert.deepEqual(first.legalMoves[12], [20, 28]);
    assert.equal((await post(path + '/move', first.token, { from: 12, to: 28, revision: 0 })).status, 400);
    const second = await (await post(path + '/join')).json(); assert.equal(second.color, 'black');
    assert.equal((await post(path + '/join')).status, 409);
    assert.equal((await post(path + '/move', 'invalid')).status, 401);
    const stream = await fetch(base + path + '/events', { headers: { Authorization: `Bearer ${second.token}` } });
    reader = stream.body!.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /"ready":true/);
    assert.equal((await post(path + '/move', first.token, { from: 12, to: 28, revision: 0 })).status, 200);
    assert.match(new TextDecoder().decode((await reader.read()).value), /"turn":"black"/);
    assert.equal((await post(path + '/move', first.token, { from: 12, to: 28, revision: 0 })).status, 409);
    const response = await post(path + '/move', second.token, { from: 51, to: 35, revision: 1 });
    assert.equal(response.status, 200); assert.equal((await response.json()).game.turn, 'white');
    const battleResponse = await post(path + '/move', first.token, { from: 28, to: 35, revision: 2 });
    const battle = (await battleResponse.json()).game.battle;
    assert.ok(battle.id);
    const spell = { battleId: battle.id, commandId: 'first-attack', spell: 'attack' };
    assert.equal((await post(path + '/cast', first.token, spell)).status, 200);
    const retry = await (await post(path + '/cast', first.token, spell)).json();
    assert.equal(retry.game.battle.projectiles.length, 1);
    assert.equal((await post(path + '/cast', second.token, { ...spell, spell: 'defense' })).status, 200);
    assert.equal((await post(path + '/cast', first.token, { ...spell, commandId: 'second-attack' })).status, 400);
  } finally { await reader?.cancel(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('solo room starts ready, reserves Black for the bot, and streams its reply', { timeout: 8000 }, async () => {
  const { server } = createApp(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, token = '', data = {}) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    assert.equal((await post('/rooms', '', {mode:'unknown'})).status, 400);
    const roomResponse = await post('/rooms', '', {mode:'bot'});
    assert.equal(roomResponse.status, 201);
    const room = await roomResponse.json(), path = `/rooms/${room.roomId}`;
    assert.equal(room.mode, 'bot'); assert.equal(room.ready, true); assert.equal(room.color, 'white');
    assert.equal((await post(path + '/join')).status, 409);
    const stream = await fetch(base + path + '/events', {headers: {Authorization: `Bearer ${room.token}`}, signal: AbortSignal.timeout(5000)});
    reader = stream.body!.getReader();
    await reader.read(); // Initial snapshot.
    assert.equal((await post(path + '/move', room.token, {from:12,to:28,revision:0})).status, 200);
    const decoder = new TextDecoder(); let buffer = '', replied = false;
    while (!replied) {
      const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (chunk.done) throw new Error('Stream ended before bot replied');
      buffer += decoder.decode(chunk.value, {stream:true});
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const message = buffer.slice(0,boundary); buffer = buffer.slice(boundary+2);
        if (!message.startsWith('data: ')) continue;
        const snapshot = JSON.parse(message.slice(6));
        if (snapshot.game.revision >= 2) {
          assert.equal(snapshot.game.turn, 'white');
          assert.equal(snapshot.game.phase, 'board'); assert.equal(snapshot.mode, 'bot');
          replied = true;
        }
      }
    }
    const refreshed = await (await fetch(base + path, {headers:{Authorization:`Bearer ${room.token}`}})).json();
    assert.equal(refreshed.mode, 'bot'); assert.equal(refreshed.game.revision, 2);
  } finally {
    await reader?.cancel().catch(() => {});
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
