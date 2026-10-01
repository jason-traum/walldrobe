import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, RULES } from '../engine/index.js';
import { SAMPLE_WALLS, livingRoom, bedroom, hallway } from '../fixtures/walls.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';
import { assertLayoutValid } from './helpers.js';

const catalog = testCatalog();
const taste = testTaste(catalog);
const run = (w, extra = {}) => layout({ ...w, catalog, taste, ...extra });

for (const w of SAMPLE_WALLS) {
  test(`${w.name}: three valid layouts from at least two families`, () => {
    const input = { ...w, catalog, taste };
    const r = layout(input);
    assert.equal(r.layouts.length, 3);
    assert.ok(new Set(r.layouts.map((L) => L.family)).size >= 2);
    r.layouts.forEach((L) => assertLayoutValid(input, L));
    const scores = r.layouts.map((L) => L.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'ranked best first');
  });
}

test('same input, same output', () => {
  for (const w of SAMPLE_WALLS) assert.deepEqual(run(w), run(w));
});

test('living room: over the couch, about two thirds its width, 6 to 10 in above it', () => {
  for (const L of run(livingRoom).layouts) {
    assert.equal(L.anchor.id, 'couch');
    const ratio = L.group.w / 84;
    // One piece alone may be narrower, since frames stop at 40 in (RULES.soloMinRatio).
    const lo = L.variant === 'solo' ? RULES.soloMinRatio : 0.5;
    assert.ok(ratio >= lo && ratio <= 0.8, `width ratio ${ratio}`);
    const c = L.group.y - 32;
    assert.ok(c >= RULES.clearanceMin && c <= RULES.clearanceMax, `clearance ${c}`);
    assert.ok(Math.abs(L.group.x + L.group.w / 2 - 66) <= 1, 'centered on the couch');
  }
});

test('hallway: centered at 57 in on the open stretch', () => {
  for (const L of run(hallway).layouts) {
    const cy = L.group.y + L.group.h / 2;
    assert.ok(cy >= 56.75 && cy <= 60.25, `center ${cy}`); // quarter-inch rounding
    assert.equal(L.anchor.kind, 'wall');
  }
});

test('bedroom: the blue print is on every layout and the pink photo is explained when left off', () => {
  for (const L of run(bedroom).layouts) {
    assert.ok(L.pieces.some((p) => p.ref.id === 'blue'));
    const pinkOn = L.pieces.some((p) => p.ref.id === 'pink');
    if (!pinkOn) assert.ok(L.left.some((l) => l.id === 'pink'));
    assert.match(L.summary, /blue print/);
  }
});

