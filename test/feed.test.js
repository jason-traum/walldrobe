import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, readFeed, parseSizes, parsePrice, cleanTitle, categoryOf, isWallArt, toTsv } from '../tools/feed.js';

const rows = parseCsv(readFileSync(new URL('./fixtures/feed_impact.csv', import.meta.url), 'utf8'));
const { picks, dropped } = readFeed(rows, { merchant: 'example' });
const byTitle = (t) => picks.find((p) => p.title === t);

test('a feed becomes one piece per artwork, with every size and frame as an offer', () => {
  const p = byTitle('Coastal Morning');
  assert.ok(p, picks.map((x) => x.title).join(', '));
  assert.equal(p.artist, 'Ana Example');
  assert.equal(p.category, 'coast');
  assert.deepEqual(p.offers.map((o) => [o.w, o.h, o.price, o.framed]), [[8, 10, 24, false], [16, 20, 58, false], [16, 20, 129, true]]);
});

test('mugs, sold-out pieces, plain http links and pieces with no artist are left out', () => {
  assert.equal(picks.length, 3, picks.map((x) => x.title).join(', '));
  assert.equal(dropped['not wall art'], 1);
  assert.equal(dropped['out of stock'], 1);
  assert.equal(dropped['no https link or image'], 1);
  assert.equal(dropped['no artist named'], 1);
});

test('the brand is the artist when the title has no "by"', () => {
  const p = byTitle('Lemon Grove');
  assert.equal(p.artist, 'Ben Sample');
  assert.equal(p.offers[0].framed, true);
  assert.deepEqual([p.offers[0].w, p.offers[0].h], [18, 24]);
});

test('sizes read in inches, centimeters and A sizes', () => {
  assert.deepEqual(parseSizes('16 x 20 in'), [{ w: 16, h: 20 }]);
  assert.deepEqual(parseSizes('24" x 36"'), [{ w: 24, h: 36 }]);
  assert.deepEqual(parseSizes('50x70', { currency: 'EUR' }), [{ w: 19.5, h: 27.5 }]);
  assert.deepEqual(parseSizes('30 x 40 cm'), [{ w: 12, h: 15.5 }]);
  assert.deepEqual(parseSizes('A3'), [{ w: 11.5, h: 16.5 }]);
  assert.deepEqual(parseSizes('Large'), []);
  assert.deepEqual(byTitle('Blue Shapes').offers.map((o) => o.price), [39.95]);
});

test('prices, titles and categories', () => {
  assert.equal(parsePrice('$1,299.00'), 1299);
  assert.equal(parsePrice('1.299,00'), 1299);
  assert.equal(parsePrice(''), null);
  assert.equal(cleanTitle('Coastal Morning by Ana Example | 16x20 Art Print'), 'Coastal Morning');
  assert.ok(!/[\u2013\u2014]/.test(cleanTitle('Sun \u2014 Sea \u2013 Sand')));
  assert.equal(categoryOf({ title: 'Blue Shapes', category: 'Posters', description: 'Abstract geometric poster' }), 'graphic');
  assert.equal(isWallArt({ title: 'Ocean Throw Pillow', category: 'Home' }), false);
});

test('the analyzer file keeps offers as JSON in the last column', () => {
  const lines = toTsv(picks, 'example').trim().split('\n');
  assert.equal(lines.length, picks.length + 1);
  const cols = lines[1].split('\t');
  assert.equal(cols.length, 8);
  assert.ok(Array.isArray(JSON.parse(cols[7])));
});
