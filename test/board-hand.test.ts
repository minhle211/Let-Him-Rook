import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is tested directly.
import { boardSquare, BoardHandController } from '../public/board-hand.mjs';
const context = () => ({ enabled: true, canMove: true, roomId: 'ROOM', revision: 0, color: 'white', legalMoves: { 12: [20, 28] } });
const at = (square: number) => ({ x: 0.1 + (square % 8 + 0.5) / 8 * 0.8, y: 0.1 + (7 - Math.floor(square / 8) + 0.5) / 8 * 0.8 });
test('maps both board orientations and rejects points outside the control area', () => {
  assert.equal(boardSquare(at(12), 'white'), 12);
  assert.equal(boardSquare(at(12), 'black'), 51);
  assert.equal(boardSquare({x:0.05,y:0.5}, 'white'), null);
  assert.equal(boardSquare({x:NaN,y:0.5}, 'white'), null);
});
test('grab and release sends one legal move, preserving the pre-release target', () => {
  const c = new BoardHandController(), ctx = context();
  c.update('hover', at(12), ctx);
  c.update('start', at(12), ctx);
  assert.equal(c.grab.from, 12);
  c.update('draw', at(28), ctx);
  c.update('hold', at(29), ctx);
  assert.deepEqual(c.update('end', at(29), ctx), {from:12,to:28,revision:0});
  assert.equal(c.update('end', at(28), ctx), null);
});
test('invalid destinations, outside release, and empty grabs cancel', () => {
  const c = new BoardHandController(), ctx = context();
  c.update('start', at(12), ctx); c.update('draw', at(13), ctx);
  assert.equal(c.update('end', at(13), ctx), null); assert.equal(c.grab, null);
  c.update('start', at(12), ctx); c.update('draw', {x:0,y:0}, ctx);
  assert.equal(c.update('end', {x:0,y:0}, ctx), null);
  c.update('start', at(20), ctx); c.update('draw', at(28), ctx);
  assert.equal(c.update('end', at(28), ctx), null);
});
test('tracking loss, turn changes, disconnects, and stale board state cancel grabs', () => {
  for (const changed of [{canMove:false}, {enabled:false}, {revision:1}, {roomId:'OTHER'}, {color:'black'}]) {
    const c = new BoardHandController(), ctx = context();
    c.update('start', at(12), ctx); c.update('draw', at(28), ctx);
    assert.equal(c.update('end', at(28), {...ctx,...changed}), null);
    assert.equal(c.grab, null);
  }
  const c = new BoardHandController(), ctx = context();
  c.update('start', at(12), ctx); c.update('cancel', null, ctx);
  assert.equal(c.update('end', at(28), ctx), null);
});
test('small boundary jitter keeps a target but deliberate crossing changes it', () => {
  const edge = {x:0.1 + 5 / 8 * 0.8, y:at(12).y};
  assert.equal(boardSquare({...edge,x:edge.x + 0.005}, 'white', 12), 12);
  assert.equal(boardSquare({...edge,x:edge.x + 0.02}, 'white', 12), 13);
});