test('the must-keep piece gets the middle in a statement layout', () => {
  const L = run(bedroom, { prefs: { families: ['statement'] } }).layouts[0];
  const blue = L.pieces.find((p) => p.ref.id === 'blue');
  assert.equal(blue.role, 'center');
  assert.match(blue.reason, /said you'd keep/);
});

test('a pinned piece stays exactly where it hangs', () => {
  const owned = [{ id: 'clock', title: 'clock', w: 12, h: 12, keep: 'must', pinned: true, at: { x: 8, y: 50 } }];
  const input = { ...livingRoom, owned, catalog, taste };
  const r = layout(input);
  assert.ok(r.layouts.length > 0);
  for (const L of r.layouts) {
    assertLayoutValid(input, L);
    const clock = L.pieces.find((p) => p.ref.id === 'clock');
    assert.equal(clock.role, 'pinned');
    assert.match(clock.reason, /exactly where it hangs/);
  }
});

test('grid is skipped with a reason when must-keeps are different sizes', () => {
  const r = run(bedroom);
  const p = r.problems.find((x) => x.family === 'grid');
  assert.equal(p.code, 'FAMILY_SKIPPED');
  assert.match(p.message, /one frame size/);
});

test('must-keeps wider than the wall are reported, not squeezed', () => {
  const owned = [
    { id: 'a', title: 'big one', w: 40, h: 30, keep: 'must' },
    { id: 'b', title: 'big two', w: 40, h: 30, keep: 'must' },
  ];
  const r = layout({ ...hallway, owned, catalog, taste });
  assert.equal(r.layouts.length, 0);
  assert.equal(r.problems[0].code, 'MUST_KEEPS_TOO_WIDE');
  assert.match(r.problems[0].message, /83 in wide together/);
});

test('no open space is reported', () => {
  const r = layout({ wall: { width: 50, height: 96 }, obstacles: [{ id: 'tv', kind: 'tv', x: 0, y: 0, w: 50, h: 96 }], catalog, taste });
  assert.equal(r.problems[0].code, 'NO_OPEN_SPACE');
});

test('an empty catalog with nothing owned is reported', () => {
  const r = layout({ ...livingRoom, catalog: [] });
  assert.equal(r.layouts.length, 0);
  assert.equal(r.problems[0].code, 'TOO_FEW_CANDIDATES');
});


test('a budget drops layouts over it and names the cheapest', () => {
  const r = run(livingRoom, { prefs: { budget: 10 } });
  assert.equal(r.layouts.length, 0);
  assert.equal(r.problems[0].code, 'BUDGET_TOO_LOW');
  assert.match(r.problems[0].message, /\$\d+/);
  const ok = run(livingRoom, { prefs: { budget: 300 } });
  for (const L of ok.layouts) assert.ok(L.total <= 300);
});

test('taste moves the picks', () => {
  const likesWarm = Object.fromEntries(catalog.map((c) => [c.id, c.theme === 'warm' ? 0.95 : 0.2]));
  const L = layout({ ...livingRoom, catalog, taste: likesWarm }).layouts[0];
  const warm = L.pieces.filter((p) => catalog.find((c) => c.id === p.ref.id)?.theme === 'warm').length;
  assert.ok(warm >= L.pieces.length / 2, `${warm} of ${L.pieces.length} warm`);
});

test('happy-to-move pieces can be used as fill when their size fits', () => {
  const owned = [{ id: 'mine', title: 'my print', w: 16, h: 20, keep: 'happy', palette: [{ hex: '#111111', weight: 1 }] }];
  const r = layout({ ...livingRoom, owned, catalog, taste });
  const used = r.layouts.filter((L) => L.pieces.some((p) => p.ref.id === 'mine'));
  assert.ok(used.length >= 1);
  for (const L of r.layouts) assertLayoutValid({ ...livingRoom, owned }, L);
});

test('catalog pieces carry their link and artist through', () => {
  const p = run(livingRoom).layouts[0].pieces.find((x) => x.ref.source === 'catalog');
  assert.match(p.url, /^https:\/\//);
  assert.ok(p.artist);
  assert.ok(p.price > 0);
});

test('an unknown wire drop is flagged on the nail', () => {
  const p = run(livingRoom).layouts[0].pieces[0];
  assert.match(p.nailNote, /Measure yours first/);
  assert.equal(p.nail.y, p.y + p.h - RULES.defaultDrop);
});

test('bad input gets a plain error', () => {
  assert.throws(() => layout({}), /wall needs a positive width/);
  assert.throws(() => layout({ wall: { width: 100, height: 96 }, owned: [{ id: 'a', w: 10, h: 10, keep: 'maybe' }] }), /must, happy or dontcare/);
  assert.throws(() => layout({ wall: { width: 100, height: 96 }, owned: [{ id: 'a', w: 10, h: 10, keep: 'must', pinned: true }] }), /current position/);
});

test('fast enough to run in the browser', () => {
  const t0 = performance.now();
  for (const w of SAMPLE_WALLS) run(w);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `${Math.round(ms)} ms for three walls`);
});

// ---------- Fixes from the first review ----------

test('a must-keep takes the statement center, even next to a bigger happy piece', () => {
  const owned = [
    { id: 'm', title: 'little print', w: 16, h: 20, keep: 'must' },
    { id: 'h', title: 'big print', w: 24, h: 30, keep: 'happy' },
  ];
  const r = layout({ ...livingRoom, owned, catalog, taste, prefs: { families: ['statement'] }, count: 6 });
  for (const L of r.layouts) {
    const m = L.pieces.find((p) => p.ref.id === 'm');
    if (L.variant !== 'solo') assert.equal(m.role, 'center', L.summary);
  }
});

test('a group never slides off the furniture it is described as over', () => {
  const input = {
    wall: { width: 160, height: 96 },
    obstacles: [{ id: 'couch', kind: 'couch', x: 70, y: 0, w: 84, h: 30 }, { id: 'shelf', kind: 'shelf', x: 95, y: 68, w: 40, h: 4 }],
    catalog, taste,
  };
  for (const L of layout(input).layouts) {
    const cx = L.group.x + L.group.w / 2;
    assert.ok(Math.abs(cx - 112) <= 0.15 * 84 + 0.01, `center ${cx}`);
    assertLayoutValid(input, L);
  }
});

test('obstacles with no size are rejected', () => {
  assert.throws(() => layout({ wall: { width: 100, height: 96 }, obstacles: [{ id: 'w', kind: 'window', x: 80, y: 30, w: -30, h: 54 }] }), /positive width/);
});

test('a bad palette color names the piece instead of crashing later', () => {
  const bad = [{ ...catalog[0], id: 'bad', palette: [{ hex: 'navy' }] }];
  assert.throws(() => layout({ ...livingRoom, catalog: bad }), /Palette for bad/);
});

test('positions and gaps land exactly on the quarter inch', () => {
  for (const w of SAMPLE_WALLS) {
    for (const L of run(w).layouts) {
      for (const p of L.pieces) {
        assert.equal(p.x * 4, Math.round(p.x * 4), `${p.ref.id} x ${p.x}`);
        assert.equal(p.y * 4, Math.round(p.y * 4), `${p.ref.id} y ${p.y}`);
      }
      for (const g of L.meta.gaps) assert.ok(g >= RULES.gapMin && g <= RULES.gapMax, `gap ${g}`);
    }
  }
});

test('group width stays in the allowed window over furniture', () => {
  for (const L of run(livingRoom, { count: 12 }).layouts) {
    const ratio = L.group.w / 84;
    const lo = L.variant === 'solo' ? RULES.soloMinRatio : 0.5;
    assert.ok(ratio >= lo - 1e-9 && ratio <= 0.8 + 1e-9, `${L.family} ratio ${ratio}`);
  }
});

test('maxPieces left undefined falls back to 9, and 1 means one piece', () => {
  for (const L of run(livingRoom, { prefs: { maxPieces: undefined }, count: 12 }).layouts) assert.ok(L.pieces.length <= 9);
  for (const L of run(livingRoom, { prefs: { maxPieces: 1 } }).layouts) assert.equal(L.pieces.length, 1);
});

test('taste outside 0 to 1 is clamped', () => {
  const wild = Object.fromEntries(catalog.map((c, i) => [c.id, i % 2 ? 3 : -2]));
  for (const L of run(livingRoom, { taste: wild }).layouts) assert.ok(L.parts.taste >= 0 && L.parts.taste <= 1);
});

test('a must-keep taller than the wall allows is named as too tall', () => {
  const r = layout({ ...hallway, owned: [{ id: 't', title: 'tall scroll', w: 20, h: 90, keep: 'must' }], catalog, taste });
  assert.equal(r.problems[0].code, 'MUST_KEEPS_TOO_TALL');
  assert.match(r.problems[0].message, /tall scroll is 90 in tall/);
});

test('a catalog with no usable sizes says so, not "fewer must-keeps"', () => {
  // Frames are built in the sizes the art comes in, from 8 in on the long side, so 5 x 7 is too small for any.
  const odd = catalog.slice(0, 10).map((c) => ({ ...c, sizes: [{ w: 5, h: 7, price: 20 }] }));
  const r = layout({ ...livingRoom, catalog: odd });
  assert.equal(r.problems[0].code, 'TOO_FEW_CANDIDATES');
});

test('a wall too short for eye level says so', () => {
  const r = layout({ wall: { width: 100, height: 60 }, catalog, taste });
  assert.equal(r.problems[0].code, 'NO_OPEN_SPACE');
  assert.match(r.problems[0].message, /too short/);
});

test('reasons read right: articles, titles, wording', () => {
  const owned = [{ id: 'x', w: 20, h: 28, keep: 'must' }];
  const r = layout({ ...livingRoom, owned, catalog, taste });
  for (const L of r.layouts) {
    for (const p of L.pieces) {
      assert.doesNotMatch(p.reason, /Your Your|your this|A 8 |A 11 |A 18 |ties in the rest/, p.reason);
    }
    assert.doesNotMatch(L.summary, /your Your/);
  }
});

test('one statement piece still works over a wide couch', () => {
  for (const couchW of [84, 100]) {
    const w = { wall: { width: 150, height: 96 }, obstacles: [{ id: 'couch', kind: 'couch', x: 20, y: 0, w: couchW, h: 32 }] };
    const r = layout({ ...w, catalog, taste, prefs: { maxPieces: 1 } });
    assert.ok(r.layouts.length >= 1, `couch ${couchW}`);
  }
  // A 30 in piece alone over an 84 in couch is 0.36 of it: allowed. Over 100 in it is 0.3: reported, not hung.
  const mk = (couchW) => layout({
    wall: { width: 150, height: 96 }, obstacles: [{ id: 'couch', kind: 'couch', x: 20, y: 0, w: couchW, h: 32 }],
    owned: [{ id: 'big', title: 'big print', w: 30, h: 40, keep: 'must' }], catalog, taste, prefs: { maxPieces: 1 },
  });
  assert.ok(mk(84).layouts.length >= 1);
  const wide = mk(100);
  assert.equal(wide.layouts.length, 0);
  assert.match(wide.problems[0].message, /around your big print/);
});

test('one must-keep that cannot fit gets advice about that piece', () => {
  const r = layout({ ...livingRoom, owned: [{ id: 'm', title: 'odd piece', w: 7, h: 9, keep: 'must' }], catalog: [], prefs: { maxPieces: 1 } });
  const p = r.problems[0];
  assert.doesNotMatch(p.message, /fewer pieces as must keep/);
});

test('a TV wall: art goes above the TV, centered on it and clear of it', () => {
  const wall = { width: 120, height: 108 };
  const obstacles = [{ id: 'stand', kind: 'furniture', x: 30, y: 0, w: 60, h: 22 }, { id: 'tv', kind: 'tv', x: 36, y: 26, w: 48, h: 28 }];
  const r = layout({ wall, obstacles, catalog, taste });
  assert.ok(r.layouts.length > 0, JSON.stringify(r.problems));
  for (const L of r.layouts) {
    assert.equal(L.anchor.id, 'tv');
    assert.ok(L.group.y >= 26 + 28 + RULES.blockerClear, `above the TV: ${L.group.y}`);
    assert.ok(Math.abs(L.group.x + L.group.w / 2 - 60) <= 1, 'centered on the TV');
    assertLayoutValid({ wall, obstacles }, L);
  }
});

test('a TV with no room above it falls back to the open wall beside it', () => {
  const wall = { width: 140, height: 84 };
  const obstacles = [{ id: 'tv', kind: 'tv', x: 46, y: 30, w: 48, h: 40 }];
  const r = layout({ wall, obstacles, catalog, taste });
  for (const L of r.layouts) { assert.notEqual(L.anchor.id, 'tv'); assertLayoutValid({ wall, obstacles }, L); }
});
