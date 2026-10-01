// Turns a shop's affiliate product feed (Impact, CJ or Awin, as CSV or TSV)
// into Walldrobe picks: one row per piece of wall art, with its sizes, prices
// and buy links. Pure functions, so the tests can run them on a small fixture.

// ---------- CSV ----------

// RFC 4180 style: quoted fields, doubled quotes, newlines inside quotes.
export function parseCsv(text) {
  const head = text.slice(0, 4000).split(/\r?\n/)[0] || '';
  const delim = ['\t', ',', '|', ';'].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  if (!rows.length) return [];
  const keys = rows[0].map((k) => k.trim().replace(/^\ufeff/, '').toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
}

// ---------- Columns ----------

// Each field, and the names the three networks (and Google Shopping style feeds) use for it.
const ALIASES = {
  id: ['catalog item id', 'catalogitemid', 'id', 'sku', 'aw_product_id', 'merchant_product_id', 'product id', 'item id'],
  group: ['parent sku', 'parent_sku', 'item_group_id', 'item group id', 'parentsku', 'product_group'],
  title: ['name', 'title', 'product_name', 'product name'],
  description: ['description', 'product_short_description', 'short description', 'long description'],
  artist: ['artist', 'designer', 'creator', 'manufacturer', 'brand', 'brand_name'],
  url: ['url', 'link', 'aw_deep_link', 'buy url', 'tracking url', 'product url', 'deep link', 'deeplink'],
  image: ['image url', 'image_link', 'image link', 'merchant_image_url', 'large_image', 'aw_image_url', 'imageurl'],
  price: ['current price', 'sale price', 'price', 'search_price', 'store_price', 'display_price', 'original price'],
  currency: ['currency', 'currency_code', 'price currency'],
  category: ['category', 'product_type', 'product type', 'merchant_category', 'google_product_category', 'category name', 'subcategory'],
  size: ['size', 'dimensions', 'variant', 'option', 'custom_label_0', 'product size'],
  framed: ['frame', 'framed', 'frame option', 'color', 'colour'],
  stock: ['stock availability', 'availability', 'in_stock', 'stock_status'],
};

export function columnsOf(row, overrides = {}) {
  const keys = Object.keys(row);
  const out = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    out[field] = overrides[field] || names.find((n) => keys.includes(n)) || null;
  }
  return out;
}

// ---------- What counts as wall art ----------

const ART = /\b(art prints?|prints?|posters?|wall art|canvas|framed|giclee|gicl\u00e9e|photograph(?:y|ic)?|lithograph|screen ?prints?|etching|painting|original)\b/i;
const NOT_ART = /\b(mugs?|cases?|t-?shirts?|tees?|shirts?|pillows?|cushions?|towels?|blankets?|stickers?|greeting cards?|cards?|stationery|invitations?|notebooks?|totes?|bags?|masks?|clocks?|curtains?|rugs?|bath mats?|mats|phone|skins?|hoodies?|leggings|duvet|comforter|tapestry|tapestries|puzzles?|calendars?|ornaments?|coasters?|wallpaper|shower|throw|sweatshirt|apparel|gift ?wrap|frames? only|empty frame|art supplies|brush(?:es)?|easels?)\b/i;

export function isWallArt(rec) {
  const text = `${rec.title} ${rec.category}`;
  if (NOT_ART.test(text)) return false;
  return ART.test(`${text} ${rec.description || ''}`);
}

// ---------- Sizes ----------

const A_SIZES = { A5: [14.8, 21], A4: [21, 29.7], A3: [29.7, 42], A2: [42, 59.4], A1: [59.4, 84.1], A0: [84.1, 118.9] };
const US_STANDARD = new Set(['5x7', '8x10', '8x12', '11x14', '12x12', '12x16', '12x18', '16x16', '16x20', '18x24', '20x20', '20x30', '24x30', '24x36', '30x30', '30x40', '40x60']);
const CM_STANDARD = new Set(['13x18', '15x20', '18x24', '20x30', '21x30', '24x30', '30x30', '30x40', '40x40', '40x50', '50x50', '50x70', '60x80', '61x91', '70x100', '100x140']);

