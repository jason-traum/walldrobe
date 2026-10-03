// A wall with a corner or a step: each section gets its own group, judged as one wall.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, refill, wallSections } from '../engine/index.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';
import { assertLayoutValid } from './helpers.js';

const cat = testCatalog();
const taste = testTaste(cat);
const EDGE = 45.5;
const owned = [
  { id: 'london', title: 'london poster', w: 18, h: 24, keep: 'must', at: { x: 74, y: 60 } },
  { id: 'chair', title: 'chair photo', w: 14, h: 21, keep: 'must', at: { x: 56, y: 38 } },
  { id: 'map', title: 'map', w: 14, h: 11, keep: 'must', at: { x: 74, y: 46 } },
];
const input = (o = {}) => ({
  wall: { width: 120, height: 96 },
  obstacles: [{ id: 'corner', kind: 'edge', x: EDGE, y: 0, w: 1, h: 96 }, { id: 'bed', kind: 'headboard', x: 30, y: 0, w: 70, h: 14 }],
  owned, catalog: cat, taste, count: 24, ...o,
});
const crosses = (p) => p.x < EDGE + 1 && p.x + p.w > EDGE;
const both = (L) => L.pieces.some((p) => p.x + p.w <= EDGE) && L.pieces.some((p) => p.x >= EDGE + 1);

test('wallSections() splits the wall at each wall edge', () => {
  assert.deepEqual(wallSections(input()), [{ x0: 0, x1: 46 }, { x0: 46, x1: 120 }]);
  assert.deepEqual(wallSections({ wall: { width: 100, height: 96 }, obstacles: [] }), [{ x0: 0, x1: 100 }]);
});

test('a wall with an edge gets walls with art on both sides of it, none across it', () => {
  const r = layout(input());
  const sec = r.layouts.filter((L) => L.variant === 'sections');
  assert.ok(sec.length >= 2, `only ${sec.length} section walls`);
  for (const L of sec) {
    assert.ok(both(L), `${L.key} has art on both sides`);
    assertLayoutValid(input(), L);
    assert.ok(!L.pieces.some(crosses), `${L.key} crosses the edge`);
    const ids = L.pieces.map((p) => p.ref.id);
    assert.equal(new Set(ids).size, ids.length, 'no print twice');
    for (const o of owned) assert.ok(ids.includes(o.id), `${o.id} is on ${L.key}`);
  }
});

test('the same wall gives the same section walls every time', () => {
  const a = layout(input()).layouts.filter((L) => L.variant === 'sections').map((L) => L.key);
  const b = layout(input()).layouts.filter((L) => L.variant === 'sections').map((L) => L.key);
  assert.deepEqual(a, b);
});

test('a swap on a section wall changes only that piece', () => {
  const L = layout(input()).layouts.find((x) => x.variant === 'sections');
  const p = L.pieces.find((x) => x.ref.source === 'catalog');
  const R = refill(input(), L, { swap: p.ref.id }).layouts[0];
  assert.ok(R, 'a wall comes back');
  assertLayoutValid(input(), R);
  const rest = (X, id) => X.pieces.filter((x) => x.ref.id !== id).map((x) => `${x.ref.id}@${x.x},${x.y}`).sort();
  const came = R.pieces.find((x) => !L.pieces.some((y) => y.ref.id === x.ref.id));
  assert.ok(came, 'a new print is in the spot');
  assert.deepEqual(rest(R, came.ref.id), rest(L, p.ref.id));
});

test('an exact piece count skips sections (one group, as before)', () => {
  const r = layout(input({ prefs: { pieces: 5 } }));
  assert.ok(!r.layouts.some((L) => L.variant === 'sections'));
});
