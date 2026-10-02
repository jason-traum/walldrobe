// Walldrobe, the site (v2). One wall at a time: a photo, its corners, one
// screen to confirm what we found, then a ranked list of finished walls on your
// own photo, and the hanging guide for the one you pick.
// Screens are plain functions that return HTML; every change re-renders.
// Design rules: DESIGN.md. Product rules: PRODUCT.md. States: STATES.md.

import { layout, refill, rerank, RULES } from '../engine/index.js';
import { blockedRegions, checkPieces, FURNITURE } from '../engine/geometry.js';
import { fitTaste, scoreTaste, nextAxisPair, tasteProfile, correctProfile, scoreProfile, AXES } from '../engine/taste.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';
import { normalizePalette, paletteSimilarity } from '../engine/color.js';
import { WALLS as SAMPLES, SAMPLE_PICKS } from '../demo/samples.js';
import { esc, inches, feet, wallSvg, wallPoint, KIND_NAME, obName, labelSize } from './draw.js';
import { aspectFromCorners, cornerProblem, flatten, paintOut, palette, crop, photoQuality, loadFile, toDataUrl, fromDataUrl, homography, apply } from './photo.js';
import { readWall, guessWidth, labToRgb, suggestWall, tvDepthFactor, hiddenFromFor, TV_SIZES } from './detect.js';
import * as store from './store.js';
import * as social from './social.js';
import { segment, modelCached, warm } from './segment.js';
import { packLabels, unpackLabels } from './segcore.js';

const QUIZ_LENGTH = 14; // about two clean pairs per taste axis
const WALLS_ASKED = 24; // walls built once per wall; the list shows the distinct ones
const CATALOG = activeRecords(window.WALLDROBE_CATALOG.items).map((r) => ({ ...toCandidate(r), imageData: r.image.data, aspect: r.image.aspect }));
const byId = new Map(CATALOG.map((c) => [c.id, c]));
const $ = (sel) => document.querySelector(sel);
const app = () => $('#app');
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- State ----------

// You: saves, swaps and art that isn't up, shared by every wall.
const ME = store.loadMe();
function syncMe() { store.saveMe(ME); }
// One line in the device's event log (store.logEvent): ids and wall keys only, never a photo or a name.
function logE(type, data = {}) { store.logEvent(type, S.draft && S.draft.sample ? { ...data, sample: true } : data); }

const S = {
  draft: store.loadDraft(),
  memo: new Map(), // views by key, so a step back shows the same walls
  feed: { status: 'idle', posts: [], mine: new Set(), more: false, at: 0, err: null },
  quiz: null,
  view: null, // { key, all, list, rankKey, problems }
  openKey: null, // the wall that's open
  versions: [], // every wall you've had on this step, oldest first
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
    taste: { source: 'none', weights: null, picks: [] }, kept: [], saved: ME.saved, skipped: ME.skipped, chosen: null, fullness: 'balanced', justMine: false,
  };
}
// Sample rooms are never written over your own wall in progress.
function persist() {
  if (!S.draft || S.draft.sample) return true;
  rememberArt(); saveVersions();
  const ok = store.saveDraft(S.draft);
  S.saveFailed = !ok;
  return ok;
}
function resetLayouts() { S.view = null; S.injected = null; S.memo = new Map(); S.openKey = null; S.selected = null; S.edit = false; S.sheet = null; S.undo = null; S.seen = new Map(); S.ui.saved = null; }
// Back to your own wall after looking at a sample.
function resumeDraft() {
  const d = store.loadDraft();
  if (d && !d.sample) { S.draft = adoptMe(upgradeDraft(d)); S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; resetLayouts(); loadVersions(); ensurePixels().then(render).catch(() => {}); return true; }
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
  resetLayouts(); S.versions = [];
}
// Older saved walls had four keep settings; v2 has keep or skip.
function upgradeDraft(d) {
  if (!d) return d;
  d.kept = d.kept || [];
  d.fullness = d.fullness || 'balanced';
  if (d.taste && !d.taste.picks) d.taste.picks = [];
  for (const o of d.owned || []) if (o.keep !== 'skip') { if (o.keep === 'happy') o.loosen = true; if (o.keep !== 'must') o.pinned = false; o.keep = 'must'; }
  return d;
}
// Saves and swaps belong to you, not to one wall: a wall opens with yours.
function adoptMe(d) {
  if (!d) return d;
  d.saved = ME.saved; d.skipped = ME.skipped;
  return d;
}
// Art you added that isn't up anywhere is kept for your next wall.
function rememberArt() {
  const d = S.draft;
  if (!d || d.sample) return;
  for (const o of d.owned) {
    if (o.at || o.fromPhoto) continue;
    const rec = { id: o.id, title: o.title, w: o.w, h: o.h, thumb: o.thumb || null, color: o.color || null, palette: o.palette || null };
    const i = ME.art.findIndex((a) => a.id === o.id);
    if (i >= 0) ME.art[i] = rec; else ME.art.push(rec);
  }
  syncMe();
}
adoptMe(upgradeDraft(S.draft));
loadVersions();

// ---------- Router ----------

const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', () => { S.flash = S.flashNext || null; S.flashNext = null; S.ui.cornerErr = null; S.ui.sizeErr = null; S.sheet = null; render(); window.scrollTo(0, 0); });

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
const flashHtml = () => (S.flash ? `<p class="flash">${esc(S.flash)}</p>` : '');

// The five steps, named the way a framer would, on every screen past the photo.
const STEPS = ['Wall', 'Taste', 'Pick', 'Frames', 'Hang'];
function stepBar(i) {
  const d = S.draft;
  const hasWall = !need() && !!(S.view && S.view.all && S.view.all.length);
  const hrefs = [d && d.photo ? '#/check' : '#/things', '#/taste', '#/wall', '#/frames', '#/get'];
  const can = (k) => !need() && (k <= 2 || hasWall);
  return `<nav class="steps-bar" aria-label="Steps"><ol>${STEPS.map((l, k) => `<li${k === i ? ' aria-current="step"' : k < i ? ' class="is-done"' : ''}>${k !== i && can(k) ? `<a href="${hrefs[k]}">${l}</a>` : `<span>${l}</span>`}</li>`).join('')}</ol></nav>`;
}

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
  // Prints from shops, free photos, or both (prints lean ahead a little); your own pieces only, when asked.
  const mode = artMode();
  const isShop = (c) => c.offers && c.offers.length > 0;
  const catalog = d.justMine ? [] : applyPool(CATALOG.filter((c) => keptIds.has(c.id) || (mode === 'both' || (mode === 'prints' ? isShop(c) : !isShop(c)))), keptIds);
  const taste = tasteScores(catalog);
  if (mode === 'both') for (const c of catalog) if (isShop(c) && taste[c.id] != null) taste[c.id] = Math.min(1, taste[c.id] + 0.08);
  const room = d.room && d.room.length ? { palette: d.room } : undefined;
  return { wall: { width: d.width, height: d.height }, obstacles: d.obstacles, owned, catalog, taste, room, count: WALLS_ASKED, base: S.stepBase || undefined,
    // The piece count is everything on the wall, pieces that stay put included.
    prefs: { fullness: d.fullness || 'balanced', style: d.style || undefined, pieces: d.pieces ? Math.max(1, d.pieces - stayCount()) : undefined } };
}
const keepList = () => (S.draft.justMine ? [] : S.draft.kept || []);
const ART_MODES = ['prints', 'both', 'photos'];
// Take art out of the pool the way a shop's filters do. A kept piece always stays in.
const NO_POOL = { people: 'any', maxPrice: null, color: 'any', shops: [] };
const pool = () => ({ ...NO_POOL, ...((S.draft && S.draft.pool) || {}) });
const poolCount = (f = pool()) => (f.people !== 'any') + (f.maxPrice != null) + (f.color !== 'any') + f.shops.length;
const SHOP_OF = (c) => (c.offers && c.offers.length ? c.record.source.provider : 'free');
const PRICES = [[null, 'Any'], [50, 'Under $50'], [100, 'Under $100'], [250, 'Under $250']];
function applyPool(list, keptIds) {
  const f = pool();
  if (!poolCount(f)) return list;
  const out = [];
  for (const c of list) {
    if (keptIds.has(c.id)) { out.push(c); continue; }
    const r = c.record;
    if (f.people === 'none' && r.tags && r.tags.people) continue;
    if (f.color === 'color' && r.color && r.color.bw) continue;
    if (f.color === 'bw' && !(r.color && r.color.bw)) continue;
    if (f.shops.includes(SHOP_OF(c))) continue;
    if (f.maxPrice != null && c.offers && c.offers.length) {
      const sizes = c.sizes.filter((z) => z.price == null || z.price <= f.maxPrice);
      if (!sizes.length) continue;
      out.push(sizes.length === c.sizes.length ? c : { ...c, sizes });
    } else out.push(c);
  }
  return out;
}
const artMode = () => (ART_MODES.includes(S.draft && S.draft.art) ? S.draft.art : 'prints');
const stayCount = () => S.draft.owned.filter((o) => o.pinned && o.at && o.keep !== 'skip').length;
const keptSet = () => new Set(keepList().map((k) => k.id));
const viewKey = () => JSON.stringify([S.draft.id, S.draft.width, S.draft.height, S.draft.obstacles, S.draft.owned.map((p) => [p.id, p.title, p.w, p.h, p.keep, p.pinned, p.loosen, p.at, p.color, p.palette]), S.draft.taste.weights, S.draft.taste.picks, S.draft.taste.corrections, keepList().map((k) => [k.id, k.w, k.h]), S.draft.fullness, S.draft.justMine, S.draft.style, S.draft.pieces, artMode(), pool()]);
const rankKey = () => JSON.stringify([S.draft.saved, S.draft.skipped]);

const picksOf = (list) => (list || []).map(([w, l]) => ({ winner: byId.get(w), loser: byId.get(l) })).filter((x) => x.winner && x.loser);
// Your taste as a profile: the quiz, any extra pairs (saves over swaps), then your corrections on top.
function profileNow(extra = []) {
  const t = S.draft.taste;
  if (!t || t.source !== 'yours') return null;
  const picks = [...picksOf(t.picks), ...extra];
  if (!picks.length && !(t.corrections || []).length) return null;
  let prof = tasteProfile(picks, CATALOG);
  for (const c of t.corrections || []) { try { prof = correctProfile(prof, c); } catch { /* an axis that's gone */ } }
  return prof;
}
// What each piece scores for you, 0 to 1: your profile when you have one, else the sample's taste.
function tasteScores(catalog, extra = []) {
  const prof = profileNow(extra);
  if (prof) return scoreProfile(prof, catalog);
  const t = S.draft.taste;
  if (extra.length) return scoreTaste(fitTaste([...picksOf(t.picks), ...extra]), catalog);
  return scoreTaste(t.weights, catalog);
}
// Saves and swaps tell us what you like: a saved piece beats one you swapped away.
function rankTaste() {
  const d = S.draft;
  const pairs = [];
  for (const w of d.saved) for (const l of d.skipped) { const a = byId.get(w), b = byId.get(l); if (a && b) pairs.push({ winner: a, loser: b }); }
  if (!pairs.length) return null;
  const ids = new Set(S.view.all.flatMap((L) => L.pieces.filter((p) => p.ref.source === 'catalog').map((p) => p.ref.id)));
  return tasteScores(CATALOG.filter((c) => ids.has(c.id)), pairs);
}

function run() {
  const key = viewKey();
  if (!(S.view && S.view.key === key)) {
    // Walls seen at this count (or kind, or how full) come back as they were, swaps and all.
    if (S.view) S.memo.set(S.view.key, { view: S.view, openKey: S.openKey });
    const back = S.memo.get(key);
    if (back) { S.view = { ...back.view, key }; S.memo.delete(key); S.openKey = back.openKey; S.stepBase = null; }
    else build(key);
  }
  if (S.view.rankKey !== rankKey()) rank();
  return S.view;
}
function build(key0) {
  let key = key0; // changes below when a pick that doesn't fit is let go
  // Pieces you keep that can't all go up: the engine leaves out as few as it can, smallest first, and says which.
  const ask = () => layout({ ...engineInput(), keep: keepList(), prefs: { ...engineInput().prefs, dropFewest: true } });
  let r = ask();
  // A count this kind can't make here: the nearest one it can, said plainly.
  const off = r.problems.find((p) => p.code === 'COUNT_DOESNT_FIT');
  if (!r.layouts.length && off && off.near) { S.draft.pieces = off.near; persist(); S.flashNext = null; S.flash = off.message; r = ask(); }
  // Still nothing with a kind or a count picked: show what does fit, and say so.
  if (!r.layouts.length && (S.draft.pieces || S.draft.style)) {
    const was = [S.draft.style === 'gallery' ? 'loose' : S.draft.style, S.draft.pieces ? `${S.draft.pieces} pieces` : null].filter(Boolean).join(', ');
    const keepStyle = S.draft.style, keepPieces = S.draft.pieces;
    S.draft.style = null; S.draft.pieces = null;
    const r2 = ask();
    if (r2.layouts.length) { persist(); S.flash = `Nothing ${was} fits here, so these are what does.`; r = r2; key = viewKey(); }
    else { S.draft.style = keepStyle; S.draft.pieces = keepPieces; }
  }
  const problems = [...r.problems];
  let all = r.layouts;
  const counts = (r.counts || []).map((c) => c + stayCount());
  // A tight wall makes few walls at one fullness: add the ones the other two
  // make, after these, so there's always a real list to choose from.
  if (all.length && !S.draft.style && !S.draft.pieces && !S.stepBase && rerank(all, { distinct: true }).length < 8) {
    const mine = S.draft.fullness || 'balanced';
    for (const f of ['full', 'calm', 'balanced'].filter((x) => x !== mine)) {
      const more = layout({ ...engineInput(), prefs: { fullness: f, dropFewest: true }, keep: keepList() }).layouts;
      const have = new Set(all.map((L) => L.key));
      all = all.concat(more.filter((L) => !have.has(L.key)).map((L) => ({ ...L, score: (L.score || 0) - 0.05, other: f })));
    }
  }
  // A saved wall opens on the wall you chose, if it still fits.
  const chosen = S.draft.chosen;
  if (chosen && chosen.inputKey === key) all = [chosen.layout, ...all.filter((L) => L.key !== chosen.layout.key)];
  S.view = { key, all, list: [], rankKey: null, counts, problems: problems.concat(r.problems.filter((p) => !problems.includes(p))) };
  // One more or one fewer from the open wall: open on the wall that keeps its frames, first in the list.
  if (S.stepBase) {
    const lead = all.filter((L) => (L.keeps || 0) >= 0.99).sort((a, b) => b.score - a.score)[0] || all[0];
    if (lead) { S.openKey = lead.key; S.view.hold = { key: lead.key, i: 0 }; }
    S.stepBase = null;
  }
  for (const L of all) remember(L);
}
function rank() {
  const v = S.view;
  const before = v.list.map((L) => L.key);
  v.list = rerank(v.all, { taste: rankTaste(), saved: S.draft.saved, skipped: S.draft.skipped, hung: S.draft.owned.filter((o) => o.at), want: S.draft.justMine ? [] : keptOwned().filter((o) => !o.loosen).map((o) => o.id), art: [...CATALOG, ...S.draft.owned], distinct: true });
  // A saved wall leads, the way it was left.
  const chosen = S.draft.chosen && v.all[0] && S.draft.chosen.layout.key === v.all[0].key ? v.list.findIndex((L) => L.key === v.all[0].key) : -1;
  if (chosen > 0) { const [c] = v.list.splice(chosen, 1); v.list.unshift(c); v.list.forEach((L, i) => { L.rank = i + 1; }); }
  if (v.hold) {
    const j = v.list.findIndex((L) => L.key === v.hold.key);
    if (j >= 0 && j !== v.hold.i) { const [h] = v.list.splice(j, 1); v.list.splice(Math.min(v.hold.i, v.list.length), 0, h); v.list.forEach((L, k) => { L.rank = k + 1; }); }
  }
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
  if (S.injected && S.injected.viewKey === v.key && !v.all.some((L) => L.key === S.injected.L.key)) { v.all = [S.injected.L, ...v.all]; v.rankKey = null; }
  if (v.rankKey !== rankKey()) rank();
  return v.list.find((L) => L.key === S.openKey) || v.all.find((L) => L.key === S.openKey) || v.list[0] || null;
}

// ---------- Versions: every wall you've had, so nothing is lost ----------

