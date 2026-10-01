// Walldrobe, the site. One wall at a time: photo, corners and one measurement,
// what's in the way, the art you already have, the taste test, layouts on your
// own wall, then the list of what to get and where the nails go.
// Screens are plain functions that return HTML; every change re-renders.

import { layout, refill } from '../engine/index.js';
import { fitTaste, scoreTaste, nextPair, describeTaste } from '../engine/taste.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';
import { WALLS as SAMPLES, SAMPLE_PICKS } from '../demo/samples.js';
import { esc, inches, feet, wallSvg, wallPoint, KIND_NAME, obName, labelSize } from './draw.js';
import { aspectFromCorners, cornerProblem, flatten, paintOut, palette, crop, photoQuality, loadFile, toDataUrl, fromDataUrl, homography, apply } from './photo.js';
import { readWall, guessWidth, labToRgb, suggestWall, tvDepthFactor, hiddenFromFor, TV_SIZES } from './detect.js';
import * as store from './store.js';
import { segment, modelCached } from './segment.js';
import { packLabels, unpackLabels } from './segcore.js';

const QUIZ_LENGTH = 10;
const CATALOG = activeRecords(window.WALLDROBE_CATALOG.items).map((r) => ({ ...toCandidate(r), imageData: r.image.data, aspect: r.image.aspect }));
const byId = new Map(CATALOG.map((c) => [c.id, c]));
const $ = (sel) => document.querySelector(sel);
const app = () => $('#app');
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- State ----------

const S = {
  draft: store.loadDraft(),
  quiz: null,
  view: null, // { key, layouts, problems }
  rank: 1,
  selected: null,
  measure: true,
  flash: null,
  busy: null,
  seen: new Map(), // layout key -> ids already shown in it
  avoid: [],
  mem: { photo: null, flat: null, clean: null, cleanKey: null }, // pixels, kept in memory only
  ui: { cornerErr: null, quality: null, sizeErr: null, drawing: null, confirmDelete: null, saved: null, photoErr: null },
};

function blankDraft() {
  return {
    id: store.newId(), name: 'My wall', sample: null, width: null, height: null,
    photo: null, obstacles: [], owned: [], room: null,
    taste: { source: 'none', weights: null }, kept: [], scale: 0, chosen: null,
  };
}
// Sample rooms are never written over your own wall in progress.
function persist() {
  if (!S.draft || S.draft.sample) return true;
  const ok = store.saveDraft(S.draft);
  S.saveFailed = !ok;
  return ok;
}
function resetLayouts() { S.view = null; S.rank = 1; S.selected = null; S.seen = new Map(); S.avoid = []; S.ui.saved = null; }
// Back to your own wall after looking at a sample.
function resumeDraft() {
  const d = store.loadDraft();
  if (d && !d.sample) { S.draft = d; S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; resetLayouts(); ensurePixels().then(render).catch(() => {}); return true; }
  return false;
}
// Where someone should be sent if they open a step before its inputs exist.
function need() {
  const d = S.draft;
  if (!d) return '#/start';
  if (d.photo && !d.photo.flat) return d.photo.auto && d.photo.auto.rw && !d.photo.auto.guess ? '#/size' : '#/corners';
  if (!d.width || !d.height) return '#/start';
  return null;
}
const ownDraftSaved = () => { const d = store.loadDraft(); return d && !d.sample && d.width ? d : null; };

function firstOf(cat, n = 0) { return CATALOG.filter((c) => c.record.category === cat)[n]; }
const samplePicks = () => SAMPLE_PICKS.map(([w, l], i) => ({ winner: firstOf(w, i % 2), loser: firstOf(l, i % 2) })).filter((p) => p.winner && p.loser);

function loadSample(key) {
  const w = SAMPLES.find((x) => x.key === key) || SAMPLES[0];
  S.draft = {
    ...blankDraft(), name: `Sample ${w.name.toLowerCase()}`, sample: w.key,
    width: w.wall.width, height: w.wall.height, obstacles: clone(w.obstacles),
    owned: w.owned.map((p) => ({ ...clone(p), color: p.color, fromPhoto: false })),
    room: clone(w.room.palette),
    taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'sample', weights: fitTaste(samplePicks()) },
  };
  resetLayouts();
}

// ---------- Router ----------

const FLOW = [
  ['wall', 'Your wall', '#/check'],
  ['layouts', 'Layouts', '#/layouts'],
  ['get', 'Get it', '#/get'],
];
const STEP_OF = { things: 'wall', pieces: 'wall', check: 'wall', taste: 'layouts' };
const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', () => { S.flash = null; S.ui.cornerErr = null; S.ui.sizeErr = null; render(); window.scrollTo(0, 0); });

function hasWall() { return S.draft && S.draft.width && S.draft.height; }

// ---------- Shell ----------

function header() {
  return `<header class="site-head">
    <a class="logo" href="#/">Walldrobe</a>
    <nav class="site-nav" aria-label="Main">
      <a href="#/walls">Your walls</a>
      <a class="nav-cta" href="#/new">Start a wall</a>
    </nav>
  </header>
  ${store.demoMode ? '<p class="demo-label">Sample walls. Nothing is saved.</p>' : ''}
  ${S.saveFailed ? `<div class="save-failed" role="alert"><p>Didn't save on this device. It may be full; deleting an old wall under Your walls frees space. Your wall is still here until you close the page.</p><button type="button" class="btn-quiet small-btn" data-act="retry-save">Try again</button></div>` : ''}`;
}
function steps(current) {
  const idx = FLOW.findIndex(([k]) => k === (STEP_OF[current] || current));
  return `<ol class="steps" aria-label="Steps">${FLOW.map(([k, label, href], i) => {
    const state = i < idx ? 'done' : i === idx ? 'now' : 'next';
    const inner = `<span class="step-n">${i + 1}</span><span class="step-l">${label}</span>`;
    const to = k === 'wall' && S.draft && !S.draft.photo ? '#/things' : href;
    return `<li class="step is-${state}"${i === idx ? ' aria-current="step"' : ''}>${state === 'done' && hasWall() ? `<a href="${to}">${inner}</a>` : `<span class="step-in">${inner}</span>`}</li>`;
  }).join('')}</ol>`;
}
function footer() {
  return `<footer class="site-foot">
    <p>Walldrobe: a wardrobe for your walls. Rent the Runway, for art.</p>
    <p>Photos shown here are from Unsplash, Pexels and Pixabay, credited to each photographer and shown under each site's own license. Prints from Desenio and House of Spoils link to the shop's own page. Walldrobe doesn't sell anything and isn't paid for these links. Your wall photos stay on your device.</p>
  </footer>`;
}
const flashHtml = () => (S.flash ? `<p class="flash" role="status">${esc(S.flash)}</p>` : '');

// ---------- Engine ----------

function engineInput() {
  const d = S.draft;
  const owned = d.owned.map((p) => ({
    id: p.id, title: p.title, w: p.w, h: p.h, keep: p.keep, drop: p.drop,
    pinned: !!(p.pinned && p.at), at: p.pinned && p.at ? p.at : undefined,
    palette: p.palette && p.palette.length ? p.palette : p.color ? [{ hex: p.color, weight: 1 }] : undefined,
  }));
  // Which art to pick from: real prints from shops, photos, or both (prints lean ahead a little).
  const mode = artMode();
  const keptIds = new Set(keepList().map((k) => k.id));
  const isShop = (c) => c.offers && c.offers.length > 0;
  const byMode = mode === 'both' ? CATALOG : CATALOG.filter((c) => keptIds.has(c.id) || (mode === 'prints' ? isShop(c) : !isShop(c)));
  const catalog = applyFilters(byMode, keptIds);
  const taste = scoreTaste(d.taste.weights, catalog);
  if (mode === 'both') for (const c of catalog) if (isShop(c) && taste[c.id] != null) taste[c.id] = Math.min(1, taste[c.id] + 0.08);
  const room = d.room && d.room.length ? { palette: d.room } : undefined;
  return { wall: { width: d.width, height: d.height }, obstacles: d.obstacles, owned, catalog, taste, room, count: 3, prefs: { scale: d.scale || 0 } };
}
const keepList = () => S.draft.kept || [];

// ---------- Filters ----------
// Take art out the way a shop's filters do: color, people, price, subjects, shops.
const NO_FILTERS = { color: 'any', people: 'any', maxPrice: null, skip: [], shops: [] };
const filters = () => ({ ...NO_FILTERS, ...((S.draft && S.draft.filters) || {}) });
const filterCount = (f = filters()) => (f.color !== 'any') + (f.people !== 'any') + (f.maxPrice != null) + f.skip.length + f.shops.length;
const SHOP_OF = (c) => (c.offers && c.offers.length ? c.record.source.provider : 'free');
const SHOPS = [['desenio', 'Desenio'], ['houseofspoils', 'House of Spoils'], ['free', 'Free photos']];
const PRICES = [[null, 'Any price'], [50, 'Under $50'], [100, 'Under $100'], [250, 'Under $250'], [500, 'Under $500']];
const CAT_NAME = (c) => c[0].toUpperCase() + c.slice(1);
function passes(c, f) {
  const r = c.record;
  if (f.color === 'color' && r.color.bw) return false;
  if (f.color === 'bw' && !r.color.bw) return false;
  if (f.people === 'none' && r.tags.people) return false;
  if (f.skip.includes(r.category)) return false;
  if (f.shops.includes(SHOP_OF(c))) return false;
  return true;
}
function applyFilters(list, keptIds = new Set()) {
  const f = filters();
  if (!filterCount(f)) return list;
  const out = [];
  for (const c of list) {
    if (keptIds.has(c.id)) { out.push(c); continue; }
    if (!passes(c, f)) continue;
    if (f.maxPrice != null && c.offers && c.offers.length) {
      const sizes = c.sizes.filter((z) => z.price == null || z.price <= f.maxPrice);
      if (!sizes.length) continue;
      out.push(sizes.length === c.sizes.length ? c : { ...c, sizes });
    } else out.push(c);
  }
  return out;
}
function setFilter(fn) {
  const f = filters(); fn(f);
  S.draft.filters = { ...f, skip: [...f.skip], shops: [...f.shops] };
  S.rank = 1; S.selected = null; S.flash = null; persist();
}
function filterPanel() {
  const f = filters();
  const mode = artMode();
  const isShop = (c) => c.offers && c.offers.length > 0;
  const base = mode === 'both' ? CATALOG : CATALOG.filter((c) => (mode === 'prints' ? isShop(c) : !isShop(c)));
  const matching = applyFilters(base).length;
  const cats = {};
  // Black and white is a color choice (above), not a subject.
  for (const c of base) if (c.record.category !== 'black and white' && passes(c, { ...f, skip: [] })) cats[c.record.category] = (cats[c.record.category] || 0) + 1;
  const catList = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const seg = (key, opts, cur) => `<span class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-filter="${key}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</span>`;
  return `<div class="filters" id="filters">
    <div class="filter-row"><span class="lever-label">Color</span>${seg('color', [['any', 'Any'], ['color', 'Color only'], ['bw', 'Black and white only']], f.color)}</div>
    <div class="filter-row"><span class="lever-label">People</span>${seg('people', [['any', 'Any'], ['none', 'No people']], f.people)}</div>
    <div class="filter-row"><span class="lever-label">Price</span><span class="seg" role="group">${PRICES.map(([v, l]) => `<button type="button" data-filter="price" data-v="${v == null ? '' : v}" aria-pressed="${f.maxPrice === v}">${l}</button>`).join('')}</span></div>
    ${mode !== 'photos' ? `<div class="filter-row"><span class="lever-label">From</span><span class="chips">${SHOPS.filter(([k]) => mode === 'both' || k !== 'free').map(([k, l]) => `<button type="button" class="fchip" data-filter="shop" data-v="${k}" aria-pressed="${!f.shops.includes(k)}">${l}</button>`).join('')}</span></div>` : ''}
    <div class="filter-row filter-cats"><span class="lever-label">Subjects</span><span class="chips">${catList.map(([k, n]) => `<button type="button" class="fchip" data-filter="skip" data-v="${esc(k)}" aria-pressed="${!f.skip.includes(k)}">${esc(CAT_NAME(k))} <span class="muted">${n}</span></button>`).join('')}</span></div>
    <p class="filter-sum"><strong>${matching.toLocaleString()} pieces match.</strong> Tap a subject or shop to take it out.${filterCount(f) ? ' <button type="button" class="btn-quiet small-btn" data-filter="clear">Clear filters</button>' : ''}</p>
  </div>`;
}
const ART_MODES = ['prints', 'both', 'photos'];
const artMode = () => (ART_MODES.includes(S.draft && S.draft.art) ? S.draft.art : 'prints');
const viewKey = () => JSON.stringify([S.draft.id, S.draft.width, S.draft.height, S.draft.obstacles, S.draft.owned.map((p) => [p.id, p.title, p.w, p.h, p.keep, p.pinned, p.at, p.color, p.palette]), S.draft.taste.weights, keepList().map((k) => k.id), S.draft.scale, artMode(), filters()]);

function remember(layouts) {
  for (const L of layouts) {
    if (!S.avoid.includes(L.key)) S.avoid.push(L.key);
    const seen = S.seen.get(L.key) || new Set();
    for (const p of L.pieces) if (p.ref.source === 'catalog') seen.add(p.ref.id);
    S.seen.set(L.key, seen);
  }
}
function run() {
  const key = viewKey();
  if (S.view && S.view.key === key) return S.view;
  const r = layout({ ...engineInput(), keep: keepList() });
  let layouts = r.layouts;
  // A saved wall opens on the layout you chose, if it still fits.
  const chosen = S.draft.chosen;
  if (chosen && chosen.inputKey === key) {
    layouts = [{ ...chosen.layout, rank: 1 }, ...layouts.filter((L) => L.key !== chosen.layout.key).slice(0, 2).map((L, i) => ({ ...L, rank: i + 2 }))];
  }
  S.view = { key, layouts, problems: r.problems };
  remember(layouts);
  return S.view;
}
const shown = () => run().layouts.find((x) => x.rank === S.rank) || run().layouts[0];

