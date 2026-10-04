// The same promises on every path that makes a wall: layout(), refill(), walls with
// sections and scoreArrangement(). From the Oct 3 review (Astra): each of these was
// reproduced as broken on at least one path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layout, refill, scoreArrangement } from '../engine/index.js';
import { toCandidate } from '../engine/catalog.js';
import { livingRoom } from '../fixtures/walls.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';
import { assertLayoutValid } from './helpers.js';

const catalog = testCatalog();
const taste = testTaste(catalog);

const known = (L) => L.pieces.filter((p) => p.ref.source === 'catalog').every((p) => typeof p.price === 'number');

test('a budget finds the cheap prints instead of the liked ones it cannot afford', () => {
  // Liked prints at $200 and plain ones at $10, in the same sizes.
  const wall = { width: 120, height: 96 };
  const sizes = [[16, 20], [11, 14], [8, 10], [24, 36]];
  const cat = [];
  for (let i = 0; i < 6; i++) {
    for (const [tag, price, hex] of [['dear', 200, '#1F2FA8'], ['cheap', 10, '#1B6F73']]) {
      cat.push({ id: `${tag}-${i}`, title: `${tag} ${i}`, sizes: sizes.map(([w, h]) => ({ w, h, price })), palette: [{ hex, weight: 0.7 }, { hex: '#F2F2F2', weight: 0.3 }] });
    }
  }
  const taste = Object.fromEntries(cat.map((c) => [c.id, c.id.startsWith('dear') ? 0.95 : 0.2]));
  const r = layout({ wall, catalog: cat, taste, prefs: { budget: 40 } });
  assert.ok(r.layouts.length > 0, JSON.stringify(r.problems.slice(0, 1)));
  for (const L of r.layouts) assert.ok(L.total <= 40, `total ${L.total}`);
});

test('every wall under a budget is under it, on the sample wall', () => {
  for (const budget of [60, 120, 300]) {
    const input = { ...livingRoom, catalog, taste, prefs: { budget } };
    const r = layout(input);
    for (const L of r.layouts) {
      assert.ok(L.total <= budget + 1e-6, `${L.key} costs ${L.total} over ${budget}`);
      assertLayoutValid(input, L);
    }
  }
});

test('when nothing fits the budget, the cheapest named is real or a floor, never above what was found', () => {
  const r = layout({ ...livingRoom, catalog, taste, prefs: { budget: 10 } });
  assert.equal(r.layouts.length, 0);
  assert.equal(r.problems[0].code, 'BUDGET_TOO_LOW');
  const named = Number(r.problems[0].message.match(/\$(\d+)/)[1]);
  const cheapest = Math.min(...catalog.flatMap((c) => c.sizes.map((z) => z.price)));
  assert.ok(named >= cheapest, `${named} under the cheapest print ${cheapest}`);
});

test('an unknown price is never $0 and never passes a budget', () => {
  const blind = catalog.map((c) => ({ ...c, sizes: c.sizes.map(({ w, h }) => ({ w, h })) }));
  const open = layout({ ...livingRoom, catalog: blind, taste });
  assert.ok(open.layouts.length > 0);
  for (const L of open.layouts) {
    const n = L.pieces.filter((p) => p.ref.source === 'catalog').length;
    assert.equal(L.priceUnknown, n);
    assert.equal(L.total, 0);
  }
  const capped = layout({ ...livingRoom, catalog: blind, taste, prefs: { budget: 1000 } });
  assert.equal(capped.layouts.length, 0);
  assert.equal(capped.problems[0].code, 'BUDGET_TOO_LOW');
});

test('a size the shop stopped selling is not a candidate size', () => {
  const recs = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url)));
  const list = Array.isArray(recs) ? recs : recs.items || recs.records;
  const rec = structuredClone(list.find((r) => (r.offers || []).filter((o) => o.w && !o.gone).length >= 2));
  const live = rec.offers.filter((o) => o.w && !o.gone);
  const gone = live[0];
  gone.gone = true;
  const stillSold = (z) => rec.offers.some((o) => !o.gone && ((o.w === z.w && o.h === z.h) || (o.w === z.h && o.h === z.w)));
  const c = toCandidate(rec);
  assert.ok(c.sizes.length > 0);
  for (const z of c.sizes) assert.ok(stillSold(z), `${z.w}x${z.h} is no longer sold`);
  if (!stillSold(gone)) assert.ok(!c.sizes.some((z) => (z.w === gone.w && z.h === gone.h) || (z.w === gone.h && z.h === gone.w)));
});