const wallSig = (L) => JSON.stringify(L.pieces.map((p) => [p.ref.id, Math.round(p.x), Math.round(p.y), p.w, p.h]).sort());
const sameWall = (a, b) => !!(a && b && wallSig(a) === wallSig(b));
// The wall on screen, kept before it changes. Dedups, so going back and forth never piles up.
function noteVersion(L) {
  if (!L || L.variant === 'asis') return;
  if (S.versions.some((v) => sameWall(v.L, L))) return;
  const id = `ver${Date.now().toString(36)}${S.versions.length}`;
  S.versions.push({ id, L: { ...bareLayout(L), key: L.key }, at: Date.now() });
  if (S.versions.length > 12) S.versions.shift();
  saveVersions();
}
function saveVersions() { if (S.draft && !S.draft.sample) S.draft.versions = S.versions.map((v) => ({ id: v.id, at: v.at, L: v.L })); }
function loadVersions() { S.versions = ((S.draft && S.draft.versions) || []).map((v) => ({ ...v })); }
// Bring a version back: the wall on screen is kept first.
function openVersion(id) {
  const v = S.versions.find((x) => x.id === id);
  if (!v) return;
  const now = shown();
  if (sameWall(now, v.L)) return;
  noteVersion(now);
  const L = { ...v.L, key: `${v.L.key}#${v.id}` };
  S.injected = { viewKey: viewKey(), L };
  S.openKey = L.key; S.selected = null; S.undo = null; S.edit = false; S.sheet = null;
  logE('version-back', { n: S.versions.length });
}
const versionLabel = (L) => `${L.pieces.length} piece${L.pieces.length === 1 ? '' : 's'}${L.variant === 'gallery' || L.family === 'gallery' ? ', loose' : ''}`;
function versionsRow(L) {
  const vs = S.versions;
  const cur = vs.find((v) => sameWall(v.L, L));
  const tiles = [...(cur ? [] : [{ id: 'now', L }]), ...vs.slice().reverse()];
  if (tiles.length < 2) return '';
  return `<div class="versions"><p class="sheet-label">Every version so far. Tap one to bring it back.</p>
    <div class="versions-row" role="group" aria-label="Versions of this wall">${tiles.map((v) => { const on = v.id === 'now' || v === cur; return `<button type="button" class="version" data-version="${esc(v.id)}" aria-pressed="${on}" aria-label="${on ? 'This version' : `Version with ${versionLabel(v.L)}`}"><span class="drawing small-drawing">${drawWall(v.L, 128, { still: true, label: versionLabel(v.L) })}</span><span class="version-label">${on ? 'Now' : esc(versionLabel(v.L))}</span></button>`; }).join('')}</div></div>`;
}
// A wall changed (swapped, moved): it replaces the one it came from.
function replaceWall(key, next) {
  const v = S.view;
  // The wall as it was first built, for "put it back".
  v.orig = v.orig || {};
  if (!v.orig[key]) { const was = v.all.find((L) => L.key === key); if (was) v.orig[key] = was; }
  v.all = v.all.map((L) => (L.key === key ? { ...next, key } : L));
  holdOpen(key);
  v.rankKey = null;
  S.openKey = key;
}
// Which wall was opened, and where it sat in the list.
function logWallOpen(key, how) {
  const i = S.view && S.view.list ? S.view.list.findIndex((L) => L.key === key) : -1;
  logE('wall-open', { wall: key, rank: i >= 0 ? i + 1 : null, of: S.view && S.view.list ? S.view.list.length : null, how });
}
// A wall you're changing keeps its place in the list while you change it.
function holdOpen(key) {
  const v = S.view;
  if (!v || !key) return;
  const i = v.list.findIndex((L) => L.key === key);
  if (i >= 0) v.hold = { key, i };
}
function toggleSave(id) {
  // With no wall yet (saving from Browse), the save is still yours.
  const d = S.draft || { saved: ME.saved, skipped: ME.skipped };
  if (route()[0] === 'wall' && S.view) holdOpen(S.openKey);
  const on = d.saved.includes(id);
  d.saved = on ? d.saved.filter((x) => x !== id) : [...d.saved, id];
  // Saving a piece you'd swapped away takes it off the swapped list.
  if (!on) d.skipped = d.skipped.filter((x) => x !== id);
  ME.saved = d.saved; ME.skipped = d.skipped; syncMe();
  logE(on ? 'unsave' : 'save', { id, from: route()[0] || 'home' });
  persist();
}
function toggleKeep(id) {
  const L = shown();
  const p = L && L.pieces.find((x) => x.ref.id === id);
  const list = S.draft.kept || [];
  const on = list.some((k) => k.id === id);
  S.draft.kept = on ? list.filter((k) => k.id !== id) : p ? [...list, { id: p.ref.id, w: p.w, h: p.h }] : list;
  logE('keep', { id, on: !on, wall: L ? L.key : null });
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
  const rects = moving.map((o) => ({ x: o.rect.x - m, y: o.rect.y - m, w: o.rect.w + 2 * m, h: o.rect.h + 2 * m }));
  const wall = p.auto && p.auto.wallRgb ? p.auto.wallRgb : null;
  for (const r of rects) paintOut(img, r, Math.round(2 * p.ppi), { wall, skip: rects });
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
  return `${bar(wordmark(), saved.length ? '<a class="btn quiet small" href="#/walls">Your walls</a>' : ME.saved.length ? '<a class="btn quiet small" href="#/saved">Saved</a>' : '')}
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
      <nav class="home-links" aria-label="More"><a href="#/community">Walls people hung</a><a href="#/browse">Every print</a><a href="#/saved">Saved${ME.saved.length ? ` (${ME.saved.length})` : ''}</a>${saved.length ? '<a href="#/walls">Your walls</a>' : ''}</nav>
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
    <p class="small pencil">Only you can see it. It stays on this device, and so does the photo reader: it downloads once while you pick a photo, about 30 MB, and runs right here.</p>
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
  // The ceiling sets the size only when the floor is in the photo too: floor to ceiling is the 8 ft.
  const seenOpts = { h: img.height, ceiling: !!(p.seen && p.seen.ceiling !== false && !p.seen.soffit && p.seen.floor !== false), floor: !(p.seen && p.seen.floor === false), depthFor: depth };
  const guess = guessWidth(items, img.width, tvInches, depth(tvInches), seenOpts);
  // The other things in the photo can say the TV is a different size than we took it as.
  if (guess && guess.tvWhy === 'others') { tvInches = guess.tvInches; tvWhy = 'others'; }
  p.auto = { items, rw: img.width, rh: img.height, wallRgb: labToRgb(found.wallColor), tvInches, tvWhy, tvPx, depth: depth(tvInches), guess, seenOpts: { h: seenOpts.h, ceiling: seenOpts.ceiling, floor: seenOpts.floor } };
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

// Frames come in standard sizes; most people know theirs. Picked here, typed below for anything else.
const STD_SIZES = [[5, 7], [8, 10], [11, 14], [12, 16], [16, 20], [18, 24], [20, 28], [24, 36], [8, 8], [12, 12], [16, 16], [20, 20]];
function sizePick(o) {
  const land = o.w > o.h;
  const cur = STD_SIZES.find(([a, b]) => (land ? o.w === b && o.h === a : o.w === a && o.h === b));
  return `<span class="size-pick"><label class="inline"><span>Frame size</span><select data-std="${esc(o.id)}">
    <option value=""${cur ? '' : ' selected'}>Other, typed below</option>
    ${STD_SIZES.map(([a, b]) => `<option value="${a}x${b}"${cur && cur[0] === a && cur[1] === b ? ' selected' : ''}>${land && a !== b ? `${b} x ${a}` : `${a} x ${b}`} in</option>`).join('')}
  </select></label>${o.w !== o.h ? `<button type="button" class="link" data-turn="${esc(o.id)}">Turn it ${land ? 'upright' : 'sideways'}</button>` : ''}</span>`;
}

// Keep: in every wall. Maybe: in a wall when it earns its place, left off when it doesn't. Skip: out.
const keepState = (o) => (o.keep === 'skip' ? 'skip' : o.loosen ? 'maybe' : 'must');
const KEEP_SEG = (o) => `<span class="seg" role="group" aria-label="Your ${esc(o.title)}">
  <button type="button" data-keep="must" data-oid="${esc(o.id)}" aria-pressed="${keepState(o) === 'must'}">Keep</button>
  <button type="button" data-keep="maybe" data-oid="${esc(o.id)}" aria-pressed="${keepState(o) === 'maybe'}">Maybe</button>
  <button type="button" data-keep="skip" data-oid="${esc(o.id)}" aria-pressed="${keepState(o) === 'skip'}">Skip</button></span>`;

const nextAfterCheck = () => (S.draft.taste && S.draft.taste.source === 'yours' ? '#/wall' : '#/taste');
function check() {
  if (need()) { go(need()); return ''; }
  const d = S.draft, p = d.photo;
  if (!p) { go('#/things'); return ''; }
  const auto = p.mode === 'auto' && p.auto;
  const H = d.height, s = labelSize(d.width, editPx());
  // Each box can be picked, then its corners dragged to resize it and its middle dragged to move it.
  const hr = s * 0.9; // handle radius, in wall inches at this size
  const handles = (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y], i) => `<g class="box-h" data-hcorner="${i}"><circle cx="${x}" cy="${y}" r="${hr * 2.2}" class="handle-hit"/><circle cx="${x}" cy="${y}" r="${hr}" class="handle-dot"/></g>`).join('');
  const sizeTag = (b, w, h) => `<text x="${b.x + b.w / 2}" y="${b.y + b.h + s * 1.1}" font-size="${s * 0.85}" class="box-size">${r2(w)} x ${r2(h)} in</text>`;
  const picked = S.ui.fix;
  const boxes = [
    ...d.obstacles.map((o) => { const b = { x: o.x, y: H - o.y - o.h, w: o.w, h: o.h }, on = picked === o.id; return `<g class="ob box${on ? ' is-picked' : ''}" data-box="${esc(o.id)}" data-kind="ob"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" class="ob-box"/>${o.w >= 8 ? `<text x="${o.x + o.w / 2}" y="${H - o.y - o.h / 2}" font-size="${s * 0.85}" class="ob-label">${esc(obName(o))}</text>` : ''}${on ? handles(b) + sizeTag(b, o.w, o.h) : ''}</g>`; }),
    ...d.owned.filter((o) => o.at).map((o) => { const b = { x: o.at.x, y: H - o.at.y - o.h, w: o.w, h: o.h }, on = picked === o.id; return `<g class="owned-mark box${o.keep === 'skip' ? ' is-skip' : ''}${on ? ' is-picked' : ''}" data-box="${esc(o.id)}" data-kind="own"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" class="owned-box-mark"/>${on ? handles(b) + sizeTag(b, o.w, o.h) : ''}</g>`; }),
  ].join('') + photoTopLine(d, s);
  const ft = (v) => Math.floor(v / 12), inch = (v) => Math.round(v % 12);
  const from = auto && p.auto.guess ? p.auto.guess.from : null;
  const why = { low: ' A 55 in one would put the ceiling under 7 ft.', high: ' A 55 in one would put the ceiling over 11 ft.', others: ' The other things in the photo say so.' }[p.auto && p.auto.tvWhy] || '';
  const guess = from === 'together' && p.auto.guess.why ? `${p.auto.guess.why} Measure the wall to be exact.` : NO_TAPE[from] ? `${NO_TAPE[from].why} Measure the wall to be exact.` : from === 'tv' ? `From your TV, taken as a ${p.auto.tvInches} in TV.${why} Measure the wall to be exact.` : from === 'measure' ? 'From your measurement.' : 'Measure the wall to be exact.';
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
          ${sizePick(o)}
          <span class="nums">${num(o, 'w', 'Wide', 'data-ok')}${num(o, 'h', 'Tall', 'data-ok')}</span>
          ${o.at ? '' : `<label class="btn quiet small file-btn">${o.thumb ? 'New photo of it' : 'Add a photo of it'}<input type="file" accept="image/*" data-art-photo="${esc(o.id)}"></label>`}
          <span class="fix-acts"><button type="button" class="link" data-remove-owned="${esc(o.id)}">Remove</button><button type="button" class="btn quiet small" data-fix="">Done</button></span>
        </span>` : `<button type="button" class="link" data-fix="${esc(o.id)}" aria-label="Fix your ${esc(o.title)}">Fix</button>`}</span>
      ${KEEP_SEG(o)}
    </li>`).join('');
  const obRows = d.obstacles.map((o) => `<li class="row">
      <span class="thumb"><span class="kind">${esc(obName(o).split(' ')[0])}</span></span>
      <span class="row-text"><span class="name">${esc(obName(o))}</span><span class="meta">${o.w} x ${o.h} in</span>
        ${fix === o.id ? `<span class="fix"><label class="inline"><span>It's a</span><select data-obkind="${esc(o.id)}">${OB_KINDS.map((k) => `<option value="${k}"${o.kind === k ? ' selected' : ''}>${esc(KIND_NAME[k])}</option>`).join('')}</select></label><span class="nums">${num(o, 'w', 'Wide', 'data-obk')}${num(o, 'h', 'Tall', 'data-obk')}${num(o, 'x', 'From left', 'data-obk')}${num(o, 'y', 'From floor', 'data-obk')}</span>
          <span class="fix-acts">${o.autoId && o.kind !== 'tv' ? `<button type="button" class="link" data-is-art="${esc(o.autoId)}">It's art</button>` : ''}<button type="button" class="link" data-remove-ob="${esc(o.id)}">Remove</button><button type="button" class="btn quiet small" data-fix="">Done</button></span></span>`
        : `<button type="button" class="link" data-fix="${esc(o.id)}" aria-label="Fix the ${esc(obName(o))}">Fix</button>`}</span>
    </li>`).join('');
  return `${bar(back('#/corners', 'Corners'))}
  <main class="page">
    <h1>Here's your wall</h1>
    <p class="lede">${esc(foundSentence(d))} Fix anything that's off, and say which of your pieces to keep.</p>
    ${S.ui.quality ? `<p class="note">${esc(S.ui.quality)}</p>` : ''}
    <div class="drawing photo-check" id="check-wall">${wallSvg({ wall: { width: d.width, height: H }, photo: p.flat, obstacles: [], extra: boxes, pxWide: editPx(), still: true, label: 'Your wall photo, flattened, with what we found marked' })}</div>
    <p class="small pencil">Tap a box to pick it. Drag a corner to resize it, or the middle to move it.</p>
    ${auto ? `<form id="dims-form" class="fields dims">
      <fieldset><legend>Wall width</legend>
        <span class="pair"><label><input type="number" inputmode="numeric" min="2" max="50" name="wft" value="${ft(d.width)}"> ft</label><label><input type="number" inputmode="numeric" min="0" max="11" name="win" value="${inch(d.width)}"> in</label></span>
        <span class="help">${esc(guess)}</span>${p.auto.guess && p.auto.guess.refs && p.auto.guess.refs.length > 1 && p.auto.guess.note ? `<span class="help${p.auto.guess.agree === false ? ' is-warn' : ''}">${esc(p.auto.guess.note)}</span>` : ''}${tvPick}</fieldset>
      <fieldset><legend>${p.seen && p.seen.soffit ? 'Height under the soffit' : 'Ceiling height'}</legend>
        <span class="pair"><label><input type="number" inputmode="numeric" min="6" max="20" name="hft" value="${ft(H)}"> ft</label><label><input type="number" inputmode="numeric" min="0" max="11" name="hin" value="${inch(H)}"> in</label></span>
        <span class="help">${p.auto.shownH && H > p.auto.shownH + 2 ? `Your photo shows the bottom ${esc(feet(p.auto.shownH))}. Check this.` : p.seen && p.seen.ceiling === false ? "The photo doesn't show the ceiling, so check this." : p.seen && p.seen.soffit ? 'From the floor up to the soffit. Art on this wall goes under it.' : `Your photo shows ${esc(feet(p.auto.shownH || H))} of wall.`}</span></fieldset>
    </form>` : `<p class="size-read">${esc(feet(d.width))} wide, ${esc(feet(H))} tall</p>`}
    ${S.ui.sizeErr ? `<p class="error">${esc(S.ui.sizeErr)}</p>` : ''}
    ${flashHtml()}
    <h2>Your art</h2>
    ${d.owned.length ? `<ul class="rows">${artRows}</ul>` : '<p class="pencil">We didn\'t find any art on this wall.</p>'}
    <div class="acts left"><button type="button" class="btn quiet small" data-act="add-not-up">Add art that isn't up yet</button><a class="btn quiet small" href="#/pieces">Mark art we missed</a></div>
    ${pastArtHtml()}
    <h2>In the way</h2>
    ${d.obstacles.length ? `<ul class="rows">${obRows}</ul>` : '<p class="pencil">Nothing in the way. A bare wall.</p>'}
    <div class="acts left"><a class="btn quiet small" href="#/things">Mark something we missed</a></div>
    <div class="dock"><a class="btn wide" href="${nextAfterCheck()}">${S.draft.taste.source === 'yours' ? 'Show me my wall' : 'Next: your taste'}</a></div>
  </main>`;
}

// ---------- The confirm screen: fix a box by dragging ----------

