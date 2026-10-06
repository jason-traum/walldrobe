// Catalog health: which pieces are still for sale, which images still load,
// and which records carry weak metadata.
//
//   node tools/check_catalog.mjs            check every offer url and image over the network, write tools/health.json
//   node tools/check_catalog.mjs --dry      metadata audit only, no network
//   node tools/check_catalog.mjs --apply    merge tools/health.json back into demo/catalog.json (gone flags)
//
// Options:
//   --catalog <path>        default demo/catalog.json
//   --out <path>            default tools/health.json (tools/health.dry.json for --dry)
//   --concurrency <n>       default 6 requests in flight
//   --timeout <ms>          default 15000 per request
//   --spacing <ms>          default 300 between two requests to the same host
//   --tries <n>             default 3 attempts before a network failure counts as gone
//   --limit <n>             only the first n items (for a quick look)
//   --only <id,id>          only these ids
//   --base-override <url>   test hook: every url keeps its path but points at this origin
//   --no-pages              skip the source page of free photos (only offers and images)
//   --no-shopify            check Shopify offer links one by one instead of one product JSON each
//   --product-spacing <ms>  default 1000 between two Shopify product JSON requests (a 429 waits and asks again)
//
// Gone means: 404 or 410, a redirect that lands on the shop's home or a category
// page, or a network failure on every try. Anything else that is not a plain
// success (403, 429, 5xx) is "unknown": the shop would not say, so nothing changes.
//
// The engine stays pure. This tool is the only place the catalog touches the network.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Walldrobe-catalog-check/1.0';

// ---------- url checks ----------

const pathOf = (u) => { try { return new URL(u).pathname.replace(/\/+$/, ''); } catch { return ''; } };
const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

// Did a redirect drop us on a home or category page instead of the product?
// Yes when the final url is a host root, or when it lost the product slug (the
// last path segment) and is no deeper than the one we asked for.
export function landedOnHome(requested, final) {
  if (!final || final === requested) return false;
  const want = pathOf(requested);
  const got = pathOf(final);
  if (got === '' || got === '/') return true;
  if (got === want) return false;
  const wantParts = want.split('/').filter(Boolean);
  const gotParts = got.split('/').filter(Boolean);
  const slug = wantParts[wantParts.length - 1] || '';
  if (slug && gotParts.includes(slug)) return false;
  return gotParts.length <= wantParts.length || got.length < want.length * 0.5;
}

// Turn an http response into ok, gone or unknown. Pure, so the tests cover it.
export function classify(requested, res) {
  const { status, finalUrl } = res;
  if (status === 404 || status === 410) return 'gone';
  if (landedOnHome(requested, finalUrl)) return 'gone';
  if (status >= 200 && status < 400) return 'ok';
  return 'unknown';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, method, timeout, extraHeaders = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...extraHeaders },
    });
    // Drain nothing: a HEAD has no body, and a ranged GET is one byte. Cancel what there is.
    try { await res.body?.cancel(); } catch { /* fine */ }
    return { status: res.status, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

const HEAD_REFUSED = new Set([400, 403, 405, 501]);

// One url, with the HEAD then ranged GET fallback and the retry rule.
export async function checkUrl(url, { timeout = 15000, tries = 3, retryDelay = 800 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      let res = await request(url, 'HEAD', timeout);
      let method = 'HEAD';
      if (HEAD_REFUSED.has(res.status)) {
        res = await request(url, 'GET', timeout, { Range: 'bytes=0-0' });
        method = 'GET';
      }
      return { url, status: classify(url, res), http: res.status, finalUrl: res.finalUrl === url ? undefined : res.finalUrl, method, tries: attempt };
    } catch (err) {
      lastError = err && err.name === 'AbortError' ? `timeout after ${timeout} ms` : String(err && err.cause && err.cause.code ? err.cause.code : err && err.message ? err.message : err);
      if (attempt < tries) await sleep(retryDelay * attempt);
    }
  }
  return { url, status: 'gone', http: null, error: lastError, tries };
}

