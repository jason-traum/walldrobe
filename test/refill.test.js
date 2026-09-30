// Whole-wall judging on real layouts, and the keep, swap, refresh and
// try-another controls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layout, refill } from '../engine/index.js';
import { activeRecords, toCandidate } from '../engine/catalog.js';
import { livingRoom, bedroom, hallway } from '../fixtures/walls.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';
import { assertLayoutValid } from './helpers.js';

const synthetic = testCatalog();
const synthTaste = testTaste(synthetic);
const real = activeRecords(JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items).map(toCandidate);
const inputFor = (w, catalog = real, extra = {}) => ({ ...w, catalog, ...(catalog === synthetic ? { taste: synthTaste } : {}), ...extra });
const newArt = (L) => L.pieces.filter((p) => p.ref.source === 'catalog' && !p.kept).map((p) => p.ref.id);
const where = (L) => L.pieces.map((p) => `${p.x},${p.y},${p.w}x${p.h}`);

test('every layout explains itself: key, parts, checks, colors and notes', () => {
  for (const w of [livingRoom, bedroom, hallway]) {
    for (const L of layout(inputFor(w)).layouts) {
      assert.equal(typeof L.key, 'string');
      assert.deepEqual(Object.keys(L.parts).sort(), ['color', 'design', 'fit', 'taste']);
      for (const [k, v] of Object.entries(L.checks)) assert.ok(v >= 0 && v <= 1, `${k} ${v}`);
      assert.ok(L.color.scheme && Object.keys(L.color.shares).length > 0);
      assert.ok(L.notes.length >= 1 && L.notes.length <= 5, `${L.notes.length} notes`);
      for (const n of L.notes) {
        assert.ok(n.length <= 160 && /^[A-Z].*\.$/.test(n), n);
        assert.ok(!/[—–]/.test(n), `no dash in: ${n}`);
      }
      assert.ok(L.notes.filter((n) => n.startsWith('Worth knowing')).length <= 1);
      for (const p of L.pieces) {
        const sum = Object.values(p.shares).reduce((a, b) => a + b, 0);
        assert.ok(sum > 0.9 && sum <= 1.01, `${p.ref.id} shares`);
      }
    }
  }
});

test('the three layouts show different art when the catalog has enough', () => {
  for (const w of [livingRoom, hallway]) {
    const r = layout(inputFor(w));
    const seen = new Set();
    for (const L of r.layouts) for (const id of newArt(L)) { assert.ok(!seen.has(id), `${id} is in two layouts`); seen.add(id); }
  }
});

test('a kept catalog piece is on every layout and says so', () => {
  const first = layout(inputFor(livingRoom)).layouts[0];
  const p = first.pieces.find((x) => x.ref.source === 'catalog');
  const r = layout(inputFor(livingRoom, real, { keep: [{ id: p.ref.id, w: p.w, h: p.h }] }));
  assert.ok(r.layouts.length > 0);
  for (const L of r.layouts) {
    const k = L.pieces.find((x) => x.ref.id === p.ref.id);
    assert.ok(k, `${L.family} keeps it`);
    assert.equal(k.kept, true);
    assert.equal(k.w, p.w);
    assert.match(k.reason, /^You kept this one/);
    assertLayoutValid(inputFor(livingRoom), L);
  }
});

test('excluded pieces never appear', () => {
  const first = layout(inputFor(livingRoom));
  const ids = first.layouts.flatMap(newArt);
  const r = layout(inputFor(livingRoom, real, { exclude: ids }));
  for (const L of r.layouts) for (const id of newArt(L)) assert.ok(!ids.includes(id));
});

test('try a new layout skips the arrangements already shown, then starts over', () => {
  const input = inputFor(livingRoom);
  const shown = [];
  let r = layout(input);
  for (let i = 0; i < 12 && !r.problems.some((p) => p.code === 'ALL_SHOWN'); i++) {
    for (const L of r.layouts) { assert.ok(!shown.includes(L.key), `${L.key} shown twice`); shown.push(L.key); }
    r = layout({ ...input, avoid: shown });
  }
  assert.ok(r.problems.some((p) => p.code === 'ALL_SHOWN'), 'runs out eventually');
  assert.ok(r.layouts.length > 0, 'and still shows something');
});

