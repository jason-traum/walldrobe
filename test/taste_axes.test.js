import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AXES, AXIS_NAMES, axesOf, nextAxisPair, axisUncertainty, tasteProfile, correctProfile, scoreProfile,
  complement, wallComplement, FEATURE_NAMES,
} from '../engine/taste.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';
import { COMPLEMENT, PROFILE } from '../engine/constants.js';
import { layout, rerank } from '../engine/index.js';
import { livingRoom } from '../fixtures/walls.js';
import { testCatalog, testTaste } from '../fixtures/catalog.js';

const records = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;
const items = activeRecords(records).map(toCandidate);
const pos = (it, a) => axesOf(it)[a];

// Pairs that split warm vs cool and little else: each cool piece against the
// warm piece closest to it on every other axis.
function warmPicks(n = 6) {
  const color = items.filter((i) => !i.record.color.bw);
  const warm = color.filter((i) => pos(i, 'warm') >= 0.85), cool = color.filter((i) => pos(i, 'warm') <= 0.2);
  const used = new Set();
  const out = [];
  for (const c of cool) {
    let best = null;
    for (const w of warm) {
      if (used.has(w.id)) continue;
      const off = AXIS_NAMES.filter((a) => a !== 'warm').reduce((s, a) => s + Math.abs(pos(w, a) - pos(c, a)), 0);
      if (!best || off < best.off) best = { w, off };
    }
    if (best && best.off < 0.4) { used.add(best.w.id); out.push({ winner: best.w, loser: c }); }
    if (out.length >= n) break;
  }
  return out;
}

test('every piece sits within 0 and 1 on every axis, the same every time', () => {
  for (const it of items) {
    const p = axesOf(it);
    assert.deepEqual(Object.keys(p), AXIS_NAMES);
    for (const a of AXIS_NAMES) assert.ok(Number.isFinite(p[a]) && p[a] >= 0 && p[a] <= 1, `${it.id} ${a} ${p[a]}`);
    assert.deepEqual(axesOf(toCandidate(it.record)), p, 'same record, same axes');
    assert.equal(axesOf(it), p, 'cached');
  }
  // Pieces of yours have only a palette; they still get every axis.
  const owned = axesOf({ id: 'blue', palette: [{ hex: '#1F2FA8', weight: 1 }] });
  assert.ok(owned.warm < 0.4, 'a blue print is cool');
  assert.equal(owned.abstract, 0.5);
});

test('the axes read the catalog the way a person would', () => {
  const avg = (list, a) => list.reduce((s, i) => s + pos(i, a), 0) / list.length;
  const cat = (c) => items.filter((i) => i.record.category === c);
  assert.ok(avg(cat('abstract'), 'abstract') > avg(cat('dogs'), 'abstract') + 0.4);
  assert.ok(items.filter((i) => i.record.medium === 'photo').every((i) => pos(i, 'print') === 0));
  assert.ok(items.filter((i) => i.record.color.bw).every((i) => pos(i, 'bw') === 1 && pos(i, 'warm') === 0.5 && pos(i, 'vivid') === 0.5));
  const bright = items.filter((i) => i.record.color.brightness > 0.8), dark = items.filter((i) => i.record.color.brightness < 0.3);
  assert.ok(avg(bright, 'light') > avg(dark, 'light') + 0.5);
});

test('the deeper test is deterministic for a seed and never shows a piece twice', () => {
  const run = (seed) => {
    const shown = new Set(), picks = [], out = [];
    for (let i = 0; i < 16; i++) {
      const pair = nextAxisPair(items, picks, shown, { seed });
      assert.ok(pair, `pair ${i}`);
      const [a, b] = pair;
      assert.ok(!shown.has(a.id) && !shown.has(b.id), 'no repeats');
      shown.add(a.id); shown.add(b.id);
      picks.push({ winner: pos(a, 'busy') <= pos(b, 'busy') ? a : b, loser: pos(a, 'busy') <= pos(b, 'busy') ? b : a });
      out.push(`${pair.axis}:${a.id}|${b.id}`);
    }
    return out;
  };
  const one = run(3);
  assert.deepEqual(run(3), one);
  // Sixteen pairs ask about every axis.
  assert.deepEqual(new Set(one.map((x) => x.split(':')[0])), new Set(AXIS_NAMES));
  // Subjects stay varied: no category in more than a quarter of the pieces.
  const cats = {};
  for (const x of one) for (const id of x.split(':')[1].split('|')) { const c = items.find((i) => i.id === id).record.category; cats[c] = (cats[c] || 0) + 1; }
  for (const [c, n] of Object.entries(cats)) assert.ok(n <= 8, `${c} shown ${n} times`);
});