function refreshShown(swapId) {
  const L = shown();
  if (!L) return;
  const input = engineInput();
  const keep = L.pieces.filter((p) => keepList().some((k) => k.id === p.ref.id)).map((p) => p.ref.id);
  const exclude = [...(S.seen.get(L.key) || [])].filter((id) => !keep.includes(id));
  const opts = swapId ? { swap: swapId } : { keep };
  const kin = keepList().filter((k) => keep.includes(k.id));
  let r = refill({ ...input, keep: kin, exclude }, L, opts);
  if (!r.layouts.length) r = refill({ ...input, keep: kin }, L, opts);
  if (!r.layouts.length) { S.flash = r.problems[0] ? r.problems[0].message : 'No other art fits these frames.'; return; }
  const next = { ...r.layouts[0], rank: L.rank };
  S.ui.saved = null;
  S.view.layouts = S.view.layouts.map((x) => (x.rank === L.rank ? next : x));
  remember([next]);
  if (r.problems.some((p) => p.code === 'NOTHING_TO_CHANGE')) S.flash = 'Every piece here is kept or yours. Unkeep one to refresh it.';
}
function newLayouts() {
  const r = layout({ ...engineInput(), keep: keepList(), avoid: S.avoid });
  if (r.problems.some((p) => p.code === 'ALL_SHOWN')) { S.flash = "That's every arrangement that fits this wall, so these start again from the best."; S.avoid = []; }
  S.view = { key: viewKey(), layouts: r.layouts, problems: r.problems };
  remember(r.layouts);
  S.rank = 1; S.selected = null; S.ui.saved = null;
}
function rebuildOthers(L) {
  S.ui.saved = null;
  const r = layout({ ...engineInput(), keep: keepList(), count: 6 });
  const others = r.layouts.filter((x) => x.key !== L.key).slice(0, 2);
  S.view = { key: viewKey(), layouts: [{ ...L, rank: 1 }, ...others.map((x, i) => ({ ...x, rank: i + 2 }))], problems: r.problems };
  S.rank = 1;
  remember(others);
}
function act(name, fn) {
  if (S.busy) return;
  S.busy = name; render();
  setTimeout(() => { try { fn(); } finally { S.busy = null; render(); } }, 30);
}

// ---------- Photo pieces in memory ----------

async function ensurePixels() {
  const d = S.draft, p = d && d.photo;
  if (!p) return;
  const mem = S.mem;
  if (!mem.photo && p.src) { const img = await fromDataUrl(p.src); if (S.draft === d && S.mem === mem) mem.photo = img; }
  if (!mem.flat && p.flat) { const src = p.flat; const img = await fromDataUrl(src); if (S.draft === d && S.mem === mem && p.flat === src) mem.flat = img; }
}
// The flattened wall with every piece you own painted out, except pinned ones.
function cleanWall() {
  const p = S.draft.photo;
  if (!p || !p.flat) return null;
  const moving = S.draft.owned.filter((o) => o.rect && !o.pinned);
  const key = JSON.stringify(moving.map((o) => o.rect));
  if (S.mem.clean && S.mem.cleanKey === key) return S.mem.clean;
  if (p.clean && p.cleanKey === key) { S.mem.clean = p.clean; S.mem.cleanKey = key; return p.clean; }
  if (!S.mem.flat) return p.flat;
  const img = { data: new Uint8ClampedArray(S.mem.flat.data), width: S.mem.flat.width, height: S.mem.flat.height };
  const m = p.ppi; // a small margin for the frame's shadow
  for (const o of moving) paintOut(img, { x: o.rect.x - m, y: o.rect.y - m, w: o.rect.w + 2 * m, h: o.rect.h + 2 * m }, Math.round(2 * p.ppi));
  S.mem.clean = toDataUrl(img, 0.82); S.mem.cleanKey = key;
  // Kept with the wall so saved walls and their previews show it without the old spots.
  p.clean = S.mem.clean; p.cleanKey = key;
  persist();
  return S.mem.clean;
}

// ---------- Home ----------

let homeLayout = null;
function home() {
  if (!homeLayout) {
    const w = SAMPLES[0];
    const taste = scoreTaste(fitTaste(samplePicks()), CATALOG);
    homeLayout = { w, L: layout({ wall: w.wall, obstacles: w.obstacles, owned: w.owned, catalog: CATALOG, taste, room: w.room, count: 1 }).layouts[0] };
  }
  const { w, L } = homeLayout;
  const saved = store.listWalls();
  const resume = !!ownDraftSaved();
  return `${header()}
  <main class="home">
    <section class="hero">
      <div class="hero-wall"><span class="sample-tag hero-tag">Sample wall</span>${wallSvg({ wall: w.wall, obstacles: w.obstacles, layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, measure: true, pxWide: 900, still: true, label: 'A finished living room wall' })}</div>
      <div class="hero-copy">
        <h1>A wardrobe for your walls.</h1>
        <p class="lede">Take one photo of a wall. You get a finished wall, sized and spaced for it and the art you already own, down to where each nail goes. The frames stay; change the art whenever you like.</p>
        <div class="acts">
          <a class="btn" href="#/new">${resume ? 'Start a new wall' : 'Start with your wall'}</a>
          ${resume ? '<a class="btn-quiet" href="#/resume">Back to your wall</a>' : '<a class="btn-quiet" href="#/sample/living">See a sample wall</a>'}
        </div>
        ${saved.length ? `<p class="muted small">You have ${saved.length} saved wall${saved.length === 1 ? '' : 's'}. <a href="#/walls">Open them</a>.</p>` : ''}
      </div>
    </section>
    <section class="how" aria-labelledby="how-h">
      <h2 id="how-h">How it works</h2>
      <ol class="how-list">
        <li><strong>Take a photo of one wall.</strong> It finds the floor, the TV, the furniture and the art you already have, and sizes the wall from them.</li>
        <li><strong>Check what it found.</strong> Fix the width if you know it, and say which of your pieces you'd keep.</li>
        <li><strong>Get your wall.</strong> Three layouts on your own photo, each piece's size and frame, where it goes and why. Keep what you like, swap the rest, and get a hanging guide.</li>
      </ol>
    </section>
    <section class="why-home">
      <div><h3>Real inches</h3><p>57 in to center, 2 to 3 in between frames, about two thirds the width of the couch, clear of the window and the outlets.</p></div>
      <div><h3>What you own comes first</h3><p>Your pieces stay unless you say otherwise, and new ones are picked to go with them.</p></div>
      <div><h3>The frame stays</h3><p>New pieces come in standard frame sizes, so swapping a print later means no new holes.</p></div>
    </section>
  </main>
  ${footer()}`;
}

// ---------- Start: photo or size ----------

function start() {
  const d = S.draft && !S.draft.sample ? S.draft : null;
  const ft = (v) => (v ? Math.floor(v / 12) : ''), inch = (v) => (v ? Math.round(v % 12) : '');
  return `${header()}${steps('wall')}
  <main class="flow">
    <h1>Take a photo of one wall</h1>
    <p class="lede">Stand back and take the whole wall, floor to ceiling if you can. People in the photo aren't needed.</p>
    ${flashHtml()}
    <section class="card">
      <h2>Your photo</h2>
      <label class="upload">
        <input type="file" accept="image/*" id="photo-input">
        <span class="btn" data-busy-label>${S.busy === 'photo' ? busyPhotoLabel() : 'Take or choose a photo'}</span>
        <span class="muted small">Only you can see it. It stays on this device, and so does the photo reader: the first photo downloads it (about 30 MB) and it runs right here.</span>
      </label>
      ${S.ui.photoErr ? `<p class="error">${esc(S.ui.photoErr)}</p>` : ''}
      ${d && d.photo ? '<p class="small"><a href="#/check">Keep using the photo you added</a></p>' : ''}
    </section>
    <section class="card">
      <h2>No photo? Type the size</h2>
      <form id="size-form" class="size-form">
        <fieldset><legend>Width</legend>
          <label><input type="number" inputmode="numeric" min="2" max="40" name="wft" value="${ft(d && d.width)}" required> ft</label>
          <label><input type="number" inputmode="numeric" min="0" max="11" name="win" value="${inch(d && d.width)}"> in</label>
        </fieldset>
        <fieldset><legend>Height, floor to ceiling</legend>
          <label><input type="number" inputmode="numeric" min="5" max="20" name="hft" value="${ft(d && d.height) || 8}" required> ft</label>
          <label><input type="number" inputmode="numeric" min="0" max="11" name="hin" value="${inch(d && d.height) || 0}"> in</label>
        </fieldset>
        ${S.ui.sizeErr ? `<p class="error">${esc(S.ui.sizeErr)}</p>` : ''}
        <button class="btn" type="submit">Next</button>
      </form>
    </section>
    <section class="card quiet">
      <h2>No tape measure handy?</h2>
      <p class="muted">Try it on a sample room first.</p>
      <div class="acts">${SAMPLES.map((w) => `<a class="btn-quiet" href="#/sample/${w.key}">${esc(w.name)}</a>`).join('')}</div>
    </section>
  </main>${footer()}`;
}

function busyPhotoLabel() {
  return S.ui.modelPct != null ? `Getting the photo reader ready… ${S.ui.modelPct}%` : 'Reading your wall…';
}
function showBusyLabel() { const el = document.querySelector('[data-busy-label]'); if (el && S.busy === 'photo') el.textContent = busyPhotoLabel(); }
// The model's labels for the photo, from memory or from the saved wall.
function photoLabels() {
  const p = S.draft && S.draft.photo;
  if (!p || !p.seg) return null;
  if (!S.mem.seg) S.mem.seg = unpackLabels(p.seg);
  return S.mem.seg;
}

async function onPhoto(file) {
  S.ui.photoErr = null;
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) { S.ui.photoErr = "That file won't open. Use a JPG, PNG or HEIC under 20 MB."; render(); return; }
  try {
    S.busy = 'photo'; render();
    const img = await loadFile(file, 1400);
    const q = photoQuality(img);
    S.draft = { ...blankDraft(), taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null } };
    // Label the photo with the image model (wall, ceiling, floor, art, TV...).
    // If it can't load, the photo is read without it.
    let seg = null;
    try {
      if (!(await modelCached())) { S.ui.modelPct = 0; showBusyLabel(); }
      seg = await segment(img, (f) => { S.ui.modelPct = Math.round(f * 100); showBusyLabel(); });
    } catch (err) { console.warn('photo reader', err); seg = null; }
    S.ui.modelPct = null; showBusyLabel();
    // Find the wall in the photo: its four corners, for the person to check.
    // Nothing is read off the photo until they say the corners are right.
    const found = suggestWall(img, seg);
    S.draft.photo = {
      src: img.url, w: img.width, h: img.height,
      corners: found.corners, seen: { ceiling: found.ceiling, floor: found.floor, floorFrom: found.floorFrom, seenBottom: found.seenBottom || null, sides: found.sides, soffit: !!found.soffit, model: !!seg },
      seg: seg ? packLabels(seg) : null,
      flat: null, ppi: null, measure: { which: 'width', value: null }, mode: 'auto',
    };
    S.mem = { photo: img, flat: null, clean: null, cleanKey: null, seg };
    S.ui.quality = q.brightness < 0.15 || q.sharpness < 0.012 ? 'The photo is dark or blurry, so the guesses may be off. Check them below.' : null;
    resetLayouts();
    persist();
    S.busy = null;
    go('#/corners');
  } catch (e) {
    S.busy = null;
    S.ui.photoErr = e.message || "That file won't open. Use a JPG, PNG or HEIC under 20 MB.";
    render();
  }
}

// ---------- Reading the photo ----------

// A thumbnail and a palette for a box of pixels.
function thumbAndPalette(img, r) {
  const part = crop(img, r);
  const pal = palette(part, 5);
  const sc = Math.min(1, 240 / Math.max(part.width, part.height));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(part.width * sc)); cv.height = Math.max(1, Math.round(part.height * sc));
  const tmp = document.createElement('canvas'); tmp.width = part.width; tmp.height = part.height;
  tmp.getContext('2d').putImageData(new ImageData(part.data, part.width, part.height), 0, 0);
  cv.getContext('2d').drawImage(tmp, 0, 0, cv.width, cv.height);
  return { thumb: cv.toDataURL('image/jpeg', 0.8), palette: pal };
}

