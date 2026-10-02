// Catalog health: gone offers and gone pieces stay out of what the engine sees,
// the health shape is validated, and tools/check_catalog.mjs classifies urls right.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { validateRecord, toCandidate, activeRecords, liveOffers } from '../engine/catalog.js';
import { classify, landedOnHome, checkUrl, checkMany, applyHealth, auditRecord, auditCatalog, placeholderTitle } from '../tools/check_catalog.mjs';

const records = JSON.parse(readFileSync(new URL('../demo/catalog.json', import.meta.url))).items;
// A shop piece whose offers have their own urls (one per size), so one can be gone while another lives.
const shopRecord = records.find((r) => r.status === 'active' && r.offers.length >= 2 && new Set(r.offers.map((o) => o.url)).size === r.offers.length);
const clone = (r) => JSON.parse(JSON.stringify(r));
const SINCE = '2026-10-01T12:00:00.000Z';

test('a gone offer is not a candidate offer', () => {
  const r = clone(shopRecord);
  r.offers[0].gone = true;
  r.offers[0].since = SINCE;
  assert.deepEqual(validateRecord(r), []);
  const c = toCandidate(r);
  assert.equal(c.offers.length, r.offers.length - 1);
  assert.ok(c.offers.every((o) => !o.gone));
  assert.equal(liveOffers(r).length, r.offers.length - 1);
});

test('a piece whose every offer is gone is not active', () => {
  const r = clone(shopRecord);
  for (const o of r.offers) { o.gone = true; o.since = SINCE; }
  r.health = { gone: true, since: SINCE, why: 'offer' };
  assert.deepEqual(validateRecord(r), []);
  assert.equal(activeRecords([r]).length, 0);
  assert.equal(toCandidate(r).offers.length, 0);
});

test('a piece with one live offer stays active and keeps only that offer', () => {
  const r = clone(shopRecord);
  for (const o of r.offers.slice(1)) { o.gone = true; o.since = SINCE; }
  assert.deepEqual(validateRecord(r), []);
  assert.equal(activeRecords([r]).length, 1);
  assert.deepEqual(toCandidate(r).offers, [r.offers[0]]);
});

test('a piece whose image is gone is not active even with live offers', () => {
  const r = clone(shopRecord);
  r.health = { gone: true, since: SINCE, why: 'image' };
  assert.deepEqual(validateRecord(r), []);
  assert.equal(activeRecords([r]).length, 0);
});

test('the health shape is validated', () => {
  const bad = [
    { gone: false, since: SINCE, why: 'offer' },
    { gone: true, why: 'offer' },
    { gone: true, since: 'yesterday', why: 'offer' },
    { gone: true, since: SINCE, why: 'shop' },
    { gone: true, since: SINCE },
    'gone',
  ];
  for (const h of bad) {
    const r = clone(shopRecord);
    r.health = h;
    assert.ok(validateRecord(r).some((e) => /health must be/.test(e)), `accepted ${JSON.stringify(h)}`);
  }
  for (const why of ['offer', 'image', 'both']) {
    const r = clone(shopRecord);
    r.health = { gone: true, since: SINCE, why };
    assert.deepEqual(validateRecord(r), []);
  }
  const r = clone(shopRecord);
  r.offers[0].gone = 'yes';
  assert.ok(validateRecord(r).some((e) => /gone: true/.test(e)));
});

test('applyHealth flags gone offers, lifts flags when a listing is back, and leaves unknown alone', () => {
  const r = clone(shopRecord);
  const health = { checkedAt: SINCE, items: [{ id: r.id, offers: r.offers.map((o, i) => ({ url: o.url, status: i === 0 ? 'gone' : 'ok' })), image: { url: r.image.src, status: 'ok' } }] };
  let changed = applyHealth([r], health);
  assert.equal(changed.offersGone, 1);
  assert.equal(r.offers[0].gone, true);
  assert.equal(r.offers[0].since, SINCE);
  assert.equal(r.health, undefined, 'one offer is still live');

  for (const o of health.items[0].offers) o.status = 'gone';
  changed = applyHealth([r], health);
  assert.equal(changed.itemsGone, 1);
  assert.deepEqual(r.health, { gone: true, since: SINCE, why: 'offer' });

  health.items[0].image.status = 'gone';
  applyHealth([r], health);
  assert.equal(r.health.why, 'both');

  // The shop would not answer: nothing moves.
  for (const o of health.items[0].offers) o.status = 'unknown';
  health.items[0].image.status = 'unknown';
  applyHealth([r], health);
  assert.equal(r.health.why, 'both');

  // Everything is back.
  for (const o of health.items[0].offers) o.status = 'ok';
  health.items[0].image.status = 'ok';
  changed = applyHealth([r], health);
  assert.equal(changed.itemsBack, 1);
  assert.equal(r.health, undefined);
  assert.ok(r.offers.every((o) => !o.gone));
  assert.deepEqual(validateRecord(r), []);
});

test('the demo catalog has no gone pieces and no gone offers', () => {
  assert.equal(records.filter((r) => r.health && r.health.gone).length, 0);
  assert.equal(records.reduce((a, r) => a + r.offers.filter((o) => o.gone).length, 0), 0);
});

