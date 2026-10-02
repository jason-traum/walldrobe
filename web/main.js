// Walldrobe, the site (v2). One wall at a time: a photo, its corners, one
// screen to confirm what we found, then a ranked list of finished walls on your
// own photo, and the hanging guide for the one you pick.
// Screens are plain functions that return HTML; every change re-renders.
// Design rules: DESIGN.md. Product rules: PRODUCT.md. States: STATES.md.

import { layout, refill, rerank, RULES } from '../engine/index.js';
import { blockedRegions, checkPieces, FURNITURE } from '../engine/geometry.js';
import { fitTaste, scoreTaste, nextPair } from '../engine/taste.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';
import { WALLS as SAMPLES, SAMPLE_PICKS } from '../demo/samples.js';
import { esc, inches, feet, wallSvg, wallPoint, KIND_NAME, obName, labelSize } from './draw.js';
import { aspectFromCorners, cornerProblem, flatten, paintOut, palette, crop, photoQuality, loadFile, toDataUrl, fromDataUrl, homography, apply } from './photo.js';
import { readWall, guessWidth, labToRgb, suggestWall, tvDepthFactor, hiddenFromFor, TV_SIZES } from './detect.js';
import * as store from './store.js';
import { segment, modelCached } from './segment.js';
import { packLabels, unpackLabels } from './segcore.js';

const QUIZ_LENGTH = 10;
const WALLS_ASKED = 24; // walls built once per wall; the list shows the distinct ones
const CATALOG = activeRecords(window.WALLDROBE_CATALOG.items).map((r) => ({ ...toCandidate(r), imageData: r.image.data, aspect: r.image.aspect }));
const byId = new Map(CATALOG.map((c) => [c.id, c]));
const $ = (sel) => document.querySelector(sel);
const app = () => $('#app');
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- State ----------

const S = {
  draft: store.loadDraft(),
  quiz: null,
  view: null, // { key, all, list, rankKey, problems }
  openKey: null, // the wall that's open
  selected: null,
  edit: false, // moving pieces by hand
  sheet: null, // null, 'change', or { piece: id }
  undo: null, // { label, run } the last change, until the next one
  measure: false,
  flash: null,
  busy: null,
  seen: new Map(),
  mem: { photo: null, flat: null, clean: null, cleanKey: null },
  ui: { cornerErr: null, quality: null, sizeErr: null, drawing: null, confirmDelete: null, saved: null, photoErr: null, fix: null },
};

function blankDraft() {
  return {
    id: store.newId(), name: 'My wall', sample: null, width: null, height: null,
    photo: null, obstacles: [], owned: [], room: null,
    taste: { source: 'none', weights: null, picks: [] }, kept: [], saved: [], skipped: [], chosen: null, fullness: 'balanced', justMine: false,
  };
}
// Sample rooms are never written over your own wall in progress.
function persist() {
  if (!S.draft || S.draft.sample) return true;
  const ok = store.saveDraft(S.draft);
  S.saveFailed = !ok;
  return ok;
}
function resetLayouts() { S.view = null; S.openKey = null; S.selected = null; S.edit = false; S.sheet = null; S.undo = null; S.seen = new Map(); S.ui.saved = null; }
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
    owned: w.owned.map((p) => ({ ...clone(p), keep: 'must', color: p.color, fromPhoto: false })),
    room: clone(w.room.palette),
    taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'sample', weights: fitTaste(samplePicks()), picks: [] },
  };
  resetLayouts();
}
// Older saved walls had four keep settings; v2 has keep or skip.
function upgradeDraft(d) {
  if (!d) return d;
  d.saved = d.saved || []; d.skipped = d.skipped || []; d.kept = d.kept || [];
  d.fullness = d.fullness || 'balanced';
  if (d.taste && !d.taste.picks) d.taste.picks = [];
  for (const o of d.owned || []) if (o.keep !== 'skip') { if (o.keep !== 'must') o.pinned = false; o.keep = 'must'; }
  return d;
}
upgradeDraft(S.draft);

// ---------- Router ----------

const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', () => { S.flash = null; S.ui.cornerErr = null; S.ui.sizeErr = null; S.sheet = null; render(); window.scrollTo(0, 0); });

// ---------- Shell ----------

// One bar at the top: where you are on the left, one action on the right.
function bar(left, right = '') {
  return `<header class="bar"><div class="bar-l">${left}</div><div class="bar-r">${right}</div></header>
  ${store.demoMode ? '<p class="demo-note">Sample walls. Nothing is saved.</p>' : ''}
  ${S.saveFailed ? `<div class="note is-error" role="alert"><p>Didn't save on this device. It may be full; deleting an old wall under Your walls frees space. Your wall is still here until you close the page.</p><button type="button" class="btn quiet small" data-act="retry-save">Try again</button></div>` : ''}`;
}
const wordmark = () => '<a class="wordmark" href="#/">Walldrobe</a>';
const back = (href, label) => `<a class="back" href="${href}"><span aria-hidden="true">‹</span> ${esc(label)}</a>`;
function credits() {
  return `<footer class="credits">
    <p>Photos from Unsplash, Pexels and Pixabay, credited on each piece and shown under each site's license. Prints from Desenio and House of Spoils link to the shop's own page; Walldrobe doesn't sell anything and isn't paid for the links. Your wall photos stay on this device.</p>
  </footer>`;
}
const flashHtml = () => (S.flash ? `<p class="flash" role="status">${esc(S.flash)}</p>` : '');

// ---------- Engine ----------

// Keep or skip: a piece you keep is in every wall and may move; pinned, it stays where it hangs.
const keptOwned = () => S.draft.owned.filter((o) => o.keep !== 'skip');
function engineInput() {
  const d = S.draft;
  const owned = keptOwned().map((p) => ({
    id: p.id, title: p.title, w: p.w, h: p.h, keep: p.loosen ? 'happy' : 'must', drop: p.drop,
    pinned: !!(p.pinned && p.at), at: p.at || undefined,
    palette: p.palette && p.palette.length ? p.palette : p.color ? [{ hex: p.color, weight: 1 }] : undefined,
  }));
  const keptIds = new Set(keepList().map((k) => k.id));
  // Prints from shops; your own pieces only, when asked.
  const catalog = d.justMine ? [] : CATALOG.filter((c) => keptIds.has(c.id) || (c.offers && c.offers.length));
  const taste = scoreTaste(d.taste.weights, catalog);
  const room = d.room && d.room.length ? { palette: d.room } : undefined;
  return { wall: { width: d.width, height: d.height }, obstacles: d.obstacles, owned, catalog, taste, room, count: WALLS_ASKED, prefs: { fullness: d.fullness || 'balanced' } };
}
const keepList = () => (S.draft.justMine ? [] : S.draft.kept || []);
const keptSet = () => new Set(keepList().map((k) => k.id));
const viewKey = () => JSON.stringify([S.draft.id, S.draft.width, S.draft.height, S.draft.obstacles, S.draft.owned.map((p) => [p.id, p.title, p.w, p.h, p.keep, p.pinned, p.loosen, p.at, p.color, p.palette]), S.draft.taste.weights, keepList().map((k) => k.id), S.draft.fullness, S.draft.justMine]);
const rankKey = () => JSON.stringify([S.draft.saved, S.draft.skipped]);

// Saves and swaps tell us what you like: a saved piece beats one you swapped away.
function rankTaste() {
  const d = S.draft;
  const pairs = [];
  for (const w of d.saved) for (const l of d.skipped) { const a = byId.get(w), b = byId.get(l); if (a && b) pairs.push({ winner: a, loser: b }); }
  if (!pairs.length) return null;
  const quiz = (d.taste.picks || []).map(([w, l]) => ({ winner: byId.get(w), loser: byId.get(l) })).filter((x) => x.winner && x.loser);
  const ids = new Set(S.view.all.flatMap((L) => L.pieces.filter((p) => p.ref.source === 'catalog').map((p) => p.ref.id)));
  return scoreTaste(fitTaste([...quiz, ...pairs]), CATALOG.filter((c) => ids.has(c.id)));
}

function run() {
  const key = viewKey();
  if (!(S.view && S.view.key === key)) build(key);
  if (S.view.rankKey !== rankKey()) rank();
  return S.view;
}
function build(key) {
  let r = layout({ ...engineInput(), keep: keepList() });
  const problems = [...r.problems];
  // Pieces you keep that leave no room for new art: let them move or be left out, and say so.
  if (!r.layouts.length && keptOwned().length && !S.draft.justMine) {
    const stuck = keptOwned();
    for (const o of stuck) o.loosen = true;
    r = layout({ ...engineInput(), keep: keepList() });
    for (const o of stuck) delete o.loosen;
    if (r.layouts.length) problems.unshift({ code: 'LOOSENED', message: stuck.length === 1 ? `Your ${stuck[0].title} doesn't fit with new art here, so some walls leave it out.` : "Your pieces don't all fit with new art here, so some walls leave one out." });
  }
  let all = r.layouts;
  // A tight wall makes few walls at one fullness: add the ones the other two
  // make, after these, so there's always a real list to choose from.
  if (all.length && rerank(all, { distinct: true }).length < 8) {
    const mine = S.draft.fullness || 'balanced';
    for (const f of ['full', 'calm', 'balanced'].filter((x) => x !== mine)) {
      const more = layout({ ...engineInput(), prefs: { fullness: f }, keep: keepList() }).layouts;
      const have = new Set(all.map((L) => L.key));
      all = all.concat(more.filter((L) => !have.has(L.key)).map((L) => ({ ...L, score: (L.score || 0) - 0.05, other: f })));
    }
  }
  // A saved wall opens on the wall you chose, if it still fits.
  const chosen = S.draft.chosen;
  if (chosen && chosen.inputKey === key) all = [chosen.layout, ...all.filter((L) => L.key !== chosen.layout.key)];
  S.view = { key, all, list: [], rankKey: null, problems: problems.concat(r.problems.filter((p) => !problems.includes(p))) };
  for (const L of all) remember(L);
}
function rank() {
  const v = S.view;
  const before = v.list.map((L) => L.key);
  v.list = rerank(v.all, { taste: rankTaste(), saved: S.draft.saved, skipped: S.draft.skipped, distinct: true });
  // A saved wall leads, the way it was left.
  const chosen = S.draft.chosen && v.all[0] && S.draft.chosen.layout.key === v.all[0].key ? v.list.findIndex((L) => L.key === v.all[0].key) : -1;
  if (chosen > 0) { const [c] = v.list.splice(chosen, 1); v.list.unshift(c); v.list.forEach((L, i) => { L.rank = i + 1; }); }
  v.rankKey = rankKey();
  v.moved = before.length && before.join() !== v.list.map((L) => L.key).join();
}
function remember(L) {
  const seen = S.seen.get(L.key) || new Set();
  for (const p of L.pieces) if (p.ref.source === 'catalog') seen.add(p.ref.id);
  S.seen.set(L.key, seen);
}
// The wall that's open: by key, so a re-rank never swaps it under you.
function shown() {
  const v = run();
  return v.list.find((L) => L.key === S.openKey) || v.list[0] || null;
}
// A wall changed (swapped, moved): it replaces the one it came from.
function replaceWall(key, next) {
  const v = S.view;
  v.all = v.all.map((L) => (L.key === key ? { ...next, key } : L));
  v.rankKey = null;
  S.openKey = key;
}
function swapPiece(id) {
  const L = shown();
  if (!L) return;
  const input = engineInput();
  const exclude = [...(S.seen.get(L.key) || [])].filter((x) => x !== id && !keptSet().has(x));
  let r = refill({ ...input, keep: keepList(), exclude: [...exclude, id] }, L, { swap: id });
  if (!r.layouts.length) r = refill({ ...input, keep: keepList(), exclude: [id] }, L, { swap: id });
  if (!r.layouts.length) { S.flash = r.problems[0] ? r.problems[0].message : 'No other art fits this frame.'; return; }
  const prev = L;
  const next = { ...r.layouts[0], history: L.history, moved: L.moved };
  const gone = byId.get(id), came = next.pieces.find((p) => p.ref.source === 'catalog' && !prev.pieces.some((q) => q.ref.id === p.ref.id));
  const d = S.draft;
  const wasSkipped = d.skipped.includes(id);
  if (!wasSkipped) d.skipped = [...d.skipped, id];
  replaceWall(L.key, next);
  remember(next);
  S.ui.saved = null; persist();
  S.undo = {
    label: `Swapped ${gone ? gone.title : 'that piece'}${came ? ` for ${byId.get(came.ref.id).title}` : ''}.`,
    run: () => { if (!wasSkipped) d.skipped = d.skipped.filter((x) => x !== id); replaceWall(prev.key, prev); persist(); },
  };
}
function toggleSave(id) {
  const d = S.draft;
  const on = d.saved.includes(id);
  d.saved = on ? d.saved.filter((x) => x !== id) : [...d.saved, id];
  // Saving a piece you'd swapped away takes it off the swapped list.
  if (!on) d.skipped = d.skipped.filter((x) => x !== id);
  persist();
}
function toggleKeep(id) {
  const L = shown();
  const p = L && L.pieces.find((x) => x.ref.id === id);
  const list = S.draft.kept || [];
  const on = list.some((k) => k.id === id);
  S.draft.kept = on ? list.filter((k) => k.id !== id) : p ? [...list, { id: p.ref.id, w: p.w, h: p.h }] : list;
  // The wall on screen stays; the others are built again around it.
  if (L) S.draft.chosen = { layout: bareLayout(L), inputKey: viewKey() };
  persist();
}
function act(name, fn) {
  if (S.busy) return;
  const el = document.activeElement;
  const sel = el && el !== document.body && el.closest('#app') ? focusSelector(el) : null;
  S.busy = name; render();
  setTimeout(() => {
    try { fn(); } finally {
      S.busy = null; render();
      const again = sel && document.querySelector(sel);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
  }, 30);
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
    const shop = CATALOG.filter((c) => c.offers && c.offers.length);
    const taste = scoreTaste(fitTaste(samplePicks()), shop);
    const r = layout({ wall: w.wall, obstacles: w.obstacles, owned: [], catalog: shop, taste, room: w.room, count: 6, prefs: { fullness: 'full' } });
    homeLayout = { w, L: rerank(r.layouts).find((L) => L.pieces.length >= 4) || r.layouts[0] };
  }
  const { w, L } = homeLayout;
  const saved = store.listWalls();
  const resume = !!ownDraftSaved();
  return `${bar(wordmark(), saved.length ? '<a class="btn quiet small" href="#/walls">Your walls</a>' : '')}
  <main class="home">
    <div class="drawing hero">${wallSvg({ wall: w.wall, obstacles: w.obstacles, layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, still: true, pxWide: 900, label: 'A sample living room wall, with new pieces taped up where they would hang' })}<span class="chip">Sample wall</span></div>
    <div class="home-copy">
      <h1>A wardrobe for your walls</h1>
      <p class="lede">Take one photo of a wall. Walldrobe lays out new art around what you already own, at real size, and shows you where to put the tape before you drill.</p>
      <div class="acts">
        <a class="btn" href="#/new">${resume ? 'Start a new wall' : 'Start with your wall'}</a>
        ${resume ? '<a class="btn quiet" href="#/resume">Back to your wall</a>' : '<a class="btn quiet" href="#/sample/living">See a sample wall</a>'}
      </div>
      <p class="how">One photo, then check what we found. Pick a wall from the list. Tape it up, step back, hang it.</p>
    </div>
  </main>
  ${credits()}`;
}