// A box on the flattened photo, in wall inches with y up from the floor:
// a piece of yours (at, w, h) or something in the way (x, y, w, h).
function boxOf(id) {
  const d = S.draft;
  const o = d.obstacles.find((x) => x.id === id);
  if (o) return { kind: 'ob', o, get: () => ({ x: o.x, y: o.y, w: o.w, h: o.h }), set: (b) => { o.x = b.x; o.y = b.y; o.w = b.w; o.h = b.h; } };
  const a = d.owned.find((x) => x.id === id && x.at);
  if (a) return { kind: 'own', o: a, get: () => ({ x: a.at.x, y: a.at.y, w: a.w, h: a.h }), set: (b) => { a.at = { x: b.x, y: b.y }; a.w = b.w; a.h = b.h; } };
  return null;
}
// A box read from the photo keeps its pixel box in step, so a later re-read
// (the TV size, a corner) starts from the fixed box, not the first guess.
function syncItem(box) {
  const d = S.draft, p = d.photo, a = p && p.auto;
  const o = box.o;
  if (!a || !o.autoId) return;
  const it = a.items.find((i) => i.id === o.autoId);
  if (!it) return;
  const rw = a.rw || p.w, rh = a.rh || a.floorPx, sc = d.width / rw;
  const k = it.kind === 'tv' && a.depth ? 1 / a.depth : 1;
  const b = box.get();
  it.w = b.w / (sc * k); it.h = b.h / sc;
  it.x = b.x / sc - (it.w * (1 - k)) / 2; it.y = rh - b.y / sc - it.h;
  it.fixed = true;
  if (box.kind === 'own' && S.mem.photo && rw) { try { Object.assign(it, thumbAndPalette(regionImg(), it)); o.thumb = it.thumb; o.palette = it.palette; o.color = it.palette && it.palette[0] ? it.palette[0].hex : o.color; } catch { /* keep the old thumb */ } }
  if (box.kind === 'own' && p.ppi) o.rect = { x: o.at.x * p.ppi, y: (d.height - o.at.y - o.h) * p.ppi, w: o.w * p.ppi, h: o.h * p.ppi };
  if (box.kind === 'ob' && o.fuzz) o.fuzz = 0; // fixed by hand: no longer a guess
}
function wireCheck() {
  const svg = document.querySelector('#check-wall svg');
  if (!svg) return;
  const d = S.draft, H = d.height, p = d.photo;
  const loupe = p && p.flat ? loupeFor(svg, p.flat, d.width, H) : null;
  const toPt = (b) => [b.x, H - b.y - b.h]; // top left, svg coordinates
  const paint = (box) => {
    const g = svg.querySelector(`[data-box="${CSS.escape(box.o.id)}"]`);
    if (!g) return;
    const b = box.get(), top = H - b.y - b.h;
    const r = g.querySelector('rect'); r.setAttribute('x', b.x); r.setAttribute('y', top); r.setAttribute('width', b.w); r.setAttribute('height', b.h);
    const lab = g.querySelector('.ob-label'); if (lab) { lab.setAttribute('x', b.x + b.w / 2); lab.setAttribute('y', top + b.h / 2); }
    const pts = [[b.x, top], [b.x + b.w, top], [b.x + b.w, top + b.h], [b.x, top + b.h]];
    g.querySelectorAll('.box-h').forEach((h, i) => h.querySelectorAll('circle').forEach((c) => { c.setAttribute('cx', pts[i][0]); c.setAttribute('cy', pts[i][1]); }));
    const t = g.querySelector('.box-size'); if (t) { t.setAttribute('x', b.x + b.w / 2); t.setAttribute('y', top + b.h + Number(t.getAttribute('font-size')) * 1.3); t.textContent = `${r2(b.w)} x ${r2(b.h)} in`; }
    const row = document.querySelector(`.row [data-oid="${CSS.escape(box.o.id)}"], .row [data-obid="${CSS.escape(box.o.id)}"]`);
    if (row) { const inW = document.querySelector(`input[data-ok="w"][data-oid="${CSS.escape(box.o.id)}"], input[data-obk="w"][data-obid="${CSS.escape(box.o.id)}"]`); const inH = document.querySelector(`input[data-ok="h"][data-oid="${CSS.escape(box.o.id)}"], input[data-obk="h"][data-obid="${CSS.escape(box.o.id)}"]`); if (inW) inW.value = r2(b.w); if (inH) inH.value = r2(b.h); }
  };
  dragOn(svg, (e) => {
    const g = e.target.closest('[data-box]');
    if (!g) return null;
    const id = g.dataset.box;
    if (S.ui.fix !== id) { S.ui.fix = id; render(); return null; } // first tap picks it; the next render has handles
    const box = boxOf(id);
    if (!box) return null;
    const h = e.target.closest('[data-hcorner]');
    const at = wallPoint(svg, e);
    return { box, corner: h ? Number(h.dataset.hcorner) : null, start: at, orig: box.get() };
  }, (ctx, e) => {
    const at = wallPoint(svg, e);
    const dx = at.x - ctx.start.x, dy = at.y - ctx.start.y, o = ctx.orig;
    let b;
    if (ctx.corner === null) b = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
    else {
      // Corner i: 0 top left, 1 top right, 2 bottom right, 3 bottom left (svg order); y is up from the floor.
      const left = ctx.corner === 0 || ctx.corner === 3, top = ctx.corner === 0 || ctx.corner === 1;
      const x0 = left ? o.x + dx : o.x, x1 = left ? o.x + o.w : o.x + o.w + dx;
      const y0 = top ? o.y : o.y + dy, y1 = top ? o.y + o.h + dy : o.y + o.h;
      b = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(2, Math.abs(x1 - x0)), h: Math.max(2, Math.abs(y1 - y0)) };
    }
    b.x = Math.max(0, Math.min(d.width - b.w, b.x)); b.y = Math.max(0, Math.min(H - b.h, b.y));
    for (const k of ['x', 'y', 'w', 'h']) b[k] = Math.round(b[k] * 4) / 4;
    ctx.box.set(b); ctx.moved = true; paint(ctx.box);
    if (loupe) { const [px, py] = ctx.corner === null ? [b.x + b.w / 2, H - b.y - b.h / 2] : [[b.x, H - b.y - b.h], [b.x + b.w, H - b.y - b.h], [b.x + b.w, H - b.y], [b.x, H - b.y]][ctx.corner]; loupe.show(e, [px, py]); }
  }, (ctx) => {
    if (loupe) loupe.hide();
    if (!ctx.moved) return;
    syncItem(ctx.box);
    if (ctx.box.kind === 'ob') clampOb(ctx.box.o);
    S.mem.clean = null; resetLayouts(); persist(); render();
  });
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
    <div class="photo-wrap">
      <svg id="corner-svg" viewBox="0 0 ${p.w} ${p.h}" data-w="${p.w}" data-h="${p.h}" class="photo-svg${err ? ' has-error' : ''}" role="group" aria-label="Wall photo with four corner handles">
        <image href="${p.src}" x="0" y="0" width="${p.w}" height="${p.h}"/>
        <polygon points="${c.map((x) => x.join(',')).join(' ')}" class="quad"/>
        ${c.map(([x, y], i) => `<g class="handle${(S.ui.corner || 0) === i ? ' is-picked' : ''}" data-corner="${i}" tabindex="0" role="button" aria-label="${names[i]} corner. Drag it, or use the arrow keys.">
          <circle cx="${x}" cy="${y}" r="${r * 2.2}" class="handle-hit"/><circle cx="${x}" cy="${y}" r="${r}" class="handle-dot"/></g>`).join('')}
      </svg>
    </div>
    <p class="${err ? 'error' : 'small pencil'}" id="corner-msg">${esc(err || S.ui.cornerErr || 'Drag a dot, and a close-up shows what is under your finger. Tap a dot, then nudge it.')}</p>
    <div class="nudge" id="nudge" role="group" aria-label="Nudge the selected corner">
      <span class="nudge-who" id="nudge-who">${esc(names[S.ui.corner || 0])} corner</span>
      <span class="nudge-pad">
        <button type="button" class="icon-btn" data-nudge="0,-1" aria-label="Up">↑</button>
        <button type="button" class="icon-btn" data-nudge="-1,0" aria-label="Left">←</button>
        <button type="button" class="icon-btn" data-nudge="1,0" aria-label="Right">→</button>
        <button type="button" class="icon-btn" data-nudge="0,1" aria-label="Down">↓</button>
      </span>
    </div>
    ${S.ui.quality || misses.length ? `<ul class="notes">${[S.ui.quality, ...misses].filter(Boolean).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
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
  // A door is the full 6 ft 8 in only when its bottom, the floor, is in the photo.
  if (door && door.h > a.rh * 0.4 && !(p.seen && p.seen.floor === false)) out.push(['door', Math.round((a.rw * 80) / door.h)]);
  const bed = biggest('headboard', 'w');
  if (bed && bed.w > a.rw * 0.15) out.push(['bed', Math.round((a.rw * 64) / bed.w)]);
  const couch = biggest('couch', 'w');
  if (couch && couch.w > a.rw * 0.2) out.push(['couch', Math.round((a.rw * 84) / couch.w)]);
  // Only when both the ceiling and the floor are in the photo; with the floor hidden, the bottom is a couch back, not the floor.
  if (p.seen && p.seen.ceiling !== false && !p.seen.soffit && p.seen.floor !== false) out.push(['ceiling', Math.round((96 * a.rw) / a.rh)]);
  const real = out.filter(([, W]) => W >= 36 && W <= 480);
  // Two or more things in the photo that agree on the size: offer that first, as one tap.
  const agree = together(real);
  return [...(agree ? [agree] : []), ...real, ['guess', 120]];
}
const NAMES = { door: 'the door', bed: 'the bed', couch: 'the couch', ceiling: 'an 8 ft ceiling' };
function together(opts) {
  if (opts.length < 2) return null;
  const ws = opts.map(([, W]) => W);
  if (Math.max(...ws) / Math.min(...ws) > 1.15) return null;
  const W = Math.round(Math.exp(ws.reduce((t, w) => t + Math.log(w), 0) / ws.length));
  const names = opts.map(([k]) => NAMES[k]);
  const list = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return ['together', W, { label: `Use ${feet(W)} wide`, why: `Worked out from ${list}, which agree on the size.`, sub: `${list[0].toUpperCase()}${list.slice(1)} agree on it.` }];
}
const noTapeInfo = (o) => o[2] || NO_TAPE[o[0]];

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
      ${opts[0][0] === 'together' ? `<div class="acts left together"><button type="button" class="btn" data-notape="together">${esc(opts[0][2].label)}</button><span class="help">${esc(opts[0][2].sub)}</span></div>` : ''}
      <div class="acts left">${opts.filter((o) => o[0] !== 'together').map((o) => `<button type="button" class="btn quiet small" data-notape="${o[0]}">${esc(noTapeInfo(o).label)}</button>`).join('')}</div>
    </section>` : ''}
  </main>`;
}

// ---------- Marking things by hand ----------

const OB_KINDS = ['couch', 'headboard', 'dresser', 'console', 'shelf', 'tv', 'lamp', 'plant', 'window', 'door', 'mirror', 'edge', 'outlet', 'switch', 'furniture'];
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
  // A corner or a step in the wall (a column, a bump-out): floor to ceiling, a hair wide.
  edge: (W) => ({ w: 1, h: S.draft.height, x: Math.round(W / 3), y: 0 }),
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
  const kinds = ['couch', 'headboard', 'dresser', 'console', 'tv', 'lamp', 'plant', 'window', 'door', 'edge', 'outlet', 'switch'];
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
        ${sizePick(o)}
        <span class="nums"><label class="num"><span>Wide</span><span class="num-in"><input type="number" step="0.5" min="2" data-ok="w" data-oid="${esc(o.id)}" value="${o.w}"> in</span></label><label class="num"><span>Tall</span><span class="num-in"><input type="number" step="0.5" min="2" data-ok="h" data-oid="${esc(o.id)}" value="${o.h}"> in</span></label>
        ${o.thumb ? '' : `<label class="num"><span>Main color</span><input type="color" data-ok="color" data-oid="${esc(o.id)}" value="${esc(o.color || '#8A8F94')}"></label>`}</span>
        ${o.at ? '' : `<label class="btn quiet small file-btn">${o.thumb ? 'New photo of it' : 'Add a photo of it'}<input type="file" accept="image/*" data-art-photo="${esc(o.id)}"></label>`}
      </span>
      <span class="row-side">${KEEP_SEG(o)}<button type="button" class="link" data-remove-owned="${esc(o.id)}">Remove</button></span>
    </li>`).join('')}</ul>` : ''}
    <div class="acts left"><button type="button" class="btn quiet small" data-act="add-piece">${photo ? "Add art that isn't up yet" : 'Add a piece'}</button></div>
    ${pastArtHtml()}
    ${flashHtml()}
    <div class="acts end"><a class="btn" href="${d.photo ? '#/check' : nextAfterCheck()}">${d.photo ? 'Done' : d.owned.length ? 'Show me my wall' : 'Nothing yet, show me my wall'}</a></div>
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

// The same pairs for the same wall, so a reload doesn't reshuffle the test.
const quizSeed = () => { let h = 7; for (const ch of String(S.draft && S.draft.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return (h % 9973) + 1; };

// What the test learned, in words you can correct.
function profileScreen() {
  if (need()) { go(need()); return ''; }
  const prof = profileNow();
  const corr = new Map(((S.draft.taste && S.draft.taste.corrections) || []).map((c) => [c.axis, c.lean]));
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  const rows = AXES.map((a) => {
    const x = prof && prof.axes.find((y) => y.axis === a.axis);
    const now = x && x.words ? x.words : null;
    const picked = corr.has(a.axis) ? (corr.get(a.axis) === null ? 'none' : corr.get(a.axis)) : now || 'none';
    const opt = (val, label) => `<option value="${esc(val)}"${picked === val ? ' selected' : ''}>${esc(label)}</option>`;
    return `<li class="row axis-row"><label class="row-text" for="axis-${a.axis}"><span class="name">${esc(cap(a.low))} or ${esc(a.high)}</span>
      <span class="meta">${corr.has(a.axis) ? 'You set this.' : x && x.sure >= 0.55 ? 'From your picks.' : 'Not sure yet.'}</span></label>
      <select id="axis-${a.axis}" data-axis="${a.axis}">${opt('none', 'Either')}${opt(a.low, cap(a.low))}${opt(a.high, cap(a.high))}</select></li>`;
  }).join('');
  return `${bar(back('#/wall', 'Your wall'))}
  ${stepBar(1)}
  <main class="page">
    <h1>What we learned</h1>
    <p class="lede">${esc(prof ? prof.summary : 'No lean yet: pick a few pairs and this fills in.')}</p>
    ${prof && prof.picks < 14 ? `<p class="pencil small">From ${prof.picks} pick${prof.picks === 1 ? '' : 's'}. About 14 gives every line a word; each pick adds to the ones before.</p>` : prof ? `<p class="pencil small">From ${prof.picks} picks. More picks keep sharpening it.</p>` : ''}
    <p class="pencil small">Wrong about something? Set it here and every wall ranks for it.</p>
    <ul class="rows">${rows}</ul>
    <div class="acts left"><a class="btn" href="#/wall">Show my wall</a><a class="btn quiet" href="#/taste">Pick more pairs</a></div>
  </main>`;
}

function taste() {
  if (need()) { go(need()); return ''; }
  if (!S.quiz) S.quiz = restoreQuiz();
  if (!S.quiz) {
    const shownIds = new Set();
    const before = S.draft.taste && S.draft.taste.source === 'yours' ? picksOf(S.draft.taste.picks) : [];
    for (const x of before) { shownIds.add(x.winner.id); shownIds.add(x.loser.id); }
    S.quiz = { picks: before, shown: shownIds, n: 0, pair: nextAxisPair(CATALOG, before, shownIds, { seed: quizSeed() }) };
  }
  const q = S.quiz;
  const [a, b] = q.pair;
  const card = (it) => `<button type="button" class="pick" data-pick="${esc(it.id)}" aria-label="${esc(it.title)}"><span class="pick-art" style="aspect-ratio:${it.aspect || 0.8}"><img src="${it.imageData}" alt=""></span><span class="pick-name">${esc(it.title)}</span></button>`;
  const before = q.picks.length - q.n;
  const fresh = q.n === 0 && !q.picks.length;
  return `${bar(back(S.draft.photo ? '#/check' : '#/things', 'Your wall'), `<span class="count">${q.n + 1} of ${QUIZ_LENGTH}${before > 0 ? `, ${before} picked before` : ''}</span>`)}
  ${stepBar(1)}
  <main class="page quiz">
    ${fresh ? '<p class="lede">About a minute of pairs, and every wall ranks for your taste. Or <a href="#/wall">skip this for now</a>.</p>' : ''}
    <h1>Which would you rather have on your wall?</h1>
    <div class="pair-picks">${card(a)}${card(b)}</div>
    <div class="acts left">
      <button type="button" class="btn quiet small" data-act="quiz-skip">Neither, show me another two</button>
      ${q.n >= 3 ? '<button type="button" class="btn quiet small" data-act="quiz-done">That\'s enough, show my walls</button>' : fresh ? '' : '<a class="link" href="#/wall">Skip for now</a>'}
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
  const was = S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste.corrections || [] : [];
  if (q && q.picks.length) S.draft.taste = { source: 'yours', weights: fitTaste(q.picks), picks: q.picks.map((x) => [x.winner.id, x.loser.id]), corrections: was };
  S.quiz = null;
  S.draft.quizState = null;
  resetLayouts();
  persist();
  go(S.draft.taste.source === 'yours' ? '#/profile' : '#/wall');
}
function advanceQuiz(picked) {
  const q = S.quiz;
  q.pair.forEach((it) => q.shown.add(it.id));
  if (picked) q.n++;
  const next = q.n < QUIZ_LENGTH ? nextAxisPair(CATALOG, q.picks, q.shown, { seed: quizSeed() + q.n }) : null;
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
  const p = v.problems.find((x) => x.code !== 'FAMILY_SKIPPED' && x.code !== 'ALL_SHOWN' && x.code !== 'LEFT_OUT');
  return `${bar(back('#/', 'Walldrobe'), '<button type="button" class="btn quiet small" data-act="adjust">Adjust</button>')}
  ${stepBar(2)}
  <main class="page">
    <div class="drawing">${drawWall(null, pxNow(), { still: true })}</div>
    <h1 class="why">There isn't room for art on this wall.</h1>
    <p class="lede">${esc(p ? p.message : '')} Not every wall needs art.</p>
    <div class="acts left"><a class="btn" href="${d.photo ? '#/check' : '#/things'}">Check what's marked</a><a class="btn quiet" href="#/new">Try another wall</a></div>
  </main>${sheetHtml()}`;
}

// Building the list takes a moment on a phone: say so, with the bare wall, then build.
function building() {
  if (S.view && S.view.key === viewKey()) return S.view.failed ? brokeScreen() : '';
  if (!S.building) {
    S.building = true;
    setTimeout(() => {
      try { run(); } catch (e) { console.error(e); S.view = { key: viewKey(), all: [], list: [], rankKey: rankKey(), problems: [], failed: true }; }
      S.building = false; render();
      if (S.focusAfter) { const f = document.querySelector(S.focusAfter); S.focusAfter = null; if (f) f.focus({ preventScroll: true }); }
    }, 40);
  }
  return `${bar(wordmark())}<main class="feed-page" aria-busy="true">
    <div class="drawing is-waiting">${drawWall(null, pxNow(), { still: true })}</div>
    <p class="count">Finding every wall that fits…</p>
  </main>`;
}
function suggestScreen() {
  if (need()) { go(need()); return ''; }
  const wait = building();
  if (wait) return wait;
  const v = run();
  const now = shown();
  if (!v.list.length) return noWalls(v);
  const d = S.draft;
  const px = pxNow();
  const note = v.problems.find((x) => x.code === 'LEFT_OUT');
  const kept = keptSet();
  const items = v.list.map((L, i) => `<li class="entry">
    <a class="entry-link" href="#/wall" data-wall="${esc(L.key)}" aria-label="Wall ${i + 1} of ${v.list.length}. ${esc(whyText(L))}">
      <span class="drawing">${drawWall(L, px, { still: true, label: `Wall ${i + 1}` })}${d.sample ? '<span class="chip">Sample wall</span>' : ''}</span>
      <span class="count">${i + 1} of ${v.list.length}${sameWall(L, now) ? ' <span class="has-saved">· the one you have now</span>' : L.pieces.some((p) => d.saved.includes(p.ref.id)) ? ' <span class="has-saved">· has a piece you saved</span>' : ''}</span>
      <span class="why">${esc(whyText(L))}</span>
      <span class="cost">${esc(costShort(L))}</span>
    </a>
  </li>`).join('');
  return `${bar(back('#/wall', 'Your wall'), '<button type="button" class="btn quiet small" data-act="adjust" aria-haspopup="dialog">Adjust</button>')}
  ${stepBar(2)}
  <main class="feed-page">
    <h1>Suggestions</h1>
    <p class="lede">Every wall that fits, best first${kept.size ? `, each with the ${kept.size === 1 ? 'piece' : `${kept.size} pieces`} you keep` : ''}. Tap one to make it your wall; the one you have now is kept as a version.</p>
    ${note ? `<p class="note">${esc(note.message)}</p>` : ''}
    ${S.undo ? `<p class="undo">${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button></p>` : ''}
    ${flashHtml()}
    <ol class="feed">${items}</ol>
    <p class="feed-end pencil">That's every wall that fits. <button type="button" class="link" data-act="adjust">Adjust how full, how many, or which art</button></p>
  </main>${sheetHtml()}`;
}

// Your wall: the one you're building. Tap a piece to keep, swap or let it go; every
// version stays under the drawing; Suggestions and Adjust are one tap away.
function wallScreen() {
  if (need()) { go(need()); return ''; }
  const wait = building();
  if (wait) return wait;
  const v = run();
  if (!v.list.length && !v.all.length) return noWalls(v);
  const d = S.draft;
  const L = shown();
  if (!L) return noWalls(v);
  S.openKey = L.key;
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
    const state = own ? (p.role === 'pinned' ? 'Yours, stays put' : o && o.loosen ? 'Yours, maybe' : 'Yours') : kept.has(p.ref.id) ? 'Kept' : 'New';
    const meta = own ? `${p.w} x ${p.h} in. ${moveNote(p)}` : `${p.w} x ${p.h} in${c && c.price != null ? `, ${money(c.price, c.currency)} at ${esc(item.source)}` : item.offers.length ? `, at ${esc(item.source)}` : `, free photo on ${esc(item.source)}`}`;
    const saved = d.saved.includes(p.ref.id);
    return `<li class="row piece-row">
      <button type="button" class="row-open" data-piece="${esc(p.ref.id)}" aria-haspopup="dialog">${thumb}<span class="row-text"><span class="name">${esc(own ? `Your ${p.title}` : item.title)} <span class="state${kept.has(p.ref.id) ? ' is-kept' : ''}">${state}</span></span><span class="meta">${meta}</span><span class="reason">${esc(cleanReason(p.reason))}</span></span></button>
      ${own ? '' : `<button type="button" class="heart" data-save="${esc(p.ref.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Saved' : 'Save'} ${esc(item.title)}">${heart(saved)}</button>`}
    </li>`;
  }).join('');
  const total = wallCost(L);
  return `${bar(back('#/', 'Walldrobe'), '<a class="btn quiet small" href="#/suggest">Suggestions</a>')}
  ${stepBar(2)}
  <main class="wall-page">
    <div class="wall-main">
    <div class="drawing-wrap${S.edit ? ' is-editing' : ''}" id="drawing-wrap">
      <div class="drawing" id="drawing">${drawWall(L, pxNow(), { selected: S.selected, measure: S.measure || S.edit, label: 'Your wall' })}${d.sample ? '<span class="chip">Sample wall</span>' : ''}</div>
    </div>
    ${S.edit ? editBar(L) : ''}
    ${S.undo ? `<p class="undo">${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button></p>` : ''}
    ${flashHtml()}
    ${legend(L)}
    <h1 class="why">${esc(whyText(L))}</h1>
    <p class="cost">${esc(costShort(L))}</p>
    ${breaksNote(L)}
    <div class="acts left">
      <a class="btn" href="#/frames">${L.pieces.some((p) => p.ref.source === 'catalog') ? 'Frames next' : 'Hang it next'}</a>
      <button type="button" class="btn quiet" data-act="adjust" aria-haspopup="dialog">Adjust</button>
    </div>
    <p class="pencil small">Tap a piece below to keep it, swap it or let it go. Suggestions, top right, has every other wall that fits.</p>
    ${versionsRow(L)}
    </div>
    <section class="wall-side" aria-labelledby="in-h">
    <h2 id="in-h">In this wall</h2>
    <ul class="rows">${rows}</ul>
    ${L.left && L.left.length ? `<p class="pencil small">Left off this wall: ${L.left.map((l) => `your ${esc(l.title)}`).join(', ')}. ${esc(L.left[0].reason)}</p>` : ''}
    </section>
  </main>${sheetHtml()}`;
}
// The wall as it hangs now is shown even when it breaks a rule; say which, plainly.
function breaksNote(L) {
  const hard = (L.breaks || []).filter((b) => b.hard);
  if (L.variant !== 'asis' || !hard.length) return '';
  const first = hard.slice(0, 2).map((b) => b.message).filter(Boolean);
  return `<p class="note">This is how it hangs now. ${hard.length === 1 ? 'One spot is' : `${hard.length} spots are`} closer than we'd hang art${first.length ? `: ${esc(first.join('; '))}` : ''}.</p>`;
}

