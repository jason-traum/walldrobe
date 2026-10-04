// A whole home: your pieces split across the walls before each wall is laid out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignHome } from '../engine/home.js';

const walls = [
  { id: 'living', width: 150, height: 96 },
  { id: 'bed', width: 120, height: 96, tone: 'cool' },
  { id: 'hall', width: 40, height: 96, tone: 'warm' },
];
const piece = (id, w, h, hex) => ({ id, w, h, palette: hex ? [{ hex, weight: 1 }] : [] });

test('the biggest piece goes on the main wall', () => {
  const r = assignHome(walls, [piece('small', 11, 14), piece('big', 36, 48), piece('mid', 16, 20)]);
  assert.ok(r.byWall.living.includes('big'));
});

test('every piece goes somewhere once, and one too big for every wall is said so', () => {
  const ps = [piece('a', 24, 36), piece('b', 16, 20), piece('c', 11, 14), piece('d', 8, 10), piece('huge', 140, 80)];
  const r = assignHome(walls, ps);
  const placed = Object.values(r.byWall).flat();
  assert.deepEqual(new Set([...placed, ...r.unplaced]), new Set(ps.map((p) => p.id)));
  assert.equal(placed.length, new Set(placed).size);
  assert.deepEqual(r.unplaced, ['huge']);
});

test('a narrow hall only gets what fits it', () => {
  const r = assignHome(walls, [piece('wide', 40, 30), piece('tall', 11, 14)]);
  assert.ok(!r.byWall.hall.includes('wide'));
});

test('a warm piece leans to the warm wall, a cool one to the cool wall', () => {
  const r = assignHome(walls, [piece('main', 30, 40), piece('orange', 11, 14, '#D9622B'), piece('blue', 11, 14, '#2B5CD9')]);
  assert.ok(r.byWall.hall.includes('orange'), JSON.stringify(r.byWall));
  assert.ok(r.byWall.bed.includes('blue'), JSON.stringify(r.byWall));
});

test('the same input gives the same split', () => {
  const ps = [piece('a', 24, 36, '#334455'), piece('b', 16, 20, '#AA8844'), piece('c', 11, 14), piece('d', 8, 10)];
  assert.deepEqual(assignHome(walls, ps), assignHome(walls, ps));
});
