// Jason's own bedroom wall, hung by hand, against the engine's walls, and the
// free-form rules that came out of comparing them (ENGINE.md, "His wall against
// the engine's").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, scoreArrangement } from '../engine/index.js';
import { shapeScore, openSpace, anchorScore, internalLines } from '../engine/flow.js';
import { blockedRegions, checkPieces } from '../engine/geometry.js';
import { FREEFORM } from '../engine/constants.js';
import { jasonBedroom, jasonHung } from '../fixtures/jason_bedroom.js';
import { assertLayoutValid } from './helpers.js';

const input = { ...jasonBedroom, catalog: [], count: 24 };

test('his wall scores with the engine\'s own parts, and the running poster fails the headboard clearance', () => {
  const s = scoreArrangement(input, jasonHung);
  assert.ok(s.score > 0 && s.score <= 1, `score ${s.score}`);
  for (const k of ['fit', 'taste', 'color', 'design', 'comp']) assert.ok(Number.isFinite(s.parts[k]) && s.parts[k] >= 0 && s.parts[k] <= 1, `${k} ${s.parts[k]}`);
  assert.equal(s.ok, false);
  assert.deepEqual(s.fails, ['running on bed']);
  assert.equal(s.layout.pieces.length, 7);
  // Raised to 6 in over the headboard (and the smiley photo with it), it passes.
  const up = (p) => (p.id === 'running' || p.id === 'smiley' ? { ...p, y: p.y + 5.75 } : p);
  assert.equal(scoreArrangement(input, jasonHung.map(up)).ok, true);
});

test('scoreArrangement needs pieces it knows', () => {
  assert.throws(() => scoreArrangement(input, []), /needs a list/);
  assert.throws(() => scoreArrangement(input, [{ id: 'nope', x: 40, y: 50 }]), /isn't one of your pieces/);
});

test('the engine\'s walls for his seven pieces all pass the hard rules, at every fullness', () => {
  for (const fullness of ['calm', 'balanced', 'full']) {
    const inp = { ...input, prefs: { fullness } };
    const r = layout(inp);
    assert.ok(r.layouts.length >= 5, `${fullness}: ${r.layouts.length} walls`);
    const regions = blockedRegions(inp.obstacles);
    for (const L of r.layouts) {
      if (L.variant === 'asis') continue; // his wall as it hangs: shown with what it breaks, below
      assertLayoutValid(inp, L);
      assert.deepEqual(checkPieces(L.pieces.map((p) => ({ ...p, id: p.ref.id })), regions, inp.wall), []);
    }
    // His wall as it hangs comes back last, with the rule it breaks and by how much.
    const asis = r.layouts.filter((L) => L.variant === 'asis');
    assert.equal(asis.length, 1);
    assert.equal(r.layouts[r.layouts.length - 1], asis[0]);
    const hard = asis[0].breaks.filter((b) => b.hard);
    assert.deepEqual(hard.map((b) => [b.rule, b.piece, b.by]), [['furniture-clearance', 'running', 5.5]]);
  }
  assert.deepEqual(layout(input), layout(input));
});

// A wall of open space to judge shapes on.
const wall = { width: 120, height: 100 };
const ctx = (extra) => ({ space: openSpace(wall, blockedRegions([])), wall, obstacles: [], fullness: 'balanced', ...extra });

test('in a gallery wall of five, the biggest piece low and central beats the same piece high at the edge', () => {
  const low = [
    { x: 30, y: 40, w: 30, h: 24 },
    { x: 15.5, y: 40, w: 12, h: 16 }, { x: 15.5, y: 58.5, w: 12, h: 16 },
    { x: 62.5, y: 40, w: 12, h: 16 }, { x: 62.5, y: 58.5, w: 12, h: 16 },
  ];
  const high = [
    { x: 10, y: 58.5, w: 30, h: 24 },
    { x: 10, y: 40, w: 12, h: 16 }, { x: 24.5, y: 40, w: 12, h: 16 }, { x: 39, y: 40, w: 12, h: 16 }, { x: 53.5, y: 40, w: 12, h: 16 },
  ];
  assert.equal(anchorScore(low), 1);
  assert.ok(anchorScore(high) < 0.5, `high at the edge ${anchorScore(high)}`);
  const free = ctx({ free: true, loose: true });
  assert.ok(shapeScore(low, free).parts.anchor > shapeScore(high, free).parts.anchor);
  // The rule is a share of the free-form shape score only.
  const cost = (fs) => shapeScore(fs, ctx({ loose: true })).score - shapeScore(fs, free).score;
  assert.ok(cost(high) > cost(low) + 0.03, `cost high ${cost(high)}, low ${cost(low)}`);
  // Three or four pieces may balance a big one off to one side.
  assert.equal(anchorScore(high.slice(0, 4)), 1);
  // An even set has no anchor to place.
  assert.equal(anchorScore(high.map((f) => ({ ...f, w: 12, h: 16 }))), 1);
});

test('neighbors lining up beats one row across the wall only in loose walls', () => {
  // Each frame lines up with a frame it touches; no line is shared by three.
  const locked = [
    { x: 20, y: 40, w: 20, h: 20 },
    { x: 42.5, y: 40, w: 16, h: 16 },
    { x: 42.5, y: 58.5, w: 16, h: 12 },
    { x: 61, y: 48.5, w: 14, h: 22 },
  ];
  // One bottom line across the wall, but no frame touches another.
  const row = [0, 20, 40, 60].map((x) => ({ x: 20 + x, y: 45, w: 12, h: 16 }));
  assert.equal(internalLines(locked), 1);
  assert.equal(internalLines(row), 0);
  const lines = (fs, loose) => shapeScore(fs, ctx({ free: true, loose })).parts.lines;
  assert.ok(lines(locked, true) > lines(row, true), `loose: locked ${lines(locked, true)}, row ${lines(row, true)}`);
  assert.ok(lines(row, false) > lines(locked, false), `neat: row ${lines(row, false)}, locked ${lines(locked, false)}`);
  assert.ok(FREEFORM.internal > 0.5);
});

test('a group over a bed and a dresser is centered on the two together', () => {
  const obstacles = [
    { id: 'bed', kind: 'headboard', x: 10, y: 0, w: 60, h: 34 },
    { id: 'dresser', kind: 'dresser', x: 80, y: 0, w: 36, h: 40 },
  ];
  const wide = { width: 130, height: 100 };
  const c = { space: openSpace(wide, blockedRegions(obstacles)), wall: wide, obstacles, fullness: 'balanced', free: true };
  // 80 in across, centered on the bed and dresser together (x 10 to 116), well right of the bed's middle.
  const frames = [{ x: 23, y: 47, w: 24, h: 30 }, { x: 49.5, y: 47, w: 24, h: 30 }, { x: 76, y: 47, w: 24, h: 30 }];
  assert.ok(shapeScore(frames, c).parts.room >= 0.95, `room ${shapeScore(frames, c).parts.room}`);
});
