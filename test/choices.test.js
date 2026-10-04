import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, refill, spotChoices } from '../engine/index.js';
import { livingRoom } from '../fixtures/walls.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';
import { assertLayoutValid } from './helpers.js';

const cat = testCatalog();
const taste = testTaste(cat);
const input = () => ({ ...livingRoom, catalog: cat, taste, count: 8 });
const first = () => layout(input()).layouts[0];
const newPiece = (L) => L.pieces.find((p) => p.ref.source === 'catalog');

test('spotChoices() lists every piece in that frame size, none already on the wall', () => {
  const L = first();
  const p = newPiece(L);
  const list = spotChoices(input(), L, p.ref.id);
  assert.ok(list.length >= 4, `only ${list.length}`);
  const onWall = new Set(L.pieces.map((x) => x.ref.id));
  for (const c of list) {
    assert.ok(!onWall.has(c.id), `${c.id} is already on the wall`);
    const item = cat.find((x) => x.id === c.id);
    // The wall holds the frame's outside; the piece comes in the size the frame is sold as.
    assert.ok((item.sizes || []).some((s) => s.w === p.frame.w && s.h === p.frame.h), `${c.id} doesn't come in ${p.frame.w} x ${p.frame.h}`);
  }
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].value >= list[i].value, 'best first');
});

test('favorites that fit the spot come first, ones that do not fit are not listed', () => {
  const L = first();
  const p = newPiece(L);
  const all = spotChoices(input(), L, p.ref.id);
  const fav = all[all.length - 1].id; // the weakest fit, made a favorite
  const misfit = cat.find((x) => !(x.sizes || []).some((s) => s.w === p.w && s.h === p.h));
  const list = spotChoices(input(), L, p.ref.id, { favorites: [fav, misfit.id] });
  assert.equal(list[0].id, fav);
  assert.equal(list[0].favorite, true);
  assert.ok(!list.some((c) => c.id === misfit.id), 'a favorite that does not fit is left out');
  assert.equal(list.length, all.length);
});

test('spotChoices() is the same every time for the same input', () => {
  const L = first();
  const id = newPiece(L).ref.id;
  assert.deepEqual(spotChoices(input(), L, id, { favorites: [] }), spotChoices(input(), L, id, { favorites: [] }));
});

test('refill() with to puts that piece in the spot and changes nothing else', () => {
  const L = first();
  const p = newPiece(L);
  const pick = spotChoices(input(), L, p.ref.id)[2].id;
  const R = refill(input(), L, { swap: p.ref.id, to: pick }).layouts[0];
  assert.ok(R, 'a layout');
  assertLayoutValid(input(), R);
  const moved = R.pieces.find((x) => x.ref.id === pick);
  assert.ok(moved, 'the picked piece is on the wall');
  assert.deepEqual([moved.x, moved.y, moved.w, moved.h], [p.x, p.y, p.w, p.h], 'same spot, same frame');
  const before = L.pieces.filter((x) => x.ref.id !== p.ref.id).map((x) => [x.ref.id, x.x, x.y, x.w, x.h]).sort();
  const after = R.pieces.filter((x) => x.ref.id !== pick).map((x) => [x.ref.id, x.x, x.y, x.w, x.h]).sort();
  assert.deepEqual(after, before, 'every other piece is where it was');
});

test('refill() with to refuses a piece already on the wall', () => {
  const L = first();
  const ps = L.pieces.filter((x) => x.ref.source === 'catalog');
  if (ps.length < 2) return;
  assert.throws(() => refill(input(), L, { swap: ps[0].ref.id, to: ps[1].ref.id }), /already on this layout/);
});