// Read the wall inside the corners: flatten it, then find what hangs on it and
// what stands in front. The scale comes from a TV found on its own, or else from
// one measurement the person gives.
const REGION_W = 600;
function regionImg() {
  const p = S.draft.photo, k = JSON.stringify(p.corners);
  if (S.mem.region && S.mem.regionKey === k) return S.mem.region;
  const { aspect } = aspectFromCorners(p.corners, p.w, p.h);
  S.mem.region = flatten(S.mem.photo, p.corners, REGION_W, Math.max(40, Math.round(REGION_W / aspect)));
  S.mem.regionKey = k;
  return S.mem.region;
}
async function readPhoto() {
  const d = S.draft, p = d.photo;
  await ensurePixels();
  const img = regionImg();
  // Where a table or a couch in front hides the bottom of the wall, what stands there runs down to the floor.
  const seg = photoLabels();
  const labels = seg ? { seg, toPhoto: homography([[0, 0], [img.width, 0], [img.width, img.height], [0, img.height]], p.corners), photoW: p.w, photoH: p.h } : undefined;
  const found = readWall(img, { hiddenFrom: hiddenFromFor(p.corners, p.seen && p.seen.seenBottom, img.width, img.height), labels });
  const items = found.items.map((it, i) => ({ ...it, id: `auto${i}`, removed: false }));
  for (const it of items) if (it.kind === 'art') Object.assign(it, thumbAndPalette(img, it));
  // A TV on a stand sits out from the wall and looks bigger than it would on it.
  const tv = items.find((i) => i.kind === 'tv' && i.alone);
  let tvPx = 0;
  if (tv && tv.onStand) {
    const Hm = homography([[0, 0], [img.width, 0], [img.width, img.height], [0, img.height]], p.corners);
    const a = apply(Hm, tv.x, tv.y + tv.h / 2), b = apply(Hm, tv.x + tv.w, tv.y + tv.h / 2);
    tvPx = Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const depth = (dg) => (tvPx ? tvDepthFactor(tvPx, Math.hypot(p.w, p.h), dg) : 1);
  // A 55 in TV unless that makes a ceiling the photo shows lower than 7 ft or
  // higher than 11 ft; then the next size that doesn't.
  let tvInches = (p.auto && p.auto.tvInches) || 55, tvWhy = null;
  if (!(p.auto && p.auto.tvInches) && !(p.seen && (p.seen.ceiling === false || p.seen.soffit))) {
    const ceil = (dg) => { const g = guessWidth(items, img.width, dg, depth(dg)); return g ? (g.inches * img.height) / img.width : null; };
    const c55 = ceil(55);
    if (c55 && c55 < 84) { tvInches = [65, 75].find((dg) => ceil(dg) >= 84) || 75; tvWhy = 'low'; }
    if (c55 && c55 > 132) { tvInches = [50, 43].find((dg) => ceil(dg) <= 132) || 43; tvWhy = 'high'; }
  }
  p.auto = { items, rw: img.width, rh: img.height, wallRgb: labToRgb(found.wallColor), tvInches, tvWhy, tvPx, depth: depth(tvInches), guess: guessWidth(items, img.width, tvInches, depth(tvInches)) };
  d.obstacles = d.obstacles.filter((o) => !o.autoId);
  d.owned = d.owned.filter((o) => !o.autoId);
  p.lastW = null; p.lastH = null;
  if (!p.auto.guess) { p.measure = { which: 'width', value: null }; return '#/size'; }
  setScale(p.auto.guess.inches);
  applyAuto(); flattenAuto();
  return '#/check';
}
// The width sets the scale. The height is what the photo shows, or at least
// 8 ft when the ceiling wasn't in it.
function setScale(W, H) {
  const d = S.draft, p = d.photo, a = p.auto;
  d.width = W;
  a.shownH = Math.round((W * a.rh) / a.rw);
  const noCeiling = p.seen && p.seen.ceiling === false;
  d.height = Math.min(240, Math.max(72, H || (noCeiling ? Math.max(96, a.shownH) : a.shownH)));
}

// What the photo reader calls things. Without the image model a lamp and a
// plant look the same, so they're named together.
const AUTO_KIND = (k) => (KIND_NAME[k] ? k : 'furniture');
const AUTO_LABEL = (k, model) => (k === 'lamp' && !model ? 'Lamp or plant' : KIND_NAME[AUTO_KIND(k)]);
const r2 = (v) => Math.round(v * 2) / 2;

// What was found on the flattened wall, in wall inches, measured up from the floor
// (the bottom corners). The width sets the scale.
function applyAuto() {
  const d = S.draft, p = d.photo, a = p.auto;
  const rw = a.rw || p.w, rh = a.rh || a.floorPx;
  const s = d.width / rw;
  const inch = (it) => {
    // A TV out on its stand looks bigger than it is: back to its real size, still sitting on the stand.
    const k = it.kind === 'tv' && a.depth ? 1 / a.depth : 1;
    const w = r2(it.w * s * k);
    const h = it.kind === 'tv' ? Math.max(r2(it.h * s * k), r2(w * 9 / 16)) : r2(it.h * s);
    return { x: r2((it.x + (it.w * (1 - k)) / 2) * s), y: Math.max(0, r2((rh - it.y - it.h) * s)), w, h };
  };
  const live = a.items.filter((i) => !i.removed);
  d.obstacles = [
    ...d.obstacles.filter((o) => !o.autoId),
    ...live.filter((i) => i.kind !== 'art').map((i) => clampOb({ id: i.id, autoId: i.id, kind: AUTO_KIND(i.kind), label: AUTO_LABEL(i.kind, p.seen && p.seen.model), ...inch(i) })),
  ];
  const prev = new Map(d.owned.filter((o) => o.autoId).map((o) => [o.autoId, o]));
  const arts = live.filter((i) => i.kind === 'art');
  d.owned = [
    ...d.owned.filter((o) => !o.autoId),
    ...arts.map((i, n) => {
      const c = inch(i);
      const o = prev.get(i.id) || { id: i.id, autoId: i.id, title: n ? `print ${n + 1}` : 'print', keep: 'happy', pinned: false, thumb: i.thumb, palette: i.palette, color: i.palette && i.palette[0] ? i.palette[0].hex : null, fromPhoto: true };
      return { ...o, at: { x: c.x, y: c.y }, w: c.w, h: c.h };
    }),
  ];
}

// The flattened wall at its size: the photo inside the corners, and plain wall
// color above the top corners when the ceiling is higher than the photo shows.
function flattenAuto() {
  const d = S.draft, p = d.photo, a = p.auto;
  const rw = a.rw || p.w, rh = a.rh || a.floorPx;
  const s = d.width / rw; // inches per pixel of the read wall
  const top = rh - d.height / s; // the ceiling, in those pixels (below zero when the photo stops short of it)
  const Hm = homography([[0, 0], [rw, 0], [rw, rh], [0, rh]], p.corners);
  const full = [apply(Hm, 0, top), apply(Hm, rw, top), p.corners[2], p.corners[3]];
  const ppi = Math.min(8, 1600 / Math.max(d.width, d.height));
  const outW = Math.round(d.width * ppi), outH = Math.round(d.height * ppi);
  const out = flatten(S.mem.photo, full, outW, outH, a.wallRgb);
  // Above the top corners is the ceiling or a soffit in the photo, not wall: paint it plain.
  const cut = Math.min(outH, Math.round(Math.max(0, d.height - rh * s) * ppi));
  for (let i = 0; i < cut * outW; i++) { out.data[i * 4] = a.wallRgb[0]; out.data[i * 4 + 1] = a.wallRgb[1]; out.data[i * 4 + 2] = a.wallRgb[2]; }
  // Things marked by hand keep their place on the wall when its size changes.
  const fx = p.lastW ? d.width / p.lastW : 1, fy = p.lastH ? d.height / p.lastH : 1;
  if (fx !== 1 || fy !== 1) {
    for (const o of d.obstacles) if (!o.autoId) { o.x *= fx; o.w *= fx; o.y *= fy; o.h *= fy; }
    for (const o of d.owned) if (!o.autoId && o.at) { o.at = { x: r2(o.at.x * fx), y: r2(o.at.y * fy) }; o.w = r2(o.w * fx); o.h = r2(o.h * fy); }
  }
  d.obstacles = d.obstacles.map(clampOb);
  S.mem.flat = out; S.mem.clean = null;
  p.flat = toDataUrl(out, 0.85); p.ppi = ppi; p.clean = null; p.cleanKey = null;
  p.lastW = d.width; p.lastH = d.height;
  for (const o of d.owned) if (o.at) o.rect = { x: o.at.x * ppi, y: (d.height - o.at.y - o.h) * ppi, w: o.w * ppi, h: o.h * ppi };
  d.room = palette(out, 5);
}

// ---------- Check what was found ----------

function foundSentence(d) {
  const n = (...ks) => d.obstacles.filter((o) => ks.includes(o.kind)).length;
  const parts = [];
  const count = (k, one, many) => (k === 1 ? one : many.replace('#', k));
  if (n('tv')) parts.push(count(n('tv'), 'a TV', '# TVs'));
  if (n('furniture', 'console', 'couch', 'headboard', 'dresser', 'shelf')) parts.push('furniture');
  const lit = d.photo && d.photo.seen && d.photo.seen.model;
  if (lit) {
    if (n('lamp')) parts.push(count(n('lamp'), 'a lamp', '# lamps'));
    if (n('plant')) parts.push(count(n('plant'), 'a plant', '# plants'));
  } else if (n('lamp', 'plant')) parts.push(n('lamp', 'plant') === 1 ? 'a lamp or plant' : 'lamps or plants');
  if (n('window')) parts.push(count(n('window'), 'a window', '# windows'));
  if (n('door')) parts.push(count(n('door'), 'a door', '# doors'));
  if (n('mirror')) parts.push(count(n('mirror'), 'a mirror', '# mirrors'));
  if (d.owned.length) parts.push(d.owned.length === 1 ? '1 piece of art you already have' : `${d.owned.length} pieces of art you already have`);
  if (!parts.length) return 'Nothing in the way. A bare wall.';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `We found ${list}.`;
}

// Something found in the photo that the person removed or changed by hand: don't bring it back.
function forgetAuto(id) {
  const a = S.draft && S.draft.photo && S.draft.photo.auto;
  if (!a) return;
  const it = a.items.find((i) => i.id === id);
  if (it) it.removed = true;
  for (const o of [...S.draft.obstacles, ...S.draft.owned]) if (o.autoId === id) delete o.autoId;
}

async function changeDims(f) {
  const v = (n) => Number(f.elements[n].value || 0);
  const W = v('wft') * 12 + v('win'), H = v('hft') * 12 + v('hin');
  if (W < 24 || W > 600) { S.ui.sizeErr = 'A wall between 2 ft and 50 ft wide works here. Check the width.'; render(); return; }
  if (H < 72 || H > 240) { S.ui.sizeErr = 'A ceiling between 6 ft and 20 ft works here. Check the height.'; render(); return; }
  S.ui.sizeErr = null;
  const d = S.draft;
  await ensurePixels();
  const a = d.photo && d.photo.auto;
  d.width = W; d.height = H;
  if (a && a.rw) a.shownH = Math.round((W * a.rh) / a.rw);
  applyAuto();
  flattenAuto();
  resetLayouts(); persist(); render();
}

// A dashed line where the photo stops, when the wall above it is drawn, not photographed.
function photoTopLine(d, s) {
  const a = d.photo && d.photo.mode === 'auto' && d.photo.auto;
  if (!a || !a.shownH || d.height <= a.shownH + 2) return '';
  const y = d.height - a.shownH;
  return `<g class="photo-top"><line x1="0" y1="${y}" x2="${d.width}" y2="${y}"/><text x="${s * 0.6}" y="${y - s * 0.5}" font-size="${s * 0.8}">Above here is drawn, not photographed</text></g>`;
}

function check() {
  if (need()) { go(need()); return ''; }
  const d = S.draft, p = d.photo;
  if (!p) { go('#/things'); return ''; }
  const auto = p.mode === 'auto' && p.auto;
  const H = d.height, s = labelSize(d.width, editPx());
  const boxes = [
    ...d.obstacles.map((o) => `<g class="ob"><rect x="${o.x}" y="${H - o.y - o.h}" width="${o.w}" height="${o.h}" class="ob-box"/>${o.w >= 8 ? `<text x="${o.x + o.w / 2}" y="${H - o.y - o.h / 2}" font-size="${s * 0.85}" class="ob-label">${esc(obName(o))}</text>` : ''}</g>`),
    ...d.owned.filter((o) => o.at).map((o) => `<g class="owned-mark"><rect x="${o.at.x}" y="${H - o.at.y - o.h}" width="${o.w}" height="${o.h}" class="owned-box-mark"/><text x="${o.at.x + o.w / 2}" y="${H - o.at.y - o.h - s * 0.4}" font-size="${s * 0.85}" class="ob-label">Your ${esc(o.title)}</text></g>`),
  ].join('') + photoTopLine(d, s);
  const ft = (v) => Math.floor(v / 12), inch = (v) => Math.round(v % 12);
  const from = auto && p.auto.guess ? p.auto.guess.from : null;
  const why = { low: ' A 55 in one would put the ceiling under 7 ft.', high: ' A 55 in one would put the ceiling over 11 ft.' }[p.auto.tvWhy] || '';
  const guess = from === 'tv' ? `Worked out from your TV, taken as a ${p.auto.tvInches} in TV${p.auto.tvPx ? ' standing a little out from the wall' : ''}.${why} Measure the wall to be exact.` : from === 'measure' ? 'From your measurement.' : 'Measure the wall to be exact.';
  const tvPick = from === 'tv' ? `<label class="tv-size">Your TV <select id="tv-size" aria-label="Your TV's size">${TV_SIZES.map(([dg]) => `<option value="${dg}"${dg === p.auto.tvInches ? ' selected' : ''}>${dg} in</option>`).join('')}</select></label>` : '';
  const opts = [['must', 'Must keep'], ['happy', 'Happy to move'], ['dontcare', "Don't care"]];
  const rows = [
    ...d.owned.map((o) => `<li>
      <span class="f-thumb">${o.thumb ? `<img src="${o.thumb}" alt="">` : '<span class="f-icon">Art</span>'}</span>
      <span class="f-main"><span class="f-name">Your ${esc(o.title)}, ${o.w} x ${o.h} in</span>
        <span class="seg seg-full" role="group" aria-label="Keep setting for your ${esc(o.title)}">${opts.map(([v, l]) => `<button type="button" data-keep="${v}" data-oid="${esc(o.id)}" aria-pressed="${o.keep === v}">${l}</button>`).join('')}</span></span>
      <button type="button" class="linklike" data-remove-owned="${esc(o.id)}" aria-label="Not art, remove your ${esc(o.title)}">Remove</button>
    </li>`),
    ...d.obstacles.map((o) => `<li>
      <span class="f-thumb"><span class="f-icon">${esc(obName(o).split(' ')[0])}</span></span>
      <span class="f-main"><span class="f-name">${esc(obName(o))}, ${o.w} x ${o.h} in</span>
        ${o.autoId && o.kind !== 'tv' ? `<button type="button" class="linklike" data-is-art="${esc(o.autoId)}" aria-label="${esc(obName(o))} is really art">It's art</button>` : ''}</span>
      <button type="button" class="linklike" data-remove-ob="${esc(o.id)}" aria-label="Remove ${esc(obName(o))}">Remove</button>
    </li>`),
  ].join('');
  return `${header()}${steps('check')}
  <main class="flow">
    <h1>Here's your wall</h1>
    <p class="lede">${esc(foundSentence(d))} Check the size, then we'll lay it out.</p>
    ${S.ui.quality ? `<p class="note">${esc(S.ui.quality)}</p>` : ''}
    <div class="wall-edit has-photo check-wall">${wallSvg({ wall: { width: d.width, height: H }, photo: p.flat, obstacles: [], extra: boxes, pxWide: editPx(), still: true, label: 'Your wall photo, flattened' })}</div>
    ${auto ? `<form id="dims-form" class="dims">
      <fieldset class="size-form"><legend>Wall width</legend>
        <span class="acts"><label><input type="number" inputmode="numeric" min="2" max="50" name="wft" value="${ft(d.width)}"> ft</label><label><input type="number" inputmode="numeric" min="0" max="11" name="win" value="${inch(d.width)}"> in</label></span>
        <span class="guess">${esc(guess)}</span>${tvPick}</fieldset>
      <fieldset class="size-form"><legend>${p.seen && p.seen.soffit ? 'Height under the soffit' : 'Ceiling height'}</legend>
        <span class="acts"><label><input type="number" inputmode="numeric" min="6" max="20" name="hft" value="${ft(H)}"> ft</label><label><input type="number" inputmode="numeric" min="0" max="11" name="hin" value="${inch(H)}"> in</label></span>
        <span class="guess">${p.auto.shownH && H > p.auto.shownH + 2 ? `Your photo shows the bottom ${esc(feet(p.auto.shownH))}. The rest is drawn as plain wall, so check this.` : p.seen && p.seen.ceiling === false ? "The photo doesn't show where the wall meets the ceiling, so check this." : p.seen && p.seen.soffit ? `From the floor up to the soffit, ${esc(feet(p.auto.shownH || H))} in your photo. The ceiling is higher past it, but art on this wall goes under it.` : `Your photo shows ${esc(feet(p.auto.shownH || H))} of wall. If the ceiling is higher, put it here.`}</span></fieldset>
    </form>` : `<p class="size-read">${esc(feet(d.width))} wide, ${esc(feet(H))} tall</p>`}
    ${S.ui.sizeErr ? `<p class="error">${esc(S.ui.sizeErr)}</p>` : ''}
    ${rows ? `<ul class="found">${rows}</ul>` : ''}
    ${auto && !d.owned.length ? `<div class="ask-art"><p><strong>Is there art on this wall already?</strong> We didn't find any. If there is, mark it and we'll plan around it, or swap what's in the frame.</p><a class="btn-quiet small-btn" href="#/pieces">Mark my art</a></div>` : ''}
    ${flashHtml()}
    <div class="acts">
      <a class="btn" href="#/layouts">Show me my wall</a>
    </div>
    <p class="small muted">Something missed or wrong? <a href="#/things">Move or add things</a>, <a href="#/pieces">add art we missed</a>, or <a href="#/corners">move the corners</a>.</p>
  </main>${footer()}`;
}

// ---------- Corners ----------

function corners() {
  const p = S.draft && S.draft.photo;
  if (!p) { go('#/start'); return ''; }
  const c = p.corners;
  const err = cornerProblem(c, p.w, p.h);
  const r = Math.max(p.w, p.h) / 45;
  const names = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
  const seen = p.seen || {};
  const misses = [
    seen.ceiling === false ? "We couldn't see the ceiling, so the top dots are at the top of the photo. You'll set the ceiling height next." : null,
    seen.soffit ? "There's a soffit over this wall (the ceiling drops there), so the top dots are under it. Art goes below it; the ceiling is higher past it." : null,
    seen.model === false ? "The photo reader didn't load, so these are rougher guesses than usual. Check them." : null,
    seen.floorFrom === 'stand' ? "The floor is hidden behind the furniture, so the bottom dots are a guess from your TV stand. Drag them if they're off." : seen.floor === false ? "We couldn't see where the wall meets the floor. Drag the bottom dots down to it, guessing behind furniture." : null,
  ].filter(Boolean);
  return `${header()}${steps('wall')}
  <main class="flow">
    <h1>Check the corners of your wall</h1>
    <p class="lede">We put a dot on each corner. Drag any that are off: the top ones where the wall meets the ceiling, the bottom ones where it meets the floor. Behind furniture, guess where the corner is.</p>
    ${S.ui.quality ? `<p class="note">${esc(S.ui.quality)}</p>` : ''}
    ${misses.map((m) => `<p class="note">${esc(m)}</p>`).join('')}
    <div class="photo-wrap">
      <svg id="corner-svg" viewBox="0 0 ${p.w} ${p.h}" data-w="${p.w}" data-h="${p.h}" class="photo-svg${err ? ' has-error' : ''}" role="group" aria-label="Wall photo with four corner handles">
        <image href="${p.src}" x="0" y="0" width="${p.w}" height="${p.h}"/>
        <polygon points="${c.map((x) => x.join(',')).join(' ')}" class="quad"/>
        ${c.map(([x, y], i) => `<g class="handle" data-corner="${i}" tabindex="0" role="button" aria-label="${names[i]} corner. Drag it, or use the arrow keys.">
          <circle cx="${x}" cy="${y}" r="${r * 2.2}" class="handle-hit"/><circle cx="${x}" cy="${y}" r="${r}" class="handle-dot"/></g>`).join('')}
      </svg>
    </div>
    <p class="${err ? 'error' : 'muted small'}" id="corner-msg">${esc(err || S.ui.cornerErr || 'Tip: arrow keys nudge a selected corner.')}</p>
    <div class="acts">
      <button class="btn" type="button" data-act="corners-ok"${err || S.busy ? ' disabled' : ''}>${S.busy === 'read' ? 'Reading your wall…' : 'Looks right'}</button>
      <a class="btn-quiet" href="#/start">Use another photo</a>
    </div>
  </main>${footer()}`;
}

// ---------- One measurement ----------

function sizeScreen() {
  const p = S.draft && S.draft.photo;
  if (!p) { go('#/start'); return ''; }
  const m = p.measure;
  const { aspect } = aspectFromCorners(p.corners, p.w, p.h);
  // Without the ceiling in the photo, a height from the floor to the ceiling says nothing about the width.
  const widthOnly = p.seen && p.seen.ceiling === false;
  if (widthOnly) m.which = 'width';
  const known = m.value;
  const other = known && !widthOnly ? (m.which === 'width' ? known / aspect : known * aspect) : null;
  const otherVal = m.override || (other ? Math.round(other) : null);
  const W = m.which === 'width' ? known : otherVal, H = widthOnly ? null : m.which === 'width' ? otherVal : known;
  const ft = (v) => (v ? Math.floor(v / 12) : ''), inch = (v) => (v ? Math.round(v % 12) : '');
  let warn = S.ui.sizeErr;
  if (!warn && W && H && (H > 240 || W > 600 || H < 60 || W < 24)) warn = `That makes the wall ${feet(W)} wide and ${feet(H)} tall. Check the number.`;
  return `${header()}${steps('wall')}
  <main class="flow">
    <h1>Give us one real measurement</h1>
    <p class="lede">${widthOnly ? "There's no TV in the photo clear enough to size the wall from. Measure the wall's width; you'll set the ceiling height next." : "There's no TV in the photo clear enough to size the wall from. Measure the wall's width, or its height from the floor to the ceiling, and we work out the other one."}</p>
    <form id="measure-form" class="size-form">
      ${widthOnly ? '' : `<div class="seg" role="group" aria-label="What you measured">
        <button type="button" data-which="width" aria-pressed="${m.which === 'width'}">Width</button>
        <button type="button" data-which="height" aria-pressed="${m.which === 'height'}">Height</button>
      </div>`}
      <fieldset><legend>${m.which === 'width' ? 'Wall width' : 'Wall height'}</legend>
        <label><input type="number" inputmode="numeric" min="1" max="50" name="ft" value="${ft(known)}" required> ft</label>
        <label><input type="number" inputmode="numeric" min="0" max="11" name="in" value="${inch(known)}"> in</label>
      </fieldset>
      ${other ? `<fieldset><legend>${m.which === 'width' ? 'Height' : 'Width'}, from the photo. Change it if you know it.</legend>
        <label><input type="number" inputmode="numeric" min="1" max="50" name="oft" value="${ft(otherVal)}"> ft</label>
        <label><input type="number" inputmode="numeric" min="0" max="11" name="oin" value="${inch(otherVal)}"> in</label>
      </fieldset>` : ''}
      ${warn ? `<p class="error">${esc(warn)}</p>` : ''}
      ${W && H && !warn ? `<p class="size-read">${esc(feet(W))} wide, ${esc(feet(H))} tall</p>` : ''}
      <div class="acts">
        <button class="btn" type="submit" name="go" value="${other || widthOnly ? 'next' : 'calc'}">${other || widthOnly ? 'Show me my wall' : 'Work it out'}</button>
        <a class="btn-quiet" href="#/corners">Back to the corners</a>
      </div>
    </form>
  </main>${footer()}`;
}

// ---------- What's in the way ----------

const DEFAULTS = {
  couch: (W) => ({ w: Math.min(84, W - 12), h: 32, x: (W - Math.min(84, W - 12)) / 2, y: 0 }),
  lamp: (W) => ({ w: 16, h: 62, x: Math.max(0, W - 22), y: 0 }),
  plant: () => ({ w: 20, h: 44, x: 4, y: 0 }),
  headboard: (W) => ({ w: Math.min(62, W - 12), h: 40, x: (W - Math.min(62, W - 12)) / 2, y: 0 }),
  dresser: (W) => ({ w: 36, h: 34, x: W - 42, y: 0 }),
  console: (W) => ({ w: Math.min(60, W - 12), h: 30, x: (W - Math.min(60, W - 12)) / 2, y: 0 }),
  window: (W) => ({ w: 36, h: 54, x: Math.max(4, W * 0.72 - 18), y: 30 }),
  door: (W) => ({ w: 32, h: 80, x: W - 36, y: 0 }),
  tv: (W) => ({ w: 50, h: 29, x: (W - 50) / 2, y: 40 }),
  outlet: () => ({ w: 3, h: 5, x: 10, y: 12 }),
  switch: (W) => ({ w: 3, h: 5, x: W - 10, y: 46 }),
};
function clampOb(o) {
  const W = S.draft.width, H = S.draft.height;
  o.w = Math.max(2, Math.min(W, o.w)); o.h = Math.max(2, Math.min(H, o.h));
  o.x = Math.max(0, Math.min(W - o.w, o.x)); o.y = Math.max(0, Math.min(H - o.h, o.y));
  for (const k of ['x', 'y', 'w', 'h']) o[k] = Math.round(o[k] * 4) / 4;
  return o;
}

const editPx = () => Math.min((window.innerWidth || 700) - 50, 760);
function obstacleLayer(showHandles = true) {
  const H = S.draft.height;
  const s = labelSize(S.draft.width, editPx());
  return S.draft.obstacles.map((o) => `
    <g class="ob" data-ob="${esc(o.id)}">
      <rect x="${o.x}" y="${H - o.y - o.h}" width="${o.w}" height="${o.h}" class="ob-box"/>
      ${o.w >= 10 ? `<text x="${o.x + o.w / 2}" y="${H - o.y - o.h / 2}" font-size="${s * 0.9}" class="ob-label">${esc(obName(o))}</text>` : ''}
      ${showHandles && o.w >= 6 ? `<circle cx="${o.x + o.w}" cy="${H - o.y - o.h}" r="${s * 0.55}" class="ob-resize" data-resize="${esc(o.id)}"/>` : ''}
    </g>`).join('');
}

function things() {
  if (need()) { go(need()); return ''; }
  const d = S.draft;
  const photo = d.photo && d.photo.flat;
  const kinds = ['couch', 'headboard', 'dresser', 'console', 'tv', 'lamp', 'plant', 'window', 'door', 'outlet', 'switch'];
  const num = (o, k, label) => `<label class="num"><span>${label}</span><span class="num-in"><input type="number" step="0.5" min="0" data-obk="${k}" data-obid="${esc(o.id)}" value="${o[k]}"> in</span></label>`;
  return `${header()}${steps('things')}
  <main class="flow">
    <h1>What's in the way?</h1>
    <p class="lede">Mark anything the art should clear: the furniture below it, windows, doors, a TV, outlets and switches. Drag a box to move it; drag its corner dot to size it.</p>
    <div class="add-row" role="group" aria-label="Add">${kinds.map((k) => `<button type="button" class="chip" data-add="${k}">${KIND_NAME[k]}</button>`).join('')}</div>
    <div class="wall-edit${photo ? ' has-photo' : ''}" id="edit-wall">
      ${wallSvg({ wall: { width: d.width, height: d.height }, photo, obstacles: [], extra: obstacleLayer(), pxWide: editPx(), label: d.name })}
    </div>
    ${d.obstacles.length ? `<ul class="ob-list">${d.obstacles.map((o) => `<li>
        <span class="ob-name">${esc(obName(o))}</span>
        <span class="ob-nums">${num(o, 'w', 'Wide')}${num(o, 'h', 'Tall')}${num(o, 'x', 'From left')}${num(o, 'y', 'From floor')}</span>
        ${['couch', 'headboard'].includes(o.kind) ? `<span class="muted small">Tall means the floor to the top of the ${o.kind === 'couch' ? 'back' : 'headboard'}.</span>` : ''}
        <button type="button" class="linklike" data-remove-ob="${esc(o.id)}">Remove</button>
      </li>`).join('')}</ul>` : '<p class="muted">Nothing marked yet. If the wall is bare, skip this.</p>'}
    ${flashHtml()}
    <div class="acts">
      <a class="btn" href="${d.photo ? '#/check' : '#/pieces'}">${d.photo ? 'Done' : d.obstacles.length ? 'Next' : "Nothing's in the way"}</a>
      ${d.photo ? '' : '<a class="btn-quiet" href="#/start">Back</a>'}
    </div>
  </main>${footer()}`;
}

// ---------- Your art ----------

function pieces() {
  if (need()) { go(need()); return ''; }
  const d = S.draft;
  const photo = d.photo && d.photo.flat;
  const H = d.height;
  const s = labelSize(d.width, editPx());
  const marks = d.owned.filter((o) => o.rect && o.at).map((o) => `<g class="owned-mark"><rect x="${o.at.x}" y="${H - o.at.y - o.h}" width="${o.w}" height="${o.h}" class="owned-box-mark"/><text x="${o.at.x + o.w / 2}" y="${H - o.at.y - o.h - s * 0.4}" font-size="${s * 0.85}" class="ob-label">${esc(o.title)}</text></g>`).join('');
  const opts = [['must', 'Must keep'], ['happy', 'Happy to move'], ['dontcare', "Don't care"]];
  const odd = (o) => o.w / o.h > 4 || o.h / o.w > 4 || o.w * o.h < 16;
  return `${header()}${steps('pieces')}
  <main class="flow">
    <h1>Any art on this wall already?</h1>
    <p class="lede">${photo ? 'Drag a box around each piece in the photo. We read its size from the wall and its colors from the picture.' : 'Add each piece you have for this wall, with its size in the frame.'} Then say how much you want to keep it.</p>
    ${photo ? `<div class="wall-edit has-photo draw-mode" id="draw-wall">${wallSvg({ wall: { width: d.width, height: d.height }, photo, obstacles: [], extra: `${marks}<rect id="draw-rect" class="draw-rect" x="0" y="0" width="0" height="0"/>`, pxWide: editPx(), label: 'Your wall photo' })}</div>` : ''}
    <div class="acts"><button type="button" class="btn-quiet" data-act="add-piece">${photo ? 'Add one by size instead' : 'Add a piece'}</button></div>
    ${d.owned.length ? `<ul class="owned-edit">${d.owned.map((o) => `<li>
      <div class="owned-top">
        <span class="owned-thumb">${o.thumb ? `<img src="${o.thumb}" alt="">` : `<span class="swatch" style="background:${esc(o.color || '#8A8F94')}"></span>`}</span>
        <div class="owned-fields">
          <label class="name"><span class="small muted">What is it?</span><input type="text" maxlength="40" data-ok="title" data-oid="${esc(o.id)}" value="${esc(o.title)}"></label>
          <span class="ob-nums"><label class="num"><span>Wide</span><span class="num-in"><input type="number" step="0.5" min="2" data-ok="w" data-oid="${esc(o.id)}" value="${o.w}"> in</span></label><label class="num"><span>Tall</span><span class="num-in"><input type="number" step="0.5" min="2" data-ok="h" data-oid="${esc(o.id)}" value="${o.h}"> in</span></label>
          ${o.thumb ? '' : `<label class="num"><span>Main color</span><input type="color" data-ok="color" data-oid="${esc(o.id)}" value="${esc(o.color || '#8A8F94')}"></label>`}</span>
        </div>
      </div>
      ${odd(o) ? `<p class="error">This reads as ${o.w} x ${o.h} in. Check it.</p>` : ''}
      <span class="seg seg-full" role="group" aria-label="Keep setting for your ${esc(o.title)}">${opts.map(([v, label]) => `<button type="button" data-keep="${v}" data-oid="${esc(o.id)}" aria-pressed="${o.keep === v}">${label}</button>`).join('')}</span>
      <div class="owned-foot">
        ${o.at ? `<label class="toggle"><input type="checkbox" data-pin="${esc(o.id)}"${o.pinned ? ' checked' : ''}> Pin where it hangs now</label>` : '<span></span>'}
        <button type="button" class="linklike" data-remove-owned="${esc(o.id)}">Remove</button>
      </div>
    </li>`).join('')}</ul>` : ''}
    ${flashHtml()}
    <div class="acts">
      <a class="btn" href="${d.photo ? '#/check' : '#/layouts'}">${d.photo ? 'Done' : d.owned.length ? 'Show me my wall' : 'Nothing yet, show me my wall'}</a>
      ${d.photo ? '' : '<a class="btn-quiet" href="#/things">Back</a>'}
    </div>
  </main>${footer()}`;
}

async function addPieceFromRect(r) {
  const d = S.draft, p = d.photo;
  await ensurePixels();
  const ppi = p.ppi;
  const px = { x: r.x * ppi, y: (d.height - r.y - r.h) * ppi, w: r.w * ppi, h: r.h * ppi };
  const img = crop(S.mem.flat, px);
  const pal = palette(img, 5);
  // A small thumbnail, same shape as the piece.
  const sc = Math.min(1, 240 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * sc)); cv.height = Math.max(1, Math.round(img.height * sc));
  const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height;
  tmp.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  cv.getContext('2d').drawImage(tmp, 0, 0, cv.width, cv.height);
  const n = d.owned.length + 1;
  const round = (v) => Math.round(v * 2) / 2;
  d.owned.push({
    id: `own${Date.now().toString(36)}`, title: n === 1 ? 'print' : `print ${n}`,
    w: round(r.w), h: round(r.h), keep: 'happy', pinned: false, at: { x: round(r.x), y: round(r.y) }, rect: px,
    palette: pal, thumb: cv.toDataURL('image/jpeg', 0.8), color: pal[0] ? pal[0].hex : null, fromPhoto: true,
  });
  S.mem.clean = null;
  resetLayouts();
  persist();
  render();
}

// ---------- Taste ----------

function taste() {
  if (need()) { go(need()); return ''; }
  if (!S.quiz) S.quiz = restoreQuiz();
  if (!S.quiz) {
    const shownIds = new Set();
    S.quiz = { picks: [], shown: shownIds, n: 0, pair: nextPair(CATALOG, [], shownIds) };
  }
  const q = S.quiz;
  const [a, b] = q.pair;
  const card = (it) => `<button type="button" class="quiz-card" data-pick="${esc(it.id)}"><img src="${it.imageData}" alt="${esc(it.title)}"><span>${esc(it.title)}</span></button>`;
  return `${header()}${steps('taste')}
  <main class="flow quiz-page">
    <div class="quiz-head"><h1>Which one would you rather have on your wall?</h1><span class="muted">${q.n + 1} of ${QUIZ_LENGTH}</span></div>
    <div class="quiz-bar" aria-hidden="true"><span style="width:${(q.n / QUIZ_LENGTH) * 100}%"></span></div>
    <div class="quiz-pair">${card(a)}${card(b)}</div>
    <div class="quiz-foot">
      <button type="button" class="linklike" data-act="quiz-skip">Neither, show me another pair</button>
      ${q.n >= 3 ? '<button type="button" class="linklike" data-act="quiz-done">That\'s enough, see my wall</button>' : '<button type="button" class="linklike" data-act="quiz-none">Skip the taste test</button>'}
    </div>
  </main>${footer()}`;
}
function saveQuiz() {
  const q = S.quiz;
  if (!q || !S.draft) return;
  S.draft.quizState = { picks: q.picks.map((x) => [x.winner.id, x.loser.id]), shown: [...q.shown], n: q.n, pair: q.pair.map((x) => x.id) };
  persist();
}
function restoreQuiz() {
  const s = S.draft && S.draft.quizState;
  if (!s) return null;
  const picks = s.picks.map(([w, l]) => ({ winner: byId.get(w), loser: byId.get(l) })).filter((x) => x.winner && x.loser);
  const pair = s.pair.map((id) => byId.get(id));
  if (pair.some((x) => !x)) return null;
  return { picks, shown: new Set(s.shown), n: s.n, pair };
}
function finishQuiz() {
  const q = S.quiz;
  if (q && q.picks.length) S.draft.taste = { source: 'yours', weights: fitTaste(q.picks) };
  else if (S.draft.taste.source === 'none') S.draft.taste = { source: 'none', weights: null };
  S.quiz = null;
  S.draft.quizState = null;
  resetLayouts();
  persist();
  go('#/layouts');
}
function advanceQuiz(picked) {
  const q = S.quiz;
  q.pair.forEach((it) => q.shown.add(it.id));
  if (picked) q.n++;
  const next = q.n < QUIZ_LENGTH && q.shown.size < 40 ? nextPair(CATALOG, q.picks, q.shown) : null;
  if (!next) { finishQuiz(); return; }
  q.pair = next;
  saveQuiz();
  render();
}

// ---------- Layouts ----------

const SWATCH = { red: '#C0392B', pink: '#E9A3B6', orange: '#E07B22', yellow: '#E6C33A', brown: '#8B5A2B', green: '#3F7F4A', teal: '#1B7F86', blue: '#2F55B5', purple: '#7A4A9E', black: '#1A1A1A', gray: '#9A9A9A', white: '#F6F6F3' };
const SCHEME = { neutral: 'Neutral', monochromatic: 'Monochromatic', analogous: 'Analogous', complementary: 'Complementary', 'split complementary': 'Split complementary', triadic: 'Triadic', mixed: 'Mixed' };
const pct = (v) => `${Math.round(v * 100)}%`;
function colorBar(shares, cls = '') {
  const parts = Object.entries(shares || {}).filter(([, v]) => v >= 0.01);
  const total = parts.reduce((a, [, v]) => a + v, 0) || 1;
  return `<span class="cbar ${cls}" role="img" aria-label="${esc(parts.map(([k, v]) => `${pct(v / total)} ${k}`).join(', '))}">${parts.map(([k, v]) => `<span style="flex-grow:${(v / total).toFixed(4)};background:${SWATCH[k] || '#999'}" class="cseg${k === 'white' ? ' is-white' : ''}"></span>`).join('')}</span>`;
}
function familyName(L) {
  if (L.family === 'statement' && L.variant === 'solo') return 'One big piece';
  if (L.family === 'statement') return L.variant === 'stack' ? 'Center, stacked sides' : 'Center and sides';
  if (L.family === 'grid') return `${L.meta.rows} by ${L.meta.cols} grid`;
  return { salon: 'Two rows', line: 'One row' }[L.family] || L.family;
}
const ownedInfo = (id) => { const o = S.draft.owned.find((x) => x.id === id); return o ? { thumb: o.thumb, color: o.color } : null; };

function drawLayout(L, pxWide) {
  const d = S.draft;
  return wallSvg({
    wall: { width: d.width, height: d.height }, obstacles: d.obstacles, photo: d.photo && d.photo.flat ? cleanWall() : null,
    layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: ownedInfo, selected: S.selected, measure: S.measure, pxWide, label: d.name,
    hideObstacles: !!(d.photo && d.photo.flat), extra: photoTopLine(d, labelSize(d.width, pxWide)),
  });
}

function whyPanel(L) {
  const c = L.color;
  const legend = Object.entries(c.shares).filter(([, v]) => v >= 0.03).slice(0, 6)
    .map(([k, v]) => `<li><span class="dot${k === 'white' ? ' is-white' : ''}" style="background:${SWATCH[k] || '#999'}"></span>${esc(k)} <span class="muted">${pct(v)}</span></li>`).join('');
  const notes = L.notes.map((n) => `<li${n.startsWith('Worth knowing') ? ' class="caveat"' : ''}>${esc(n)}</li>`).join('');
  return `<div class="why-head"><h2>Why it works</h2><span class="scheme">${esc(SCHEME[c.scheme] || c.scheme)}${c.colors && c.colors.length ? `: ${esc(c.colors.join(', '))}` : ''}</span></div>
    ${colorBar(c.shares, 'cbar-wall')}<ul class="legend">${legend}</ul><ul class="notes">${notes}</ul>`;
}

// One small card per piece. It pops up over the drawing when you point at
// or tap a piece, so the screen itself stays short.
function peekCard(p) {
  const item = byId.get(p.ref.id);
  const own = S.draft.owned.find((o) => o.id === p.ref.id);
  const kept = keepList().some((k) => k.id === p.ref.id);
  const pinned = p.ref.id === S.selected;
  const thumb = item
    ? `<img src="${item.imageData}" alt="" width="${Math.round(56 * Math.min(1, item.aspect))}" height="${Math.round(56 / Math.max(1, item.aspect))}">`
    : own && own.thumb ? `<img src="${own.thumb}" alt="" style="max-width:56px;max-height:56px">` : `<span class="swatch" style="background:${esc((own && own.color) || '#999')}"></span>`;
  const reason = S.draft.taste.source === 'yours' ? p.reason.replace('in the quiz', 'in the taste test') : p.reason.replace('close to what you picked in the quiz', 'a good fit for the room').replace('Close to what you picked in the quiz', 'A good fit for the room');
  const nail = p.role === 'pinned' ? 'Stays where it hangs now.' : `Nail ${esc(inches(p.nail.y))} up, ${esc(inches(p.nail.x))} from the left end.`;
  const title = item ? item.title : `Your ${p.title}`;
  return `<div class="peek${pinned ? ' is-pinned' : ''}" data-for="${esc(p.ref.id)}" role="group" aria-label="${esc(title)}"${pinned ? '' : ' hidden'}>
    <div class="peek-head">
      <span class="thumb">${thumb}</span>
      <span class="piece-text"><span class="piece-title">${esc(title)}</span>
      <span class="piece-meta">${p.w} x ${p.h} in${item ? (item.offers && item.offers.length ? `. Art by ${esc(item.artist)}, ${esc(item.source)}${p.price ? `, ${money(p.price, (item.offers[0] || {}).currency || 'USD')}` : ''}` : ` frame. Photo by ${esc(item.artist)} on ${esc(item.source)}`) : ' frame. Already yours'}</span></span>
      <button type="button" class="peek-x" data-act="unpin" aria-label="Close">×</button>
    </div>
    ${colorBar(p.shares, 'cbar-piece')}
    <p class="reason">${esc(reason)}</p>
    ${item && item.record.description ? `<p class="peek-desc muted">${esc(item.record.description)}.</p>` : ''}
    <p class="nail-line">${nail}</p>
    ${item ? `<div class="piece-acts">
      <button type="button" class="chip" data-act="keep" data-id="${esc(p.ref.id)}" aria-pressed="${kept}">${kept ? 'Kept' : 'Keep'}</button>
      <button type="button" class="chip" data-act="swap" data-id="${esc(p.ref.id)}"${kept || S.busy ? ' disabled' : ''}>${S.busy === `swap:${p.ref.id}` ? 'Swapping…' : 'Swap this one'}</button>
    </div>` : ''}
  </div>`;
}

// Some walls don't have room for much. Say so plainly rather than cram it.
function tight(L, d) {
  if (L.parts.fit >= 0.55 && L.pieces.length > 0) return '';
  const owned = d.owned.length;
  return `<p class="note"><strong>Not much open wall here.</strong> This is the best that fits${owned ? `. With ${owned === 1 ? 'a piece' : 'pieces'} already up, swapping the art in ${owned === 1 ? 'that frame' : 'those frames'} may do more than adding more` : ', or leave this wall bare and pick another'}.</p>`;
}

function layoutsScreen() {
  if (need()) { go(need()); return ''; }
  const d = S.draft;
  const result = run();
  const problems = result.problems.filter((p) => p.code !== 'FAMILY_SKIPPED' && p.code !== 'ALL_SHOWN');
  const sample = d.sample ? '<span class="sample-tag">Sample wall</span>' : '';
  if (!result.layouts.length && filterCount()) {
    S.ui.filters = true;
    return `${header()}${steps('layouts')}<main class="flow wide"><h1>${esc(d.name)} ${sample}</h1>
      <p class="note"><strong>Nothing fits with these filters.</strong> Take one off and the layouts come back.</p>
      ${filterPanel()}
      <div class="drawing">${drawLayout(null, 700)}</div></main>${footer()}`;
  }
  if (!result.layouts.length) {
    return `${header()}${steps('layouts')}<main class="flow"><h1>Your wall ${sample}</h1>
      <div class="drawing">${drawLayout(null, 700)}</div>
      <p class="note"><strong>There isn't room for art on this wall.</strong> ${esc(problems[0] ? problems[0].message : '')} Not every wall needs art. ${d.owned.length ? 'You could swap the art in the frames you already have, or try another wall.' : 'Try another wall, or check what you marked.'}</p>
      <div class="acts"><a class="btn" href="#/new">Try another wall</a><a class="btn-quiet" href="${d.photo ? '#/check' : '#/things'}">Check what's marked</a></div></main>${footer()}`;
  }
  if (!result.layouts.some((L) => L.rank === S.rank)) S.rank = 1;
  const L = shown();
  if (S.selected && !L.pieces.some((p) => p.ref.id === S.selected)) S.selected = null;
  const seen = new Map();
  const names = result.layouts.map((x) => { const n = familyName(x); seen.set(n, (seen.get(n) || 0) + 1); return seen.get(n) > 1 ? `${n}, other picks` : n; });
  const keptHere = L.pieces.filter((p) => keepList().some((k) => k.id === p.ref.id)).length;
  const newCount = L.pieces.filter((p) => p.ref.source === 'catalog').length;
  const order = [...L.pieces].sort((a, b) => (b.ref.source === 'owned') - (a.ref.source === 'owned') || b.w * b.h - a.w * a.h);
  const tasteWords = describeTaste(d.taste.weights);
  const tasteLine = d.taste.source === 'yours' ? `Picked for your taste: ${tasteWords.join(', ') || 'no strong leanings yet'}.`
    : d.taste.source === 'sample' ? 'Picked for a sample taste.' : 'Picked to suit the room.';
  return `${header()}${steps('layouts')}
  <main class="flow wide">
    <div class="layout-head"><h1>${esc(d.name)} ${sample}</h1>${d.taste.source === 'yours' ? `<p class="muted">${esc(tasteLine)} <a href="#/taste" data-act="retake">Retake the taste test</a></p>` : ''}</div>
    ${tight(L, d)}
    <div class="main">
      <section class="stage" aria-label="Layouts for this wall">
        <div class="layouts">${result.layouts.map((x, i) => `<button type="button" class="layout-tab" data-rank="${x.rank}" aria-pressed="${x.rank === S.rank}" aria-label="Layout ${x.rank}: ${esc(names[i])}, ${x.pieces.length} piece${x.pieces.length === 1 ? '' : 's'}"><span class="rank" aria-hidden="true">${x.rank}</span><span class="lt-name" aria-hidden="true">${esc(names[i])}</span><span class="lt-count" aria-hidden="true">${x.pieces.length} piece${x.pieces.length === 1 ? '' : 's'}</span></button>`).join('')}</div>
        <div class="drawing-wrap" id="drawing-wrap">
          <div class="drawing" id="drawing">${drawLayout(L, ($('#drawing') && $('#drawing').clientWidth) || Math.min(700, (window.innerWidth || 700) - 50))}</div>
          ${order.map(peekCard).join('')}
        </div>
        <p class="hint muted">${S.selected ? 'Tap the piece again, or the x, to close.' : 'Point at or tap any piece to see why it\'s there, keep it or swap it.'}</p>
        ${flashHtml()}
        <p class="summary">${esc(L.summary)}</p>
        ${newCount ? `<p class="cost-line">${esc(costLine(wallCost(L)))}.</p>` : ''}
        <div class="acts">
          <button type="button" class="btn" data-act="get">${newCount ? 'Get this wall' : 'Hang this wall'}</button>
          <button type="button" class="btn-quiet" data-act="save">${S.ui.saved === d.id && !store.demoMode ? 'Saved on this device' : 'Save this wall'}</button>
        </div>
        <div class="change" aria-label="Change this wall" role="group">
          <div class="controls">
            <div class="acts">
              <button type="button" class="btn-quiet" data-act="refresh"${S.busy ? ' disabled' : ''}>${S.busy === 'refresh' ? 'Picking new art…' : keptHere ? `Refresh all but the ${keptHere} kept` : 'Refresh the art'}</button>
              <button type="button" class="btn-quiet" data-act="another"${S.busy ? ' disabled' : ''}>${S.busy === 'another' ? 'Finding layouts…' : 'Try a new layout'}</button>
            </div>
            <label class="toggle"><input type="checkbox" id="measure"${S.measure ? ' checked' : ''}> Measurements and nails</label>
          </div>
          <div class="lever"><span class="lever-label" id="art-label">Art</span>
            <span class="seg" role="group" aria-labelledby="art-label">${[['prints', 'Prints'], ['both', 'Both'], ['photos', 'Photos']].map(([v, l]) => `<button type="button" data-art="${v}" aria-pressed="${artMode() === v}"${S.busy ? ' disabled' : ''}>${l}</button>`).join('')}</span></div>
          <div class="lever"><span class="lever-label" id="scale-label">Pieces</span>
            <span class="seg" role="group" aria-labelledby="scale-label">${[[-1, 'Fewer, bigger'], [0, 'Balanced'], [1, 'More, smaller']].map(([v, l]) => `<button type="button" data-scale="${v}" aria-pressed="${(d.scale || 0) === v}"${S.busy ? ' disabled' : ''}>${l}</button>`).join('')}</span></div>
          <div class="lever"><button type="button" class="btn-quiet small-btn" data-act="filters" aria-expanded="${!!S.ui.filters}" aria-controls="filters">Filters${filterCount() ? ` (${filterCount()})` : ''}</button>${filterCount() && !S.ui.filters ? ' <button type="button" class="btn-quiet small-btn" data-filter="clear">Clear</button>' : ''}</div>
          ${S.ui.filters ? filterPanel() : ''}
          ${d.taste.source === 'yours' ? '' : `<div class="taste-card"><p><strong>Make it yours.</strong> ${esc(tasteLine)} Ten quick "which one" picks and every layout re-picks its art for you.</p><a class="btn-quiet small-btn" href="#/taste" data-act="retake">Pick what I like</a></div>`}
        </div>
      </section>
      <section class="list" aria-label="Pieces">
        <div class="why">${whyPanel(L)}</div>
        ${L.left.length ? `<div class="left"><h3>Left off this wall</h3><ul>${L.left.map((l) => `<li><strong>Your ${esc(l.title)}.</strong> ${esc(l.reason)}</li>`).join('')}</ul></div>` : ''}
      </section>
    </div>
  </main>${footer()}`;
}

function saveThisWall() {
  const L = shown();
  S.draft.chosen = L ? { layout: L, inputKey: viewKey() } : null;
  const ok = store.saveWall(S.draft) && persist();
  if (ok) { S.ui.saved = S.draft.id; S.flash = store.demoMode ? 'Sample mode: nothing is saved.' : 'Saved on this device. Find it under Your walls.'; }
  else S.flash = "Didn't save. This device's storage may be full. Try again after deleting an old wall.";
}

// ---------- Get it ----------

// The print that sits inside each standard frame with a mat, in inches.
const PRINT_IN = {
  '8x10': [5, 7], '11x14': [8, 10], '12x16': [8, 12], '16x20': [11, 14], '18x24': [12, 18], '24x30': [18, 24], '24x36': [20, 30], '30x40': [24, 36],
  '12x12': [8, 8], '16x16': [12, 12], '20x20': [16, 16], '30x30': [24, 24],
};
function printSize(w, h) {
  const k = w <= h ? `${w}x${h}` : `${h}x${w}`;
  const p = PRINT_IN[k];
  if (!p) return null;
  return w <= h ? p : [p[1], p[0]];
}
// "an 11 x 14", "an 8 x 10", "a 16 x 20"
const aOrAn = (n) => (/^(8|11|18|8\d)(\D|$)/.test(String(n)) ? 'an' : 'a');
const money = (n, cur = 'USD') => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); } catch { return `${n} ${cur}`; } };
// The shop's offer at this frame size: the plain print first, framed as the other choice.
function offersAt(item, w, h) {
  const at = (item.offers || []).filter((o) => o.w && ((o.w === w && o.h === h) || (o.w === h && o.h === w)));
  const plain = at.filter((o) => !o.framed).sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9))[0];
  const framed = at.filter((o) => o.framed).sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9))[0];
  const any = (item.offers || [])[0];
  return { main: plain || framed || any || null, framed: plain ? framed : null };
}
// What the new pieces on a layout cost: the shop price at each piece's size.
function wallCost(L) {
  const out = { total: 0, priced: 0, free: 0, framed: 0, unpriced: 0, shops: new Set(), cur: 'USD' };
  for (const p of L.pieces.filter((x) => x.ref.source === 'catalog')) {
    const item = byId.get(p.ref.id);
    if (!item) continue;
    if (!(item.offers && item.offers.length)) { out.free++; continue; }
    const o = offersAt(item, p.w, p.h).main;
    if (!o || o.price == null) { out.unpriced++; continue; }
    out.total += o.price; out.priced++; out.shops.add(item.source); out.cur = o.currency || 'USD';
    if (o.framed) out.framed++;
  }
  out.total = Math.round(out.total * 100) / 100;
  return out;
}
function costLine(c, long) {
  const bits = [];
  if (c.priced) bits.push(`${long ? 'Prints: ' : ''}${money(c.total, c.cur)} for ${c.priced} print${c.priced === 1 ? '' : 's'}${c.framed === c.priced ? ', framed' : c.framed ? `, ${c.framed} of them framed` : ''}`);
  if (c.free) bits.push(`${c.free} free photo${c.free === 1 ? '' : 's'} to print yourself`);
  if (c.unpriced) bits.push(`${c.unpriced} without a listed price`);
  return bits.join('. ');
}
const frameLink = (w, h) => `https://www.amazon.com/s?k=${encodeURIComponent(`${Math.min(w, h)}x${Math.max(w, h)} picture frame with mat`)}`;