test('the next pair splits the axis we know least about and holds the others about equal', () => {
  const picks = warmPicks(4);
  assert.ok(picks.length >= 4);
  const shown = new Set(picks.flatMap((p) => [p.winner.id, p.loser.id]));
  const least = axisUncertainty(picks)[0].axis;
  assert.notEqual(least, 'warm', 'warm is the axis we know most about');
  const pair = nextAxisPair(items, picks, shown, { seed: 1 });
  assert.equal(pair.axis, least);
  const [a, b] = pair;
  assert.ok(Math.abs(pos(a, least) - pos(b, least)) >= 0.5, `splits ${least}`);
  const others = AXIS_NAMES.filter((x) => x !== least && !(['warm', 'vivid'].includes(x) && (a.record.color.bw || b.record.color.bw)));
  const off = others.reduce((s, x) => s + Math.abs(pos(a, x) - pos(b, x)), 0) / others.length;
  assert.ok(off < 0.15, `others differ by ${off.toFixed(3)} on average`);
  // With no picks, every axis is equally unknown and the first one is asked first.
  assert.equal(nextAxisPair(items, [], new Set(), { seed: 1 }).axis, AXES[0].axis);
});

test('picking warm over cool every time reads as warm, in one plain sentence', () => {
  const prof = tasteProfile(warmPicks(6));
  const warm = prof.axes.find((a) => a.axis === 'warm');
  assert.ok(warm.lean > 0.4, `lean ${warm.lean}`);
  assert.ok(warm.sure >= PROFILE.sureMin, `sure ${warm.sure}`);
  assert.equal(warm.words, 'warm');
  assert.match(prof.summary, /^You lean warm\b/);
  assert.ok(!/cool/.test(prof.summary), prof.summary);
  assert.match(prof.summary, /no lean yet on/);
  assert.ok(!/[\u2014\u2013]/.test(prof.summary));
  assert.equal(prof.summary.split('.').length, 2, 'one sentence');
  for (const a of prof.axes) {
    assert.ok(a.lean >= -1 && a.lean <= 1 && a.sure >= 0 && a.sure <= 1);
    const ax = AXES.find((x) => x.axis === a.axis);
    assert.ok(a.words === null || a.words === ax.low || a.words === ax.high);
  }
  // Ids work as well as pieces.
  assert.deepEqual(tasteProfile(warmPicks(6).map((p) => [p.winner.id, p.loser.id]), items).axes, prof.axes);
  assert.equal(tasteProfile([]).summary, 'No lean yet: pick a few pairs and this fills in.');
});

test('correcting a line flips its lean, or clears it, and leaves the old profile alone', () => {
  const prof = tasteProfile(warmPicks(6));
  const before = JSON.stringify(prof);
  const cool = correctProfile(prof, { axis: 'warm', lean: 'cool' });
  const w = cool.axes.find((a) => a.axis === 'warm');
  assert.ok(w.lean < 0 && w.words === 'cool' && w.sure === 1 && w.corrected);
  assert.ok(cool.weights.warm < 0);
  assert.match(cool.summary, /cool/);
  assert.ok(!/warm/.test(cool.summary), cool.summary);
  assert.equal(cool.tagWeights[FEATURE_NAMES.indexOf('warm')], 0, 'the old warm tag weight stops counting');
  const none = correctProfile(prof, { axis: 'warm', lean: null });
  const n = none.axes.find((a) => a.axis === 'warm');
  assert.equal(n.lean, 0);
  assert.equal(n.words, null);
  assert.ok(!/warm|cool/.test(none.summary), none.summary);
  assert.equal(JSON.stringify(prof), before);
  // Corrections stack, and a corrected axis is never "no lean yet".
  const both = correctProfile(cool, { axis: 'print', lean: 0 });
  assert.ok(both.axes.find((a) => a.axis === 'warm').corrected && both.axes.find((a) => a.axis === 'print').corrected);
  assert.ok(!/photos vs prints/.test(both.summary), both.summary);
  assert.throws(() => correctProfile(prof, { axis: 'sparkly', lean: 1 }), TypeError);
  assert.throws(() => correctProfile(prof, { axis: 'warm', lean: 'sparkly' }), TypeError);
});

test('scoreProfile ranks warm pieces higher after warm picks, blending in the tag weights', () => {
  const prof = tasteProfile(warmPicks(6));
  const s = scoreProfile(prof, items);
  for (const v of Object.values(s)) assert.ok(v >= 0 && v <= 1);
  const avg = (list) => list.reduce((a, i) => a + s[i.id], 0) / list.length;
  const color = items.filter((i) => !i.record.color.bw);
  const warm = color.filter((i) => pos(i, 'warm') >= 0.8), cool = color.filter((i) => pos(i, 'warm') <= 0.25);
  assert.ok(avg(warm) > avg(cool) + 0.1, `${avg(warm)} vs ${avg(cool)}`);
  // Axes alone (no tag weights) still rank warm first; corrected to cool, cool first.
  const axesOnly = scoreProfile({ ...prof, tagWeights: null }, items);
  const avg2 = (m, list) => list.reduce((a, i) => a + m[i.id], 0) / list.length;
  assert.ok(avg2(axesOnly, warm) > avg2(axesOnly, cool) + 0.1);
  const flipped = scoreProfile(correctProfile(prof, { axis: 'warm', lean: 'cool' }), items);
  assert.ok(avg2(flipped, cool) > avg2(flipped, warm));
  assert.ok(Object.values(scoreProfile(null, items)).every((v) => v === 0.5));
  assert.ok(Object.values(scoreProfile(tasteProfile([]), items)).every((v) => v === 0.5));
});

