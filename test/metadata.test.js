import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const records = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;

test('every piece was looked at: description, setting, time, season, vibe and a quality score', () => {
  for (const r of records) {
    assert.equal(r.provenance.tags, 'model', `${r.id} tags were not reviewed`);
    assert.ok(r.description && r.description.split(' ').length >= 3, `${r.id} has no description`);
    for (const k of ['setting', 'time', 'season']) assert.ok(r.tags[k], `${r.id} has no ${k}`);
    assert.ok(r.tags.vibe.length >= 1, `${r.id} has no vibe words`);
    assert.ok(r.tags.subjects.length >= 1 && r.tags.subjects.length <= 5, `${r.id} subjects`);
    assert.equal(typeof r.quality.score, 'number', `${r.id} has no quality score`);
  }
});

test('near-duplicates and weak photos are hidden, and only a few', () => {
  const hidden = records.filter((r) => r.status === 'hidden');
  assert.ok(hidden.length > 0 && hidden.length < records.length * 0.05, `${hidden.length} hidden`);
});

test('art comes from more than one site, each credited its own way', () => {
  const by = {};
  for (const r of records) by[r.source.provider] = (by[r.source.provider] || 0) + 1;
  assert.deepEqual(Object.keys(by).sort(), ['pexels', 'pixabay', 'unsplash']);
  for (const r of records) assert.ok(r.rights.credit.endsWith(`on ${r.source.provider[0].toUpperCase()}${r.source.provider.slice(1)}`), r.id);
});