test('a redirect to the shop home or a category page counts as gone, a product redirect does not', () => {
  const product = 'https://shop.example/products/blue-pool-print?variant=1';
  assert.equal(landedOnHome(product, 'https://shop.example/'), true);
  assert.equal(landedOnHome(product, 'https://shop.example/collections/all'), true);
  assert.equal(landedOnHome(product, 'https://www.shop.example/'), true);
  assert.equal(landedOnHome(product, 'https://shop.example/products/blue-pool-print'), false);
  assert.equal(landedOnHome(product, 'https://shop.example/en-us/products/blue-pool-print'), false);
  assert.equal(landedOnHome(product, product), false);
  assert.equal(classify(product, { status: 404, finalUrl: product }), 'gone');
  assert.equal(classify(product, { status: 410, finalUrl: product }), 'gone');
  assert.equal(classify(product, { status: 200, finalUrl: product }), 'ok');
  assert.equal(classify(product, { status: 200, finalUrl: 'https://shop.example/' }), 'gone');
  assert.equal(classify(product, { status: 403, finalUrl: product }), 'unknown');
  assert.equal(classify(product, { status: 503, finalUrl: product }), 'unknown');
});

test('checkUrl against a local server: HEAD, ranged GET fallback, 404, redirect home, retries and timeout', async () => {
  let flaky = 0;
  const server = createServer((req, res) => {
    const path = req.url;
    if (path === '/products/ok') { res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : 'x'); return; }
    if (path === '/products/missing') { res.writeHead(404); res.end(); return; }
    if (path === '/products/home-now') { res.writeHead(302, { Location: '/' }); res.end(); return; }
    if (path === '/') { res.writeHead(200); res.end('home'); return; }
    if (path === '/products/no-head') {
      if (req.method === 'HEAD') { res.writeHead(405); res.end(); return; }
      assert.equal(req.headers.range, 'bytes=0-0');
      res.writeHead(206); res.end('x'); return;
    }
    if (path === '/products/flaky') { flaky++; if (flaky < 3) { req.socket.destroy(); return; } res.writeHead(200); res.end(); return; }
    if (path === '/products/slow') { return; /* never answers */ }
    res.writeHead(500); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const opts = { timeout: 400, tries: 3, retryDelay: 10, spacing: 5, concurrency: 6 };
  try {
    const urls = ['ok', 'missing', 'home-now', 'no-head', 'flaky', 'slow', 'boom'].map((p) => `${base}/products/${p}`);
    const started = Date.now();
    const results = await checkMany(urls, opts);
    const r = (p) => results.get(`${base}/products/${p}`);
    assert.equal(r('ok').status, 'ok');
    assert.equal(r('ok').method, 'HEAD');
    assert.equal(r('missing').status, 'gone');
    assert.equal(r('missing').http, 404);
    assert.equal(r('home-now').status, 'gone');
    assert.equal(r('home-now').finalUrl, `${base}/`);
    assert.equal(r('no-head').status, 'ok');
    assert.equal(r('no-head').method, 'GET');
    assert.equal(r('flaky').status, 'ok');
    assert.equal(r('flaky').tries, 3);
    assert.equal(r('slow').status, 'gone');
    assert.match(r('slow').error, /timeout/);
    assert.equal(r('slow').tries, 3);
    assert.equal(r('boom').status, 'unknown');
    assert.ok(Date.now() - started < 5000, 'ran in parallel');
    const one = await checkUrl(`${base}/products/ok`, opts);
    assert.equal(one.status, 'ok');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('the metadata audit names weak fields and skips good records', () => {
  const good = clone(shopRecord);
  const weak = auditRecord(good, { imageSeen: new Map() });
  assert.ok(weak.every((w) => /subject tag|crop marked/.test(w)), weak.join('; '));

  const r = clone(shopRecord);
  r.title = 'Untitled';
  r.description = '';
  r.artist = { name: '' };
  r.tags.subjects = ['one'];
  for (const o of r.offers) { delete o.price; delete o.w; delete o.h; }
  delete r.image.aspect;
  const out = auditRecord(r, { imageSeen: new Map([[r.image.src, 2]]) });
  for (const want of ['no price on any offer', 'with no size', 'image aspect missing', '1 subject tag', 'no artist', 'no description', 'shared by 2 items', 'placeholder title']) {
    assert.ok(out.some((w) => w.includes(want)), `${want} in ${out.join('; ')}`);
  }
  const free = clone(records.find((x) => x.source.provider === 'unsplash'));
  delete free.source.license;
  assert.ok(auditRecord(free).includes('free photo with no license'));

  assert.equal(placeholderTitle('Forest Pony'), false);
  assert.equal(placeholderTitle('Untitled'), true);
  assert.equal(placeholderTitle('IMG_4021'), true);
  assert.equal(placeholderTitle('u-123', 'u-123'), true);
  assert.equal(placeholderTitle('2024'), true);

  const audit = auditCatalog([good, r]);
  assert.equal(audit.items, 2);
  assert.ok(audit.counts['placeholder title'] === 1);
  assert.equal(audit.worst[0].id, r.id);
});
