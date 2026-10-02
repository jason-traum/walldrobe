import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, rerank } from '../engine/index.js';
import { look } from '../engine/rank.js';
import { whyLine } from '../engine/reasons.js';
import { livingRoom } from '../fixtures/walls.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';
import { assertLayoutValid } from './helpers.js';

const cat = testCatalog();
const taste = testTaste(cat);

const owned = [
  { id: 'blue', title: 'blue print', w: 23, h: 32, keep: 'happy', palette: [{ hex: '#2C2C8C', weight: 1 }] },
  { id: 'smiley', title: 'smiley print', w: 26, h: 18, keep: 'happy', palette: [{ hex: '#C8A040', weight: 1 }] },
];
const base = () => ({ ...livingRoom, owned, catalog: cat, taste, count: 16 });

test('layout() can return a long list, each wall with a why line', () => {
  const r = layout(base());
  assert.ok(r.layouts.length >= 8, `only ${r.layouts.length}`);
  for (const L of r.layouts) {
    assertLayoutValid(base(), L);
    assert.ok(L.why && typeof L.why.text === 'string' && L.why.text.length > 10);
    assert.ok(!L.why.text.includes('—'), 'no em dashes');
    assert.match(L.why.text, /\d+(¼|½|¾)? in across\.$/);
  }
});

test('the why line says who is in the wall', () => {
  const L = { pieces: [{ ref: { source: 'owned' } }, { ref: { source: 'owned' } }, { ref: { source: 'catalog' } }], family: 'flow', variant: 'neat', meta: { groups: 1 }, group: { x: 30, y: 45, w: 73.5, h: 30 } };
  const couch = { kind: 'couch', x: 24, y: 0, w: 84, h: 32 };
  assert.equal(whyLine(L, { ownedTotal: 2, obstacles: [couch] }).text, 'Both of yours, one new. Lined up over the couch, 73½ in across.');
  const none = { ...L, pieces: [{ ref: { source: 'catalog' } }] };
  assert.equal(whyLine(none, { ownedTotal: 2, obstacles: [] }).who, 'One new piece, none of yours');
  assert.equal(whyLine(none, { ownedTotal: 0, obstacles: [] }).who, 'One new piece');
});

test('rerank keeps the order when nothing changed', () => {
  const r = layout(base());
  const again = rerank(r.layouts);
  assert.deepEqual(again.map((L) => L.key).slice(1), r.layouts.map((L) => L.key).filter((k) => k !== again[0].key).slice(0, again.length - 1));
  again.forEach((L, i) => assert.equal(L.rank, i + 1));
});

test('rerank puts a wall with new art first', () => {
  const r = layout(base());
  const first = rerank(r.layouts)[0];
  assert.ok(first.pieces.some((p) => p.ref.source === 'catalog'));
  assert.notEqual(first.variant, 'asis');
});

test('saving a piece moves walls with it up, skipping moves them down', () => {
  const r = layout(base());
  const L = r.layouts[r.layouts.length - 1];
  const id = L.pieces.find((p) => p.ref.source === 'catalog').ref.id;
  const before = rerank(r.layouts).findIndex((x) => x.key === L.key);
  const saved = rerank(r.layouts, { saved: [id] }).findIndex((x) => x.key === L.key);
  const skipped = rerank(r.layouts, { skipped: [id] }).findIndex((x) => x.key === L.key);
  assert.ok(saved <= before, `saved ${saved} vs ${before}`);
  assert.ok(skipped >= before, `skipped ${skipped} vs ${before}`);
});

test('a new taste re-orders without building again', () => {
  const r = layout(base());
  const love = {};
  const target = r.layouts[r.layouts.length - 1];
  for (const L of r.layouts) for (const p of L.pieces) if (p.ref.source === 'catalog') love[p.ref.id] = 0.2;
  for (const p of target.pieces) if (p.ref.source === 'catalog') love[p.ref.id] = 0.9;
  const t0 = Date.now();
  const out = rerank(r.layouts, { taste: love });
  assert.ok(Date.now() - t0 < 50);
  assert.ok(out.findIndex((x) => x.key === target.key) < r.layouts.length - 1);
});

test('distinct drops walls that look the same at a glance', () => {
  const r = layout(base());
  const out = rerank(r.layouts, { distinct: true });
  const looks = out.map(look);
  assert.equal(new Set(looks).size, looks.length);
  assert.ok(out.length <= r.layouts.length);
});

test('rerank refuses bad input', () => {
  assert.throws(() => rerank(null), TypeError);
});

test('a wall that moves a piece of yours that is already up ranks lower, more the farther it moves', () => {
  const r = layout(base());
  const withBlue = r.layouts.filter((L) => L.pieces.some((p) => p.ref.id === 'blue'));
  assert.ok(withBlue.length >= 2, 'need walls with the blue print');
  // Hang the blue print exactly where one wall puts it: that wall should not drop, and walls that move it far should.
  const home = withBlue[Math.floor(withBlue.length / 2)];
  const at = home.pieces.find((p) => p.ref.id === 'blue');
  const plain = rerank(r.layouts);
  const hung = rerank(r.layouts, { hung: [{ id: 'blue', at: { x: at.x, y: at.y } }] });
  const pos = (list, key) => list.findIndex((x) => x.key === key);
  assert.ok(pos(hung, home.key) <= pos(plain, home.key), `home wall went from ${pos(plain, home.key)} to ${pos(hung, home.key)}`);
  const far = withBlue.filter((L) => { const p = L.pieces.find((q) => q.ref.id === 'blue'); return Math.hypot(p.x - at.x, p.y - at.y) > 36; });
  if (far.length) {
    const L = far[0];
    const d0 = plain.find((x) => x.key === L.key).rankScore, d1 = hung.find((x) => x.key === L.key).rankScore;
    assert.ok(d1 < d0, `far wall score ${d0} -> ${d1}`);
    assert.ok(d0 - d1 <= 0.08 + 1e-9, 'capped per piece');
  }
  // A piece under an inch from where it hangs costs nothing.
  const same = rerank(r.layouts, { hung: [{ id: 'blue', at: { x: at.x + 0.5, y: at.y } }] });
  assert.equal(same.find((x) => x.key === home.key).rankScore, plain.find((x) => x.key === home.key).rankScore);
  // Bad positions are ignored, not thrown.
  assert.doesNotThrow(() => rerank(r.layouts, { hung: [{ id: 'blue' }, null] }));
});