function getScreen() {
  if (need()) { go(need()); return ''; }
  const d = S.draft;
  const L = shown();
  if (!L) { go('#/layouts'); return ''; }
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
  const mine = L.pieces.filter((p) => p.ref.source === 'owned');
  const frames = new Map();
  for (const p of fresh) { const k = `${p.w} x ${p.h}`; frames.set(k, (frames.get(k) || 0) + 1); }
  const hangOrder = [...L.pieces].filter((p) => p.role !== 'pinned').sort((a, b) => b.w * b.h - a.w * a.h);
  const nameOf = (p) => (byId.get(p.ref.id) ? byId.get(p.ref.id).title : `Your ${p.title}`);
  return `${header()}${steps('get')}
  <main class="flow wide">
    <h1>Get it</h1>
    <p class="lede">${fresh.length ? `${fresh.length} new piece${fresh.length === 1 ? '' : 's'} for ${esc(d.name.toLowerCase())}${mine.length ? `, with ${mine.length} of yours` : ''}. Each one links to where you get it, with the frame size to match.` : 'This layout only uses what you own. Nothing to buy.'}</p>
    ${flashHtml()}
    ${fresh.length ? `<ul class="buy-list">${fresh.map((p) => {
      const item = byId.get(p.ref.id);
      const shop = item.offers && item.offers.length ? offersAt(item, p.w, p.h) : null;
      if (shop && shop.main) {
        const o = shop.main;
        return `<li class="buy">
        <img src="${item.imageData}" alt="" class="buy-img">
        <div class="buy-text">
          <p class="piece-title">${esc(item.title)}</p>
          <p class="piece-meta">Art by ${esc(item.artist)}, sold by ${esc(item.source)}</p>
          <p class="buy-size">${o.w ? `${o.w} x ${o.h} in print${o.framed ? ', framed' : `, fits ${aOrAn(o.w)} ${o.w} x ${o.h} in frame`}` : `${p.w} x ${p.h} in frame`}${o.price != null ? `. ${money(o.price, o.currency)}` : ''}</p>
          <div class="acts">
            <a class="btn small-btn" href="${esc(o.url)}" target="_blank" rel="noopener">Buy this print at ${esc(item.source)}</a>
            ${shop.framed ? `<a class="btn-quiet small-btn" href="${esc(shop.framed.url)}" target="_blank" rel="noopener">Framed${shop.framed.price != null ? `, ${money(shop.framed.price, shop.framed.currency)}` : ''}</a>` : ''}
            ${o.framed ? '' : `<a class="btn-quiet small-btn" href="${frameLink(p.w, p.h)}" target="_blank" rel="noopener">Find ${aOrAn(Math.min(p.w, p.h))} ${Math.min(p.w, p.h)} x ${Math.max(p.w, p.h)} in frame</a>`}
          </div>
        </div>
      </li>`;
      }
      const ps = printSize(p.w, p.h);
      return `<li class="buy">
        <img src="${item.imageData}" alt="" class="buy-img">
        <div class="buy-text">
          <p class="piece-title">${esc(item.title)}</p>
          <p class="piece-meta">Photo by ${esc(item.artist)} on ${esc(item.source)}</p>
          <p class="buy-size">${ps ? `Print ${ps[0]} x ${ps[1]} in, in a ${p.w} x ${p.h} in frame with a mat` : `${p.w} x ${p.h} in frame`}</p>
          <div class="acts">
            <a class="btn small-btn" href="${esc(item.url)}" target="_blank" rel="noopener">Get the photo on ${esc(item.source)}</a>
            <a class="btn-quiet small-btn" href="${frameLink(p.w, p.h)}" target="_blank" rel="noopener">Find ${aOrAn(Math.min(p.w, p.h))} ${Math.min(p.w, p.h)} x ${Math.max(p.w, p.h)} in frame</a>
          </div>
          <p class="muted small">Free to download and print for your own wall under the ${esc(item.record.source.license)}. Any print shop can print it at ${ps ? `${ps[0]} x ${ps[1]} in` : 'this size'}.</p>
        </div>
      </li>`;
    }).join('')}</ul>
    <p class="frames-sum"><strong>${esc(costLine(wallCost(L), true))}.</strong>${wallCost(L).priced > wallCost(L).framed ? ' Frames for the unframed prints are extra.' : ''}</p>
    <p class="frames-sum"><strong>Frame sizes:</strong> ${[...frames].map(([k, n]) => `${n} at ${k} in`).join(', ')}.</p>
    ${fresh.some((p) => (byId.get(p.ref.id).offers || []).length) ? `<p class="muted small">Prints from shops link to the shop, which sells and ships them. Prices are the shop's, checked when we added the print, and may have changed. Walldrobe isn't paid for these links.</p>` : ''}` : ''}
    <section class="guide" id="guide" aria-labelledby="guide-h">
      <div class="guide-head"><h2 id="guide-h">Hanging guide</h2><button type="button" class="btn-quiet" data-act="print">Print the hanging guide</button></div>
      <p class="muted">${esc(L.summary)} Nail spots are measured from the left end of the wall and up from the floor.</p>
      <div class="drawing">${wallSvg({ wall: { width: d.width, height: d.height }, obstacles: d.obstacles, layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: ownedInfo, measure: true, pxWide: 900, label: `${d.name}, hanging guide` })}</div>
      <table class="nails"><thead><tr><th scope="col">Piece</th><th scope="col">Frame</th><th scope="col">Nail from left</th><th scope="col">Nail up from floor</th></tr></thead>
        <tbody>${hangOrder.map((p) => `<tr><td>${esc(nameOf(p))}</td><td>${p.w} x ${p.h} in</td><td>${esc(inches(p.nail.x))}</td><td>${esc(inches(p.nail.y))}</td></tr>`).join('')}</tbody></table>
      <ol class="tips">
        <li>Hang the biggest piece first; the others measure off it.</li>
        <li>Nail heights assume the wire sits 2 in below the top of the frame. Pull the wire tight and measure yours, then move the nail by the difference.</li>
        <li>Mark each spot with painter's tape before you drill, and step back to look.</li>
      </ol>
    </section>
    <div class="acts">
      <button type="button" class="btn" data-act="save">${S.ui.saved === d.id ? 'Saved on this device' : 'Save this wall'}</button>
      <a class="btn-quiet" href="#/layouts">Back to the layouts</a>
    </div>
  </main>${footer()}`;
}

