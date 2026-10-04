// Catalog records: the shape CATALOG.md describes, a validator that the build
// and the tests run, and the adapter that turns a record into what layout() reads.

import { profileFromRecord } from './theory.js';

export const CATEGORIES = [
  'abstract', 'aerial', 'architecture', 'beach', 'black and white', 'cars', 'city', 'coast', 'coffee', 'desert', 'dogs', 'drinks',
  'figure', 'film', 'flowers', 'food', 'golf', 'graphic', 'horses', 'landscape', 'lines', 'moon', 'objects', 'palm springs', 'pool', 'sailing',
  'sculpture', 'shadows', 'ski', 'sky', 'surf', 'tennis', 'water', 'western',
];
export const THEMES = ['summer', 'sport', 'city', 'nature', 'still life', 'art', 'animals', 'mono'];
export const THEME_OF = {
  pool: 'summer', coast: 'summer', beach: 'summer', 'palm springs': 'summer', film: 'summer',
  tennis: 'sport', surf: 'sport', sailing: 'sport', golf: 'sport', ski: 'sport',
  city: 'city', architecture: 'city', cars: 'city',
  aerial: 'nature', landscape: 'nature', desert: 'nature', water: 'nature', sky: 'nature', moon: 'nature', flowers: 'nature', shadows: 'nature',
  food: 'still life', drinks: 'still life', coffee: 'still life', objects: 'still life', sculpture: 'still life',
  abstract: 'art', graphic: 'art', lines: 'art', figure: 'art',
  dogs: 'animals', horses: 'animals', western: 'animals',
  'black and white': 'mono',
};
export const SHARE_FAMILIES = ['red', 'pink', 'orange', 'yellow', 'brown', 'green', 'teal', 'blue', 'purple', 'black', 'gray', 'white'];
export const COLOR_NAMES = ['black', 'white', 'light gray', 'gray', 'pink', 'red', 'brown', 'peach', 'orange', 'ochre', 'yellow', 'green', 'teal', 'navy', 'light blue', 'blue', 'purple'];
const PROVENANCE_KEYS = ['source', 'image', 'color', 'composition', 'tags', 'sizes', 'quality'];
export const MOODS = ['sunny', 'calm', 'moody', 'bold', 'playful', 'elegant'];
export const STYLES = ['minimal', 'graphic', 'aerial', 'film', 'documentary', 'painterly', 'still life', 'portrait'];
export const ROOMS = ['living room', 'bedroom', 'kitchen', 'bathroom', 'entry', 'office'];
export const SETTINGS = ['outdoor', 'indoor', 'studio', 'abstract'];
export const TIMES = ['day', 'golden hour', 'night', 'any'];
export const SEASONS = ['summer', 'winter', 'spring', 'fall', 'any'];
const MEDIA = ['photo', 'painting', 'illustration', 'print'];
const STATUS = ['active', 'hidden', 'removed'];
const WHO = ['source', 'measured', 'rule', 'model', 'human', null];
const WHY = ['offer', 'image', 'both']; // why health.gone was set: every offer gone, the image gone, or both

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isHex = (v) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);
const isIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v) && !Number.isNaN(Date.parse(v));