// ---------- Start: photo or size ----------

function start() {
  const d = S.draft && !S.draft.sample ? S.draft : null;
  const ft = (v) => (v ? Math.floor(v / 12) : ''), inch = (v) => (v ? Math.round(v % 12) : '');
  return `${bar(back('#/', 'Walldrobe'))}
  <main class="page">
    <h1>Start with a photo of one wall</h1>
    <p class="lede">Stand back and get the whole wall, floor to ceiling if you can. People in the photo aren't needed.</p>
    ${flashHtml()}
    <label class="upload">
      <input type="file" accept="image/*" id="photo-input">
      <span class="btn wide" data-busy-label>${S.busy === 'photo' ? busyPhotoLabel() : 'Take or choose a photo'}</span>
    </label>
    <p class="small pencil">Only you can see it. It stays on this device, and so does the photo reader: the first photo downloads it, about 30 MB, and it runs right here.</p>
    ${S.ui.photoErr ? `<p class="error">${esc(S.ui.photoErr)}</p>` : ''}
    ${d && d.photo ? '<p><a href="#/check">Keep using the photo you added</a></p>' : ''}
    <details class="more"${S.ui.sizeErr ? ' open' : ''}>
      <summary>No photo? Type the size</summary>
      <form id="size-form" class="fields">
        <fieldset><legend>Width</legend>
          <span class="pair"><label><input type="number" inputmode="numeric" min="2" max="40" name="wft" value="${ft(d && d.width)}" required> ft</label>
          <label><input type="number" inputmode="numeric" min="0" max="11" name="win" value="${inch(d && d.width)}"> in</label></span>
        </fieldset>
        <fieldset><legend>Height, floor to ceiling</legend>
          <span class="pair"><label><input type="number" inputmode="numeric" min="5" max="20" name="hft" value="${ft(d && d.height) || 8}" required> ft</label>
          <label><input type="number" inputmode="numeric" min="0" max="11" name="hin" value="${inch(d && d.height) || 0}"> in</label></span>
        </fieldset>
        ${S.ui.sizeErr ? `<p class="error">${esc(S.ui.sizeErr)}</p>` : ''}
        <button class="btn quiet" type="submit">Next</button>
      </form>
    </details>
    <section class="samples">
      <h2>Or try it on a sample wall</h2>
      <ul class="sample-list">${SAMPLES.map((w) => `<li><a href="#/sample/${w.key}"><span class="sample-name">${esc(w.name)}</span><span class="pencil small">${esc(w.note)}</span></a></li>`).join('')}</ul>
    </section>
  </main>`;
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
// "print", "print 2"... the first name nobody on this wall has yet.
function freeTitle(taken) {
  for (let n = 1; ; n++) { const t = n === 1 ? 'print' : `print ${n}`; if (!taken.has(t)) return t; }
}
const RULES_FUZZ = 1.5; // inches added around things read from a photo, for the error in reading them
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
    // Read from the photo, a box can be an inch or two off: art keeps a little more clear of it.
    ...live.filter((i) => i.kind !== 'art').map((i) => clampOb({ id: i.id, autoId: i.id, kind: AUTO_KIND(i.kind), label: AUTO_LABEL(i.kind, p.seen && p.seen.model), fuzz: RULES_FUZZ, ...inch(i) })),
  ];
  const prev = new Map(d.owned.filter((o) => o.autoId).map((o) => [o.autoId, o]));
  const arts = live.filter((i) => i.kind === 'art');
  const mine = d.owned.filter((o) => !o.autoId);
  const taken = new Set(mine.map((o) => o.title));
  d.owned = [
    ...mine,
    ...arts.map((i) => {
      const c = inch(i);
      const o = prev.get(i.id) || { id: i.id, autoId: i.id, title: freeTitle(taken), keep: 'must', pinned: false, thumb: i.thumb, palette: i.palette, color: i.palette && i.palette[0] ? i.palette[0].hex : null, fromPhoto: true };
      taken.add(o.title);
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

// ---------- Confirm what was found ----------

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
  // Checked by hand now: no extra room for reading error.
  for (const o of [...S.draft.obstacles, ...S.draft.owned]) if (o.autoId === id) { delete o.autoId; delete o.fuzz; }
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
  const typedWidth = W !== d.width;
  d.width = W; d.height = H;
  if (a && a.rw) a.shownH = Math.round((W * a.rh) / a.rw);
  // A width typed in is a measurement: nail spots stop being estimates.
  if (a && typedWidth) a.guess = { from: 'measure', inches: W };
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

// With no TV found, the one piece of art most likely to be it (a TV that's on
// reads as a picture): a big, wide one, else the biggest that's at least 30 in wide.
function tvCandidate(d) {
  if (d.obstacles.some((x) => x.kind === 'tv')) return null;
  const art = d.owned.filter((o) => o.autoId && o.w >= 30);
  const wide = art.filter((o) => o.w / o.h > 1.4 && o.w / o.h < 2.3);
  const pool = wide.length ? wide : art.filter((o) => o.w / o.h > 1.1);
  const best = pool.sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return best ? best.id : null;
}

const KEEP_SEG = (o) => `<span class="seg" role="group" aria-label="Your ${esc(o.title)}">
  <button type="button" data-keep="must" data-oid="${esc(o.id)}" aria-pressed="${o.keep !== 'skip'}">Keep</button>
  <button type="button" data-keep="skip" data-oid="${esc(o.id)}" aria-pressed="${o.keep === 'skip'}">Skip</button></span>`;

function check() {
  if (need()) { go(need()); return ''; }
  const d = S.draft, p = d.photo;
  if (!p) { go('#/things'); return ''; }
  const auto = p.mode === 'auto' && p.auto;
  const H = d.height, s = labelSize(d.width, editPx());
  const boxes = [
    ...d.obstacles.map((o) => `<g class="ob"><rect x="${o.x}" y="${H - o.y - o.h}" width="${o.w}" height="${o.h}" class="ob-box"/>${o.w >= 8 ? `<text x="${o.x + o.w / 2}" y="${H - o.y - o.h / 2}" font-size="${s * 0.85}" class="ob-label">${esc(obName(o))}</text>` : ''}</g>`),
    ...d.owned.filter((o) => o.at).map((o) => `<g class="owned-mark${o.keep === 'skip' ? ' is-skip' : ''}"><rect x="${o.at.x}" y="${H - o.at.y - o.h}" width="${o.w}" height="${o.h}" class="owned-box-mark"/></g>`),
  ].join('') + photoTopLine(d, s);
  const ft = (v) => Math.floor(v / 12), inch = (v) => Math.round(v % 12);
  const from = auto && p.auto.guess ? p.auto.guess.from : null;
  const why = { low: ' A 55 in one would put the ceiling under 7 ft.', high: ' A 55 in one would put the ceiling over 11 ft.' }[p.auto && p.auto.tvWhy] || '';
  const guess = NO_TAPE[from] ? `${NO_TAPE[from].why} Measure the wall to be exact.` : from === 'tv' ? `From your TV, taken as a ${p.auto.tvInches} in TV.${why} Measure the wall to be exact.` : from === 'measure' ? 'From your measurement.' : 'Measure the wall to be exact.';
  const tvPick = from === 'tv' ? `<label class="inline">Your TV <select id="tv-size" aria-label="Your TV's size">${TV_SIZES.map(([dg]) => `<option value="${dg}"${dg === p.auto.tvInches ? ' selected' : ''}>${dg} in</option>`).join('')}</select></label>` : '';
  const tvGuess = tvCandidate(d);
  const fix = S.ui.fix;
  const num = (o, k, label, attr) => `<label class="num"><span>${label}</span><span class="num-in"><input type="number" step="0.5" min="0" ${attr}="${k}" data-${attr === 'data-obk' ? 'obid' : 'oid'}="${esc(o.id)}" value="${o[k]}"> in</span></label>`;
  const artRows = d.owned.map((o) => `<li class="row${o.keep === 'skip' ? ' is-skip' : ''}">
      <span class="thumb">${o.thumb ? `<img src="${o.thumb}" alt="">` : `<span class="swatch" style="background:${esc(o.color || '#8A8F94')}"></span>`}</span>
      <span class="row-text"><span class="name">Your ${esc(o.title)}</span><span class="meta">${o.w} x ${o.h} in${o.at ? '' : ", not up yet"}</span>
        ${o.id === tvGuess ? `<button type="button" class="link" data-is-tv="${esc(o.autoId)}">It's the TV</button>` : ''}
        ${fix === o.id ? `<span class="fix">
          <label class="name-in"><span>What is it?</span><input type="text" maxlength="40" data-ok="title" data-oid="${esc(o.id)}" value="${esc(o.title)}"></label>
          <span class="nums">${num(o, 'w', 'Wide', 'data-ok')}${num(o, 'h', 'Tall', 'data-ok')}</span>
          ${o.at ? '' : `<label class="btn quiet small file-btn">${o.thumb ? 'New photo of it' : 'Add a photo of it'}<input type="file" accept="image/*" data-art-photo="${esc(o.id)}"></label>`}
          <span class="fix-acts"><button type="button" class="link" data-remove-owned="${esc(o.id)}">Remove</button><button type="button" class="btn quiet small" data-fix="">Done</button></span>
        </span>` : `<button type="button" class="link" data-fix="${esc(o.id)}" aria-label="Fix your ${esc(o.title)}">Fix</button>`}</span>
      ${KEEP_SEG(o)}
    </li>`).join('');
  const obRows = d.obstacles.map((o) => `<li class="row">
      <span class="thumb"><span class="kind">${esc(obName(o).split(' ')[0])}</span></span>
      <span class="row-text"><span class="name">${esc(obName(o))}</span><span class="meta">${o.w} x ${o.h} in</span>
        ${fix === o.id ? `<span class="fix"><span class="nums">${num(o, 'w', 'Wide', 'data-obk')}${num(o, 'h', 'Tall', 'data-obk')}${num(o, 'x', 'From left', 'data-obk')}${num(o, 'y', 'From floor', 'data-obk')}</span>
          <span class="fix-acts">${o.autoId && o.kind !== 'tv' ? `<button type="button" class="link" data-is-art="${esc(o.autoId)}">It's art</button>` : ''}<button type="button" class="link" data-remove-ob="${esc(o.id)}">Remove</button><button type="button" class="btn quiet small" data-fix="">Done</button></span></span>`
        : `<button type="button" class="link" data-fix="${esc(o.id)}" aria-label="Fix the ${esc(obName(o))}">Fix</button>`}</span>
    </li>`).join('');
  return `${bar(back('#/corners', 'Corners'))}
  <main class="page">
    <h1>Here's your wall</h1>
    <p class="lede">${esc(foundSentence(d))} Fix anything that's off, and say which of your pieces to keep.</p>
    ${S.ui.quality ? `<p class="note">${esc(S.ui.quality)}</p>` : ''}
    <div class="drawing photo-check">${wallSvg({ wall: { width: d.width, height: H }, photo: p.flat, obstacles: [], extra: boxes, pxWide: editPx(), still: true, label: 'Your wall photo, flattened, with what we found marked' })}</div>
    ${auto ? `<form id="dims-form" class="fields dims">
      <fieldset><legend>Wall width</legend>
        <span class="pair"><label><input type="number" inputmode="numeric" min="2" max="50" name="wft" value="${ft(d.width)}"> ft</label><label><input type="number" inputmode="numeric" min="0" max="11" name="win" value="${inch(d.width)}"> in</label></span>
        <span class="help">${esc(guess)}</span>${tvPick}</fieldset>
      <fieldset><legend>${p.seen && p.seen.soffit ? 'Height under the soffit' : 'Ceiling height'}</legend>
        <span class="pair"><label><input type="number" inputmode="numeric" min="6" max="20" name="hft" value="${ft(H)}"> ft</label><label><input type="number" inputmode="numeric" min="0" max="11" name="hin" value="${inch(H)}"> in</label></span>
        <span class="help">${p.auto.shownH && H > p.auto.shownH + 2 ? `Your photo shows the bottom ${esc(feet(p.auto.shownH))}. Check this.` : p.seen && p.seen.ceiling === false ? "The photo doesn't show the ceiling, so check this." : p.seen && p.seen.soffit ? 'From the floor up to the soffit. Art on this wall goes under it.' : `Your photo shows ${esc(feet(p.auto.shownH || H))} of wall.`}</span></fieldset>
    </form>` : `<p class="size-read">${esc(feet(d.width))} wide, ${esc(feet(H))} tall</p>`}
    ${S.ui.sizeErr ? `<p class="error">${esc(S.ui.sizeErr)}</p>` : ''}
    ${flashHtml()}
    <h2>Your art</h2>
    ${d.owned.length ? `<ul class="rows">${artRows}</ul>` : '<p class="pencil">We didn\'t find any art on this wall.</p>'}
    <div class="acts left"><button type="button" class="btn quiet small" data-act="add-not-up">Add art that isn't up yet</button><a class="btn quiet small" href="#/pieces">Mark art we missed</a></div>
    <h2>In the way</h2>
    ${d.obstacles.length ? `<ul class="rows">${obRows}</ul>` : '<p class="pencil">Nothing in the way. A bare wall.</p>'}
    <div class="acts left"><a class="btn quiet small" href="#/things">Mark something we missed</a></div>
    <div class="dock"><a class="btn wide" href="#/layouts">Show me my wall</a></div>
  </main>`;
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
    seen.soffit ? "There's a soffit over this wall, so the top dots are under it. Art goes below it." : null,
    seen.model === false ? "The photo reader didn't load, so these are rougher guesses than usual." : null,
    seen.floorFrom === 'stand' ? 'The floor is hidden behind the furniture, so the bottom dots are a guess from your TV stand.' : seen.floor === false ? "We couldn't see where the wall meets the floor. Drag the bottom dots down to it." : null,
  ].filter(Boolean);
  return `${bar(back('#/start', 'Photo'))}
  <main class="page">
    <h1>Check the corners</h1>
    <p class="lede">Drag any dot that's off: the top ones where the wall meets the ceiling, the bottom ones where it meets the floor. Behind furniture, guess.</p>
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
    <p class="${err ? 'error' : 'small pencil'}" id="corner-msg">${esc(err || S.ui.cornerErr || 'Arrow keys nudge a selected corner.')}</p>
    <div class="acts end">
      <a class="btn quiet" href="#/start">Use another photo</a>
      <button class="btn" type="button" data-act="corners-ok"${err || S.busy ? ' disabled' : ''}>${S.busy === 'read' ? 'Reading your wall…' : 'Looks right'}</button>
    </div>
  </main>`;
}

// ---------- One measurement ----------

// No tape measure: something in the photo with a standard size sets the scale
// instead. Each is a guess, said as one, and the check screen says which.
const NO_TAPE = {
  door: { label: 'Use the door', why: 'Worked out from the door, taken as a standard 6 ft 8 in door.' },
  bed: { label: 'The bed is a queen', why: 'Worked out from the bed, taken as a queen (5 ft 4 in wide with its frame).' },
  couch: { label: 'Use the couch', why: 'Worked out from the couch, taken as about 7 ft wide.' },
  ceiling: { label: 'The ceiling is about 8 ft', why: 'Worked out from a standard 8 ft ceiling.' },
  guess: { label: 'Just guess', why: 'A rough guess of about 10 ft wide.' },
};
function noTapeOptions(p) {
  const a = p.auto;
  if (!a || !a.rw) return [];
  const out = [];
  const biggest = (k, dim) => a.items.filter((i) => i.kind === k && !i.removed).sort((x, y) => y[dim] - x[dim])[0];
  const door = biggest('door', 'h');
  if (door && door.h > a.rh * 0.4) out.push(['door', Math.round((a.rw * 80) / door.h)]);
  const bed = biggest('headboard', 'w');
  if (bed && bed.w > a.rw * 0.15) out.push(['bed', Math.round((a.rw * 64) / bed.w)]);
  const couch = biggest('couch', 'w');
  if (couch && couch.w > a.rw * 0.2) out.push(['couch', Math.round((a.rw * 84) / couch.w)]);
  if (p.seen && p.seen.ceiling !== false && !p.seen.soffit) out.push(['ceiling', Math.round((96 * a.rw) / a.rh)]);
  out.push(['guess', 120]);
  return out.filter(([, W]) => W >= 36 && W <= 480);
}

function sizeScreen() {
  const p = S.draft && S.draft.photo;
  if (!p) { go('#/start'); return ''; }
  const m = p.measure;
  const { aspect } = aspectFromCorners(p.corners, p.w, p.h);
  const widthOnly = p.seen && p.seen.ceiling === false;
  if (widthOnly) m.which = 'width';
  const known = m.value;
  const other = known && !widthOnly ? (m.which === 'width' ? known / aspect : known * aspect) : null;
  const otherVal = m.override || (other ? Math.round(other) : null);
  const W = m.which === 'width' ? known : otherVal, H = widthOnly ? null : m.which === 'width' ? otherVal : known;
  const ft = (v) => (v ? Math.floor(v / 12) : ''), inch = (v) => (v ? Math.round(v % 12) : '');
  let warn = S.ui.sizeErr;
  if (!warn && W && H && (H > 240 || W > 600 || H < 60 || W < 24)) warn = `That makes the wall ${feet(W)} wide and ${feet(H)} tall. Check the number.`;
  const opts = noTapeOptions(p);
  return `${bar(back('#/corners', 'Corners'))}
  <main class="page">
    <h1>One real measurement</h1>
    <p class="lede">${widthOnly ? "There's no TV in the photo clear enough to size the wall from. Measure the wall's width; you'll set the ceiling height next." : "There's no TV in the photo clear enough to size the wall from. Measure its width, or its height from floor to ceiling, and we work out the other."}</p>
    <form id="measure-form" class="fields">
      ${widthOnly ? '' : `<span class="seg" role="group" aria-label="What you measured">
        <button type="button" data-which="width" aria-pressed="${m.which === 'width'}">Width</button>
        <button type="button" data-which="height" aria-pressed="${m.which === 'height'}">Height</button>
      </span>`}
      <fieldset><legend>${m.which === 'width' ? 'Wall width' : 'Wall height'}</legend>
        <span class="pair"><label><input type="number" inputmode="numeric" min="1" max="50" name="ft" value="${ft(known)}" required> ft</label>
        <label><input type="number" inputmode="numeric" min="0" max="11" name="in" value="${inch(known)}"> in</label></span>
      </fieldset>
      ${other ? `<fieldset><legend>${m.which === 'width' ? 'Height' : 'Width'}, from the photo</legend>
        <span class="pair"><label><input type="number" inputmode="numeric" min="1" max="50" name="oft" value="${ft(otherVal)}"> ft</label>
        <label><input type="number" inputmode="numeric" min="0" max="11" name="oin" value="${inch(otherVal)}"> in</label></span>
      </fieldset>` : ''}
      ${warn ? `<p class="error">${esc(warn)}</p>` : ''}
      ${W && H && !warn ? `<p class="size-read">${esc(feet(W))} wide, ${esc(feet(H))} tall</p>` : ''}
      <div class="acts end"><button class="btn" type="submit" name="go" value="${other || widthOnly ? 'next' : 'calc'}">${other || widthOnly ? 'Show me my wall' : 'Work it out'}</button></div>
    </form>
    ${opts.length ? `<section class="samples">
      <h2>No tape measure?</h2>
      <p class="pencil">Pick something standard in the photo. It's a guess, and you can fix it on the next screen.</p>
      <div class="acts left">${opts.map(([k]) => `<button type="button" class="btn quiet small" data-notape="${k}">${esc(NO_TAPE[k].label)}</button>`).join('')}</div>
    </section>` : ''}
  </main>`;
}

// ---------- Marking things by hand ----------

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
  return `${bar(back(d.photo ? '#/check' : '#/start', d.photo ? 'Your wall' : 'Size'))}
  <main class="page">
    <h1>What's in the way?</h1>
    <p class="lede">Mark anything the art should clear. Drag a box to move it, its corner dot to size it.</p>
    <div class="chips" role="group" aria-label="Add">${kinds.map((k) => `<button type="button" class="chip" data-add="${k}">${KIND_NAME[k]}</button>`).join('')}</div>
    <div class="drawing wall-edit" id="edit-wall">
      ${wallSvg({ wall: { width: d.width, height: d.height }, photo, obstacles: [], extra: obstacleLayer(), pxWide: editPx(), label: d.name })}
    </div>
    ${d.obstacles.length ? `<ul class="rows">${d.obstacles.map((o) => `<li class="row">
        <span class="row-text"><span class="name">${esc(obName(o))}</span>
        <span class="nums">${num(o, 'w', 'Wide')}${num(o, 'h', 'Tall')}${num(o, 'x', 'From left')}${num(o, 'y', 'From floor')}</span>
        ${['couch', 'headboard'].includes(o.kind) ? `<span class="help">Tall is the floor to the top of the ${o.kind === 'couch' ? 'back' : 'headboard'}.</span>` : ''}</span>
        <button type="button" class="link" data-remove-ob="${esc(o.id)}">Remove</button>
      </li>`).join('')}</ul>` : '<p class="pencil">Nothing marked yet. If the wall is bare, skip this.</p>'}
    ${flashHtml()}
    <div class="acts end"><a class="btn" href="${d.photo ? '#/check' : '#/pieces'}">${d.photo ? 'Done' : d.obstacles.length ? 'Next' : "Nothing's in the way"}</a></div>
  </main>`;
}

function pieces() {
  if (need()) { go(need()); return ''; }
  const d = S.draft;
  const photo = d.photo && d.photo.flat;
  const H = d.height;
  const marks = d.owned.filter((o) => o.rect && o.at).map((o) => `<g class="owned-mark"><rect x="${o.at.x}" y="${H - o.at.y - o.h}" width="${o.w}" height="${o.h}" class="owned-box-mark"/></g>`).join('');
  return `${bar(back(d.photo ? '#/check' : '#/things', d.photo ? 'Your wall' : 'In the way'))}
  <main class="page">
    <h1>Your art</h1>
    <p class="lede">${photo ? 'Drag a box around each piece hanging in the photo. We read its size from the wall and its colors from the picture.' : "Add each piece you have for this wall, with its size in the frame. Art that isn't up yet counts too."}</p>
    ${photo ? `<div class="drawing wall-edit draw-mode" id="draw-wall">${wallSvg({ wall: { width: d.width, height: d.height }, photo, obstacles: [], extra: `${marks}<rect id="draw-rect" class="draw-rect" x="0" y="0" width="0" height="0"/>`, pxWide: editPx(), label: 'Your wall photo' })}</div>` : ''}
    ${d.owned.length ? `<ul class="rows">${d.owned.map((o) => `<li class="row">
      <span class="thumb">${o.thumb ? `<img src="${o.thumb}" alt="">` : `<span class="swatch" style="background:${esc(o.color || '#8A8F94')}"></span>`}</span>
      <span class="row-text">
        <label class="name-in"><span>What is it?</span><input type="text" maxlength="40" data-ok="title" data-oid="${esc(o.id)}" value="${esc(o.title)}"></label>
        <span class="nums"><label class="num"><span>Wide</span><span class="num-in"><input type="number" step="0.5" min="2" data-ok="w" data-oid="${esc(o.id)}" value="${o.w}"> in</span></label><label class="num"><span>Tall</span><span class="num-in"><input type="number" step="0.5" min="2" data-ok="h" data-oid="${esc(o.id)}" value="${o.h}"> in</span></label>
        ${o.thumb ? '' : `<label class="num"><span>Main color</span><input type="color" data-ok="color" data-oid="${esc(o.id)}" value="${esc(o.color || '#8A8F94')}"></label>`}</span>
        ${o.at ? '' : `<label class="btn quiet small file-btn">${o.thumb ? 'New photo of it' : 'Add a photo of it'}<input type="file" accept="image/*" data-art-photo="${esc(o.id)}"></label>`}
      </span>
      <span class="row-side">${KEEP_SEG(o)}<button type="button" class="link" data-remove-owned="${esc(o.id)}">Remove</button></span>
    </li>`).join('')}</ul>` : ''}
    <div class="acts left"><button type="button" class="btn quiet small" data-act="add-piece">${photo ? "Add art that isn't up yet" : 'Add a piece'}</button></div>
    ${flashHtml()}
    <div class="acts end"><a class="btn" href="${d.photo ? '#/check' : '#/layouts'}">${d.photo ? 'Done' : d.owned.length ? 'Show me my wall' : 'Nothing yet, show me my wall'}</a></div>
  </main>`;
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
    w: round(r.w), h: round(r.h), keep: 'must', pinned: false, at: { x: round(r.x), y: round(r.y) }, rect: px,
    palette: pal, thumb: cv.toDataURL('image/jpeg', 0.8), color: pal[0] ? pal[0].hex : null, fromPhoto: true,
  });
  S.mem.clean = null;
  resetLayouts();
  persist();
  render();
}

// ---------- Make it mine: the taste test ----------

function taste() {
  if (need()) { go(need()); return ''; }
  if (!S.quiz) S.quiz = restoreQuiz();
  if (!S.quiz) {
    const shownIds = new Set();
    S.quiz = { picks: [], shown: shownIds, n: 0, pair: nextPair(CATALOG, [], shownIds) };
  }
  const q = S.quiz;
  const [a, b] = q.pair;
  const card = (it) => `<button type="button" class="pick" data-pick="${esc(it.id)}" aria-label="${esc(it.title)}"><span class="pick-art" style="aspect-ratio:${it.aspect || 0.8}"><img src="${it.imageData}" alt=""></span><span class="pick-name">${esc(it.title)}</span></button>`;
  return `${bar(back('#/layouts', 'Your walls'), `<span class="count">${q.n + 1} of ${QUIZ_LENGTH}</span>`)}
  <main class="page quiz">
    <h1>Which would you rather have on your wall?</h1>
    <div class="pair-picks">${card(a)}${card(b)}</div>
    <div class="acts left">
      <button type="button" class="btn quiet small" data-act="quiz-skip">Neither, show me another two</button>
      ${q.n >= 3 ? '<button type="button" class="btn quiet small" data-act="quiz-done">That\'s enough, show my walls</button>' : ''}
    </div>
  </main>`;
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
  if (q && q.picks.length) S.draft.taste = { source: 'yours', weights: fitTaste(q.picks), picks: q.picks.map((x) => [x.winner.id, x.loser.id]) };
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

// ---------- The walls ----------

const ownedInfo = (id) => { const o = S.draft.owned.find((x) => x.id === id); return o ? { thumb: o.thumb, color: o.color } : null; };
function drawWall(L, pxWide, opts = {}) {
  const d = S.draft;
  return wallSvg({
    wall: { width: d.width, height: d.height }, obstacles: d.obstacles, photo: d.photo && d.photo.flat ? cleanWall() : null,
    layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: ownedInfo, keptIds: keptSet(), selected: opts.selected || null,
    measure: !!opts.measure, pxWide, label: opts.label || d.name, still: !!opts.still,
    hideObstacles: !!(d.photo && d.photo.flat), extra: opts.extra || '',
  });
}
// What the new pieces cost, in one line.
function costShort(L) {
  const c = wallCost(L);
  if (!c.priced && !c.free) return L.pieces.some((p) => p.ref.source === 'catalog') ? '' : 'Nothing to buy';
  const bits = [];
  if (c.priced) bits.push(`${money(c.total, c.cur)} for ${c.priced} new print${c.priced === 1 ? '' : 's'}`);
  if (c.free) bits.push(`${c.free} free photo${c.free === 1 ? '' : 's'}`);
  return bits.join(', ');
}
const whyText = (L) => (L.moved ? `Placed by you: ${L.pieces.length} piece${L.pieces.length === 1 ? '' : 's'}, ${inches(L.group.w)} across.` : (L.why && L.why.text) || L.summary);
const pxNow = () => ($('#drawing') && $('#drawing').clientWidth) || Math.min(760, (window.innerWidth || 390) - 32);

// The ways a wall can't be shown, said plainly, with the way on.
function noWalls(v) {
  const d = S.draft;
  const p = v.problems.find((x) => x.code !== 'FAMILY_SKIPPED' && x.code !== 'ALL_SHOWN' && x.code !== 'LOOSENED');
  return `${bar(wordmark(), '<button type="button" class="btn quiet small" data-act="change">Change</button>')}
  <main class="page">
    <div class="drawing">${drawWall(null, pxNow(), { still: true })}</div>
    <h1 class="why">There isn't room for art on this wall.</h1>
    <p class="lede">${esc(p ? p.message : '')} Not every wall needs art.</p>
    <div class="acts left"><a class="btn" href="${d.photo ? '#/check' : '#/things'}">Check what's marked</a><a class="btn quiet" href="#/new">Try another wall</a></div>
  </main>${sheetHtml()}`;
}

// Building the list takes a moment on a phone: say so, with the bare wall, then build.
function building() {
  if (S.view && S.view.key === viewKey()) return '';
  if (!S.building) {
    S.building = true;
    setTimeout(() => { try { run(); } catch (e) { console.error(e); } S.building = false; render(); }, 40);
  }
  return `${bar(wordmark())}<main class="feed-page" aria-busy="true">
    <div class="drawing is-waiting">${drawWall(null, pxNow(), { still: true })}</div>
    <p class="count">Finding every wall that fits…</p>
  </main>`;
}
function feed() {
  if (need()) { go(need()); return ''; }
  const wait = building();
  if (wait) return wait;
  const v = run();
  if (!v.list.length) return noWalls(v);
  const d = S.draft;
  const px = pxNow();
  const note = v.problems.find((x) => x.code === 'LOOSENED');
  const items = v.list.map((L, i) => `<li class="entry">
    <a class="entry-link" href="#/wall" data-wall="${esc(L.key)}" aria-label="Wall ${i + 1} of ${v.list.length}. ${esc(whyText(L))}">
      <span class="drawing">${drawWall(L, px, { still: true, label: `Wall ${i + 1}` })}${d.sample ? '<span class="chip">Sample wall</span>' : ''}</span>
      <span class="count">${i + 1} of ${v.list.length}${L.pieces.some((p) => d.saved.includes(p.ref.id)) ? ' <span class="has-saved">· has a piece you saved</span>' : ''}</span>
      <span class="why">${esc(whyText(L))}</span>
      <span class="cost">${esc(costShort(L))}</span>
    </a>
  </li>`).join('');
  return `${bar(wordmark(), '<button type="button" class="btn quiet small" data-act="change" aria-haspopup="dialog">Change</button>')}
  <main class="feed-page">
    ${note ? `<p class="note">${esc(note.message)}</p>` : ''}
    ${v.moved ? '<p class="note">Ranked again for what you saved and swapped.</p>' : ''}
    ${flashHtml()}
    <ol class="feed">${items}</ol>
    <p class="feed-end pencil">That's every wall that fits. <button type="button" class="link" data-act="change">Change how full, or use just your pieces</button></p>
  </main>${sheetHtml()}`;
}

// One wall, open: the drawing, why it works, what's in it, and Get this wall.
function wallScreen() {
  if (need()) { go(need()); return ''; }
  const wait = building();
  if (wait) return wait;
  const v = run();
  if (!v.list.length) return noWalls(v);
  const d = S.draft;
  const L = shown();
  S.openKey = L.key;
  const i = v.list.findIndex((x) => x.key === L.key);
  const prev = v.list[i - 1], next = v.list[i + 1];
  if (S.selected && !L.pieces.some((p) => p.ref.id === S.selected)) S.selected = null;
  const order = [...L.pieces].sort((a, b) => (b.ref.source === 'owned') - (a.ref.source === 'owned') || b.w * b.h - a.w * a.h);
  const kept = keptSet();
  const rows = order.map((p) => {
    const own = p.ref.source !== 'catalog';
    const item = own ? null : byId.get(p.ref.id);
    const o = own ? d.owned.find((x) => x.id === p.ref.id) : null;
    const thumb = own
      ? `<span class="thumb" style="aspect-ratio:${p.w}/${p.h}">${o && o.thumb ? `<img src="${o.thumb}" alt="">` : `<span class="swatch" style="background:${esc((o && o.color) || '#8A8F94')}"></span>`}</span>`
      : `<span class="thumb" style="aspect-ratio:${item.aspect || p.w / p.h}"><img src="${item.imageData}" alt=""></span>`;
    const c = item && item.offers && item.offers.length ? offersAt(item, p.w, p.h).main : null;
    const meta = own ? `${p.w} x ${p.h} in. ${p.role === 'pinned' ? 'Yours, stays where it hangs.' : 'Yours.'}` : `${p.w} x ${p.h} in${c && c.price != null ? `, ${money(c.price, c.currency)} at ${esc(item.source)}` : item.offers.length ? `, at ${esc(item.source)}` : `, free photo on ${esc(item.source)}`}${kept.has(p.ref.id) ? '. Kept in every wall.' : ''}`;
    const saved = d.saved.includes(p.ref.id);
    return `<li class="row piece-row">
      <button type="button" class="row-open" data-piece="${esc(p.ref.id)}" aria-haspopup="dialog">${thumb}<span class="row-text"><span class="name">${esc(own ? `Your ${p.title}` : item.title)}</span><span class="meta">${meta}</span><span class="reason">${esc(cleanReason(p.reason))}</span></span></button>
      ${own ? '' : `<button type="button" class="heart" data-save="${esc(p.ref.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Saved' : 'Save'} ${esc(item.title)}">${heart(saved)}</button>`}
    </li>`;
  }).join('');
  const total = wallCost(L);
  return `${bar(back('#/layouts', 'All walls'), '<button type="button" class="btn quiet small" data-act="change" aria-haspopup="dialog">Change</button>')}
  <main class="wall-page">
    <div class="wall-main">
    <div class="drawing-wrap${S.edit ? ' is-editing' : ''}" id="drawing-wrap">
      <div class="drawing" id="drawing">${drawWall(L, pxNow(), { selected: S.selected, measure: S.measure || S.edit, label: `Wall ${i + 1} of ${v.list.length}` })}${d.sample ? '<span class="chip">Sample wall</span>' : ''}</div>
    </div>
    <div class="pager"><button type="button" class="icon-btn" data-goto="${prev ? esc(prev.key) : ''}" aria-label="Wall before"${prev ? '' : ' disabled'}>‹</button><span class="count">Wall ${i + 1} of ${v.list.length}</span><button type="button" class="icon-btn" data-goto="${next ? esc(next.key) : ''}" aria-label="Next wall"${next ? '' : ' disabled'}>›</button></div>
    ${S.edit ? editBar(L) : ''}
    ${S.undo ? `<p class="undo" role="status">${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button></p>` : ''}
    ${flashHtml()}
    ${legend(L)}
    <h1 class="why">${esc(whyText(L))}</h1>
    <p class="cost">${esc(costShort(L))}</p>
    <div class="acts left">
      <button type="button" class="btn" data-act="get">${total.priced || total.free ? 'Get this wall' : 'Hang this wall'}</button>
      <button type="button" class="btn quiet" data-act="save">${S.ui.saved === d.id && !store.demoMode ? 'Saved on this device' : 'Save this wall'}</button>
    </div>
    </div>
    <section class="wall-side" aria-labelledby="in-h">
    <h2 id="in-h">In this wall</h2>
    <ul class="rows">${rows}</ul>
    ${L.left && L.left.length ? `<p class="pencil small">Left off this wall: ${L.left.map((l) => `your ${esc(l.title)}`).join(', ')}. ${esc(L.left[0].reason)}</p>` : ''}
    </section>
  </main>${sheetHtml()}`;
}
const heart = (on) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" class="${on ? 'heart-on' : 'heart-off'}"/></svg>`;
const cleanReason = (r) => String(r || '').replace('close to what you picked in the quiz', 'a good fit for the room').replace('Close to what you picked in the quiz', 'A good fit for the room');
// What the tape colors mean, the first time more than one is on the wall.
function legend(L) {
  const kept = keptSet();
  const kinds = new Set(L.pieces.map((p) => (p.ref.source !== 'catalog' ? (p.role === 'pinned' ? 'pin' : null) : kept.has(p.ref.id) ? 'kept' : 'new')).filter(Boolean));
  if (!kinds.has('kept') && !kinds.has('pin')) return '';
  const words = { new: 'blue is new', kept: 'green is kept in every wall', pin: 'orange stays where it hangs' };
  const keys = { new: 'key-new', kept: 'key-kept', pin: 'key-pin' };
  const parts = ['new', 'kept', 'pin'].filter((k) => kinds.has(k)).map((k) => `<span class="key ${keys[k]}"></span>${words[k]}`);
  return `<p class="legend">Tape: ${parts.join(', ')}.</p>`;
}

// ---------- Sheets ----------

function sheetHtml() {
  if (!S.sheet) return '';
  const body = S.sheet === 'change' ? changeSheet() : S.sheet.piece ? pieceSheet(S.sheet.piece) : '';
  if (!body) return '';
  return `<div class="backdrop" data-act="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h" id="sheet">
    <button type="button" class="icon-btn sheet-x" data-act="close-sheet" aria-label="Close">×</button>
    ${body}
  </div>`;
}
function changeSheet() {
  const d = S.draft;
  const onWall = route()[0] === 'wall';
  const L = onWall ? shown() : null;
  const dis = S.busy ? ' disabled' : '';
  return `<h2 id="sheet-h">Change</h2>
    <div class="sheet-row"><span class="label" id="full-l">How full</span>
      <span class="seg" role="group" aria-labelledby="full-l">${[['calm', 'Calm'], ['balanced', 'Balanced'], ['full', 'Full']].map(([k, l]) => `<button type="button" data-fullness="${k}" aria-pressed="${(d.fullness || 'balanced') === k}"${dis}>${l}</button>`).join('')}</span></div>
    ${keptOwned().length ? `<div class="sheet-row"><span class="label">Your pieces</span><span class="seg" role="group" aria-label="Which art"><button type="button" data-just="0" aria-pressed="${!d.justMine}"${dis}>With new art</button><button type="button" data-just="1" aria-pressed="${!!d.justMine}"${dis}>Just mine</button></span></div>` : ''}
    <ul class="sheet-list">
      ${onWall && L && L.pieces.some(movable) ? `<li><button type="button" class="sheet-item" data-act="edit">${S.edit ? 'Stop moving pieces' : 'Move pieces by hand'}</button></li>` : ''}
      ${onWall && L && L.history && L.history.length ? '<li><button type="button" class="sheet-item" data-act="undo-all">Put the pieces back the way they were</button></li>' : ''}
      ${onWall ? `<li><button type="button" class="sheet-item" data-act="measure">${S.measure ? 'Hide measurements' : 'Show measurements and nails'}</button></li>` : ''}
      <li><a class="sheet-item" href="#/taste">Make it mine: pick between pairs of art</a></li>
      <li><a class="sheet-item" href="${d.photo ? '#/check' : '#/things'}">Check what's marked on the wall</a></li>
      <li><a class="sheet-item" href="#/new">Start a new wall</a></li>
      <li><a class="sheet-item" href="#/walls">Your walls</a></li>
    </ul>`;
}
function pieceSheet(id) {
  const d = S.draft;
  const L = shown();
  const p = L && L.pieces.find((x) => x.ref.id === id);
  if (!p) return '';
  const own = p.ref.source !== 'catalog';
  if (own) {
    const o = d.owned.find((x) => x.id === id);
    return `<h2 id="sheet-h">Your ${esc(p.title)}</h2>
      <div class="sheet-art"><span class="art-big" style="aspect-ratio:${p.w}/${p.h}">${o && o.thumb ? `<img src="${o.thumb}" alt="">` : `<span class="swatch" style="background:${esc((o && o.color) || '#8A8F94')}"></span>`}</span></div>
      <p class="meta">${p.w} x ${p.h} in. ${p.role === 'pinned' ? 'Stays where it hangs.' : 'In every wall, free to move.'}</p>
      <p>${esc(cleanReason(p.reason))}</p>
      <p class="nail-line">${p.role === 'pinned' ? 'Already up.' : `Nail ${esc(inches(p.nail.y))} up, ${esc(inches(p.nail.x))} from the left end.`}</p>
      <div class="acts left">
        ${o && o.at ? `<button type="button" class="btn quiet" data-pin="${esc(id)}">${p.role === 'pinned' ? 'Let it move' : 'Pin it where it hangs'}</button>` : ''}
        <button type="button" class="btn quiet" data-keep="skip" data-oid="${esc(id)}">Leave it out</button>
      </div>`;
  }
  const item = byId.get(id);
  const c = item.offers && item.offers.length ? offersAt(item, p.w, p.h).main : null;
  const saved = d.saved.includes(id), kept = keptSet().has(id);
  return `<h2 id="sheet-h">${esc(item.title)}</h2>
    <div class="sheet-art"><span class="art-big" style="aspect-ratio:${item.aspect || p.w / p.h}"><img src="${item.imageData}" alt="${esc(item.title)}"></span></div>
    <p class="meta">${item.offers && item.offers.length ? `Art by ${esc(item.artist)}, sold by ${esc(item.source)}` : `Photo by ${esc(item.artist)} on ${esc(item.source)}`}</p>
    <p class="meta">${p.w} x ${p.h} in frame${c && c.price != null ? `. ${money(c.price, c.currency)}` : ''}</p>
    <p>${esc(cleanReason(p.reason))}</p>
    ${item.record && item.record.description ? `<p class="pencil small">${esc(item.record.description)}.</p>` : ''}
    <p class="nail-line">Nail ${esc(inches(p.nail.y))} up, ${esc(inches(p.nail.x))} from the left end.</p>
    <div class="acts left">
      <button type="button" class="btn quiet" data-save="${esc(id)}" aria-pressed="${saved}">${heart(saved)} ${saved ? 'Saved' : 'Save'}</button>
      <button type="button" class="btn quiet" data-act="swap" data-id="${esc(id)}"${kept || S.busy ? ' disabled' : ''}>${S.busy === `swap:${id}` ? 'Swapping…' : 'Swap this one'}</button>
      <button type="button" class="btn quiet" data-act="keep" data-id="${esc(id)}" aria-pressed="${kept}">${kept ? 'Kept in every wall' : 'Keep it in every wall'}</button>
    </div>
    ${c && c.url ? `<p><a href="${esc(c.url)}" target="_blank" rel="noopener">See it at ${esc(item.source)}</a></p>` : item.url ? `<p><a href="${esc(item.url)}" target="_blank" rel="noopener">See it on ${esc(item.source)}</a></p>` : ''}`;
}

function saveThisWall() {
  const L = shown();
  S.draft.chosen = L ? { layout: bareLayout(L), inputKey: viewKey() } : null;
  const ok = store.saveWall(S.draft) && persist();
  if (ok) { S.ui.saved = S.draft.id; S.flash = store.demoMode ? 'Sample mode: nothing is saved.' : 'Saved on this device. Find it under Your walls.'; }
  else S.flash = "Didn't save. This device's storage may be full. Try again after deleting an old wall.";
}

// ---------- Get it: the hanging guide ----------

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

// The wall's size is measured when you typed it or set it by tape; a size
// worked out from a TV or a door in the photo is an estimate.
function sizeMeasured(d) {
  const p = d.photo;
  if (!p) return true;
  if (p.auto && p.auto.guess) return p.auto.guess.from === 'measure';
  return !!(p.measure && p.measure.value);
}
// A nail spot from the nearest clear edge on the wall, like the TV's, which is
// easier and closer to measure from than the end of the wall.
// Couches and beds are soft at the edges, so they aren't measured from.
const REF_KINDS = new Set(['tv', 'window', 'door', 'mirror', 'shelf', 'dresser', 'console', 'sideboard', 'credenza']);
function nailRef(n, obstacles) {
  let best = null;
  for (const o of obstacles || []) {
    if (!REF_KINDS.has(o.kind)) continue;
    const dx = n.x < o.x ? o.x - n.x : n.x > o.x + o.w ? n.x - o.x - o.w : 0;
    const dy = n.y < o.y ? o.y - n.y : n.y > o.y + o.h ? n.y - o.y - o.h : 0;
    const dist = Math.hypot(dx, dy);
    if (dist <= 30 && (!best || dist < best.dist)) best = { o, dist };
  }
  if (!best) return null;
  const o = best.o, name = obName(o).toLowerCase();
  const r = (v) => Math.round(v * 4) / 4;
  const hz = n.x < o.x ? `${inches(r(o.x - n.x))} left of the ${name}'s left edge`
    : n.x > o.x + o.w ? `${inches(r(n.x - o.x - o.w))} right of the ${name}'s right edge`
    : `${inches(r(n.x - o.x))} right of the ${name}'s left edge`;
  const vt = n.y > o.y + o.h ? `${inches(r(n.y - o.y - o.h))} above its top`
    : n.y < o.y ? `${inches(r(o.y - n.y))} below its bottom` : `${inches(r(o.y + o.h - n.y))} down from its top`;
  return `${hz}, ${vt}`;
}

function getScreen() {
  if (need()) { go(need()); return ''; }
  const wait = building();
  if (wait) return wait;
  const d = S.draft;
  const L = shown();
  if (!L) { go('#/layouts'); return ''; }
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
  const drop = typeof d.drop === 'number' && d.drop >= 0 ? d.drop : RULES.defaultDrop;
  const LG = { ...L, pieces: L.pieces.map((p) => (p.role === 'pinned' || !p.nailNote ? p : { ...p, nail: { x: p.nail.x, y: Math.round((p.y + p.h - drop) * 4) / 4 } })) };
  const hangOrder = [...LG.pieces].filter((p) => p.role !== 'pinned').sort((a, b) => b.w * b.h - a.w * a.h);
  const refs = new Map(hangOrder.map((p) => [p.ref.id, nailRef(p.nail, d.obstacles)]));
  const anyRef = [...refs.values()].some(Boolean);
  const estimate = !sizeMeasured(d);
  const nameOf = (p) => (byId.get(p.ref.id) ? byId.get(p.ref.id).title : `Your ${p.title}`);
  const total = wallCost(L);
  const buy = fresh.map((p) => {
    const item = byId.get(p.ref.id);
    const shop = item.offers && item.offers.length ? offersAt(item, p.w, p.h) : null;
    const thumb = `<span class="thumb" style="aspect-ratio:${item.aspect || p.w / p.h}"><img src="${item.imageData}" alt=""></span>`;
    if (shop && shop.main) {
      const o = shop.main;
      return `<li class="row buy">${thumb}<span class="row-text"><span class="name">${esc(item.title)}</span>
        <span class="meta">Art by ${esc(item.artist)}, ${esc(item.source)}. ${o.w ? `${o.w} x ${o.h} in print${o.framed ? ', framed' : `, fits ${aOrAn(o.w)} ${o.w} x ${o.h} in frame`}` : `${p.w} x ${p.h} in frame`}${o.price != null ? `. ${money(o.price, o.currency)}` : ''}</span>
        <span class="row-acts"><a class="btn small" href="${esc(o.url)}" target="_blank" rel="noopener">Buy at ${esc(item.source)}</a>${o.framed ? '' : `<a class="btn quiet small" href="${frameLink(p.w, p.h)}" target="_blank" rel="noopener">Find ${aOrAn(Math.min(p.w, p.h))} ${Math.min(p.w, p.h)} x ${Math.max(p.w, p.h)} in frame</a>`}</span></span></li>`;
    }
    const ps = printSize(p.w, p.h);
    return `<li class="row buy">${thumb}<span class="row-text"><span class="name">${esc(item.title)}</span>
      <span class="meta">Photo by ${esc(item.artist)} on ${esc(item.source)}. ${ps ? `Print it ${ps[0]} x ${ps[1]} in for a ${p.w} x ${p.h} in frame with a mat` : `${p.w} x ${p.h} in frame`}. Free under the ${esc(item.record.source.license)}.</span>
      <span class="row-acts"><a class="btn small" href="${esc(item.url)}" target="_blank" rel="noopener">Get it on ${esc(item.source)}</a><a class="btn quiet small" href="${frameLink(p.w, p.h)}" target="_blank" rel="noopener">Find ${aOrAn(Math.min(p.w, p.h))} ${Math.min(p.w, p.h)} x ${Math.max(p.w, p.h)} in frame</a></span></span></li>`;
  }).join('');
  return `${bar(back('#/wall', 'This wall'), '<button type="button" class="btn quiet small" data-act="print">Print</button>')}
  <main class="page get">
    <h1>${fresh.length ? 'Get it, tape it, hang it' : 'Tape it, hang it'}</h1>
    <p class="lede">${esc(whyText(L))}</p>
    ${flashHtml()}
    ${fresh.length ? `<section aria-labelledby="buy-h"><h2 id="buy-h">What to get</h2>
      <ul class="rows">${buy}</ul>
      <p class="cost">${esc(costLine(total, true))}.</p>
      ${fresh.some((p) => (byId.get(p.ref.id).offers || []).length) ? '<p class="pencil small">Shops sell and ship their own prints. Prices are the shop\'s, checked when we added the print, and may have changed.</p>' : ''}
    </section>` : ''}
    <section class="guide" id="guide" aria-labelledby="guide-h">
      <h2 id="guide-h">Where the nails go</h2>
      ${estimate ? `<p class="note">These spots are estimates. The wall's size came from your photo, so a spot can be off by an inch or two. <a href="${d.photo && d.photo.mode === 'auto' ? '#/check' : '#/size'}">Measure the wall's width once</a> and every spot firms up.</p>` : ''}
      <form class="fields drop-form" id="drop-form">
        <label for="drop">Wire or hanger sits</label>
        <span class="pair"><input type="number" id="drop" name="drop" inputmode="decimal" min="0" max="12" step="0.25" value="${drop}"> in below the top of the frame</span>
        <span class="help">Pull the wire up tight, as it will hang, and measure from it to the top.</span>
      </form>
      <div class="drawing">${wallSvg({ wall: { width: d.width, height: d.height }, obstacles: d.obstacles, layout: LG, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: ownedInfo, keptIds: keptSet(), measure: true, still: true, pxWide: 900, label: `${d.name}, hanging guide` })}</div>
      <div class="table-scroll"><table class="nails"><thead><tr><th scope="col">Piece</th><th scope="col">Frame</th><th scope="col">From the left</th><th scope="col">Up from the floor</th></tr></thead>
        <tbody>${hangOrder.map((p) => `<tr><td>${esc(nameOf(p))}${refs.get(p.ref.id) ? `<span class="nail-ref">Or ${esc(refs.get(p.ref.id))}</span>` : ''}</td><td>${p.w} x ${p.h} in</td><td>${esc(inches(p.nail.x))}</td><td>${esc(inches(p.nail.y))}</td></tr>`).join('')}</tbody></table></div>
      <ol class="steps">
        <li>Cut a piece of paper or tape to each frame's size and stick it up where the drawing shows it. Step back and look before you drill.</li>
        <li>Hang the biggest piece first; the others measure off it.</li>
        <li>Mark each nail on the tape, drill through it, then peel it off.</li>
        ${anyRef ? `<li>Measuring from the nearest edge, like the TV's, keeps any error small${estimate ? ', which helps while the wall size is an estimate' : ''}.</li>` : ''}
      </ol>
    </section>
    <div class="acts left">
      <button type="button" class="btn" data-act="save">${S.ui.saved === d.id && !store.demoMode ? 'Saved on this device' : 'Save this wall'}</button>
      <a class="btn quiet" href="#/wall">Back to this wall</a>
    </div>
  </main>${credits()}`;
}

// ---------- Your walls ----------

function walls() {
  const all = store.listWalls();
  const date = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };
  return `${bar(back('#/', 'Walldrobe'), '<a class="btn quiet small" href="#/new">Start a wall</a>')}
  <main class="page">
    <h1>Your walls</h1>
    <p class="lede">Saved on this device. Walls and photos stay here and are never uploaded.</p>
    ${flashHtml()}
    ${all.length ? `<ul class="wall-list">${all.map((w) => `<li class="wall-item">
      <span class="drawing small-drawing">${wallSvg({ wall: { width: w.width, height: w.height }, obstacles: w.obstacles, photo: w.photo && (w.photo.clean || w.photo.flat), layout: w.chosen && w.chosen.layout, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: (id) => { const o = w.owned.find((x) => x.id === id); return o ? { thumb: o.thumb, color: o.color } : null; }, hideObstacles: !!(w.photo && w.photo.flat), pxWide: 320, still: true, label: w.name })}</span>
      <span class="wall-meta">
        <label class="name-in"><span class="sr">Name</span><input type="text" maxlength="40" value="${esc(w.name)}" data-rename="${esc(w.id)}"></label>
        <span class="meta">${esc(feet(w.width))} x ${esc(feet(w.height))}. Saved ${esc(date(w.savedAt))}.</span>
        ${S.ui.confirmDelete === w.id ? `<span class="error">Delete this wall and its photo? This can't be undone.</span>
          <span class="acts left"><button type="button" class="btn danger small" data-delete="${esc(w.id)}">Delete</button><button type="button" class="btn quiet small" data-act="cancel-delete">Keep it</button></span>`
        : `<span class="acts left"><button type="button" class="btn small" data-open="${esc(w.id)}">Open</button><button type="button" class="btn quiet small" data-ask-delete="${esc(w.id)}">Delete</button></span>`}
      </span>
    </li>`).join('')}</ul>` : '<p class="pencil">No walls yet. Start one with a photo, or try a sample wall from the start page.</p>'}
  </main>`;
}

// ---------- Render ----------

function focusSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const keys = ['isArt', 'isTv', 'style', 'fullness', 'count', 'rank', 'obk', 'obid', 'ok', 'oid', 'keep', 'act', 'id', 'which', 'scale', 'art', 'filter', 'v', 'corner', 'add', 'pick', 'open', 'rename'];
  const parts = keys.filter((k) => el.dataset && el.dataset[k] !== undefined).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(el.dataset[k])}"]`);
  return parts.length ? `${el.tagName.toLowerCase()}${parts.join('')}` : null;
}

function render() {
  const [r0, r1] = route();
  if (r0 === 'sample') { loadSample(r1); location.replace('#/layouts'); return; }
  if (r0 === 'new') {
    S.draft = { ...blankDraft(), taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null, picks: [] } };
    S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; S.quiz = null;
    resetLayouts(); location.replace('#/start'); return;
  }
  if (r0 === 'resume') { if (!resumeDraft()) { location.replace('#/start'); return; } location.replace(need() || '#/layouts'); return; }
  const screens = { '': home, start, check, corners, size: sizeScreen, things, pieces, taste, layouts: feed, wall: wallScreen, get: getScreen, walls };
  const fn = screens[r0] || home;
  document.title = { '': 'Walldrobe', walls: 'Your walls · Walldrobe', get: 'Hang it · Walldrobe', layouts: 'Your walls, ranked · Walldrobe', wall: 'Your wall · Walldrobe', taste: 'Make it mine · Walldrobe' }[r0] || 'Walldrobe';
  const el = document.activeElement;
  const sel = el && el !== document.body && el.closest('#app') ? focusSelector(el) : null;
  let html;
  try { html = fn(); }
  catch (e) {
    console.error(e);
    S.view = null; S.busy = null;
    html = brokeScreen();
  }
  if (html) app().innerHTML = html;
  document.body.classList.toggle('has-sheet', !!S.sheet);
  document.body.classList.toggle('on-wall', r0 === 'wall');
  document.body.classList.toggle('on-home', !r0);
  if (S.sheet) { const s = $('#sheet'); if (s && !s.contains(document.activeElement)) (s.querySelector('h2') || s).setAttribute('tabindex', '-1'), (s.querySelector('h2') || s).focus({ preventScroll: true }); }
  else if (sel) { const again = document.querySelector(sel); if (again) again.focus({ preventScroll: true }); }
  wire(r0);
}

function brokeScreen() {
  const hasWall = !!(S.draft && S.draft.width);
  return `${bar(wordmark())}<main class="page">
    <h1>Something broke building your walls</h1>
    <p class="lede">${hasWall ? 'Your photo and pieces are saved on this device.' : 'Nothing you made was lost.'} Try again, and if it keeps happening, check what's marked on the wall or start a new one.</p>
    <div class="acts left">
      <button type="button" class="btn" data-act="retry">Try again</button>
      ${hasWall ? `<a class="btn quiet" href="${S.draft.photo ? '#/check' : '#/things'}">Check what's marked</a>` : ''}
      <a class="btn quiet" href="#/new">Start a new wall</a>
    </div>
  </main>`;
}

// ---------- Events ----------

function wire(r) {
  if (r === 'corners') wireCorners();
  if (r === 'things') wireThings();
  if (r === 'pieces' && S.draft && S.draft.photo) wireDraw();
  const pi = $('#photo-input');
  if (pi) pi.addEventListener('change', (e) => onPhoto(e.target.files[0]));
  if (r === 'wall') { if (S.edit) wireEdit(); else wireSwipe(); }
}

// Swipe the open wall left or right for the next ranked wall; the photo stays put.
function wireSwipe() {
  const wrap = $('#drawing-wrap');
  if (!wrap) return;
  let start = null;
  wrap.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') start = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  wrap.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) < 50 || Math.abs(dy) > 40) return;
    const v = run(), i = v.list.findIndex((L) => L.key === S.openKey);
    const to = v.list[i + (dx < 0 ? 1 : -1)];
    if (to) { S.openKey = to.key; S.selected = null; S.undo = null; render(); }
  });
  wrap.addEventListener('pointercancel', () => { start = null; });
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

// ---------- Moving pieces by hand ----------
// Drag a frame and it snaps to the other frames' edges and centers, to the
// layout's spacing, to the middle of the wall, to 57 in, and to the edges of
// the TV and furniture. A spot that breaks a hard rule (over the TV, too close
// to another frame, off the wall) is shown in red and the piece goes back.

const qq = (v) => Math.round(v * 4) / 4;
const SNAP_PX = 9;
const EDGE_KINDS = new Set(['tv', 'window', 'door', 'mirror', 'shelf', 'couch', 'sofa', 'headboard', 'bed', 'dresser', 'console', 'sideboard', 'credenza']);
const movable = (p) => p.role !== 'pinned';
const bareLayout = (L) => { const { history, ...rest } = L; return rest; };

// The spacing this layout uses between frames, so a moved piece can match it.
function layoutGap(L) {
  const g = L.meta && Array.isArray(L.meta.gaps) && L.meta.gaps.find((v) => typeof v === 'number' && v > 0);
  return g || RULES.gap;
}

// Where a piece would snap to, near (x, y). Each axis snaps on its own.
function snapSpot(L, me, x, y, tol) {
  const d = S.draft, gap = layoutGap(L);
  const others = L.pieces.filter((p) => p.ref.id !== me.ref.id);
  const xs = [[d.width / 2 - me.w / 2, { line: d.width / 2, what: 'wall-center' }]];
  const ys = [[RULES.centerline - me.h / 2, { line: RULES.centerline, what: 'eye' }]];
  for (const o of others) {
    xs.push([o.x, { line: o.x }], [o.x + o.w - me.w, { line: o.x + o.w }], [o.x + o.w / 2 - me.w / 2, { line: o.x + o.w / 2 }]);
    xs.push([o.x + o.w + gap, { gap: [o.x + o.w, o.x + o.w + gap], o }], [o.x - gap - me.w, { gap: [o.x - gap, o.x], o }]);
    ys.push([o.y, { line: o.y }], [o.y + o.h - me.h, { line: o.y + o.h }], [o.y + o.h / 2 - me.h / 2, { line: o.y + o.h / 2 }]);
    ys.push([o.y + o.h + gap, { gap: [o.y + o.h, o.y + o.h + gap], o }], [o.y - gap - me.h, { gap: [o.y - gap, o.y], o }]);
  }
  for (const o of d.obstacles) {
    if (!EDGE_KINDS.has(o.kind)) continue;
    xs.push([o.x, { line: o.x }], [o.x + o.w - me.w, { line: o.x + o.w }], [o.x + o.w / 2 - me.w / 2, { line: o.x + o.w / 2 }]);
  }
  const pick = (cands, v) => {
    let best = null;
    for (const [at, why] of cands) { const dist = Math.abs(at - v); if (dist <= tol && (!best || dist < best.dist - 1e-9)) best = { at, why, dist }; }
    return best;
  };
  const sx = pick(xs, x), sy = pick(ys, y);
  return { x: sx ? sx.at : qq(x), y: sy ? sy.at : qq(y), sx: sx && sx.why, sy: sy && sy.why };
}

// What's wrong with a piece at (x, y), in plain words, or null when it fits.
function moveProblem(L, me, x, y) {
  const d = S.draft, g = RULES.gapHard;
  const pinned = L.pieces.filter((p) => !movable(p) && p.ref.id !== me.ref.id).map((p) => ({ id: p.ref.id, at: { x: p.x, y: p.y }, w: p.w, h: p.h }));
  // Another frame may come no closer than the hard minimum gap.
  const frames = L.pieces.filter((p) => movable(p) && p.ref.id !== me.ref.id)
    .map((p) => ({ x: p.x - g, y: p.y - g, w: p.w + 2 * g, h: p.h + 2 * g, id: p.ref.id, kind: 'art' }));
  const regions = [...blockedRegions(d.obstacles, pinned), ...frames];
  const fails = checkPieces([{ id: me.ref.id, x, y, w: me.w, h: me.h }], regions, { width: d.width, height: d.height });
  if (!fails.length) return null;
  const f = fails[0];
  if (f.endsWith('past the end of the wall')) return 'Too close to the end of the wall';
  if (f.endsWith('too close to floor or ceiling')) return y + me.h / 2 > d.height / 2 ? 'Too close to the ceiling' : 'Too low on the wall';
  const rid = f.slice(f.indexOf(' on ') + 4);
  const piece = L.pieces.find((p) => p.ref.id === rid);
  if (piece) return movable(piece) ? 'Too close to another frame' : `Too close to your ${piece.title}`;
  const ob = d.obstacles.find((o) => o.id === rid);
  if (!ob) return "That spot doesn't fit";
  const name = obName(ob).toLowerCase();
  return FURNITURE.has(ob.kind) && y >= ob.y + ob.h - 0.01 ? `Too low over the ${name}` : `Too close to the ${name}`;
}

function movePiece(L, id, x, y) {
  const p = L.pieces.find((v) => v.ref.id === id);
  if (!p) return;
  L.history = [...(L.history || []), { pieces: clone(L.pieces), group: { ...L.group } }].slice(-30);
  const dx = qq(x) - p.x, dy = qq(y) - p.y;
  p.x = qq(x); p.y = qq(y); p.cx = qq(p.x + p.w / 2); p.cy = qq(p.y + p.h / 2);
  p.nail = { x: qq(p.nail.x + dx), y: qq(p.nail.y + dy) };
  if (p.slot) p.slot = { ...p.slot, x: p.slot.x + dx, y: p.slot.y + dy };
  regroup(L);
  L.moved = true;
  afterEdit(L);
}
function regroup(L) {
  const ps = L.pieces.filter(movable).map((p) => p.slot || p);
  if (!ps.length) return;
  const x0 = Math.min(...ps.map((p) => p.x)), y0 = Math.min(...ps.map((p) => p.y));
  const x1 = Math.max(...ps.map((p) => p.x + p.w)), y1 = Math.max(...ps.map((p) => p.y + p.h));
  L.group = { ...L.group, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// An edited layout is the one you picked: it survives a reload.
function afterEdit(L) {
  S.ui.saved = null;
  S.draft.chosen = { layout: bareLayout(L), inputKey: viewKey() };
  replaceWall(L.key, L);
  persist();
}
function undoMove(L, all) {
  if (!L.history || !L.history.length) return;
  const to = all ? L.history[0] : L.history[L.history.length - 1];
  L.pieces = to.pieces; L.group = to.group;
  L.history = all ? [] : L.history.slice(0, -1);
  if (!L.history.length) L.moved = false;
  afterEdit(L);
}

function guideSvg(L, me, spot, H) {
  const d = S.draft, s = labelSize(d.width, ($('#drawing') && $('#drawing').clientWidth) || 600);
  const out = [];
  const vline = (x) => `<line x1="${x}" x2="${x}" y1="0" y2="${H}" class="snap-line"/>`;
  const hline = (y) => `<line x1="0" x2="${d.width}" y1="${H - y}" y2="${H - y}" class="snap-line"/>`;
  if (spot.sx && spot.sx.line !== undefined) out.push(vline(spot.sx.line));
  if (spot.sy && spot.sy.line !== undefined) out.push(hline(spot.sy.line));
  if (spot.sx && spot.sx.gap) {
    const [a, b] = spot.sx.gap, y = H - (Math.max(spot.y, spot.sx.o.y) + Math.min(spot.y + me.h, spot.sx.o.y + spot.sx.o.h)) / 2;
    out.push(`<line x1="${a}" x2="${b}" y1="${y}" y2="${y}" class="snap-gap"/><text x="${(a + b) / 2}" y="${y - s * 0.4}" text-anchor="middle" font-size="${s * 0.8}" class="snap-label">${esc(inches(b - a))}</text>`);
  }
  if (spot.sy && spot.sy.gap) {
    const [a, b] = spot.sy.gap, x = (Math.max(spot.x, spot.sy.o.x) + Math.min(spot.x + me.w, spot.sy.o.x + spot.sy.o.w)) / 2;
    out.push(`<line x1="${x}" x2="${x}" y1="${H - a}" y2="${H - b}" class="snap-gap"/><text x="${x + s * 0.4}" y="${H - (a + b) / 2 + s * 0.3}" font-size="${s * 0.8}" class="snap-label">${esc(inches(b - a))}</text>`);
  }
  if (spot.sy && spot.sy.what === 'eye') out.push(`<text x="${s * 0.4}" y="${H - RULES.centerline - s * 0.35}" font-size="${s * 0.8}" class="snap-label">57 in, eye level</text>`);
  return out.join('');
}

function wireEdit() {
  const wrap = $('#drawing-wrap');
  const svg = wrap && wrap.querySelector('svg');
  if (!svg || !S.edit) return;
  const L = shown();
  const H = Number(svg.dataset.h);
  const msg = $('#edit-msg');
  const say = (t) => { if (msg) msg.textContent = t; };
  const NS = 'http://www.w3.org/2000/svg';
  dragOn(svg, (e) => {
    const g = e.target.closest && e.target.closest('.art');
    const me = g && L.pieces.find((p) => p.ref.id === g.dataset.id);
    if (!me || !movable(me)) return null;
    const guides = document.createElementNS(NS, 'g');
    guides.setAttribute('class', 'snap-guides');
    svg.appendChild(guides);
    g.classList.add('is-moving');
    svg.classList.add('is-dragging');
    const ctm = svg.getScreenCTM();
    return { g, me, guides, start: wallPoint(svg, e), tol: SNAP_PX / (ctm ? ctm.a : 4), spot: { x: me.x, y: me.y }, bad: null, moved: false };
  }, (c, e) => {
    const at = wallPoint(svg, e);
    const d = S.draft;
    const rx = Math.max(0, Math.min(d.width - c.me.w, c.me.x + at.x - c.start.x));
    const ry = Math.max(0, Math.min(d.height - c.me.h, c.me.y + at.y - c.start.y));
    if (!c.moved && Math.hypot(rx - c.me.x, ry - c.me.y) < c.tol * 0.4) return;
    c.moved = true;
    c.spot = snapSpot(L, c.me, rx, ry, c.tol);
    c.bad = moveProblem(L, c.me, c.spot.x, c.spot.y);
    c.g.setAttribute('transform', `translate(${c.spot.x - c.me.x} ${-(c.spot.y - c.me.y)})`);
    c.g.classList.toggle('is-bad', !!c.bad);
    c.guides.innerHTML = guideSvg(L, c.me, c.spot, H);
    say(c.bad ? `${c.bad}. Let go and it goes back.` : `${inches(c.spot.x)} from the left end, bottom ${inches(c.spot.y)} up.`);
  }, (c) => {
    c.guides.remove();
    svg.classList.remove('is-dragging');
    c.g.classList.remove('is-moving', 'is-bad');
    if (!c.moved) { c.g.removeAttribute('transform'); return; }
    if (c.bad) { c.g.removeAttribute('transform'); S.flash = `${c.bad}, so it went back.`; render(); return; }
    S.flash = null;
    movePiece(L, c.me.ref.id, c.spot.x, c.spot.y);
    render();
    const again = document.querySelector(`#drawing .art[data-id="${CSS.escape(c.me.ref.id)}"]`);
    if (again) again.focus({ preventScroll: true });
  });
}

// Arrow keys move the focused piece: half an inch, or 3 in with Shift.
function nudge(id, key, big) {
  const L = shown();
  const me = L && L.pieces.find((p) => p.ref.id === id);
  if (!me || !movable(me)) return;
  const step = big ? 3 : 0.5;
  const [dx, dy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[key];
  const bad = moveProblem(L, me, me.x + dx, me.y + dy);
  if (bad) { S.flash = `${bad}, so it stays.`; render(); }
  else { S.flash = null; movePiece(L, id, me.x + dx, me.y + dy); render(); }
  const again = document.querySelector(`#drawing .art[data-id="${CSS.escape(id)}"]`);
  if (again) again.focus({ preventScroll: true });
}

function editBar(L) {
  const undo = L.history && L.history.length;
  return `<div class="edit-bar"><p class="help" id="edit-msg" aria-live="polite">Drag a piece, or use the arrow keys. It snaps to the other frames, the middle of the wall and eye level.</p>
    <div class="acts left"><button type="button" class="btn small" data-act="edit">Done moving</button>
    <button type="button" class="btn quiet small" data-act="undo-move"${undo ? '' : ' disabled'}>Undo</button>
    <button type="button" class="btn quiet small" data-act="undo-all"${undo ? '' : ' disabled'}>Put them back</button></div></div>`;
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
  if (f.id === 'drop-form') { const i = $('#drop'); if (i) i.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (f.id === 'dims-form') { changeDims(f); return; }
  if (f.id === 'size-form') {
    const v = (n) => Number(f.elements[n].value || 0);
    const W = v('wft') * 12 + v('win'), H = v('hft') * 12 + v('hin');
    if (W < 24 || W > 600) { S.ui.sizeErr = 'A wall between 2 ft and 50 ft wide works here. Check the width.'; render(); return; }
    if (H < 60 || H > 240) { S.ui.sizeErr = 'A wall between 5 ft and 20 ft tall works here. Check the height.'; render(); return; }
    const keep = S.draft && !S.draft.sample && !S.draft.photo ? S.draft : { ...blankDraft(), taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null, picks: [] } };
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
  if (t.id === 'drop') {
    const v = Number(t.value);
    if (Number.isFinite(v) && v >= 0 && v <= 12) { S.draft.drop = Math.round(v * 4) / 4; persist(); render(); const again = $('#drop'); if (again) again.focus({ preventScroll: true }); }
    return;
  }
  if (t.dataset && t.dataset.artPhoto && t.files && t.files[0]) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.artPhoto);
    if (!o) return;
    loadFile(t.files[0], 240).then((img) => {
      const pal = palette(img, 5);
      o.thumb = img.url; o.palette = pal; o.color = pal[0] ? pal[0].hex : o.color;
      if (o.w === 16 && o.h === 20) {
        const long = 20, a = img.width / img.height;
        [o.w, o.h] = a >= 1 ? [long, Math.round((long / a) * 2) / 2] : [Math.round(long * a * 2) / 2, long];
        S.flash = `Shaped like the photo: ${o.w} x ${o.h} in. Put in the frame's real size.`;
      }
      resetLayouts(); persist(); render();
    }).catch((err) => { S.flash = err.message; render(); });
    return;
  }
  if (t.id === 'tv-size') {
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
  if (t.dataset.rename) { store.renameWall(t.dataset.rename, t.value.trim() || 'My wall'); if (S.draft && S.draft.id === t.dataset.rename) { S.draft.name = t.value.trim() || 'My wall'; persist(); } }
});

// What changing the wall's inputs does to the list: build it again, keep the open wall's place.
function rebuild(name) { S.flash = null; S.undo = null; S.openKey = null; S.sheet = null; persist(); render(); }

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .art, a[data-act], a[data-wall], .backdrop');
  if (!t) return;
  const a = t.dataset.act;
  if (t.dataset.wall) { S.openKey = t.dataset.wall; S.selected = null; S.undo = null; S.edit = false; return; }
  if (t.dataset.goto !== undefined) { if (t.dataset.goto) { S.openKey = t.dataset.goto; S.selected = null; S.undo = null; S.edit = false; render(); } return; }
  if (t.dataset.which) { S.draft.photo.measure.which = t.dataset.which; S.draft.photo.measure.value = null; S.draft.photo.measure.override = null; persist(); render(); return; }
  if (t.dataset.fix !== undefined) { S.ui.fix = t.dataset.fix || null; render(); return; }
  if (t.dataset.add) {
    const W = S.draft.width;
    const o = clampOb({ id: `${t.dataset.add}${Date.now().toString(36)}`, kind: t.dataset.add, ...DEFAULTS[t.dataset.add](W) });
    S.draft.obstacles.push(o); resetLayouts(); persist(); render(); return;
  }
  if (t.dataset.notape) {
    const p = S.draft.photo, opt = noTapeOptions(p).find(([k]) => k === t.dataset.notape);
    if (!opt || S.busy) return;
    S.busy = 'flatten';
    ensurePixels().then(() => {
      setScale(opt[1]);
      p.auto.guess = { from: opt[0], inches: opt[1] };
      applyAuto(); flattenAuto(); resetLayouts(); persist();
      S.busy = null; go('#/check');
    }).catch(() => { S.busy = null; S.ui.sizeErr = "Couldn't flatten the photo. Try again, or use another photo."; render(); });
    return;
  }
  if (t.dataset.isTv) {
    const p = S.draft.photo, au = p && p.auto;
    const it = au && au.items.find((i) => i.id === t.dataset.isTv);
    if (!it) return;
    it.kind = 'tv'; it.alone = true;
    // Taller than a screen: the box took in the stand too. The screen is the top 16:9 of it.
    if (it.w / it.h < 1.6) {
      const h = Math.round(it.w / (16 / 9)), rest = it.h - h;
      it.h = h;
      const stand = au.items.some((f) => f !== it && !f.removed && ['console', 'furniture', 'shelf'].includes(f.kind) && f.x < it.x + it.w && f.x + f.w > it.x && f.y + f.h > it.y + h);
      if (!stand && rest > au.rh * 0.08) au.items.push({ id: `${it.id}-stand`, kind: 'console', x: it.x, y: it.y + h, w: it.w, h: rest });
    }
    it.onStand = au.items.some((f) => f !== it && !f.removed && ['console', 'furniture', 'shelf'].includes(f.kind) && f.x < it.x + it.w && f.x + f.w > it.x && f.y < it.y + it.h + au.rh * 0.06 && f.y + f.h > it.y + it.h - au.rh * 0.02);
    S.draft.owned = S.draft.owned.filter((o) => o.autoId !== it.id);
    ensurePixels().then(() => {
      if (!au.guess || au.guess.from !== 'measure') {
        let px = 0;
        if (it.onStand) {
          const Hm = homography([[0, 0], [au.rw, 0], [au.rw, au.rh], [0, au.rh]], p.corners);
          const q1 = apply(Hm, it.x, it.y + it.h / 2), q2 = apply(Hm, it.x + it.w, it.y + it.h / 2);
          px = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]);
        }
        au.tvPx = px; au.tvInches = au.tvInches || 55; au.tvWhy = null;
        au.depth = px ? tvDepthFactor(px, Math.hypot(p.w, p.h), au.tvInches) : 1;
        au.guess = guessWidth(au.items, au.rw, au.tvInches, au.depth);
        if (au.guess) setScale(au.guess.inches);
      }
      applyAuto(); flattenAuto(); resetLayouts(); persist();
      S.flash = 'Marked as the TV.'; render();
    });
    return;
  }
  if (t.dataset.isArt) {
    const au = S.draft.photo && S.draft.photo.auto;
    const it = au && au.items.find((i) => i.id === t.dataset.isArt);
    if (it && S.mem.photo && au.rw) {
      it.kind = 'art'; Object.assign(it, thumbAndPalette(regionImg(), it));
      applyAuto(); flattenAuto(); resetLayouts(); persist(); S.ui.fix = null; S.flash = 'Marked as your art.'; render();
    } else { S.flash = 'Open the photo again to change this.'; render(); }
    return;
  }
  if (t.dataset.removeOb) { forgetAuto(t.dataset.removeOb); S.draft.obstacles = S.draft.obstacles.filter((o) => o.id !== t.dataset.removeOb); S.ui.fix = null; resetLayouts(); persist(); render(); return; }
  if (t.dataset.removeOwned) { forgetAuto(t.dataset.removeOwned); S.draft.owned = S.draft.owned.filter((o) => o.id !== t.dataset.removeOwned); S.ui.fix = null; S.mem.clean = null; resetLayouts(); persist(); render(); return; }
  if (t.dataset.keep && t.dataset.oid) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.oid);
    if (o) {
      o.keep = t.dataset.keep === 'skip' ? 'skip' : 'must';
      if (o.keep === 'skip') o.pinned = false;
      S.mem.clean = null;
      if (route()[0] === 'wall') { S.sheet = null; rebuild('keep'); return; }
      resetLayouts(); persist(); render();
    }
    return;
  }
  if (t.dataset.pin) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.pin);
    if (o) { o.pinned = !o.pinned; o.keep = 'must'; S.mem.clean = null; S.sheet = null; rebuild('pin'); }
    return;
  }
  if (t.dataset.fullness) { S.draft.fullness = t.dataset.fullness; rebuild('fullness'); return; }
  if (t.dataset.just !== undefined) { S.draft.justMine = t.dataset.just === '1'; rebuild('just'); return; }
  if (t.dataset.save) { toggleSave(t.dataset.save); render(); return; }
  if (t.dataset.piece) { S.sheet = { piece: t.dataset.piece }; S.selected = t.dataset.piece; render(); return; }
  if (t.dataset.pick) {
    const q = S.quiz; const [x, y] = q.pair; const winner = x.id === t.dataset.pick ? x : y;
    q.picks.push({ winner, loser: winner === x ? y : x }); advanceQuiz(true); return;
  }
  if (t.dataset.open) {
    const w = store.getWall(t.dataset.open);
    if (w) { S.draft = upgradeDraft(w); S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; resetLayouts(); persist(); ensurePixels().then(() => { S.mem.clean = null; render(); }); go('#/wall'); }
    return;
  }
  if (t.dataset.askDelete) { S.ui.confirmDelete = t.dataset.askDelete; render(); return; }
  if (t.dataset.delete) {
    store.deleteWall(t.dataset.delete);
    if (S.draft && S.draft.id === t.dataset.delete) { S.draft = null; store.clearDraft(); }
    S.ui.confirmDelete = null; S.flash = store.demoMode ? 'Sample mode: nothing is deleted.' : 'Deleted, with its photo.'; render(); return;
  }
  if (S.edit && t.classList.contains('art')) return;
  if (t.classList.contains('art') && route()[0] === 'wall') { S.sheet = { piece: t.dataset.id }; S.selected = t.dataset.id; render(); return; }
  switch (a) {
    case 'corners-ok': {
      if (!S.draft.photo || S.busy) break;
      S.busy = 'read'; S.ui.cornerErr = null; render();
      setTimeout(() => readPhoto().then((to) => { S.busy = null; resetLayouts(); persist(); go(to); })
        .catch(() => { S.busy = null; S.ui.cornerErr = "Couldn't read the photo. Try again, or use another photo."; render(); }), 30);
      break;
    }
    case 'add-not-up': {
      const id = `own${Date.now().toString(36)}`;
      S.draft.owned.push({ id, title: freeTitle(new Set(S.draft.owned.map((o) => o.title))), w: 16, h: 20, keep: 'must', pinned: false, color: '#8A8F94', palette: [{ hex: '#8A8F94', weight: 1 }], fromPhoto: false });
      S.ui.fix = id; resetLayouts(); persist(); render(); break;
    }
    case 'add-piece': {
      S.draft.owned.push({ id: `own${Date.now().toString(36)}`, title: freeTitle(new Set(S.draft.owned.map((o) => o.title))), w: 16, h: 20, keep: 'must', pinned: false, color: '#8A8F94', palette: [{ hex: '#8A8F94', weight: 1 }], fromPhoto: false });
      resetLayouts(); persist(); render(); break;
    }
    case 'quiz-skip': advanceQuiz(false); break;
    case 'quiz-done': finishQuiz(); break;
    case 'retry-save': persist(); if (!S.saveFailed) S.flash = 'Saved.'; render(); break;
    case 'change': S.sheet = 'change'; render(); break;
    case 'close-sheet': { const was = S.sheet; S.sheet = null; S.selected = null; render(); const back = was && was.piece ? document.querySelector(`[data-piece="${CSS.escape(was.piece)}"]`) : document.querySelector('[data-act="change"]'); if (back) back.focus({ preventScroll: true }); break; }
    case 'keep': { const id = t.dataset.id; toggleKeep(id); S.openKey = S.draft.chosen ? S.draft.chosen.layout.key : null; S.flash = null; S.sheet = { piece: id }; render(); break; }
    case 'swap': { const id = t.dataset.id; S.flash = null; act(`swap:${id}`, () => { swapPiece(id); S.sheet = null; S.selected = null; }); break; }
    case 'undo': if (S.undo) { S.undo.run(); S.undo = null; S.flash = null; render(); } break;
    case 'edit': S.edit = !S.edit; S.sheet = null; S.selected = null; S.flash = null; if (S.edit) S.measure = true; render(); break;
    case 'measure': S.measure = !S.measure; S.sheet = null; render(); break;
    case 'undo-move': case 'undo-all': { const L = shown(); if (L) undoMove(L, a === 'undo-all'); S.sheet = null; S.flash = null; render(); break; }
    case 'retry': resetLayouts(); render(); break;
    case 'save': saveThisWall(); render(); break;
    case 'get': S.draft.chosen = { layout: bareLayout(shown()), inputKey: viewKey() }; persist(); go('#/get'); break;
    case 'print': window.print(); break;
    case 'cancel-delete': S.ui.confirmDelete = null; render(); break;
    default: break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) { const was = S.sheet; S.sheet = null; S.selected = null; render(); const back = was && was.piece ? document.querySelector(`[data-piece="${CSS.escape(was.piece)}"]`) : document.querySelector('[data-act="change"]'); if (back) back.focus({ preventScroll: true }); return; }
  // Focus stays inside an open sheet.
  if (e.key === 'Tab' && S.sheet) {
    const s = $('#sheet'); if (!s) return;
    const f = [...s.querySelectorAll('button, a[href], input, select, [tabindex="0"]')].filter((x) => !x.disabled);
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || !s.contains(document.activeElement))) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    return;
  }
  const t = e.target.closest && e.target.closest('.art');
  if (t && S.edit && route()[0] === 'wall') {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); nudge(t.dataset.id, e.key, e.shiftKey); }
    return;
  }
  if (t && route()[0] === 'wall' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); S.sheet = { piece: t.dataset.id }; S.selected = t.dataset.id; render(); return; }
  if (route()[0] === 'wall' && !S.sheet && !S.edit && !(e.target.closest && e.target.closest('input, textarea, select')) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const v = run(), i = v.list.findIndex((L) => L.key === S.openKey);
    const to = v.list[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (to) { S.openKey = to.key; S.selected = null; S.undo = null; render(); }
  }
});

let lastW = 0;
window.addEventListener('resize', () => {
  const d = $('#drawing') || $('.drawing');
  if (!d) return;
  if (Math.abs(d.clientWidth - lastW) > 40) { lastW = d.clientWidth; if (['layouts', 'wall'].includes(route()[0])) render(); }
});
// iOS needs a touch listener for :active press states.
document.addEventListener('touchstart', () => {}, { passive: true });

// Open where they left off: pixels for a saved photo load in the background.
ensurePixels().then(() => { S.mem.clean = null; if (['layouts', 'wall', 'get'].includes(route()[0])) render(); }).catch(() => {});
render();

