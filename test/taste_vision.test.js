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