// ---------- Your walls ----------

function walls() {
  const all = store.listWalls();
  const date = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };
  return `${header()}
  <main class="flow">
    <h1>Your walls</h1>
    <p class="lede">Saved on this device. Walls and photos stay here and are never uploaded.</p>
    ${flashHtml()}
    ${all.length ? `<ul class="wall-list">${all.map((w) => `<li class="wall-item">
      <div class="wall-mini">${wallSvg({ wall: { width: w.width, height: w.height }, obstacles: w.obstacles, photo: w.photo && (w.photo.clean || w.photo.flat), layout: w.chosen && w.chosen.layout, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: (id) => { const o = w.owned.find((x) => x.id === id); return o ? { thumb: o.thumb, color: o.color } : null; }, hideObstacles: !!(w.photo && w.photo.flat), pxWide: 320, still: true, label: w.name })}</div>
      <div class="wall-meta">
        <label class="name"><span class="sr">Name</span><input type="text" maxlength="40" value="${esc(w.name)}" data-rename="${esc(w.id)}"></label>
        <p class="muted small">${esc(feet(w.width))} x ${esc(feet(w.height))}. Saved ${esc(date(w.savedAt))}.</p>
        ${S.ui.confirmDelete === w.id ? `<p class="error">Delete this wall and its photo? This can't be undone.</p>
          <div class="acts"><button type="button" class="btn danger" data-delete="${esc(w.id)}">Delete</button><button type="button" class="btn-quiet" data-act="cancel-delete">Cancel</button></div>`
        : `<div class="acts"><button type="button" class="btn small-btn" data-open="${esc(w.id)}">Open</button><button type="button" class="btn-quiet small-btn" data-ask-delete="${esc(w.id)}">Delete</button></div>`}
      </div>
    </li>`).join('')}</ul>` : '<p>No walls yet.</p>'}
    <div class="acts"><a class="btn" href="#/new">Start a wall</a></div>
  </main>${footer()}`;
}