// Where a piece of yours goes in this wall, against where it hangs now.
function moveNote(p) {
  const o = S.draft.owned.find((x) => x.id === p.ref.id);
  if (p.role === 'pinned') return 'Stays where it hangs.';
  if (!o || !o.at) return 'Not up yet: hang it here.';
  const dx = p.x - o.at.x, dy = p.y - o.at.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 'Stays where it hangs now.';
  const bits = [];
  if (Math.abs(dx) >= 1) bits.push(`${inches(Math.round(Math.abs(dx) * 4) / 4)} ${dx > 0 ? 'right' : 'left'}`);
  if (Math.abs(dy) >= 1) bits.push(`${inches(Math.round(Math.abs(dy) * 4) / 4)} ${dy > 0 ? 'higher' : 'lower'}`);
  return `Moves ${bits.join(' and ')}: take it down and rehang it.`;
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

// ---------- Adjust: everything that changes which walls are made, one sheet ----------

const KINDS = [[null, 'Any kind'], ['structured', 'Structured: edges and rows line up'], ['gallery', 'Loose: a gallery wall']];
const ARTS = [['prints', 'Shop prints'], ['photos', 'Free photos you print'], ['both', 'Both']];
const FULLS = [['calm', 'Calm: fewer, bigger pieces'], ['balanced', 'Balanced'], ['full', 'Full: more pieces, less bare wall']];
const SHOP_PICK = [['any', 'Every shop'], ['desenio', 'Desenio only'], ['houseofspoils', 'House of Spoils only'], ['free', 'Free photos only']];
const shopPick = () => { const f = pool(); const left = ['desenio', 'houseofspoils', 'free'].filter((k) => !f.shops.includes(k)); return left.length === 1 ? left[0] : 'any'; };
function adjustSheet() {
  const d = S.draft;
  const onWall = route()[0] === 'wall';
  const L = onWall ? shown() : null;
  const f = pool();
  const counts = (S.view && S.view.counts) || [];
  const n = d.pieces || (L ? L.pieces.length : null);
  const fewer = n ? counts.filter((c) => c < n).pop() : null, more = n ? counts.find((c) => c > n) : counts[0];
  const sel = (attr, pairs, cur, label) => `<label class="field-row"><span>${esc(label)}</span><select data-adjust="${attr}">${pairs.map(([v, l]) => `<option value="${v == null ? '' : esc(String(v))}"${(cur == null ? '' : String(cur)) === (v == null ? '' : String(v)) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const arts = [...ARTS, ...(keptOwned().length ? [['mine', 'Just my pieces']] : [])];
  const asIs = S.view && S.view.list.find((x) => x.variant === 'asis');
  const wallActs = [
    onWall && L && !d.justMine && L.pieces.some((p) => p.ref.source === 'catalog' && !keptSet().has(p.ref.id)) ? `<button type="button" class="sheet-item" data-act="refresh"${S.busy ? ' disabled' : ''}>New art in the open frames</button>` : '',
    onWall && L && L.pieces.some(movable) ? `<button type="button" class="sheet-item" data-act="edit">${S.edit ? 'Done moving' : 'Move pieces by hand'}</button>` : '',
    onWall ? `<button type="button" class="sheet-item" data-act="measure">${S.measure ? 'Hide measurements' : 'Show measurements'}</button>` : '',
    onWall && L && S.view.orig && S.view.orig[L.key] ? '<button type="button" class="sheet-item" data-act="put-back">Put it back as it was built</button>' : onWall && L && L.history && L.history.length ? '<button type="button" class="sheet-item" data-act="undo-all">Put the pieces back</button>' : '',
    asIs && (!onWall || asIs.key !== (L && L.key)) ? `<a class="sheet-item" href="#/wall" data-wall="${esc(asIs.key)}">See it as it hangs now</a>` : '',
  ].filter(Boolean).map((x) => `<li>${x}</li>`).join('');
  return `<h2 id="sheet-h">Adjust</h2>
    <p class="pencil small">Any change here builds the walls again. The one you have now stays as a version.</p>
    <div class="fields">
      <div class="field-row"><span>How many pieces</span><span class="stepper" role="group" aria-label="How many pieces">
        <button type="button" class="icon-btn" data-count="${fewer || ''}" aria-label="One fewer"${fewer && !S.busy ? '' : ' disabled'}>−</button>
        <span class="step-n">${n ? `${n}` : 'Any'}</span>
        <button type="button" class="icon-btn" data-count="${more || ''}" aria-label="One more"${more && !S.busy ? '' : ' disabled'}>+</button>
      </span>${d.pieces ? '<button type="button" class="link" data-count="any">Any number</button>' : ''}</div>
      ${sel('fullness', FULLS, d.fullness || 'balanced', 'How full')}
      ${sel('style', KINDS, d.style || null, 'Kind of wall')}
      ${sel('art', arts, d.justMine ? 'mine' : artMode(), 'Which art')}
      ${d.justMine ? '' : `${sel('people', [['any', 'Fine'], ['none', 'Leave them out']], f.people, 'People in the art')}
      ${artMode() !== 'photos' ? sel('maxPrice', PRICES, f.maxPrice, 'Price per print') : ''}
      ${sel('color', [['any', 'Any'], ['color', 'Color only'], ['bw', 'Black and white only']], f.color, 'Color')}
      ${artMode() === 'both' ? sel('shop', SHOP_PICK, shopPick(), 'From') : ''}`}
    </div>
    ${wallActs ? `<p class="sheet-label">This wall</p><ul class="sheet-list">${wallActs}</ul>` : ''}
    <nav class="sheet-links" aria-label="Go to">
      <a href="${d.photo ? '#/check' : '#/things'}">Fix what's marked</a><a href="#/taste">Taste test</a>${d.taste && d.taste.source === 'yours' ? '<a href="#/profile">What we learned</a>' : ''}<a href="#/new">New wall</a>
    </nav>`;
}

// ---------- Refresh the art: the same walls, new picks ----------

// New art in every frame that isn't kept or yours: the open wall, or every wall
// in the list from the feed. Layouts stay; only the picks change.
function refreshArt() {
  if (route()[0] !== 'wall') { refreshAll(); return; }
  const L = shown();
  if (!L) return;
  noteVersion(L);
  const input = engineInput();
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog' && !keptSet().has(p.ref.id)).map((p) => p.ref.id);
  if (!fresh.length) { S.flash = 'Every piece here is kept or yours, so there is nothing to refresh.'; return; }
  const exclude = [...new Set([...(S.seen.get(L.key) || []), ...fresh])].filter((x) => !keptSet().has(x));
  let r = refill({ ...input, keep: keepList(), exclude }, L, {});
  if (!r.layouts.length) r = refill({ ...input, keep: keepList(), exclude: fresh }, L, {});
  if (!r.layouts.length) { S.flash = r.problems[0] ? r.problems[0].message : 'No other art fits these frames.'; return; }
  const prev = L;
  const next = { ...r.layouts[0], history: L.history, moved: L.moved };
  replaceWall(L.key, next); remember(next);
  logE('refresh', { wall: L.key, n: fresh.length });
  S.ui.saved = null; persist();
  S.undo = { label: `New art in ${fresh.length === 1 ? 'the one open frame' : `all ${fresh.length} frames`}.`, run: () => { replaceWall(prev.key, prev); persist(); } };
}
function refreshAll() {
  const v = S.view;
  if (!v) return;
  const input = engineInput();
  const before = v.all;
  let n = 0;
  v.all = v.all.map((L) => {
    const fresh = L.pieces.filter((p) => p.ref.source === 'catalog' && !keptSet().has(p.ref.id)).map((p) => p.ref.id);
    if (!fresh.length || L.variant === 'asis') return L;
    const exclude = [...new Set([...(S.seen.get(L.key) || []), ...fresh])].filter((x) => !keptSet().has(x));
    let r;
    try { r = refill({ ...input, keep: keepList(), exclude }, L, {}); if (!r.layouts.length) r = refill({ ...input, keep: keepList(), exclude: fresh }, L, {}); } catch { return L; }
    if (!r.layouts.length) return L;
    n++;
    const next = { ...r.layouts[0], key: L.key, history: L.history, moved: L.moved };
    remember(next);
    return next;
  });
  // Same walls in the same order: only the picks changed.
  const byKey = new Map(v.all.map((L) => [L.key, L]));
  v.list = v.list.map((L) => byKey.get(L.key) || L); v.rankKey = rankKey();
  if (!n) { S.flash = 'Every piece here is kept or yours, so there is nothing to refresh.'; return; }
  logE('refresh', { wall: null, n });
  S.ui.saved = null; persist();
  const list = v.list;
  S.undo = { label: `New art on ${n === 1 ? 'one wall' : `${n} walls`}, same layouts.`, run: () => { const was = new Map(before.map((L) => [L.key, L])); v.all = before; v.list = list.map((L) => was.get(L.key) || L); v.rankKey = rankKey(); persist(); } };
}

// ---------- Sheets ----------

function sheetHtml() {
  if (!S.sheet) return '';
  const body = S.sheet === 'adjust' ? adjustSheet() : S.sheet === 'share' ? shareSheet() : S.sheet.frame ? frameSheet(S.sheet.frame) : S.sheet.piece ? pieceSheet(S.sheet.piece) : S.sheet.browse ? browseSheet(S.sheet.browse) : '';
  if (!body) return '';
  return `<div class="backdrop" data-act="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h" id="sheet">
    <button type="button" class="icon-btn sheet-x" data-act="close-sheet" aria-label="Close">×</button>
    ${body}
  </div>`;
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
      <p class="meta">${p.w} x ${p.h} in. ${moveNote(p)}</p>
      <p>${esc(cleanReason(p.reason))}</p>
      <p class="nail-line">${p.role === 'pinned' ? 'Already up.' : `Nail ${esc(inches(p.nail.y))} up, ${esc(inches(p.nail.x))} from the left end.`}</p>
      ${o ? KEEP_SEG(o) : ''}
      <p class="pencil small">Keep: in every wall. Maybe: in a wall when it earns its place. Skip: out.</p>
      <div class="acts left">
        ${o && o.at ? `<button type="button" class="btn quiet" data-pin="${esc(id)}">${p.role === 'pinned' ? 'Let it move' : 'Pin it where it hangs'}</button>` : ''}
      </div>`;
  }
  const item = byId.get(id);
  const c = item.offers && item.offers.length ? offersAt(item, p.w, p.h).main : null;
  const saved = d.saved.includes(id), kept = keptSet().has(id);
  return `<div class="piece-sheet"><h2 id="sheet-h">${esc(item.title)}</h2>
    <p class="meta">${p.w} x ${p.h} in${c && c.price != null ? `, ${money(c.price, c.currency)}` : ''}. ${esc(cleanReason(p.reason))}</p>
    <div class="acts left">
      <button type="button" class="btn${kept ? '' : ' quiet'}" data-act="keep" data-id="${esc(id)}" aria-pressed="${kept}">${kept ? 'Kept, in every wall' : 'Keep it'}</button>
      <button type="button" class="btn quiet" data-act="letgo" data-id="${esc(id)}"${kept || S.busy ? ' disabled' : ''}>Let it go</button>
      <button type="button" class="btn quiet" data-save="${esc(id)}" aria-pressed="${saved}">${heart(saved)} ${saved ? 'Saved' : 'Save for later'}</button>
    </div>
    ${kept ? '<p class="pencil small">Kept: it is in every suggestion. Tap Kept to let it change again.</p>' : swapRow(id)}
    <div class="sheet-art"><span class="art-big" style="aspect-ratio:${item.aspect || p.w / p.h}"><img src="${item.imageData}" alt="${esc(item.title)}"></span></div>
    <p class="meta">${item.offers && item.offers.length ? `Art by ${esc(item.artist)}, sold by ${esc(item.source)}` : `Photo by ${esc(item.artist)} on ${esc(item.source)}`}${item.record && item.record.description ? `. ${esc(item.record.description)}` : ''}.</p>
    ${sizeRow(item, p)}
    <p class="nail-line">Nail ${esc(inches(p.nail.y))} up, ${esc(inches(p.nail.x))} from the left end.</p>
    ${c && c.url ? `<a class="btn quiet small fit" href="${esc(c.url)}" target="_blank" rel="noopener">See it at ${esc(item.source)}</a>` : item.url ? `<a class="btn quiet small fit" href="${esc(item.url)}" target="_blank" rel="noopener">See it on ${esc(item.source)}</a>` : ''}</div>`;
}

// Other art for this spot, at this size, picked for the rest of the wall. Found when
// the sheet opens; tapping one swaps it in and keeps the wall you had as a version.
function swapOptions(id, L) {
  const input = engineInput();
  const seen = [...(S.seen.get(L.key) || [])].filter((x) => x !== id && !keptSet().has(x));
  const out = [];
  const exclude = new Set([...seen, id]);
  for (let i = 0; i < 4; i++) {
    let r;
    try { r = refill({ ...input, keep: keepList(), exclude: [...exclude] }, L, { swap: id }); } catch { break; }
    if (!r.layouts.length) break;
    const next = r.layouts[0];
    const came = next.pieces.find((p) => p.ref.source === 'catalog' && !L.pieces.some((q) => q.ref.id === p.ref.id));
    if (!came) break;
    out.push({ L: next, came });
    exclude.add(came.ref.id);
  }
  return out;
}
function swapRow(id) {
  const alts = (S.sheet && S.sheet.piece === id && S.sheet.alts) || [];
  if (!alts.length) return '<p class="pencil small">No other art comes in this size for this spot.</p>';
  return `<p class="sheet-label">Swap it for</p><div class="alts" role="group" aria-label="Swap it for">${alts.map((a, i) => { const it = byId.get(a.came.ref.id); return `<button type="button" class="alt" data-alt="${i}" data-id="${esc(id)}" aria-label="Swap for ${esc(it.title)}"${S.busy ? ' disabled' : ''}><span class="alt-art" style="aspect-ratio:${it.aspect || a.came.w / a.came.h}"><img src="${it.imageData}" alt=""></span><span class="alt-name">${esc(it.title)}</span></button>`; }).join('')}</div>`;
}
// Take a piece off the wall: one fewer, built again around the frames that stay.
function letGo(id) {
  const L = shown();
  if (!L) return;
  const n = L.pieces.length - 1;
  if (n < 1) { S.flash = 'That is the last piece. Pick another wall from Suggestions instead.'; return; }
  noteVersion(L);
  const d = S.draft;
  const prev = { pieces: d.pieces, skipped: d.skipped, chosen: d.chosen ? clone(d.chosen) : null, open: S.openKey, base: S.stepBase };
  if (!d.skipped.includes(id)) { d.skipped = [...d.skipped, id]; ME.skipped = d.skipped; syncMe(); }
  S.stepBase = L.pieces.filter((p) => p.role !== 'pinned' && p.ref.id !== id).map((p) => (p.slot ? { ...p.slot } : { x: p.x, y: p.y, w: p.w, h: p.h }));
  d.pieces = n; d.chosen = null; S.openKey = null;
  const item = byId.get(id);
  logE('letgo', { id, wall: L.key, to: n });
  S.undo = { label: `${item ? item.title : 'That piece'} is out. ${n} piece${n === 1 ? '' : 's'} now.`, run: () => { d.pieces = prev.pieces; d.skipped = prev.skipped; ME.skipped = d.skipped; syncMe(); d.chosen = prev.chosen; S.openKey = prev.open; S.stepBase = null; S.injected = null; persist(); } };
  persist();
}

// The sizes a piece comes in, as buttons; the one on the wall is pressed. Picking
// another keeps the piece in every wall at that size and builds the walls again.
function sizeRow(item, p) {
  const by = new Map();
  const list = item.offers && item.offers.length ? item.offers.filter((o) => o.w) : (item.sizes || []);
  for (const o of list) { const k = `${o.w}x${o.h}`; if (!by.has(k) || (o.price != null && (by.get(k).price == null || o.price < by.get(k).price))) by.set(k, { w: o.w, h: o.h, price: o.price, currency: o.currency }); }
  const sizes = [...by.values()].sort((a, b) => a.w * a.h - b.w * b.h);
  if (sizes.length < 2) return '';
  return `<div class="sizes" role="group" aria-label="Size">${sizes.map((z) => `<button type="button" class="size-btn" data-size="${z.w}x${z.h}" data-id="${esc(item.id)}" aria-pressed="${(z.w === p.w && z.h === p.h) || (z.w === p.h && z.h === p.w)}"${S.busy ? ' disabled' : ''}>${z.w} x ${z.h}${z.price != null ? `<span class="size-price">${esc(money(z.price, z.currency))}</span>` : ''}</button>`).join('')}</div>`;
}
function saveThisWall() {
  const L = shown();
  S.draft.chosen = L ? { layout: bareLayout(L), inputKey: viewKey() } : null;
  const ok = store.saveWall(S.draft) && persist();
  if (ok) { S.ui.saved = S.draft.id; S.flash = store.demoMode ? 'Sample mode: nothing is saved.' : 'Saved on this device. Find it under Your walls.'; }
  else S.flash = "Didn't save. This device's storage may be full. Try again after deleting an old wall.";
}

// ---------- Saved: the pieces you hearted, apart from any wall ----------

// The sizes a piece comes in, with the shop's price at each, in one line.
function sizesLine(item) {
  if (item.offers && item.offers.length) {
    const by = new Map();
    for (const o of item.offers) {
      if (!o.w) continue;
      const k = `${Math.min(o.w, o.h)}x${Math.max(o.w, o.h)}`;
      const cur = by.get(k);
      if (!cur || (o.price != null && (cur.price == null || o.price < cur.price))) by.set(k, { w: Math.min(o.w, o.h), h: Math.max(o.w, o.h), price: o.price, currency: o.currency });
    }
    const list = [...by.values()].sort((a, b) => a.w * a.h - b.w * b.h);
    if (!list.length) return `At ${item.source}.`;
    return `${list.length === 1 ? 'One size' : `${list.length} sizes`} at ${item.source}: ${list.map((z) => `${z.w} x ${z.h} in${z.price != null ? ` ${money(z.price, z.currency)}` : ''}`).join(', ')}.`;
  }
  const sz = (item.sizes || []).map((z) => `${z.w} x ${z.h}`);
  return sz.length ? `Free photo on ${item.source}. Print it yourself: ${sz.slice(0, 4).join(', ')} in.` : `Free photo on ${item.source}.`;
}
// The size to try a piece at when it isn't on a wall yet: the size a wall
// already uses, else the middle of what the shop sells.
function trySize(id) {
  const onWall = S.view && S.view.all.flatMap((L) => L.pieces).find((p) => p.ref.id === id);
  if (onWall) return { w: onWall.w, h: onWall.h };
  const item = byId.get(id);
  const sizes = (item.offers && item.offers.length ? item.offers.filter((o) => o.w).map((o) => ({ w: o.w, h: o.h })) : item.sizes || []).sort((a, b) => a.w * a.h - b.w * b.h);
  return sizes[Math.floor(sizes.length / 2)] || null;
}
function savedScreen() {
  const d = S.draft;
  const hasWall = d && !need();
  const open = hasWall && S.view ? shown() : null;
  const kept = d ? new Set((d.kept || []).map((k) => k.id)) : new Set();
  const items = ME.saved.map((id) => byId.get(id)).filter(Boolean);
  const rows = items.map((item) => {
    const onOpen = open && open.pieces.some((p) => p.ref.id === item.id);
    const where = onOpen ? 'On the wall you have open.' : kept.has(item.id) ? 'Kept in every wall.' : '';
    return `<li class="row piece-row">
      <span class="thumb" style="aspect-ratio:${item.aspect || 0.8}"><img src="${item.imageData}" alt=""></span>
      <span class="row-text">
        <span class="name">${esc(item.title)}</span>
        <span class="meta">${item.offers && item.offers.length ? `Art by ${esc(item.artist)}` : `Photo by ${esc(item.artist)}`}. ${esc(sizesLine(item))}</span>
        ${where ? `<span class="reason">${esc(where)}</span>` : ''}
        <span class="row-acts">${hasWall && !onOpen && !kept.has(item.id) && trySize(item.id) ? `<button type="button" class="btn quiet small" data-try="${esc(item.id)}">See it on my wall</button>` : ''}${item.url ? `<a class="btn quiet small" href="${esc(item.url)}" target="_blank" rel="noopener">See it ${item.offers && item.offers.length ? 'at' : 'on'} ${esc(item.source)}</a>` : ''}</span>
      </span>
      <button type="button" class="heart" data-save="${esc(item.id)}" aria-pressed="true" aria-label="Saved ${esc(item.title)}">${heart(true)}</button>
    </li>`;
  }).join('');
  return `${bar(back(hasWall ? '#/wall' : '#/', hasWall ? 'Your walls' : 'Walldrobe'), hasWall ? '' : '<a class="btn quiet small" href="#/new">Start a wall</a>')}
  <main class="page">
    <h1>Saved</h1>
    <p class="lede">${items.length ? 'Pieces you saved, from any wall. Saving tells us what you like, so they rank the walls too.' : 'Nothing saved yet. Tap the heart on any piece and it lands here, and the walls rank for it.'}</p>
    ${flashHtml()}
    ${items.length ? `<ul class="rows">${rows}</ul>` : ''}
    <div class="acts left"><a class="btn quiet" href="#/browse">Browse every print</a></div>
  </main>`;
}
// A saved piece, tried on the wall: kept in every wall at a size it comes in.
function tryOnWall(id) {
  const z = trySize(id);
  if (!z) return;
  const d = S.draft;
  const list = d.kept || [];
  if (!list.some((k) => k.id === id)) d.kept = [...list, { id, w: z.w, h: z.h }];
  // A kept piece is new art, so the walls show new art again.
  d.justMine = false;
  logE('try-on-wall', { id, from: route()[0] || 'saved', w: z.w, h: z.h });
  d.chosen = null; S.openKey = null;
  persist();
  const item = byId.get(id);
  S.flashNext = `${item ? item.title : 'It'} is in every wall now, at ${z.w} x ${z.h} in. Tap it on a wall to change that.`;
  go('#/wall');
}
// ---------- Browse: every print, apart from any wall ----------

const BROWSE_STEP = 48;
// Fits in, by the long side of any size a piece comes in.
const SIZE_BANDS = [['any', 'Any size', 0, Infinity], ['s', 'Up to 12 in', 0, 12], ['m', '12 to 20 in', 12, 20], ['l', '20 to 30 in', 20, 30], ['xl', 'Over 30 in', 30, Infinity]];
// The catalog's color families (CATALOG.md, color.shares), on the painter's wheel, then the neutrals.
const COLOR_FAMS = [['any', 'Any color'], ['red', 'Red'], ['pink', 'Pink'], ['orange', 'Orange'], ['yellow', 'Yellow'], ['brown', 'Brown'], ['green', 'Green'], ['teal', 'Teal'], ['blue', 'Blue'], ['purple', 'Purple'], ['black', 'Black'], ['white', 'White'], ['bw', 'Black and white']];
const SHOPS = [['any', 'Every shop'], ['Desenio', 'Desenio'], ['House of Spoils', 'House of Spoils'], ['free', 'Free photos']];
S.browse = { size: 'any', color: 'any', shop: 'any', sort: null, shown: BROWSE_STEP };

// What each piece offers to the filters, worked out once.
let browseFacts = null;
function facts() {
  if (browseFacts) return browseFacts;
  browseFacts = CATALOG.map((c) => {
    const shop = c.offers && c.offers.length;
    const sizes = (shop ? c.offers.filter((o) => o.w) : c.sizes || []).map((z) => Math.max(z.w, z.h));
    const col = c.record.color, sh = col.shares || {};
    const fams = new Set();
    if (col.bw) fams.add('bw');
    else for (const f of ['red', 'pink', 'orange', 'yellow', 'brown', 'green', 'teal', 'blue', 'purple']) if ((sh[f] || 0) >= 0.2) fams.add(f);
    for (const f of ['black', 'white']) if ((sh[f] || 0) >= 0.3) fams.add(f);
    const prices = shop ? c.offers.map((o) => o.price).filter((v) => v != null) : [];
    return { c, sizes, fams, shop: shop ? c.source : 'free', price: prices.length ? Math.min(...prices) : null, many: new Set(prices).size > 1, cur: shop && c.offers[0].currency, az: c.title.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase() };
  });
  return browseFacts;
}
const browseWall = () => !!(S.draft && !need());
const browseSort = () => S.browse.sort && (S.browse.sort !== 'best' || browseWall()) ? S.browse.sort : browseWall() ? 'best' : 'az';
// Best for this wall: the taste score the feed ranks with (the quiz, then
// saves over swaps), with how well the piece's colors sit with the room.
let bestCache = null;
function bestScores() {
  const d = S.draft;
  const key = JSON.stringify([d.id, d.taste && d.taste.weights, d.taste && d.taste.picks, d.taste && d.taste.corrections, d.saved, d.skipped, d.room]);
  if (bestCache && bestCache.key === key) return bestCache.score;
  const quiz = ((d.taste && d.taste.picks) || []).map(([w, l]) => ({ winner: byId.get(w), loser: byId.get(l) })).filter((x) => x.winner && x.loser);
  const pairs = [];
  for (const w of d.saved || []) for (const l of d.skipped || []) { const a = byId.get(w), b = byId.get(l); if (a && b) pairs.push({ winner: a, loser: b }); }
  void quiz;
  const taste = tasteScores(CATALOG, pairs);
  const room = d.room && d.room.length ? normalizePalette(d.room) : null;
  const score = new Map(CATALOG.map((c) => {
    const roomFit = room ? paletteSimilarity(normalizePalette(c.palette), room) : 0.5;
    const q = typeof c.quality === 'number' ? (c.quality - 1) / 4 : 0.5;
    return [c.id, 0.7 * taste[c.id] + 0.2 * roomFit + 0.1 * q];
  }));
  bestCache = { key, score };
  return score;
}
function browseList() {
  const b = S.browse;
  const band = SIZE_BANDS.find((x) => x[0] === b.size) || SIZE_BANDS[0];
  let list = facts().filter((f) => (b.size === 'any' || f.sizes.some((L) => L > band[2] && L <= band[3]))
    && (b.color === 'any' || f.fams.has(b.color))
    && (b.shop === 'any' || f.shop === b.shop));
  const sort = browseSort();
  const az = (x, y) => x.az.localeCompare(y.az) || x.c.id.localeCompare(y.c.id);
  if (sort === 'best') { const sc = bestScores(); list = list.sort((x, y) => sc.get(y.c.id) - sc.get(x.c.id) || az(x, y)); }
  else if (sort === 'price') list = list.sort((x, y) => (x.price ?? 0) - (y.price ?? 0) || az(x, y));
  else list = list.sort(az);
  return list;
}
const fromPrice = (f) => (f.shop === 'free' ? 'free photo' : f.price == null ? `At ${f.c.source}` : `${f.many ? 'from ' : ''}${money(f.price, f.cur || 'USD')}`);
// A piece at its own shape, in a mat, on a bit of wall. The box always matches
// the art, so nothing is stretched: wide pieces fill the width, tall ones the height.
function tileArt(c) {
  const a = c.aspect || 0.8, B = 0.8;
  const pct = a >= B ? 100 : Math.round((a / B) * 1000) / 10;
  return `<span class="tile-art" style="width:calc(${pct}% - 8px);aspect-ratio:${a}" data-title="${esc(c.title)}"><img src="${c.imageData}" alt="" loading="lazy" decoding="async"></span>`;
}
function browseScreen() {
  const b = S.browse;
  const wall = browseWall();
  const list = browseList();
  const shown = list.slice(0, b.shown);
  const left = list.length - shown.length;
  const sort = browseSort();
  const sel = (name, label, opts, val, filter = true) => `<label class="filter${filter && val !== 'any' ? ' is-on' : ''}"><span class="sr">${label}</span><span class="select"><select id="f-${name}" data-filter="${name}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></span></label>`;
  const sorts = [...(wall ? [['best', 'Best for this wall']] : []), ['az', 'A to Z'], ['price', 'Price, low to high']];
  const filtered = b.size !== 'any' || b.color !== 'any' || b.shop !== 'any';
  const saved = new Set(ME.saved);
  const tiles = shown.map((f, i) => {
    const c = f.c, on = saved.has(c.id);
    return `<li class="tile"${i === b.focusFrom ? ' data-first-new' : ''}><button type="button" class="tile-open" data-browse="${esc(c.id)}" aria-haspopup="dialog" aria-label="${esc(c.title)}, ${esc(c.artist)}. ${esc(fromPrice(f))}${on ? '. Saved' : ''}">
      <span class="tile-wall"><span class="tile-in">${tileArt(c)}</span>${on ? `<span class="tile-saved" aria-hidden="true">${heart(true)}</span>` : ''}</span>
      <span class="tile-name">${esc(c.title)}</span>
      <span class="meta">${esc(c.artist)}, ${esc(fromPrice(f))}</span>
    </button></li>`;
  }).join('');
  const n = list.length.toLocaleString('en-US');
  return `${bar(back(wall ? '#/wall' : '#/', wall ? 'Your walls' : 'Walldrobe'), ME.saved.length ? `<a class="btn quiet small" href="#/saved">Saved (${ME.saved.length})</a>` : '')}
  <main class="page browse">
    <h1>Every print</h1>
    <div class="filters" role="group" aria-label="Filter and sort">
      ${sel('size', 'Size, on the long side', SIZE_BANDS, b.size)}
      ${sel('color', 'Color', COLOR_FAMS, b.color)}
      ${sel('shop', 'Shop', SHOPS, b.shop)}
      ${sel('sort', 'Sort', sorts, sort, false)}
    </div>
    <p class="browse-count"><span class="count" id="browse-count">${n} print${list.length === 1 ? '' : 's'}</span>${filtered ? '<button type="button" class="link" data-act="browse-clear">Clear filters</button>' : ''}</p>
    ${flashHtml()}
    ${list.length ? `<ul class="tiles">${tiles}</ul>` : '<p class="note">Nothing matches all of these. Clear a filter or two to see more.</p>'}
    ${left > 0 ? `<div class="acts browse-more"><button type="button" class="btn quiet" data-act="browse-more">Show ${Math.min(BROWSE_STEP, left)} more</button></div>` : list.length > BROWSE_STEP ? `<p class="pencil small browse-end">That's all ${n}.</p>` : ''}
  </main>${credits()}${sheetHtml()}`;
}
function browseSheet(id) {
  const c = byId.get(id);
  if (!c) return '';
  const d = S.draft;
  const shop = c.offers && c.offers.length;
  const saved = ME.saved.includes(id);
  const kept = d && !d.justMine && (d.kept || []).some((k) => k.id === id);
  const canTry = browseWall() && !kept && trySize(id);
  const a = c.aspect || 0.8;
  const link = shop ? (offersAt(c, 0, 0).main || {}).url || c.url : c.url;
  return `<h2 id="sheet-h">${esc(c.title)}</h2>
    <div class="sheet-art"><span class="big-art" style="width:min(calc(100% - 12px), ${Math.round(a * 320)}px);aspect-ratio:${a}" data-title="${esc(c.title)}"><img src="${c.imageData}" alt="${esc(c.title)}"></span></div>
    <p class="meta">${shop ? `Art by ${esc(c.artist)}, sold by ${esc(c.source)}` : `Photo by ${esc(c.artist)} on ${esc(c.source)}`}</p>
    <p class="meta">${esc(sizesLine(c))}</p>
    ${c.record.description ? `<p>${esc(c.record.description)}.</p>` : ''}
    ${kept ? '<p class="pencil small">Kept in every wall.</p>' : ''}
    <div class="acts left">
      ${canTry ? `<button type="button" class="btn" data-try="${esc(id)}">See it on my wall</button>` : ''}
      <button type="button" class="btn quiet" data-save="${esc(id)}" aria-pressed="${saved}">${heart(saved)} ${saved ? 'Saved' : 'Save'}</button>
    </div>
    ${link ? `<a class="btn quiet small fit" href="${esc(link)}" target="_blank" rel="noopener">See it ${shop ? 'at' : 'on'} ${esc(c.source)}</a>` : ''}`;
}

// Art you added before that isn't on this wall: offer it again.
function pastArtHtml() {
  const d = S.draft;
  if (!d || d.sample) return '';
  const here = new Set(d.owned.map((o) => o.id));
  const past = ME.art.filter((a) => !here.has(a.id));
  if (!past.length) return '';
  return `<h2>Your art from before</h2>
    <p class="pencil small">Pieces you added on another wall that aren't up yet.</p>
    <ul class="rows">${past.map((a) => `<li class="row">
      <span class="thumb" style="aspect-ratio:${a.w}/${a.h}">${a.thumb ? `<img src="${a.thumb}" alt="">` : `<span class="swatch" style="background:${esc(a.color || '#8A8F94')}"></span>`}</span>
      <span class="row-text"><span class="name">Your ${esc(a.title)}</span><span class="meta">${a.w} x ${a.h} in, not up yet</span>
        <span class="row-acts"><button type="button" class="btn quiet small" data-add-past="${esc(a.id)}">Add it to this wall</button><button type="button" class="link" data-forget-art="${esc(a.id)}">Forget it</button></span></span>
    </li>`).join('')}</ul>`;
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
const FINISH_NAME = { black: 'black', white: 'white', oak: 'oak', walnut: 'walnut', brass: 'brass', color: 'colored' };
const FINISH_LABEL = { black: 'Black', white: 'White', oak: 'Oak', walnut: 'Walnut', brass: 'Brass', color: 'Color' };
const FINISH_HEX = { black: '#1B1B1B', white: '#F4F3EE', oak: '#B88A5A', walnut: '#5A3E2B', brass: '#A8884A' };
// One bold color across a set: a color pop. Muted enough to sit with art, never the tape colors.
const POP = { blue: ['Blue', '#2E5A9C'], red: ['Red', '#B0392B'], green: ['Green', '#2E6B4E'], pink: ['Pink', '#D78AA5'], yellow: ['Yellow', '#D9A93A'] };
// How thick the frame's face is, and how wide the mat: the mat is the buffer between art and frame.
const PROFILE_IN = { thin: 0.6, standard: 0.9, chunky: 1.5 };
const MAT_IN = { none: 0, slim: 1.5, standard: 2.5, wide: 4 };
const MAT_LABEL = { none: 'No mat', slim: 'Slim mat', standard: 'Mat', wide: 'Wide mat' };
// A look sets all three for the wall at once.
const LOOKS = {
  classic: { label: 'Classic', finish: 'black', profile: 'standard', mat: 'standard' },
  gallery: { label: 'Gallery', finish: 'black', profile: 'thin', mat: 'wide' },
  wood: { label: 'Warm wood', finish: 'oak', profile: 'standard', mat: 'slim' },
  clean: { label: 'Clean', finish: 'white', profile: 'thin', mat: 'none' },
  gold: { label: 'Gold', finish: 'brass', profile: 'thin', mat: 'standard' },
  pop: { label: 'Color pop', finish: 'color', color: 'blue', profile: 'standard', mat: 'standard' },
};
// The frame a piece suits, from what it is: black and white in black; classic or
// old-world in brass; warm, earthy or painted in oak; soft and light in white;
// everything else in black. The mat: none on big pieces (over 24 in), a mat on
// photos, a slim one on light pieces, none on bold graphic ones.
function suggestFrame(item, p) {
  const r = (item && item.record) || {}, c = r.color || {}, t = r.tags || {};
  const words = new Set([...(t.style || []), ...(t.vibe || []), ...(t.mood || []), ...(t.subjects || []), r.category, t.theme].filter(Boolean).map((x) => String(x).toLowerCase()));
  const has = (...w) => w.some((x) => words.has(x));
  const big = Math.max(p.w, p.h) > 24;
  const photo = !(item && item.offers && item.offers.length) || has('film', 'documentary', 'aerial', 'portrait');
  let finish, why;
  if (c.bw || has('monochrome')) { finish = 'black'; why = 'black and white wants a black frame'; }
  else if (has('classic', 'luxe', 'vintage', 'botanical', 'antique') || (has('painterly') && has('moody', 'dramatic'))) { finish = 'brass'; why = 'a classic or old-world piece suits brass'; }
  else if (has('painterly', 'earthy', 'warm', 'western', 'rustic') || ((c.warmth ?? 0.5) >= 0.7 && (c.saturation ?? 0.5) < 0.5)) { finish = 'oak'; why = 'warm, earthy colors sit well in oak'; }
  else if (has('pastel', 'soft', 'airy', 'dreamy', 'serene', 'fresh', 'riviera', 'summer', 'tropical') && (c.brightness ?? 0.5) >= 0.55) { finish = 'white'; why = 'a light, soft piece stays light in white'; }
  else { finish = 'black'; why = 'black frames graphic and photo pieces cleanly'; }
  const mat = big ? 'none' : photo ? 'standard' : (c.brightness ?? 0.5) >= 0.55 ? 'slim' : 'none';
  return { finish, mat, why };
}
const framesNow = () => { const f = (S.draft && S.draft.frames) || {}; if (typeof f.mat === 'boolean') f.mat = f.mat ? 'standard' : 'none'; return f; };
// The frame each new piece gets: the set's (one look for the wall) or its own suggestion, with any you set by hand.
function frameFor(id, p) {
  const f = framesNow(), sug = suggestFrame(byId.get(id), p);
  const each = f.each && f.each[id];
  const base = f.mode === 'each'
    ? { finish: sug.finish, color: null, profile: f.profile || 'standard', mat: sug.mat }
    : { finish: f.finish || setFinish(), color: f.color || null, profile: f.profile || 'standard', mat: f.mat || sug.mat };
  const out = { ...base, ...(each || {}) };
  if (out.finish === 'color' && !POP[out.color]) out.color = 'blue';
  return out;
}
// What to draw: the frame's color, its face and the mat in inches (a mat never eats more than a fifth of the short side).
function frameDraw(fr, p) {
  const hex = fr.finish === 'color' ? POP[fr.color][1] : FINISH_HEX[fr.finish] || FINISH_HEX.black;
  return { hex, light: fr.finish === 'white', f: PROFILE_IN[fr.profile] || PROFILE_IN.standard, m: Math.min(MAT_IN[fr.mat] || 0, 0.2 * Math.min(p.w, p.h)) };
}
const finishWord = (fr) => (fr.finish === 'color' ? POP[fr.color][0].toLowerCase() : FINISH_NAME[fr.finish]);
const finishLabel = (fr) => (fr.finish === 'color' ? POP[fr.color][0] : FINISH_LABEL[fr.finish]);
// The print that sits inside the mat, to the half inch.
const insideMat = (p, fr) => { const m = frameDraw(fr, p).m; return [Math.floor((p.w - 2 * m) * 2) / 2, Math.floor((p.h - 2 * m) * 2) / 2]; };
// The finish most of the pieces suit; black when your own frames are on the wall, since most are black.
function setFinish() {
  const L = shown();
  if (!L) return 'black';
  if (L.pieces.some((p) => p.ref.source !== 'catalog')) return 'black';
  const count = {};
  for (const p of L.pieces.filter((x) => x.ref.source === 'catalog')) { const k = suggestFrame(byId.get(p.ref.id), p).finish; count[k] = (count[k] || 0) + 1; }
  // A tie goes to black, which works with anything.
  const top = Object.entries(count).sort((a, b) => b[1] - a[1] || (a[0] === 'black' ? -1 : b[0] === 'black' ? 1 : 0));
  return top.length && (top.length === 1 || top[0][1] > top[1][1]) ? top[0][0] : 'black';
}
// Most of the new art black and white: a color pop frame can tie it together.
function mostlyBW() {
  const L = shown();
  const fresh = L ? L.pieces.filter((p) => p.ref.source === 'catalog') : [];
  const bw = fresh.filter((p) => { const r = byId.get(p.ref.id)?.record; return r && (r.color?.bw || (r.tags?.style || []).includes('monochrome')); }).length;
  return fresh.length >= 2 && bw / fresh.length >= 0.7;
}
const frameLink = (w, h, id) => {
  const fr = frameFor(id, { w, h }), m = frameDraw(fr, { w, h }).m, [pw, ph] = insideMat({ w, h }, fr);
  return `https://www.amazon.com/s?k=${encodeURIComponent(`${Math.min(w, h)}x${Math.max(w, h)} ${finishWord(fr)} picture frame${m ? ` with mat for ${Math.min(pw, ph)}x${Math.max(pw, ph)} print` : ''}`)}`;
};

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
  const o = best.o, nm = obName(o), name = nm === 'TV' ? 'TV' : nm.toLowerCase();
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
  if (!L) { go('#/wall'); return ''; }
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
        ${o.framed ? '' : `<span class="meta">${esc(frameWords(item.id, p))}. <a href="#/frames">Change</a></span>`}
        <span class="row-acts"><a class="btn quiet small" href="${esc(o.url)}" target="_blank" rel="noopener">Buy at ${esc(item.source)}</a>${o.framed ? '' : `<a class="btn quiet small" href="${frameLink(p.w, p.h, p.ref.id)}" target="_blank" rel="noopener">Find ${aOrAn(Math.min(p.w, p.h))} ${Math.min(p.w, p.h)} x ${Math.max(p.w, p.h)} in frame</a>`}</span></span></li>`;
    }
    const fr = frameFor(p.ref.id, p), ps = frameDraw(fr, p).m ? insideMat(p, fr) : null;
    return `<li class="row buy">${thumb}<span class="row-text"><span class="name">${esc(item.title)}</span>
      <span class="meta">Photo by ${esc(item.artist)} on ${esc(item.source)}. ${ps ? `Print it ${ps[0]} x ${ps[1]} in for a ${p.w} x ${p.h} in frame with a ${inches(frameDraw(fr, p).m)} mat` : `Print it ${p.w} x ${p.h} in, no mat`}. Free under the ${esc(item.record.source.license)}.</span>
      <span class="meta">${esc(frameWords(item.id, p))}. <a href="#/frames">Change</a></span>
      <span class="row-acts"><a class="btn quiet small" href="${esc(item.url)}" target="_blank" rel="noopener">Get it on ${esc(item.source)}</a><a class="btn quiet small" href="${frameLink(p.w, p.h, p.ref.id)}" target="_blank" rel="noopener">Find ${aOrAn(Math.min(p.w, p.h))} ${Math.min(p.w, p.h)} x ${Math.max(p.w, p.h)} in frame</a></span></span></li>`;
  }).join('');
  return `${bar(back(fresh.length ? '#/frames' : '#/wall', fresh.length ? 'Frames' : 'Your wall'), '<button type="button" class="btn quiet small" data-act="print">Print</button>')}
  ${stepBar(4)}
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
      <div class="drawing">${wallSvg({ wall: { width: d.width, height: d.height }, obstacles: d.obstacles, photo: d.photo && d.photo.flat ? cleanWall() : null, hideObstacles: !!(d.photo && d.photo.flat), layout: LG, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: ownedInfo, keptIds: keptSet(), measure: true, still: true, pxWide: pxNow(), frames: (p) => frameDraw(frameFor(p.ref.id, p), p), label: `${d.name}, hanging guide` })}</div>
      <div class="table-scroll"><table class="nails"><thead><tr><th scope="col">Piece</th><th scope="col">Frame</th><th scope="col">From the left</th><th scope="col">Up from the floor</th></tr></thead>
        <tbody>${hangOrder.map((p) => `<tr><td>${esc(nameOf(p))}${p.ref.source !== 'catalog' && /^Moves/.test(moveNote(p)) ? '<span class="nail-ref">Take it down and rehang it here.</span>' : ''}${refs.get(p.ref.id) ? `<span class="nail-ref">Or ${esc(refs.get(p.ref.id))}</span>` : ''}</td><td>${p.w} x ${p.h} in</td><td>${esc(inches(p.nail.x))}</td><td>${esc(inches(p.nail.y))}</td></tr>`).join('')}</tbody></table></div>
      <ol class="steps">
        <li>Cut a piece of paper or tape to each frame's size and stick it up where the drawing shows it. Step back and look before you drill.</li>
        <li>Hang the biggest piece first; the others measure off it.</li>
        <li>Mark each nail on the tape, drill through it, then peel it off.</li>
        ${anyRef ? `<li>Measuring from the nearest edge, like the TV's, keeps any error small${estimate ? ', which helps while the wall size is an estimate' : ''}.</li>` : ''}
      </ol>
    </section>
    <div class="acts left">
      <button type="button" class="btn" data-act="save">${S.ui.saved === d.id && !store.demoMode ? 'Saved on this device' : 'Save this wall'}</button>
      <button type="button" class="btn quiet" data-act="share">Share this wall</button>
      <a class="btn quiet" href="#/wall">Back to this wall</a>
    </div>
  </main>${credits()}${sheetHtml()}`;
}

// One piece's frame in words: "Black frame, slim mat".
function frameWords(id, p) {
  const fr = frameFor(id, p), dr = frameDraw(fr, p);
  const fin = fr.finish === 'color' ? `${POP[fr.color][0]} frame` : `${FINISH_LABEL[fr.finish]} frame`;
  const matName = { slim: 'a slim mat', standard: 'a mat', wide: 'a wide mat' }[fr.mat] || 'a mat';
  return `${fin}, ${dr.m ? matName : 'no mat'}`;
}
// Frames, as a step: the wall drawn with them, one look for the set, then any one piece.
function framesScreen() {
  if (need()) { go(need()); return ''; }
  const wait = building();
  if (wait) return wait;
  const d = S.draft;
  const L = shown();
  if (!L) { go('#/wall'); return ''; }
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
  if (!fresh.length) { go('#/get'); return ''; }
  const rows = fresh.map((p) => { const item = byId.get(p.ref.id); const own = framesNow().each && framesNow().each[item.id]; return `<li class="row piece-row">
    <button type="button" class="row-open" data-fpiece="${esc(item.id)}" aria-haspopup="dialog"><span class="thumb" style="aspect-ratio:${item.aspect || p.w / p.h}"><img src="${item.imageData}" alt=""></span>
    <span class="row-text"><span class="name">${esc(item.title)}</span><span class="meta">${p.w} x ${p.h} in. ${esc(frameWords(item.id, p))}${own ? ', set by you' : ''}.</span></span></button></li>`; }).join('');
  return `${bar(back('#/wall', 'Your wall'))}
  ${stepBar(3)}
  <main class="page">
    <h1>Frames</h1>
    <p class="lede">One look for the whole wall, drawn on it. Change any one piece below.</p>
    ${flashHtml()}
    <div class="drawing">${wallSvg({ wall: { width: d.width, height: d.height }, obstacles: d.obstacles, photo: d.photo && d.photo.flat ? cleanWall() : null, hideObstacles: !!(d.photo && d.photo.flat), layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: ownedInfo, keptIds: keptSet(), still: true, pxWide: pxNow(), frames: (p) => frameDraw(frameFor(p.ref.id, p), p), label: 'Your wall, framed' })}</div>
    ${framePicker()}
    <h2>Each piece</h2>
    <p class="pencil small">Tap a piece to give just that one a different frame or mat.</p>
    <ul class="rows">${rows}</ul>
    <div class="acts left"><a class="btn" href="#/get">Hang it next</a></div>
  </main>${sheetHtml()}`;
}
// The frames for the new pieces: one finish and mat or not, for the whole wall.
function framePicker() {
  const f = framesNow();
  const mode = f.mode === 'each' ? 'each' : 'set';
  const seg = (name, pairs, cur, attr) => `<span class="seg" role="group" aria-label="${esc(name)}">${pairs.map(([v, l]) => `<button type="button" data-${attr}="${v}" aria-pressed="${cur === v}">${esc(l)}</button>`).join('')}</span>`;
  const fin = f.finish || setFinish(), prof = f.profile || 'standard';
  const look = f.look || null;
  const pop = mode === 'set' && fin === 'color';
  const owns = shown() && shown().pieces.some((p) => p.ref.source !== 'catalog');
  const note = mode === 'each' ? 'Each piece in the frame that suits it best.'
    : f.finish ? '' : `${FINISH_LABEL[fin]} ${fin === 'black' ? 'ties the set together' : 'suits most of these pieces'}${owns ? ' and matches your own frames' : ''}.`;
  return `<div class="frame-pick">
    <div class="looks" role="group" aria-label="Looks">${Object.entries(LOOKS).map(([k, v]) => `<button type="button" class="look" data-look="${k}" aria-pressed="${look === k}">${frameSwatch(v)}<span>${esc(v.label)}</span></button>`).join('')}</div>
    ${mostlyBW() && fin !== 'color' ? '<p class="note">Mostly black and white: one color frame across the set, a color pop, can tie it together.</p>' : ''}
    ${pop ? `<div class="strip-row" role="group" aria-label="Frame color">${Object.entries(POP).map(([k, [l, hex]]) => `<button type="button" class="pop" data-fcolor="${k}" aria-pressed="${(f.color || 'blue') === k}" aria-label="${l}"><span style="background:${hex}"></span>${l}</button>`).join('')}</div>` : ''}
    <details class="fine"${!look && (f.finish || f.profile || f.mat || f.mode) ? ' open' : ''}><summary>Details: matched or each its own, finish, weight, mat</summary>
      <div class="strip-row">${seg('Frames', [['set', 'Matched set'], ['each', 'Each its own']], mode, 'fmode')}</div>
      ${mode === 'set' ? `<span class="label">Finish</span><div class="strip-row">${seg('Finish', [['black', 'Black'], ['white', 'White'], ['oak', 'Oak'], ['walnut', 'Walnut'], ['brass', 'Brass'], ['color', 'Color']], fin, 'finish')}</div>` : ''}
      <span class="label">Frame</span><div class="strip-row">${seg('Frame', [['thin', 'Thin'], ['standard', 'Standard'], ['chunky', 'Chunky']], prof, 'profile')}</div>
      ${mode === 'set' ? `<span class="label">Mat</span><div class="strip-row">${seg('Mat', [['none', 'None'], ['slim', 'Slim'], ['standard', 'Standard'], ['wide', 'Wide']], f.mat || '', 'mat')}</div>` : ''}
    </details>
    <p class="pencil small">${note ? `${esc(note)} ` : ''}${mode === 'set' && !f.mat ? 'Mats where a piece wants one. ' : ''}The mat is the white border inside the frame: the frame stays the size on the wall, the print is smaller.</p>
  </div>`;
}
// A small framed square for each look, so the choice is seen, not read.
function frameSwatch(v) {
  const hex = v.finish === 'color' ? POP[v.color][1] : FINISH_HEX[v.finish];
  const f = PROFILE_IN[v.profile] * 3, m = MAT_IN[v.mat] * 1.4;
  return `<svg viewBox="0 0 28 34" width="28" height="34" aria-hidden="true"><rect x="0" y="0" width="28" height="34" fill="${hex}"${v.finish === 'white' ? ' stroke="#C9C7C0" stroke-width="0.6"' : ''}/><rect x="${f}" y="${f}" width="${28 - 2 * f}" height="${34 - 2 * f}" fill="#FBFBF9"/><rect x="${f + m}" y="${f + m}" width="${28 - 2 * (f + m)}" height="${34 - 2 * (f + m)}" fill="#8FA3B8"/></svg>`;
}
// One piece's own frame, in a sheet: finish and mat, and why the set's choice was made.
function frameSheet(id) {
  const L = shown(), p = L && L.pieces.find((x) => x.ref.id === id);
  if (!p) return '';
  const item = byId.get(id), fr = frameFor(id, p);
  return `<h2 id="sheet-h">${esc(item.title)}</h2>
    <div class="sheet-art"><span class="art-big" style="aspect-ratio:${item.aspect || p.w / p.h}"><img src="${item.imageData}" alt="${esc(item.title)}"></span></div>
    <p class="meta">${p.w} x ${p.h} in. ${esc(frameWords(id, p))} now.</p>
    ${frameRow(id, p)}
    ${framesNow().each && framesNow().each[id] ? `<button type="button" class="link" data-funset="${esc(id)}">Back to the set's frame</button>` : ''}
    <p class="pencil small">${fr.mat && fr.mat !== 'none' ? 'With a mat, the frame stays this size on the wall and the print inside is smaller. The buy list says which print size to order.' : 'No mat: the print fills the frame.'}</p>`;
}
// One piece's frame: finish and mat, and why.
function frameRow(id, p) {
  const fr = frameFor(id, p), sug = suggestFrame(byId.get(id), p);
  const own = framesNow().each && framesNow().each[id];
  const finishOpts = [...['black', 'white', 'oak', 'walnut', 'brass'].map((k) => [k, FINISH_LABEL[k]]), ...Object.entries(POP).map(([k, [l]]) => [`color:${k}`, l])];
  const cur = fr.finish === 'color' ? `color:${fr.color}` : fr.finish;
  const title = byId.get(id).title;
  return `<span class="frame-row">
    <label class="inline"><span>Finish</span><select data-ffinish="${esc(id)}" aria-label="Frame for ${esc(title)}">${finishOpts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="inline"><span>Mat</span><select data-fmat="${esc(id)}" aria-label="Mat for ${esc(title)}">${Object.entries(MAT_LABEL).map(([v, l]) => `<option value="${v}"${v === fr.mat ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    ${own ? '' : `<span class="pencil small">${fr.finish === sug.finish ? `Suggested: ${esc(sug.why)}.` : `Matched to the set. On its own, ${FINISH_LABEL[sug.finish].toLowerCase()}: ${esc(sug.why)}.`}</span>`}
  </span>`;
}

// ---------- Walls: what people hung, before and after ----------

// A share card: the wall as it was, the wall they hung, the others they considered, the pieces.
// Only the flattened wall goes in, never the room photo; your own pieces as sizes and thumbs.
function makePost(note, name, withPhoto = true) {
  const d = S.draft, L = shown(), v = S.view;
  if (!L) return null;
  const others = (v ? v.list : []).filter((x) => x.key !== L.key && x.variant !== 'asis').slice(0, 3);
  const bare = (X) => ({ ...bareLayout(X), why: X.why || null });
  return {
    id: `post${Date.now().toString(36)}`, at: new Date().toISOString(), name: (name || '').trim().slice(0, 40), note: (note || '').trim().slice(0, 240),
    wall: { width: d.width, height: d.height }, obstacles: d.obstacles,
    before: withPhoto && d.photo && d.photo.flat ? d.photo.flat : null, clean: withPhoto && d.photo && d.photo.flat ? cleanWall() : null,
    after: bare(L), considered: others.map(bare),
    owned: d.owned.filter((o) => o.keep !== 'skip').map((o) => ({ id: o.id, title: o.title, w: o.w, h: o.h, at: o.at || null, thumb: o.thumb || null, color: o.color || null })),
    frames: L.pieces.filter((p) => p.ref.source === 'catalog').map((p) => ({ id: p.ref.id, ...frameFor(p.ref.id, p) })),
    kept: keepList(), sample: !!d.sample, room: d.name,
  };
}
function postSvg(post, L, px, opts = {}) {
  const ownedFor = (id) => { const o = post.owned.find((x) => x.id === id); return o ? { thumb: o.thumb, color: o.color } : null; };
  const fr = post.frames ? new Map(post.frames.map((f) => [f.id, f])) : new Map();
  return wallSvg({ wall: post.wall, obstacles: post.obstacles, photo: opts.before ? post.before : post.clean, hideObstacles: !!post.before, layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor, keptIds: new Set((post.kept || []).map((k) => k.id)), still: true, pxWide: px, frames: L && opts.framed ? (p) => { const f = fr.get(p.ref.id); return f ? frameDraw(f, p) : null; } : null, label: opts.label || post.room });
}
// The public feed. Loads when the page opens and again after a minute; your own shares that
// haven't reached it yet stay on this phone with a way to try again.
function loadFeed(more) {
  const F = S.feed;
  if (F.status === 'loading') return;
  F.status = 'loading'; F.err = null;
  const last = more && F.posts.length ? F.posts[F.posts.length - 1].at : null;
  Promise.all([social.feed(last), more ? Promise.resolve(null) : social.mine().catch(() => null)])
    .then(([rows, mine]) => {
      F.posts = more ? [...F.posts, ...rows.filter((r) => !F.posts.some((x) => x.remote === r.remote))] : rows;
      if (mine) F.mine = new Set(mine);
      F.more = rows.length === social.PAGE; F.status = 'ok'; F.at = Date.now();
    })
    .catch((e) => { F.status = 'error'; F.err = e.message; F.at = Date.now(); })
    .finally(() => { if (route()[0] === 'community') render(); });
}
function feedPosts() {
  const F = S.feed, local = store.listShared(), hidden = new Set(social.reported());
  const mineIds = new Set([...F.mine, ...local.filter((p) => p.remote).map((p) => p.remote)]);
  const pending = local.filter((p) => !p.remote).map((p) => ({ ...p, mine: true, pending: true }));
  const pub = F.status === 'ok' || F.posts.length ? F.posts : local.filter((p) => p.remote);
  return [...pending, ...pub.filter((p) => !hidden.has(p.remote)).map((p) => ({ ...p, mine: mineIds.has(p.remote) }))];
}
function findPost(id) { return feedPosts().find((x) => x.id === id) || null; }
function communityScreen() {
  const F = S.feed;
  if (!store.demoMode && F.status !== 'loading' && (F.status === 'idle' || Date.now() - F.at > 60000)) setTimeout(() => loadFeed(false), 0);
  const posts = feedPosts();
  const px = pxNow();
  const date = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };
  const cards = posts.map((post) => {
    const fresh = post.after.pieces.filter((p) => p.ref.source === 'catalog');
    const pieces = fresh.map((p) => { const it = byId.get(p.ref.id); if (!it) return ''; const saved = ME.saved.includes(it.id); return `<li class="row piece-row">
        <button type="button" class="row-open" data-browse="${esc(it.id)}"><span class="thumb" style="aspect-ratio:${it.aspect || p.w / p.h}"><img src="${it.imageData}" alt=""></span><span class="row-text"><span class="name">${esc(it.title)}</span><span class="meta">${p.w} x ${p.h} in${it.offers && it.offers.length ? `, ${esc(it.source)}` : ', free photo'}</span></span></button>
        <button type="button" class="heart" data-save="${esc(it.id)}" aria-pressed="${saved}" aria-label="${saved ? 'Saved' : 'Save'} ${esc(it.title)}">${heart(saved)}</button></li>`; }).join('');
    const ask = S.ui.askPost && S.ui.askPost.id === post.id ? S.ui.askPost.what : null;
    const acts = ask === 'remove'
      ? `<span class="error">${post.pending ? 'Remove it from this phone?' : 'Take it off the feed for everyone?'}</span>
        <button type="button" class="btn danger small" data-unshare="${esc(post.id)}">Remove</button><button type="button" class="btn quiet small" data-act="ask-cancel">Keep it</button>`
      : ask === 'report'
        ? `<span class="error">Report this wall? It's hidden for you, and three reports hide it for everyone.</span>
        <button type="button" class="btn danger small" data-report="${esc(post.id)}">Report</button><button type="button" class="btn quiet small" data-act="ask-cancel">Cancel</button>`
        : `${fresh.length && S.draft && !need() ? `<button type="button" class="btn quiet small" data-try-set="${esc(post.id)}">Try these on my wall</button>` : ''}
        ${post.pending ? `<button type="button" class="btn quiet small" data-reshare="${esc(post.id)}">Share it again</button>` : ''}
        ${post.mine ? `<button type="button" class="link" data-ask-post="remove" data-pid="${esc(post.id)}">Remove</button>` : `<button type="button" class="link" data-ask-post="report" data-pid="${esc(post.id)}">Report</button>`}`;
    return `<li class="post" id="${esc(post.id)}">
      <p class="post-head"><span class="post-who">${esc(post.name || 'Someone')}${post.mine ? ' <span class="pencil">(you)</span>' : ''}</span> <span class="pencil">${esc(post.room)}, ${esc(date(post.at))}${post.sample ? ', a sample wall' : ''}</span></p>
      ${post.pending ? '<p class="note">Only on this phone. It didn\'t reach the feed.</p>' : ''}
      ${post.note ? `<p class="post-note">${esc(post.note)}</p>` : ''}
      <div class="post-pair">
        ${post.before ? `<figure><div class="drawing">${postSvg(post, null, px, { before: true, label: 'Before' })}</div><figcaption>Before</figcaption></figure>` : ''}
        <figure><div class="drawing">${postSvg(post, post.after, px, { framed: true, label: 'After' })}</div><figcaption>After. ${esc((post.after.why && post.after.why.text) || post.after.summary || '')}</figcaption></figure>
      </div>
      ${post.considered.length ? `<p class="sheet-label">Also considered</p><div class="post-others">${post.considered.map((L) => `<figure><div class="drawing">${postSvg(post, L, Math.round(px / 2), { label: 'Considered' })}</div><figcaption>${esc((L.why && L.why.text) || L.summary || '')}</figcaption></figure>`).join('')}</div>` : ''}
      ${fresh.length ? `<p class="sheet-label">The pieces</p><ul class="rows">${pieces}</ul>` : ''}
      <div class="acts left">${acts}</div>
    </li>`;
  }).join('');
  const status = store.demoMode ? '<p class="note">Sample mode: the public feed is off.</p>'
    : F.status === 'error' ? `<p class="note">Couldn't load the feed: ${esc(F.err || 'no connection')}. <button type="button" class="link" data-act="feed-retry">Try again</button></p>`
      : F.status === 'loading' && !F.posts.length ? '<p class="pencil">Loading walls...</p>' : '';
  const empty = !posts.length && F.status === 'ok' ? '<p class="pencil">No walls yet. Share one from its Get it screen and it shows up here for everyone.</p>' : '';
  return `${bar(back('#/', 'Walldrobe'), S.draft && !need() ? '<a class="btn quiet small" href="#/wall">My wall</a>' : '<a class="btn quiet small" href="#/new">Start a wall</a>')}
  <main class="page">
    <h1>Walls people hung</h1>
    <p class="lede">What people hung: the wall before, the wall after, and the others they thought about.</p>
    ${flashHtml()}
    ${status}
    ${posts.length ? `<ul class="posts">${cards}</ul>` : empty}
    ${F.more && F.status !== 'error' ? `<div class="acts"><button type="button" class="btn quiet" data-act="feed-more"${F.status === 'loading' ? ' disabled' : ''}>${F.status === 'loading' ? 'Loading...' : 'More walls'}</button></div>` : ''}
  </main>${sheetHtml()}`;
}
function shareSheet() {
  const d = S.draft;
  const hasPhoto = !!(d.photo && d.photo.flat);
  return `<h2 id="sheet-h">Share this wall</h2>
    <p class="pencil small">Anyone can see it on the Walls page. What goes up: the wall you picked, the three you also considered, and the pieces. Your own pieces as sizes and small thumbnails. Never your room photo, only the flattened wall if you leave the box on. You can remove it any time.</p>
    <form id="share-form" class="fields">
      <label class="name-in"><span>Your name, or leave it blank</span><input type="text" name="who" maxlength="40" value="${esc(ME.name || '')}"></label>
      <label class="name-in"><span>A line about it, if you like</span><input type="text" name="note" maxlength="240" placeholder="Why this one?"></label>
      ${hasPhoto ? '<label class="check"><input type="checkbox" name="photo" checked> <span>Show my wall photo for the before and after</span></label>' : ''}
      <div class="acts left"><button class="btn" type="submit"${S.ui.sharing ? ' disabled' : ''}>${S.ui.sharing ? 'Sharing...' : 'Share'}</button><button class="btn quiet" type="button" data-act="close-sheet">Not now</button></div>
    </form>`;
}

// Smaller photos for the feed, same shape: scaled, never stretched.
function shrink(url, maxW, q) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, maxW / im.naturalWidth);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', q));
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
}
async function forFeed(post) {
  for (const [w, q] of [[900, 0.72], [640, 0.62]]) {
    const p = { ...post, before: await shrink(post.before, w, q), clean: await shrink(post.clean, w, q) };
    if (JSON.stringify(p).length < 850000) return p;
  }
  return { ...post, before: null, clean: null };
}
async function sendPost(post) {
  const small = await forFeed(post);
  const remote = await social.share(small);
  const kept = { ...post, remote };
  store.addShared(kept);
  S.feed.mine.add(remote);
  S.feed.posts = [{ ...small, id: `pub-${remote}`, remote, at: new Date().toISOString() }, ...S.feed.posts.filter((x) => x.remote !== remote)];
  return kept;
}

// ---------- Your walls ----------

function walls() {
  const all = store.listWalls();
  const date = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };
  return `${bar(back('#/', 'Walldrobe'), '<a class="btn quiet small" href="#/new">Start a wall</a>')}
  <main class="page">
    <h1>Your walls</h1>
    <p class="lede">Saved on this device. Walls and photos stay here and are never uploaded.</p>
    ${store.demoMode ? '' : `<div class="keep-note"><p class="pencil small">This device also keeps a list of the pieces you save, swap, skip and pick, with no photos and nothing about you, so Walldrobe can learn what people like. Nothing is sent anywhere yet.</p>${store.listEvents().length ? '<button type="button" class="link" data-act="clear-events">Clear that list</button>' : ''}</div>`}
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
  const keys = ['version', 'alt', 'fpiece', 'funset', 'trySet', 'unshare', 'report', 'reshare', 'askPost', 'pid', 'look', 'fcolor', 'profile', 'ffinish', 'fmat', 'fmode', 'finish', 'mat', 'pool', 'v', 'size', 'chip', 'style', 'art', 'count', 'step', 'axis', 'lean', 'browse', 'filter', 'std', 'turn', 'try', 'addPast', 'forgetArt', 'isArt', 'isTv', 'fullness', 'just', 'save', 'piece', 'goto', 'fix', 'obk', 'obid', 'ok', 'oid', 'keep', 'act', 'id', 'which', 'corner', 'add', 'pick', 'open', 'rename'];
  const parts = keys.filter((k) => el.dataset && el.dataset[k] !== undefined).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(el.dataset[k])}"]`);
  return parts.length ? `${el.tagName.toLowerCase()}${parts.join('')}` : null;
}

