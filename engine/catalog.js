// Catalog records: the shape CATALOG.md describes, a validator that the build
// and the tests run, and the adapter that turns a record into what layout() reads.

export const CATEGORIES = [
  'abstract', 'aerial', 'architecture', 'beach', 'black and white', 'cars', 'city', 'coast', 'coffee', 'desert', 'dogs', 'drinks',
  'film', 'flowers', 'food', 'golf', 'graphic', 'horses', 'lines', 'moon', 'objects', 'palm springs', 'pool', 'sailing',
  'sculpture', 'shadows', 'ski', 'sky', 'surf', 'tennis', 'water', 'western',
];
export const THEMES = ['summer', 'sport', 'city', 'nature', 'still life', 'art', 'animals', 'mono'];
export const THEME_OF = {
  pool: 'summer', coast: 'summer', beach: 'summer', 'palm springs': 'summer', film: 'summer',
  tennis: 'sport', surf: 'sport', sailing: 'sport', golf: 'sport', ski: 'sport',
  city: 'city', architecture: 'city', cars: 'city',
  aerial: 'nature', desert: 'nature', water: 'nature', sky: 'nature', moon: 'nature', flowers: 'nature', shadows: 'nature',
  food: 'still life', drinks: 'still life', coffee: 'still life', objects: 'still life', sculpture: 'still life',
  abstract: 'art', graphic: 'art', lines: 'art',
  dogs: 'animals', horses: 'animals', western: 'animals',
  'black and white': 'mono',
};
export const COLOR_NAMES = ['black', 'white', 'light gray', 'gray', 'pink', 'red', 'brown', 'peach', 'orange', 'ochre', 'yellow', 'green', 'teal', 'navy', 'light blue', 'blue', 'purple'];
const PROVENANCE_KEYS = ['source', 'image', 'color', 'composition', 'tags', 'sizes', 'quality'];
export const MOODS = ['sunny', 'calm', 'moody', 'bold', 'playful', 'elegant'];
export const STYLES = ['minimal', 'graphic', 'aerial', 'film', 'documentary', 'painterly', 'still life', 'portrait'];
export const ROOMS = ['living room', 'bedroom', 'kitchen', 'bathroom', 'entry', 'office'];
const MEDIA = ['photo', 'painting', 'illustration', 'print'];
const STATUS = ['active', 'hidden', 'removed'];
const WHO = ['source', 'measured', 'rule', 'model', 'human', null];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isHex = (v) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);

// Returns a list of problems; an empty list means the record is good.
export function validateRecord(r) {
  const e = [];
  const at = (msg) => e.push(`${r && r.id ? r.id : '(no id)'}: ${msg}`);
  if (!r || typeof r !== 'object') return ['record is not an object'];
  if (!isStr(r.id)) at('id missing');
  if (!STATUS.includes(r.status)) at(`status must be one of ${STATUS.join(', ')}`);
  if (!isStr(r.title) || r.title.length > 40 || r.title.trim().split(/\s+/).length > 5) at('title must be 1 to 5 words, 40 characters at most');
  if (/[—–]/.test(r.title || '')) at('title has a dash');
  if (!MEDIA.includes(r.medium)) at(`medium must be one of ${MEDIA.join(', ')}`);
  if (!CATEGORIES.includes(r.category)) at(`unknown category ${r.category}`);
  if (!r.artist || !isStr(r.artist.name)) at('artist.name missing');

  const s = r.source || {};
  if (!isStr(s.provider) || !isStr(s.page) || !/^https:\/\//.test(s.page) || !isStr(s.license)) at('source needs provider, https page and license');
  const rt = r.rights || {};
  if (typeof rt.show !== 'boolean' || typeof rt.sell !== 'boolean' || !isStr(rt.credit)) at('rights needs show, sell and credit');
  if (s.provider === 'unsplash' && rt.sell) at('Unsplash art cannot be sold');
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

  if (!Array.isArray(r.sizes) || !r.sizes.length || !r.sizes.every((z) => z.w > 0 && z.h > 0)) at('sizes needs at least one frame size');
  else if (im.aspect && !r.sizes.every((z) => z.crop || Math.abs((z.w / z.h) / im.aspect - 1) <= 0.14 + 1e-9)) at('a frame size is more than 14% off the image shape without crop: true');
  if (!Array.isArray(r.offers)) at('offers must be a list');
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
export function toCandidate(r) {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist.name,
    source: r.source.provider === 'unsplash' ? 'Unsplash' : r.source.provider,
    url: r.source.page,
    image: r.image.src,
    palette: r.color.palette.map(({ hex, weight }) => ({ hex, weight })),
    sizes: r.sizes.map(({ w, h, price }) => (price == null ? { w, h } : { w, h, price })),
    bw: r.color.bw,
    weight: r.composition.weight,
    record: r,
  };
}

export const activeRecords = (records) => records.filter((r) => r.status === 'active' && r.rights.show);