// Every size named in a string, in inches, portrait-first as written.
// "50x70 cm", "16 x 20 in", '24" x 36"', "A3", "30 x 40" (unit from the currency when not written).
export function parseSizes(text, { currency = 'USD' } = {}) {
  if (!text) return [];
  const out = [];
  const metricShop = !/^(USD|CAD)$/i.test(currency || 'USD');
  const re = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:"|''|in(?:ch(?:es)?)?\.?|cm|mm)?\s*[x\u00d7X]\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*("|''|in(?:ch(?:es)?)?\b\.?|cm\b|mm\b)?/g;
  let m;
  while ((m = re.exec(text))) {
    let a = Number(m[1].replace(',', '.')), b = Number(m[2].replace(',', '.'));
    const whole = m[0].toLowerCase();
    let unit = /cm/.test(whole) ? 'cm' : /mm/.test(whole) ? 'mm' : /"|''|in/.test(whole) ? 'in' : null;
    if (!unit) {
      const key = `${Math.min(a, b)}x${Math.max(a, b)}`;
      if (metricShop) unit = CM_STANDARD.has(key) || !US_STANDARD.has(key) ? 'cm' : 'in';
      else unit = US_STANDARD.has(key) || !CM_STANDARD.has(key) ? 'in' : 'cm';
    }
    const k = unit === 'cm' ? 1 / 2.54 : unit === 'mm' ? 1 / 25.4 : 1;
    a *= k; b *= k;
    if (a >= 4 && b >= 4 && a <= 100 && b <= 100) out.push({ w: round05(a), h: round05(b) });
  }
  for (const [name, [w, h]] of Object.entries(A_SIZES)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) out.push({ w: round05(w / 2.54), h: round05(h / 2.54) });
  }
  const seen = new Set();
  return out.filter((s) => { const key = `${s.w}x${s.h}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
const round05 = (x) => Math.round(x * 2) / 2;

export function parsePrice(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  // "1.299,00" (comma decimals) versus "1,299.00"
  const n = /,\d{2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// ---------- Artist, medium, category ----------

export function artistOf(rec, merchant) {
  const by = /\bby\s+([A-Z\u00c0-\u017f][\w\u00c0-\u017f.'\- ]{1,40}?)(?:\s*[|(,\-\u2013]|$)/.exec(rec.title || '');
  const shopName = (merchant || '').toLowerCase().replace(/[^a-z]/g, '');
  const brand = (rec.artist || '').trim();
  const brandIsShop = !brand || brand.toLowerCase().replace(/[^a-z]/g, '').includes(shopName) || shopName.includes(brand.toLowerCase().replace(/[^a-z]/g, ''));
  if (by) return by[1].trim();
  return brandIsShop ? null : brand;
}

// A short title for the card: drop "by Artist", sizes and shop words, keep 1 to 5 words.
export function cleanTitle(t) {
  let s = (t || '')
    .replace(/\s+by\s+[^|(,]+/i, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\d{1,3}(?:[.,]\d+)?\s*(?:"|in|cm|mm)?\s*[x\u00d7]\s*\d{1,3}(?:[.,]\d+)?\s*(?:"|in(?:ches)?|cm|mm)?/gi, '')
    .replace(/\b(art print|fine art print|giclee print|wall art|poster|framed|unframed|canvas print|print|art)\b/gi, '')
    .replace(/[|:\u2013\u2014-]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(Boolean).slice(0, 5);
  s = words.join(' ').slice(0, 40).trim().replace(/[,;.\s]+$/, '');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export function mediumOf(rec) {
  const t = `${rec.title} ${rec.category} ${rec.description || ''}`.toLowerCase();
  if (/\boriginal\b.*\b(painting|acrylic|oil|watercolou?r|gouache)\b|\b(oil|acrylic) on (canvas|panel|paper)\b/.test(t)) return 'painting';
  if (/\bphotograph|photo print|photography\b/.test(t)) return 'photo';
  if (/\billustration|drawing|line art\b/.test(t)) return 'illustration';
  return 'print';
}

// Words to category, checked in order; the first hit wins.
const CATS = [
  ['palm springs', /palm springs|mid[- ]century house/], ['black and white', /black (and|&) white|monochrome|\bb&w\b/],
  ['tennis', /tennis/], ['golf', /\bgolf/], ['surf', /\bsurf/], ['ski', /\bski(ing|er|s)?\b|apr[e\u00e8]s/], ['sailing', /sail|yacht|regatta/],
  ['horses', /horse|equestrian/], ['western', /cowboy|western|rodeo|ranch/], ['dogs', /\bdogs?\b|puppy|terrier|dachshund|poodle/],
  ['pool', /\bpool|swim/], ['beach', /beach|umbrella|seaside/], ['coast', /coast|ocean|seascape|\bsea\b|waves?\b|lighthouse|amalfi|riviera/],
  ['moon', /moon|lunar|celestial/], ['desert', /desert|dune|cactus|saguaro|joshua/], ['sky', /\bsky|clouds?\b/],
  ['aerial', /aerial|from above/], ['water', /\bwater|lake|river/],
  ['flowers', /flower|floral|botanic|bloom|tulip|\brose|peony|leaves|leaf|fern|plant/], ['food', /lemon|citrus|fruit|cherr|food|kitchen/],
  ['drinks', /cocktail|martini|wine|champagne|negroni|spritz/], ['coffee', /coffee|espresso|caf[e\u00e9]/],
  ['cars', /\bcars?\b|porsche|vintage car|automobile/], ['city', /\bcity|skyline|paris|new york|london|tokyo|street/],
  ['architecture', /architect|building|bauhaus/], ['sculpture', /sculpt|statue/], ['shadows', /shadow/],
  ['lines', /line art|\blines?\b|stripe/], ['graphic', /geometric|shapes|color block|colour block|mid[- ]century|retro|matisse|cut[- ]?out/],
  ['figure', /portrait|figure|woman|man\b|nude|face|people|dancer/], ['landscape', /landscape|mountain|field|hills|forest|meadow|countryside/],
  ['objects', /vase|still life|chair|ceramic/], ['abstract', /abstract|painting|brush|texture/],
];
export function categoryOf(rec) {
  const t = `${rec.title} ${rec.category} ${rec.description || ''}`.toLowerCase();
  for (const [cat, re] of CATS) if (re.test(t)) return cat;
  return 'abstract';
}

// ---------- The whole feed ----------

// rows: parsed CSV rows. Returns { picks, dropped } where each pick is one piece
// (all its size and frame variants folded together as offers).
export function readFeed(rows, { merchant, overrides = {}, limit = Infinity } = {}) {
  if (!rows.length) return { picks: [], dropped: {} };
  const col = columnsOf(rows[0], overrides);
  const get = (r, f) => (col[f] ? r[col[f]] || '' : '');
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  const groups = new Map();
  for (const r of rows) {
    const rec = {
      id: get(r, 'id'), group: get(r, 'group'), title: get(r, 'title'), description: get(r, 'description'),
      artist: get(r, 'artist'), url: get(r, 'url'), image: get(r, 'image'), price: parsePrice(get(r, 'price')),
      currency: (get(r, 'currency') || 'USD').toUpperCase().slice(0, 3), category: get(r, 'category'), size: get(r, 'size'),
      framed: get(r, 'framed'), stock: get(r, 'stock'),
    };
    if (!rec.id || !rec.title) { drop('no id or title'); continue; }
    if (!/^https:\/\//.test(rec.url) || !/^https:\/\//.test(rec.image)) { drop('no https link or image'); continue; }
    if (/out of stock|outofstock|^false$|^0$/i.test(rec.stock)) { drop('out of stock'); continue; }
    if (!isWallArt(rec)) { drop('not wall art'); continue; }
    const sizes = parseSizes(`${rec.size} ${rec.title}`, { currency: rec.currency });
    const noFrame = /unframed|no frame|without frame|print only|^none$/i;
    const framed = rec.framed && /\bframed?\b/i.test(rec.framed) ? !noFrame.test(rec.framed)
      : /\bframed\b/i.test(`${rec.title} ${rec.size}`) && !noFrame.test(`${rec.title} ${rec.size}`);
    const key = rec.group || rec.image.replace(/[?#].*$/, '') || rec.id;
    if (!groups.has(key)) groups.set(key, { first: rec, offers: [] });
    const g = groups.get(key);
    for (const s of sizes.length ? sizes : [null]) {
      g.offers.push({ vendor: merchant, url: rec.url, price: rec.price, currency: rec.currency, framed, ...(s ? { w: s.w, h: s.h } : {}), sku: rec.id });
    }
  }
  const picks = [];
  for (const [key, g] of groups) {
    const r = g.first;
    const title = cleanTitle(r.title);
    if (!title) { drop('no usable title'); continue; }
    const artist = artistOf(r, merchant);
    if (!artist) { drop('no artist named'); continue; }
    const offers = dedupeOffers(g.offers);
    picks.push({
      id: `${merchant.slice(0, 3)}-${String(r.group || r.id).replace(/[^\w-]/g, '').slice(0, 24)}`,
      artist, page: r.url, title, medium: mediumOf(r), category: categoryOf(r), image: r.image,
      offers, sourceTitle: r.title, key,
    });
    if (picks.length >= limit) break;
  }
  return { picks, dropped };
}

// One offer per size and frame option, the cheapest.
function dedupeOffers(offers) {
  const best = new Map();
  for (const o of offers) {
    const k = `${o.w || '?'}x${o.h || '?'}:${o.framed}`;
    const b = best.get(k);
    if (!b || (o.price != null && (b.price == null || o.price < b.price))) best.set(k, o);
  }
  return [...best.values()].sort((a, b) => (a.w || 0) * (a.h || 0) - (b.w || 0) * (b.h || 0) || a.framed - b.framed);
}

// The TSV the analyzer reads: id, artist, page, title, medium, category, image, offers as JSON.
export function toTsv(picks, merchant) {
  const clean = (s) => String(s).replace(/[\t\r\n]+/g, ' ').trim();
  return [`# ${merchant} prints from its affiliate feed: id, artist, page, title, medium, category, image url, offers (JSON)`,
    ...picks.map((p) => [p.id, p.artist, p.page, p.title, p.medium, p.category, p.image, JSON.stringify(p.offers)].map(clean).join('\t'))].join('\n') + '\n';
}