function render() {
  const [r0, r1] = route();
  if (r0 === 'sample') { loadSample(r1); location.replace('#/wall'); return; }
  if (r0 === 'new') {
    S.draft = { ...blankDraft(), taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null, picks: [] } };
    S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; S.quiz = null;
    resetLayouts(); S.versions = []; location.replace('#/start'); return;
  }
  if (r0 === 'resume') { if (!resumeDraft()) { location.replace('#/start'); return; } location.replace(need() || '#/wall'); return; }
  if (r0 === 'layouts') { location.replace('#/wall'); return; }
  const screens = { community: communityScreen, profile: profileScreen, '': home, start, check, corners, size: sizeScreen, things, pieces, taste, suggest: suggestScreen, wall: wallScreen, frames: framesScreen, get: getScreen, walls, saved: savedScreen, browse: browseScreen };
  const fn = screens[r0] || home;
  document.title = { '': 'Walldrobe', walls: 'Your walls · Walldrobe', community: 'Walls people hung · Walldrobe', saved: 'Saved · Walldrobe', browse: 'Every print · Walldrobe', get: 'Hang it · Walldrobe', suggest: 'Suggestions · Walldrobe', frames: 'Frames · Walldrobe', wall: 'Your wall · Walldrobe', taste: 'Make it mine · Walldrobe', profile: 'Your taste · Walldrobe' }[r0] || 'Walldrobe';
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
  document.body.classList.toggle('on-browse', r0 === 'browse');
  if (S.sheet) { const s = $('#sheet'); if (s && !s.contains(document.activeElement)) (s.querySelector('h2') || s).setAttribute('tabindex', '-1'), (s.querySelector('h2') || s).focus({ preventScroll: true }); }
  else if (sel) { const again = document.querySelector(sel); if (again) again.focus({ preventScroll: true }); }
  wire(r0);
  // One live region outside the app, so messages are announced even though the page re-renders.
  const live = $('#live');
  const say = S.undo ? S.undo.label : S.flash || '';
  if (live && live.textContent !== say) live.textContent = say;
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
  if (r === 'start' && !S.warmed) { S.warmed = true; setTimeout(warm, 800); }
  if (r === 'check') wireCheck();
  if (r === 'corners') wireCorners();
  if (r === 'things') wireThings();
  if (r === 'pieces' && S.draft && S.draft.photo) wireDraw();
  const pi = $('#photo-input');
  if (pi) pi.addEventListener('change', (e) => onPhoto(e.target.files[0]));
  if (r === 'wall' && S.edit) wireEdit();
}