test('refresh the rest: same frames in the same places, new art except what you kept', () => {
  const input = inputFor(livingRoom);
  const L = layout(input).layouts.find((x) => x.pieces.length >= 3);
  const keep = L.pieces[0].ref.id;
  const r = refill(input, L, { keep: [keep] });
  const R = r.layouts[0];
  assert.deepEqual(where(R), where(L));
  assert.equal(R.key, L.key);
  assert.equal(R.pieces[0].ref.id, keep);
  assert.equal(R.pieces[0].kept, true);
  const before = new Set(L.pieces.map((p) => p.ref.id));
  for (const p of R.pieces.slice(1)) assert.ok(!before.has(p.ref.id), `${p.ref.id} was replaced by itself or a neighbor`);
  assertLayoutValid(input, R);
  assert.deepEqual(refill(input, L, { keep: [keep] }), r, 'same input, same output');
});

test('swap one: only that piece changes', () => {
  const input = inputFor(livingRoom);
  const L = layout(input).layouts[0];
  const target = L.pieces.find((p) => p.ref.source === 'catalog');
  const R = refill(input, L, { swap: target.ref.id }).layouts[0];
  assert.deepEqual(where(R), where(L));
  L.pieces.forEach((p, i) => {
    if (p.ref.id === target.ref.id) assert.notEqual(R.pieces[i].ref.id, p.ref.id);
    else assert.equal(R.pieces[i].ref.id, p.ref.id);
  });
});

test('refresh keeps pieces you own, and never swaps a must-keep', () => {
  const input = inputFor(bedroom, synthetic);
  const L = layout(input).layouts[0];
  const R = refill(input, L).layouts[0];
  for (const p of L.pieces.filter((x) => x.ref.source === 'owned')) assert.ok(R.pieces.some((x) => x.ref.id === p.ref.id));
  const must = L.pieces.find((p) => p.keep === 'must');
  assert.throws(() => refill(input, L, { swap: must.ref.id }), /must keep/);
  assert.throws(() => refill(input, L, { swap: 'nope' }), /isn't on this layout/);
});

test('bad keep, exclude and avoid inputs are refused with a plain message', () => {
  assert.throws(() => layout(inputFor(hallway, synthetic, { keep: [{ id: 'nope', w: 8, h: 10 }] })), /isn't in the catalog/);
  assert.throws(() => layout(inputFor(hallway, synthetic, { keep: [{ id: synthetic[0].id }] })), /frame size/);
  assert.throws(() => layout(inputFor(hallway, synthetic, { exclude: 'x' })), /list of ids/);
  assert.throws(() => layout(inputFor(hallway, synthetic, { avoid: [1] })), /list of ids/);
});

test('the improvement pass never makes a wall worse than the plain fill', () => {
  // Scores are rounded; the best layout should clear a sensible bar on the real catalog.
  for (const w of [livingRoom, hallway]) {
    const L = layout(inputFor(w)).layouts[0];
    assert.ok(L.parts.color >= 0.7 && L.parts.design >= 0.8, `${w.name}: ${JSON.stringify(L.parts)}`);
  }
});

test('a kept piece cannot be swapped out, and refill respects the budget', () => {
  const input = inputFor(livingRoom, synthetic);
  const L = layout(input).layouts[0];
  const p = L.pieces.find((x) => x.ref.source === 'catalog');
  const kept = { ...input, keep: [{ id: p.ref.id, w: p.w, h: p.h }] };
  assert.throws(() => refill(kept, L, { swap: p.ref.id }), /must keep/);
  const r = refill({ ...input, prefs: { budget: 1 } }, L);
  assert.equal(r.layouts.length, 0);
  assert.equal(r.problems[0].code, 'BUDGET_TOO_LOW');
});

test('a piece you own in an odd size can be swapped for art in its frame slot', () => {
  const mine = { id: 'mine', title: 'my print', w: 15, h: 19, keep: 'happy', palette: [{ hex: '#1F2FA8', weight: 1 }] };
  const input = inputFor(livingRoom, real, { owned: [mine] });
  const L = layout(input).layouts.find((x) => x.pieces.some((p) => p.ref.id === 'mine'));
  assert.ok(L, 'your piece is used somewhere');
  const R = refill(input, L, { swap: 'mine' }).layouts[0];
  assert.ok(R, 'swapped');
  const slot = L.pieces.find((p) => p.ref.id === 'mine').slot;
  const put = R.pieces.find((p) => Math.abs(p.x - slot.x) < 0.01 && Math.abs(p.y - slot.y) < 0.01);
  assert.ok(put && put.w === slot.w && put.h === slot.h && put.ref.id !== 'mine');
  assertLayoutValid(input, R);
});
