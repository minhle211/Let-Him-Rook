import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module is tested directly without a build step.
import { recognize, resample, PinchTracker, MenuPinchController } from '../public/recognizer.mjs';
test('recognizes lines in either direction and rejects tiny movement', () => {
  const line = Array.from({length: 30}, (_, i) => ({x: 0.1 + i / 40, y: 0.2 + i / 80}));
  assert.equal(recognize(line), 'attack');
  assert.equal(recognize(line.reverse()), 'attack');
  assert.equal(recognize(line.map(p => ({x: p.x / 100, y: p.y / 100}))), null);
  assert.equal(recognize(Array(20).fill({x: 0.5, y: 0.5})), null);
});
test('recognizes circles both ways, rejects open arcs and scribbles', () => {
  const circle = Array.from({length: 64}, (_, i) => ({x: 0.5 + 0.25 * Math.cos(i / 63 * Math.PI * 2), y: 0.5 + 0.25 * Math.sin(i / 63 * Math.PI * 2)}));
  assert.equal(recognize(circle), 'defense'); assert.equal(recognize([...circle].reverse()), 'defense');
  assert.equal(recognize(circle.slice(0, 40)), null);
  assert.equal(recognize([...circle, ...circle]), null);
});
test('recognizes Z and reverse Z with uneven sampling, rejects V', () => {
  const z = resample([{x: 0.1, y: 0.1}, {x: 0.8, y: 0.1}, {x: 0.1, y: 0.8}, {x: 0.8, y: 0.8}], 80);
  assert.equal(recognize(z), 'special'); assert.equal(recognize([...z].reverse()), 'special');
  assert.equal(recognize(resample([{x:0, y:0}, {x:0.5, y:1}, {x:1, y:0}])), null);
});

test('fast lines and slightly shaky lines are accepted', () => {
  assert.equal(recognize([{x:0.1,y:0.2},{x:0.4,y:0.22},{x:0.8,y:0.2}]), 'attack');
  const line = Array.from({length: 35}, (_, i) => ({x: 0.1 + i * 0.02, y: 0.4 + Math.sin(i * 2) * 0.009}));
  assert.equal(recognize(line), 'attack');
  assert.equal(recognize(resample([{x:0,y:0},{x:0.5,y:0.4},{x:1,y:0}])), null);
});
test('wide and tall Z strokes tolerate hand jitter', () => {
  for (const height of [0.3, 0.7]) {
    const points = resample([{x:0.1,y:0.1},{x:0.8,y:0.12},{x:0.12,y:0.1+height},{x:0.79,y:0.12+height}], 60);
    const noisy = points.map((p: {x:number;y:number}, i:number) => ({x:p.x+Math.sin(i)*0.005, y:p.y+Math.cos(i)*0.005}));
    assert.equal(recognize(noisy), 'special');
    assert.equal(recognize([...noisy].reverse()), 'special');
  }
});
test('pinch release waits for sustained opening and ignores brief opening spikes', () => {
  const t = new PinchTracker();
  assert.equal(t.update(0.2, 0), 'hover');
  t.update(0.9, 10); assert.equal(t.update(0.3, 20), 'start');
  assert.equal(t.update(0.6, 30), 'draw');
  assert.equal(t.update(0.9, 40), 'hold');
  assert.equal(t.update(0.4, 100), 'draw');
  assert.equal(t.update(0.9, 110), 'hold');
  assert.equal(t.update(0.9, 200), 'hold');
  assert.equal(t.update(0.9, 240), 'end');
  assert.equal(t.update(0.9, 250), 'hover');
});
test('short tracking loss preserves pinch; long loss cancels and requires reopening', () => {
  const t = new PinchTracker();
  t.update(0.9, 0); t.update(0.2, 10);
  assert.equal(t.update(NaN, 150), 'hold');
  assert.equal(t.update(0.2, 200), 'draw');
  assert.equal(t.update(NaN, 510), 'cancel');
  assert.equal(t.update(0.2, 520), 'hover');
  t.update(0.9, 530); assert.equal(t.update(0.2, 540), 'start');
  assert.equal(t.update(0.2, 900), 'cancel');
});

test('menu pinch clicks once and ignores held pinches and repeat releases', () => {
  const menu = new MenuPinchController();
  assert.equal(menu.update('start', 'create', 0), null);
  assert.equal(menu.update('hold', 'create', 100), null);
  assert.equal(menu.update('end', 'create', 200), 'create');
  assert.equal(menu.update('end', 'create', 210), null);
  menu.update('start', 'create', 300);
  assert.equal(menu.update('end', 'create', 400), null);
  menu.update('start', 'join', 800);
  assert.equal(menu.update('end', 'join', 1000), 'join');
});
test('menu drag-off, disabled targets, tracking loss, and long pinches cancel', () => {
  for (const action of ['draw', 'cancel']) {
    const menu = new MenuPinchController();
    menu.update('start', 'create', 0);
    menu.update(action, null, 100);
    assert.equal(menu.update('end', 'create', 200), null);
  }
  const menu = new MenuPinchController();
  menu.update('start', 'create', 0);
  assert.equal(menu.update('end', null, 100), null);
  menu.update('start', 'create', 200);
  assert.equal(menu.update('end', 'create', 1800), null);
});
