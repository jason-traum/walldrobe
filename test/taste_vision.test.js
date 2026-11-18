// The taste test with image scores: good-looking art only, pairs about as good as each
// other, and a meter of how well we know you that climbs toward 1 and never reaches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toCandidate, activeRecords } from '../engine/catalog.js';
import { nextPair, tasteKnown, looksGood, fitTaste, describeTaste, FEATURE_NAMES, features } from '../engine/taste.js';

const recs = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;
const cat = activeRecords(recs).map(toCandidate);

function run(n, prefer) {
  const shown = new Set(), picks = [], pairs = [];
  for (let i = 0; i < n; i++) {
    const p = nextPair(cat, picks, shown);
    if (!p) break;
    pairs.push(p);
    p.forEach((x) => shown.add(x.id));
    picks.push(prefer(p[0]) >= prefer(p[1]) ? { winner: p[0], loser: p[1] } : { winner: p[1], loser: p[0] });
  }
  return { picks, pairs };
}

test('every catalog piece has image scores', () => {
  for (const c of cat) assert.ok(c.record.vision && typeof c.record.vision.looks === 'number', c.id);
  assert.equal(features(cat[0]).length, FEATURE_NAMES.length);
});

test('the quiz shows good-looking art, two about as good as each other', () => {
  const { pairs } = run(14, (x) => x.id);
  const median = [...cat].map(looksGood).sort((a, b) => a - b)[Math.floor(cat.length / 2)];
  for (const [a, b] of pairs) {
    assert.ok(looksGood(a) >= median && looksGood(b) >= median, `${a.id} ${looksGood(a)} or ${b.id} ${looksGood(b)} below the middle`);
  }
  for (const [a, b] of pairs.slice(4)) assert.ok(Math.abs(looksGood(a) - looksGood(b)) <= 0.15 + 1e-9, `${a.id} and ${b.id} differ in looks`);
});

test('how well we know your taste climbs with every pick and never reaches 1', () => {
  const { picks } = run(40, (x) => (x.record.color.bw ? 0 : 1) + x.record.vision.concepts[0]);
  let last = -1;
  for (const n of [0, 1, 5, 10, 20, 40]) {
    const k = tasteKnown(picks.slice(0, n)).known;
    assert.ok(k > last || (n === 0 && k === 0), `${n} picks: ${k} after ${last}`);
    assert.ok(k < 1);
    last = k;
  }
  assert.equal(tasteKnown(picks).unsure.length, 3);
});

test('what you like and what you are less into, in words', () => {
  const { picks } = run(30, (x) => (x.record.color.bw ? 0 : 1));
  const w = fitTaste(picks);
  const like = describeTaste(w, 4), less = describeTaste(w, 3, -1);
  assert.ok(like.length > 0 && less.length > 0);
  assert.ok(!like.some((x) => less.includes(x)));
  assert.ok(less.includes('black and white') || !like.includes('black and white'));
});

// Nov 18: the test draws its art again for every pair, sinks generic pieces, drops subjects
// you turned down, leans toward what you like, and differs per person by a seed.
import { genericScores } from '../engine/taste.js';

test('generic scores run 0 to 1, and a run of look-alikes scores higher than a one-off', () => {
  const g = genericScores(cat);
  const v = [...g.values()];
  assert.equal(v.length, cat.length);
  assert.ok(Math.min(...v) === 0 && Math.max(...v) === 1);
  const byCat = (c) => cat.filter((x) => x.record.category === c).map((x) => g.get(x.id));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(mean(byCat('landscape')) > mean(byCat('sculpture')), 'soft landscapes read more generic than sculpture');
  assert.equal(genericScores(cat), g, 'worked out once per catalog');
});

test('the same seed gives the same pairs, another seed other art', () => {
  const ids = (seed) => { const shown = new Set(), out = []; for (let i = 0; i < 6; i++) { const p = nextPair(cat, [], shown, { seed }); p.forEach((x) => { shown.add(x.id); out.push(x.id); }); } return out.join(); };
  assert.equal(ids(11), ids(11));
  assert.notEqual(ids(11), ids(12));
});

test('a subject you keep turning down stops showing up', () => {
  const shown = new Set(), picks = [];
  let late = 0;
  for (let i = 0; i < 16; i++) {
    const p = nextPair(cat, picks, shown, { seed: 5 });
    if (!p) break;
    p.forEach((x) => shown.add(x.id));
    const dog = p.find((x) => x.record.category === 'dogs');
    if (i >= 10 && dog) late++;
    const other = p.find((x) => x !== dog);
    picks.push(dog ? { winner: other, loser: dog } : { winner: p[0], loser: p[1] });
  }
  // Seeded dogs into the losses so the subject has three clear losses.
  const dogs = cat.filter((x) => x.record.category === 'dogs').slice(0, 3);
  const extra = dogs.map((d, k) => ({ winner: cat.find((x) => x.record.category === 'flowers' && !shown.has(x.id) && k >= 0), loser: d }));
  const after = nextPair(cat, [...picks, ...extra, ...extra], shown, { seed: 5 });
  assert.ok(after && after.every((x) => x.record.category !== 'dogs'));
});

test('with a seed, the test shows art that reads as art and looks good', () => {
  const shown = new Set(), picks = [];
  for (let i = 0; i < 14; i++) {
    const p = nextPair(cat, picks, shown, { seed: 9 });
    p.forEach((x) => shown.add(x.id));
    for (const x of p) assert.ok(looksGood(x) >= 0.55, `${x.id} looks ${looksGood(x)}`);
    picks.push({ winner: p[0], loser: p[1] });
  }
});
