// "Not for me": the piece never comes back, and art like it comes up less.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subjectOf, subjectStats, subjectFactor, dislikeFactor, features } from '../engine/taste.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';

const records = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;
const items = activeRecords(records).map(toCandidate);
const byId = new Map(items.map((c) => [c.id, c]));
const cos = (a, b) => { const f = features(a), g = features(b); const d = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0); return d(f, g) / Math.sqrt(d(f, f) * d(g, g)); };

test('one "not for me" pulls its subject down, more than one swap away does', () => {
  const x = items.find((c) => subjectOf(c));
  const s = subjectOf(x);
  const no = subjectStats({ disliked: [x.id] }, byId);
  const swap = subjectStats({ skipped: [x.id] }, byId);
  assert.ok(subjectFactor(no, null, s) < subjectFactor(swap, null, s), `${subjectFactor(no, null, s)} vs ${subjectFactor(swap, null, s)}`);
  assert.ok(subjectFactor(no, null, s) < 0.75);
});

test('art close to a disliked piece scores lower than art unlike it, and nothing goes to zero', () => {
  const x = items[0];
  const others = items.slice(1).map((c) => ({ c, sim: cos(x, c) })).sort((a, b) => b.sim - a.sim);
  const near = others[0].c, far = others[others.length - 1].c;
  const fn = dislikeFactor(near, [x]), ff = dislikeFactor(far, [x]);
  assert.ok(fn < ff, `near ${fn} vs far ${ff}`);
  assert.equal(ff, 1, 'unlike pieces are left alone');
  for (const { c } of others) { const f = dislikeFactor(c, [x]); assert.ok(f >= 0.35 && f <= 1, `${c.id} ${f}`); }
});

test('no dislikes, no change', () => {
  assert.equal(dislikeFactor(items[3], []), 1);
});
