// A wall whose new pieces are all one subject ranks a little lower than the same wall
// with mixed subjects, so walls don't lean on what the catalog has most of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreArrangement, layout } from '../engine/index.js';
import { testCatalog } from '../fixtures/catalog.js';

test('all one subject costs a little; mixed subjects cost nothing', () => {
  const base = testCatalog();
  const L = layout({ wall: { width: 120, height: 96 }, obstacles: [], catalog: base, count: 6 }).layouts.find((x) => x.pieces.length >= 3);
  assert.ok(L, 'a wall with three or more pieces');
  const placed = L.pieces.map((p) => ({ id: p.ref.id, x: p.x, y: p.y, w: p.w, h: p.h }));
  const ids = new Set(placed.map((p) => p.id));
  const score = (catOf) => scoreArrangement({ wall: { width: 120, height: 96 }, obstacles: [], catalog: base.map((c) => (ids.has(c.id) ? { ...c, category: catOf(c) } : c)) }, placed).score;
  let i = 0;
  const same = score(() => 'flowers');
  const mixed = score(() => ['flowers', 'horses', 'city', 'surf', 'coffee', 'moon', 'dogs', 'sky'][i++ % 8]);
  // The subject spread term is 0.03; look-alikes (which compare subjects too) add to it.
  assert.ok(mixed - same >= 0.03, `mixed ${mixed} vs same ${same}`);
});
