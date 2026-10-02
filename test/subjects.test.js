import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subjectOf, subjectStats, subjectFactor, dislikedSubjects, nextAdaptivePair, axesOf } from '../engine/taste.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';

const records = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;
const items = activeRecords(records).map(toCandidate);
const byId = new Map(items.map((c) => [c.id, c]));
const of = (s) => items.filter((c) => subjectOf(c) === s);

test('two lost pairs make a subject disliked, and it pulls a piece down whatever its style', () => {
  const horses = of('horses'), sea = of('coast');
  const picks = [{ winner: sea[0], loser: horses[0] }, { winner: sea[1], loser: horses[1] }];
  const st = subjectStats({ picks }, byId);
  assert.ok(dislikedSubjects(st).includes('horses'));
  assert.ok(subjectFactor(st, new Set(), 'horses') < 0.6, 'a disliked subject is pulled down hard');
  assert.ok(subjectFactor(st, new Set(), 'coast') > 1, 'a liked subject is lifted a little');
  assert.equal(subjectFactor(st, new Set(), 'golf'), 1, 'an untested subject is left alone');
});

test('never means out', () => {
  assert.equal(subjectFactor(new Map(), new Set(['cars']), 'cars'), 0);
});

test('one swap away is weak evidence, not a dislike', () => {
  const st = subjectStats({ skipped: [of('dogs')[0].id] }, byId);
  assert.ok(!dislikedSubjects(st).includes('dogs'));
  assert.ok(subjectFactor(st, new Set(), 'dogs') > 0.85);
});

test('the adaptive test stops showing a subject once it is turned down or set to never', () => {
  const horses = of('horses'), sea = of('coast');
  const picks = [{ winner: sea[0], loser: horses[0] }, { winner: sea[1], loser: horses[1] }];
  const shown = new Set(picks.flatMap((p) => [p.winner.id, p.loser.id]));
  for (let seed = 1; seed <= 12; seed++) {
    const pair = nextAdaptivePair(items, picks, shown, { seed, never: new Set(['cars']) });
    assert.ok(pair && pair.length === 2);
    for (const c of pair) { assert.notEqual(subjectOf(c), 'horses'); assert.notEqual(subjectOf(c), 'cars'); }
  }
});

test('some rounds test subjects: two pieces of different subjects, close in style', () => {
  const picks = [{ winner: of('sea').length ? of('sea')[0] : of('coast')[0], loser: of('abstract')[0] }];
  const pair = nextAdaptivePair(items, picks, new Set(picks.flatMap((p) => [p.winner.id, p.loser.id])), { seed: 3 });
  assert.ok(pair.subject, 'the second round is a subject round');
  assert.notEqual(subjectOf(pair[0]), subjectOf(pair[1]));
  const a = axesOf(pair[0]), b = axesOf(pair[1]);
  const off = Object.keys(a).reduce((s, k) => s + Math.abs(a[k] - b[k]), 0);
  assert.ok(off < 2.5, `alike in style (${off.toFixed(2)})`);
});