// ---------- Render ----------

function focusSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const keys = ['isArt', 'rank', 'obk', 'obid', 'ok', 'oid', 'keep', 'act', 'id', 'which', 'scale', 'art', 'filter', 'v', 'corner', 'add', 'pick', 'open', 'rename'];
  const parts = keys.filter((k) => el.dataset && el.dataset[k] !== undefined).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(el.dataset[k])}"]`);
  return parts.length ? `${el.tagName.toLowerCase()}${parts.join('')}` : null;
}

function render() {
  const [r0, r1] = route();
  if (r0 === 'sample') { loadSample(r1); location.replace('#/layouts'); return; }
  if (r0 === 'new') {
    S.draft = { ...blankDraft(), taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null } };
    S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; S.quiz = null;
    resetLayouts(); location.replace('#/start'); return;
  }
  if (r0 === 'resume') { if (!resumeDraft()) { location.replace('#/start'); return; } location.replace(need() || '#/layouts'); return; }
  const screens = { '': home, start, check, corners, size: sizeScreen, things, pieces, taste, layouts: layoutsScreen, get: getScreen, walls };
  const fn = screens[r0] || home;
  document.title = { '': 'Walldrobe', walls: 'Your walls · Walldrobe', get: 'Get it · Walldrobe', layouts: 'Your wall · Walldrobe' }[r0] || 'Walldrobe';
  // Keep keyboard focus on the same control across a re-render.
  const el = document.activeElement;
  const sel = el && el !== document.body && el.closest('#app') ? focusSelector(el) : null;
  let html;
  try { html = fn(); }
  catch (e) {
    console.error(e);
    S.view = null; S.busy = null;
    html = brokeScreen(r0);
  }
  if (html) app().innerHTML = html;
  if (sel) { const again = document.querySelector(sel); if (again) again.focus({ preventScroll: true }); }
  wire(r0);
}