test('scoreArrangement says when a wall is not one we would suggest', () => {
  const input = { ...livingRoom, catalog, taste, exclude: ['t-001'], prefs: { budget: 50 } };
  const a = scoreArrangement(input, [{ id: 't-001', x: 30, y: 50, w: 13, h: 13 }]);
  assert.equal(a.ok, false);
  assert.ok(a.fails.some((f) => /excluded/.test(f)));
  assert.ok(a.fails.some((f) => /doesn't come in/.test(f)));
  assert.throws(() => scoreArrangement(input, [{ id: 't-002', x: 30, y: 50, w: -10, h: 12 }]), /positive/);
  const b = scoreArrangement({ ...livingRoom, catalog, taste, keep: [{ id: 't-003', w: 8, h: 10 }] }, [{ id: 't-002', x: 30, y: 50, w: 11, h: 14 }]);
  assert.ok(b.fails.some((f) => /kept/.test(f)));
  const c = scoreArrangement({ ...livingRoom, catalog, taste, prefs: { budget: 5 } }, [{ id: 't-002', x: 30, y: 50, w: 11, h: 14 }]);
  assert.ok(c.fails.includes('over the budget'));
});

test('your pinned piece counts in the wall\'s colors, and listing it does not duplicate it', () => {
  const pin = (hex) => ({ id: 'big', title: 'Big', w: 30, h: 30, keep: 'must', pinned: true, at: { x: 10, y: 50 }, palette: [{ hex, weight: 1 }] });
  const placed = [{ id: 't-002', x: 120, y: 54, w: 11, h: 14 }];
  const white = scoreArrangement({ ...livingRoom, catalog, taste, owned: [pin('#F4F4F4')] }, placed);
  const red = scoreArrangement({ ...livingRoom, catalog, taste, owned: [pin('#C2362B')] }, placed);
  assert.notDeepEqual(white.layout.color.shares, red.layout.color.shares);
  const twice = scoreArrangement({ ...livingRoom, catalog, taste, owned: [pin('#C2362B')] }, [...placed, { id: 'big', x: 10, y: 50 }]);
  assert.equal(twice.layout.pieces.filter((p) => p.ref.id === 'big').length, 1);
  assert.ok(!twice.fails.some((f) => /big/.test(f)), twice.fails.join('; '));
});

test('a wire drop that cannot be right is treated as not measured', () => {
  const owned = [{ id: 'mine', title: 'Mine', w: 16, h: 20, keep: 'must', drop: 100 }];
  const r = layout({ ...livingRoom, catalog, taste, owned });
  for (const L of r.layouts) {
    const p = L.pieces.find((x) => x.ref.id === 'mine');
    if (!p) continue;
    assert.ok(p.nail.y > p.y && p.nail.y <= p.y + p.h, `nail at ${p.nail.y} outside ${p.y} to ${p.y + p.h}`);
    assert.ok(p.nailNote);
  }
});

test('a refill keeps the groups and the budget', () => {
  const input = { ...livingRoom, catalog, taste };
  const r = layout(input);
  const two = r.layouts.find((L) => (L.meta.groups || 1) > 1) || r.layouts[0];
  const again = refill(input, two);
  assert.equal(again.layouts[0].meta.groups, two.meta.groups || 1);
  const tight = refill({ ...input, prefs: { budget: 1 } }, two);
  assert.equal(tight.layouts.length, 0);
  assert.equal(tight.problems[0].code, 'BUDGET_TOO_LOW');
});

test('walls with sections stay out once shown, and keep to the budget', () => {
  const wall = { width: 168, height: 96 };
  const obstacles = [{ id: 'e', kind: 'edge', x: 83.5, y: 0, w: 1, h: 96 }];
  const base = { wall, obstacles, catalog, taste };
  const first = layout(base).layouts.filter((L) => L.variant === 'sections');
  assert.ok(first.length > 0);
  const again = layout({ ...base, avoid: first.map((L) => L.key) }).layouts.filter((L) => L.variant === 'sections');
  for (const L of again) assert.ok(!first.some((F) => F.key === L.key), `${L.key} shown twice`);
  const capped = layout({ ...base, prefs: { budget: 150 } });
  for (const L of capped.layouts) assert.ok(L.total <= 150 + 1e-6, `${L.variant} costs ${L.total}`);
  if (capped.layouts.length) assert.ok(!capped.problems.some((p) => p.code === 'BUDGET_TOO_LOW' || p.code === 'NO_LAYOUT'));
});

test('every returned wall has known prices on this catalog', () => {
  const r = layout({ ...livingRoom, catalog, taste });
  for (const L of r.layouts) assert.ok(known(L));
});

test('art you picked goes in first on other walls where its size fits', () => {
  const plain = layout({ ...livingRoom, catalog, taste });
  const onWall = new Set(plain.layouts.flatMap((L) => L.pieces.map((p) => p.ref.id)));
  // A piece none of these walls used, with sizes that fit them.
  const used = new Set(plain.layouts.flatMap((L) => L.pieces.filter((p) => p.ref.source === 'catalog').map((p) => `${p.frame.w}x${p.frame.h}`)));
  const pick = catalog.find((c) => !onWall.has(c.id) && c.sizes.some((z) => used.has(`${z.w}x${z.h}`)));
  const r = layout({ ...livingRoom, catalog, taste, prefer: [pick.id] });
  assert.ok(r.layouts.some((L) => L.pieces.some((p) => p.ref.id === pick.id)), 'the picked piece is on a wall');
});

test('asking for more walls puts any weaker one after every stronger one', () => {
  const r = layout({ ...livingRoom, catalog, taste, count: 24 });
  const firstWeak = r.layouts.findIndex((L) => L.weak);
  if (firstWeak >= 0) for (const L of r.layouts.slice(firstWeak)) assert.ok(L.weak || L.variant === 'sections' || L.variant === 'asis', `${L.key} strong after a weak one`);
});