// A close-up above the finger while dragging on a photo, since the finger hides
// the very spot being placed. Shows the photo at 2.5x around the point, with a cross.
// Only for touch and pen; a mouse pointer doesn't cover anything.
function loupeFor(svg, src, imgW, imgH) {
  let el = null;
  const ZOOM = 2.5, SIZE = 120, LIFT = 90;
  const make = () => {
    el = document.createElement('div');
    el.className = 'loupe'; el.setAttribute('aria-hidden', 'true');
    el.style.backgroundImage = `url("${src}")`;
    document.body.appendChild(el);
  };
  return {
    show(e, pt) {
      if (e.pointerType === 'mouse') return;
      if (!el) make();
      const box = (svg.querySelector('image') || svg).getBoundingClientRect();
      const scale = (box.width / imgW) * ZOOM; // screen px per image px, in the loupe
      el.style.backgroundSize = `${imgW * scale}px ${imgH * scale}px`;
      el.style.backgroundPosition = `${SIZE / 2 - pt[0] * scale}px ${SIZE / 2 - pt[1] * scale}px`;
      const x = Math.max(SIZE / 2 + 4, Math.min(window.innerWidth - SIZE / 2 - 4, e.clientX));
      const y = e.clientY - LIFT < SIZE / 2 + 4 ? e.clientY + LIFT : e.clientY - LIFT;
      el.style.left = `${x - SIZE / 2}px`; el.style.top = `${y - SIZE / 2}px`;
      el.style.display = 'block';
    },
    hide() { if (el) el.style.display = 'none'; },
  };
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
    const msg = $('#corner-msg'); msg.textContent = err || 'Drag a dot, and a close-up shows what is under your finger. Tap a dot, then nudge it.'; msg.className = err ? 'error' : 'small pencil';
    const ok = document.querySelector('[data-act="corners-ok"]'); if (ok) ok.disabled = !!err;
  };
  const names = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
  const pick = (i) => {
    S.ui.corner = i;
    svg.querySelectorAll('.handle').forEach((g, j) => g.classList.toggle('is-picked', j === i));
    const who = $('#nudge-who'); if (who) who.textContent = `${names[i]} corner`;
  };
  const loupe = loupeFor(svg, p.src, p.w, p.h);
  dragOn(svg, (e) => {
    const h = e.target.closest('.handle');
    let ctx;
    if (h) ctx = { i: Number(h.dataset.corner) };
    else {
      // A tap on the photo moves the nearest corner there.
      const pt = toImg(e);
      let i = 0, bd = Infinity;
      p.corners.forEach((c, j) => { const dd = Math.hypot(c[0] - pt[0], c[1] - pt[1]); if (dd < bd) { bd = dd; i = j; } });
      p.corners[i] = pt; update();
      ctx = { i, tapped: true };
    }
    pick(ctx.i);
    loupe.show(e, p.corners[ctx.i]);
    return ctx;
  }, (ctx, e) => { p.corners[ctx.i] = toImg(e); ctx.moved = true; update(); loupe.show(e, p.corners[ctx.i]); }, (ctx) => { loupe.hide(); if (ctx.moved || ctx.tapped) cornersChanged(); });
  document.querySelectorAll('[data-nudge]').forEach((b) => b.addEventListener('click', () => {
    const i = S.ui.corner || 0, [dx, dy] = b.dataset.nudge.split(',').map(Number);
    const step = Math.max(1, Math.round(p.w / 400)); // about one screen pixel at phone size
    p.corners[i] = [Math.max(0, Math.min(p.w, p.corners[i][0] + dx * step)), Math.max(0, Math.min(p.h, p.corners[i][1] + dy * step))];
    update(); cornersChanged();
  }));
  svg.querySelectorAll('.handle').forEach((g) => g.addEventListener('focus', () => pick(Number(g.dataset.corner))));
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
  if (f.id === 'share-form') {
    const who = f.elements.who.value, note = f.elements.note.value;
    const withPhoto = f.elements.photo ? f.elements.photo.checked : false;
    if (S.ui.sharing) return;
    const post = makePost(note, who, withPhoto);
    if (!post) return;
    if (store.demoMode) { S.sheet = null; S.flashNext = 'Sample mode: nothing is shared.'; go('#/community'); return; }
    ME.name = who.trim().slice(0, 40); syncMe();
    logE('share', { wall: post.after.key, considered: post.considered.length, note: !!post.note, photo: withPhoto });
    S.ui.sharing = true; render();
    sendPost(post)
      .then(() => { S.flashNext = 'Shared. Anyone can see it on the Walls page.'; })
      .catch((e) => { store.addShared(post); S.flashNext = `Saved on this phone. Sharing failed: ${e.message}. Tap Share it again below.`; })
      .finally(() => { S.ui.sharing = false; S.sheet = null; go('#/community'); });
    return;
  }
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
  if (t.dataset && t.dataset.adjust) { applyAdjust(t.dataset.adjust, t.value); return; }
  if (t.dataset && t.dataset.axis) {
    const d = S.draft, axis = t.dataset.axis, v = t.value;
    if (!d.taste || d.taste.source !== 'yours') d.taste = { source: 'yours', weights: null, picks: [], corrections: [] };
    d.taste.corrections = [...(d.taste.corrections || []).filter((c) => c.axis !== axis), { axis, lean: v === 'none' ? null : v }];
    logE('taste-set', { axis, lean: v });
    resetLayouts(); persist(); render(); return;
  }
  if (t.dataset && t.dataset.filter && S.browse) {
    S.browse[t.dataset.filter] = t.value; S.browse.shown = BROWSE_STEP;
    logE('browse-filter', { filter: t.dataset.filter, value: t.value, count: browseList().length });
    render(); announceCount();
    return;
  }
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
    a.guess = guessWidth(a.items, a.rw, a.tvInches, a.depth, { ...(a.seenOpts || {}), tvPicked: true });
    if (a.guess) ensurePixels().then(() => { setScale(a.guess.inches); applyAuto(); flattenAuto(); resetLayouts(); persist(); render(); });
    return;
  }
  if (t.form && t.form.id === 'dims-form') { changeDims(t.form); return; }
  if (t.dataset.obk) {
    const o = S.draft.obstacles.find((x) => x.id === t.dataset.obid);
    if (o) { if (o.autoId) forgetAuto(o.autoId); o[t.dataset.obk] = Number(t.value); clampOb(o); resetLayouts(); persist(); setTimeout(render, 0); }
  }
  if (t.dataset.ffinish || t.dataset.fmat) {
    const id = t.dataset.ffinish || t.dataset.fmat, fr = S.draft.frames || {};
    const L = shown(), p = L && L.pieces.find((x) => x.ref.id === id);
    const now = p ? frameFor(id, p) : {};
    const next = t.dataset.ffinish ? (t.value.startsWith('color:') ? { finish: 'color', color: t.value.slice(6) } : { finish: t.value, color: null }) : { mat: t.value };
    S.draft.frames = { ...fr, each: { ...(fr.each || {}), [id]: { finish: now.finish, color: now.color, mat: now.mat, ...next } } };
    logE('frames', { piece: id, ...next });
    persist(); setTimeout(render, 0); return;
  }
  if (t.dataset.obkind) {
    const o = S.draft.obstacles.find((x) => x.id === t.dataset.obkind);
    if (o) {
      if (o.autoId) forgetAuto(o.autoId);
      o.kind = t.value; delete o.label;
      // A wall edge runs floor to ceiling, a hair wide, where the box's middle was.
      if (o.kind === 'edge') { const cx = o.x + o.w / 2; o.w = 1; o.x = cx - 0.5; o.y = 0; o.h = S.draft.height; o.fuzz = 0; }
      clampOb(o); resetLayouts(); persist(); setTimeout(render, 0);
    }
    return;
  }
  if (t.dataset.std) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.std);
    const m = /^(\d+)x(\d+)$/.exec(t.value || '');
    if (o && m) { const a = Number(m[1]), b = Number(m[2]); const land = o.w > o.h; o.w = land ? b : a; o.h = land ? a : b; resetLayouts(); persist(); setTimeout(render, 0); }
    return;
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

