// Jason's real wall as the live app's photo reader read it: seven pieces he keeps,
// a bed, a dresser and a lamp. Every wall should hold all seven when they fit,
// leave out as few as possible (smallest first) when they don't, and always offer
// the wall as it hangs now.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../engine/index.js';
import { canPack, openSpace } from '../engine/flow.js';
import { blockedRegions } from '../engine/geometry.js';
import { jasonRead, scaled } from '../fixtures/jason_read.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';
import { assertLayoutValid } from './helpers.js';

const catalog = testCatalog();
const taste = testTaste(catalog);
const ids = jasonRead.owned.map((p) => p.id);
const holdsAll = (L) => ids.every((id) => L.pieces.some((p) => p.ref.id === id));
const area = (id, w) => { const p = w.owned.find((o) => o.id === id); return p.w * p.h; };

for (const [name, wall] of [['12% smaller sizes', scaled(0.88)], ['the sizes as read', jasonRead]]) {
  test(`${name}: every wall holds all seven pieces, and passes the hard rules`, () => {
    const input = { ...wall, catalog, taste, count: 24 };
    const r = layout(input);
    const walls = r.layouts.filter((L) => L.variant !== 'asis');
    assert.ok(walls.length >= 3, `${walls.length} walls: ${r.problems.map((p) => p.code).join()}`);
    assert.ok(walls.some((L) => L.pieces.every((p) => p.ref.source === 'owned')), 'one wall is just his seven');
    for (const L of walls) {
      assert.ok(holdsAll(L), `${L.key} holds ${L.pieces.filter((p) => p.ref.source === 'owned').length} of 7`);
      assertLayoutValid(input, L);
    }
  });
}

test('the sizes as read: leaving out the fewest leaves nothing out when all seven fit', () => {
  const r = layout({ ...jasonRead, catalog: [], count: 12, prefs: { dropFewest: true } });
  assert.ok(r.layouts.some((L) => L.variant !== 'asis'));
  for (const L of r.layouts) { assert.ok(holdsAll(L)); assert.equal(L.dropped, undefined); }
});

test('too big to all fit: the fewest are left out, the smallest first, each one explained', () => {
  const big = scaled(1.12);
  const space = openSpace(big.wall, blockedRegions(big.obstacles));
  assert.equal(canPack({ obstacles: big.obstacles, space, pieces: big.owned }), false);
  const input = { ...big, catalog: [], count: 12 };
  // Without asking, nothing but the wall as it hangs, and a plain reason.
  const plain = layout(input);
  assert.deepEqual(plain.layouts.map((L) => L.variant), ['asis']);
  assert.equal(plain.problems[0].code, 'MUSTS_DONT_FIT');
  const r = layout({ ...input, prefs: { dropFewest: true } });
  assert.equal(r.problems[0].code, 'LEFT_OUT');
  const walls = r.layouts.filter((L) => L.variant !== 'asis');
  assert.ok(walls.length >= 3);
  for (const L of walls) {
    assert.ok(L.dropped.length >= 1 && L.dropped.length <= 2, `left out ${L.dropped}`);
    const own = L.pieces.filter((p) => p.ref.source === 'owned').length;
    assert.equal(own, 7 - L.dropped.length);
    for (const id of L.dropped) {
      const left = L.left.find((l) => l.id === id);
      assert.ok(left && left.dropped && /don't fit on this wall together/.test(left.reason), left && left.reason);
    }
    assertLayoutValid({ ...input, owned: input.owned.map((p) => (L.dropped.includes(p.id) ? { ...p, keep: 'dontcare' } : p)) }, L);
  }
  // Smallest first: the sets come in order of how much they leave out.
  const sets = r.problems[0].sets.map((s) => s.reduce((t, id) => t + area(id, big), 0));
  assert.deepEqual(sets, [...sets].sort((a, b) => a - b));
  assert.deepEqual(r.layouts.map((L) => L.variant).slice(-1), ['asis']);
});

test('the wall as it hangs always comes back, with every rule it breaks', () => {
  for (const wall of [jasonRead, scaled(0.88)]) {
    const r = layout({ ...wall, catalog: [], count: 3 });
    const asis = r.layouts.filter((L) => L.variant === 'asis');
    assert.equal(asis.length, 1);
    const L = asis[0];
    for (const p of wall.owned) {
      const q = L.pieces.find((x) => x.ref.id === p.id);
      assert.ok(q && q.x === p.at.x && q.y === p.at.y, `${p.id} where it hangs`);
    }
    assert.ok(Array.isArray(L.breaks));
    for (const b of L.breaks) {
      assert.ok(b.rule && ids.includes(b.piece) && b.by > 0 && typeof b.hard === 'boolean' && b.message.length > 10, JSON.stringify(b));
      assert.ok(!/[\u2014\u2013]/.test(b.message));
    }
    // As read, print 7 sits right on the headboard, which wants 7.5 in (6 plus the reader's 1.5 in of doubt).
    if (wall === jasonRead) assert.ok(L.breaks.some((b) => b.rule === 'furniture-clearance' && b.piece === 'auto6' && b.by === 7.5));
  }
});