// Something threw while building a screen. Say so, keep the person's work, offer a way on.
function brokeScreen(r0) {
  const hasWall = !!(S.draft && S.draft.width);
  return `${header()}<main class="flow">
    <h1>Something broke building your wall</h1>
    <p class="lede">${hasWall ? 'Your photo and pieces are saved on this device.' : 'Nothing you made was lost.'} Try again, and if it keeps happening, check what's marked on the wall or start a new one.</p>
    <div class="acts">
      <button type="button" class="btn" data-act="retry">Try again</button>
      ${hasWall ? `<a class="btn-quiet" href="${S.draft.photo ? '#/check' : '#/things'}">Check what's marked</a>` : ''}
      <a class="btn-quiet" href="#/new">Start a new wall</a>
    </div>
  </main>${footer()}`;
}

// ---------- Events ----------

function wire(r) {
  if (r === 'corners') wireCorners();
  if (r === 'things') wireThings();
  if (r === 'pieces' && S.draft && S.draft.photo) wireDraw();
  const pi = $('#photo-input');
  if (pi) pi.addEventListener('change', (e) => onPhoto(e.target.files[0]));
  const m = $('#measure');
  if (m) m.addEventListener('change', (e) => { S.measure = e.target.checked; render(); });
  if (r === 'layouts') wirePeek();
}

// Pointing at a piece shows its card; tapping pins it so the buttons stay put.
function wirePeek() {
  const wrap = $('#drawing-wrap');
  if (!wrap) return;
  const cards = [...wrap.querySelectorAll('.peek')];
  const cardFor = (id) => cards.find((c) => c.dataset.for === id);
  const wide = () => window.matchMedia('(min-width: 640px)').matches;
  let hideT = null;
  const place = (card) => {
    if (!wide()) { card.style.left = ''; card.style.top = ''; return; }
    const g = wrap.querySelector(`.art[data-id="${CSS.escape(card.dataset.for)}"]`);
    if (!g) return;
    // Keep the card inside the drawing so it never covers the buttons below it:
    // under the piece, above it, then beside it, else as close as fits.
    const wr = wrap.getBoundingClientRect(); const pr = g.getBoundingClientRect();
    const cw = card.offsetWidth; const ch = card.offsetHeight;
    const px = { l: pr.left - wr.left, r: pr.right - wr.left, t: pr.top - wr.top, b: pr.bottom - wr.top };
    const cx = px.l + (px.r - px.l) / 2 - cw / 2; const cy = px.t + (px.b - px.t) / 2 - ch / 2;
    const fits = ([x, y]) => x >= 8 && y >= 8 && x + cw <= wr.width - 8 && y + ch <= wr.height - 8;
    const clampX = (x) => Math.max(8, Math.min(wr.width - cw - 8, x));
    const clampY = (y) => Math.max(8, Math.min(wr.height - ch - 8, y));
    const tries = [[clampX(cx), px.b + 8], [clampX(cx), px.t - ch - 8], [px.r + 8, clampY(cy)], [px.l - cw - 8, clampY(cy)]];
    const [left, top] = tries.find(fits) || [clampX(cx), clampY(px.b + 8)];
    card.style.left = `${Math.round(left)}px`; card.style.top = `${Math.round(top)}px`;
  };
  const show = (id) => {
    if (S.selected) return;
    clearTimeout(hideT);
    for (const c of cards) c.hidden = c.dataset.for !== id;
    const c = cardFor(id); if (c) place(c);
  };
  const hideSoon = () => { if (S.selected) return; clearTimeout(hideT); hideT = setTimeout(() => { for (const c of cards) c.hidden = true; }, 220); };
  wrap.querySelectorAll('.art').forEach((g) => {
    g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && wide()) show(g.dataset.id); });
    g.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideSoon(); });
    g.addEventListener('focus', () => { if (wide()) show(g.dataset.id); });
    g.addEventListener('blur', hideSoon);
  });
  cards.forEach((c) => {
    c.addEventListener('pointerenter', () => clearTimeout(hideT));
    c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideSoon(); });
  });
  const pinned = S.selected && cardFor(S.selected);
  if (pinned) place(pinned);
}

function dragOn(svg, onDown, onMove, onUp) {
  svg.addEventListener('pointerdown', (e) => {
    const ctx = onDown(e);
    if (!ctx) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ctx, ev);
    const up = (ev) => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); onUp(ctx, ev); };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  });
}

// New corners mean a new flattened wall: the size step has to run again.
function cornersChanged() {
  const p = S.draft.photo;
  p.flat = null; p.clean = null; p.cleanKey = null;
  S.mem.flat = null; S.mem.clean = null; S.mem.region = null;
  resetLayouts();
  persist();
}

function wireCorners() {
  const svg = $('#corner-svg');
  if (!svg) return;
  const p = S.draft.photo;
  const toImg = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [Math.max(0, Math.min(p.w, q.x)), Math.max(0, Math.min(p.h, q.y))]; };
  const update = () => {
    const c = p.corners;
    svg.querySelector('.quad').setAttribute('points', c.map((x) => x.join(',')).join(' '));
    svg.querySelectorAll('.handle').forEach((g, i) => g.querySelectorAll('circle').forEach((ci) => { ci.setAttribute('cx', c[i][0]); ci.setAttribute('cy', c[i][1]); }));
    const err = cornerProblem(c, p.w, p.h);
    svg.classList.toggle('has-error', !!err);
    const msg = $('#corner-msg'); msg.textContent = err || 'Tip: arrow keys nudge a selected corner.'; msg.className = err ? 'error' : 'muted small';
    const ok = document.querySelector('[data-act="corners-ok"]'); if (ok) ok.disabled = !!err;
  };
  dragOn(svg, (e) => {
    const h = e.target.closest('.handle');
    if (h) return { i: Number(h.dataset.corner) };
    // A tap on the photo moves the nearest corner there.
    const pt = toImg(e);
    let i = 0, bd = Infinity;
    p.corners.forEach((c, j) => { const dd = Math.hypot(c[0] - pt[0], c[1] - pt[1]); if (dd < bd) { bd = dd; i = j; } });
    p.corners[i] = pt; update();
    return { i, tapped: true };
  }, (ctx, e) => { p.corners[ctx.i] = toImg(e); ctx.moved = true; update(); }, (ctx) => { if (ctx.moved || ctx.tapped) cornersChanged(); });
  svg.querySelectorAll('.handle').forEach((g) => g.addEventListener('keydown', (e) => {
    const i = Number(g.dataset.corner), step = e.shiftKey ? 20 : 4;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    p.corners[i] = [Math.max(0, Math.min(p.w, p.corners[i][0] + d[0])), Math.max(0, Math.min(p.h, p.corners[i][1] + d[1]))];
    update(); cornersChanged();
  }));
}

function wireThings() {
  const svg = document.querySelector('#edit-wall svg');
  if (!svg) return;
  const H = S.draft.height;
  const find = (id) => S.draft.obstacles.find((o) => o.id === id);
  const place = (o) => {
    const g = svg.querySelector(`.ob[data-ob="${CSS.escape(o.id)}"]`);
    if (!g) return;
    const r = g.querySelector('rect'); r.setAttribute('x', o.x); r.setAttribute('y', H - o.y - o.h); r.setAttribute('width', o.w); r.setAttribute('height', o.h);
    const t = g.querySelector('text'); if (t) { t.setAttribute('x', o.x + o.w / 2); t.setAttribute('y', H - o.y - o.h / 2); }
    const c = g.querySelector('.ob-resize'); if (c) { c.setAttribute('cx', o.x + o.w); c.setAttribute('cy', H - o.y - o.h); }
  };
  dragOn(svg, (e) => {
    const rz = e.target.closest('[data-resize]');
    const g = e.target.closest('.ob');
    if (!g) return null;
    const o = find(g.dataset.ob);
    if (o && o.autoId) forgetAuto(o.autoId);
    const at = wallPoint(svg, e);
    return { o, mode: rz ? 'size' : 'move', start: at, orig: { ...o } };
  }, (ctx, e) => {
    const at = wallPoint(svg, e);
    const dx = at.x - ctx.start.x, dy = at.y - ctx.start.y;
    if (ctx.mode === 'move') { ctx.o.x = ctx.orig.x + dx; ctx.o.y = ctx.orig.y + dy; }
    else { ctx.o.w = ctx.orig.w + dx; ctx.o.h = ctx.orig.h + dy; }
    clampOb(ctx.o); place(ctx.o);
  }, () => { resetLayouts(); persist(); render(); });
}

function wireDraw() {
  const svg = document.querySelector('#draw-wall svg');
  if (!svg) return;
  const H = S.draft.height;
  const r = svg.querySelector('#draw-rect');
  dragOn(svg, (e) => ({ a: wallPoint(svg, e) }), (ctx, e) => {
    const b = wallPoint(svg, e);
    ctx.b = b;
    const x = Math.min(ctx.a.x, b.x), y = Math.min(ctx.a.y, b.y), w = Math.abs(b.x - ctx.a.x), h = Math.abs(b.y - ctx.a.y);
    r.setAttribute('x', x); r.setAttribute('y', H - y - h); r.setAttribute('width', w); r.setAttribute('height', h);
  }, (ctx) => {
    if (!ctx.b) return;
    const W = S.draft.width;
    const x = Math.max(0, Math.min(ctx.a.x, ctx.b.x)), y = Math.max(0, Math.min(ctx.a.y, ctx.b.y));
    const w = Math.min(W - x, Math.abs(ctx.b.x - ctx.a.x)), h = Math.min(H - y, Math.abs(ctx.b.y - ctx.a.y));
    r.setAttribute('width', 0);
    if (w < 4 || h < 4) { S.flash = 'Drag from one corner of the piece to the opposite corner.'; render(); return; }
    addPieceFromRect({ x, y, w, h });
  });
}

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'dims-form') { changeDims(f).then(() => go('#/layouts')); return; }
  if (f.id === 'size-form') {
    const v = (n) => Number(f.elements[n].value || 0);
    const W = v('wft') * 12 + v('win'), H = v('hft') * 12 + v('hin');
    if (W < 24 || W > 600) { S.ui.sizeErr = 'A wall between 2 ft and 50 ft wide works here. Check the width.'; render(); return; }
    if (H < 60 || H > 240) { S.ui.sizeErr = 'A wall between 5 ft and 20 ft tall works here. Check the height.'; render(); return; }
    const keep = S.draft && !S.draft.sample && !S.draft.photo ? S.draft : { ...blankDraft(), taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null } };
    S.draft = { ...keep, width: W, height: H, photo: null };
    S.draft.obstacles = S.draft.obstacles.map(clampOb);
    S.ui.sizeErr = null;
    resetLayouts(); persist();
    go('#/things');
  }
  if (f.id === 'measure-form') {
    const p = S.draft.photo;
    const v = (n) => (f.elements[n] ? Number(f.elements[n].value || 0) : 0);
    const known = v('ft') * 12 + v('in');
    if (!(known > 12)) { S.ui.sizeErr = 'Give the measurement in feet and inches.'; render(); return; }
    const prevKnown = p.measure.value;
    p.measure.value = known;
    const { aspect } = aspectFromCorners(p.corners, p.w, p.h);
    const est = p.measure.which === 'width' ? known / aspect : known * aspect;
    const typed = f.elements.oft ? v('oft') * 12 + v('oin') : 0;
    // Keep what they typed for the other side, unless they changed the measurement it came from.
    p.measure.override = typed && prevKnown === known && Math.abs(typed - Math.round(est)) > 0.5 ? typed : null;
    S.ui.sizeErr = null;
    const other = p.measure.override || Math.round(est);
    const widthOnly = p.seen && p.seen.ceiling === false;
    const W = p.measure.which === 'width' ? known : other, H = widthOnly ? null : p.measure.which === 'width' ? other : known;
    persist();
    if (e.submitter && e.submitter.value === 'next' && W >= 24 && W <= 600 && (widthOnly || (H >= 60 && H <= 240)) && p.auto && p.auto.rw) {
      S.busy = 'flatten';
      ensurePixels().then(() => {
        setScale(W, H);
        p.auto.guess = { from: 'measure', inches: W };
        applyAuto(); flattenAuto(); resetLayouts(); persist();
        S.busy = null; go('#/check');
      }).catch(() => { S.busy = null; S.ui.sizeErr = "Couldn't flatten the photo. Try again, or use another photo."; render(); });
      return;
    }
    render();
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'tv-size') {
    // A different TV size changes the scale of the whole wall.
    const p = S.draft.photo, a = p.auto;
    a.tvInches = Number(t.value); a.tvWhy = null;
    a.depth = a.tvPx ? tvDepthFactor(a.tvPx, Math.hypot(p.w, p.h), a.tvInches) : 1;
    a.guess = guessWidth(a.items, a.rw, a.tvInches, a.depth);
    if (a.guess) ensurePixels().then(() => { setScale(a.guess.inches); applyAuto(); flattenAuto(); resetLayouts(); persist(); render(); });
    return;
  }
  if (t.form && t.form.id === 'dims-form') { changeDims(t.form); return; }
  if (t.dataset.obk) {
    const o = S.draft.obstacles.find((x) => x.id === t.dataset.obid);
    // Re-render after the browser has moved focus (Tab), so focus lands where it went.
    if (o) { if (o.autoId) forgetAuto(o.autoId); o[t.dataset.obk] = Number(t.value); clampOb(o); resetLayouts(); persist(); setTimeout(render, 0); }
  }
  if (t.dataset.ok) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.oid);
    if (!o) return;
    if (t.dataset.ok === 'title') o.title = t.value.trim().replace(/^(my|your)\s+/i, '') || 'print';
    else if (t.dataset.ok === 'color') { o.color = t.value; o.palette = [{ hex: t.value, weight: 1 }]; }
    else o[t.dataset.ok] = Math.max(2, Number(t.value) || 2);
    resetLayouts(); persist(); setTimeout(render, 0);
  }
  if (t.dataset.pin) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.pin);
    if (o) { o.pinned = t.checked; S.mem.clean = null; resetLayouts(); persist(); render(); }
  }
  if (t.dataset.rename) { store.renameWall(t.dataset.rename, t.value.trim() || 'My wall'); if (S.draft && S.draft.id === t.dataset.rename) { S.draft.name = t.value.trim() || 'My wall'; persist(); } }
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .art, a[data-act]');
  if (!t) return;
  const a = t.dataset.act;
  if (t.dataset.which) { S.draft.photo.measure.which = t.dataset.which; S.draft.photo.measure.value = null; S.draft.photo.measure.override = null; persist(); render(); return; }
  if (t.dataset.add) {
    const W = S.draft.width;
    const o = clampOb({ id: `${t.dataset.add}${Date.now().toString(36)}`, kind: t.dataset.add, ...DEFAULTS[t.dataset.add](W) });
    S.draft.obstacles.push(o); resetLayouts(); persist(); render(); return;
  }
  if (t.dataset.isArt) {
    const a = S.draft.photo && S.draft.photo.auto;
    const it = a && a.items.find((i) => i.id === t.dataset.isArt);
    if (it && S.mem.photo && a.rw) {
      it.kind = 'art'; Object.assign(it, thumbAndPalette(regionImg(), it));
      applyAuto(); flattenAuto(); resetLayouts(); persist(); S.flash = 'Marked as your art. Set whether to keep it.'; render();
    } else { S.flash = 'Open the photo again to change this.'; render(); }
    return;
  }
  if (t.dataset.removeOb) { forgetAuto(t.dataset.removeOb); S.draft.obstacles = S.draft.obstacles.filter((o) => o.id !== t.dataset.removeOb); resetLayouts(); persist(); render(); return; }
  if (t.dataset.removeOwned) { forgetAuto(t.dataset.removeOwned); S.draft.owned = S.draft.owned.filter((o) => o.id !== t.dataset.removeOwned); S.mem.clean = null; resetLayouts(); persist(); render(); return; }
  if (t.dataset.keep && t.dataset.oid) { const o = S.draft.owned.find((x) => x.id === t.dataset.oid); if (o) { o.keep = t.dataset.keep; resetLayouts(); persist(); render(); } return; }
  if (t.dataset.rank) { S.rank = Number(t.dataset.rank); S.selected = null; S.flash = null; render(); return; }
  if (t.dataset.filter) {
    const k = t.dataset.filter, v = t.dataset.v;
    setFilter((f) => {
      if (k === 'clear') Object.assign(f, NO_FILTERS, { skip: [], shops: [] });
      else if (k === 'color' || k === 'people') f[k] = v;
      else if (k === 'price') f.maxPrice = v === '' ? null : Number(v);
      else if (k === 'skip') f.skip = f.skip.includes(v) ? f.skip.filter((x) => x !== v) : [...f.skip, v];
      else if (k === 'shop') f.shops = f.shops.includes(v) ? f.shops.filter((x) => x !== v) : [...f.shops, v];
    });
    act('scale', () => run()); return;
  }
  if (t.dataset.art) { S.draft.art = t.dataset.art; S.rank = 1; S.selected = null; S.flash = null; persist(); act('scale', () => run()); return; }
  if (t.dataset.scale !== undefined) { S.draft.scale = Number(t.dataset.scale); S.rank = 1; S.selected = null; S.flash = null; persist(); act('scale', () => run()); return; }
  if (t.dataset.pick) {
    const q = S.quiz; const [x, y] = q.pair; const winner = x.id === t.dataset.pick ? x : y;
    q.picks.push({ winner, loser: winner === x ? y : x }); advanceQuiz(true); return;
  }
  if (t.dataset.open) {
    const w = store.getWall(t.dataset.open);
    if (w) { S.draft = w; S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; resetLayouts(); persist(); ensurePixels().then(() => { S.mem.clean = null; render(); }); go('#/layouts'); }
    return;
  }
  if (t.dataset.askDelete) { S.ui.confirmDelete = t.dataset.askDelete; render(); return; }
  if (t.dataset.delete) {
    store.deleteWall(t.dataset.delete);
    if (S.draft && S.draft.id === t.dataset.delete) { S.draft = null; store.clearDraft(); }
    S.ui.confirmDelete = null; S.flash = store.demoMode ? 'Sample mode: nothing is deleted.' : 'Deleted, with its photo.'; render(); return;
  }
  if (t.classList.contains('art') || t.classList.contains('piece-hit')) { S.selected = S.selected === t.dataset.id ? null : t.dataset.id; render(); return; }
  switch (a) {
    case 'corners-ok': {
      if (!S.draft.photo || S.busy) break;
      S.busy = 'read'; S.ui.cornerErr = null; render();
      setTimeout(() => readPhoto().then((to) => { S.busy = null; resetLayouts(); persist(); go(to); })
        .catch(() => { S.busy = null; S.ui.cornerErr = "Couldn't read the photo. Try again, or use another photo."; render(); }), 30);
      break;
    }
    case 'add-piece': {
      const n = S.draft.owned.length + 1;
      S.draft.owned.push({ id: `own${Date.now().toString(36)}`, title: n === 1 ? 'print' : `print ${n}`, w: 16, h: 20, keep: 'happy', pinned: false, color: '#8A8F94', palette: [{ hex: '#8A8F94', weight: 1 }], fromPhoto: false });
      resetLayouts(); persist(); render(); break;
    }
    case 'quiz-skip': advanceQuiz(false); break;
    case 'quiz-done': finishQuiz(); break;
    case 'quiz-none': S.quiz = null; S.draft.quizState = null; persist(); go('#/layouts'); break;
    case 'retake': S.quiz = null; S.draft.quizState = null; break;
    case 'retry-save': persist(); if (!S.saveFailed) S.flash = 'Saved.'; render(); break;
    case 'keep': {
      const L = shown();
      const p = L && L.pieces.find((x) => x.ref.id === t.dataset.id);
      const list = keepList();
      S.draft.kept = list.some((k) => k.id === t.dataset.id) ? list.filter((k) => k.id !== t.dataset.id) : p ? [...list, { id: p.ref.id, w: p.w, h: p.h }] : list;
      // What's on screen stays as it is; the other tabs are rebuilt around the new keep.
      if (S.view) S.view.key = viewKey();
      persist(); S.flash = null; act('keep', () => rebuildOthers(L)); break;
    }
    case 'unpin': S.selected = null; render(); break;
    case 'retry': resetLayouts(); render(); break;
    case 'filters': S.ui.filters = !S.ui.filters; render(); break;
    case 'swap': S.flash = null; act(`swap:${t.dataset.id}`, () => refreshShown(t.dataset.id)); break;
    case 'refresh': S.flash = null; act('refresh', () => refreshShown(null)); break;
    case 'another': S.flash = null; act('another', newLayouts); break;
    case 'save': saveThisWall(); render(); break;
    case 'get': S.draft.chosen = { layout: shown(), inputKey: viewKey() }; persist(); go('#/get'); break;
    case 'print': window.print(); break;
    case 'cancel-delete': S.ui.confirmDelete = null; render(); break;
    default: break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.selected && route()[0] === 'layouts') { const id = S.selected; S.selected = null; render(); const g = document.querySelector(`.art[data-id="${CSS.escape(id)}"]`); if (g) g.focus({ preventScroll: true }); return; }
  const t = e.target.closest && e.target.closest('.art');
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); S.selected = S.selected === t.dataset.id ? null : t.dataset.id; render(); }
});

let lastW = 0;
window.addEventListener('resize', () => {
  const d = $('#drawing');
  if (!d) return;
  if (Math.abs(d.clientWidth - lastW) > 40) { lastW = d.clientWidth; if (route()[0] === 'layouts') render(); }
});

// Open where they left off: pixels for a saved photo load in the background.
ensurePixels().then(() => { S.mem.clean = null; if (['layouts', 'get'].includes(route()[0])) render(); }).catch(() => {});
render();