// Returns a list of problems; an empty list means the record is good.
export function validateRecord(r) {
  const e = [];
  const at = (msg) => e.push(`${r && r.id ? r.id : '(no id)'}: ${msg}`);
  if (!r || typeof r !== 'object') return ['record is not an object'];
  if (!isStr(r.id)) at('id missing');
  if (!STATUS.includes(r.status)) at(`status must be one of ${STATUS.join(', ')}`);
  if (!isStr(r.title) || r.title.length > 40 || r.title.trim().split(/\s+/).length > 5) at('title must be 1 to 5 words, 40 characters at most');
  if (/[\u2014\u2013]/.test(r.title || '')) at('title has a dash');
  if (!MEDIA.includes(r.medium)) at(`medium must be one of ${MEDIA.join(', ')}`);
  if (!CATEGORIES.includes(r.category)) at(`unknown category ${r.category}`);
  if (!r.artist || !isStr(r.artist.name)) at('artist.name missing');

  const s = r.source || {};
  if (!isStr(s.provider) || !isStr(s.page) || !/^https:\/\//.test(s.page) || !isStr(s.license)) at('source needs provider, https page and license');
  const rt = r.rights || {};
  if (typeof rt.show !== 'boolean' || typeof rt.sell !== 'boolean' || !isStr(rt.credit)) at('rights needs show, sell and credit');
  if (['unsplash', 'pexels', 'pixabay'].includes(s.provider) && rt.sell) at(`${s.provider} art cannot be sold`);
  if (r.status === 'active' && rt.show !== true) at('an active record must be allowed to show');

  const im = r.image || {};
  if (!isStr(im.src) || !(im.width > 0) || !(im.height > 0)) at('image needs src, width and height');
  if (!(typeof im.aspect === 'number' && Number.isFinite(im.aspect)) || Math.abs(im.aspect - im.width / im.height) > 0.01) at('image.aspect missing or does not match width and height');
  const orient = im.aspect >= 0.9 && im.aspect <= 1.1 ? 'square' : im.aspect < 1 ? 'portrait' : 'landscape';
  if (im.orientation !== orient) at(`image.orientation should be ${orient}`);

  const c = r.color || {};
  if (!Array.isArray(c.palette) || !c.palette.length || c.palette.length > 6) at('color.palette needs 1 to 6 colors');
  else {
    if (!c.palette.every((p) => isHex(p.hex) && p.weight > 0 && p.weight <= 1 && COLOR_NAMES.includes(p.name))) at('each palette color needs hex, weight and a known color name');
    const sum = c.palette.reduce((a, p) => a + p.weight, 0);
    if (Math.abs(sum - 1) > 0.02) at(`palette weights sum to ${sum.toFixed(3)}, not 1`);
  }
  if (!(COLOR_NAMES.includes(c.dominant) || c.dominant === 'black and white')) at(`color.dominant ${c.dominant} is not a known color`);
  if (typeof c.bw !== 'boolean') at('color.bw missing');
  if (c.bw !== (c.dominant === 'black and white')) at('color.bw and color.dominant disagree');
  for (const k of ['brightness', 'contrast', 'saturation', 'colorfulness']) if (!isNum01(c[k])) at(`color.${k} must be 0 to 1`);
  if (!(typeof c.warmth === 'number' && c.warmth >= -1 && c.warmth <= 1)) at('color.warmth must be -1 to 1');
  const near1 = (xs) => Math.abs(xs.reduce((a, b) => a + b, 0) - 1) <= 0.02;
  if (!c.shares || typeof c.shares !== 'object' || !Object.keys(c.shares).length) at('color.shares missing');
  else {
    if (!Object.keys(c.shares).every((f) => SHARE_FAMILIES.includes(f))) at(`color.shares has a family that isn't one of ${SHARE_FAMILIES.join(', ')}`);
    if (!Object.values(c.shares).every(isNum01) || !near1(Object.values(c.shares))) at('color.shares must be 0 to 1 and sum to 1');
  }
  if (!Array.isArray(c.hues) || c.hues.length !== 12 || !c.hues.every(isNum01)) at('color.hues needs 12 numbers from 0 to 1');
  else if (!near1(c.hues) && c.hues.some((v) => v > 0)) at('color.hues must sum to 1, or be all zeros');
  if (!isNum01(c.chromatic)) at('color.chromatic must be 0 to 1');
  const v = c.value || {};
  if (!['dark', 'mid', 'light'].every((key) => isNum01(v[key])) || !near1([v.dark, v.mid, v.light])) at('color.value needs dark, mid and light summing to 1');

  const k = r.composition || {};
  for (const f of ['busyness', 'negativeSpace', 'symmetry', 'weight']) if (!isNum01(k[f])) at(`composition.${f} must be 0 to 1`);
  if (!k.focal || !isNum01(k.focal.x) || !isNum01(k.focal.y)) at('composition.focal needs x and y from 0 to 1');

  const t = r.tags || {};
  if (!THEMES.includes(t.theme)) at(`unknown theme ${t.theme}`);
  else if (THEME_OF[r.category] && THEME_OF[r.category] !== t.theme) at(`theme ${t.theme} does not match category ${r.category}`);
  if (!Array.isArray(t.subjects) || !t.subjects.length) at('tags.subjects empty');
  if (!Array.isArray(t.mood) || !t.mood.length || !t.mood.every((m) => MOODS.includes(m))) at('tags.mood invalid');
  if (!Array.isArray(t.style) || !t.style.every((m) => STYLES.includes(m))) at('tags.style invalid');
  if (typeof t.people !== 'boolean') at('tags.people missing');
  if (!Array.isArray(t.rooms) || !t.rooms.length || !t.rooms.every((m) => ROOMS.includes(m))) at('tags.rooms invalid');
  if (t.setting != null && !SETTINGS.includes(t.setting)) at(`tags.setting must be one of ${SETTINGS.join(', ')}`);
  if (t.time != null && !TIMES.includes(t.time)) at(`tags.time must be one of ${TIMES.join(', ')}`);
  if (t.season != null && !SEASONS.includes(t.season)) at(`tags.season must be one of ${SEASONS.join(', ')}`);
  if (t.vibe != null && (!Array.isArray(t.vibe) || !t.vibe.every(isStr))) at('tags.vibe must be a list of words');
  if (r.description != null && (!isStr(r.description) || r.description.length > 120 || /[\u2014\u2013]/.test(r.description))) at('description must be one line, 120 characters at most, no dashes');
  if (r.quality && r.quality.score != null && !isNum01(r.quality.score)) at('quality.score must be 0 to 1');

  if (!Array.isArray(r.sizes) || !r.sizes.length || !r.sizes.every((z) => z.w > 0 && z.h > 0)) at('sizes needs at least one frame size');
  else if (im.aspect && !r.sizes.every((z) => z.crop || Math.abs((z.w / z.h) / im.aspect - 1) <= 0.14 + 1e-9)) at('a frame size is more than 14% off the image shape without crop: true');
  if (!Array.isArray(r.offers)) at('offers must be a list');
  else {
    if (!r.offers.every((o) => o && isStr(o.vendor) && /^https:\/\//.test(o.url || '') && (o.price == null || (typeof o.price === 'number' && o.price >= 0)) && (o.w == null || (o.w > 0 && o.h > 0)))) at('each offer needs a vendor, an https link, a price of 0 or more (or none) and a size with both sides');
    if (!r.offers.every((o) => o && (o.gone == null || o.gone === true) && (o.since == null || isIso(o.since)))) at('an offer that is gone carries gone: true and an ISO date in since');
  }
  if (r.health != null) {
    const h = r.health;
    if (!h || typeof h !== 'object' || h.gone !== true || !isIso(h.since) || !WHY.includes(h.why)) at(`health must be { gone: true, since: ISO date, why: ${WHY.join(' | ')} } or absent`);
  }
  if (!r.provenance || !PROVENANCE_KEYS.every((key) => key in r.provenance) || !Object.values(r.provenance).every((v) => WHO.includes(v))) at(`provenance needs ${PROVENANCE_KEYS.join(', ')}, each source, measured, rule, model, human or null`);
  return e;
}

export function validateCatalog(records) {
  const errors = records.flatMap(validateRecord);
  const ids = new Set();
  for (const r of records) {
    if (ids.has(r.id)) errors.push(`${r.id}: duplicate id`);
    ids.add(r.id);
  }
  return errors;
}

// What layout() reads. Keeps the record around for the screens and the taste model.
// A size the shop no longer sells is not one we suggest: when a record has shop
// offers, only sizes a live offer comes in are kept (an offer with no size covers any).
function liveSizes(r) {
  const offers = r.offers || [];
  if (!offers.length) return r.sizes;
  const live = liveOffers(r);
  const sells = (s) => live.some((o) => !o.w || !o.h || (o.w === s.w && o.h === s.h) || (o.w === s.h && o.h === s.w));
  return r.sizes.filter(sells);
}

// A shop print can also go in the next standard frame up, matted: the print sits in the
// mat's window and the frame takes more room on the wall. Frame size as sold, short side first.
export const MATTED_UP = Object.freeze({ '8x12': [12, 16], '12x16': [16, 20], '12x18': [18, 24], '20x28': [24, 36] });

// Every size a piece can hang at. A size the shop sells framed is already the frame's
// outside; anything else gets framed. A shop print that comes unframed can also go in
// the frame a size up with a mat (`matted` is the print inside), unless the shop
// sells that frame size itself.
function candidateSizes(r) {
  const live = liveSizes(r);
  const isShop = (r.offers || []).length > 0;
  const out = live.map(({ w, h, price }) => {
    const framed = (r.offers || []).some((o) => !o.gone && o.framed && ((o.w === w && o.h === h) || (o.w === h && o.h === w)));
    return { w, h, ...(price == null ? {} : { price }), ...(framed ? { framed: true } : {}) };
  });
  if (!isShop) return out;
  const has = new Set(out.map((z) => `${z.w}x${z.h}`));
  for (const z of out.slice()) {
    if (z.framed) continue;
    const up = MATTED_UP[`${Math.min(z.w, z.h)}x${Math.max(z.w, z.h)}`];
    if (!up) continue;
    const [fw, fh] = z.w <= z.h ? up : [up[1], up[0]];
    if (has.has(`${fw}x${fh}`)) continue;
    has.add(`${fw}x${fh}`);
    out.push({ w: fw, h: fh, ...(z.price == null ? {} : { price: z.price }), matted: { w: z.w, h: z.h } });
  }
  return out;
}

export function toCandidate(r) {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist.name,
    source: r.source.name || { unsplash: 'Unsplash', pexels: 'Pexels', pixabay: 'Pixabay' }[r.source.provider] || r.source.provider,
    offers: liveOffers(r),
    url: r.source.page,
    image: r.image.src,
    palette: r.color.palette.map(({ hex, weight }) => ({ hex, weight })),
    sizes: candidateSizes(r),
    bw: r.color.bw,
    quality: r.quality && typeof r.quality.score === 'number' ? r.quality.score : null,
    weight: r.composition.weight,
    profile: profileFromRecord(r),
    record: r,
  };
}

// Offers the shop still lists. tools/check_catalog.mjs --apply sets gone: true on the rest.
export const liveOffers = (r) => (r.offers || []).filter((o) => !o.gone);

// What the screens may show: active, allowed to show, and not gone from the shop or the image host.
export const activeRecords = (records) => records.filter((r) => r.status === 'active' && r.rights.show && !(r.health && r.health.gone));
