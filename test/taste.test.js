import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitTaste, scoreTaste, quizPairs, features } from '../engine/taste.js';
import { layout } from '../engine/index.js';
import { WALLS } from '../demo/samples.js';

const items = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;
const of = (cat) => items.filter((i) => i.category === cat);

test('every demo piece has a palette, sizes, a credit and a link', () => {
  assert.ok(items.length >= 60);
  for (const it of items) {
    assert.ok(it.palette.length && it.sizes.length && it.artist && /^https:\/\/unsplash\.com\/photos\//.test(it.url), it.id);
    assert.equal(features(it).length, features(items[0]).length);
  }
});

test('picking pools over everything makes pools score highest', () => {
  const picks = of('pool').slice(0, 4).flatMap((p, i) => [{ winner: p, loser: of('abstract')[i] }, { winner: p, loser: of('architecture')[i] }]);
  const scores = scoreTaste(fitTaste(picks), items);
  const avg = (cat) => of(cat).reduce((s, i) => s + scores[i.id], 0) / of(cat).length;
  assert.ok(avg('pool') > avg('abstract') + 0.2, `${avg('pool')} vs ${avg('abstract')}`);
  for (const v of Object.values(scores)) assert.ok(v >= 0.2 && v <= 0.9);
});

test('no picks means neutral taste', () => {
  const s = scoreTaste(null, items);
  assert.ok(Object.values(s).every((v) => v === 0.5));
});

test('the quiz has seven distinct pairs from different categories', () => {
  const pairs = quizPairs(items, 7);
  assert.equal(pairs.length, 7);
  for (const [a, b] of pairs) assert.notEqual(a.category, b.category);
  assert.equal(new Set(pairs.flat().map((p) => p.id)).size, 14);
});

test('every demo wall gets three layouts from the real catalog', () => {
  for (const w of WALLS) {
    const r = layout({ ...w, catalog: items, taste: scoreTaste(null, items) });
    assert.equal(r.layouts.length, 3, w.name);
  }
});