// Close the open sheet and put focus back on what opened it.
function closeSheet() {
  const was = S.sheet; S.sheet = null; S.selected = null; render();
  const back = was && was.piece ? document.querySelector(`[data-piece="${CSS.escape(was.piece)}"]`)
    : was && was.frame ? document.querySelector(`[data-fpiece="${CSS.escape(was.frame)}"]`)
    : was && was.browse ? document.querySelector(`[data-browse="${CSS.escape(was.browse)}"]`)
    : document.querySelector('[data-act="adjust"]');
  if (back) back.focus({ preventScroll: true });
}

// A piece's sheet: for a new piece that isn't kept, the other art for its spot is found first.
function openPiece(id) {
  const L = shown();
  const p = L && L.pieces.find((x) => x.ref.id === id);
  if (!p) return;
  S.selected = id;
  if (p.ref.source !== 'catalog' || keptSet().has(id)) { S.sheet = { piece: id }; render(); return; }
  S.busy = 'alts'; render();
  setTimeout(() => {
    let alts = [];
    try { alts = swapOptions(id, L); } catch (e) { console.error(e); }
    S.busy = null; S.sheet = { piece: id, alts }; render();
  }, 30);
}
function applyAdjust(k, v) {
  const d = S.draft, f = pool();
  const L = route()[0] === 'wall' ? shown() : null;
  if (L) noteVersion(L);
  if (k === 'fullness') { d.fullness = v; d.pieces = null; }
  else if (k === 'style') d.style = v || null;
  else if (k === 'art') { if (v === 'mine') d.justMine = true; else { d.art = v; d.justMine = false; } }
  else if (k === 'people' || k === 'color') { f[k] = v; d.pool = f; }
  else if (k === 'maxPrice') { f.maxPrice = v === '' ? null : Number(v); d.pool = f; }
  else if (k === 'shop') { f.shops = v === 'any' ? [] : ['desenio', 'houseofspoils', 'free'].filter((x) => x !== v); d.pool = f; }
  logE('shape', { [k]: v });
  rebuild(k);
}

