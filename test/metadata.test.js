import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const records = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;

test('every piece was looked at: description, setting, time, season, vibe and a quality score', () => {
  for (const r of records.filter((x) => x.status === 'active' || !x.source.name)) {
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
  assert.ok(hidden.length > 0 && hidden.length < records.length * 0.08, `${hidden.length} hidden`);
});

test('art comes from more than one site, each credited its own way', () => {
  const by = {};
  for (const r of records) by[r.source.provider] = (by[r.source.provider] || 0) + 1;
  for (const site of ['pexels', 'pixabay', 'unsplash']) assert.ok(by[site] > 0, `no ${site}`);
  for (const r of records.filter((x) => !x.source.name)) assert.ok(r.rights.credit.endsWith(`on ${r.source.provider[0].toUpperCase()}${r.source.provider.slice(1)}`), r.id);
});

test('prints from shops show the shop image, link to the shop and carry real sizes and prices', () => {
  const shop = records.filter((r) => r.source.name);
  assert.ok(shop.length >= 200, `${shop.length} shop prints`);
  for (const r of shop) {
    assert.match(r.image.src, /^https:\/\//, `${r.id} should not be re-hosted`);
    assert.ok(r.offers.length && r.offers.every((o) => /^https:\/\//.test(o.url) && o.price > 0 && o.w > 0), r.id);
    assert.ok(r.sizes.every((s) => s.price > 0), `${r.id} sizes need prices`);
  }
});