// Runs checks with at most `concurrency` in flight and `spacing` ms between two
// requests to the same host. Results are cached by url, so a page used by
// several offers is fetched once.
export async function checkMany(urls, { concurrency = 6, spacing = 300, onDone, ...rest } = {}) {
  const unique = [...new Set(urls)];
  const results = new Map();
  const hostFree = new Map();
  const pending = unique.slice();
  let done = 0;

  async function worker() {
    while (pending.length) {
      const now = Date.now();
      let idx = pending.findIndex((u) => (hostFree.get(hostOf(u)) || 0) <= now);
      if (idx < 0) {
        const soonest = Math.min(...pending.map((u) => hostFree.get(hostOf(u)) || 0));
        await sleep(Math.max(10, soonest - now));
        continue;
      }
      const url = pending.splice(idx, 1)[0];
      const host = hostOf(url);
      hostFree.set(host, Date.now() + spacing);
      const r = await checkUrl(url, rest);
      hostFree.set(host, Date.now() + spacing);
      results.set(url, r);
      done++;
      if (onDone) onDone(done, unique.length, r);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

// ---------- Shopify shops: one request per product, every variant checked ----------
// House of Spoils, Society6 and Juniper run on Shopify, where a product page answers 200
// for any variant id, even one the shop dropped. Their offer links are the product page
// plus ?variant=<id>, so each product's public JSON (/products/<handle>.json) is read
// once and every offer is checked against its variants: about 600 requests for House
// of Spoils' 6,000 offers, and a dropped size or color is caught.
const SHOPIFY = /^(https?:\/\/[^/]+\/products\/[^/?#]+)\?variant=(\d+)$/;
export function shopifyKey(url) {
  const m = SHOPIFY.exec(url || '');
  return m ? { product: `${m[1]}.json`, variant: m[2] } : null;
}
async function getJson(url, timeout) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    let body = null;
    if (res.status === 200) { try { body = await res.json(); } catch { body = null; } } else { try { await res.body?.cancel(); } catch { /* fine */ } }
    return { status: res.status, body };
  } finally { clearTimeout(timer); }
}
// One product: gone on 404 or 410, its live variant ids when it answers, unknown otherwise.
export async function checkProduct(url, { timeout = 15000, tries = 3, retryDelay = 800, slowDown = 5000 } = {}) {
  let lastError = null;
  for (let attempt = 1, waits = 0; attempt <= tries; attempt++) {
    try {
      const r = await getJson(url, timeout);
      // Asked to slow down: wait longer each time (5, 10, 20, 40 s) and ask again; that
      // doesn't use up a try. After four waits it's unknown.
      if (r.status === 429 && waits < 4) { await sleep(slowDown * 2 ** waits); waits++; attempt--; continue; }
      if (r.status === 404 || r.status === 410) return { url, status: 'gone', http: r.status, tries: attempt };
      const vs = r.body && r.body.product && Array.isArray(r.body.product.variants) ? r.body.product.variants : null;
      if (r.status === 200 && vs) return { url, status: 'ok', http: 200, variants: new Set(vs.filter((v) => v.available !== false).map((v) => String(v.id))), tries: attempt };
      return { url, status: 'unknown', http: r.status, tries: attempt };
    } catch (err) {
      lastError = err && err.name === 'AbortError' ? `timeout after ${timeout} ms` : String(err && err.message ? err.message : err);
      if (attempt < tries) await sleep(retryDelay * attempt);
    }
  }
  return { url, status: 'gone', http: null, error: lastError, tries };
}
// An offer's status from its product: gone when the product or the variant is gone.
export function variantStatus(product, variant) {
  if (!product) return 'unknown';
  if (product.status !== 'ok') return product.status;
  return product.variants.has(String(variant)) ? 'ok' : 'gone';
}

// ---------- metadata audit ----------

const PLACEHOLDER = /^(untitled|no title|title|print|poster|photo|image|picture|art|artwork|new|test|placeholder|lorem ipsum|tbd|n\/a|none|sample|default)$/i;
const MACHINE = /^(img|dsc|dscf|dcim|image|photo|pic|scan|screenshot)[-_ ]?\d+/i;

export function placeholderTitle(title, id) {
  const t = (title || '').trim();
  if (!t) return true;
  if (PLACEHOLDER.test(t)) return true;
  if (MACHINE.test(t)) return true;
  if (/^[\d\s.\-_#]+$/.test(t)) return true;
  if (id && t.toLowerCase() === String(id).toLowerCase()) return true;
  if (/\b(copy|duplicate|final final|v\d+)\b/i.test(t)) return true;
  return false;
}

const FREE = new Set(['unsplash', 'pexels', 'pixabay']);
const fits = (w, h, aspect) => w > 0 && h > 0 && aspect > 0 && Math.abs((w / h) / aspect - 1) <= 0.14 + 1e-9;

// Per item: the list of weak fields. Pure, so the tests cover it.
export function auditRecord(r, { imageSeen } = {}) {
  const weak = [];
  const offers = Array.isArray(r.offers) ? r.offers : [];
  const sizes = Array.isArray(r.sizes) ? r.sizes : [];
  const im = r.image || {};
  const tags = r.tags || {};
  const src = r.source || {};

  if (offers.length && !offers.some((o) => typeof o.price === 'number' && o.price > 0)) weak.push('no price on any offer');
  const unsized = offers.filter((o) => !(o.w > 0 && o.h > 0)).length;
  if (unsized) weak.push(`${unsized} offer${unsized > 1 ? 's' : ''} with no size`);
  if (!(typeof im.aspect === 'number' && im.aspect > 0)) weak.push('image aspect missing');
  else {
    const listed = [...sizes, ...offers].filter((z) => z.w > 0 && z.h > 0);
    if (listed.length && !listed.some((z) => fits(z.w, z.h, im.aspect))) {
      weak.push(sizes.every((z) => z.crop) ? 'image aspect over 14% off every size (crop marked)' : 'image aspect over 14% off every size');
    }
  }
  const subjects = Array.isArray(tags.subjects) ? tags.subjects.length : 0;
  if (subjects < 3) weak.push(`${subjects} subject tag${subjects === 1 ? '' : 's'}`);
  if (!r.artist || !(typeof r.artist.name === 'string' && r.artist.name.trim())) weak.push('no artist');
  if (FREE.has(src.provider) && !(typeof src.license === 'string' && src.license.trim())) weak.push('free photo with no license');
  if (!(typeof r.description === 'string' && r.description.trim().split(/\s+/).length >= 3)) weak.push('no description');
  if (imageSeen && im.src && imageSeen.get(im.src) > 1) weak.push(`image url shared by ${imageSeen.get(im.src)} items`);
  if (placeholderTitle(r.title, r.id)) weak.push(`placeholder title "${r.title}"`);
  return weak;
}

export function auditCatalog(items) {
  const imageSeen = new Map();
  for (const r of items) if (r.image && r.image.src) imageSeen.set(r.image.src, (imageSeen.get(r.image.src) || 0) + 1);
  const perItem = items.map((r) => ({ id: r.id, title: r.title, source: r.source && r.source.provider, weak: auditRecord(r, { imageSeen }) }));
  const counts = {};
  for (const it of perItem) for (const w of it.weak) {
    const key = w.replace(/^\d+ (offers?) with no size$/, 'offers with no size').replace(/^\d+ subject tags?$/, 'fewer than 3 subject tags').replace(/ shared by \d+ items$/, ' shared by other items').replace(/ "[^"]*"$/, '');
    counts[key] = (counts[key] || 0) + 1;
  }
  const worst = perItem.filter((it) => it.weak.length).sort((a, b) => b.weak.length - a.weak.length || a.id.localeCompare(b.id)).slice(0, 20);
  return { items: perItem.length, weakItems: perItem.filter((it) => it.weak.length).length, counts, worst, perItem };
}

// ---------- apply ----------

const WHY = ['offer', 'image', 'both'];

// Merge a health report into the catalog items. Returns what changed.
export function applyHealth(items, health) {
  const byId = new Map((health.items || []).map((h) => [h.id, h]));
  const since = health.checkedAt;
  const changed = { offersGone: 0, offersBack: 0, itemsGone: 0, itemsBack: 0 };
  for (const r of items) {
    const h = byId.get(r.id);
    if (!h) continue;
    const seen = new Map((h.offers || []).map((o) => [o.url, o.status]));
    for (const o of r.offers || []) {
      const st = seen.get(o.url);
      if (st === 'gone') {
        if (!o.gone) { o.gone = true; o.since = since; changed.offersGone++; }
      } else if (st === 'ok' && o.gone) {
        delete o.gone; delete o.since; changed.offersBack++;
      }
    }
    // An unknown answer (403, 429, 5xx) changes nothing: an offer keeps the flag it had,
    // and an image that was gone stays gone until it is seen again.
    const offers = r.offers || [];
    const allOffersGone = offers.length > 0 && offers.every((o) => o.gone);
    const prev = r.health && r.health.gone ? r.health.why : null;
    const wasImageGone = prev === 'image' || prev === 'both';
    const imageGone = h.image ? h.image.status === 'gone' || (h.image.status !== 'ok' && wasImageGone) : wasImageGone;
    const why = allOffersGone && imageGone ? 'both' : allOffersGone ? 'offer' : imageGone ? 'image' : null;
    if (why) {
      r.health = { gone: true, since: prev && r.health.since ? r.health.since : since, why };
      if (!prev) changed.itemsGone++;
    } else if (prev) {
      delete r.health;
      changed.itemsBack++;
    }
  }
  return changed;
}

// ---------- main ----------

function parseArgs(argv) {
  const flags = new Set();
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (['dry', 'apply', 'no-pages', 'quiet'].includes(key)) flags.add(key);
    else { opts[key] = next; i++; }
  }
  return { flags, opts };
}

function rewrite(url, base) {
  if (!base) return url;
  const u = new URL(url);
  const b = new URL(base);
  return `${b.origin}${u.pathname}${u.search}`;
}

function pad(s, n) { s = String(s == null ? '' : s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

function printTable(rows) {
  const head = ['id', 'title', 'source', 'offers ok/gone', 'image', 'page'];
  const widths = [34, 26, 14, 15, 8, 8];
  console.log(head.map((h, i) => pad(h, widths[i])).join(' '));
  console.log(widths.map((w) => '-'.repeat(w)).join(' '));
  for (const r of rows) console.log(r.map((c, i) => pad(c, widths[i])).join(' '));
}

function printAudit(audit) {
  console.log(`\nMetadata audit: ${audit.weakItems} of ${audit.items} items have a weak field`);
  for (const [k, v] of Object.entries(audit.counts).sort((a, b) => b[1] - a[1])) console.log(`  ${pad(v, 5)} ${k}`);
  if (audit.worst.length) {
    console.log(`\nWorst ${audit.worst.length}:`);
    for (const it of audit.worst) console.log(`  ${pad(it.id, 34)} ${pad(it.title, 26)} ${it.weak.join('; ')}`);
  }
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const catalogPath = resolve(ROOT, opts.catalog || 'demo/catalog.json');
  // A dry run never overwrites the last real check, so --apply always has it.
  const outPath = resolve(ROOT, opts.out || (flags.has('dry') ? 'tools/health.dry.json' : 'tools/health.json'));
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  let items = catalog.items;
  if (opts.only) { const ids = new Set(opts.only.split(',')); items = items.filter((r) => ids.has(r.id)); }
  if (opts.limit) items = items.slice(0, Number(opts.limit));
  const catalogDir = dirname(catalogPath);

  if (flags.has('apply')) {
    if (!existsSync(outPath)) { console.error(`no health report at ${outPath}; run the check first`); process.exit(1); }
    const health = JSON.parse(readFileSync(outPath, 'utf8'));
    if (health.dry) { console.error('that health report came from --dry and has no url results; run the check without --dry first'); process.exit(1); }
    const changed = applyHealth(catalog.items, health);
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n');
    console.log(`Applied ${health.checkedAt} to ${catalogPath}: ${changed.offersGone} offers marked gone, ${changed.offersBack} offers back, ${changed.itemsGone} items marked gone, ${changed.itemsBack} items back`);
    const gone = catalog.items.filter((r) => r.health && r.health.gone);
    console.log(`${gone.length} items carry health.gone (${WHY.map((w) => `${w}: ${gone.filter((r) => r.health.why === w).length}`).join(', ')})`);
    return;
  }

  const audit = auditCatalog(items);
  const checkedAt = new Date().toISOString();

  if (flags.has('dry')) {
    // Local images can still be checked without the network.
    const missing = items.filter((r) => r.image && r.image.src && !/^https?:\/\//.test(r.image.src) && !existsSync(join(catalogDir, r.image.src)));
    console.log(`Dry run: ${items.length} items, ${items.reduce((a, r) => a + (r.offers || []).length, 0)} offers, ${missing.length} local image files missing`);
    for (const r of missing) console.log(`  missing file ${r.image.src} (${r.id})`);
    printAudit(audit);
    writeFileSync(outPath, JSON.stringify({ checkedAt, dry: true, audit: { items: audit.items, weakItems: audit.weakItems, counts: audit.counts, worst: audit.worst }, missingFiles: missing.map((r) => r.id) }, null, 1) + '\n');
    console.log(`\nWrote ${outPath}`);
    return;
  }

  const base = opts['base-override'] || null;
  const urls = [];
  const products = new Set();
  const plan = items.map((r) => {
    const offers = (r.offers || []).map((o) => {
      const sk = flags.has('no-shopify') ? null : shopifyKey(o.url);
      if (sk) { const product = rewrite(sk.product, base); products.add(product); return { url: o.url, product, variant: sk.variant }; }
      return { url: o.url, check: rewrite(o.url, base) };
    });
    const local = r.image && r.image.src && !/^https?:\/\//.test(r.image.src);
    const image = local ? { url: r.image.src, local: true } : { url: r.image.src, check: rewrite(r.image.src, base) };
    const samePage = offers.some((o) => o.url === r.source.page);
    const page = !flags.has('no-pages') && r.source && r.source.page && !samePage ? { url: r.source.page, check: rewrite(r.source.page, base) } : null;
    for (const o of offers) if (o.check) urls.push(o.check);
    if (image.check) urls.push(image.check);
    if (page) urls.push(page.check);
    return { r, offers, image, page, samePage };
  });

  const concurrency = Number(opts.concurrency || 6);
  const timeout = Number(opts.timeout || 15000);
  const spacing = Number(opts.spacing || 300);
  const tries = Number(opts.tries || 3);
  const unique = new Set(urls).size + products.size;
  console.log(`Checking ${unique} urls (${products.size} of them Shopify products, each checked for its variants) for ${items.length} items (${concurrency} at a time, ${timeout} ms timeout, ${spacing} ms per host, ${tries} tries)${base ? ` against ${base}` : ''}`);
  let last = Date.now();
  const results = await checkMany(urls, {
    concurrency, timeout, spacing, tries,
    onDone: (n, total) => { if (!flags.has('quiet') && (Date.now() - last > 5000 || n === total)) { last = Date.now(); console.log(`  ${n} of ${total}`); } },
  });
  // Shopify products, one host at a time with the same spacing.
  const productResults = new Map();
  let pn = 0;
  for (const u of products) {
    productResults.set(u, await checkProduct(u, { timeout, tries }));
    pn++; if (!flags.has('quiet') && (Date.now() - last > 5000 || pn === products.size)) { last = Date.now(); console.log(`  products ${pn} of ${products.size}`); }
    // Shopify's product JSON is rate limited harder than its pages: about one a second.
    await sleep(Math.max(spacing, Number(opts['product-spacing'] || 1000)));
  }

  const take = (u) => {
    if (u.product) { const pr = productResults.get(u.product); return { url: u.url, status: variantStatus(pr, u.variant), http: pr && pr.http, via: 'product json', error: pr && pr.error, tries: pr && pr.tries }; }
    const r = results.get(u.check); return { url: u.url, status: r.status, http: r.http, finalUrl: r.finalUrl, error: r.error, tries: r.tries };
  };
  const out = plan.map(({ r, offers, image, page, samePage }) => {
    const offerResults = offers.map(take);
    const imageResult = image.local
      ? { url: image.url, local: true, status: existsSync(join(catalogDir, image.url)) ? 'ok' : 'gone' }
      : take(image);
    const pageResult = page ? take(page) : samePage ? { url: r.source.page, status: 'offer', note: 'same url as the offers' } : undefined;
    const allOffersGone = offerResults.length > 0 && offerResults.every((o) => o.status === 'gone');
    const imageGone = imageResult.status === 'gone';
    const gone = allOffersGone && imageGone ? 'both' : allOffersGone ? 'offer' : imageGone ? 'image' : null;
    return { id: r.id, title: r.title, source: r.source && r.source.provider, gone, offers: offerResults, image: imageResult, page: pageResult };
  });

  const summary = {
    items: out.length,
    itemsGone: out.filter((o) => o.gone).length,
    offers: out.reduce((a, o) => a + o.offers.length, 0),
    offersGone: out.reduce((a, o) => a + o.offers.filter((x) => x.status === 'gone').length, 0),
    offersUnknown: out.reduce((a, o) => a + o.offers.filter((x) => x.status === 'unknown').length, 0),
    imagesGone: out.filter((o) => o.image.status === 'gone').length,
    imagesUnknown: out.filter((o) => o.image.status === 'unknown').length,
    pagesGone: out.filter((o) => o.page && o.page.status === 'gone').length,
  };
  writeFileSync(outPath, JSON.stringify({ checkedAt, dry: false, base: base || undefined, summary, audit: { items: audit.items, weakItems: audit.weakItems, counts: audit.counts, worst: audit.worst }, items: out }, null, 1) + '\n');

  const cell = (x) => (x ? (x.status === 'ok' ? 'ok' : x.status === 'gone' ? 'GONE' : x.status === 'offer' ? '=offer' : `? ${x.http || ''}`.trim()) : '');
  printTable(out.map((o) => [
    o.id, o.title, o.source,
    o.offers.length ? `${o.offers.filter((x) => x.status === 'ok').length}/${o.offers.filter((x) => x.status === 'gone').length}${o.offers.some((x) => x.status === 'unknown') ? ` ?${o.offers.filter((x) => x.status === 'unknown').length}` : ''}` : '(none)',
    cell(o.image), cell(o.page),
  ]));
  console.log(`\n${summary.items} items: ${summary.itemsGone} gone. ${summary.offers} offers: ${summary.offersGone} gone, ${summary.offersUnknown} unknown. Images: ${summary.imagesGone} gone, ${summary.imagesUnknown} unknown. Source pages gone: ${summary.pagesGone}.`);
  printAudit(audit);
  console.log(`\nWrote ${outPath}. Run with --apply to write the gone flags into the catalog.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