// Browse says how many pieces a filter left, out loud too.
function announceCount() { const c = $('#browse-count'), live = $('#live'); if (c && live) live.textContent = c.textContent; }

// What changing the wall's inputs does to the list: build it again, keep the open wall's place.
function rebuild(name, undo = null) { S.flash = null; S.undo = undo; S.openKey = null; S.sheet = null; S.injected = null; S.focusAfter = undo ? '[data-act="undo"]' : '[data-act="adjust"]'; persist(); render(); }

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .art, a[data-act], a[data-wall], .backdrop');
  if (!t) return;
  const a = t.dataset.act;
  if (t.dataset.wall) {
    const now = S.view ? shown() : null;
    if (now && now.key !== t.dataset.wall) noteVersion(now);
    logWallOpen(t.dataset.wall, 'tap'); S.openKey = t.dataset.wall; S.selected = null; S.undo = null; S.edit = false; S.sheet = null;
    if (location.hash === '#/wall') { e.preventDefault(); render(); } return;
  }
  if (t.dataset.version) { openVersion(t.dataset.version); render(); return; }
  if (t.dataset.alt !== undefined) {
    const alts = S.sheet && S.sheet.alts, a = alts && alts[Number(t.dataset.alt)], id = t.dataset.id;
    const L = shown();
    if (!a || !L) return;
    noteVersion(L);
    const next = { ...a.L, history: L.history, moved: L.moved };
    const d = S.draft, wasSkipped = d.skipped.includes(id);
    if (!wasSkipped) { d.skipped = [...d.skipped, id]; ME.skipped = d.skipped; syncMe(); }
    replaceWall(L.key, next); remember(next);
    logE('swap', { from: id, to: a.came.ref.id, wall: L.key, picked: true });
    S.ui.saved = null; S.sheet = null; S.selected = null; persist();
    const gone = byId.get(id), came = byId.get(a.came.ref.id);
    S.undo = { label: `Swapped ${gone ? gone.title : 'that piece'} for ${came ? came.title : 'another'}.`, run: () => { if (!wasSkipped) { d.skipped = d.skipped.filter((x) => x !== id); ME.skipped = d.skipped; syncMe(); } replaceWall(L.key, L); persist(); } };
    render(); return;
  }
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
      p.auto.guess = { from: opt[0], inches: opt[1], why: noTapeInfo(opt).why };
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
        au.guess = guessWidth(au.items, au.rw, au.tvInches, au.depth, au.seenOpts || {});
        if (au.guess && au.guess.tvWhy === 'others') { au.tvInches = au.guess.tvInches; au.tvWhy = 'others'; }
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
      const was = keepState(o);
      o.keep = t.dataset.keep === 'skip' ? 'skip' : 'must';
      o.loosen = t.dataset.keep === 'maybe';
      if (o.keep !== 'must') o.pinned = false;
      // A piece of yours: only that it was kept or skipped, never its name or photo.
      if (was !== keepState(o)) logE(keepState(o) === 'skip' ? 'skip' : 'keep', { own: true, maybe: !!o.loosen, from: route()[0] || '' });
      S.mem.clean = null;
      if (route()[0] === 'wall') { S.sheet = null; rebuild('keep'); return; }
      resetLayouts(); persist(); render();
    }
    return;
  }
  if (t.dataset.pin) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.pin);
    if (o) {
      const was = { pinned: o.pinned, keep: o.keep }, chosen = S.draft.chosen;
      o.pinned = !o.pinned; o.keep = 'must'; S.mem.clean = null;
      logE('pin', { own: true, on: o.pinned, wall: S.openKey || null });
      rebuild('pin', { label: o.pinned ? `Your ${o.title} stays where it hangs. The walls were built again around it.` : `Your ${o.title} can move again.`, run: () => { Object.assign(o, was); S.draft.chosen = chosen; S.mem.clean = null; S.openKey = chosen ? chosen.layout.key : null; persist(); } });
    }
    return;
  }
  if (t.dataset.look) { const v = LOOKS[t.dataset.look]; S.draft.frames = { mode: 'set', look: t.dataset.look, finish: v.finish, color: v.color || null, profile: v.profile, mat: v.mat, each: {} }; logE('frames', { look: t.dataset.look }); persist(); render(); return; }
  if (t.dataset.fmode) { S.draft.frames = { ...framesNow(), mode: t.dataset.fmode, look: null, each: {} }; logE('frames', { mode: t.dataset.fmode }); persist(); render(); return; }
  if (t.dataset.finish) { S.draft.frames = { ...framesNow(), mode: 'set', look: null, finish: t.dataset.finish, color: t.dataset.finish === 'color' ? framesNow().color || 'blue' : null, each: {} }; logE('frames', { finish: t.dataset.finish }); persist(); render(); return; }
  if (t.dataset.fcolor) { S.draft.frames = { ...framesNow(), mode: 'set', finish: 'color', color: t.dataset.fcolor, each: {} }; logE('frames', { color: t.dataset.fcolor }); persist(); render(); return; }
  if (t.dataset.profile) { S.draft.frames = { ...framesNow(), look: null, profile: t.dataset.profile }; logE('frames', { profile: t.dataset.profile }); persist(); render(); return; }
  if (t.dataset.mat !== undefined) { S.draft.frames = { ...framesNow(), mode: 'set', look: null, mat: t.dataset.mat, each: {} }; logE('frames', { mat: t.dataset.mat }); persist(); render(); return; }
  if (t.dataset.size && t.dataset.id) {
    const id = t.dataset.id, [w, h] = t.dataset.size.split('x').map(Number);
    const L = shown(), p = L && L.pieces.find((x) => x.ref.id === id);
    // Keep the piece's orientation on the wall.
    const land = p && p.w > p.h, W = land ? Math.max(w, h) : Math.min(w, h), H = land ? Math.min(w, h) : Math.max(w, h);
    const prevKept = clone(S.draft.kept || []), prevChosen = S.draft.chosen ? clone(S.draft.chosen) : null, prevOpen = S.openKey;
    noteVersion(L);
    S.draft.kept = [...(S.draft.kept || []).filter((k) => k.id !== id), { id, w: W, h: H }];
    S.draft.chosen = null; S.openKey = null; S.sheet = null; S.flash = null;
    const item = byId.get(id);
    logE('size', { id, w: W, h: H });
    S.undo = { label: `${item ? item.title : 'That piece'} is ${W} x ${H} in now, kept in every wall. The walls were built again around it.`, run: () => { S.draft.kept = prevKept; S.draft.chosen = prevChosen; S.openKey = prevOpen; persist(); } };
    S.focusAfter = '[data-act="undo"]'; persist(); render(); return;
  }
  if (t.dataset.count !== undefined) {
    if (!t.dataset.count) return;
    if (t.dataset.count !== 'any' && S.draft.pieces === Number(t.dataset.count)) return;
    if (t.dataset.count === 'any' && !S.draft.pieces) return;
    const onWall = route()[0] === 'wall', L = onWall ? shown() : (S.view && S.view.list[0]) || null;
    if (onWall && L) noteVersion(L);
    // On an open wall, one more or one fewer keeps the frames already up where they are.
    S.stepBase = L && t.dataset.count !== 'any' ? L.pieces.filter((p) => p.role !== 'pinned').map((p) => (p.slot ? { ...p.slot } : { x: p.x, y: p.y, w: p.w, h: p.h })) : null;
    S.draft.pieces = t.dataset.count === 'any' ? null : Number(t.dataset.count);
    logE('shape', { pieces: S.draft.pieces, from: L ? L.pieces.length : null });
    S.injected = null;
    if (onWall && L) { S.flash = null; S.undo = null; S.sheet = null; S.selected = null; S.focusAfter = '[data-act="adjust"]'; persist(); render(); } else { S.openKey = null; rebuild('count'); }
    return;
  }
  if (t.dataset.save) { toggleSave(t.dataset.save); render(); return; }
  if (t.dataset.askPost) { S.ui.askPost = { id: t.dataset.pid, what: t.dataset.askPost }; render(); return; }
  if (t.dataset.act === 'ask-cancel') { S.ui.askPost = null; render(); return; }
  if (t.dataset.act === 'feed-retry') { S.feed.status = 'idle'; loadFeed(false); render(); return; }
  if (t.dataset.act === 'feed-more') { loadFeed(true); render(); return; }
  if (t.dataset.unshare) {
    const post = findPost(t.dataset.unshare);
    S.ui.askPost = null;
    if (!post) { render(); return; }
    const dropLocal = () => { for (const p of store.listShared()) if (p.id === post.id || (post.remote && p.remote === post.remote)) store.removeShared(p.id); };
    if (!post.remote) { dropLocal(); S.flash = 'Removed.'; render(); return; }
    social.remove(post.remote)
      .then((ok) => {
        S.feed.posts = S.feed.posts.filter((x) => x.remote !== post.remote); S.feed.mine.delete(post.remote); dropLocal();
        S.flash = ok ? 'Removed from the feed.' : 'It was already gone.';
      })
      .catch((e) => { S.flash = `Couldn't remove it: ${e.message}. Try again.`; })
      .finally(render);
    return;
  }
  if (t.dataset.report) {
    const post = findPost(t.dataset.report);
    S.ui.askPost = null;
    if (!post || !post.remote) { render(); return; }
    social.hideForMe(post.remote);
    logE('report', { post: post.remote });
    social.report(post.remote, 'reported in app').catch(() => {});
    S.flash = 'Reported. It is hidden for you.'; render(); return;
  }
  if (t.dataset.reshare) {
    const post = findPost(t.dataset.reshare);
    if (!post || !post.pending || S.ui.sharing) return;
    S.ui.sharing = true; S.flash = 'Sharing...'; render();
    const { pending, mine, ...clean } = post;
    sendPost(clean)
      .then(() => { S.flash = 'Shared. Anyone can see it now.'; })
      .catch((e) => { S.flash = `Still only on this phone: ${e.message}.`; })
      .finally(() => { S.ui.sharing = false; render(); });
    return;
  }
  if (t.dataset.trySet) {
    const post = findPost(t.dataset.trySet);
    if (!post || !S.draft) return;
    // Their new pieces, kept in every one of your walls at the sizes they used.
    const fresh = post.after.pieces.filter((p) => p.ref.source === 'catalog' && byId.get(p.ref.id));
    S.draft.kept = [...(S.draft.kept || []).filter((k) => !fresh.some((p) => p.ref.id === k.id)), ...fresh.map((p) => ({ id: p.ref.id, w: p.w, h: p.h }))];
    S.draft.justMine = false; S.draft.chosen = null; S.openKey = null; resetLayouts(); persist();
    logE('try-set', { post: post.id, n: fresh.length });
    S.flashNext = `${fresh.length} piece${fresh.length === 1 ? '' : 's'} from that wall, kept in every wall of yours. Tap one to let it go.`;
    go('#/wall'); return;
  }
  if (t.dataset.turn) { const o = S.draft.owned.find((x) => x.id === t.dataset.turn); if (o) { [o.w, o.h] = [o.h, o.w]; resetLayouts(); persist(); render(); } return; }
  if (t.dataset.try) { tryOnWall(t.dataset.try); return; }
  if (t.dataset.addPast) {
    const a = ME.art.find((x) => x.id === t.dataset.addPast);
    if (a) { S.draft.owned.push({ id: a.id, title: a.title, w: a.w, h: a.h, keep: 'must', pinned: false, thumb: a.thumb || undefined, color: a.color || '#8A8F94', palette: a.palette || [{ hex: a.color || '#8A8F94', weight: 1 }], fromPhoto: false }); resetLayouts(); persist(); render(); }
    return;
  }
  if (t.dataset.forgetArt) { ME.art = ME.art.filter((x) => x.id !== t.dataset.forgetArt); syncMe(); render(); return; }
  if (t.dataset.browse) { S.sheet = { browse: t.dataset.browse }; render(); return; }
  if (t.dataset.piece) { openPiece(t.dataset.piece); return; }
  if (t.dataset.fpiece) { S.sheet = { frame: t.dataset.fpiece }; render(); return; }
  if (t.dataset.funset) { const f = framesNow(); const each = { ...(f.each || {}) }; delete each[t.dataset.funset]; S.draft.frames = { ...f, each }; persist(); render(); return; }
  if (t.dataset.pick) {
    const q = S.quiz; const [x, y] = q.pair; const winner = x.id === t.dataset.pick ? x : y;
    q.picks.push({ winner, loser: winner === x ? y : x });
    logE('quiz-pick', { winner: winner.id, loser: (winner === x ? y : x).id });
    advanceQuiz(true); return;
  }
  if (t.dataset.open) {
    const w = store.getWall(t.dataset.open);
    if (w) { S.draft = upgradeDraft(w); S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; resetLayouts(); loadVersions(); persist(); ensurePixels().then(() => { S.mem.clean = null; render(); }); go('#/wall'); }
    return;
  }
  if (t.dataset.askDelete) { S.ui.confirmDelete = t.dataset.askDelete; render(); return; }
  if (t.dataset.delete) {
    store.deleteWall(t.dataset.delete);
    if (S.draft && S.draft.id === t.dataset.delete) { S.draft = null; store.clearDraft(); }
    S.ui.confirmDelete = null; S.flash = store.demoMode ? 'Sample mode: nothing is deleted.' : 'Deleted, with its photo.'; render(); return;
  }
  if (S.edit && t.classList.contains('art')) return;
  if (t.classList.contains('art') && route()[0] === 'wall') { openPiece(t.dataset.id); return; }
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
    case 'quiz-skip': if (S.quiz) logE('skip', { ids: S.quiz.pair.map((x) => x.id), from: 'quiz' }); advanceQuiz(false); break;
    case 'quiz-done': finishQuiz(); break;
    case 'retry-save': persist(); if (!S.saveFailed) S.flash = 'Saved.'; render(); break;
    case 'adjust': S.sheet = 'adjust'; render(); break;
    case 'share': S.sheet = 'share'; render(); break;
    case 'close-sheet': closeSheet(); break;
    case 'keep': {
      const id = t.dataset.id, prevKept = clone(S.draft.kept || []), prevChosen = S.draft.chosen ? clone(S.draft.chosen) : null;
      toggleKeep(id);
      const item = byId.get(id), on = (S.draft.kept || []).some((k) => k.id === id);
      S.openKey = S.draft.chosen ? S.draft.chosen.layout.key : null; S.flash = null; S.sheet = null; S.focusAfter = '[data-act="undo"]';
      S.undo = { label: on ? `${item ? item.title : 'That piece'} is kept in every wall. The others were built again around it.` : `${item ? item.title : 'That piece'} isn't kept any more.`, run: () => { S.draft.kept = prevKept; S.draft.chosen = prevChosen; S.openKey = prevChosen ? prevChosen.layout.key : null; persist(); } };
      render(); break;
    }
    case 'put-back': {
      const L = shown(), v = S.view;
      const orig = L && v.orig && v.orig[L.key];
      if (orig) { const now = L; noteVersion(L); replaceWall(L.key, orig); delete v.orig[L.key]; S.undo = { label: 'Put back the way it was first built.', run: () => replaceWall(now.key, now) }; persist(); }
      S.sheet = null; render(); break;
    }
    case 'letgo': {
      const id = t.dataset.id; S.flash = null; S.sheet = null; S.selected = null;
      S.busy = 'letgo'; render();
      setTimeout(() => { try { letGo(id); } finally { S.busy = null; S.focusAfter = '[data-act="undo"]'; render(); } }, 30);
      break;
    }
    case 'refresh': {
      S.flash = null; S.busy = 'refresh'; render();
      setTimeout(() => { try { refreshArt(); } finally { S.busy = null; S.sheet = null; S.selected = null; render(); const u = document.querySelector('[data-act="undo"]'); if (u) u.focus({ preventScroll: true }); } }, 30);
      break;
    }
    case 'undo': if (S.undo) { S.undo.run(); S.undo = null; S.flash = null; render(); } break;
    case 'edit': S.edit = !S.edit; S.sheet = null; S.selected = null; S.flash = null; if (S.edit) S.measure = true; render(); break;
    case 'measure': S.measure = !S.measure; S.sheet = null; render(); break;
    case 'undo-move': case 'undo-all': { const L = shown(); if (L) { noteVersion(L); undoMove(L, a === 'undo-all'); } S.sheet = null; S.flash = null; render(); break; }
    case 'retry': resetLayouts(); S.mem.clean = null; render(); break;
    case 'save': saveThisWall(); render(); break;
    case 'get': { const G = shown(); if (G) logE('get-wall', { wall: G.key, pieces: G.pieces.filter((p) => p.ref.source === 'catalog').map((p) => p.ref.id), own: G.pieces.filter((p) => p.ref.source !== 'catalog').length }); }
      S.draft.chosen = { layout: bareLayout(shown()), inputKey: viewKey() }; persist(); go('#/get'); break;
    case 'print': window.print(); break;
    case 'cancel-delete': S.ui.confirmDelete = null; render(); break;
    case 'browse-more': {
      const from = S.browse.shown;
      S.browse.shown += BROWSE_STEP; S.browse.focusFrom = from; render(); S.browse.focusFrom = null;
      // Focus goes to the first of the new pieces, so a keyboard carries on from there.
      const first = document.querySelector('[data-first-new] .tile-open');
      if (first) first.focus({ preventScroll: true });
      break;
    }
    case 'browse-clear': {
      Object.assign(S.browse, { size: 'any', color: 'any', shop: 'any', shown: BROWSE_STEP });
      logE('browse-filter', { filter: 'clear', count: browseList().length });
      render(); announceCount(); const f = $('#f-size'); if (f) f.focus({ preventScroll: true }); break;
    }
    case 'clear-events': store.clearEvents(); S.flash = 'Cleared.'; render(); break;
    default: break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) { closeSheet(); return; }
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
  if (t && route()[0] === 'wall' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPiece(t.dataset.id); return; }
});

let lastW = 0;
window.addEventListener('resize', () => {
  const d = $('#drawing') || $('.drawing');
  if (!d) return;
  if (Math.abs(d.clientWidth - lastW) > 40) { lastW = d.clientWidth; if (['suggest', 'wall', 'frames'].includes(route()[0])) render(); }
});
// An image that doesn't load says so, instead of leaving a blank box.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const box = img.closest('.thumb, .art-big, .pick-art, .tile-art, .big-art');
  if (box) { box.classList.add('is-missing'); img.remove(); }
}, true);
// iOS needs a touch listener for :active press states.
document.addEventListener('touchstart', () => {}, { passive: true });

// Open where they left off: pixels for a saved photo load in the background.
ensurePixels().then(() => { S.mem.clean = null; if (['suggest', 'wall', 'frames', 'get'].includes(route()[0])) render(); }).catch(() => {});
render();

