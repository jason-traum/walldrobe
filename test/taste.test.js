import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitTaste, scoreTaste, nextPair, features, describeTaste, FEATURE_NAMES } from '../engine/taste.js';
import { validateCatalog, toCandidate, activeRecords } from '../engine/catalog.js';
import { layout } from '../engine/index.js';
import { WALLS } from '../demo/samples.js';

const records = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;
const items = activeRecords(records).map(toCandidate);
const of = (cat) => items.filter((i) => i.record.category === cat);

test('the demo catalog has at least 200 pieces and every record passes the schema', () => {
  assert.ok(records.length >= 200, `${records.length} records`);
  assert.deepEqual(validateCatalog(records), []);
});

test('no subject crowds the catalog', () => {
  const counts = {};
  for (const r of records) counts[r.category] = (counts[r.category] || 0) + 1;
  for (const [c, n] of Object.entries(counts)) assert.ok(n <= 20, `${c}: ${n}`);
});

test('every piece can be credited and none can be sold', () => {
  for (const r of records) {
    assert.match(r.rights.credit, /^Photo by .+ on Unsplash$/);
    assert.equal(r.rights.sell, false);
  }
});

test('features have a fixed length and no NaN', () => {
  for (const it of items) {
    const f = features(it);
    assert.equal(f.length, FEATURE_NAMES.length);
    assert.ok(f.every(Number.isFinite), it.id);
  }
});

test('picking pools over everything makes summer pieces score highest', () => {
  const pools = of('pool'), others = [...of('abstract'), ...of('city'), ...of('food')];
  const picks = pools.slice(0, 6).map((p, i) => ({ winner: p, loser: others[i * 3] }));
  const s = scoreTaste(fitTaste(picks), items);
  const avg = (list) => list.reduce((a, i) => a + s[i.id], 0) / list.length;
  const summer = items.filter((i) => i.record.tags.theme === 'summer');
  const stillLife = items.filter((i) => i.record.tags.theme === 'still life');
  assert.ok(avg(summer) > avg(stillLife) + 0.1, `${avg(summer)} vs ${avg(stillLife)}`);
  for (const v of Object.values(s)) assert.ok(v >= 0.2 && v <= 0.9);
  assert.ok(describeTaste(fitTaste(picks)).length > 0);
});

test('picking black and white teaches black and white', () => {
  const bw = items.filter((i) => i.record.color.bw), color = items.filter((i) => !i.record.color.bw && i.record.color.colorfulness > 0.5);
  const picks = bw.slice(0, 6).map((p, i) => ({ winner: p, loser: color[i] }));
  const s = scoreTaste(fitTaste(picks), items);
  const avg = (list) => list.reduce((a, i) => a + s[i.id], 0) / list.length;
  assert.ok(avg(bw) > avg(color) + 0.15);
  assert.ok(describeTaste(fitTaste(picks)).includes('black and white'));
});

test('no picks means neutral taste and no words', () => {
  assert.ok(Object.values(scoreTaste(null, items)).every((v) => v === 0.5));
  assert.deepEqual(describeTaste(null), []);
});

test('a ten-pair quiz never repeats a piece or a category within a pair', () => {
  const shown = new Set();
  const picks = [];
  for (let i = 0; i < 10; i++) {
    const pair = nextPair(items, picks, shown);
    assert.ok(pair, `pair ${i}`);
    const [a, b] = pair;
    assert.ok(!shown.has(a.id) && !shown.has(b.id), 'no repeats');
    assert.notEqual(a.record.category, b.record.category);
    shown.add(a.id); shown.add(b.id);
    picks.push({ winner: a.record.color.bw ? a : b, loser: a.record.color.bw ? b : a });
  }
});

test('the quiz is deterministic', () => {
  const ids = () => nextPair(items, [], new Set()).map((x) => x.id);
  assert.deepEqual(ids(), ids());
});

test('every demo wall gets three layouts from the real catalog, quickly', () => {
  const t0 = performance.now();
  for (const w of WALLS) {
    const r = layout({ ...w, catalog: items, taste: scoreTaste(null, items) });
    assert.equal(r.layouts.length, 3, w.name);
  }
  assert.ok(performance.now() - t0 < 2000);
});

test('the quiz gives a black-and-white lover real choices, and learns it', () => {
  const shown = new Set(), picks = [];
  let real = 0;
  for (let i = 0; i < 10; i++) {
    const [a, b] = nextPair(items, picks, shown);
    shown.add(a.id); shown.add(b.id);
    if (a.record.color.bw !== b.record.color.bw) real++;
    const pick = a.record.color.bw ? a : b.record.color.bw ? b : (a.record.color.saturation < b.record.color.saturation ? a : b);
    picks.push({ winner: pick, loser: pick === a ? b : a });
  }
  assert.ok(real >= 3, `${real} of 10 pairs had exactly one black-and-white piece`);
  const words = describeTaste(fitTaste(picks));
  assert.ok(words.includes('black and white'), words.join(', '));
});

test('skipping every pair still gives fresh pairs that contrast themes', () => {
  const shown = new Set();
  for (let i = 0; i < 12; i++) {
    const pair = nextPair(items, [], shown);
    assert.ok(pair, `pair ${i}`);
    assert.notEqual(pair[0].record.tags.theme, pair[1].record.tags.theme);
    pair.forEach((p) => shown.add(p.id));
  }
});

test('taste words never repeat an idea or contradict themselves', () => {
  const groups = [['bold color', 'vivid color'], ['paintings and graphic art', 'paintings', 'painterly'], ['sunny', 'moody and dark', 'light and bright'], ['calm', 'lots going on', 'lots of empty space', 'minimal']];
  for (let seed = 1; seed <= 300; seed++) {
    let x = seed;
    const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const w = Array.from({ length: 36 }, () => rnd() * 2 - 1);
    const words = describeTaste(w, 3);
    for (const g of groups) assert.ok(words.filter((v) => g.includes(v)).length <= 1, words.join(', '));
  }
});

test('the blue vase is blue, and ski photos are sport', () => {
  const find = (t) => records.find((r) => r.title === t);
  assert.equal(find('Blue ceramic vase').color.bw, false);
  assert.equal(find('Blue ceramic vase').color.dominant, 'blue');
  assert.ok(records.filter((r) => r.category === 'ski').every((r) => r.tags.theme === 'sport'));
  assert.equal(find('Five swimmers').tags.people, true);
});