// Synthetic pieces for complements: a palette, busyness, mood and style.
const piece = (id, hexes, busy, mood, style) => ({
  id,
  palette: hexes.map((hex, i) => ({ hex, weight: i ? 0.4 / (hexes.length - 1) : 0.6 })),
  record: {
    color: { palette: hexes.map((hex, i) => ({ hex, weight: i ? 0.4 / (hexes.length - 1) : 0.6 })), bw: false },
    composition: { busyness: busy },
    tags: { mood, style },
  },
});

test('complement is symmetric, within 0 and 1, and favors a calm piece beside a busy one over two busy clashing ones', () => {
  const sample = items.filter((_, i) => i % 23 === 0);
  for (const a of sample) for (const b of sample) {
    const v = complement(a, b);
    assert.ok(v >= 0 && v <= 1, `${a.id} ${b.id} ${v}`);
    assert.equal(v, complement(b, a));
  }
  const busyBlue = piece('busy-blue', ['#2B4C9B', '#E9ECF2', '#1A2A55'], 0.5, ['bold', 'playful'], ['graphic']);
  const calmBlue = piece('calm-blue', ['#E6E9F0', '#3A5BA8', '#C9D2E4'], 0.06, ['calm', 'elegant'], ['minimal', 'graphic']);
  const busyGreen = piece('busy-green', ['#7FB035', '#1E3A10', '#C4E07A'], 0.5, ['moody'], ['documentary']);
  const busyMagenta = piece('busy-magenta', ['#C2187A', '#F4C1DD', '#5A0B39'], 0.52, ['sunny'], ['film']);
  const pair = complement(calmBlue, busyBlue);
  const clash = complement(busyGreen, busyMagenta);
  assert.ok(pair > clash + 0.2, `${pair} vs ${clash}`);
  assert.ok(complement(calmBlue, busyBlue) > complement(busyBlue, piece('b2', ['#2B4C9B', '#E9ECF2', '#1A2A55'], 0.5, ['bold'], ['graphic'])), 'calm beside busy beats busy beside busy');
  // Pieces of yours (a palette only) work too.
  const mine = { id: 'mine', palette: [{ hex: '#2C2C8C', weight: 1 }] };
  const v = complement(mine, calmBlue);
  assert.ok(v > 0 && v < 1 && v === complement(calmBlue, mine));
});

test('wall complement only counts frames within 6 in of each other', () => {
  const a = piece('a', ['#2B4C9B', '#E9ECF2'], 0.5, ['bold'], ['graphic']);
  const b = piece('b', ['#E6E9F0', '#3A5BA8'], 0.06, ['calm'], ['minimal']);
  const art = new Map([[a.id, a], [b.id, b]]);
  const at = (id, x) => ({ ref: { id }, x, y: 40, w: 20, h: 20 });
  assert.equal(wallComplement([at('a', 10), at('b', 30 + COMPLEMENT.near)], art), complement(a, b));
  assert.equal(wallComplement([at('a', 10), at('b', 30 + COMPLEMENT.near + 1)], art), 0.5, 'too far apart: neutral');
});

test('rerank with complements stays deterministic and only swaps walls whose scores are within the weight', () => {
  const cat = testCatalog();
  const owned = [
    { id: 'blue', title: 'blue print', w: 23, h: 32, keep: 'happy', palette: [{ hex: '#2C2C8C', weight: 1 }] },
    { id: 'smiley', title: 'smiley print', w: 26, h: 18, keep: 'happy', palette: [{ hex: '#C8A040', weight: 1 }] },
  ];
  const r = layout({ ...livingRoom, owned, catalog: cat, taste: testTaste(cat), count: 16 });
  const art = [...cat, ...owned];
  const plain = rerank(r.layouts);
  const one = rerank(r.layouts, { art });
  const two = rerank(r.layouts, { art: new Map(art.map((x) => [x.id, x])) });
  assert.deepEqual(one.map((L) => [L.key, L.rankScore]), two.map((L) => [L.key, L.rankScore]));
  const base = new Map(plain.map((L) => [L.key, L.rankScore]));
  let moved = 0;
  for (const L of one) {
    const d = L.rankScore - base.get(L.key);
    assert.ok(Math.abs(d) <= COMPLEMENT.weight / 2 + 0.001, `${L.key} moved ${d}`);
    if (Math.abs(d) > 0.001) moved++;
  }
  assert.ok(moved > 0, 'the term does something');
  // Two walls whose base scores are more than the weight apart keep their order
  // (after the first wall, which is chosen by its own rule).
  const at = new Map(one.map((L, i) => [L.key, i]));
  for (let i = 1; i < plain.length; i++) for (let j = i + 1; j < plain.length; j++) {
    if (plain[i].rankScore - plain[j].rankScore > COMPLEMENT.weight + 0.002 && at.get(plain[i].key) > 0 && at.get(plain[j].key) > 0) {
      assert.ok(at.get(plain[i].key) < at.get(plain[j].key), `${plain[i].key} before ${plain[j].key}`);
    }
  }
});
