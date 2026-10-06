// Walldrobe, the site (v2). One wall at a time: a photo, its corners, one
// screen to confirm what we found, then a ranked list of finished walls on your
// own photo, and the hanging guide for the one you pick.
// Screens are plain functions that return HTML; every change re-renders.
// Design rules: DESIGN.md. Product rules: PRODUCT.md. States: STATES.md.

import { layout, refill, rerank, spotChoices, scoreArrangement, RULES, assignMats, assignHome } from '../engine/index.js';
import { blockedRegions, checkPieces, FURNITURE } from '../engine/geometry.js';
import { fitTaste, scoreTaste, nextPair, subjectStats, subjectFactor, subjectOf, dislikeFactor, tasteKnown, describeTaste, axesOf, looksGood } from '../engine/taste.js';
import { toCandidate, activeRecords } from '../engine/catalog.js';
import { normalizePalette, paletteSimilarity } from '../engine/color.js';
import { WALLS as SAMPLES, SAMPLE_PICKS } from '../demo/samples.js';
import { esc, inches, feet, wallSvg, wallPoint, KIND_NAME, obName, labelSize, setPrintFor, setFrameColorFor } from './draw.js';
import { aspectFromCorners, cornerProblem, flatten, paintOut, palette, crop, photoQuality, loadFile, toDataUrl, fromDataUrl, homography, apply, findArtBox, wallTone } from './photo.js';
import { readWall, guessWidth, labToRgb, suggestWall, otherWalls, tvDepthFactor, hiddenFromFor, TV_SIZES } from './detect.js';
import * as store from './store.js';
import { PRICES_CHECKED, PRINTERS, printOptions, picks as printPicks, aiQuestion, sizeKey } from './printers.js';
import { FRAMES_CHECKED, FRAMERS, frameOptions, framePicks, framesTable, frameKey, sizesIn } from './framers.js';
import { segment, modelCached } from './segment.js';
import { packLabels, unpackLabels } from './segcore.js';
import { cameraPose, standOut, DEPTH } from './camera.js';

const QUIZ_LENGTH = 10;
const WALLS_ASKED = 24; // walls built once per wall; the list shows the distinct ones
// The build keeps a shop link that is the page plus a variant as just the variant: put the page back.
for (const r of window.WALLDROBE_CATALOG.items) for (const o of r.offers || []) { if (!o.url && o.vid) o.url = `${r.source.page}?variant=${o.vid}`; if (!o.currency) o.currency = 'USD'; }
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
  openKey: store.loadDraft() && store.loadDraft().openKey || null, // the wall that's open, kept across visits
  selected: null,
  edit: false, // moving pieces by hand
  sheet: null, // null, 'change', or { piece: id }
  undo: null, // { label, run } the last change, until the next one
  measure: false,
  flash: null,
  busy: null,
  seen: new Map(),
  memo: new Map(), // views by their inputs, so stepping back brings the same walls back
  stepBase: null, // the frames up now, when one more or one fewer is asked for on an open wall
  mem: { photo: null, flat: null, clean: null, cleanKey: null },
  ui: { cornerErr: null, quality: null, sizeErr: null, drawing: null, confirmDelete: null, saved: null, photoErr: null, fix: null },
};

function blankDraft() {
  return {
    id: store.newId(), name: 'My wall', sample: null, width: null, height: null,
    photo: null, obstacles: [], owned: [], room: null,
    taste: { source: 'none', weights: null, picks: [] }, kept: [], saved: [...store.loadMe().saved], skipped: [], chosen: null, fullness: 'balanced', justMine: false,
  };
}
// Sample rooms are never written over your own wall in progress.
function persist() {
  if (!S.draft || S.draft.sample) return true;
  const ok = store.saveDraft(S.draft);
  S.saveFailed = !ok;
  return ok;
}
function resetLayouts() { S.view = null; S.memo = new Map(); S.stepBase = null; S.openKey = null; S.selected = null; S.edit = false; S.sheet = null; S.undo = null; S.seen = new Map(); S.ui.saved = null; }
// Back to your own wall after looking at a sample.
function resumeDraft() {
  const d = store.loadDraft();
  if (d && !d.sample) { S.draft = d; S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; resetLayouts(); S.openKey = d.openKey || null; ensurePixels().then(render).catch(() => {}); return true; }
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
    owned: w.owned.map((p) => ({ ...clone(p), keep: 'must', color: p.color, fromPhoto: false, ...(p.photo && byId.get(p.photo) ? { thumb: byId.get(p.photo).imageData, art: true } : {}) })),
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
  // Keep, Maybe (happy) or Skip; older keep settings become Keep.
  for (const o of d.owned || []) if (o.keep !== 'skip' && o.keep !== 'happy') { if (o.keep !== 'must') o.pinned = false; o.keep = 'must'; }
  return d;
}
upgradeDraft(S.draft);

// ---------- Router ----------

const route = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
window.addEventListener('popstate', () => {
  if (S.ui.ownBack) { S.ui.ownBack = false; return; }
  if (S.sheet) { S.ui.sheetStep = false; S.sheet = null; S.selected = null; S.ui.allFor = null; render(); }
});
window.addEventListener('hashchange', () => { S.mem.under = null; S.flash = null; S.ui.copied = null; S.ui.cornerErr = null; S.ui.sizeErr = null; S.sheet = null; render(); window.scrollTo(0, 0); });

// ---------- Shell ----------

// One bar at the top: where you are on the left, one action on the right.
function bar(left, right = '') {
  return `<header class="bar"><div class="bar-l">${left}</div><div class="bar-r">${right}</div></header>
  ${store.demoMode ? '<p class="demo-note">Sample walls. Nothing is saved.</p>' : ''}
  ${S.saveFailed ? `<div class="note is-error" role="alert"><p>Didn't save on this device. It may be full; deleting an old wall under Your walls frees space. Your wall is still here until you close the page.</p><button type="button" class="btn quiet small" data-act="retry-save">Try again</button></div>` : ''}`;
}
const wordmark = () => '<a class="wordmark" href="#/" aria-label="Walldrobe"><span class="tab" aria-hidden="true"></span>walldrobe</a>';
const yourWalls = () => { const n = store.listWalls().length; return n ? `<a class="walls-link" href="#/walls">Your walls ${n}</a>` : ''; };
const back = (href, label) => `<a class="back" href="${href}"><span aria-hidden="true">‹</span> ${esc(label)}</a>`;
// The front page's small print: where things live and where the art comes from.
function credits() {
  // The app site's free tier doesn't say where the art comes from: that's the full plan.
  if (locked()) {
    return `<footer class="credits">
    <p>Plan the wall here for free. The full plan says where each piece is from and where to print and frame it.</p>
    <p>Your room photo never leaves your device. Walls you save go to your account when you sign in, private until you share one.</p>
  </footer>`;
  }
  return `<footer class="credits">
    <p>Plan the wall here. Each piece links to the shop that sells it, or to the free photo. Soon you'll get it all in one order.</p>
    <p>Your photos and picks never leave <em>your device</em>.</p>
  </footer>`;
}
const flashHtml = () => (S.flash ? `<p class="flash">${esc(S.flash)}</p>` : '');

// ---------- Quick questions ----------
// Asked in the list of walls, one at a time, never in the way: what the room is like,
// real scenes or abstract, busy or quiet. Each answer leans the art (an axis of taste,
// 0 to 1 on every piece) for every wall; Skip asks nothing more of it. Kept for you, not per wall.
const ASK = [
  { id: 'room', q: 'What is the room like?', opts: [
    ['light', 'Calm and light', { busy: -1, light: 1 }], ['wood', 'Warm, with wood', { warm: 1 }],
    ['bold', 'Bold and colorful', { vivid: 1 }], ['moody', 'Dark and moody', { light: -1 }]] },
  { id: 'real', q: 'Real scenes or abstract?', opts: [['real', 'Real scenes', { abstract: -1 }], ['abstract', 'Abstract', { abstract: 1 }], ['both', 'Both', {}]] },
  { id: 'busy', q: 'Busy art or quiet art?', opts: [['quiet', 'Quiet', { busy: -1 }], ['busy', 'Busy', { busy: 1 }], ['both', 'A mix', {}]] },
];
const asked = () => store.loadMe().asked || {};
function askLeans() {
  const a = asked(), out = {};
  for (const q of ASK) { const o = q.opts.find((x) => x[0] === a[q.id]); if (o) for (const [k, v] of Object.entries(o[2])) out[k] = (out[k] || 0) + v; }
  return out;
}
// A piece's taste times how well it sits with the answers: up to 1.3 when it does, 0.7 when it doesn't.
function askFactor(c, leans) {
  let f = 1;
  const ax = axesOf(c);
  for (const [k, v] of Object.entries(leans)) { if (!v || ax[k] == null) continue; const t = v > 0 ? ax[k] : 1 - ax[k]; f *= 0.7 + 0.6 * t; }
  return f;
}
function askCard() {
  const a = asked(), q = ASK.find((x) => !(x.id in a));
  if (!q) return '';
  return `<li class="taste-card ask-card"><div class="taste-link is-text"><span class="taste-text"><span class="name" id="ask-${q.id}">${esc(q.q)}</span>
    <span class="seg budget-seg" role="group" aria-labelledby="ask-${q.id}">${q.opts.map(([k, label]) => `<button type="button" data-ask="${q.id}" data-v="${k}">${esc(label)}</button>`).join('')}<button type="button" data-ask="${q.id}" data-v="">Skip</button></span>
    <span class="pencil small">${ASK.indexOf(q) + 1} of ${ASK.length}. Every wall leans that way.</span></span></div></li>`;
}

// ---------- Engine ----------

// Keep or skip: a piece you keep is in every wall and may move; pinned, it stays where it hangs.
const keptOwned = () => S.draft.owned.filter((o) => o.keep !== 'skip');
function engineInput() {
  const d = S.draft;
  const owned = keptOwned().map((p) => ({
    id: p.id, title: p.title, w: p.w, h: p.h, keep: p.loosen || p.keep === 'happy' ? 'happy' : 'must', drop: p.drop,
    pinned: !!(p.pinned && p.at), at: p.at || undefined,
    palette: p.palette && p.palette.length ? p.palette : p.color ? [{ hex: p.color, weight: 1 }] : undefined,
  }));
  const keptIds = new Set(keepList().map((k) => k.id));
  // Shop prints, free art or both (prints lean ahead a little); your own pieces only, when asked.
  const mode = artMode();
  const isShop = (c) => c.offers && c.offers.length > 0;
  // A piece you said is not for you never comes back, on any wall.
  const no = notForMe();
  const catalog = d.justMine ? [] : CATALOG.filter((c) => !no.has(c.id) && (keptIds.has(c.id) || mode === 'both' || (mode === 'prints' ? isShop(c) : !isShop(c))));
  const taste = scoreTaste(d.taste.weights, catalog);
  // Shop prints lean ahead a little, the ones you frame yourself: a print sold only framed
  // comes in the shop's frame, so your frame color, width and mats can't touch it.
  const framesItself = (c) => c.sizes.some((z) => !z.framed);
  if (mode === 'both') for (const c of catalog) if (isShop(c) && framesItself(c) && taste[c.id] != null) taste[c.id] = Math.min(1, taste[c.id] + 0.08);
  // This wall's color lean: warm in one room, cool in the next. Black and white sits in the middle.
  if (d.tone === 'warm' || d.tone === 'cool') for (const c of catalog) { const w = axesOf(c).warm, t = d.tone === 'warm' ? w : 1 - w; if (taste[c.id] != null) taste[c.id] = Math.min(1, Math.max(0, taste[c.id] * (0.55 + 0.9 * t))); }
  // What you said about the room and the art.
  const leans = askLeans();
  if (Object.keys(leans).length) for (const c of catalog) if (taste[c.id] != null) taste[c.id] = Math.min(1, Math.max(0, taste[c.id] * askFactor(c, leans)));
  const room = d.room && d.room.length ? { palette: d.room } : undefined;
  // Art you picked for a spot goes in first on other walls too, where its size fits.
  const ids = new Set(catalog.map((c) => c.id));
  const prefer = (d.picked || []).filter((x) => ids.has(x) && !keptIds.has(x));
  return { wall: { width: d.width, height: d.height }, obstacles: trueObs(d), owned, catalog: shapeCatalog(catalog), taste, room, count: WALLS_ASKED, base: S.stepBase || undefined, prefer,
    // The piece count is everything on the wall, pieces that stay put included.
    prefs: { budget: d.budget || undefined, mats: matLevel() === 'none' ? 'none' : undefined, matLevel: matLevel(), fullness: d.fullness || 'balanced', style: d.style || undefined, pieces: d.pieces ? Math.max(1, d.pieces - stayCount()) : undefined } };
}
const keepList = () => (S.draft.justMine ? [] : S.draft.kept || []);
const ART_MODES = ['prints', 'both', 'photos'];
// Shop prints and free photos together by default: buy a few, print the rest yourself.
const artMode = () => (ART_MODES.includes(S.draft && S.draft.art) ? S.draft.art : 'both');
const stayCount = () => S.draft.owned.filter((o) => o.pinned && o.at && o.keep !== 'skip').length;
const keptSet = () => new Set(keepList().map((k) => k.id));
// 'frames1': walls built before frames took their outside size on the wall aren't brought back.
const viewKey = () => JSON.stringify(['frames1', asked(), matLevel() === 'none', widthKey(), S.draft.budget || null, S.draft.budget ? [matLevel(), lookOf(), S.draft.colorFor || null, haveFrameKeys().join()] : null, S.draft.tone || null, S.draft.id, S.draft.width, S.draft.height, S.draft.obstacles, S.draft.owned.map((p) => [p.id, p.title, p.w, p.h, p.keep, p.pinned, p.loosen, p.at, p.color, p.palette]), S.draft.taste.weights, keepList().map((k) => k.id), S.draft.fullness, S.draft.justMine, S.draft.style || null, S.draft.pieces || null, artMode()]);
const notForMe = () => new Set(store.loadMe().disliked);
const rankKey = () => JSON.stringify([S.draft.saved, S.draft.skipped, [...notForMe()]]);

// Saves and swaps tell us what you like: a saved piece beats one you swapped away.
function rankTaste() {
  const d = S.draft;
  const no = [...notForMe()];
  if (!d.saved.length && !d.skipped.length && !no.length) return null;
  const pairs = [];
  // Each favorite against each piece swapped away or not for you. Only your latest four
  // favorites count, so a dislike doesn't weigh more just because the favorites list is long.
  for (const w of d.saved.slice(-4)) for (const l of [...d.skipped, ...no, ...no]) { const a = byId.get(w), b = byId.get(l); if (a && b) pairs.push({ winner: a, loser: b }); }
  const quiz = (d.taste.picks || []).map(([w, l]) => ({ winner: byId.get(w), loser: byId.get(l) })).filter((x) => x.winner && x.loser);
  const ids = new Set(S.view.all.flatMap((L) => L.pieces.filter((p) => p.ref.source === 'catalog').map((p) => p.ref.id)));
  const pool = CATALOG.filter((c) => ids.has(c.id));
  const t = pairs.length ? scoreTaste(fitTaste([...quiz, ...pairs]), pool) : scoreTaste(d.taste.weights, pool);
  // What a piece is of counts too: subjects you save lift it, subjects you swap away pull it down.
  const st = subjectStats({ picks: quiz, saved: d.saved, skipped: d.skipped, disliked: no }, byId);
  // Art like a piece that's not for you comes up less, by how alike they are.
  const noItems = no.map((id) => byId.get(id)).filter(Boolean);
  const leans = askLeans();
  for (const c of pool) if (t[c.id] != null) t[c.id] = Math.min(1, t[c.id] * subjectFactor(st, null, subjectOf(c)) * dislikeFactor(c, noItems) * askFactor(c, leans));
  return t;
}

function run() {
  const key = viewKey();
  if (!(S.view && S.view.key === key)) {
    // Walls seen at this count (or kind, or how full, or art) come back as they were, swaps and all.
    if (S.view) S.memo.set(S.view.key, { view: S.view, openKey: S.openKey });
    const back = S.memo.get(key);
    // An Undo that names the wall to land on wins; otherwise the wall that was open there.
    if (back) { S.view = { ...back.view, key }; S.memo.delete(key); if (!(S.openKey && back.view.list.some((L) => L.key === S.openKey))) S.openKey = back.openKey; S.stepBase = null; }
    else build(key);
  }
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
  // Too full for this wall: step down, Full to Balanced to Calm, and say so.
  if (!r.layouts.length) {
    const base = engineInput(), from = base.prefs.fullness || 'balanced';
    for (const f of { full: ['balanced', 'calm'], balanced: ['calm'] }[from] || []) {
      const again = layout({ ...base, prefs: { ...base.prefs, fullness: f }, keep: keepList() });
      if (again.layouts.length) { r = again; problems.unshift({ code: 'LOOSENED', message: `${from === 'full' ? 'Full' : 'Balanced'} doesn't fit this wall, so these are ${f}.` }); break; }
    }
  }
  // Nothing under the budget as asked: keep looking before giving up. Fewer pieces first,
  // then a calmer wall, then no mats, then free art, then two free pieces; the first that works is
  // shown, and the note says what changed.
  if (!r.layouts.length && S.draft.budget && r.problems.some((p) => p.code === 'BUDGET_TOO_LOW')) {
    const base = engineInput();
    const tries = [
      ...(base.prefs.pieces ? [['with fewer pieces', { pieces: undefined }]] : []),
      ...(base.prefs.fullness !== 'calm' ? [['calmer, with fewer pieces', { pieces: undefined, fullness: 'calm' }]] : []),
      ['calmer and without mats', { pieces: undefined, fullness: 'calm', mats: 'none', matLevel: 'none' }],
    ];
    // Then free art, the cheapest art there is: as asked, calmer without mats, and at last
    // just two pieces, so a small budget still gets a wall.
    const d = S.draft, was = { art: d.art, justMine: d.justMine };
    let free = null;
    if (artMode() !== 'photos' && !d.justMine) { d.art = 'photos'; free = engineInput(); Object.assign(d, was); }
    if (free) tries.push(
      ['made with free art', {}, free],
      ['made with free art, calmer and without mats', { pieces: undefined, fullness: 'calm', mats: 'none', matLevel: 'none' }, free],
    );
    tries.push(['two pieces of free art, without mats', { pieces: 2, fullness: 'calm', mats: 'none', matLevel: 'none' }, free || base]);
    for (const [words, change, from = base] of tries) {
      const again = layout({ ...from, prefs: { ...from.prefs, ...change }, keep: keepList() });
      if (again.layouts.length) { r = again; problems.unshift({ code: 'LOOSENED', message: `Nothing fit $${S.draft.budget.toLocaleString('en-US')} as you set it, so these walls are ${words}.` }); break; }
    }
  }
  let all = r.layouts;
  // A tight wall makes few walls at one fullness: add the ones the other two
  // make, after these, so there's always a real list to choose from.
  if (all.length && rerank(all, { distinct: true }).length < 8) {
    const mine = S.draft.fullness || 'balanced';
    for (const f of ['full', 'calm', 'balanced'].filter((x) => x !== mine)) {
      const base = engineInput();
      const more = layout({ ...base, prefs: { ...base.prefs, fullness: f }, keep: keepList() }).layouts;
      const have = new Set(all.map((L) => L.key));
      all = all.concat(more.filter((L) => !have.has(L.key)).map((L) => ({ ...L, score: (L.score || 0) - 0.05, other: f })));
    }
  }
  // Walls you changed (a swap, a frame off, pieces moved) come back as you left them.
  const edits = S.draft.edits || {};
  all = all.map((L) => (edits[L.key] && edits[L.key].inputKey === key ? { ...edits[L.key].layout, key: L.key } : L));
  // A saved wall opens on the wall you chose, if it still fits.
  const chosen = S.draft.chosen;
  if (chosen && chosen.inputKey === key) all = [chosen.layout, ...all.filter((L) => L.key !== chosen.layout.key)];
  S.view = { key, all, list: [], rankKey: null, counts: (r.counts || []).map((c) => c + stayCount()), problems: problems.concat(r.problems.filter((p) => !problems.includes(p))) };
  S.stepBase = null;
  for (const L of all) remember(L);
}
// A wall's main subject among its new pieces (flowers, horses), when one has more than any other.
function mainSubject(L) {
  const n = new Map();
  for (const p of L.pieces) { if (p.ref.source !== 'catalog') continue; const c = byId.get(p.ref.id), k = c && c.record && c.record.category; if (k) n.set(k, (n.get(k) || 0) + 1); }
  const top = [...n].sort((a, b) => b[1] - a[1]);
  return top.length && (top.length === 1 || top[0][1] > top[1][1]) ? top[0][0] : null;
}
const CHEAP_WALL = 400;
// A wall's price all in, priced as that wall (its own mats), not the one that's open.
function priceOfWall(L) { const was = PRICE_L; PRICE_L = L; try { return wallPrices(L); } finally { PRICE_L = was; } }
function rank() {
  const v = S.view;
  purgeNotForMe();
  const before = v.list.map((L) => L.key);
  const tasteNow = rankTaste();
  v.list = rerank(v.all.filter((L) => !L.extra), { taste: tasteNow, saved: S.draft.saved, skipped: S.draft.skipped, distinct: true });
  // Lead with the walls that show what this can do. Unless you asked for a calm wall or a
  // count, the first three are the best walls with the most new art this wall can take (three
  // pieces or more when it fits). A wall that only moves
  // your own pieces never leads. The rest follow in their order.
  const d0 = S.draft;
  if (d0.fullness !== 'calm' && !d0.pieces && !d0.justMine) {
    const fresh = (L) => L.pieces.filter((p) => p.ref.source === 'catalog').length;
    const most = Math.min(3, Math.max(0, ...v.list.filter((L) => L.variant !== 'asis').map(fresh)));
    // Three different leads: a wall whose main subject a lead already has waits, when there are others.
    const pool = most ? v.list.filter((L) => L.variant !== 'asis' && fresh(L) >= most) : [];
    const rich = [], subjects = new Set();
    for (const L of pool) { if (rich.length >= 3) break; const k = mainSubject(L); if (k && subjects.has(k)) continue; rich.push(L); if (k) subjects.add(k); }
    for (const L of pool) { if (rich.length >= 3) break; if (!rich.includes(L)) rich.push(L); }
    const lead = new Set(rich);
    const rest = v.list.filter((L) => !lead.has(L));
    v.list = [...rich, ...rest.filter((L) => fresh(L) > 0 || L.variant === 'asis'), ...rest.filter((L) => !fresh(L) && L.variant !== 'asis')];
    v.list.forEach((L, i) => { L.rank = i + 1; });
  }
  // With no budget, the first three aren't all pricey: when each is over CHEAP_WALL all in,
  // the best wall under it with new art comes third.
  if (!d0.budget && !d0.justMine && v.list.length > 3) {
    const cost = (L) => { const c = priceOfWall(L); return c.unknown ? Infinity : c.art + c.frames; };
    if (v.list.slice(0, 3).every((L) => cost(L) > CHEAP_WALL)) {
      const i = v.list.findIndex((L, j) => j >= 3 && L.variant !== 'asis' && L.pieces.some((p) => p.ref.source === 'catalog') && cost(L) <= CHEAP_WALL);
      if (i > 0) { const [L] = v.list.splice(i, 1); v.list.splice(2, 0, L); v.list.forEach((x, k) => { x.rank = k + 1; }); }
    }
  }
  // Walls made with Show more go at the end, newest batch last, so they show up where you asked for them.
  // They're kept even when they look like one above at a glance: new art in the same frames is the point.
  const extras = v.all.filter((L) => L.extra);
  if (extras.length) {
    const ranked = rerank(extras, { taste: tasteNow, saved: S.draft.saved, skipped: S.draft.skipped, distinct: false });
    v.list = [...v.list, ...ranked.sort((a, b) => a.extra - b.extra)];
    v.list.forEach((L, i) => { L.rank = i + 1; });
  }
  // A saved wall leads, the way it was left; a wall you kept a piece on stays where it was.
  // It's never folded away as a look-alike of another wall.
  if (S.draft.chosen && v.all[0] && S.draft.chosen.layout.key === v.all[0].key && !v.list.some((L) => L.key === v.all[0].key)) v.list.unshift(v.all[0]);
  const chosen = S.draft.chosen && v.all[0] && S.draft.chosen.layout.key === v.all[0].key ? v.list.findIndex((L) => L.key === v.all[0].key) : -1;
  const at = S.draft.chosen && typeof S.draft.chosen.at === 'number' ? S.draft.chosen.at : 0;
  if (chosen >= 0 && chosen !== at) { const [c] = v.list.splice(chosen, 1); v.list.splice(Math.min(at, v.list.length), 0, c); v.list.forEach((L, i) => { L.rank = i + 1; }); }
  if (v.hold) {
    // The wall you're changing is never folded away as a look-alike of another.
    if (!v.list.some((L) => L.key === v.hold.key)) { const h = v.all.find((L) => L.key === v.hold.key); if (h) v.list.splice(Math.min(v.hold.i, v.list.length), 0, h); }
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
  return v.list.find((L) => L.key === S.openKey) || v.list[0] || null;
}
// A wall changed (swapped, moved): it replaces the one it came from.
function replaceWall(key, next, { quiet = false } = {}) {
  const v = S.view;
  // The wall as it was first built, for "put it back".
  v.orig = v.orig || {};
  if (!v.orig[key]) { const was = v.all.find((L) => L.key === key); if (was) v.orig[key] = was; }
  v.all = v.all.map((L) => (L.key === key ? { ...next, key } : L));
  // Kept on the device by the inputs it was built from, so leaving and coming back finds it as you left it.
  const edits = { ...(S.draft.edits || {}) };
  delete edits[key];
  edits[key] = { inputKey: v.key, layout: bareLayout({ ...next, key }) };
  const keys = Object.keys(edits);
  for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete edits[k];
  S.draft.edits = edits;
  v.rankKey = null;
  if (quiet) return;
  holdOpen(key);
  S.openKey = key;
}
// Every wall in the list that has a piece you said is not for you gets another print
// in that frame; a wall with no other print for it leaves the list. Returns what it changed.
function purgeNotForMe() {
  const v = S.view, no = notForMe();
  if (!v || !no.size) return [];
  const changed = [];
  const input = engineInput();
  for (const L of [...v.all]) {
    const bad = L.pieces.filter((p) => p.ref.source === 'catalog' && no.has(p.ref.id));
    if (!bad.length) continue;
    let cur = L, ok = true;
    for (const p of bad) {
      let r = null;
      try { r = refill({ ...input, keep: keepList() }, cur, { swap: p.ref.id }); } catch (e) { r = null; }
      if (!r || !r.layouts.length) { ok = false; break; }
      cur = { ...r.layouts[0], history: L.history, moved: L.moved };
    }
    changed.push([L.key, L]);
    if (ok) { replaceWall(L.key, cur, { quiet: true }); remember(cur); }
    else { v.all = v.all.filter((x) => x.key !== L.key); v.list = v.list.filter((x) => x.key !== L.key); }
  }
  return changed;
}
// Not for me: this print never comes back on any wall, art like it comes up less,
// and the frame it was in gets another print. Undo puts everything back.
function notForThis(id) {
  const d = S.draft, v = S.view;
  const me = store.loadMe();
  const wasSaved = d.saved.includes(id), wasMeSaved = me.saved.includes(id);
  const prevKept = clone(d.kept || []), prevOpen = S.openKey;
  const prevAll = v.all.slice(), prevList = v.list.slice(), prevEdits = { ...(d.edits || {}) };
  me.disliked = [...me.disliked.filter((x) => x !== id), id];
  me.saved = me.saved.filter((x) => x !== id);
  store.saveMe(me);
  d.saved = d.saved.filter((x) => x !== id);
  d.kept = (d.kept || []).filter((k) => k.id !== id);
  holdOpen(S.openKey);
  purgeNotForMe();
  if (!v.list.some((L) => L.key === prevOpen)) S.openKey = null;
  S.choices = null;
  persist();
  S.undo = {
    label: 'Not for me.',
    run: () => {
      const m = store.loadMe();
      m.disliked = m.disliked.filter((x) => x !== id);
      if (wasMeSaved && !m.saved.includes(id)) m.saved = [...m.saved, id];
      store.saveMe(m);
      if (wasSaved && !d.saved.includes(id)) d.saved = [...d.saved, id];
      d.kept = prevKept; d.edits = prevEdits;
      v.all = prevAll; v.list = prevList; v.rankKey = null; S.openKey = prevOpen; S.choices = null;
      persist();
    },
  };
}
// A wall you're changing keeps its place in the list while you change it.
function holdOpen(key) {
  const v = S.view;
  if (!v || !key) return;
  const i = v.list.findIndex((L) => L.key === key);
  if (i >= 0) v.hold = { key, i };
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
  const wasPicked = d.picked || [];
  d.picked = wasPicked.filter((x) => x !== id);
  replaceWall(L.key, next);
  remember(next);
  S.ui.saved = null; persist();
  S.undo = {
    label: 'Swapped.',
    run: () => { if (!wasSkipped) d.skipped = d.skipped.filter((x) => x !== id); d.picked = wasPicked; replaceWall(prev.key, prev); persist(); },
  };
}
// Every print that fits this spot, favorites first. Kept per wall and piece so the
// sheet doesn't rebuild the list on every render.
function choicesFor(L, id) {
  const key = `${L.key}|${id}|${S.draft.saved.join(',')}`;
  if (!S.choices || S.choices.key !== key) {
    let list = [];
    try { list = spotChoices(engineInput(), L, id, { favorites: S.draft.saved }); } catch (e) { console.error(e); }
    S.choices = { key, list };
  }
  return S.choices.list;
}
// More walls at the end of the list: new arrangements first, then the best ones with new art.
function moreWalls() {
  const v = S.view;
  if (!v) return;
  const have = new Set(v.all.map((L) => L.key));
  const batch = (v.batch || 0) + 1;
  const input = { ...engineInput(), keep: keepList() };
  let fresh = [];
  try { fresh = layout({ ...input, avoid: [...have], count: 8 }).layouts.filter((L) => L.variant !== 'asis' && !have.has(L.key)); } catch (e) { console.error(e); }
  if (fresh.length < 4) {
    // Same frames as the best walls, new art: nothing already shown on that wall.
    for (const L of v.list.slice(0, 8)) {
      if (fresh.length >= 6) break;
      const seen = [...(S.seen.get(L.key) || [])].filter((x) => !keptSet().has(x));
      let r = null;
      try { r = refill({ ...input, exclude: seen }, L, {}); } catch { r = null; }
      if (r && r.layouts.length) fresh.push({ ...r.layouts[0], key: `${L.key}~${batch}` });
    }
  }
  fresh = fresh.filter((L) => !have.has(L.key)).slice(0, 8).map((L) => ({ ...L, extra: batch }));
  S.ui.noMore = !fresh.length;
  if (!fresh.length) return;
  v.all = [...v.all, ...fresh];
  v.batch = batch;
  for (const L of fresh) remember(L);
  v.rankKey = null;
}
// Take one frame off the wall: one fewer, every other frame stays where it is, with Undo.
function removeFrame(id) {
  const L = shown();
  if (!L) return;
  const rest = L.pieces.filter((p) => p.ref.id !== id);
  if (!rest.length) { S.flash = 'That is the last piece on this wall.'; return; }
  let r;
  try { r = scoreArrangement(engineInput(), rest.map((p) => ({ id: p.ref.id, x: p.x, y: p.y, w: p.w, h: p.h }))); } catch (e) { console.error(e); S.flash = "That frame can't come off here."; return; }
  const prev = L;
  const pinned = new Set(L.pieces.filter((p) => p.role === 'pinned').map((p) => p.ref.id));
  const next = { ...r.layout, pieces: r.layout.pieces.map((p) => (pinned.has(p.ref.id) ? { ...p, role: 'pinned' } : p)), history: L.history, moved: true };
  const d = S.draft, wasSkipped = d.skipped.includes(id);
  if (!wasSkipped) d.skipped = [...d.skipped, id];
  replaceWall(L.key, next);
  S.ui.saved = null; persist();
  S.undo = { label: 'Removed.', run: () => { if (!wasSkipped) d.skipped = d.skipped.filter((x) => x !== id); replaceWall(prev.key, prev); persist(); } };
}
// Another size for one piece, from Frame it: the frame grows or shrinks about its
// center, every other frame stays, and the wall is checked as placed. With Undo.
const outerSize = (z) => { const b = z.framed ? 0 : RULES.frameBorder; return { w: z.w + 2 * b, h: z.h + 2 * b }; };
function sizesFor(p) {
  const c = byId.get(p.ref.id);
  if (!c) return [];
  const land = p.w > p.h, sq = p.w === p.h;
  return c.sizes.filter((z) => (sq ? z.w === z.h : (z.w > z.h) === land && z.w !== z.h) && (!z.matted || matLevel() !== 'none'))
    .sort((a, b) => a.w * a.h - b.w * b.h);
}
function resizePiece(id, key) {
  const L = shown();
  const p = L && L.pieces.find((x) => x.ref.id === id);
  const z = p && sizesFor(p).find((x) => `${x.w}x${x.h}${x.matted ? 'm' : ''}` === key);
  if (!z) return;
  const o = outerSize(z), q4 = (v) => Math.round(v * 4) / 4;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const placed = L.pieces.map((x) => (x === p ? { id, x: q4(cx - o.w / 2), y: q4(cy - o.h / 2), w: o.w, h: o.h } : { id: x.ref.id, x: x.x, y: x.y, w: x.w, h: x.h }));
  let r;
  try { r = scoreArrangement(engineInput(), placed); } catch (e) { console.error(e); S.flash = "That size can't go there."; return; }
  const hard = (r.breaks || []).filter((b) => b.hard);
  const miss = r.fails.find((f) => /doesn't come in/.test(f));
  if (hard.length || miss) { S.flash = `${sz(z.w, z.h)} doesn't fit there. ${hard.length ? hard[0].message : ''}`.trim(); return; }
  const pinned = new Set(L.pieces.filter((x) => x.role === 'pinned').map((x) => x.ref.id));
  const prev = L;
  const next = { ...r.layout, pieces: r.layout.pieces.map((x) => (pinned.has(x.ref.id) ? { ...x, role: 'pinned' } : x)), history: L.history, moved: true };
  replaceWall(L.key, next);
  if (S.draft.chosen) S.draft.chosen = { ...S.draft.chosen, layout: bareLayout(next) };
  S.ui.saved = null; persist();
  S.undo = { label: `Now ${sz(z.w, z.h)}.`, run: () => { replaceWall(prev.key, prev); if (S.draft.chosen) S.draft.chosen = { ...S.draft.chosen, layout: bareLayout(prev) }; persist(); } };
}
// New art in every open frame: same frames, new picks; kept pieces and yours stay. With Undo.
function newArt() {
  const L = shown();
  if (!L) return;
  const open = L.pieces.filter((p) => p.ref.source === 'catalog' && !keptSet().has(p.ref.id));
  if (!open.length) { S.flash = 'Every frame here is yours or kept.'; return; }
  const seen = [...(S.seen.get(L.key) || [])].filter((x) => !keptSet().has(x));
  let r = refill({ ...engineInput(), keep: keepList(), exclude: seen }, L);
  if (!r.layouts.length) r = refill({ ...engineInput(), keep: keepList(), exclude: open.map((p) => p.ref.id) }, L);
  if (!r.layouts.length) { S.flash = r.problems[0] ? r.problems[0].message : 'No other art fits these frames.'; return; }
  const prev = L;
  const next = { ...r.layouts[0], history: L.history, moved: L.moved };
  replaceWall(L.key, next);
  remember(next);
  S.ui.saved = null; persist();
  S.undo = { label: `New art in ${open.length === 1 ? 'the open frame' : `${open.length} frames`}.`, run: () => { replaceWall(prev.key, prev); persist(); } };
}
// Put a picked print in this spot: one piece changes, the frames stay, with Undo.
function swapTo(id, to) {
  const L = shown();
  if (!L) return false;
  let r;
  try { r = refill({ ...engineInput(), keep: keepList() }, L, { swap: id, to }); } catch (e) { console.error(e); return false; }
  if (!r.layouts.length) { S.flash = r.problems[0] ? r.problems[0].message : "That one doesn't fit here."; return false; }
  const prev = L;
  const next = { ...r.layouts[0], history: L.history, moved: L.moved };
  replaceWall(L.key, next);
  remember(next);
  // You chose this one: other walls try it first where it fits, without Keep.
  const d = S.draft, wasPicked = d.picked || [];
  d.picked = [...wasPicked.filter((x) => x !== to && x !== id), to].slice(-12);
  S.ui.saved = null; persist();
  S.undo = { label: 'Swapped.', run: () => { replaceWall(prev.key, prev); d.picked = wasPicked; S.sheet = null; S.selected = null; persist(); } };
  return true;
}
function toggleSave(id) {
  const d = S.draft;
  if (route()[0] === 'wall' && S.view) holdOpen(S.openKey);
  const on = d.saved.includes(id);
  d.saved = on ? d.saved.filter((x) => x !== id) : [...d.saved, id];
  // Saving a piece you'd swapped away takes it off the swapped list.
  if (!on) d.skipped = d.skipped.filter((x) => x !== id);
  // Favorites are yours, not one wall's: every wall ranks with them and the Favorites page lists them.
  const me = store.loadMe();
  me.saved = on ? me.saved.filter((x) => x !== id) : [...me.saved.filter((x) => x !== id), id];
  store.saveMe(me);
  persist();
}
function toggleKeep(id) {
  const L = shown();
  const p = L && L.pieces.find((x) => x.ref.id === id);
  const list = S.draft.kept || [];
  const on = list.some((k) => k.id === id);
  S.draft.kept = on ? list.filter((k) => k.id !== id) : p ? [...list, { id: p.ref.id, w: soldW(p), h: soldH(p) }] : list;
  // The wall on screen stays, at its place in the list; the others are built again around it.
  const at = L && S.view ? S.view.list.findIndex((x) => x.key === L.key) : -1;
  if (L) S.draft.chosen = { layout: bareLayout(L), inputKey: viewKey(), at: at >= 0 ? at : 0 };
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
  if (!mem.flat && p.flat) { const src = p.flat; const img = await fromDataUrl(src); if (S.draft === d && S.mem === mem && p.flat === src) { mem.flat = img; if (!p.tone) p.tone = wallTone(img); } }
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
  return `${bar(wordmark(), `${saved.length ? '<a class="btn quiet small" href="#/walls">Your walls</a>' : ''}${APP ? (signedIn() ? `<a class="acct-chip" href="#/me" aria-label="Your profile">${avatar(A.me.profile, 28)}</a>` : '<a class="btn quiet small" href="#/signin">Sign in</a>') : ''}`)}
  <main class="home">
    <div class="drawing hero">${wallSvg({ wall: w.wall, obstacles: w.obstacles, layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, still: true, pxWide: 900, label: 'A sample living room wall, with new pieces taped up where they would hang' })}<span class="chip">Sample wall</span></div>
    <div class="home-copy">
      <h1>A wardrobe for your walls</h1>
      <p class="lede">Photo a wall. Get art laid out around what you own, with every nail marked.</p>
      <div class="acts">
        <a class="btn" href="#/begin">${resume ? 'Start something new' : 'Start'}</a>
        ${resume ? '<a class="btn quiet" href="#/resume">Back to your wall</a>' : '<a class="btn quiet" href="#/sample/living">See a sample wall</a>'}
      </div>
      <p class="how">Take a photo. Pick a wall. Frame it, hang it.</p>
      ${credits()}
    </div>
  </main>`;
}

// ---------- Start: photo or size ----------

function start() {
  const d = S.draft && !S.draft.sample ? S.draft : null;
  const ft = (v) => (v ? Math.floor(v / 12) : ''), inch = (v) => (v ? Math.round(v % 12) : '');
  const inHome = S.draft && S.draft.home;
  return `${bar(inHome ? back('#/home', 'Your home') : back('#/begin', 'Back'))}
  <main class="page">
    <h1>${inHome ? `A photo of ${esc(S.draft.name || 'this wall')}` : 'Start with a photo of one wall'}</h1>
    <p class="lede">Stand back. Get the whole wall, floor to ceiling.</p>
    <p class="pencil small">Use 1x, not 0.5x. It bends the edges.</p>
    ${flashHtml()}
    <label class="upload">
      <input type="file" accept="image/*" capture="environment" id="photo-input">
      <span class="btn wide" data-busy-label>${S.busy === 'photo' ? busyPhotoLabel() : '<span class="on-touch">Take a photo</span><span class="on-desk">Choose a photo</span>'}</span>
    </label>
    <label class="upload choose"><input type="file" accept="image/*" id="photo-input-2" data-photo-pick="1"><span class="link">Or choose one you have</span></label>
    <p class="small pencil">Nothing is sent to a server. Your photos and picks never leave <em>your device</em>.</p>
    ${S.ui.photoErr ? `<p class="error">${esc(S.ui.photoErr)}</p>` : ''}
    ${d && d.photo ? '<p><a href="#/check">Keep using the photo you added</a></p>' : ''}
    <details class="more"${S.ui.sizeErr ? ' open' : ''}>
      <summary>No photo? Type the size</summary>
      <form id="size-form" class="fields" novalidate>
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
  if (file.size > 20 * 1024 * 1024) { S.ui.photoErr = "That file is too big. Use a photo under 20 MB."; render(); return; }
  try {
    S.busy = 'photo'; render();
    const img = await loadFile(file, 1400);
    const q = photoQuality(img);
    S.draft = { ...blankDraft(), taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null } };
    // Label the photo with the image model (wall, ceiling, floor, art, TV...).
    // If it can't load, the photo is read without it.
    // A download that stalls never holds the photo up: past the time limit it's read without the model.
    let seg = null;
    const within = (pr, ms) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('timed out')), ms))]);
    try {
      if (!(await within(modelCached(), 4000).catch(() => false))) { S.ui.modelPct = 0; showBusyLabel(); }
      seg = await within(segment(img, (f) => { S.ui.modelPct = Math.round(f * 100); showBusyLabel(); }), 90000);
    } catch (err) { console.warn('photo reader', err); seg = null; }
    S.ui.modelPct = null; showBusyLabel();
    // Find the wall in the photo: its four corners, for the person to check.
    // Nothing is read off the photo until they say the corners are right.
    const found = suggestWall(img, seg);
    // A corner photo: the wall on the other side of the turn, ready if that's the one you meant.
    let others = [];
    try { others = seg ? otherWalls(img, seg, found) : []; } catch (e) { console.warn('other walls', e); }
    S.draft.photo = {
      others: others.map((o) => ({ side: o.side, corners: o.corners })),
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
    const heic = /hei[cf]$/i.test(file.name || '') || /hei[cf]/i.test(file.type || '');
    S.ui.photoErr = heic ? "This browser can't open HEIC photos. Open Walldrobe in Safari on your iPhone, or save the photo as a JPG first." : (e.message || "That file won't open. Use a JPG or PNG under 20 MB.");
    console.error('photo', e);
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
  return afterRead();
}
// Once the photo is read, straight on: to the walls (or back to your home), with what we
// read said in one line on the feed and the fixing one tap away. Fixing boxes is the
// step most people won't do, so it's never in the way.
// Your own art on this wall, and the way to add more: always one tap from the walls.
const afterRead = () => (S.draft && S.draft.home ? '#/home' : '#/layouts');
// One short line: what we read, and the two fixes people want (the reading, their own art).
function readLine(d) {
  if (!d || d.sample) return '';
  const p = d.photo;
  const mine = (d.owned || []).filter((o) => o.keep !== 'skip').length;
  const add = `<a href="#/stuff">${mine ? 'Add more of yours' : 'Add art you own'}</a>`;
  if (!p || p.mode !== 'auto' || !d.width) return `<p class="read-line">${mine ? `${mine} of yours here. ` : ''}${add}</p>`;
  const things = (d.obstacles || []).filter((o) => o.kind !== 'edge' && o.kind !== 'outlet' && o.kind !== 'switch').map((o) => obName(o).toLowerCase());
  const list = [...new Set(things)].slice(0, 3);
  const bits = [`${feet(d.width)} wide`, ...list, ...(mine ? [`${mine} of yours`] : [])];
  return `<p class="read-line">We see ${esc(bits.join(', '))}. <a href="#/check">Fix</a> · ${add}</p>`;
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

// Where the camera stood, from the photo's corners and the wall's size (web/camera.js).
// The corners span the whole wall height in the manual path, and the read region in
// the automatic one; either way their bottom is the floor.
function poseOf(d) {
  const p = d && d.photo;
  if (!p || !p.corners || !p.w || !p.h || !d.width) return null;
  const a = p.mode === 'auto' && p.auto && p.auto.rw ? p.auto : null;
  const spanH = a ? (a.rh * d.width) / a.rw : d.height;
  const key = JSON.stringify([p.corners, p.w, p.h, d.width, spanH]);
  if (S.mem.poseKey === key) return S.mem.pose;
  let pose = null;
  try { const { focal } = aspectFromCorners(p.corners, p.w, p.h); pose = cameraPose(p.corners, p.w, p.h, d.width, spanH, focal); } catch { pose = null; }
  S.mem.pose = pose ? { ...pose, spanH } : null; S.mem.poseKey = key;
  return S.mem.pose;
}
// A box read from the photo at its real size: furniture stands out from the wall and the
// photo makes it look bigger. A size you typed is already real.
function trueOb(o, d = S.draft) {
  if (!o || o.real || !DEPTH[o.kind] || !d.photo) return o;
  const pose = poseOf(d);
  if (!pose) return o;
  const t = standOut(o, pose, pose.spanH);
  if (Math.abs(t.factor - 1) < 0.01) return o;
  return { ...o, x: r2(t.x), y: r2(t.y), w: r2(t.w), h: r2(t.h), read: { w: o.w, h: o.h } };
}
const trueObs = (d = S.draft) => (d.obstacles || []).map((o) => trueOb(o, d));

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
  p.tone = wallTone(out);
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
  if (!parts.length) return "We didn't find anything in the way.";
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

// Keep: in every wall. Maybe: in a wall only when it earns its place. Skip: left out.
const KEEP_SEG = (o) => `<span class="seg" role="group" aria-label="Your ${esc(o.title)}">
  <button type="button" data-keep="must" data-oid="${esc(o.id)}" aria-pressed="${o.keep !== 'skip' && o.keep !== 'happy'}">Keep</button>
  <button type="button" data-keep="happy" data-oid="${esc(o.id)}" aria-pressed="${o.keep === 'happy'}">Maybe</button>
  <button type="button" data-keep="skip" data-oid="${esc(o.id)}" aria-pressed="${o.keep === 'skip'}">Skip</button></span>`;

function check() {
  if (need()) { go(need()); return ''; }
  const d = S.draft, p = d.photo;
  if (!p) { go('#/things'); return ''; }
  const auto = p.mode === 'auto' && p.auto;
  const H = d.height, s = labelSize(d.width, editPx());
  // Each box can be picked, then its corners dragged to resize it and its middle dragged to move it.
  const hr = s * 0.9; // handle radius, in wall inches at this size
  // On a small box the corners' touch areas would overlap and the last one drawn would win, so each stops at half the box.
  const handles = (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y], i) => `<g class="box-h" data-hcorner="${i}"><circle cx="${x}" cy="${y}" r="${Math.min(hr * 2.2, Math.min(b.w, b.h) / 2)}" class="handle-hit"/><circle cx="${x}" cy="${y}" r="${Math.min(hr * 0.7, Math.min(b.w, b.h) / 5)}" class="handle-dot"/></g>`).join('');
  const sizeTag = (b, w, h) => `<text x="${b.x + b.w / 2}" y="${b.y + b.h + s * 1.1}" font-size="${s * 0.85}" class="box-size">${r2(w)} x ${r2(h)} in</text>`;
  const picked = S.ui.fix;
  const boxes = [
    ...d.obstacles.map((o) => { const b = { x: o.x, y: H - o.y - o.h, w: o.w, h: o.h }, on = picked === o.id, t = trueOb(o, d); return `<g class="ob box${on ? ' is-picked' : ''}" data-box="${esc(o.id)}" data-kind="ob">${hitPad(b.x, b.y, b.w, b.h)}<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" class="ob-box"/>${o.w >= 8 ? `<text x="${o.x + o.w / 2}" y="${H - o.y - o.h / 2}" font-size="${s * 0.85}" class="ob-label">${esc(obName(o))}</text>` : ''}${on ? handles(b) + sizeTag(b, t.w, t.h) : ''}</g>`; }),
    ...d.owned.filter((o) => o.at).map((o) => { const b = { x: o.at.x, y: H - o.at.y - o.h, w: o.w, h: o.h }, on = picked === o.id; return `<g class="owned-mark box${o.keep === 'skip' ? ' is-skip' : ''}${on ? ' is-picked' : ''}" data-box="${esc(o.id)}" data-kind="own">${hitPad(b.x, b.y, b.w, b.h)}<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" class="owned-box-mark"/>${on ? handles(b) + sizeTag(b, o.w, o.h) : ''}</g>`; }),
  ].join('') + photoTopLine(d, s);
  const ft = (v) => Math.floor(v / 12), inch = (v) => Math.round(v % 12);
  const from = auto && p.auto.guess ? p.auto.guess.from : null;
  const why = { low: ' A 55 in one would put the ceiling under 7 ft.', high: ' A 55 in one would put the ceiling over 11 ft.' }[p.auto && p.auto.tvWhy] || '';
  const guess = NO_TAPE[from] ? `${NO_TAPE[from].why} Measure the wall to be exact.` : from === 'tv' ? `From your TV, taken as a ${p.auto.tvInches} in TV.${why} Measure the wall to be exact.` : from === 'measure' ? 'From your measurement.' : 'Measure the wall to be exact.';
  const tvPick = from === 'tv' ? `<label class="inline">Your TV <select id="tv-size" aria-label="Your TV's size">${TV_SIZES.map(([dg]) => `<option value="${dg}"${dg === p.auto.tvInches ? ' selected' : ''}>${dg} in</option>`).join('')}</select></label>` : '';
  const tvGuess = tvCandidate(d);
  const fix = S.ui.fix;
  const num = (o, k, label, attr) => `<label class="num"><span>${label}</span><span class="num-in"><input type="number" step="0.5" min="0" ${attr}="${k}" data-${attr === 'data-obk' ? 'obid' : 'oid'}="${esc(o.id)}" value="${attr === 'data-ok' ? sizeShown(o)[k] : o[k]}"> in</span></label>`;
  const artRows = d.owned.map((o) => `<li class="row${o.keep === 'skip' ? ' is-skip' : ''}">
      <span class="thumb">${o.thumb ? `<img src="${o.thumb}" alt="">` : `<span class="swatch" style="background:${esc(o.color || '#8A8F94')}"></span>`}</span>
      <span class="row-text"><span class="name">Your ${esc(o.title)}</span><span class="meta">${isFramed(o) ? `${o.w} x ${o.h} in` : `Art ${sizeShown(o).w} x ${sizeShown(o).h} in, needs a frame`}${o.at ? '' : ", not up yet"}</span>
        ${o.id === tvGuess ? `<button type="button" class="link" data-is-tv="${esc(o.autoId)}">It's the TV</button>` : ''}
        ${fix === o.id ? `<span class="fix">
          <label class="name-in"><span>What is it?</span><input type="text" maxlength="40" data-ok="title" data-oid="${esc(o.id)}" value="${esc(o.title)}"></label>
          ${framedSeg(o)}
          <span class="nums">${num(o, 'w', 'Wide', 'data-ok')}${num(o, 'h', 'Tall', 'data-ok')}${lockBtn(o, 'ok')}</span>
          <span class="pencil small">${framedWords(o)}</span>
          ${o.at ? '' : `<label class="btn quiet small file-btn">${o.thumb ? 'New photo of it' : 'Add a photo of it'}<input type="file" accept="image/*" data-art-photo="${esc(o.id)}"></label>`}
          <span class="fix-acts"><button type="button" class="link" data-remove-owned="${esc(o.id)}">Remove</button><button type="button" class="btn quiet small" data-fix="">Done</button></span>
        </span>` : `<button type="button" class="link" data-fix="${esc(o.id)}" aria-label="Fix your ${esc(o.title)}">Fix</button>`}</span>
      ${KEEP_SEG(o)}
    </li>`).join('');
  const obRows = d.obstacles.map((o0) => { const o = trueOb(o0, d); return `<li class="row">
      <span class="thumb"><span class="kind">${esc(obName(o).split(' ')[0])}</span></span>
      <span class="row-text"><span class="name">${esc(obName(o))}</span><span class="meta">${o.w} x ${o.h} in${o.read ? `, about ${r2(o.read.w)} in wide in the photo` : o.real ? ', as you typed it' : ''}</span>
        ${fix === o.id ? `<span class="fix"><label class="inline"><span>It's a</span><select data-obkind="${esc(o.id)}">${OB_KINDS.map((k) => `<option value="${k}"${o.kind === k ? ' selected' : ''}>${esc(KIND_NAME[k])}</option>`).join('')}</select></label><span class="nums">${num(o, 'w', 'Wide', 'data-obk')}${num(o, 'h', 'Tall', 'data-obk')}${num(o, 'x', 'From left', 'data-obk')}${num(o, 'y', 'From floor', 'data-obk')}</span>
          <span class="fix-acts">${o.autoId && o.kind !== 'tv' ? `<button type="button" class="link" data-is-art="${esc(o.autoId)}">It's art</button>` : ''}<button type="button" class="link" data-remove-ob="${esc(o.id)}">Remove</button><button type="button" class="btn quiet small" data-fix="">Done</button></span></span>`
        : `<button type="button" class="link" data-fix="${esc(o.id)}" aria-label="Fix the ${esc(obName(o))}">Fix</button>`}</span>
    </li>`; }).join('');
  const pose = poseOf(d);
  const furn = d.obstacles.some((o) => DEPTH[o.kind] && !o.real);
  const away = pose ? `about ${feet(Math.round(pose.distance / 6) * 6)}` : null;
  const furnNote = !furn ? '' : pose && pose.distance < 72
    ? `You took this close to the wall (${away} back), so furniture sizes are rough. If you know a piece's real width, tap Fix and type it.`
    : pose ? `Furniture stands out from the wall, so the photo makes it look bigger. We take that out from where you stood, ${away} back. If you know a piece's real width, tap Fix and type it.`
    : 'Furniture stands out from the wall, so the photo makes it look a little wider than it is. If you know its real width, tap Fix and type it.';
  return `${bar(back('#/corners', 'Corners'))}
  <main class="page">
    <h1>Here's your wall</h1>
    <p class="lede">${esc(foundSentence(d))} Fix anything that's off.</p>
    ${S.ui.quality ? `<p class="note">${esc(S.ui.quality)}</p>` : ''}
    <div class="two-up">
    <div class="two-up-main">
    <div class="drawing photo-check${picked && boxOf(picked) ? ' has-pick' : ''}" id="check-wall">${wallSvg({ wall: { width: d.width, height: H }, photo: p.flat, obstacles: [], extra: boxes, pxWide: editPx(), still: true, label: 'Your wall photo, flattened, with what we found marked' })}</div>
    <p class="small pencil">Tap a box to pick it. Drag a corner to resize it, or the middle to move it.</p>
    </div>
    <div class="two-up-side">
    ${auto ? `<form id="dims-form" class="fields dims" novalidate>
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
    ${furnNote ? `<p class="pencil small">${esc(furnNote)}</p>` : ''}
    ${d.obstacles.length ? `<ul class="rows">${obRows}</ul>` : '<p class="pencil">Nothing in the way. Mark anything we missed.</p>'}
    <div class="acts left"><a class="btn quiet small" href="#/things">Mark something we missed</a></div>
    <div class="dock">${d.home ? '<a class="btn wide" href="#/home">Done, back to your home</a>' : '<a class="btn wide" href="#/layouts">Show me my wall</a>'}</div>
    </div></div>
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
  if (box.kind === 'ob') o.real = false; // drawn on the photo again: its size is the photo's, corrected for depth
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
    const r = g.querySelector('.ob-box, .owned-box-mark'); r.setAttribute('x', b.x); r.setAttribute('y', top); r.setAttribute('width', b.w); r.setAttribute('height', b.h);
    const hp = g.querySelector('.hit-pad'); if (hp) { const pw = Math.max(b.w, Number(hp.getAttribute('width'))), ph = Math.max(b.h, Number(hp.getAttribute('height'))); hp.setAttribute('x', b.x - (pw - b.w) / 2); hp.setAttribute('y', top - (ph - b.h) / 2); }
    const lab = g.querySelector('.ob-label'); if (lab) { lab.setAttribute('x', b.x + b.w / 2); lab.setAttribute('y', top + b.h / 2); }
    const pts = [[b.x, top], [b.x + b.w, top], [b.x + b.w, top + b.h], [b.x, top + b.h]];
    g.querySelectorAll('.box-h').forEach((h, i) => h.querySelectorAll('circle').forEach((c) => { c.setAttribute('cx', pts[i][0]); c.setAttribute('cy', pts[i][1]); }));
    const tb = box.kind === 'ob' ? trueOb({ ...box.o, ...b, real: false }) : b;
    const t = g.querySelector('.box-size'); if (t) { t.setAttribute('x', b.x + b.w / 2); t.setAttribute('y', top + b.h + Number(t.getAttribute('font-size')) * 1.3); t.textContent = `${r2(tb.w)} x ${r2(tb.h)} in`; }
    const row = document.querySelector(`.row [data-oid="${CSS.escape(box.o.id)}"], .row [data-obid="${CSS.escape(box.o.id)}"]`);
    if (row) { const inW = document.querySelector(`input[data-ok="w"][data-oid="${CSS.escape(box.o.id)}"], input[data-obk="w"][data-obid="${CSS.escape(box.o.id)}"]`); const inH = document.querySelector(`input[data-ok="h"][data-oid="${CSS.escape(box.o.id)}"], input[data-obk="h"][data-obid="${CSS.escape(box.o.id)}"]`); if (inW) inW.value = r2(tb.w); if (inH) inH.value = r2(tb.h); }
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
  // The touch circle is at least 24 px across the radius on screen (48 px wide), whatever the photo's size.
  const onScreen = Math.max(1, Math.min((window.innerWidth || 390) - 48, 760)) / p.w;
  const hit = Math.max(r * 2.2, 24 / onScreen);
  const names = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
  const seen = p.seen || {};
  const misses = [
    seen.ceiling === false ? "We couldn't see the ceiling, so the top dots are at the top of the photo. Check the ceiling height on the next screen." : null,
    seen.soffit ? "There's a soffit over this wall, so the top dots are under it. Art goes below it." : null,
    seen.model === false ? "The photo reader didn't load, so these are rougher guesses than usual." : null,
    seen.floorFrom === 'stand' ? 'The floor is hidden behind the furniture, so the bottom dots are a guess from your TV stand.' : seen.floor === false ? "Check that the bottom dots sit where the wall meets the floor. Behind furniture, guess." : null,
  ].filter(Boolean);
  return `${bar(back('#/start', 'Photo'))}
  <main class="page">
    <h1>Check the corners</h1>
    <p class="lede">Drag the dots to the wall's corners. Behind furniture, guess.</p>
    <div class="photo-wrap">
      <svg id="corner-svg" viewBox="0 0 ${p.w} ${p.h}" data-w="${p.w}" data-h="${p.h}" class="photo-svg${err ? ' has-error' : ''}" role="group" aria-label="Wall photo with four corner handles">
        <image href="${p.src}" x="0" y="0" width="${p.w}" height="${p.h}"/>
        <polygon points="${c.map((x) => x.join(',')).join(' ')}" class="quad"/>
        ${c.map(([x, y], i) => `<g class="handle${(S.ui.corner || 0) === i ? ' is-picked' : ''}" data-corner="${i}" tabindex="0" role="button" aria-label="${names[i]} corner. Drag it, or use the arrow keys.">
          <circle cx="${x}" cy="${y}" r="${hit}" class="handle-hit"/><circle cx="${x}" cy="${y}" r="${r}" class="handle-dot"/></g>`).join('')}
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
    ${(p.others || []).length ? `<p class="small">${p.others.map((o) => `<button type="button" class="link" data-other-wall="${o.side}">Use the wall on the ${o.side}</button>`).join(' · ')}</p>` : ''}
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
    <p class="lede">${widthOnly ? "There's no TV in the photo clear enough to size the wall from. Measure the wall's width; you can check the ceiling height after." : "There's no TV in the photo clear enough to size the wall from. Measure its width, or its height from floor to ceiling, and we work out the other."}</p>
    <form id="measure-form" class="fields" novalidate>
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
      <p class="pencil">Pick something standard in the photo. You can fix it next.</p>
      <div class="acts left">${opts.map(([k]) => `<button type="button" class="btn quiet small" data-notape="${k}">${esc(NO_TAPE[k].label)}</button>`).join('')}</div>
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

const editPx = () => { const W = window.innerWidth || 700; return W >= 1000 ? Math.min(Math.round((W - (W >= 1180 ? 240 : 0)) * 0.58), 900) : Math.min(W - 50, 760); };
// A see-through touch area at least 44 px square around a small box (an outlet is
// about 9 px wide on a phone), so it can be picked up and dragged. x, y: svg top left.
function hitPad(x, y, w, h) {
  const ppi = editPx() / Math.max(1, S.draft.width), min = 44 / ppi;
  if (w >= min && h >= min) return '';
  const pw = Math.max(w, min), ph = Math.max(h, min);
  return `<rect x="${x - (pw - w) / 2}" y="${y - (ph - h) / 2}" width="${pw}" height="${ph}" class="hit-pad"/>`;
}
function obstacleLayer(showHandles = true) {
  const H = S.draft.height;
  const s = labelSize(S.draft.width, editPx());
  return S.draft.obstacles.map((o) => `
    <g class="ob" data-ob="${esc(o.id)}">
      ${hitPad(o.x, H - o.y - o.h, o.w, o.h)}<rect x="${o.x}" y="${H - o.y - o.h}" width="${o.w}" height="${o.h}" class="ob-box"/>
      ${o.w >= 10 ? `<text x="${o.x + o.w / 2}" y="${H - o.y - o.h / 2}" font-size="${s * 0.9}" class="ob-label">${esc(obName(o))}</text>` : ''}
      ${showHandles && o.w >= 6 ? `<circle cx="${o.x + o.w}" cy="${H - o.y - o.h}" r="${s * 0.55}" class="ob-resize" data-resize="${esc(o.id)}"/>` : ''}
    </g>`).join('');
}

function things() {
  if (need()) { go(need()); return ''; }
  const d = S.draft;
  const photo = d.photo && d.photo.flat;
  // What you can mark, by what it does to the art: furniture the art hangs over, things
  // set into the wall, things standing in front of it, and where the wall itself changes.
  const groups = [
    ['Furniture the art hangs over', ['couch', 'headboard', 'dresser', 'console', 'tv']],
    ['Set into the wall', ['window', 'door', 'outlet', 'switch']],
    ['Standing in front', ['lamp', 'plant']],
    ['Where the wall changes', ['edge'], 'A corner, or where paint or panels change.'],
  ];
  const num = (o, k, label) => `<label class="num"><span>${label}</span><span class="num-in"><input type="number" step="0.5" min="0" data-obk="${k}" data-obid="${esc(o.id)}" value="${o[k]}"> in</span></label>`;
  return `${bar(back(d.photo ? '#/check' : '#/start', d.photo ? 'Your wall' : 'Size'))}
  <main class="page">
    <h1>What's in the way?</h1>
    <p class="lede">Mark what the art should clear. Drag to move, corner dot to size.</p>
    <div class="two-up">
    <div class="drawing wall-edit" id="edit-wall">
      ${wallSvg({ wall: { width: d.width, height: d.height }, photo, obstacles: [], extra: obstacleLayer(), pxWide: editPx(), label: d.name })}
    </div>
    <div class="two-up-side">
    <div class="add-groups">${groups.map(([label, ks, help]) => `<div class="add-group" role="group" aria-label="${esc(label)}"><span class="add-label">${esc(label)}</span><span class="add-row">${ks.map((k) => `<button type="button" class="btn quiet small" data-add="${k}">${KIND_NAME[k]}</button>`).join('')}</span>${help ? `<span class="help">${esc(help)}</span>` : ''}</div>`).join('')}</div>
    ${d.obstacles.length ? `<ul class="rows">${trueObs(d).map((o) => `<li class="row">
        <span class="row-text"><span class="name">${esc(obName(o))}</span>
        <span class="nums">${num(o, 'w', 'Wide')}${num(o, 'h', 'Tall')}${num(o, 'x', 'From left')}${num(o, 'y', 'From floor')}</span>
        ${['couch', 'headboard'].includes(o.kind) ? `<span class="help">Tall is the floor to the top of the ${o.kind === 'couch' ? 'back' : 'headboard'}.</span>` : ''}</span>
        <button type="button" class="link" data-remove-ob="${esc(o.id)}">Remove</button>
      </li>`).join('')}</ul>` : '<p class="pencil">Bare wall? Skip this.</p>'}
    ${flashHtml()}
    <div class="acts end"><a class="btn" href="${d.photo ? '#/check' : '#/pieces'}">${d.photo ? 'Done' : d.obstacles.length ? 'Next' : "Nothing's in the way"}</a></div>
    </div></div>
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
    <p class="lede">${photo ? 'Drag a box around each piece in the photo.' : "Add each piece for this wall."}</p>
    ${photo ? `<div class="drawing wall-edit draw-mode" id="draw-wall">${wallSvg({ wall: { width: d.width, height: d.height }, photo, obstacles: [], extra: `${marks}<rect id="draw-rect" class="draw-rect" x="0" y="0" width="0" height="0"/>`, pxWide: editPx(), label: 'Your wall photo' })}</div>` : ''}
    ${d.owned.length ? `<ul class="rows">${d.owned.map((o) => `<li class="row">
      <span class="thumb">${o.thumb ? `<img src="${o.thumb}" alt="">` : `<span class="swatch" style="background:${esc(o.color || '#8A8F94')}"></span>`}</span>
      <span class="row-text">
        <label class="name-in"><span>What is it?</span><input type="text" maxlength="40" data-ok="title" data-oid="${esc(o.id)}" value="${esc(o.title)}"></label>
        ${framedSeg(o)}
        <span class="nums"><label class="num"><span>Wide</span><span class="num-in"><input type="number" step="0.5" min="2" data-ok="w" data-oid="${esc(o.id)}" value="${sizeShown(o).w}"> in</span></label><label class="num"><span>Tall</span><span class="num-in"><input type="number" step="0.5" min="2" data-ok="h" data-oid="${esc(o.id)}" value="${sizeShown(o).h}"> in</span></label>${lockBtn(o, 'ok')}
        ${o.thumb ? '' : `<label class="num"><span>Main color</span><input type="color" data-ok="color" data-oid="${esc(o.id)}" value="${esc(o.color || '#8A8F94')}"></label>`}</span>
        <span class="pencil small">${framedWords(o)}</span>
        ${o.at ? '' : `<label class="btn quiet small file-btn">${o.thumb ? 'New photo of it' : 'Add a photo of it'}<input type="file" accept="image/*" data-art-photo="${esc(o.id)}"></label>`}
      </span>
      <span class="row-side">${KEEP_SEG(o)}${o.stuff ? '<span class="pencil small">In your stuff</span>' : `<button type="button" class="link" data-to-stuff="${esc(o.id)}">Save to your stuff</button>`}<button type="button" class="link" data-remove-owned="${esc(o.id)}">Remove</button></span>
    </li>`).join('')}</ul>` : ''}
    <div class="acts left"><button type="button" class="btn quiet small" data-act="add-piece">${photo ? "Add art that isn't up yet" : 'Add a piece'}</button></div>
    ${flashHtml()}
    <div class="acts end"><a class="btn" href="${d.photo ? '#/check' : d.home ? '#/home' : '#/layouts'}">${d.photo ? 'Done' : d.home ? 'Done, back to your home' : d.owned.length ? 'Show me my wall' : 'Nothing yet, show me my wall'}</a></div>
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

// ---------- One wall or a whole home ----------
// Two ways in. One wall is the basic path. A whole home is the advanced one: what you
// already own first (art, framed or not, and empty frames), then each wall, then your
// pieces spread across the walls together before new art fills the gaps. Each wall keeps
// its own preferences; they share your stuff and your taste.

function begin() {
  const h = myHome();
  return `${bar(back('#/', 'Walldrobe'))}
  <main class="page begin">
    <h1>What are you doing?</h1>
    <ul class="paths">
      <li><a class="path" href="#/new"><span class="path-head"><span class="path-name">One wall</span><span class="path-tag">Basic</span></span><span class="pencil">One photo, a few minutes.</span></a></li>
      <li><a class="path" href="${h.walls.length ? '#/home' : '#/stuff/home'}"><span class="path-head"><span class="path-name">A whole home</span><span class="path-tag">Advanced</span></span><span class="pencil">Your art first, then each wall. New art fills the gaps.</span></a></li>
    </ul>
  </main>`;
}

const myStuff = () => store.loadMe().stuff || [];
function saveStuff(list) { const me = store.loadMe(); me.stuff = list; store.saveMe(me); }
const myHome = () => { const h = store.loadMe().home; return h && Array.isArray(h.walls) ? h : { walls: [], planned: null }; };
function saveHome(h) { const me = store.loadMe(); me.home = h; store.saveMe(me); }
const homeWalls = () => myHome().walls.map((id) => store.getWall(id)).filter(Boolean);
const FRAME_COLORS = [['black', 'Black'], ['white', 'White'], ['oak', 'Oak'], ['brass', 'Brass']];
const stuffId = () => `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// Art that isn't framed yet goes in the smallest standard frame that holds it, with a
// mat when the frame is bigger than the art. On the wall it's the frame's outside.
const STANDARD_FRAMES = [...new Set(FRAMERS.flatMap((f) => Object.keys(f.sizes)))]
  .map((k) => k.split('x').map(Number)).sort((a, b) => a[0] * a[1] - b[0] * b[1]);
function frameFor(w, h) {
  const [a, b] = w <= h ? [w, h] : [h, w];
  const f = STANDARD_FRAMES.find(([x, y]) => x >= a && y >= b && x - a <= 6 && y - b <= 8);
  if (!f) return null;
  return w <= h ? { w: f[0], h: f[1] } : { w: f[1], h: f[0] };
}
function hangSize(x) {
  if (x.framed) return { w: x.w, h: x.h };
  const f = frameFor(x.w, x.h);
  const b = RULES.frameBorder || 0.75;
  return f ? { w: f.w + 2 * b, h: f.h + 2 * b, frame: f } : { w: x.w + 2 * b, h: x.h + 2 * b, frame: null };
}
// One of your pieces on this wall, framed or not. Not framed: the numbers you type are the
// art itself, and it hangs at the frame it needs (with a mat when that frame is bigger),
// which goes on the Get it list. Framed: the numbers are the frame's outside.
const isFramed = (o) => o.framed !== false;
const sizeShown = (o) => (!isFramed(o) && o.artSize ? o.artSize : { w: o.w, h: o.h });
function setOwnedArt(o) {
  if (isFramed(o)) { delete o.needsFrame; delete o.artSize; return; }
  const a = o.artSize || { w: o.w, h: o.h };
  o.artSize = a;
  const hs = hangSize({ framed: false, w: a.w, h: a.h });
  o.w = hs.w; o.h = hs.h;
  o.needsFrame = hs.frame ? { w: hs.frame.w, h: hs.frame.h, print: { w: a.w, h: a.h } } : { w: a.w, h: a.h, print: null, custom: true };
}
function setOwnedFramed(o, framed) {
  if (o.stuff) {
    const list = myStuff(), x = list.find((y) => y.id === o.stuff);
    if (x) { x.framed = framed; saveStuff(list); syncStuff(x); return; }
  }
  if (isFramed(o) === framed) return;
  const before = { w: o.w, h: o.h };
  if (framed) { const a = o.artSize || before; o.framed = true; o.w = a.w; o.h = a.h; delete o.artSize; delete o.needsFrame; }
  else { o.framed = false; o.artSize = { ...before }; setOwnedArt(o); }
  // It grows or shrinks about its middle where it hangs.
  if (o.at) o.at = { x: Math.round((o.at.x - (o.w - before.w) / 2) * 4) / 4, y: Math.max(0, Math.round((o.at.y - (o.h - before.h) / 2) * 4) / 4) };
}
// The shape lock: on, changing one side moves the other to keep the shape, read from the
// photo of the piece (or the numbers when you turned it on). On by default with a photo.
const lockOn = (x) => (x.lock != null ? x.lock : !!x.thumb);
function lockedSize(x, k, v, cur) {
  if (!lockOn(x)) return { ...cur, [k]: v };
  const r = x.ratio || cur.w / cur.h;
  const q = (n) => Math.max(2, Math.round(n * 4) / 4);
  return k === 'w' ? { w: v, h: q(v / r) } : { w: q(v * r), h: v };
}
const lockBtn = (x, kind) => `<button type="button" class="tick lock" data-lock="${esc(x.id)}" data-lock-kind="${kind}" aria-pressed="${lockOn(x)}">Keep shape</button>`;
const framedSeg = (o) => `<span class="seg small-seg" role="group" aria-label="Framed or not"><button type="button" data-own-framed="1" data-oid="${esc(o.id)}" aria-pressed="${isFramed(o)}">Framed</button><button type="button" data-own-framed="0" data-oid="${esc(o.id)}" aria-pressed="${!isFramed(o)}">Not framed</button></span>`;
const framedWords = (o) => {
  if (isFramed(o)) return 'Measure the outside of the frame.';
  const f = o.needsFrame;
  return f && !f.custom ? `The art itself. It goes in ${aOrAn(f.w)} ${sz(f.w, f.h)} frame${f.print && (f.print.w !== f.w || f.print.h !== f.h) ? ' with a mat' : ''}.` : 'The art itself. It needs a custom frame.';
};

// ---------- Crop a photo of your art ----------
// A photo of one of your pieces is cut to the piece before it's used: we find it against
// the wall or table behind it, and you drag the corners to fix it. The crop's shape is the
// piece's shape, which the shape lock keeps when you type a size.
function openCrop(file, target) {
  loadFile(file, 1000).then((img) => {
    S.crop = { img, box: findArtBox(img), target };
    S.flash = null; render(); window.scrollTo({ top: 0 });
  }).catch((err) => { S.flash = err.message || "That photo won't open. Use a JPG or PNG."; render(); });
}
function cropScreen() {
  const { img, box } = S.crop, W = img.width, H = img.height, r = Math.max(W, H) * 0.03;
  const b = box;
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  return `${bar(`<button type="button" class="back link" data-act="crop-cancel"><span aria-hidden="true">‹</span> Back</button>`)}
  <main class="page crop-page">
    <h1>Crop to the piece</h1>
    <p class="lede">Drag the corners to its edges, frame and all.</p>
    <div class="crop-wrap"><svg id="crop-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your photo with the crop marked">
      <image href="${img.url}" x="0" y="0" width="${W}" height="${H}"/>
      <path class="crop-dim" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z"/>
      <rect class="crop-box" data-crop-move="1" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" style="stroke-width:${(r / 6).toFixed(1)}"/>
      ${corners.map(([x, y], i) => `<circle class="crop-h" data-crop-corner="${i}" cx="${x}" cy="${y}" r="${r.toFixed(1)}"/>`).join('')}
    </svg></div>
    <div class="acts left"><button type="button" class="btn" data-act="crop-use">Use this</button><button type="button" class="btn quiet" data-act="crop-whole">Whole photo</button></div>
  </main>`;
}
function cropDraw() {
  const svg = document.getElementById('crop-svg'), c = S.crop;
  if (!svg || !c) return;
  const b = c.box, W = c.img.width, H = c.img.height;
  svg.querySelector('.crop-dim').setAttribute('d', `M0 0H${W}V${H}H0Z M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`);
  const r = svg.querySelector('.crop-box');
  r.setAttribute('x', b.x); r.setAttribute('y', b.y); r.setAttribute('width', b.w); r.setAttribute('height', b.h);
  [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].forEach(([x, y], i) => { const h = svg.querySelector(`[data-crop-corner="${i}"]`); h.setAttribute('cx', x); h.setAttribute('cy', y); });
}
// The cropped piece: a small thumbnail at its own shape, its colors, and its shape.
function cropResult(img, box) {
  const part = crop(img, box);
  const sc = Math.min(1, 240 / Math.max(part.width, part.height));
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(part.width * sc)); cv.height = Math.max(1, Math.round(part.height * sc));
  const tmp = document.createElement('canvas'); tmp.width = part.width; tmp.height = part.height;
  tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(part.data), part.width, part.height), 0, 0);
  cv.getContext('2d').drawImage(tmp, 0, 0, cv.width, cv.height);
  return { url: cv.toDataURL('image/jpeg', 0.82), pal: palette(part, 5), ratio: part.width / part.height };
}
// A new piece takes the photo's shape at 20 in on its long side until you type its size.
const shapeFrom = (ratio, long = 20) => (ratio >= 1 ? [long, Math.max(2, Math.round((long / ratio) * 2) / 2)] : [Math.max(2, Math.round(long * ratio * 2) / 2), long]);
function useCrop(whole) {
  const c = S.crop; if (!c) return;
  const box = whole ? { x: 0, y: 0, w: c.img.width, h: c.img.height } : c.box;
  const res = cropResult(c.img, box), t = c.target;
  S.crop = null;
  if (t.kind === 'stuff') {
    const list = myStuff();
    let x = t.into ? list.find((y) => y.id === t.into) : null;
    const fresh = !x;
    if (!x) { x = { id: stuffId(), kind: 'art', title: `piece ${list.filter((y) => y.kind === 'art').length + 1}`, w: 16, h: 20, framed: true }; list.push(x); }
    x.thumb = res.url; x.palette = res.pal; x.color = res.pal[0] ? res.pal[0].hex : null; x.ratio = res.ratio;
    if (fresh || (x.w === 16 && x.h === 20)) { [x.w, x.h] = shapeFrom(res.ratio); S.flash = 'Added. Type one side; the other follows its shape.'; }
    saveStuff(list); syncStuff(x, fresh && fromOneWall());
  } else {
    const o = S.draft.owned.find((y) => y.id === t.id);
    if (o) {
      o.thumb = res.url; o.palette = res.pal; o.color = res.pal[0] ? res.pal[0].hex : o.color; o.ratio = res.ratio;
      const cur = sizeShown(o);
      if (cur.w === 16 && cur.h === 20) {
        const [w, h] = shapeFrom(res.ratio);
        if (isFramed(o)) { o.w = w; o.h = h; } else { o.artSize = { w, h }; setOwnedArt(o); }
        S.flash = `Shaped like the photo: ${w} x ${h} in. Type one side; the other follows.`;
      }
      resetLayouts(); persist();
    }
  }
  render();
}
// Dragging a corner sizes the crop; dragging inside moves it.
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest && e.target.closest('[data-crop-corner], [data-crop-move]');
  const svg = document.getElementById('crop-svg');
  if (!t || !svg || !S.crop) return;
  e.preventDefault();
  const pt = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  const c = S.crop, W = c.img.width, H = c.img.height, min = Math.max(W, H) * 0.06;
  const start = pt(e), b0 = { ...c.box }, corner = t.dataset.cropCorner != null ? Number(t.dataset.cropCorner) : null;
  const move = (ev) => {
    const p = pt(ev), dx = p.x - start.x, dy = p.y - start.y;
    let { x, y, w, h } = b0;
    if (corner == null) { x = Math.max(0, Math.min(W - w, x + dx)); y = Math.max(0, Math.min(H - h, y + dy)); }
    else {
      let x0 = x, y0 = y, x1 = x + w, y1 = y + h;
      if (corner === 0 || corner === 3) x0 = Math.max(0, Math.min(x1 - min, x0 + dx)); else x1 = Math.min(W, Math.max(x0 + min, x1 + dx));
      if (corner === 0 || corner === 1) y0 = Math.max(0, Math.min(y1 - min, y0 + dy)); else y1 = Math.min(H, Math.max(y0 + min, y1 + dy));
      x = x0; y = y0; w = x1 - x0; h = y1 - y0;
    }
    c.box = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    cropDraw();
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
});

function stuffScreen() {
  const homeFlow = route()[1] === 'home';
  const oneWall = !homeFlow && S.draft && !S.draft.sample && !S.draft.home && S.draft.width;
  const st = myStuff();
  const art = st.filter((x) => x.kind === 'art'), frames = st.filter((x) => x.kind === 'frame');
  const where = new Map();
  for (const w of homeWalls()) for (const o of w.owned || []) if (o.stuff) where.set(o.stuff, w.name || 'a wall');
  const num = (x, k, label) => `<label class="num"><span>${label}</span><span class="num-in"><input type="number" inputmode="decimal" step="0.5" min="2" max="120" data-sk="${k}" data-sid="${esc(x.id)}" value="${x[k]}"> in</span></label>`;
  const seg2 = (label, key, id, on, a, b) => `<span class="seg small-seg" role="group" aria-label="${label}"><button type="button" data-stuff-set="${key}" data-sid="${esc(id)}" data-v="1" aria-pressed="${!!on}">${a}</button><button type="button" data-stuff-set="${key}" data-sid="${esc(id)}" data-v="0" aria-pressed="${!on}">${b}</button></span>`;
  const artRow = (x) => `<li class="row stuff-row">
      <span class="thumb">${x.thumb ? `<img src="${x.thumb}" alt="">` : `<span class="swatch" style="background:${esc(x.color || '#8A8F94')}"></span>`}</span>
      <span class="row-text">
        <label class="name-in"><span>What is it?</span><input type="text" maxlength="40" data-sk="title" data-sid="${esc(x.id)}" value="${esc(x.title)}"></label>
        ${seg2('Framed or not', 'framed', x.id, x.framed, 'Framed', 'Not framed')}
        <span class="nums">${num(x, 'w', 'Wide')}${num(x, 'h', 'Tall')}${lockBtn(x, 'sk')}</span>
        <span class="pencil small">${x.framed ? 'Measure the outside of the frame.' : (() => { const f = frameFor(x.w, x.h); return f ? `The art itself. It goes in ${aOrAn(f.w)} ${sz(f.w, f.h)} frame${f.w !== x.w || f.h !== x.h ? ' with a mat' : ''}.` : 'The art itself. It needs a custom frame.'; })()}${where.has(x.id) ? ` On ${esc(where.get(x.id))}.` : ''}</span>
        ${x.thumb ? '' : `<label class="btn quiet small file-btn">Add a photo of it<input type="file" accept="image/*" data-stuff-photo="${esc(x.id)}"></label>`}
        ${oneWall ? (() => { const o = S.draft.owned.find((y) => y.stuff === x.id), k = o ? o.keep || 'must' : 'skip'; return `<span class="keep-line"><span class="pencil small">On this wall</span><span class="seg small-seg" role="group" aria-label="${esc(x.title)} on this wall">${[['must', 'Keep'], ['happy', 'Maybe'], ['skip', 'Skip']].map(([v, l]) => `<button type="button" data-stuff-keep="${v}" data-sid="${esc(x.id)}" aria-pressed="${k === v}">${l}</button>`).join('')}</span></span>`; })() : ''}
      </span>
      <span class="row-side"><button type="button" class="link" data-stuff-remove="${esc(x.id)}">Remove</button></span>
    </li>`;
  const frameRow = (x) => `<li class="row stuff-row">
      <span class="thumb"><span class="frame-chip" style="--fc:${FRAME_LOOKS[x.color] ? FRAME_LOOKS[x.color].hex : '#1F1F1F'}"></span></span>
      <span class="row-text">
        <span class="name">Empty frame</span>
        <span class="nums">${num(x, 'w', 'Wide')}${num(x, 'h', 'Tall')}</span>
        <span class="seg small-seg" role="group" aria-label="Frame color">${FRAME_COLORS.map(([k, v]) => `<button type="button" data-stuff-color="${k}" data-sid="${esc(x.id)}" aria-pressed="${x.color === k}">${v}</button>`).join('')}</span>
        <span class="pencil small">The size it's sold as, like 11 x 14. Walls use it for free.</span>
      </span>
      <span class="row-side"><button type="button" class="link" data-stuff-remove="${esc(x.id)}">Remove</button></span>
    </li>`;
  return `${bar(back(homeFlow ? '#/begin' : (S.draft && S.draft.width ? '#/layouts' : '#/'), homeFlow ? 'Back' : 'Your walls'))}
  <main class="page stuff">
    <h1>What you already have</h1>
    <p class="lede">Art and empty frames you own. ${oneWall ? 'Say Keep, Maybe or Skip for this wall.' : 'Every wall uses these first.'} A rough size is fine.</p>
    ${flashHtml()}
    <h2>Art <span class="pencil">${art.length || ''}</span></h2>
    ${art.length ? `<ul class="rows">${art.map(artRow).join('')}</ul>` : '<p class="pencil">Nothing yet.</p>'}
    <div class="acts left">
      <label class="btn file-btn">Add art from a photo<input type="file" accept="image/*" id="stuff-photo"></label>
      <button type="button" class="btn quiet" data-act="stuff-add-art">Add without a photo</button>
    </div>
    <h2>Empty frames <span class="pencil">${frames.length || ''}</span></h2>
    ${frames.length ? `<ul class="rows">${frames.map(frameRow).join('')}</ul>` : '<p class="pencil">None.</p>'}
    <div class="acts left"><button type="button" class="btn quiet" data-act="stuff-add-frame">Add an empty frame</button></div>
    ${homeFlow ? `<div class="dock"><a class="btn wide" href="#/home">${art.length || frames.length ? 'Next: your walls' : 'Nothing yet, go to your walls'}</a></div>` : ''}
  </main>`;
}

function saveHomeDraft() {
  const d = S.draft;
  if (!d || !d.home || d.sample || !d.width) return;
  const { edits, openKey, ...rest } = clone(d);
  store.saveWall(rest);
  const h = myHome();
  if (!h.walls.includes(d.id)) { h.walls.push(d.id); saveHome(h); }
}

// Each wall of the home as you picked it: its price, the frames and prints it needs.
// Prices each wall with its own preferences (frame color, width, mats).
function withWall(w, fn) {
  const was = { d: S.draft, v: S.view };
  const L = w.chosen && w.chosen.layout;
  if (!L) return null;
  try { S.draft = upgradeDraft(clone(w)); S.view = null; PRICE_L = L; return fn(L); }
  finally { S.draft = was.d; S.view = was.v; PRICE_L = null; }
}
function homeSum() {
  const walls = homeWalls().map((w) => {
    const draft = S.draft && S.draft.id === w.id ? { ...w, ...clone(S.draft) } : w;
    const r = withWall(draft, (L) => ({ c: wallPrices(L), frames: frameNeeds(L), prints: printNeeds(L), area: draft.width }));
    return { w: draft, ...(r || { c: null, frames: [], prints: [], area: draft.width }) };
  });
  const picked = walls.filter((x) => x.c);
  const total = picked.reduce((t, x) => ({ n: t.n + x.c.n, art: t.art + x.c.art, frames: t.frames + x.c.frames, unknown: t.unknown + x.c.unknown, framed: t.framed + x.c.framed }), { n: 0, art: 0, frames: 0, unknown: 0, framed: 0 });
  const merge = (lists, keyOf) => { const m = new Map(); for (const n of lists.flat()) { const k = keyOf(n); const e = m.get(k) || { ...n, count: 0 }; e.count += n.count; m.set(k, e); } const area = (k) => k.split('x').reduce((a, b) => a * b, 1); return [...m.values()].sort((a, b) => area(b.key) - area(a.key)); };
  return { walls, picked: picked.length, total, frames: merge(walls.map((x) => x.frames), (n) => `${n.key}|${n.mat || ''}|${n.look || ''}`), prints: merge(walls.map((x) => x.prints), (n) => n.key) };
}
const wallName = (w, i) => w.name || (i === 0 ? 'Main wall' : `Wall ${i + 1}`);
function homeCosts() {
  const h = myHome(), sum = homeSum();
  if (!sum.walls.length) return '';
  const all = sum.total.art + sum.total.frames, B = h.budget || null;
  const rows = sum.walls.map((x, i) => `<li class="home-cost"><span>${esc(wallName(x.w, i))}</span><span>${x.c ? esc(priceWords(x.c)) : `<button type="button" class="link" data-open-home="${esc(x.w.id)}">Pick a wall</button>`}</span></li>`).join('');
  return `<section class="home-go" aria-labelledby="home-get-h"><h2 id="home-get-h">Get it all</h2>
    ${sum.picked ? `<p class="price-line">${esc(priceWords(sum.total))}${sum.picked < sum.walls.length ? ` for ${sum.picked} of ${sum.walls.length} walls` : ''}</p>` : '<p class="pencil">Pick a wall on each to see what it all costs.</p>'}
    <ul class="home-costs">${rows}</ul>
    <form class="budget-form" data-home-budget novalidate><label class="num-in"><span>Budget for the home, all in</span> $<input type="number" inputmode="numeric" min="20" max="100000" step="10" name="budget" value="${B || ''}" placeholder="Type any"></label><button type="submit" class="btn quiet small">Set</button></form>
    ${B && sum.picked ? `<p class="${all > B ? 'note' : 'pencil small'}">${all > B ? `Over by ${money(Math.round(all - B))}.` : `${money(Math.round(B - all))} to spare.`} <button type="button" class="link" data-act="home-split">Split it across the walls</button></p>` : ''}
    ${sum.picked ? '<div class="acts left"><a class="btn" href="#/home-get">Everything to order</a></div>' : ''}
  </section>`;
}
// Everything for the home in one place: the frames for every wall in one table, the
// prints for every wall in one table, and each wall's shop prints with its Get it.
function homeGetScreen() {
  const sum = homeSum();
  const rows = sum.walls.map((x, i) => x.c ? `<li class="home-cost"><span>${esc(wallName(x.w, i))}</span><span>${esc(priceWords(x.c))} <button type="button" class="link" data-open-home-get="${esc(x.w.id)}">Its list</button></span></li>` : '').join('');
  return `${bar(back('#/home', 'Your home'))}
  <main class="page get">
    <h1>Get it all</h1>
    <p class="price-line">${esc(priceWords(sum.total))}</p>
    <ul class="home-costs">${rows}</ul>
    ${locked() ? `<p class="pencil small">Shop prints, printing and frames for every wall are in the full plan, in one place.</p>${planBlock('home')}` : `<p class="pencil small">Shop prints are ordered from each wall's list. Frames and printing for every wall are below, so you can order them at once.</p>
    ${whereToPrint(null, sum.prints)}
    ${whereToFrame(null, sum.frames, sum.prints.length)}`}
  </main>`;
}
function splitHomeBudget() {
  const h = myHome(), B = h.budget, walls = homeWalls();
  if (!B || !walls.length) return;
  const tot = walls.reduce((t, w) => t + w.width, 0);
  for (const w of walls) {
    const b = Math.max(20, Math.round((B * w.width) / tot / 10) * 10);
    store.saveWall({ ...w, budget: b, budgetAsked: true });
    if (S.draft && S.draft.id === w.id) { S.draft.budget = b; S.draft.budgetAsked = true; persist(); }
  }
}

function homeScreen() {
  saveHomeDraft();
  const h = myHome(), walls = homeWalls(), st = myStuff();
  const art = st.filter((x) => x.kind === 'art'), frames = st.filter((x) => x.kind === 'frame');
  const plan = h.planned;
  const title = (id) => { const x = art.find((a) => a.id === id); return x ? x.title : null; };
  const rows = walls.map((w, i) => {
    const mine = (w.owned || []).filter((o) => o.stuff || o.linked);
    const up = (w.owned || []).filter((o) => !o.stuff && !o.linked && o.keep !== 'skip');
    return `<li class="row home-row">
      <span class="home-wall">${wallSvg({ wall: { width: w.width, height: w.height }, obstacles: w.obstacles || [], layout: (w.chosen && w.chosen.layout) || null, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: (id) => { const o = (w.owned || []).find((x) => x.id === id); return o ? { thumb: o.thumb, color: o.color, art: !!o.art } : null; }, still: true, pxWide: 120, label: w.name || `Wall ${i + 1}` })}</span>
      <span class="row-text">
        <label class="name-in"><span>${i === 0 ? 'Main wall' : `Wall ${i + 1}`}</span><input type="text" maxlength="40" data-rename="${esc(w.id)}" value="${esc(w.name || '')}"></label>
        <span class="pencil small">${esc(feet(w.width))} wide${w.style ? `, ${w.style === 'structured' ? 'structured' : 'loose'}` : ''}${w.tone ? `, ${w.tone}` : ''}${up.length ? `. ${up.length} up already` : ''}${mine.length ? `. Yours here: ${esc(mine.map((o) => o.title).join(', '))}` : ''}</span>
      </span>
      <span class="row-side"><button type="button" class="btn quiet small" data-open-home="${esc(w.id)}">Open</button><button type="button" class="link" data-home-remove="${esc(w.id)}">Remove</button></span>
    </li>`;
  }).join('');
  const unplaced = plan && plan.unplaced ? plan.unplaced.map(title).filter(Boolean) : [];
  const upAlready = plan && plan.up ? Object.keys(plan.up).map(title).filter(Boolean) : [];
  return `${bar(back('#/begin', 'Back'), `<a class="btn quiet small" href="#/stuff/home">Your stuff</a>`)}
  <main class="page home-plan">
    <h1>Your home</h1>
    <p class="lede">A photo of each wall, main one first. ${art.length ? `Your ${art.length === 1 ? 'piece goes' : `${art.length} pieces go`} up first.` : 'Your own art goes up first.'}</p>
    ${flashHtml()}
    ${walls.length ? `<ol class="rows home-walls">${rows}</ol>` : '<p class="pencil">No walls yet.</p>'}
    <div class="acts left"><a class="btn${walls.length ? ' quiet' : ''}" href="#/home-add">Add a wall</a></div>
    ${walls.length && art.length ? `<section class="home-go" aria-labelledby="plan-h"><h2 id="plan-h">Spread your pieces</h2>
      <p>${plan ? 'Done. Open a wall to see it with your pieces and new art around them. Changed your walls or your stuff? Spread them again.' : 'Biggest piece on the main wall, then each piece where it fits, sits well with the colors already there, and matches the wall\'s warm or cool.'}</p>
      ${unplaced.length ? `<p class="note">Too big for these walls: ${esc(unplaced.join(', '))}.</p>` : ''}
      ${upAlready.length ? `<p class="pencil small">Already up in a photo, so left where it hangs: ${esc(upAlready.join(', '))}.</p>` : ''}
      <div class="acts left"><button type="button" class="btn${plan ? ' quiet' : ''}" data-act="plan-home">${plan ? 'Spread them again' : 'Spread my pieces across the walls'}</button></div>
    </section>` : ''}
    ${homeCosts()}
    <p class="pencil small">${frames.length ? `${frames.length} empty frame${frames.length === 1 ? '' : 's'} in your stuff: any wall that needs that size uses it first. ` : ''}Each wall keeps its own preferences: open it, then Preferences.</p>
  </main>`;
}

// A piece from your stuff as it goes on a wall: its hanging size, its colors, and the frame it needs when it isn't framed.
function ownedFromStuff(x) {
  const hs = hangSize(x);
  return { id: `own-${x.id}`, stuff: x.id, title: x.title, w: hs.w, h: hs.h, keep: 'must', pinned: false,
    palette: x.palette && x.palette.length ? x.palette : x.color ? [{ hex: x.color, weight: 1 }] : [], thumb: x.thumb || null, color: x.color || null, fromPhoto: false, art: !!x.thumb,
    ...(x.framed ? {} : { framed: false, artSize: { w: x.w, h: x.h }, needsFrame: hs.frame ? { w: hs.frame.w, h: hs.frame.h, print: { w: x.w, h: x.h } } : { w: x.w, h: x.h, print: null, custom: true } }),
    ...(x.lock != null ? { lock: x.lock } : {}), ...(x.ratio ? { ratio: x.ratio } : {}) };
}
// From one wall, art you add to your stuff goes on that wall; a change to a piece you have
// (its size, framed or not) follows it onto the wall it's on.
const fromOneWall = () => route()[0] === 'stuff' && route()[1] !== 'home' && S.draft && !S.draft.sample && !S.draft.home && S.draft.width;
function syncStuff(x, add = false) {
  const d = S.draft;
  if (!d || !x || x.kind !== 'art') return;
  const i = d.owned.findIndex((o) => o.stuff === x.id);
  if (i >= 0) { const o = d.owned[i]; d.owned[i] = { ...ownedFromStuff(x), keep: o.keep, pinned: o.pinned, at: o.at }; }
  else if (add) d.owned.push(ownedFromStuff(x));
  else return;
  resetLayouts(); persist();
}
// A piece in your stuff that's already up in a wall's photo: about the same size (within
// 2 in each way, either way up) and the same colors. Returns { wallId, ownedId } or null.
function alreadyUp(x, walls) {
  const hs = hangSize(x), pal = normalizePalette(x.palette && x.palette.length ? x.palette : x.color ? [{ hex: x.color, weight: 1 }] : []);
  let best = null;
  for (const w of walls) for (const o of w.owned || []) {
    if (o.stuff || o.keep === 'skip') continue;
    const near = (a, b) => Math.abs(a - b) <= 2;
    if (!((near(o.w, hs.w) && near(o.h, hs.h)) || (near(o.w, hs.h) && near(o.h, hs.w)))) continue;
    const q = normalizePalette(o.palette && o.palette.length ? o.palette : o.color ? [{ hex: o.color, weight: 1 }] : []);
    const sim = pal.length && q.length ? paletteSimilarity(pal, q) : 0;
    if (sim >= 0.7 && (!best || sim > best.sim)) best = { wallId: w.id, ownedId: o.id, sim };
  }
  return best;
}
function planHome() {
  const walls = homeWalls();
  const art = myStuff().filter((x) => x.kind === 'art');
  // Art from your stuff that's already up on a wall stays that piece there, not a second copy elsewhere.
  const up = new Map(), taken = new Set();
  for (const x of art) { const u = alreadyUp(x, walls); if (u && !taken.has(u.ownedId)) { up.set(x.id, u); taken.add(u.ownedId); } }
  const r = assignHome(walls.map((w) => ({ id: w.id, width: w.width, height: w.height, obstacles: w.obstacles || [], tone: w.tone || null })),
    art.filter((x) => !up.has(x.id)).map((x) => ({ id: x.id, ...hangSize(x), palette: x.palette })));
  for (const w of walls) {
    const mine = (r.byWall[w.id] || []).map((id) => ownedFromStuff(art.find((a) => a.id === id)));
    const linked = (w.owned || []).filter((o) => !o.stuff).map((o) => { const x = [...up].find(([, u]) => u.ownedId === o.id && u.wallId === w.id); return x ? { ...o, linked: x[0], title: art.find((a) => a.id === x[0]).title || o.title } : o; });
    const next = { ...w, owned: [...linked, ...mine], chosen: null };
    store.saveWall(next);
  }
  const h = myHome(); h.planned = { unplaced: r.unplaced, up: Object.fromEntries([...up].map(([k, u]) => [k, u.wallId])) }; saveHome(h);
  if (S.draft && S.draft.home) { const w = store.getWall(S.draft.id); if (w) { S.draft = upgradeDraft(clone(w)); resetLayouts(); persist(); } }
}

// ---------- Browse: every piece, with filters, like a shop ----------
// Every active piece in a grid, filtered like a normal shop. The heart saves it (your walls
// try it first where it fits, and it counts toward your taste); Not for me keeps it and art
// like it off your walls. "For you" sorts by your taste once you have one.
const BROWSE_PAGE = 60;
const THEME_WORDS = { summer: 'Summer and the sea', sport: 'Sport', city: 'Cities', nature: 'Nature', 'still life': 'Still life', art: 'Art and abstract', animals: 'Animals', mono: 'Black and white' };
function browseItems(f) {
  const no = notForMe();
  const fromPrice = (c) => { const ps = c.sizes.map((z) => z.price).filter((v) => typeof v === 'number'); return ps.length ? Math.min(...ps) : null; };
  let list = CATALOG.filter((c) => !no.has(c.id));
  const r = (c) => c.record;
  if (f.theme) list = list.filter((c) => r(c).tags.theme === f.theme);
  if (f.color === 'bw') list = list.filter((c) => r(c).color.bw); else if (f.color === 'color') list = list.filter((c) => !r(c).color.bw);
  if (f.mood) list = list.filter((c) => (r(c).tags.mood || []).includes(f.mood));
  if (f.shape) list = list.filter((c) => r(c).image.orientation === f.shape);
  if (f.kind === 'shop') list = list.filter((c) => c.offers && c.offers.length); else if (f.kind === 'free') list = list.filter((c) => !(c.offers && c.offers.length));
  if (f.price) { const [lo, hi] = f.price.split('-').map(Number); list = list.filter((c) => { const p = fromPrice(c); return p != null && p >= lo && (!hi || p < hi); }); }
  const d = S.draft;
  const tw = d && d.taste && d.taste.source === 'yours' ? d.taste.weights : null;
  const taste = tw ? scoreTaste(tw, list) : null;
  const saved = new Set(store.loadMe().saved);
  if (f.sort === 'low') list.sort((a, b) => (fromPrice(a) ?? 1e9) - (fromPrice(b) ?? 1e9) || (a.id < b.id ? -1 : 1));
  else if (f.sort === 'high') list.sort((a, b) => (fromPrice(b) ?? -1) - (fromPrice(a) ?? -1) || (a.id < b.id ? -1 : 1));
  else list.sort((a, b) => (taste ? taste[b.id] - taste[a.id] : 0) || looksGood(b) - looksGood(a) || (a.id < b.id ? -1 : 1));
  return { list, fromPrice, saved };
}
function browse() {
  const f = S.ui.browse || (S.ui.browse = { theme: '', color: '', mood: '', shape: '', kind: '', price: '', sort: 'you', n: BROWSE_PAGE });
  const { list, fromPrice, saved } = browseItems(f);
  const sel = (key, label, opts) => `<label class="filter"><span>${label}</span><select data-browse="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}"${f[key] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const d = S.draft, tasteOn = d && d.taste && d.taste.source === 'yours';
  const card = (c) => {
    const p = fromPrice(c), shop = c.offers && c.offers.length;
    return `<li class="art-card"><span class="art-card-img"><img src="${c.imageData}" alt="${esc(c.title)}" loading="lazy" style="aspect-ratio:${c.aspect || 0.8}"></span>
      <span class="art-card-text"><span class="name">${esc(c.title)}</span><span class="pencil small">${locked() ? (shop ? (p != null ? `from $${Math.round(p)}` : 'Print') : 'Photo you print') : `${esc(c.artist || '')}${shop ? `, ${esc(c.source)}` : ', free photo'}${p != null ? ` · from $${Math.round(p)}` : ''}`}</span></span>
      <span class="art-card-acts"><button type="button" class="heart" data-browse-save="${esc(c.id)}" aria-pressed="${saved.has(c.id)}" aria-label="${saved.has(c.id) ? 'Saved' : 'Save'} ${esc(c.title)}">${heart(saved.has(c.id))}</button><button type="button" class="link small" data-browse-no="${esc(c.id)}">Not for me</button></span></li>`;
  };
  const shown = list.slice(0, f.n);
  return `${bar(back(d && d.width ? '#/layouts' : '#/', d && d.width ? 'Your walls' : 'Walldrobe'), '<a class="btn quiet small" href="#/saved">Favorites</a>')}
  <main class="page browse">
    <h1>All the art</h1>
    <p class="lede">${list.length.toLocaleString('en-US')} pieces. Heart what you like; your walls try it first. ${tasteOn ? '' : '<a href="#/taste">Teach it your taste</a> to sort for you.'}</p>
    ${S.undo && /^(Saved|Not for me)/.test(S.undo.label) ? `<p class="sheet-status" role="status">${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button></p>` : ''}
    <details class="filter-box"${S.ui.filtersOpen ? ' open' : ''}><summary>Filter and sort${(() => { const n = ['theme', 'color', 'mood', 'shape', 'kind', 'price'].filter((k) => f[k]).length; return n ? ` <span class="pencil">${n} on</span>` : ''; })()}</summary>
    <div class="filters">
      ${sel('theme', 'Subject', [['', 'Any'], ...Object.entries(THEME_WORDS)])}
      ${sel('color', 'Color', [['', 'Any'], ['color', 'Color'], ['bw', 'Black and white']])}
      ${sel('mood', 'Mood', [['', 'Any'], ['calm', 'Calm'], ['sunny', 'Sunny'], ['moody', 'Moody'], ['bold', 'Bold'], ['playful', 'Playful'], ['elegant', 'Elegant']])}
      ${sel('shape', 'Shape', [['', 'Any'], ['portrait', 'Tall'], ['landscape', 'Wide'], ['square', 'Square']])}
      ${sel('kind', 'From', [['', 'Shops and free'], ['shop', 'Shop prints'], ['free', 'Free photos']])}
      ${sel('price', 'Price', [['', 'Any'], ['0-30', 'Under $30'], ['30-60', '$30 to $60'], ['60-100', '$60 to $100'], ['100-0', '$100 and up']])}
      ${sel('sort', 'Sort', [['you', tasteOn ? 'For you' : 'Best first'], ['low', 'Price, low to high'], ['high', 'Price, high to low']])}
    </div>
    ${['theme', 'color', 'mood', 'shape', 'kind', 'price'].some((k) => f[k]) ? '<button type="button" class="link" data-act="browse-clear">Clear filters</button>' : ''}
    </details>
    ${list.length ? `<ul class="art-grid">${shown.map(card).join('')}</ul>` : '<p class="pencil">Nothing matches. Try fewer filters.</p>'}
    ${list.length > shown.length ? `<div class="feed-end"><button type="button" class="btn quiet" data-act="browse-more">Show more</button><span class="pencil small">${shown.length} of ${list.length.toLocaleString('en-US')}</span></div>` : ''}
  </main>`;
}
function browseSave(id) {
  const me = store.loadMe(), on = me.saved.includes(id);
  me.saved = on ? me.saved.filter((x) => x !== id) : [...me.saved, id];
  if (!on) me.disliked = me.disliked.filter((x) => x !== id);
  store.saveMe(me);
  const d = S.draft;
  if (d && !d.sample) { d.saved = on ? d.saved.filter((x) => x !== id) : [...new Set([...d.saved, id])]; if (!on) d.skipped = d.skipped.filter((x) => x !== id); persist(); if (S.view) S.view.rankKey = null; }
  return !on;
}
function browseNo(id) {
  const me = store.loadMe(), wasSaved = me.saved.includes(id);
  me.disliked = [...me.disliked.filter((x) => x !== id), id];
  me.saved = me.saved.filter((x) => x !== id);
  store.saveMe(me);
  const d = S.draft;
  if (d) { d.saved = d.saved.filter((x) => x !== id); persist(); if (S.view) S.view.rankKey = null; }
  S.undo = { label: 'Not for me.', run: () => { const m = store.loadMe(); m.disliked = m.disliked.filter((x) => x !== id); if (wasSaved) m.saved = [...m.saved, id]; store.saveMe(m); if (d && wasSaved) { d.saved = [...d.saved, id]; persist(); } if (S.view) S.view.rankKey = null; } };
}

// ---------- Where you are: a quiet list of the steps, on a computer ----------
// On a wide screen, a column at the left lists the steps with what each one holds now
// ("34% known", "15 walls fit", "3 of 5 ordered"): where you are, what's done, what's
// next. Plain text, no numbers in boxes, no colored bars; it never decides anything, every
// line is a link back to that step. Phones don't get it: each screen's own button is the next step.
const RAIL_ROUTES = new Set(['check', 'things', 'pieces', 'taste', 'layouts', 'wall', 'frames', 'get', 'hang', 'stuff', 'home', 'browse']);
function railHtml(r0) {
  const d = S.draft;
  if (!d || !d.width || !RAIL_ROUTES.has(r0)) return '';
  const v = S.view && S.view.key === viewKey() ? S.view : null;
  const L = v ? v.list.find((x) => x.key === S.openKey) || null : null;
  const chosen = d.chosen && d.chosen.layout;
  const fresh = (chosen || L) ? (chosen || L).pieces.filter((p) => p.ref.source === 'catalog') : [];
  const tasteOn = d.taste && d.taste.source === 'yours';
  const st = chosen ? orderState(chosen) : null;
  const steps = [
    { id: 'wall', name: 'Your wall', href: d.photo ? '#/check' : '#/things', at: ['check', 'things', 'pieces'], done: true,
      note: `${feet(d.width)} wide${(() => { const n = (d.owned || []).filter((o) => o.keep !== 'skip').length; return n ? `, ${n} of yours` : ''; })()}` },
    { id: 'taste', name: 'Your taste', href: '#/taste', at: ['taste'], done: tasteOn,
      note: tasteOn ? `${knownPct([...yourPicks(), ...feedPairs()])}% known` : 'Not yet: about a minute' },
    { id: 'pick', name: 'Pick a wall', href: '#/layouts', at: ['layouts', 'browse'], done: !!chosen,
      note: v ? `${v.list.length} walls fit` : 'Every wall that fits' },
    { id: 'mine', name: 'Make it yours', href: '#/wall', at: ['wall', 'stuff'], done: !!chosen,
      note: L ? `${(keptSet().size ? `${keptSet().size} kept, ` : '')}${L.pieces.length} pieces` : 'Keep, swap, save' },
    { id: 'frame', name: 'Frame it', href: chosen ? '#/frames' : '', at: ['frames'], done: !!(st && (st.art || st.fr)),
      note: chosen ? `${FRAME_LOOKS[lookOf()].name}${widthKey() === 'standard' ? '' : `, ${FRAME_WIDTHS[widthKey()].name.toLowerCase()}`}` : 'Frames and mats' },
    { id: 'get', name: 'Get it', href: chosen ? '#/get' : '', at: ['get'], done: !!(st && st.done),
      note: st && st.fresh ? `${st.art} of ${st.fresh} ordered` : 'Prints and frames, cheapest first' },
    { id: 'hang', name: 'Hang it', href: chosen ? '#/hang' : '', at: ['hang'], done: !!(d.hung && chosen && d.hung.key === chosen.key),
      note: d.hung ? "It's up" : 'Nails and hangers' },
  ];
  const now = steps.findIndex((x) => x.at.includes(r0));
  // Picking a wall is done once you've opened one; each later step counts the ones before it.
  steps.forEach((x, i) => { if (now >= 0 && i < now && x.id !== 'taste') x.done = true; });
  const check = '<svg class="rail-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const li = (x, i) => {
    const cls = i === now ? 'is-now' : x.done ? 'is-done' : '';
    const inner = `<span class="rail-name">${x.done && i !== now ? check : ''}${esc(x.name)}</span><span class="rail-note">${esc(x.note)}</span>`;
    return `<li class="${cls}">${x.href ? `<a href="${x.href}"${i === now ? ' aria-current="step"' : ''}>${inner}</a>` : `<span class="rail-off">${inner}</span>`}</li>`;
  };
  return `<nav class="rail" aria-label="Steps">
    <a class="wordmark" href="#/" aria-label="Walldrobe"><span class="tab" aria-hidden="true"></span>walldrobe</a>
    <p class="rail-wall">${esc(d.name || 'Your wall')}${d.home ? ' <a href="#/home">Your home</a>' : ''}</p>
    <ol class="rail-steps">${steps.map(li).join('')}</ol>
    <p class="rail-more"><a href="#/browse">Browse the art</a><a href="#/stuff">Your stuff</a><a href="#/walls">Your walls</a></p>
  </nav>`;
}

// ---------- Make it mine: the taste test ----------

function taste() {
  if (need()) { go(need()); return ''; }
  if (!S.quiz) S.quiz = restoreQuiz();
  if (!S.quiz) {
    // Taking it again picks up from what you already chose, with pieces you haven't seen.
    const me = store.loadMe();
    const prior = S.draft.taste && S.draft.taste.source === 'yours' ? picksOf(S.draft.taste.picks) : [];
    const shownIds = new Set(me.quizSeen || []);
    S.quiz = { picks: [], prior, shown: shownIds, n: 0, pair: nextPair(CATALOG, prior, shownIds) || nextPair(CATALOG, prior, new Set()) };
  }
  const q = S.quiz;
  if (q.check) return quizCheck(q);
  const [a, b] = q.pair;
  const pct = knownPct([...(q.prior || []), ...q.picks, ...feedPairs()]);
  const card = (it) => `<button type="button" class="pick" data-pick="${esc(it.id)}" aria-label="${esc(it.title)}"><span class="pick-art" style="--a:${it.aspect || 0.8}"><img src="${it.imageData}" alt=""></span><span class="pick-name">${esc(it.title)}</span></button>`;
  return `${bar(back('#/layouts', 'Your walls'), `<span class="count">${pct}% known</span>`)}
  <main class="page quiz">
    <h1>Which would you rather have on your wall?</h1>
    ${knownBar(pct)}
    <p class="pencil small known-words">${enoughWords(pct)}</p>
    <div class="pair-picks">${card(a)}${card(b)}</div>
    <div class="acts left">
      <button type="button" class="btn quiet small" data-act="quiz-skip">Neither, show me another two</button>
      ${q.n >= 3 ? `<button type="button" class="btn${pct >= ENOUGH ? '' : ' quiet'} small" data-act="quiz-done">${pct >= ENOUGH ? 'Show my walls' : "That's enough, show my walls"}</button>` : ''}
    </div>
  </main>`;
}
// How well we know your taste, 0 to 100, from every pick plus saves against swaps.
// It climbs toward 100 and never gets there (engine/taste.js, tasteKnown).
const knownPct = (picks) => Math.min(99, Math.round(100 * tasteKnown(picks).known));
// Half way is enough to build good walls; past it, picks fine-tune them. Said the same way everywhere.
const ENOUGH = 50;
const enoughWords = (pct) => (pct >= ENOUGH ? 'Enough for good walls. More picks fine-tune them.' : `${ENOUGH}% is enough for good walls.`);
const knownBar = (pct, label = 'How well we know your taste') => `<div class="known" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span class="known-fill" style="width:${pct}%"></span><span class="known-enough" aria-hidden="true"></span></div>`;
// Saves against swaps, as pairs, the same way rankTaste() uses them.
function feedPairs() {
  const d = S.draft;
  if (!d) return [];
  const no = [...notForMe()], out = [];
  for (const w of (d.saved || []).slice(-4)) for (const l of [...(d.skipped || []), ...no]) { const a = byId.get(w), b = byId.get(l); if (a && b) out.push({ winner: a, loser: b }); }
  return out;
}
const yourPicks = () => (S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? picksOf(S.draft.taste.picks) : []);
// Every ten picks: what we know so far, in words, and the choice to stop or keep going.
function quizCheck(q) {
  const all = [...(q.prior || []), ...q.picks];
  const k = tasteKnown([...all, ...feedPairs()]);
  const pct = Math.min(99, Math.round(100 * k.known));
  const w = fitTaste(all);
  const like = describeTaste(w, 4), less = describeTaste(w, 3, -1);
  return `${bar(back('#/layouts', 'Your walls'), `<span class="count">${pct}% known</span>`)}
  <main class="page quiz quiz-check">
    <h1>We know your taste ${pct}%</h1>
    ${knownBar(pct)}
    <dl class="taste-words">
      ${like.length ? `<dt>You like</dt><dd>${esc(like.join(', '))}</dd>` : ''}
      ${less.length ? `<dt>Less into</dt><dd>${esc(less.join(', '))}</dd>` : ''}
      <dt>Still learning</dt><dd>${esc(k.unsure.join(', '))}</dd>
    </dl>
    <p class="pencil small">${enoughWords(pct)} Saves and swaps teach it too.</p>
    <div class="acts left">
      <button type="button" class="btn" data-act="quiz-done">Show my walls</button>
      <button type="button" class="btn quiet" data-act="quiz-more">Keep going</button>
    </div>
    <p><button type="button" class="link" data-act="reset-taste">Start over</button></p>
  </main>`;
}
function saveQuiz() {
  const q = S.quiz;
  if (!q || !S.draft) return;
  S.draft.quizState = { picks: q.picks.map((x) => [x.winner.id, x.loser.id]), shown: [...q.shown], n: q.n, pair: q.pair.map((x) => x.id), check: !!q.check };
  persist();
}
const picksOf = (list) => (list || []).map(([w, l]) => ({ winner: byId.get(w), loser: byId.get(l) })).filter((x) => x.winner && x.loser);
function restoreQuiz() {
  const s = S.draft && S.draft.quizState;
  if (!s) return null;
  const picks = s.picks.map(([w, l]) => ({ winner: byId.get(w), loser: byId.get(l) })).filter((x) => x.winner && x.loser);
  const pair = s.pair.map((id) => byId.get(id));
  if (pair.some((x) => !x)) return null;
  return { picks, shown: new Set(s.shown), n: s.n, pair, check: !!s.check, prior: yourPicks() };
}
function finishQuiz() {
  const q = S.quiz;
  if (q && q.picks.length) {
    const all = [...(q.prior || []), ...q.picks].slice(-60);
    S.draft.taste = { source: 'yours', weights: fitTaste(all), picks: all.map((x) => [x.winner.id, x.loser.id]) };
  }
  // Every piece shown in a pair, kept across tests, so the next test shows new ones.
  if (q) { const me = store.loadMe(); me.quizSeen = [...new Set([...(me.quizSeen || []), ...q.shown])].slice(-400); store.saveMe(me); }
  S.quiz = null;
  S.draft.quizState = null;
  resetLayouts();
  persist();
  go('#/layouts');
}
// The test doesn't end on its own: every QUIZ_LENGTH picks it stops to say what it
// knows, and you choose to see your walls or keep going.
function advanceQuiz(picked) {
  const q = S.quiz;
  q.pair.forEach((it) => q.shown.add(it.id));
  if (picked) q.n++;
  const next = nextPair(CATALOG, [...(q.prior || []), ...q.picks], q.shown);
  if (!next) { finishQuiz(); return; }
  q.pair = next;
  if (picked && q.n % QUIZ_LENGTH === 0) q.check = true;
  saveQuiz();
  render();
  window.scrollTo({ top: 0 });
}

// ---------- The walls ----------

const ownedInfo = (id) => { const o = S.draft.owned.find((x) => x.id === id); return o ? { thumb: o.thumb, color: o.color, art: !!o.art } : null; };
function drawWall(L, pxWide, opts = {}) {
  const d = S.draft;
  return wallSvg({
    wall: { width: d.width, height: d.height }, obstacles: trueObs(d), photo: d.photo && d.photo.flat ? cleanWall() : null, tone: d.photo && d.photo.tone,
    layout: L, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: ownedInfo, keptIds: keptSet(), selected: opts.selected || null,
    measure: !!opts.measure, pxWide, label: opts.label || d.name, still: !!opts.still,
    hideObstacles: !!(d.photo && d.photo.flat), extra: opts.extra || '',
  });
}
const whyText = (L) => (L.moved ? `Placed by you: ${L.pieces.length} piece${L.pieces.length === 1 ? '' : 's'}, ${inches(L.group.w)} across.` : (L.why && L.why.text) || L.summary);
const pxNow = () => ($('#drawing') && $('#drawing').clientWidth) || Math.min(760, (window.innerWidth || 390) - 32);

// The ways a wall can't be shown, said plainly, with the way on.
function noWalls(v) {
  const d = S.draft;
  const p = v.problems.find((x) => x.code !== 'FAMILY_SKIPPED' && x.code !== 'ALL_SHOWN' && x.code !== 'LOOSENED');
  return `${bar(wordmark(), '<button type="button" class="btn quiet small" data-act="change">Preferences</button>')}
  <main class="page">
    <div class="drawing">${drawWall(null, pxNow(), { still: true })}</div>
    ${p && p.code === 'BUDGET_TOO_LOW' ? `<h1 class="why">Nothing fits a $${esc(String(d.budget))} budget yet.</h1>
    <p class="lede">${esc(p.message)} The budget counts the art and a frame for each new piece.</p>
    <div class="acts left"><button type="button" class="btn" data-act="change">Change the budget</button></div>` : `<h1 class="why">There isn't room for art on this wall.</h1>
    <p class="lede">${esc(p ? p.message : '')} Not every wall needs art.</p>
    <div class="acts left"><a class="btn" href="${d.photo ? '#/check' : '#/things'}">Check what's marked</a><a class="btn quiet" href="#/new">Try another wall</a></div>`}
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
function feed() {
  if (need()) { go(need()); return ''; }
  const wait = building();
  if (wait) return wait;
  const v = run();
  if (!v.list.length) return noWalls(v);
  const d = S.draft;
  const px = pxNow();
  const note = v.problems.find((x) => x.code === 'LOOSENED');
  // The taste test, in the list where it's seen: after the second wall, until you've done it.
  // Taken means it knows something: a taste at 0% (picks undone, a fresh start) asks again.
  const pct0 = d.taste && d.taste.source === 'yours' ? knownPct([...yourPicks(), ...feedPairs()]) : 0;
  const tasteCard = pct0 > 0 ? (() => {
    const pct = pct0;
    return `<li class="taste-card"><a href="#/taste" class="taste-link is-text"><span class="taste-text"><span class="name">We know your taste ${pct}%</span>${knownBar(pct)}<span class="pencil small">${enoughWords(pct)}</span></span></a></li>`;
  })() : (() => {
    const pair = nextPair(CATALOG, [], new Set()) || [];
    const tn = (it) => (it ? `<span class="tn new" style="width:${Math.round(56 * Math.min(1, it.aspect || 0.8))}px;height:${Math.round(56 / Math.max(1, it.aspect || 0.8))}px"><img src="${it.imageData}" alt="" loading="lazy"></span>` : '');
    return `<li class="taste-card"><a href="#/taste" class="taste-link"><span class="taste-pair">${tn(pair[0])}<span class="taste-or">or</span>${tn(pair[1])}</span><span class="taste-text"><span class="name">Which do you like more?</span><span class="pencil small">A minute of picks, and every wall ranks for you.</span></span></a></li>`;
  })();
  // A budget, asked in the list after the fourth wall until you set one or say no limit.
  const budgetCard = d.budget || d.budgetAsked ? '' : `<li class="taste-card budget-card"><div class="taste-link is-text"><span class="taste-text"><span class="name" id="budget-q">Budget for this wall?</span><span class="pencil small">${BUDGET_WORDS} <a href="#/stuff">Add yours</a></span>
    <span class="seg budget-seg" role="group" aria-labelledby="budget-q">${BUDGETS.filter(Boolean).map((b) => `<button type="button" data-budget-ask="${b}">$${b.toLocaleString('en-US')}</button>`).join('')}<button type="button" data-budget-ask="0">No limit</button></span>${budgetForm('feed')}</span></div></li>`;
  const tasteTaken = pct0 > 0;
  const browseCard = `<li class="taste-card"><a href="#/browse" class="taste-link is-text"><span class="taste-text"><span class="name">Browse all ${CATALOG.length.toLocaleString('en-US')} pieces</span><span class="pencil small">Save what you like. Your walls try it first.</span></span></a></li>`;
  const items = (tasteTaken ? '' : tasteCard) + v.list.map((L, i) => `<li class="entry">
    <a class="entry-link" href="#/wall" data-wall="${esc(L.key)}" aria-label="Wall ${i + 1} of ${v.list.length}. ${esc(whyText(L))}">
      <span class="drawing">${drawWall(L, px, { still: true, label: `Wall ${i + 1}` })}${d.sample ? '<span class="chip">Sample wall</span>' : ''}</span>
      ${priceTag(L)}
    </a>
  </li>${i === 1 && tasteTaken ? tasteCard : ''}${i === 3 ? budgetCard : ''}${i === (budgetCard ? 5 : 3) ? askCard() : ''}${i === 6 ? browseCard : ''}`).join('');
  return `${bar(d.home ? back('#/home', 'Your home') : wordmark(), `<button type="button" class="btn quiet small" data-act="menu" aria-haspopup="dialog">Menu</button><button type="button" class="btn quiet small" data-act="change" aria-haspopup="dialog">Preferences</button>`)}
  <main class="feed-page">
    <p class="feed-intro">${d.home && d.name ? `${esc(d.name)}: best` : 'Best'} fit first. Tap one to make it yours.</p>
    ${readLine(d)}
    ${note ? `<p class="note">${esc(note.message)}</p>` : ''}
    ${v.moved ? '<p class="note">Ranked again for what you saved and swapped.</p>' : ''}
    ${S.undo && /^(Budget|No budget|Taste test reset)/.test(S.undo.label) ? `<p class="sheet-status" role="status">${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button></p>` : ''}
    ${flashHtml()}
    <ol class="feed">${items}</ol>
    <div class="feed-end"><button type="button" class="btn quiet" data-act="more-walls"${S.busy ? ' disabled' : ''}>${S.busy === 'more' ? 'Making more…' : 'Show more walls'}</button>${S.ui.noMore ? '<span class="pencil small">No more new walls fit here. Try a change in Preferences.</span>' : ''}</div>
  </main><!--sheet-->${sheetHtml()}`;
}

// One wall, open: the drawing, why it works, what's in it, and Get this wall.
// The list and the open wall stay on screen under Preferences while a change builds the
// walls again, so the tap shows at once and the page doesn't blank and fade back.
function keepUnder(name, fn) {
  return () => {
    const fresh = S.view && S.view.key === viewKey();
    if (S.sheet === 'change' && !fresh && S.mem.under && S.mem.under.name === name && !need()) { building(); return S.mem.under.html + sheetHtml(); }
    const html = fn();
    const i = html ? html.indexOf('<!--sheet-->') : -1;
    if (i >= 0 && S.view && S.view.key === viewKey()) S.mem.under = { name, html: html.slice(0, i), L: name === 'wall' ? shown() : null };
    return html;
  };
}
// The tools for the open wall, in one quiet row under it.
function wallTools(L, v) {
  const asIs = v.list.find((x) => x.variant === 'asis');
  const btn = (act, label, on) => `<button type="button" class="link" data-act="${act}"${on == null ? '' : ` aria-pressed="${!!on}"`}>${label}</button>`;
  const tools = [
    L.pieces.some(movable) ? btn('edit', S.edit ? 'Done moving' : 'Move pieces', S.edit) : '',
    btn('measure', 'Measurements', S.measure || S.edit),
    v.orig && v.orig[L.key] ? btn('put-back', 'Put it back') : L.history && L.history.length ? btn('undo-all', 'Put it back') : '',
    asIs && asIs.key !== L.key ? `<a class="link" href="#/wall" data-wall="${esc(asIs.key)}">As it hangs now</a>` : '',
  ].filter(Boolean);
  return `<p class="wall-tools">${tools.join('')}</p>`;
}
function wallScreen() {
  if (need()) { go(need()); return ''; }
  const wait = building();
  if (wait) return wait;
  const v = run();
  if (!v.list.length) return noWalls(v);
  const d = S.draft;
  const L = shown();
  S.openKey = L.key;
  if (d.openKey !== L.key) { d.openKey = L.key; persist(); }
  const i = v.list.findIndex((x) => x.key === L.key);
  const prev = v.list[i - 1], next = v.list[i + 1];
  if (S.selected && !L.pieces.some((p) => p.ref.id === S.selected)) S.selected = null;
  const kept = keptSet();
  const mine = L.pieces.filter((p) => p.ref.source !== 'catalog');
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog').sort((a, b) => b.w * b.h - a.w * a.h);
  // A thumbnail at the piece's own shape, never stretched: yours framed, new ones taped up.
  const tile = (p, big) => {
    const own = p.ref.source !== 'catalog';
    const o = own ? d.owned.find((x) => x.id === p.ref.id) : null;
    const item = own ? null : byId.get(p.ref.id);
    // Big tiles: 150 px tall when upright, at most 128 px wide when sideways, so two fit across at 320.
    const ar = p.w / p.h, h = big ? (ar < 1 ? 150 : 128 / ar) : (ar < 1 ? 56 : 56 / ar), w = h * ar;
    const img = own ? (o && o.thumb) : item.imageData;
    const cls = own ? 'tn own' : `tn new${kept.has(p.ref.id) ? ' kept' : ''}`;
    return `<span class="${cls}" style="width:${w.toFixed(0)}px;height:${h.toFixed(0)}px">${img ? `<img src="${img}" alt="">` : `<span class="swatch" style="background:${esc((o && o.color) || '#8A8F94')}"></span>`}</span>`;
  };
  const yours = mine.map((p) => `<button type="button" class="yours-pc" data-piece="${esc(p.ref.id)}" aria-haspopup="dialog" aria-label="Your ${esc(p.title)}">${tile(p, false)}</button>`).join('');
  const grid = fresh.map((p) => {
    const item = byId.get(p.ref.id);
    const saved = d.saved.includes(p.ref.id);
    return `<li class="piece">
      <button type="button" class="piece-open" data-piece="${esc(p.ref.id)}" aria-haspopup="dialog" aria-label="${esc(item.title)}${kept.has(p.ref.id) ? ', kept' : ''}"><span class="piece-art">${tile(p, true)}</span><span class="piece-name">${esc(item.title)}</span>${kept.has(p.ref.id) ? '<span class="piece-kept">Kept</span>' : ''}</button>
      <button type="button" class="heart" data-save="${esc(p.ref.id)}" aria-pressed="${saved}" aria-label="Favorite ${esc(item.title)}">${heart(saved)}</button>
    </li>`;
  }).join('');
  const total = wallCost(L);
  return `${bar(back('#/layouts', 'All walls'), `<button type="button" class="btn quiet small" data-act="menu" aria-haspopup="dialog">Menu</button><button type="button" class="btn quiet small" data-act="change" aria-haspopup="dialog">Preferences</button>`)}
  <main class="wall-page" style="--ar:${(d.width / d.height).toFixed(3)}">
    <div class="wall-main">
    <div class="drawing-wrap${S.edit ? ' is-editing' : ''}" id="drawing-wrap">
      <div class="drawing" id="drawing">${drawWall(L, pxNow(), { selected: S.selected, measure: S.measure || S.edit, label: `Wall ${i + 1} of ${v.list.length}` })}${d.sample ? '<span class="chip">Sample wall</span>' : ''}</div>
    </div>
    <div class="pager"><button type="button" class="icon-btn" data-goto="${prev ? esc(prev.key) : ''}" aria-label="Wall before"${prev ? '' : ' disabled'}>‹</button><span class="count">${i + 1} of ${v.list.length}</span><button type="button" class="icon-btn" data-goto="${next ? esc(next.key) : ''}" aria-label="Next wall"${next ? '' : ' disabled'}>›</button>
      <span class="wall-acts"><button type="button" class="btn quiet" data-act="save"${savedNow(L) ? ' aria-pressed="true" disabled' : ''}>${savedNow(L) ? 'Saved' : 'Save'}</button><button type="button" class="btn" data-act="get">${total.priced || total.free ? 'Frame it' : 'Hang it'}</button></span></div>
    ${priceLine(L)}
    ${wallTools(L, v)}
    ${progressLine(L)}
    ${S.edit ? editBar(L) : ''}
    ${S.undo ? `<p class="undo">${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button></p>` : ''}
    ${flashHtml()}
    <h1 class="sr-only">${esc(whyText(L))}</h1>
    </div>
    <section class="wall-side" aria-label="In this wall">
    <p class="wall-hint">Tap a piece to swap, keep or save it.</p>
    ${L.pieces.some((p) => p.ref.source === 'catalog' && !keptSet().has(p.ref.id)) ? `<p class="layout-not-art">Love the layout, not the art? <button type="button" class="link" data-act="new-art"${S.busy ? ' disabled' : ''}>New art in these frames</button></p>` : ''}
    ${mine.length ? `<div class="yours"><span class="yours-l">Yours</span>${yours}</div>` : ''}
    ${L.left && L.left.length ? `<p class="pencil small">Left off: ${L.left.map((l) => `your ${esc(l.title)}`).join(', ')}.</p>` : ''}
    ${fresh.length ? `<ul class="pieces">${grid}</ul>` : ''}
    </section>
  </main><!--sheet-->${sheetHtml()}`;
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

// ---------- Sheets ----------

// Where to go: everything that isn't a preference or a tool for the open wall.
function menuSheet() {
  const d = S.draft || {}, n = store.listWalls().length, fav = (d.saved || []).length;
  const item = (href, label, count) => `<li><a class="sheet-item" href="${href}">${label}${count ? ` <span class="pencil">${count}</span>` : ''}</a></li>`;
  return `<h2 id="sheet-h">Menu</h2>
    <ul class="sheet-list">
      ${item('#/walls', 'Your walls', n)}
      ${item('#/saved', 'Favorites', fav)}
      ${item('#/browse', 'Browse all the art')}
      ${item('#/stuff', 'Your art and frames')}
      ${d.width && !d.sample ? item(d.photo ? '#/check' : '#/things', 'Check the wall') : ''}
      ${item('#/begin', 'Start a new wall')}
      ${APP ? item('#/hung', 'Walls people hung') : ''}
      ${APP ? (signedIn() ? item('#/me', 'Your profile') : item('#/signin', 'Sign in')) : ''}
    </ul>`;
}
function sheetHtml() {
  if (!S.sheet) return '';
  const body = S.sheet === 'menu' ? menuSheet() : S.sheet === 'change' ? changeSheet() : S.sheet.piece ? pieceSheet(S.sheet.piece) : S.sheet.wall ? wallSheet(S.sheet.wall) : '';
  if (!body) return '';
  const isPiece = !!(S.sheet && S.sheet.piece) || S.sheet === 'change';
  return `<div class="backdrop${isPiece ? ' is-light' : ''}" data-act="close-sheet"></div>
  <div class="sheet${S.ui.sheetStay ? ' stay' : ''}${isPiece ? ' is-piece' : ''}${isPiece && S.ui.allFor === S.sheet.piece ? ' is-tall' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-h" id="sheet">
    <button type="button" class="icon-btn sheet-x" data-act="close-sheet" aria-label="Close">×</button>
    ${body}
  </div>`;
}
const BUDGETS = [null, 300, 600, 1000, 2000];
// What the budget counts, said the same way everywhere.
const BUDGET_WORDS = 'All in: art, frames and mats. Frames you own are free.';
const budgetForm = (where) => `<form class="budget-form" data-budget-form="${where}" novalidate><label class="num-in"><span class="sr-only">Your budget</span>$<input type="number" inputmode="numeric" min="20" max="20000" step="10" name="budget" value="${S.draft.budget && !BUDGETS.includes(S.draft.budget) ? S.draft.budget : ''}" placeholder="Type any"></label>${S.ui.budgetErr === where ? '<span class="pencil small budget-err" role="alert">$20 or more</span>' : ''}<button type="submit" class="btn quiet small">Set</button></form>`;
// The look in one line: lined up or mixed, and how much of the wall.
function lookWords(style, fullness) {
  const how = { calm: 'a few pieces, lots of bare wall', balanced: 'room to breathe', full: 'a gallery wall, close together' }[fullness] || 'room to breathe';
  const kind = { structured: 'Lined up, even sizes', gallery: 'Mixed sizes' }[style];
  return kind ? `${kind}, ${how}.` : `${how[0].toUpperCase()}${how.slice(1)}.`;
}
function changeSheet() {
  const d = S.draft;
  const onWall = route()[0] === 'wall';
  // While the walls are being built again, the sheet stays up over the walls as they were.
  const stale = !(S.view && S.view.key === viewKey());
  const L = onWall ? (stale ? (S.mem.under && S.mem.under.L) || null : shown()) : null;
  const dis = S.busy ? ' disabled' : '';
  // Each row says what the choice it has means, in a few words, so nothing needs a guess.
  // Each row: a short label beside its choices. Only Look and Budget need a line of help.
  const segBtns = (id, pairs, cur, attr) => `<span class="seg" role="group" aria-labelledby="${id}">${pairs.map(([v, l]) => `<button type="button" data-${attr}="${v == null ? '' : esc(String(v))}" aria-pressed="${cur === v}"${dis}>${esc(l)}</button>`).join('')}</span>`;
  const seg = (id, label, pairs, cur, attr) => `<div class="sheet-row"><span class="label" id="${id}">${label}</span>${segBtns(id, pairs, cur, attr)}</div>`;
  const counts = (S.view && S.view.counts) || [];
  const n = d.pieces || (L ? L.pieces.length : null);
  const fewer = n ? counts.filter((c) => c < n).pop() : null, more = n ? counts.find((c) => c > n) : counts[0];
  const arts = [['both', 'Both'], ['photos', 'Free only'], ['prints', 'Shop'], ...(keptOwned().length ? [['mine', 'Mine']] : [])];
  const tastePct = d.taste && d.taste.source === 'yours' ? knownPct([...yourPicks(), ...feedPairs()]) : 0;
  const status = stale ? 'Building the walls…' : S.undo ? `${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button>` : '';
  return `<h2 id="sheet-h">Preferences</h2>
    ${status ? `<p class="sheet-status" role="status">${status}</p>` : '<p class="sheet-status is-empty" role="status"></p>'}
    <a class="taste-promo" href="#/taste"><span class="taste-promo-text"><span class="name">${tastePct ? `We know your taste ${tastePct}%` : 'Teach it your taste'}</span><span class="pencil small">${tastePct ? enoughWords(tastePct) : 'A minute of picks, and every wall ranks for you.'}</span></span>${knownBar(tastePct)}<span class="taste-promo-go">${tastePct ? 'Keep going' : 'Start'}</span></a>
    ${tastePct || (d.quizState && d.quizState.picks && d.quizState.picks.length) ? `<p class="row-help taste-reset"><button type="button" class="link" data-act="reset-taste"${dis}>Start the taste test over</button></p>` : ''}
    <div class="sheet-row look-row"><span class="label" id="look-l">Look</span>
      <span class="look-segs">${segBtns('look-l', [[null, 'Any'], ['structured', 'Lined up'], ['gallery', 'Mixed']], d.style || null, 'style')}${segBtns('look-l', [['calm', 'Calm'], ['balanced', 'Balanced'], ['full', 'Full']], d.fullness || 'balanced', 'fullness')}</span>
      <span class="row-help">${esc(lookWords(d.style || null, d.fullness || 'balanced'))}</span></div>
    <div class="sheet-row"><span class="label" id="count-l">How many</span>
      <span class="count-ctl"><span class="seg" role="group" aria-labelledby="count-l"><button type="button" data-count="any" aria-pressed="${!d.pieces}"${dis}>Any</button><button type="button" data-count="${n || counts[0] || ''}" aria-pressed="${!!d.pieces}"${dis}>Set</button></span>
      ${d.pieces ? `<span class="stepper" role="group" aria-label="Pieces"><button type="button" class="icon-btn" data-count="${fewer || ''}" aria-label="Fewer pieces"${fewer && !S.busy ? '' : ' disabled'}>−</button><span class="step-n">${n}</span><button type="button" class="icon-btn" data-count="${more || ''}" aria-label="More pieces"${more && !S.busy ? '' : ' disabled'}>+</button></span>` : ''}</span></div>
    ${seg('art-l', 'Art', arts, d.justMine ? 'mine' : artMode(), 'art')}
    ${seg('tone-l', 'Color', [[null, 'Either'], ['warm', 'Warm'], ['cool', 'Cool']], d.tone || null, 'tone')}
    ${(() => { const a = asked(); const row = (q, label, short) => seg(`ask-${q.id}-l`, label, [[`${q.id}:`, 'Any'], ...q.opts.filter((o) => Object.keys(o[2]).length).map(([k, l]) => [`${q.id}:${k}`, short[k] || l])], `${q.id}:${a[q.id] && q.opts.some((o) => o[0] === a[q.id] && Object.keys(o[2]).length) ? a[q.id] : ''}`, 'askset');
      return row(ASK[0], 'Room', { light: 'Light', wood: 'Wood', bold: 'Bold', moody: 'Dark' }) + row(ASK[1], 'Scenes', { real: 'Real', abstract: 'Abstract' }) + row(ASK[2], 'Busy', { quiet: 'Quiet', busy: 'Busy' }); })()}
    ${seg('frame-l', 'Frames', Object.entries(FRAME_LOOKS).map(([k, v]) => [k, v.name]), lookOf(), 'look')}
    ${seg('mats-l', 'Mats', MAT_LEVELS, matLevel(), 'mat')}
    <div class="sheet-row budget-row"><span class="label" id="budget-l">Budget</span>
      <span class="budget-ctl">${segBtns('budget-l', BUDGETS.map((v) => [v, v ? (v >= 1000 ? `$${v / 1000}k` : `$${v}`) : 'Any']), BUDGETS.includes(d.budget || null) ? d.budget || null : 'typed', 'budget')}${budgetForm('sheet')}</span>
      <span class="row-help">${BUDGET_WORDS} <a href="#/stuff">Add yours</a></span></div>
    <div class="acts left"><button type="button" class="link" data-act="reset-prefs"${dis}>Reset preferences</button></div>`;
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
      <p class="meta">${p.w} x ${p.h} in. ${moveNote(p)}</p>
      ${o ? KEEP_SEG(o) : ''}
      ${o && o.at && o.keep !== 'happy' ? `<div class="acts left"><button type="button" class="btn quiet" data-pin="${esc(id)}">${p.role === 'pinned' ? 'Let it move' : 'Pin it where it hangs'}</button></div>` : ''}`;
  }
  const item = byId.get(id);
  const c = item.offers && item.offers.length ? offersAt(item, ...shopPrint(p)).main : null;
  const saved = d.saved.includes(id), kept = keptSet().has(id);
  const all = kept ? [] : choicesFor(L, id);
  const showAll = S.ui.allFor === id;
  const list = showAll ? all : all.slice(0, 4);
  const ar = p.w / p.h;
  const choice = (ch) => {
    const it = byId.get(ch.id);
    return `<li><button type="button" class="choice" data-choice="${esc(ch.id)}" data-for="${esc(id)}" aria-label="Put ${esc(it.title)} here${ch.favorite ? ', a favorite' : ''}">
      <span class="tn new" style="aspect-ratio:${ar}"><img src="${it.imageData}" alt="" data-title="${esc(it.title)}" loading="lazy" decoding="async"></span>${ch.favorite ? `<span class="fav-mark" aria-hidden="true">${heart(true)}</span>` : ''}
    </button></li>`;
  };
  return `<h2 id="sheet-h">${esc(item.title)}</h2>
    <p class="meta">${p.frame && p.frame.border ? `${soldW(p)} x ${soldH(p)} in frame, ${p.w} x ${p.h} in outside` : `${p.w} x ${p.h} in`}.${locked() ? (p.frame && p.frame.margin ? ` Printed with a ${p.frame.margin} in white border.` : '') : ` ${item.offers && item.offers.length ? `Art by ${esc(item.artist)}, sold by ${esc(item.source)}${p.frame && p.frame.margin ? `. Printed with a ${p.frame.margin} in white border` : ''}` : `Photo by ${esc(item.artist)} on ${esc(item.source)}`}`}</p>
    ${kept ? '<p class="pencil small">Kept in every wall. Tap Kept to let it change again.</p>'
      : all.length ? `<ul class="choices${showAll ? ' is-all' : ''}${ar >= 1 ? ' is-wide' : ''}">${list.map(choice).join('')}</ul>
      ${all.length > 4 ? `<button type="button" class="link" data-act="all-choices" data-id="${esc(id)}">${showAll ? 'Show fewer' : `See all ${all.length} that fit`}</button>` : ''}`
      : '<p class="pencil small">No other print comes in this size for this spot.</p>'}
    <div class="acts left">
      <span class="seg feel" role="group" aria-label="How you feel about ${esc(item.title)}"><button type="button" data-save="${esc(id)}" aria-pressed="${saved}">${heart(saved)} Favorite</button><button type="button" data-act="not-for-me" data-id="${esc(id)}">Not for me</button></span>
      <button type="button" class="btn quiet" data-act="keep" data-id="${esc(id)}" aria-pressed="${kept}">${kept ? 'Kept' : 'Keep in every wall'}</button>
      ${L.pieces.length > 1 ? `<button type="button" class="btn quiet" data-act="remove" data-id="${esc(id)}">Remove this frame</button>` : ''}
    </div>
    ${locked() ? '<button type="button" class="btn quiet small fit" data-act="unlock" data-from="piece">Where to get it</button>' : c && c.url ? `<a class="btn quiet small fit" href="${esc(c.url)}" target="_blank" rel="noopener">See it at ${esc(item.source)}</a>` : item.url ? `<a class="btn quiet small fit" href="${esc(item.url)}" target="_blank" rel="noopener">See it on ${esc(item.source)}</a>` : ''}`;
}

// What a wall looks like, for telling whether this one is saved already.
const wallSig = (L) => (L ? L.pieces.map((p) => `${p.ref.id}@${p.x},${p.y},${p.w}x${p.h}`).sort().join('|') : '');
const savedNow = (L) => !!L && store.listWalls().some((w) => (w.from || w.id) === (S.draft.from || S.draft.id) && w.chosen && wallSig(w.chosen.layout) === wallSig(L));
// Save adds a copy of this wall, as it is now, to Your walls. Editing afterwards
// changes the wall you're working on, never the saved one; saving again adds another.
function saveThisWall() {
  const L = shown();
  if (!L) return;
  const d = S.draft;
  const from = d.from || d.id;
  const base = d.base || d.name || 'Wall';
  const n = store.listWalls().filter((w) => (w.from || w.id) === from).length + 1;
  const { edits, openKey, ...rest } = clone(d);
  const copy = { ...rest, id: store.newId(), from, base, name: `${base} ${n}`, chosen: { layout: bareLayout(L), inputKey: viewKey(), at: 0 } };
  if (!store.addWall(copy)) { S.flash = "Didn't save. This device's storage may be full. Try again after deleting an old wall."; return; }
  if (store.demoMode) { S.flash = 'Sample mode: nothing is saved.'; return; }
  S.undo = { label: `Saved as ${copy.name}.`, run: () => { store.deleteWall(copy.id); } };
  if (signedIn()) pushWall(copy).catch((e) => console.warn('sync', e));
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
// The size a new piece's frame is sold as (an 11 x 14 frame), and its outside on the wall.
const soldW = (p) => (p.frame ? p.frame.w : p.w), soldH = (p) => (p.frame ? p.frame.h : p.h);
// A free photo is printed smaller and matted in its frame; a shop print fills its frame.
function printOf(p) {
  if (!matFor(p)) return null;
  if (p.frame && p.frame.print) return [p.frame.print.w, p.frame.print.h];
  if (matWide()) { const k = frameKey(soldW(p), soldH(p)), w = WIDE_PRINT_IN[k]; if (w) return soldW(p) <= soldH(p) ? w : [w[1], w[0]]; }
  if (p.frame && p.frame.can && p.frame.can.mat) return [p.frame.can.mat.w, p.frame.can.mat.h];
  return printSize(soldW(p), soldH(p));
}
// The size a shop print is sold at: the frame's size, or the print inside it when the wall hangs it matted a frame up.
const shopPrint = (p) => (p.frame && p.frame.shopFramed ? [soldW(p), soldH(p)] : p.frame && p.frame.print ? [p.frame.print.w, p.frame.print.h] : p.frame && p.frame.can && p.frame.can.mat && matFor(p) ? [p.frame.can.mat.w, p.frame.can.mat.h] : [soldW(p), soldH(p)]);
// Mat or not, piece by piece. The engine decides with the wall (engine/mats.js): a
// structured wall all the same, a loose one mixed with care, smallest frames first, as
// many as the level you pick. Here the catalog says which ways each size is easy to buy:
// a free photo can go matted (the smaller print in a frame sold "matted to" it) or plain
// (the full-size print in a plain frame); a shop print fills its frame, or hangs a frame
// up matted when the wall picked that size. A piece you flip wins.
const MAT_LEVELS = [['none', 'None'], ['few', 'Few'], ['some', 'Some'], ['most', 'Most'], ['all', 'All']];
const MAT_SHARE = { none: 0, few: 0.25, some: 0.5, most: 0.75, all: 1 };
// The level you picked last carries to new walls.
let ME_MAT = null;
const matLevel = () => { const v = S.draft && S.draft.mat; if (MAT_SHARE[v] != null) return v; if (ME_MAT === null) ME_MAT = store.loadMe().matLevel || ''; return MAT_SHARE[ME_MAT] != null ? ME_MAT : 'most'; };
const cheapestListed = (k) => Math.min(...PRINTERS.map((x) => x.sizes[k]).filter((v) => v != null));
// A size no lab lists is printed at the smallest listed size that holds it, then trimmed.
const PRINT_KEYS = [...new Set(PRINTERS.flatMap((x) => Object.keys(x.sizes)))].map((k) => [k, ...k.split('x').map(Number)]).sort((a, b) => a[1] * a[2] - b[1] * b[2]);
const cheapestPrint = (k) => {
  const v = cheapestListed(k);
  if (Number.isFinite(v)) return v;
  const [a, b] = k.split('x').map(Number);
  const up = PRINT_KEYS.find(([key, x, y]) => x >= a && y >= b && Number.isFinite(cheapestListed(key)));
  return up ? cheapestListed(up[0]) : Infinity;
};
const cheapestFrame = (k, mat, look = 'black') => Math.min(...FRAMERS.map((f) => sizesIn(f, look)[k]).filter(Boolean).filter(([, m]) => mat === undefined || m === mat).map(([pr]) => pr));
// Mark each size with the ways it's easy to buy, once. A shop print comes only in the sizes
// the shop sells. A free photo keeps its own shape: a size is offered when the print fills
// the frame at the photo's ratio, or when the print that sits in that frame's mat does,
// so nothing is cut to fit (a precut mat is always easy to add). A photo no standard size
// fits keeps its nearest sizes, cropped, as before.
const RATIO_OK = 0.04;
const nearRatio = (w, h, a) => Math.abs((w / h) / a - 1) <= RATIO_OK;
for (const c of CATALOG) {
  const shop = c.offers && c.offers.length;
  if (shop) {
    const sells = (w, h) => c.offers.some((o) => !o.gone && !o.framed && ((o.w === w && o.h === h) || (o.w === h && o.h === w)));
    for (const z of c.sizes) {
      if (z.matted) continue;
      z.plainOk = true;
      if (z.framed || z.margin) continue;
      const ps = printSize(z.w, z.h);
      if (ps && sells(ps[0], ps[1])) z.matPrint = { w: ps[0], h: ps[1] };
    }
    continue;
  }
  const a = c.aspect || (c.record && c.record.image.aspect) || 0.8;
  const fit = (z) => { const ps = printSize(z.w, z.h); return { plain: nearRatio(z.w, z.h, a), mat: !!ps && nearRatio(ps[0], ps[1], a), ps }; };
  const kept = c.sizes.filter((z) => { const f = fit(z); return f.plain || f.mat; });
  const exact = kept.length > 0;
  if (exact) c.sizes = kept;
  for (const z of c.sizes) {
    const F = frameKey(z.w, z.h), f = fit(z), ps = f.ps, P = ps ? frameKey(ps[0], ps[1]) : null;
    const matEasy = !!P && Number.isFinite(cheapestListed(P)) && Number.isFinite(cheapestFrame(F, P));
    const plainEasy = Number.isFinite(cheapestListed(F)) && Number.isFinite(cheapestFrame(F));
    if (exact) {
      if (f.mat) z.matPrint = { w: ps[0], h: ps[1] };
      z.plainOk = f.plain && (plainEasy || !f.mat || !matEasy);
    } else {
      if (matEasy) z.matPrint = { w: ps[0], h: ps[1] };
      z.plainOk = plainEasy || !matEasy;
    }
  }
}
// ---------- All in: what a piece costs with its frame ----------
// The art (a shop's price, or printing a free photo at the cheapest lab) plus the
// cheapest frame for its size. A frame sold matted to the print, or a plain frame and a
// precut mat. A frame size you already own an empty frame in costs nothing. Unknown
// when any part has no price we know, so the engine never counts it under a budget.
const MAT_ONLY = { '8x10|5x7': 4.99, '11x14|8x10': 2.99, '16x20|11x14': 9.79, '18x24|12x18': 16.49 };
const matOnly = (F, P) => MAT_ONLY[`${F}|${P}`] ?? 10;
const haveFrameKeys = () => [...new Set(myStuff().filter((x) => x.kind === 'frame').map((f) => frameKey(f.w, f.h)))].sort();
function frameCost(F, P, have, lookIn = lookOf()) {
  if (have.has(F)) return P ? matOnly(F, P) : 0; // your frame, and a precut mat when it's matted
  const look = Number.isFinite(cheapestFrame(F, undefined, lookIn)) ? lookIn : 'black';
  const plain = cheapestFrame(F, undefined, look);
  if (!P) return Number.isFinite(plain) ? plain : null;
  const ways = [cheapestFrame(F, P, look), Number.isFinite(plain) ? plain + matOnly(F, P) : Infinity].filter(Number.isFinite);
  return ways.length ? Math.min(...ways) : null;
}
function allInOf(c, z, have) {
  const F = frameKey(z.w, z.h), one = ((S.draft && S.draft.colorFor) || {})[c.id], lk = FRAME_LOOKS[one] ? one : lookOf();
  const add = (a, b) => (a == null || b == null ? null : Math.round((a + b) * 100) / 100);
  if (c.offers && c.offers.length) {
    if (typeof z.price !== 'number') return null;
    if (z.framed) return z.price;
    const plainAll = add(z.price, frameCost(F, z.matted ? frameKey(z.matted.w, z.matted.h) : null, have, lk));
    if (!z.matPrint) return plainAll;
    const o = c.offers.find((x) => !x.gone && !x.framed && typeof x.price === 'number' && ((x.w === z.matPrint.w && x.h === z.matPrint.h) || (x.w === z.matPrint.h && x.h === z.matPrint.w)));
    const mattedAll = o ? add(o.price, frameCost(F, frameKey(z.matPrint.w, z.matPrint.h), have, lk)) : null;
    const lv = matLevel(), ok = (v) => v != null && Number.isFinite(v);
    const ways = (lv === 'none' ? [plainAll] : lv === 'all' ? [mattedAll ?? plainAll] : [plainAll, mattedAll]).filter(ok);
    return ways.length ? Math.min(...ways) : null;
  }
  const lv = matLevel();
  const plain = z.plainOk ? add(cheapestPrint(F), frameCost(F, null, have, lk)) : null;
  const matted = z.matPrint ? add(cheapestPrint(frameKey(z.matPrint.w, z.matPrint.h)), frameCost(F, frameKey(z.matPrint.w, z.matPrint.h), have, lk)) : null;
  const ok = (v) => v != null && Number.isFinite(v);
  const ways = lv === 'none' ? [plain] : lv === 'all' ? [matted ?? plain] : [plain, matted];
  const fin = ways.filter(ok);
  return fin.length ? Math.min(...fin) : null;
}
// The catalog as this wall buys it: each size with this wall's frame width (the
// moulding sets the outside size), and with a budget, its all-in price.
let SHAPED = { key: null, list: null };
function shapeCatalog(catalog) {
  const d = S.draft, b = widthOf().border, wide = b !== RULES.frameBorder, noMats = matLevel() === 'none';
  if (!d.budget && !wide && !noMats) return catalog;
  const key = `${d.budget ? `${matLevel()}|${lookOf()}|${JSON.stringify(d.colorFor || {})}|${haveFrameKeys().join()}` : ''}|${b}|${noMats}|${catalog.length}|${catalog[0] && catalog[0].id}|${catalog.length && catalog[catalog.length - 1].id}`;
  if (SHAPED.key !== key) {
    const have = new Set(haveFrameKeys());
    // With no mats, a free photo only comes in the sizes it fills without being cut.
    const sizesOf = (c) => (noMats && !(c.offers && c.offers.length) && c.sizes.some((z) => z.plainOk !== false) ? c.sizes.filter((z) => z.plainOk !== false) : c.sizes);
    SHAPED = { key, list: catalog.map((c) => ({ ...c, sizes: sizesOf(c).map((z0) => {
      const z = wide && !z0.framed ? { ...z0, border: b } : z0;
      if (!d.budget) return z;
      const v = allInOf(c, z, have); const { price, ...rest } = z; return v == null ? rest : { ...rest, price: v };
    }) })) };
  }
  return SHAPED.list;
}
let MAT_MEMO = { key: null, map: null };
// A wall of the home being priced from the home page, not the wall that's open.
let PRICE_L = null;
function matsOf(L) {
  const lv = matLevel(), key = `${L.key}|${lv}|${L.pieces.map((p) => `${p.ref.id}@${p.w}x${p.h}`).join(',')}`;
  if (MAT_MEMO.key !== key) MAT_MEMO = { key, map: assignMats(L.pieces, { family: L.family, variant: L.variant, level: lv }) };
  return MAT_MEMO.map;
}
function matFor(p) {
  const item = p.ref && p.ref.source === 'catalog' ? byId.get(p.ref.id) : null;
  if (!item) return false;
  if (item.offers && item.offers.length && p.frame && p.frame.print) return true;
  const can = p.frame && p.frame.can;
  if (!can || !can.mat) return false;
  const d = S.draft || {}, one = (d.matFor || {})[p.ref.id];
  if (typeof one === 'boolean' && can.plain) return one;
  if (!can.plain) return true;
  const L = PRICE_L || (S.view ? shown() : null);
  if (L && L.pieces.some((x) => x.ref.id === p.ref.id)) { const v = matsOf(L).get(p.ref.id); if (typeof v === 'boolean') return v; }
  return typeof p.mat === 'boolean' ? p.mat : MAT_SHARE[matLevel()] >= 0.5;
}
// A piece you can flip: it's easy to get either way.
const canMat = (p) => { const can = p.frame && p.frame.can; return !!(can && can.mat && can.plain); };
setPrintFor(printOf);
// The frames step: one look for every new frame, and a mat or not on the free photos.
const FRAME_LOOKS = {
  black: { name: 'Black', hex: '#1E1E1E' },
  white: { name: 'White', hex: '#F3F2EE', edge: '#B9B6AE' },
  oak: { name: 'Oak', hex: '#B07D4F' },
  brass: { name: 'Brass', hex: '#B8955A' },
};
const lookOf = () => (S.draft && FRAME_LOOKS[S.draft.look] ? S.draft.look : 'black');
// The link for a print sold framed in one color: the build keeps just the variant.
const colorUrl = (o, c) => { const v = o.colors && o.colors[c]; return !v ? o.url : /^https:/.test(v) ? v : `${o.url.split('?')[0]}?variant=${v}`; };
// The colors a print sold framed comes in (House of Spoils: black, white, natural wood), or null.
const shopColors = (p) => { const item = p.ref && byId.get(p.ref.id); if (!item || !(item.offers || []).length || needsFrame(p)) return null; const o = offersAt(item, ...shopPrint(p)).main; return o && o.colors ? Object.keys(o.colors).filter((k) => FRAME_LOOKS[k]) : null; };
// One piece's frame color: its own when you picked one, else the wall's. A print sold
// framed only comes in the shop's colors, so brass there is the nearest, oak.
function colorOf(p) {
  const one = ((S.draft && S.draft.colorFor) || {})[p.ref.id];
  const c = FRAME_LOOKS[one] ? one : lookOf();
  const can = shopColors(p);
  if (!can || !can.length || can.includes(c)) return c;
  return c === 'brass' && can.includes('oak') ? 'oak' : can[0];
}
const ownColor = (p) => { const one = ((S.draft && S.draft.colorFor) || {})[p.ref.id]; return FRAME_LOOKS[one] && one !== lookOf() ? one : null; };
setFrameColorFor((p) => { const c = colorOf(p); return c === lookOf() ? null : FRAME_LOOKS[c]; });
// How wide the moulding is. Slim and standard are what most ready-made frames are; wide
// is easy in a few sizes (IKEA EDSBRUK) and custom past them.
const FRAME_WIDTHS = {
  slim: { name: 'Slim', border: 0.5, words: 'about 1/2 in' },
  standard: { name: 'Standard', border: RULES.frameBorder, words: 'about 3/4 in' },
  wide: { name: 'Wide', border: 1.5, words: 'about 1 1/2 in' },
};
const widthKey = () => (S.draft && FRAME_WIDTHS[S.draft.frameWidth] ? S.draft.frameWidth : 'standard');
const widthOf = () => FRAME_WIDTHS[widthKey()];
// A wide mat is the same frame with a print two sizes down: more white around it.
const WIDE_PRINT_IN = { '11x14': [5, 7], '12x16': [6, 8], '16x20': [8, 10], '18x24': [11, 14], '24x30': [16, 20], '24x36': [18, 24], '30x40': [20, 30], '16x16': [8, 8], '20x20': [12, 12] };
const matWide = () => !!(S.draft && S.draft.matWidth === 'wide');
// Every new frame on the wall in another width: each grows or shrinks about its center,
// and the wall is checked as placed. With Undo; nothing changes if it doesn't fit.
function setFrameWidth(k) {
  const L = shown();
  const was = widthKey();
  if (!L || !FRAME_WIDTHS[k] || k === was) return;
  const b = FRAME_WIDTHS[k].border, q4 = (v) => Math.round(v * 4) / 4;
  S.draft.frameWidth = k;
  const placed = L.pieces.map((p) => {
    if (p.ref.source !== 'catalog' || !p.frame || !p.frame.border) return { id: p.ref.id, x: p.x, y: p.y, w: p.w, h: p.h };
    const w = p.frame.w + 2 * b, h = p.frame.h + 2 * b;
    return { id: p.ref.id, x: q4(p.x + p.w / 2 - w / 2), y: q4(p.y + p.h / 2 - h / 2), w, h };
  });
  // Wider frames take more room: when they'd crowd as laid out, the pieces spread from the
  // group's middle a little at a time until the gaps work again.
  const cx0 = L.pieces.reduce((t, p) => t + p.x + p.w / 2, 0) / L.pieces.length, cy0 = L.pieces.reduce((t, p) => t + p.y + p.h / 2, 0) / L.pieces.length;
  const stay = new Set(L.pieces.filter((x) => x.role === 'pinned').map((x) => x.ref.id));
  const spread = ([fx, fy, dy]) => placed.map((q) => { if (stay.has(q.id)) return q; const cx = q.x + q.w / 2, cy = q.y + q.h / 2; return { ...q, x: q4(cx0 + (cx - cx0) * fx - q.w / 2), y: q4(cy0 + (cy - cy0) * fy - q.h / 2 + dy) }; });
  let r, hard = [];
  // Sideways first (the room is usually there), then up and down too, then the group a
  // little lower, since the frames grow at the top as well.
  const tries = [];
  for (const dy of [0, -1.5, -3]) for (const f of [[1, 1], [1.04, 1], [1.08, 1], [1.12, 1], [1.16, 1], [1.06, 1.04], [1.1, 1.06]]) tries.push([...f, dy]);
  for (const f of tries) {
    try { r = scoreArrangement(engineInput(), f[0] === 1 && f[1] === 1 && !f[2] ? placed : spread(f)); } catch (e) { console.error(e); r = null; }
    hard = r ? (r.breaks || []).filter((x) => x.hard) : [];
    if (r && !hard.length && !r.fails.some((x) => /doesn't come in/.test(x))) break;
  }
  if (!r || hard.length || r.fails.some((f) => /doesn't come in/.test(f))) { S.draft.frameWidth = was; S.flash = `${FRAME_WIDTHS[k].name} frames don't fit this wall as it's laid out.${hard.length ? ` ${hard[0].message}` : ''}`; return; }
  const pinned = new Set(L.pieces.filter((x) => x.role === 'pinned').map((x) => x.ref.id));
  const prev = L, prevChosen = S.draft.chosen, prevOpen = S.openKey;
  const next = { ...r.layout, key: L.key, pieces: r.layout.pieces.map((x) => (pinned.has(x.ref.id) ? { ...x, role: 'pinned' } : x)), history: L.history, moved: L.moved };
  // The width is part of every wall from here (the list builds again with it); this
  // wall stays the one you're getting, first, as you had it.
  S.draft.chosen = { layout: bareLayout(next), inputKey: viewKey(), at: 0 };
  S.openKey = next.key;
  S.ui.saved = null; persist();
  S.undo = { label: `${FRAME_WIDTHS[k].name} frames.`, run: () => { S.draft.frameWidth = was; S.draft.chosen = prevChosen; S.openKey = prevOpen || prev.key; persist(); } };
}
function applyLook() {
  const lk = FRAME_LOOKS[lookOf()], st = document.documentElement.style;
  st.setProperty('--frame-new', lk.hex);
  if (lk.edge) st.setProperty('--frame-new-edge', lk.edge); else st.removeProperty('--frame-new-edge');
}
// A mat's window is a little smaller than the print, so it holds the print's edges: 1/4 in each side.
const MAT_LIP = 0.25;
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
    const o = offersAt(item, ...shopPrint(p)).main;
    if (!o || o.price == null) { out.unpriced++; continue; }
    out.total += o.price; out.priced++; out.shops.add(item.source); out.cur = o.currency || 'USD';
    if (o.framed) out.framed++;
  }
  out.total = Math.round(out.total * 100) / 100;
  return out;
}
// What a wall costs, split the way people think about it: the art (shop prices, and printing
// for the free photos) and the frames (the cheapest for each size in this wall's look, with
// a mat where one goes; a frame you own costs nothing; a print sold framed counts as art).
// Your own pieces that need a frame add theirs. Shipping and tax aren't in it.
function wallPrices(L) {
  const have = new Set(haveFrameKeys());
  const out = { n: 0, art: 0, frames: 0, unknown: 0, framed: 0 };
  const addFrame = (F, P, lk) => { const f = frameCost(F, P, have, lk); if (f == null) out.unknown++; else out.frames += f; };
  for (const p of L.pieces) {
    if (p.ref.source === 'catalog') {
      const item = byId.get(p.ref.id);
      if (!item) continue;
      out.n++;
      const F = frameKey(soldW(p), soldH(p));
      if (item.offers && item.offers.length) {
        const o = offersAt(item, ...shopPrint(p)).main;
        if (!o || o.price == null) { out.unknown++; continue; }
        out.art += o.price;
        if (o.framed) out.framed++;
        const pr = printOf(p);
        if (!o.framed) addFrame(F, pr ? frameKey(pr[0], pr[1]) : null, colorOf(p));
      } else {
        const ps = printOf(p), P = ps ? frameKey(ps[0], ps[1]) : null;
        const pr = cheapestPrint(P || F);
        if (Number.isFinite(pr)) out.art += pr; else out.unknown++;
        addFrame(F, P, colorOf(p));
      }
    } else {
      const o = S.draft.owned.find((x) => x.id === p.ref.id), f = o && o.needsFrame;
      if (!f || f.custom) continue;
      const P = f.print && (f.print.w !== f.w || f.print.h !== f.h) ? frameKey(f.print.w, f.print.h) : null;
      addFrame(frameKey(f.w, f.h), P, colorOf(p));
    }
  }
  out.art = Math.round(out.art); out.frames = Math.round(out.frames);
  return out;
}
// "$1,000 (+$200 to frame)": the art first, the frames after. A + when part can't be priced.
const priceWords = (c) => `${money(Math.round(c.art))}${c.frames ? ` (+${money(Math.round(c.frames))} to frame)` : c.n && c.framed === c.n ? ', framed' : ''}${c.unknown ? '+' : ''}`;
const priceLine = (L) => { const c = wallPrices(L); return c.n || c.frames ? `<p class="price-line">${priceWords(c)}</p>` : ''; };
const priceTag = (L) => { const c = wallPrices(L); return c.n || c.frames ? `<span class="price-tag">${priceWords(c)}</span>` : ''; };
const frameLink = (w, h) => `https://www.amazon.com/s?k=${encodeURIComponent(`${Math.min(w, h)}x${Math.max(w, h)} picture frame with mat`)}`;

// The wall's size is measured when you typed it or set it by tape; a size
// worked out from a TV or a door in the photo is an estimate.
function sizeMeasured(d) {
  const p = d.photo;
  if (!p) return true;
  if (p.auto && p.auto.guess) return p.auto.guess.from === 'measure';
  return !!(p.measure && p.measure.value);
}
// What the wall's size was worked out from, in words.
function sizeSource(d) {
  const f = d.photo && d.photo.auto && d.photo.auto.guess ? d.photo.auto.guess.from : null;
  return { tv: 'the TV', door: 'the door', bed: 'the bed', couch: 'the couch', ceiling: 'the ceiling height', outlet: 'an outlet' }[f] || 'what we could see';
}
// The thing under or beside the art to check a spot against.
function furnitureWord(d) {
  const o = (d.obstacles || []).find((x) => ['couch', 'bed', 'dresser', 'console', 'sideboard', 'credenza', 'tv', 'desk', 'table'].includes(x.kind));
  return o ? (obName(o) === 'TV' ? 'the TV' : `the ${obName(o).toLowerCase()}`) : 'the room';
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

// The prints the free photos on this wall need, by size: [{ key: '8x10', count }].
// A frame with a standard mat holds the smaller print; a frame without one (the
// statement sizes) holds a print its own size.
function printNeeds(L) {
  const m = new Map();
  for (const p of L.pieces.filter((x) => x.ref.source === 'catalog')) {
    const item = byId.get(p.ref.id);
    if (!item || (item.offers && item.offers.length)) continue;
    const ps = (matFor(p) && printOf(p)) || [soldW(p), soldH(p)];
    const k = sizeKey(ps[0], ps[1]);
    m.set(k, (m.get(k) || 0) + 1);
  }
  const area = (k) => k.split('x').reduce((a, b) => a * b, 1);
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => area(b.key) - area(a.key));
}
// The frames this wall needs, by the size sold and the print its mat holds:
// [{ key: '11x14', mat: '8x10' | null, count }]. A print a shop sells framed needs none.
function frameNeeds(L) {
  const m = new Map();
  for (const p of L.pieces.filter((x) => x.ref.source === 'catalog')) {
    const item = byId.get(p.ref.id);
    if (!item) continue;
    const shop = item.offers && item.offers.length ? offersAt(item, ...shopPrint(p)).main : null;
    if (shop && shop.framed) continue;
    const ps = matFor(p) ? printOf(p) : null;
    const key = frameKey(soldW(p), soldH(p)), mat = ps ? frameKey(ps[0], ps[1]) : null, look = colorOf(p);
    const k = `${key}|${mat || ''}|${look}`;
    const o = m.get(k) || { key, mat, look, count: 0 };
    o.count++; m.set(k, o);
  }
  // Your own art that isn't framed yet gets a frame too.
  for (const p of L.pieces.filter((x) => x.ref.source === 'owned')) {
    const o = S.draft.owned.find((x) => x.id === p.ref.id);
    if (!o || !o.needsFrame || o.needsFrame.custom) continue;
    const key = frameKey(o.needsFrame.w, o.needsFrame.h), pk = o.needsFrame.print ? frameKey(o.needsFrame.print.w, o.needsFrame.print.h) : null;
    const mat = pk && pk !== key ? pk : null, look = colorOf(p);
    const k = `${key}|${mat || ''}|${look}`;
    const e = m.get(k) || { key, mat, look, count: 0 };
    e.count++; m.set(k, e);
  }
  const area = (k) => k.split('x').reduce((a, b) => a * b, 1);
  return [...m.values()].sort((a, b) => area(b.key) - area(a.key));
}
const usd = (n) => `$${Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n) : n.toFixed(2)}`;
// A price table, one row per seller, a column per size and the total; the best ones marked.
function priceTable({ label, needed, rows, tag, col, cell }) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(label)}"><table class="prices"><thead><tr><th scope="col">${label === 'Frame prices' ? 'Seller' : 'Service'}</th>${needed.map((n) => `<th scope="col">${col(n)}</th>`).join('')}<th scope="col">Total</th></tr></thead>
      <tbody>${rows.map((r) => { const t = tag(r); return `<tr${t.length ? ' class="is-pick"' : ''}><td><a href="${esc(r.p.url)}" target="_blank" rel="noopener">${esc(r.p.name)}</a>${t.map((x) => `<span class="pr-tag">${x}</span>`).join('')}<span class="pr-note">${esc(r.p.kind === 'Store' ? r.p.pickup : `Ships ${r.p.ships[0].toLowerCase()}${r.p.ships.slice(1)}`)}. ${esc(r.p.note)}.</span></td>${r.each.map((x, i) => `<td>${x == null ? '<span class="pr-none">No</span>' : cell(x, needed[i])}</td>`).join('')}<td>${r.all ? usd(r.total) : '<span class="pr-none">Not all</span>'}</td></tr>`; }).join('')}</tbody></table></div>`;
}
const sizeWords = (k) => k.replace('x', '\u00a0x\u00a0');
// Where to print the free photos: every service with its regular price for each size, the best three marked.
function whereToPrint(L, needed = printNeeds(L)) {
  if (!needed.length) return '';
  const rows = printOptions(needed);
  const pk = printPicks(rows);
  const tag = (r) => [r === pk.cheapest && 'Best price', r === pk.today && 'Same day', r === pk.better && 'Better print'].filter(Boolean);
  const lead = needed.map((n) => `${n.count} at ${sizeWords(n.key)}\u00a0in`).join(', ');
  const best = [pk.cheapest && `<li><span class="pr-tag">Best price</span> ${esc(pk.cheapest.p.name)}, ${usd(pk.cheapest.total)} for all</li>`,
    pk.today && `<li><span class="pr-tag">Same day</span> ${esc(pk.today.p.name)}, ${usd(pk.today.total)}, pickup today</li>`,
    pk.better && `<li><span class="pr-tag">Better print</span> ${esc(pk.better.p.name)}, ${usd(pk.better.total)}, a pro lab</li>`].filter(Boolean).join('');
  return `<section class="where" aria-labelledby="where-h"><h2 id="where-h">Print the free photos</h2>
    <p>Your free photos need ${lead}. Plain photo or poster paper. Regular prices, before any code.</p>
    ${best ? `<ul class="pr-picks">${best}</ul>` : ''}
    ${priceTable({ label: 'Print prices', needed, rows, tag, col: (n) => `${sizeWords(n.key)}${n.count > 1 ? `<span class="pr-count">${n.count} prints</span>` : ''}`, cell: (x) => usd(x) })}
    <p class="pencil small">Prices checked ${PRICES_CHECKED}. Walldrobe takes nothing on these prints. The photos are free for your own wall, not to sell.</p>
  </section>`;
}
// Where to frame: every seller with a plain black frame in each size, whether its mat fits, the best three marked.
function whereToFrame(L, needed = frameNeeds(L), prints = L ? printNeeds(L).length : 0) {
  if (!needed.length) return '';
  const rows = frameOptions(needed, lookOf(), widthKey());
  const pk = framePicks(rows);
  const tag = (r) => [r === pk.cheapest && 'Best price', r === pk.today && 'Same day', r === pk.better && (r.p.id === 'framebridge' ? 'Done for you' : 'Better frame')].filter(Boolean);
  const looks = [...new Set(needed.map((n) => n.look || 'black'))], mixed = looks.length > 1, lkName = (k) => FRAME_LOOKS[k].name.toLowerCase();
  const lead = needed.map((n) => `${n.count} at ${sizeWords(n.key)}\u00a0in${mixed ? ` ${lkName(n.look)}` : ''}${n.mat ? ` with a mat for ${sizeWords(n.mat)}` : ''}`).join(', ');
  const best = [pk.cheapest && `<li><span class="pr-tag">Best price</span> ${esc(pk.cheapest.p.name)}, ${usd(pk.cheapest.total)} for all${pk.cheapest.mats ? '' : ', some mats to buy separately'}</li>`,
    pk.today && `<li><span class="pr-tag">Same day</span> ${esc(pk.today.p.name)}, ${usd(pk.today.total)}, pickup today</li>`,
    pk.better && `<li><span class="pr-tag">${pk.better.p.id === 'framebridge' ? 'Done for you' : 'Better frame'}</span> ${esc(pk.better.p.name)}, ${usd(pk.better.total)}${pk.better.p.id === 'framebridge' ? (prints ? ', printed, matted and framed' : ', framed for you; you mail in your prints') : ', real glass'}</li>`].filter(Boolean).join('');
  const anyMat = needed.some((n) => n.mat);
  return `<section class="where" aria-labelledby="frame-h"><h2 id="frame-h">Get the frames</h2>
    <p>${L ? 'This wall needs' : 'Your home needs'} ${needed.reduce((t, n) => t + n.count, 0) === 1 ? 'one frame' : `${needed.reduce((t, n) => t + n.count, 0)} frames`}: ${lead}. Prices are for ${widthKey() === 'standard' ? '' : `${FRAME_WIDTHS[widthKey()].name.toLowerCase()} `}${mixed ? 'frames in their colors' : `${lkName(looks[0])} frames`}, regular prices before any sale${looks.every((k) => k === 'black') ? '' : `; not every seller has every size in ${mixed ? 'every' : 'this'} color`}.</p>
    ${best ? `<ul class="pr-picks">${best}</ul>` : ''}
    ${priceTable({ label: 'Frame prices', needed, rows, tag, col: (n) => `${sizeWords(n.key)}${mixed ? `<span class="pr-count">${lkName(n.look)}</span>` : ''}${n.mat ? `<span class="pr-count">mat ${sizeWords(n.mat)}</span>` : ''}${n.count > 1 ? `<span class="pr-count">${n.count} frames</span>` : ''}`, cell: (x, n) => `${usd(x.price)}${n.mat ? `<span class="pr-mat${x.matOk ? '' : ' is-off'}">${x.matOk ? 'mat fits' : x.mat ? `mat ${sizeWords(x.mat)}` : 'no mat'}</span>` : ''}` })}
    ${anyMat ? '<p class="pencil small">Buy frames sold "matted to" your print size (11 x 14 matted to 8 x 10). The mat hides a quarter inch on each edge. No matching mat? A precut one is $3 to $10.</p>' : ''}
    <p class="pencil small">Prices checked ${FRAMES_CHECKED}.</p>
  </section>`;
}
// One question for your own AI with every print and frame on this wall, for today's codes.
function wallQuestion(L) {
  const pn = printNeeds(L), fn = frameNeeds(L);
  const fr = frameOptions(fn, lookOf(), widthKey());
  return aiQuestion(pn, printOptions(pn), fn.length ? { needed: fn, table: framesTable(fn, fr), checked: FRAMES_CHECKED } : null);
}
function copyBlock(L) {
  if (!printNeeds(L).length && !frameNeeds(L).length) return '';
  return `<section class="where ask" aria-label="Find today's codes">
    <p class="pencil small">These shops run 40 to 75% off sales most weeks. Paste both tables into an AI chat to find today's codes.</p>
    <div class="acts left copy-row"><button type="button" class="btn quiet" data-act="copy-ai">Copy for your AI</button><span class="copy-status" role="status">${S.ui.copied === 'ok' ? 'Copied. Paste it into your AI.' : S.ui.copied === 'no' ? 'Could not copy. Select the table and copy it.' : ''}</span></div>
  </section>`;
}
// The whole wall in two lines: what to get, and what printing and frames cost at the cheapest.
function wallSummary(L) {
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
  if (!fresh.length) return '';
  const pn = printNeeds(L), fn = frameNeeds(L);
  const nPrint = pn.reduce((t, n) => t + n.count, 0), nFrame = fn.reduce((t, n) => t + n.count, 0), nMat = fn.filter((n) => n.mat).reduce((t, n) => t + n.count, 0);
  const shop = fresh.filter((p) => (byId.get(p.ref.id).offers || []).length).length;
  const parts = [shop && `${shop} from ${shop === 1 ? 'a shop' : 'shops'}`, nPrint && `${nPrint} to print`, nFrame && `${nFrame} frame${nFrame === 1 ? '' : 's'}`, nMat && `${nMat} with a mat`].filter(Boolean);
  const pc = pn.length ? printPicks(printOptions(pn)).cheapest : null, fc = fn.length ? framePicks(frameOptions(fn, lookOf(), widthKey())).cheapest : null;
  const cost = (pc || !pn.length) && (fc || !fn.length) && (pn.length || fn.length) ? (pc ? pc.total : 0) + (fc ? fc.total : 0) : null;
  // The next steps, in order, so the page reads as a plan: the art, the frames, the nails.
  const shops = [...new Set(fresh.filter((p) => (byId.get(p.ref.id).offers || []).length).map((p) => byId.get(p.ref.id).source))];
  // The free tier (app site) gives the prices but not the names: those are the full plan.
  const lk = locked(), at = (x) => (lk ? ' at the cheapest' : ` at ${x.p.name}`);
  const art = [shop && `order ${shop === 1 ? 'the print' : `${shop} prints`} from ${lk ? (shop === 1 ? 'its shop' : 'their shops') : shops.join(' and ')}`, nPrint && `print ${nPrint === 1 ? (lk ? 'the photo' : 'the free photo') : `${nPrint} ${lk ? 'photos' : 'free photos'}`}${pc ? `, about ${usd(pc.total)}${at(pc)}` : ''}`].filter(Boolean).join(', and ');
  const frames = nFrame ? `${nFrame} frame${nFrame === 1 ? '' : 's'}${nMat ? `, ${nMat === nFrame ? 'each' : nMat} with a mat` : ''}${fc ? `, about ${usd(fc.total)}${at(fc)}` : ''}` : '';
  return `<div class="wall-sum"><p>${fresh.length} new piece${fresh.length === 1 ? '' : 's'}: ${parts.join(', ')}. Three steps:</p>
    <ol class="next-steps">
      <li><strong>Get the art.</strong> ${esc(art[0].toUpperCase() + art.slice(1))}.</li>
      ${frames ? `<li><strong>Get the frames.</strong> ${esc(frames[0].toUpperCase() + frames.slice(1))}. ${lk ? 'The full plan has every seller.' : 'The table below has every seller.'}</li>` : ''}
      <li><strong>Hang it.</strong> When everything arrives, Hang it at the bottom has the nail spots.</li>
    </ol>
    ${cost != null ? `<p class="pencil small">Printing and frames from about ${usd(cost)} at the cheapest, before codes${shop ? ', plus the shop prints' : ''}.</p>` : ''}</div>`;
}

// How a frame hangs. Frames usually come with: a sawtooth hanger at the top on small
// ones, a wire on mid sizes, two D-rings on big ones. A piece of yours already up hangs
// on whatever it has; a wire is assumed. What you set when the frames arrive wins.
const HANGER_WORDS = { sawtooth: 'Sawtooth hanger', wire: 'Wire', rings: 'Two D-rings' };
function hangerOf(p) {
  const d = S.draft;
  const set = (d.hangers || {})[p.ref.id];
  if (set) return { ...set, set: true };
  if (p.ref.source !== 'catalog' && typeof p.drop === 'number' && !p.nailNote) return { type: 'wire', drop: p.drop, measured: true, set: true };
  const long = Math.max(p.w, p.h);
  if (p.ref.source !== 'catalog') return { type: 'wire', drop: RULES.defaultDrop };
  if (long <= 16) return { type: 'sawtooth', drop: 0.5 };
  if (long <= 32) return { type: 'wire', drop: RULES.defaultDrop };
  return { type: 'rings', drop: 3, inset: RULES.ringInset };
}
// The last section: once the frames are here, say what each hangs on and where.
function hangerCheck(pieces, open = false) {
  if (!pieces.length) return '';
  const rows = pieces.map((p) => {
    const hg = p.hanger || hangerOf(p);
    const id = esc(p.ref.id), nm = esc(byId.get(p.ref.id) ? byId.get(p.ref.id).title : `Your ${p.title}`);
    return `<li class="hang-row"><span class="nail-name">${nm}</span>
      <span class="hang-fields"><label class="inline"><span class="sr-only">${nm} hangs on</span><select data-hang-type="${id}">${Object.entries(HANGER_WORDS).map(([k, v]) => `<option value="${k}"${hg.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="num"><span>${hg.type === 'rings' ? 'Rings below the top' : hg.type === 'wire' ? 'Wire, pulled up, below the top' : 'Below the top'}</span><span class="num-in"><input type="number" step="0.25" min="0" max="12" inputmode="decimal" data-hang-drop="${id}" value="${hg.drop}"> in</span></label>
      ${hg.type === 'rings' ? `<label class="num"><span>In from each side</span><span class="num-in"><input type="number" step="0.25" min="0" max="12" inputmode="decimal" data-hang-in="${id}" value="${hg.inset ?? RULES.ringInset}"> in</span></label>` : ''}</span></li>`;
  }).join('');
  return `<details class="hangers"${open || S.ui.hangOpen ? ' open' : ''}><summary>${open ? 'Check each frame' : 'When your frames arrive: check the hangers'}</summary>
    <p class="pencil small">Measure from each frame's hanger (wire pulled tight) to its top. The nail spots follow.</p>
    <ul class="hang-list">${rows}</ul></details>`;
}

// The wall being got and hung, its new pieces, and a thumbnail at each piece's own shape.
function chosenWall() {
  if (need()) { go(need()); return null; }
  const L = shown();
  if (!L) { go('#/layouts'); return null; }
  return L;
}
function thumbFor(p, box) {
  const d = S.draft, kept = keptSet();
  const own = p.ref.source !== 'catalog';
  const o = own ? d.owned.find((x) => x.id === p.ref.id) : null;
  const item = own ? null : byId.get(p.ref.id);
  const ar = p.w / p.h, h = ar < 1 ? box : box / ar, w = h * ar;
  const img = own ? (o && o.thumb) : item && item.imageData;
  const cls = own ? 'tn own' : `tn new framed${matFor(p) ? ' matted' : ''}${kept.has(p.ref.id) ? ' kept' : ''}`;
  const fc = own ? null : colorOf(p), fcs = fc && fc !== lookOf() ? `;--frame-new:${FRAME_LOOKS[fc].hex}` : '';
  return `<span class="${cls}" style="width:${w.toFixed(0)}px;height:${h.toFixed(0)}px${fcs}">${img ? `<img src="${img}" alt="">` : `<span class="swatch" style="background:${esc((o && o.color) || '#8A8F94')}"></span>`}</span>`;
}
const sz = (w, h) => `${w} x ${h} in`;
// Does a piece need a frame bought (a shop that sells it framed means no)?
function needsFrame(p) {
  const item = byId.get(p.ref.id);
  const o = item && item.offers && item.offers.length ? offersAt(item, ...shopPrint(p)).main : null;
  return !(o && o.framed);
}
// What's been ordered so far: art (or printed) and frames, by piece.
function orderState(L) {
  const d = S.draft, ord = d.orders || {};
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
  const framed = fresh.filter(needsFrame);
  const art = fresh.filter((p) => ord[`art:${p.ref.id}`]).length, fr = framed.filter((p) => ord[`frame:${p.ref.id}`]).length;
  return { fresh: fresh.length, art, frames: framed.length, fr, done: fresh.length > 0 && art === fresh.length && fr === framed.length };
}
// On the open wall, when it's the one you're getting: how far along it is.
function progressLine(L) {
  const d = S.draft;
  if (!d.chosen || !d.chosen.layout || d.chosen.layout.key !== L.key) return '';
  if (d.hung && d.hung.key === L.key) return '<p class="progress-line">This wall is up. <a href="#/hang">See it</a></p>';
  const o = orderState(L);
  if (!o.fresh) return '';
  if (!o.art && !o.fr) return '';
  return `<p class="progress-line">${o.done ? 'Everything is ordered.' : `Ordered ${o.art + o.fr} of ${o.fresh + o.frames}.`} <a href="${o.done ? '#/hang' : '#/get'}">${o.done ? 'Hang it' : 'Continue'}</a></p>`;
}

// ---------- Frame it: one look for the set, a mat or not, the sizes ----------

// A piece's own frame color: a dot per color it can come in, the one it has pressed.
function colorDots(p, title) {
  const can = needsFrame(p) ? Object.keys(FRAME_LOOKS) : shopColors(p);
  if (!can || can.length < 2) return '';
  const cur = colorOf(p);
  return `<span class="color-dots" role="group" aria-label="Frame color for ${esc(title)}">${can.map((k) => { const v = FRAME_LOOKS[k]; return `<button type="button" class="dot-btn" data-color-one="${esc(p.ref.id)}" data-c="${k}" aria-pressed="${cur === k}" aria-label="${v.name}" title="${v.name}"><span class="swatch-dot" style="background:${v.hex}${v.edge ? `;box-shadow:inset 0 0 0 1px ${v.edge}` : ''}"></span></button>`; }).join('')}</span>`;
}

function framesScreen() {
  const L = chosenWall();
  if (!L) return '';
  const wait = building();
  if (wait) return wait;
  const fresh = [...L.pieces.filter((p) => p.ref.source === 'catalog')].sort((a, b) => b.w * b.h - a.w * a.h);
  const look = lookOf(), mode = Object.keys(S.draft.matFor || {}).length ? 'mixed' : matLevel();
  const free = fresh.filter(canMat);
  // Pieces that get a frame from you (a print sold framed keeps its own).
  const framed = fresh.filter(needsFrame);
  const rows = fresh.map((p) => {
    const item = byId.get(p.ref.id);
    const ps = printOf(p);
    const fw = soldW(p), fh = soldH(p);
    const whole = p.frame && p.frame.can && p.frame.can.mat && !p.frame.can.plain && !(item.offers && item.offers.length);
    const mg = p.frame && p.frame.margin;
    const words = !needsFrame(p) ? (p.frame && p.frame.print ? `Comes framed with a white border, art ${sz(p.frame.print.w, p.frame.print.h)}, ${sz(p.w, p.h)} outside.` : `Comes framed, ${sz(p.w, p.h)}.`) : mg ? `Print ${sz(fw, fh)} with a ${mg} in white border printed on, so no mat. In ${aOrAn(fw)} ${sz(fw, fh)} frame, ${sz(p.w, p.h)} outside.` : ps ? `Print ${sz(ps[0], ps[1])} with a mat${whole ? ', so the photo keeps its shape' : ''}, in ${aOrAn(fw)} ${sz(fw, fh)} frame, ${sz(p.w, p.h)} outside.` : `Print ${sz(fw, fh)}, no mat, in ${aOrAn(fw)} ${sz(fw, fh)} frame, ${sz(p.w, p.h)} outside.`;
    const flip = canMat(p) ? `<button type="button" class="tick" data-mat-one="${esc(p.ref.id)}" aria-pressed="${matFor(p)}">Mat</button>` : '';
    const opts = sizesFor(p);
    const cur = p.frame ? `${p.frame.w}x${p.frame.h}${p.frame.print && item.offers && item.offers.length ? 'm' : ''}` : '';
    const size = opts.length > 1 ? `<label class="size-pick"><span class="sr-only">Size for ${esc(item.title)}</span><select data-resize="${esc(p.ref.id)}">${opts.map((z) => { const k = `${z.w}x${z.h}${z.matted ? 'm' : ''}`; return `<option value="${k}"${k === cur ? ' selected' : ''}>${z.w} x ${z.h}${z.matted ? `, matted ${z.matted.w} x ${z.matted.h}` : ''}</option>`; }).join('')}</select></label>` : '';
    const dots = colorDots(p, item.title);
    return `<li class="frame-row"><span class="buy-art">${thumbFor(p, 56)}</span><span class="buy-text"><span class="name">${esc(item.title)}</span><span class="frame-words">${words}</span>${flip || size || dots ? `<span class="row-ticks">${size}${flip}${dots}</span>` : ''}</span></li>`;
  }).join('');
  // Your own art that isn't framed yet gets a frame on this wall too.
  const yours = L.pieces.filter((p) => p.ref.source === 'owned').map((p) => [p, S.draft.owned.find((o) => o.id === p.ref.id)]).filter(([, o]) => o && o.needsFrame);
  const ownRows = yours.map(([p, o]) => { const f = o.needsFrame, dots = f.custom ? '' : colorDots(p, o.title); return `<li class="frame-row"><span class="buy-art"><span class="tn own"${o.thumb ? '' : ` style="background:${esc(o.color || '#8A8F94')}"`}>${o.thumb ? `<img src="${o.thumb}" alt="">` : ''}</span></span><span class="buy-text"><span class="name">Your ${esc(o.title)}</span><span class="frame-words">${f.custom ? `Needs a custom frame for ${sz(f.w, f.h)}.` : f.print && (f.print.w !== f.w || f.print.h !== f.h) ? `${sz(f.print.w, f.print.h)}, with a mat, in ${aOrAn(f.w)} ${sz(f.w, f.h)} frame.` : `In ${aOrAn(f.w)} ${sz(f.w, f.h)} frame, no mat.`}</span>${dots ? `<span class="row-ticks">${dots}</span>` : ''}</span></li>`; }).join('');
  return `${bar(back('#/wall', 'This wall'))}
  <main class="page frames">
    <h1>Frame it</h1>
    <p class="lede">One color for the set. Tap a dot on a piece to change just that one.</p>
    <div class="drawing" id="frames-wall">${drawWall(L, pxNow(), { still: true, label: 'Your wall with the frames you picked' })}</div>
    <fieldset class="choose"><legend>Frame</legend>
      <span class="seg" role="group" aria-label="Frame">${Object.entries(FRAME_LOOKS).map(([k, v]) => `<button type="button" class="seg-btn" data-look="${k}" aria-pressed="${look === k}"><span class="swatch-dot" style="background:${v.hex}${v.edge ? `;box-shadow:inset 0 0 0 1px ${v.edge}` : ''}"></span>${v.name}</button>`).join('')}</span>
    </fieldset>
    ${framed.length ? '' : '<p class="pencil small">Every piece here comes framed, so width and mats are already set.</p>'}
    ${framed.length ? `<fieldset class="choose"><legend>Frame width</legend>
      <span class="seg" role="group" aria-label="Frame width">${Object.entries(FRAME_WIDTHS).map(([k, v]) => `<button type="button" class="seg-btn" data-fwidth="${k}" aria-pressed="${widthKey() === k}">${v.name}</button>`).join('')}</span>
      <span class="help">The moulding, ${esc(widthOf().words)}. ${widthKey() === 'wide' ? 'Wide frames are easy in 8 x 10, 12 x 16, 16 x 20 and 20 x 28 (IKEA EDSBRUK); other sizes are made to order.' : 'Most ready-made frames are slim or standard.'}</span>
    </fieldset>` : ''}
    ${framed.length ? `<fieldset class="choose"><legend>How many mats</legend>
      <span class="seg" role="group" aria-label="Mats">${MAT_LEVELS.map(([k, v]) => `<button type="button" class="seg-btn" data-mat="${k}" aria-pressed="${mode === k}">${v}</button>`).join('')}</span>
      <span class="help">The white card around the print. It comes in the frame. ${free.length ? 'Tap Mat on a piece to change one.' : 'These sizes each come one way, so the mats are set by size.'}</span>
    </fieldset>` : ''}
    ${fresh.some((p) => matFor(p) && !(byId.get(p.ref.id).offers || []).length) ? `<fieldset class="choose"><legend>Mat width</legend>
      <span class="seg" role="group" aria-label="Mat width">${[['standard', 'Standard'], ['wide', 'Wide']].map(([k, v]) => `<button type="button" class="seg-btn" data-mwidth="${k}" aria-pressed="${(matWide() ? 'wide' : 'standard') === k}">${v}</button>`).join('')}</span>
      <span class="help">${matWide() ? 'More white. Needs a precut mat, about $10 to $15.' : 'The one in the frame, about 2 in.'}</span>
    </fieldset>` : ''}
    <h2>Sizes</h2>
    ${S.undo ? `<p class="sheet-status" role="status">${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button></p>` : ''}
    ${flashHtml()}
    <ul class="frame-list">${rows}${ownRows}</ul>
    <div class="dock"><button type="button" class="btn wide" data-act="to-get">Get it</button></div>
  </main>`;
}

// ---------- Get it: a checklist of what to order, then where ----------

function getScreen() {
  const L = chosenWall();
  if (!L) return '';
  const wait = building();
  if (wait) return wait;
  const d = S.draft, ord = d.orders || {};
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
  if (!fresh.length) { go('#/hang'); return ''; }
  // Frames in more than one color: each row says its color.
  const mixedC = new Set(fresh.filter((p) => needsFrame(p) || shopColors(p)).map(colorOf)).size > 1;
  const tick = (key, label) => `<button type="button" class="tick" data-order="${esc(key)}" aria-pressed="${!!ord[key]}">${label}</button>`;
  const buy = [...fresh].sort((a, b) => b.w * b.h - a.w * a.h).map((p) => {
    const item = byId.get(p.ref.id);
    const shop = item.offers && item.offers.length ? offersAt(item, ...shopPrint(p)) : null;
    const o = shop && shop.main;
    let credit, frame, get;
    if (o) {
      credit = `Art by ${esc(item.artist)}, sold by ${esc(item.source)}`;
      // The print said the same way up as the frame it goes in.
      const fw = soldW(p), fh = soldH(p);
      const ow = o.w || fw, oh = o.h || fh, land = fw > fh;
      const pw = land ? Math.max(ow, oh) : Math.min(ow, oh), ph = land ? Math.min(ow, oh) : Math.max(ow, oh), same = Math.min(pw, ph) === Math.min(fw, fh) && Math.max(pw, ph) === Math.max(fw, fh);
      const mg = p.frame && p.frame.margin;
      frame = o.framed ? (o.mount ? `Comes framed with a white border, art ${sz(o.mount.w, o.mount.h)}, ${sz(p.w, p.h)} outside.` : `Comes framed, ${sz(p.w, p.h)} outside.`) : mg && same ? `Print ${sz(pw, ph)}, with a ${mg} in white border printed on (art up to ${sz(pw - 2 * mg, ph - 2 * mg)}). Frame ${sz(fw, fh)}, no mat needed, ${sz(p.w, p.h)} outside.` : same ? `Print ${sz(pw, ph)}. Frame ${sz(fw, fh)}, no mat, ${sz(p.w, p.h)} outside.` : `Print ${sz(pw, ph)}. Mat with a ${sz(pw - 2 * MAT_LIP, ph - 2 * MAT_LIP)} window. Frame ${sz(fw, fh)}, ${sz(p.w, p.h)} outside.`;
      get = `<a class="btn quiet small" href="${esc(colorUrl(o, colorOf(p)))}" target="_blank" rel="noopener">Buy at ${esc(item.source)}</a>`;
    } else {
      const fw = soldW(p), fh = soldH(p), ps = matFor(p) ? printSize(fw, fh) : null;
      credit = `Photo by ${esc(item.artist)} on ${esc(item.source)}, free under the ${esc(item.record.source.license)}`;
      frame = ps ? `Print it ${sz(ps[0], ps[1])}. Mat with a ${sz(ps[0] - 2 * MAT_LIP, ps[1] - 2 * MAT_LIP)} window. Frame ${sz(fw, fh)}, ${sz(p.w, p.h)} outside.` : `Print it ${sz(fw, fh)}. Frame ${sz(fw, fh)}, no mat, ${sz(p.w, p.h)} outside.`;
      get = `<a class="btn quiet small" href="${esc(item.url)}" target="_blank" rel="noopener">Get it on ${esc(item.source)}</a>`;
    }
    if (mixedC && (needsFrame(p) || shopColors(p))) frame += ` ${FRAME_LOOKS[colorOf(p)].name} frame.`;
    // The free tier: what to get and its price, not where; the full plan has that.
    if (locked()) { credit = o && o.price != null ? `${money(o.price, o.currency)} at its shop` : o ? 'From its shop' : 'A photo you print'; get = ''; }
    const ticks = `${tick(`art:${p.ref.id}`, o ? 'Ordered' : 'Printed')}${needsFrame(p) ? tick(`frame:${p.ref.id}`, 'Frame ordered') : ''}`;
    return `<li class="buy-row"><span class="buy-art">${thumbFor(p, 72)}</span><span class="buy-text"><span class="name">${esc(item.title)}</span>
      <span class="frame-words">${frame}</span><span class="meta">${credit}</span></span>
      <span class="row-acts">${get}</span><span class="row-ticks">${ticks}</span></li>`;
  }).join('');
  const st = orderState(L);
  return `${bar(back('#/frames', 'Frame it'), '<button type="button" class="btn quiet small" data-act="print">Print</button>')}
  <main class="page get">
    <h1>Get it</h1>
    ${flashHtml()}
    <section aria-labelledby="buy-h"><h2 id="buy-h" class="sr-only">What to get</h2>
      ${wallSummary(L)}
      ${locked() ? planBlock('get') : ''}
      <p class="order-state" role="status">${st.done ? 'Everything is ordered.' : `Ordered so far: ${st.art} of ${st.fresh} ${st.fresh === 1 ? 'piece' : 'pieces'}${st.frames ? `, ${st.fr} of ${st.frames} frame${st.frames === 1 ? '' : 's'}` : ''}. Tick each one as you go.`}</p>
      <ul class="buy-list">${buy}</ul>
      ${fresh.some((p) => (byId.get(p.ref.id).offers || []).length) ? '<p class="pencil small">Shops sell and ship their own prints.</p>' : ''}
    </section>
    ${locked() ? '' : `${whereToPrint(L)}
    ${whereToFrame(L)}
    ${copyBlock(L)}`}
    <section class="next-up" aria-labelledby="next-h">
      <h2 id="next-h">When it all arrives</h2>
      <p>The nail spots for every frame, and a check of what each one hangs on.</p>
      <div class="acts left"><a class="btn${st.done && !locked() ? '' : ' quiet'}" href="#/hang">Hang it</a>
      <button type="button" class="btn quiet" data-act="save"${savedNow(L) ? ' aria-pressed="true" disabled' : ''}>${savedNow(L) ? 'Saved' : 'Save'}</button></div>
    </section>
  </main>`;
}

// ---------- Hang it: hangers first, then the nails, then it's up ----------

function hangScreen() {
  const L = chosenWall();
  if (!L) return '';
  const wait = building();
  if (wait) return wait;
  const d = S.draft;
  const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
  const q4 = (v) => Math.round(v * 4) / 4;
  const hang = (p) => {
    if (p.role === 'pinned') return p;
    const hg = hangerOf(p);
    if (hg.measured) return p; // a drop you measured on your own piece: the engine's nail
    const y = q4(p.y + p.h - hg.drop);
    if (hg.type === 'rings' && p.w > 2 * hg.inset + 2) return { ...p, hanger: hg, nail: { x: p.nail.x, y }, nails: [{ x: q4(p.x + hg.inset), y }, { x: q4(p.x + p.w - hg.inset), y }] };
    return { ...p, hanger: hg, nail: { x: p.nail.x, y } };
  };
  const LG = { ...L, pieces: L.pieces.map(hang) };
  const hangOrder = [...LG.pieces].filter((p) => p.role !== 'pinned').sort((a, b) => b.w * b.h - a.w * a.h);
  const refs = new Map(hangOrder.map((p) => [p.ref.id, p.nails ? nailRef(p.nails[0], trueObs(d)) : nailRef(p.nail, trueObs(d))]));
  const anyRef = [...refs.values()].some(Boolean);
  const estimate = !sizeMeasured(d);
  const nameOf = (p) => (byId.get(p.ref.id) ? byId.get(p.ref.id).title : `Your ${p.title}`);
  const kept = keptSet();
  const hung = d.hung && d.hung.key === L.key ? d.hung : null;
  const fix = d.photo && d.photo.mode === 'auto' ? '#/check' : '#/size';
  return `${bar(back(fresh.length ? '#/get' : '#/wall', fresh.length ? 'Get it' : 'This wall'), '<button type="button" class="btn quiet small" data-act="print">Print</button>')}
  <main class="page get hang">
    <h1>Hang it</h1>
    ${flashHtml()}
    <section aria-labelledby="hangers-h"><h2 id="hangers-h">1. What each frame hangs on</h2>
      ${hangerCheck(hangOrder, true)}
    </section>
    <section class="guide" id="guide" aria-labelledby="guide-h">
      <h2 id="guide-h">2. Where the nails go</h2>
      ${estimate ? `<p class="note">These spots are estimates. The wall's size was worked out from ${esc(sizeSource(d))} in your photo, not measured, so a spot can be off by several inches. <a href="${fix}">Measure the wall's width once</a> and every spot firms up.</p>` : d.photo ? '<p class="pencil small">The wall\'s width is your measurement. Heights and furniture are read from the photo, so check one spot before drilling.</p>' : ''}
      <div class="drawing">${wallSvg({ wall: { width: d.width, height: d.height }, obstacles: trueObs(d), layout: LG, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: ownedInfo, keptIds: kept, measure: true, still: true, pxWide: pxNow(), label: `${d.name}, hanging guide` })}</div>
      <div class="table-scroll"><table class="nails"><thead><tr><th scope="col">Piece</th><th scope="col">From the left</th><th scope="col">Up from the floor</th></tr></thead>
        <tbody>${hangOrder.map((p) => `<tr><td><span class="nail-pc">${thumbFor(p, 40)}<span><span class="nail-name">${esc(nameOf(p))}</span><span class="nail-ref">${p.frame && p.frame.border ? `${esc(sz(soldW(p), soldH(p)))} frame, ${esc(sz(p.w, p.h))} outside` : `${esc(sz(p.w, p.h))} frame`}</span>${p.hanger ? `<span class="nail-ref">${esc(HANGER_WORDS[p.hanger.type])}${p.hanger.set ? '' : ', assumed'}</span>` : ''}</span></span>${p.ref.source !== 'catalog' && /^Moves/.test(moveNote(p)) ? '<span class="nail-ref">Take it down and rehang it here.</span>' : ''}${refs.get(p.ref.id) ? `<span class="nail-ref">Or ${p.nails ? 'the left nail ' : ''}${esc(refs.get(p.ref.id))}</span>` : ''}</td><td>${p.nails ? `<span class="nail-two">${esc(inches(p.nails[0].x))}</span><span class="nail-two">and ${esc(inches(p.nails[1].x))}</span>` : esc(inches(p.nail.x))}</td><td>${esc(inches(p.nail.y))}</td></tr>`).join('')}</tbody></table></div>
      <ol class="steps">
        ${d.photo ? `<li>Before the first hole, check one spot: mark where the biggest frame's nail goes and see that it sits where the drawing shows it next to ${furnitureWord(d)}. If it's off, <a href="${fix}">fix the wall's width</a> and every spot moves with it.</li>` : ''}
        ${hangOrder.some((p) => p.ref.source === 'catalog' && matFor(p) && needsFrame(p)) ? '<li>Matted frames: tape each print to the back of its mat along the top edge only, so it hangs flat and doesn\'t buckle.</li>' : ''}
        <li>Hang the biggest piece first; the others measure off it.</li>
        <li>Mark each nail in pencil, then nail or drill.</li>
        ${hangOrder.some((p) => p.nails) ? '<li>Two nails for a frame on D-rings: put a level across the two marks before you drill, so it hangs straight.</li>' : ''}
        ${anyRef ? `<li>Measuring from the nearest edge, like the TV's, keeps any error small${estimate ? ', which helps while the wall size is an estimate' : ''}.</li>` : ''}
        <li>A photo can't see wires or studs. Near an outlet or switch, check with a stud finder before you drill.</li>
      </ol>
    </section>
    <section class="done" aria-labelledby="done-h">
      <h2 id="done-h">${hung ? "It's up" : '3. Done?'}</h2>
      ${hung ? `${hung.photo ? `<img class="hung-photo" src="${hung.photo}" alt="Your wall, hung">` : ''}
        <p>Nice. When you want a change, open this wall and swap a piece; the frames and nails stay.</p>
        <div class="acts left">
          <label class="btn quiet file-btn">${hung.photo ? 'New photo of it' : 'Add a photo of it'}<input type="file" accept="image/*" id="hung-photo"></label>
          <button type="button" class="btn quiet" data-act="save"${savedNow(L) ? ' aria-pressed="true" disabled' : ''}>${savedNow(L) ? 'Saved' : 'Save'}</button>
          <button type="button" class="link" data-act="unhung">Not up yet</button>
        </div>`
    : `<p>When every piece is up, mark it hung.</p><div class="acts left"><button type="button" class="btn" data-act="hung">It's up</button></div>`}
    </section>
  </main>`;
}

// ---------- Your walls ----------

function savedSvg(w, pxWide) {
  return wallSvg({ wall: { width: w.width, height: w.height }, obstacles: w.obstacles, photo: w.photo && (w.photo.clean || w.photo.flat), tone: w.photo && w.photo.tone, layout: w.chosen && w.chosen.layout, imageFor: (p) => byId.get(p.ref.id)?.imageData, ownedFor: (id) => { const o = w.owned.find((x) => x.id === id); return o ? { thumb: o.thumb, color: o.color, art: !!o.art } : null; }, hideObstacles: !!(w.photo && w.photo.flat), pxWide, still: true, label: w.name });
}
// Your walls: every saved wall, two across. Tap one for it; Compare puts two together.
function walls() {
  const all = store.listWalls();
  const picking = S.ui.picking || null;
  const back = S.draft && S.draft.width ? ['#/wall', 'Your wall'] : ['#/', 'Walldrobe'];
  const right = all.length >= 2 ? (picking ? '<button type="button" class="btn quiet small" data-act="compare-cancel">Cancel</button>' : '<button type="button" class="btn quiet small" data-act="compare">Compare</button>') : '';
  const card = (w) => {
    const on = picking && picking.includes(w.id);
    return `<li><button type="button" class="wall-card${on ? ' is-on' : ''}" ${picking ? `data-pickwall="${esc(w.id)}" aria-pressed="${!!on}"` : `data-wallcard="${esc(w.id)}"`} aria-label="${esc(w.name)}">
      <span class="drawing small-drawing">${savedSvg(w, 180)}</span><span class="wall-name">${esc(w.name)}</span></button></li>`;
  };
  return `${bar(`<a class="back" href="${back[0]}"><span aria-hidden="true">‹</span> ${esc(back[1])}</a>`, `${right}<a class="btn quiet small" href="#/new">New wall</a>`)}
  <main class="page walls-page">
    <h1>Your walls</h1>
    ${picking ? `<p class="pencil">${picking.length ? 'Pick one more.' : 'Pick two to compare.'}</p>` : ''}
    ${flashHtml()}
    ${all.length ? `<ul class="wall-grid">${all.map(card).join('')}</ul>` : '<p class="pencil">Saved walls land here.</p>'}
  </main>${sheetHtml()}`;
}
// Favorites: every print you hearted, from any wall. See it on my wall keeps it in every wall.
function savedScreen() {
  const d = S.draft;
  const ids = (d && d.saved && d.saved.length ? d.saved : store.loadMe().saved).filter((id) => byId.get(id));
  const no = [...notForMe()].filter((id) => byId.get(id));
  const hasWall = !!(d && d.width);
  const kept = d ? keptSet() : new Set();
  const tile = (id) => {
    const it = byId.get(id);
    const ar = it.aspect || 0.8, h = ar < 1 ? 150 : 128 / ar;
    const shop = it.offers && it.offers.length ? it.offers[0] : null;
    return `<li class="piece">
      <span class="piece-art"><span class="tn new${kept.has(id) ? ' kept' : ''}" style="width:${(h * ar).toFixed(0)}px;height:${h.toFixed(0)}px"><img src="${it.imageData}" alt="${esc(it.title)}"></span></span>
      <span class="piece-name">${esc(it.title)}</span>
      <span class="fav-acts">${hasWall ? (kept.has(id) ? '<span class="piece-kept">On your wall</span>' : `<button type="button" class="link" data-onwall="${esc(id)}">See it on my wall</button>`) : ''}
      ${locked() ? '<button type="button" class="link" data-act="unlock" data-from="favorites">Where to get it</button>' : shop && shop.url ? `<a class="link" href="${esc(shop.url)}" target="_blank" rel="noopener">${esc(it.source)}</a>` : it.url ? `<a class="link" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.source)}</a>` : ''}</span>
      <button type="button" class="heart" data-save="${esc(id)}" data-unfav="1" aria-label="Take ${esc(it.title)} out of favorites">${heart(true)}</button>
    </li>`;
  };
  return `${bar(back(hasWall ? '#/wall' : '#/', hasWall ? 'Your wall' : 'Walldrobe'))}
  <main class="page saved-page">
    <h1>Favorites</h1>
    ${flashHtml()}
    ${S.undo ? `<p class="undo">${esc(S.undo.label)} <button type="button" class="link" data-act="undo">Undo</button></p>` : ''}
    ${ids.length ? `<ul class="pieces">${ids.map(tile).join('')}</ul>` : '<p class="pencil">Tap the heart on any print and it lands here.</p>'}
    <p><a href="#/browse">Browse all the art</a></p>
    ${no.length ? `<details class="not-for-me"><summary>Not for me, ${no.length}</summary>
      <ul class="no-list">${no.map((id) => { const it = byId.get(id); const ar = it.aspect || 0.8, h = ar < 1 ? 56 : 56 / ar; return `<li><span class="tn new" style="width:${(h * ar).toFixed(0)}px;height:${h.toFixed(0)}px"><img src="${it.imageData}" alt=""></span><span class="no-name">${esc(it.title)}</span><button type="button" class="link" data-act="show-again" data-id="${esc(id)}">Show it again</button></li>`; }).join('')}</ul>
    </details>` : ''}
  </main>`;
}
// One saved wall, one level down: open it, rename it, delete it.
function wallSheet(id) {
  const w = store.getWall(id);
  if (!w) return '';
  const date = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };
  return `<h2 id="sheet-h" class="sr-only">${esc(w.name)}</h2>
    <div class="drawing">${savedSvg(w, 360)}</div>
    <label class="name-in"><span class="sr-only">Name</span><input type="text" maxlength="40" value="${esc(w.name)}" data-rename="${esc(w.id)}"></label>
    <p class="meta">Saved ${esc(date(w.savedAt))}.</p>
    ${S.ui.confirmDelete === w.id ? `<p class="error">Delete this wall? This can't be undone.</p>
      <div class="acts left"><button type="button" class="btn danger" data-delete="${esc(w.id)}">Delete</button><button type="button" class="btn quiet" data-act="cancel-delete">Keep it</button></div>`
    : `<div class="acts left"><button type="button" class="btn" data-open="${esc(w.id)}">Open</button><button type="button" class="btn quiet" data-ask-delete="${esc(w.id)}">Delete</button></div>`}
    ${APP ? shareBlock(w) : ''}`;
}
// Share a saved wall to your profile and the feed, or take it off. The room photo never goes up;
// the flattened wall photo only with the box ticked.
function shareBlock(w) {
  if (!signedIn()) return '<p class="pencil small"><a href="#/signin">Sign in</a> to keep this wall on every device and share it.</p>';
  const r = (A.mine || []).find((x) => x.client_id === w.id);
  const hasPhoto = !!(w.photo && (w.photo.clean || w.photo.flat));
  if (r && r.is_public) return `<p class="pencil small">Shared on your profile${r.show_photo ? ', with the wall photo' : ''}. <a href="#/w/${esc(r.id)}">See it</a></p>
    <div class="acts left"><button type="button" class="btn quiet small" data-unshare-wall="${esc(w.id)}"${S.ui.sharing ? ' disabled' : ''}>Take it off your profile</button></div>`;
  return `<form class="fields share-form" data-share-wall="${esc(w.id)}">
    <label class="name-in"><span>A line about it, if you like</span><input type="text" name="note" maxlength="240" placeholder="Why this one?"></label>
    ${hasPhoto ? '<label class="check"><input type="checkbox" name="photo"> <span>Show my wall photo</span></label>' : ''}
    ${A.err ? `<p class="error" role="alert">${esc(A.err)}</p>` : ''}
    <div class="acts left"><button class="btn" type="submit"${S.ui.sharing ? ' disabled' : ''}>${S.ui.sharing ? 'Sharing…' : 'Share to your profile'}</button></div>
  </form>`;
}
// Two saved walls, one above the other, each with what only it has.
function compare() {
  const [, a, b] = route();
  const A = store.getWall(a), B = store.getWall(b);
  if (!A || !B) { go('#/walls'); return ''; }
  const ids = (w) => new Set(((w.chosen && w.chosen.layout.pieces) || []).map((p) => p.ref.id));
  const ia = ids(A), ib = ids(B);
  const only = (w, mine, other) => ((w.chosen && w.chosen.layout.pieces) || []).filter((p) => p.ref.source === 'catalog' && mine.has(p.ref.id) && !other.has(p.ref.id));
  const strip = (ps) => (ps.length ? `<span class="only-strip" aria-label="Only in this one">${ps.map((p) => { const it = byId.get(p.ref.id); const ar = p.w / p.h, h = ar < 1 ? 44 : 44 / ar; return it ? `<span class="tn new" style="width:${(h * ar).toFixed(0)}px;height:${h.toFixed(0)}px"><img src="${it.imageData}" alt="${esc(it.title)}"></span>` : ''; }).join('')}</span>` : '<span class="pencil small">Nothing the other doesn\'t have.</span>');
  const side = (w, ps) => `<section class="cmp" aria-label="${esc(w.name)}">
    <div class="drawing">${savedSvg(w, pxNow())}</div>
    <div class="cmp-row"><span class="wall-name">${esc(w.name)}</span><button type="button" class="btn quiet small" data-open="${esc(w.id)}">Open</button></div>
    ${strip(ps)}
  </section>`;
  return `${bar(back('#/walls', 'Your walls'))}
  <main class="page compare-page">
    ${side(A, only(A, ia, ib))}
    ${side(B, only(B, ib, ia))}
  </main>`;
}

// ---------- Render ----------

function focusSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const keys = ['style', 'art', 'count', 'step', 'choice', 'for', 'onwall', 'nudge', 'pin', 'wall', 'isArt', 'isTv', 'fullness', 'just', 'save', 'piece', 'goto', 'fix', 'obk', 'obid', 'ok', 'oid', 'keep', 'act', 'id', 'which', 'corner', 'add', 'pick', 'open', 'rename'];
  const parts = keys.filter((k) => el.dataset && el.dataset[k] !== undefined).map((k) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(el.dataset[k])}"]`);
  return parts.length ? `${el.tagName.toLowerCase()}${parts.join('')}` : null;
}

// ---------- Accounts and the feed (the app site only: tools/build_site.mjs --app) ----------
// On the free site WD_ACCOUNT isn't there and none of this shows.
const ACCT = globalThis.WD_ACCOUNT || null;
const APP = !!ACCT;
const A = { me: null, started: false, signing: false, err: null, saves: new Set(), counts: new Map(), cache: new Map(), mine: null,
  feed: { scope: 'all', posts: [], status: 'idle', more: false, at: 0, err: null }, plan: { status: 'idle', err: null } };

// ---------- The full plan (the app site only) ----------
// The app's free tier plans the wall: every wall, the art, swaps, frames, the nails. It
// doesn't say where a piece comes from or where to print and frame it; that's the full
// plan, which a person pays for. Until paying opens (web/app.config.js), Unlock is a fake
// door: it says what's in the plan and records who asked. The build leaves the sources
// out of the app's page too (tools/build_site.mjs). The free site shows everything.
const PLAN = (ACCT && ACCT.plan) || { open: false, price: '' };
function locked() { return APP && !PLAN.open; }
const PLAN_HAS = ['Where each piece is from, with a link to it at the size on your wall', 'Every place to print and frame it, cheapest first, for your sizes', 'One list to paste into your AI for today\'s codes'];
function planBlock(from) {
  return `<section class="plan-lock" aria-labelledby="plan-${from}-h">
    <h2 id="plan-${from}-h">The full plan</h2>
    <ul class="plan-has">${PLAN_HAS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="acts left"><button type="button" class="btn" data-act="unlock" data-from="${esc(from)}">Unlock the full plan</button>${PLAN.price ? `<span class="pencil">${esc(PLAN.price)}</span>` : ''}</div>
  </section>`;
}
function planScreen() {
  const backTo = S.ui.planBack || '#/';
  const P = A.plan;
  // Signed in: whether you asked already, once per visit.
  if (signedIn() && P.status === 'idle') {
    A.plan = { status: 'checking', err: null };
    ACCT.askedPlan().then((y) => { if (A.plan.status === 'checking') A.plan = { status: y ? 'on' : 'ready', err: null }; }).catch(() => { if (A.plan.status === 'checking') A.plan = { status: 'ready', err: null }; }).finally(render);
  }
  const done = P.status === 'on';
  const act = !signedIn()
    ? '<div class="acts left"><button type="button" class="btn" data-act="plan-signin">Sign in to unlock</button></div><p class="pencil small">Your plan goes with your account, so it\'s on every device.</p>'
    : done ? `<p class="plan-done note" tabindex="-1">You're on the list. Paying isn't open yet; we'll write to ${esc(A.me.email || 'you')} when it is. Your walls stay free to plan.</p>`
      : `<div class="acts left"><button type="button" class="btn" data-act="plan-yes"${P.status === 'saving' || P.status === 'checking' ? ' disabled' : ''}>${P.status === 'saving' ? 'Unlocking…' : 'Unlock the full plan'}</button></div>
        ${P.status === 'error' ? `<p class="error" role="alert" tabindex="-1">Couldn't do that: ${esc(P.err)}. Try again.</p>` : ''}`;
  return `${bar(back(backTo, 'Back'))}
  <main class="page plan-page">
    <h1>The full plan</h1>
    <p class="lede">Planning the wall is free. The full plan is how you get it:</p>
    <ul class="plan-has">${PLAN_HAS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${PLAN.price ? `<p class="price-line">${esc(PLAN.price)}</p>` : ''}
    ${act}
  </main>`;
}
function acctStart() {
  if (!APP || A.started) return;
  A.started = true;
  if (!ACCT.ready()) return;
  ACCT.start((me) => { A.me = me; A.mine = null; A.plan = { status: 'idle', err: null }; if (me) loadSaves(); render(); })
    .then((me) => { A.me = me; if (me) { loadSaves(); const after = ACCT.afterSignIn(); if (after) { history.replaceState(null, '', `${location.pathname}${after}`); } } render(); })
    .catch((e) => console.warn('account', e));
}
const signedIn = () => !!(APP && A.me && A.me.profile);
function loadSaves() { if (!signedIn()) return; ACCT.mySaves().then((s) => { A.saves = s; render(); }).catch(() => {}); }
// A shared wall from the database, drawn like a saved wall.
function postWall(row) {
  const b = row.body || {};
  return { width: b.width, height: b.height, obstacles: b.obstacles || [], photo: row.photo ? { clean: row.photo, flat: row.photo } : null, chosen: { layout: b.layout }, owned: b.owned || [], name: row.name || row.room || 'A wall' };
}
// A saved wall as it goes up: its size, what's in the way, the layout and your pieces as
// sizes and small thumbnails. Never the room photo.
function wallBody(w) {
  const L = w.chosen && w.chosen.layout;
  const on = new Set(L ? L.pieces.map((p) => p.ref.id) : []);
  return { v: 1, width: w.width, height: w.height, obstacles: (w.obstacles || []).map(({ id, kind, x, y, w: ow, h, label }) => ({ id, kind, x, y, w: ow, h, label })),
    layout: L || null, owned: (w.owned || []).filter((o) => on.has(o.id)).map((o) => ({ id: o.id, title: o.title, w: o.w, h: o.h, color: o.color || null, art: !!o.art, thumb: o.thumb && o.thumb.length < 40000 ? o.thumb : null })),
    look: w.look || null, colorFor: w.colorFor || null, mat: w.mat || null };
}
// The flattened wall photo, smaller, same shape (never stretched): only when its owner shows it.
function smallPhoto(url, maxW = 900, q = 0.72) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, maxW / im.naturalWidth), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      const out = cv.toDataURL('image/jpeg', q);
      resolve(out.length < 580000 ? out : null);
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
}
// Your saved wall to your account: private unless you share it.
async function pushWall(w, { isPublic, showPhoto, note } = {}) {
  if (!signedIn() || !w) return null;
  const prev = (A.mine || []).find((r) => r.client_id === w.id);
  const pub = isPublic != null ? isPublic : !!(prev && prev.is_public);
  const show = showPhoto != null ? showPhoto : !!(prev && prev.show_photo);
  const photo = show ? await smallPhoto(w.photo && (w.photo.clean || w.photo.flat)) : null;
  const row = await ACCT.putWall({ clientId: w.id, name: w.name, room: w.base || '', note: note != null ? note : (prev && prev.note) || '', body: wallBody(w), photo, isPublic: pub, showPhoto: show && !!photo });
  A.mine = [row, ...(A.mine || []).filter((r) => r.id !== row.id)];
  A.feed.at = 0;
  return row;
}
function loadMine() {
  if (!signedIn() || A.mine) return;
  A.mine = [];
  ACCT.myWalls().then((rows) => { A.mine = rows; render(); }).catch((e) => { A.mine = null; A.err = e.message; render(); });
}
function loadFeed(more) {
  const F = A.feed;
  if (F.status === 'loading' || !APP || !ACCT.ready()) return;
  F.status = 'loading'; F.err = null;
  const before = more && F.posts.length ? F.posts[F.posts.length - 1].shared_at : null;
  ACCT.feed({ following: F.scope === 'following', before })
    .then(async (rows) => {
      F.posts = more ? [...F.posts, ...rows.filter((r) => !F.posts.some((x) => x.id === r.id))] : rows;
      F.more = rows.length === ACCT.PAGE; F.status = 'ok'; F.at = Date.now();
      try { const c = await ACCT.saveCounts(rows.map((r) => r.id)); for (const [k, v] of c) A.counts.set(k, v); } catch { /* counts are extra */ }
    })
    .catch((e) => { F.status = 'error'; F.err = e.message; F.at = Date.now(); })
    .finally(() => render());
}
const who = (row) => (row.profiles ? row.profiles : null);
const avatar = (p, size = 32) => (p && p.avatar_url ? `<img class="avatar" src="${esc(p.avatar_url)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">` : `<span class="avatar is-letter" style="width:${size}px;height:${size}px" aria-hidden="true">${esc(((p && (p.name || p.handle)) || '?').slice(0, 1).toUpperCase())}</span>`);
// One shared wall: who, the wall, its pieces, Save and Try these on my wall.
function postCard(row, opts = {}) {
  const p = who(row) || (opts.profile || null);
  const w = postWall(row), L = w.chosen.layout;
  const fresh = L ? L.pieces.filter((x) => x.ref.source === 'catalog' && byId.get(x.ref.id)) : [];
  const saved = A.saves.has(row.id), n = A.counts.get(row.id) || 0, mine = A.me && row.owner === A.me.id;
  const date = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } };
  return `<li class="post" id="post-${esc(row.id)}">
    <p class="post-head">${p ? `<a class="post-who" href="#/u/${esc(p.handle)}">${avatar(p, 28)}<span>${esc(p.name || p.handle)}</span></a>` : ''} <span class="pencil">${esc(row.room || '')}${row.shared_at ? `${row.room ? ', ' : ''}${esc(date(row.shared_at))}` : ''}</span></p>
    ${row.note ? `<p class="post-note">${esc(row.note)}</p>` : ''}
    <a class="drawing" href="#/w/${esc(row.id)}" aria-label="Open this wall">${L ? savedSvg(w, opts.px || pxNow()) : ''}</a>
    <div class="acts left post-acts">
      ${mine ? '' : `<button type="button" class="btn quiet small" data-wsave="${esc(row.id)}" aria-pressed="${saved}">${saved ? 'Saved' : 'Save'}${n ? ` · ${n}` : ''}</button>`}
      ${fresh.length ? `<button type="button" class="btn quiet small" data-try-wall="${esc(row.id)}">Try these on my wall</button>` : ''}
      ${mine ? `<span class="pencil small">Yours${n ? `, saved by ${n}` : ''}</span>` : `<button type="button" class="link small" data-report-wall="${esc(row.id)}">Report</button>`}
    </div>
  </li>`;
}
function signInScreen() {
  const ready = ACCT.ready();
  if (signedIn()) { go('#/me'); return ''; }
  return `${bar(back('#/', 'Walldrobe'))}
  <main class="page signin">
    <h1>Sign in</h1>
    <p class="lede">Keep your walls on every device, share the ones you hang, and follow people whose walls you like.</p>
    ${ready ? `<div class="acts left"><button type="button" class="btn wide" data-act="signin-google"${A.signing ? ' disabled' : ''}>${A.signing ? 'Opening Google…' : 'Continue with Google'}</button></div>
      ${ACCT.emailReady() ? `<form class="fields" id="email-form"><label class="name-in"><span>Or get a link by email</span><input type="email" name="email" required autocomplete="email" inputmode="email"></label><button type="submit" class="btn quiet">Email me a link</button></form>` : ''}
      ${S.ui.emailSent ? `<p class="note">Check ${esc(S.ui.emailSent)} for the link.</p>` : ''}
      ${A.err ? `<p class="error" role="alert">${esc(A.err)}</p>` : ''}`
    : '<p class="note">Sign-in is coming soon. Your walls still save on this device.</p>'}
    <p class="pencil small">Your walls stay private until you share one. Your room photo never goes up; a shared wall shows the drawing, and the wall photo only if you turn it on.</p>
  </main>`;
}
function profileHead(p, { own, counts, following } = {}) {
  return `<div class="profile-head">${avatar(p, 64)}<div class="profile-text"><h1>${esc(p.name || p.handle)}</h1><p class="pencil">@${esc(p.handle)}${counts ? ` · ${counts.followers} follower${counts.followers === 1 ? '' : 's'} · ${counts.following} following` : ''}</p>${p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : ''}</div></div>
    <div class="acts left">${own ? '<a class="btn quiet small" href="#/me/edit">Edit profile</a><button type="button" class="link small" data-act="signout">Sign out</button>' : signedIn() ? `<button type="button" class="btn${following ? ' quiet' : ''} small" data-follow="${esc(p.id)}" aria-pressed="${!!following}">${following ? 'Following' : 'Follow'}</button>` : '<a class="btn small" href="#/signin">Sign in to follow</a>'}</div>`;
}
function meScreen() {
  if (!signedIn()) { go('#/signin'); return ''; }
  const [, sub] = route();
  const p = A.me.profile;
  if (sub === 'edit') {
    return `${bar(back('#/me', 'Profile'))}
    <main class="page">
      <h1>Edit profile</h1>
      <form class="fields" id="profile-form">
        <label class="name-in"><span>Name</span><input type="text" name="name" maxlength="40" value="${esc(p.name || '')}"></label>
        <label class="name-in"><span>Handle</span><input type="text" name="handle" maxlength="24" value="${esc(p.handle)}" autocapitalize="none" spellcheck="false" pattern="[a-z0-9_]{3,24}"></label>
        <label class="name-in"><span>A line about you</span><input type="text" name="bio" maxlength="160" value="${esc(p.bio || '')}"></label>
        ${A.err ? `<p class="error" role="alert">${esc(A.err)}</p>` : ''}
        <div class="acts left"><button class="btn" type="submit">Save</button><a class="btn quiet" href="#/me">Cancel</a></div>
      </form>
    </main>`;
  }
  loadMine();
  const key = `counts:${p.id}`;
  if (!A.cache.has(key)) { A.cache.set(key, null); ACCT.followCounts(p.id).then((c) => { A.cache.set(key, c); render(); }).catch(() => {}); }
  const local = store.listWalls();
  const remote = A.mine || [];
  const byClient = new Map(remote.map((r) => [r.client_id, r]));
  const card = (w) => { const r = byClient.get(w.id); return `<li><button type="button" class="wall-card" data-wallcard="${esc(w.id)}" aria-label="${esc(w.name)}"><span class="drawing small-drawing">${savedSvg(w, 180)}</span><span class="wall-name">${esc(w.name)}${r && r.is_public ? ' <span class="chip-s">Shared</span>' : ''}</span></button></li>`; };
  const onlyRemote = remote.filter((r) => !local.some((w) => w.id === r.client_id));
  if (S.ui.savedTab && !A.cache.has('saved')) { A.cache.set('saved', null); ACCT.savedWalls().then((rows) => { A.cache.set('saved', rows); render(); }).catch(() => A.cache.delete('saved')); }
  const savedRows = A.cache.get('saved') || [];
  return `${bar(back('#/', 'Walldrobe'), '<a class="btn quiet small" href="#/hung">Walls people hung</a>')}
  <main class="page profile-page">
    ${profileHead(p, { own: true, counts: A.cache.get(key) })}
    ${flashHtml()}
    <div class="seg tabs" role="tablist"><button type="button" role="tab" data-act="tab-walls" aria-selected="${!S.ui.savedTab}">Your walls</button><button type="button" role="tab" data-act="tab-saved" aria-selected="${!!S.ui.savedTab}">Saved</button></div>
    ${S.ui.savedTab
      ? (savedRows.length ? `<ul class="posts">${savedRows.map((r) => postCard(r)).join('')}</ul>` : `<p class="pencil">${A.cache.get('saved') === null ? 'Loading…' : 'Walls you save from other people land here.'}</p>`)
      : `${local.length || onlyRemote.length ? `<ul class="wall-grid">${local.map(card).join('')}${onlyRemote.map((r) => `<li><a class="wall-card" href="#/w/${esc(r.id)}"><span class="drawing small-drawing">${savedSvg(postWall(r), 180)}</span><span class="wall-name">${esc(r.name)}${r.is_public ? ' <span class="chip-s">Shared</span>' : ''}</span></a></li>`).join('')}</ul>` : '<p class="pencil">Save a wall and it shows up here, on every device you sign in on.</p>'}
        <p class="pencil small">Tap a wall to share it to your profile.</p>`}
  </main>${sheetHtml()}`;
}
function userScreen() {
  const [, handle] = route();
  const key = `u:${(handle || '').toLowerCase()}`;
  if (!A.cache.has(key)) {
    A.cache.set(key, { status: 'loading' });
    ACCT.profileByHandle(handle).then(async (p) => {
      if (!p) { A.cache.set(key, { status: 'none' }); render(); return; }
      const [walls, counts, following] = await Promise.all([ACCT.wallsOf(p.id), ACCT.followCounts(p.id), ACCT.isFollowing(p.id)]);
      A.cache.set(key, { status: 'ok', p, walls, counts, following });
      try { const c = await ACCT.saveCounts(walls.map((r) => r.id)); for (const [k, v] of c) A.counts.set(k, v); } catch { /* extra */ }
      render();
    }).catch((e) => { A.cache.set(key, { status: 'error', err: e.message }); render(); });
  }
  const u = A.cache.get(key);
  const body = u.status === 'loading' ? '<p class="pencil">Loading…</p>'
    : u.status === 'none' ? '<p class="pencil">Nobody by that name.</p>'
      : u.status === 'error' ? `<p class="note">Couldn't load it: ${esc(u.err)}.</p>`
        : `${profileHead(u.p, { own: A.me && A.me.id === u.p.id, counts: u.counts, following: u.following })}
          ${u.walls.length ? `<ul class="posts">${u.walls.map((r) => postCard(r, { profile: u.p })).join('')}</ul>` : '<p class="pencil">No shared walls yet.</p>'}`;
  return `${bar(back('#/hung', 'Walls people hung'))}<main class="page profile-page">${flashHtml()}${body}</main>`;
}
function hungScreen() {
  const F = A.feed;
  if (ACCT.ready() && F.status !== 'loading' && (F.status === 'idle' || Date.now() - F.at > 60000)) setTimeout(() => loadFeed(false), 0);
  const tabs = `<div class="seg tabs" role="tablist"><button type="button" role="tab" data-feed-scope="all" aria-selected="${F.scope === 'all'}">Everyone</button><button type="button" role="tab" data-feed-scope="following" aria-selected="${F.scope === 'following'}">Following</button></div>`;
  const status = !ACCT.ready() ? '<p class="note">The feed opens with sign-in, soon.</p>'
    : F.status === 'error' ? `<p class="note">Couldn't load the walls: ${esc(F.err)}. <button type="button" class="link" data-act="feed-retry">Try again</button></p>`
      : F.status === 'loading' && !F.posts.length ? '<p class="pencil">Loading walls…</p>' : '';
  const empty = F.status === 'ok' && !F.posts.length ? `<p class="pencil">${F.scope === 'following' ? (signedIn() ? 'Nobody you follow has shared a wall yet.' : 'Sign in to see walls from people you follow.') : 'No walls yet. Share one from Your walls and it shows up here.'}</p>` : '';
  return `${bar(back('#/', 'Walldrobe'), signedIn() ? `<a class="acct-chip" href="#/me" aria-label="Your profile">${avatar(A.me.profile, 28)}</a>` : '<a class="btn quiet small" href="#/signin">Sign in</a>')}
  <main class="page hung-page">
    <h1>Walls people hung</h1>
    ${tabs}
    ${status}${empty}
    ${F.posts.length ? `<ul class="posts">${F.posts.map((r) => postCard(r)).join('')}</ul>` : ''}
    ${F.more && F.status !== 'error' ? `<div class="acts"><button type="button" class="btn quiet" data-act="feed-more"${F.status === 'loading' ? ' disabled' : ''}>${F.status === 'loading' ? 'Loading…' : 'More walls'}</button></div>` : ''}
  </main>`;
}
function oneWallScreen() {
  const [, id] = route();
  const key = `w:${id}`;
  if (!A.cache.has(key)) { A.cache.set(key, { status: 'loading' }); ACCT.getWall(id).then((r) => { A.cache.set(key, r ? { status: 'ok', r } : { status: 'none' }); render(); }).catch((e) => { A.cache.set(key, { status: 'error', err: e.message }); render(); }); }
  const u = A.cache.get(key);
  if (u.status !== 'ok') return `${bar(back('#/hung', 'Walls people hung'))}<main class="page"><p class="pencil">${u.status === 'loading' ? 'Loading…' : u.status === 'none' ? 'This wall is private or gone.' : esc(u.err)}</p></main>`;
  const r = u.r, w = postWall(r), L = w.chosen.layout;
  const fresh = L ? L.pieces.filter((x) => x.ref.source === 'catalog' && byId.get(x.ref.id)) : [];
  const mine = A.me && r.owner === A.me.id;
  return `${bar(back('#/hung', 'Walls people hung'))}
  <main class="page">
    ${who(r) ? `<p class="post-head"><a class="post-who" href="#/u/${esc(who(r).handle)}">${avatar(who(r), 28)}<span>${esc(who(r).name || who(r).handle)}</span></a></p>` : ''}
    <h1>${esc(r.name || 'A wall')}</h1>
    ${r.note ? `<p class="post-note">${esc(r.note)}</p>` : ''}
    ${flashHtml()}
    <div class="drawing">${L ? savedSvg(w, pxNow()) : ''}</div>
    <div class="acts left">${fresh.length ? `<button type="button" class="btn" data-try-wall="${esc(r.id)}">Try these on my wall</button>` : ''}${mine ? '' : `<button type="button" class="btn quiet" data-wsave="${esc(r.id)}" aria-pressed="${A.saves.has(r.id)}">${A.saves.has(r.id) ? 'Saved' : 'Save'}</button>`}<button type="button" class="btn quiet" data-act="copy-wall-link">${S.ui.copied === 'wall' ? 'Link copied' : 'Copy link'}</button></div>
    ${fresh.length ? `<h2>The pieces</h2><ul class="rows">${fresh.map((x) => { const it = byId.get(x.ref.id); return `<li class="row piece-row"><span class="thumb" style="aspect-ratio:${it.aspect || x.w / x.h}"><img src="${it.imageData}" alt=""></span><span class="row-text"><span class="name">${esc(it.title)}</span><span class="meta">${x.w} x ${x.h} in</span></span><button type="button" class="heart" data-save="${esc(it.id)}" aria-pressed="${(S.draft && S.draft.saved || []).includes(it.id)}" aria-label="Favorite ${esc(it.title)}">${heart((S.draft && S.draft.saved || []).includes(it.id))}</button></li>`; }).join('')}</ul>` : ''}
  </main>`;
}
// Try a shared wall's pieces on your own: they become favorites, which your walls try first.
function tryWall(id) {
  const rows = [...A.feed.posts, ...(A.cache.get(`w:${id}`) && A.cache.get(`w:${id}`).r ? [A.cache.get(`w:${id}`).r] : []), ...[...A.cache.values()].flatMap((v) => (v && v.walls) || []), ...((A.cache.get('saved')) || [])];
  const r = rows.find((x) => x && x.id === id);
  if (!r) return;
  const L = r.body && r.body.layout;
  const ids = L ? L.pieces.filter((x) => x.ref.source === 'catalog' && byId.get(x.ref.id)).map((x) => x.ref.id) : [];
  const fav = new Set((S.draft && S.draft.saved) || store.loadMe().saved);
  for (const pid of ids) if (!fav.has(pid)) toggleSave(pid);
  S.flash = `${ids.length} pieces are in your favorites. Your walls try them first where they fit.`;
  go(S.draft && S.draft.width ? '#/layouts' : '#/saved');
}

function render() {
  const [r0, r1] = route();
  applyLook();
  if (r0 === 'sample') { loadSample(r1); location.replace('#/layouts'); return; }
  if (r0 === 'new') {
    S.draft = { ...blankDraft(), taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null, picks: [] } };
    S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; S.quiz = null;
    resetLayouts(); location.replace('#/start'); return;
  }
  if (r0 === 'home-add') {
    saveHomeDraft();
    const n = myHome().walls.length;
    S.draft = { ...blankDraft(), home: true, name: n ? `Wall ${n + 1}` : 'Main wall', taste: S.draft && S.draft.taste && S.draft.taste.source === 'yours' ? S.draft.taste : { source: 'none', weights: null, picks: [] } };
    S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; S.quiz = null;
    resetLayouts(); persist(); location.replace('#/start'); return;
  }
  if (r0 === 'resume') { if (!resumeDraft()) { location.replace('#/start'); return; } location.replace(need() || '#/layouts'); return; }
  if (APP) acctStart();
  const appScreens = APP ? { signin: signInScreen, me: meScreen, u: userScreen, hung: hungScreen, w: oneWallScreen, plan: planScreen } : {};
  const screens = { ...appScreens, '': home, begin, browse, stuff: stuffScreen, home: homeScreen, 'home-get': homeGetScreen, start, check, corners, size: sizeScreen, things, pieces, taste, layouts: keepUnder('feed', feed), wall: keepUnder('wall', wallScreen), frames: framesScreen, get: getScreen, hang: hangScreen, walls, compare, saved: savedScreen };
  const fn = S.crop ? cropScreen : screens[r0] || home;
  document.title = { '': 'Walldrobe', begin: 'Start · Walldrobe', browse: 'All the art · Walldrobe', stuff: 'Your stuff · Walldrobe', home: 'Your home · Walldrobe', 'home-get': 'Get it all · Walldrobe', signin: 'Sign in · Walldrobe', plan: 'The full plan · Walldrobe', me: 'Your profile · Walldrobe', hung: 'Walls people hung · Walldrobe', walls: 'Your walls · Walldrobe', frames: 'Frame it · Walldrobe', get: 'Get it · Walldrobe', hang: 'Hang it · Walldrobe', layouts: 'Your walls, ranked · Walldrobe', wall: 'Your wall · Walldrobe', taste: 'Make it mine · Walldrobe' }[r0] || 'Walldrobe';
  const el = document.activeElement;
  const sel = el && el !== document.body && el.closest('#app') ? focusSelector(el) : null;
  let html;
  try { html = fn(); }
  catch (e) {
    console.error(e);
    S.view = null; S.busy = null;
    html = brokeScreen();
  }
  const railNav = html ? railHtml(r0) : '';
  if (html) app().innerHTML = html + railNav;
  document.body.classList.toggle('has-rail', !!railNav);
  // A sheet that just closed leaves a short calm, so the second tap of a double tap
  // doesn't land on whatever was under the sheet. The time is the tap's own, so a tap
  // that waited behind a slow build still counts as part of the double tap.
  if (S.ui.hadSheet && !S.sheet) S.ui.calm = performance.now() + 300;
  S.ui.hadSheet = !!S.sheet;
  // An open sheet is a step in the browser's history, so Back (or the iPhone's swipe)
  // closes the sheet instead of leaving the page. Closing it any other way takes the step back off.
  if (S.sheet && !S.ui.sheetStep) { S.ui.sheetStep = true; try { history.pushState({ wdSheet: true }, ''); } catch { /* no history */ } }
  else if (!S.sheet && S.ui.sheetStep) {
    // Wait a beat: a rebuild closes the sheet for a moment and opens it again in the same tap.
    setTimeout(() => {
      if (S.sheet || !S.ui.sheetStep) return;
      S.ui.sheetStep = false;
      try { if (history.state && history.state.wdSheet) { S.ui.ownBack = true; history.back(); } } catch { /* no history */ }
    }, 0);
  }
  document.body.classList.toggle('has-sheet', !!S.sheet);
  document.body.classList.toggle('on-wall', r0 === 'wall');
  document.body.classList.toggle('on-browse', r0 === 'browse');
  document.body.classList.toggle('on-home', !r0);
  // Focus stays on the control you used when it's still there (in a sheet too); a sheet
  // that just opened puts it on its heading.
  const again = sel ? document.querySelector(sel) : null;
  if (S.sheet) {
    const s = $('#sheet');
    if (s && again && s.contains(again)) again.focus({ preventScroll: true });
    else if (s && !s.contains(document.activeElement)) { const h = s.querySelector('h2') || s; h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  } else if (again) again.focus({ preventScroll: true });
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
  if (r === 'check') wireCheck();
  if (r === 'corners') wireCorners();
  if (r === 'things') wireThings();
  if (r === 'pieces' && S.draft && S.draft.photo) wireDraw();
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
    const r = g.querySelector('.ob-box'); r.setAttribute('x', o.x); r.setAttribute('y', H - o.y - o.h); r.setAttribute('width', o.w); r.setAttribute('height', o.h);
    const hp = g.querySelector('.hit-pad'); if (hp) { const pw = Number(hp.getAttribute('width')), ph = Number(hp.getAttribute('height')); hp.setAttribute('x', o.x - (pw - o.w) / 2); hp.setAttribute('y', H - o.y - o.h - (ph - o.h) / 2); }
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
    else { ctx.o.w = ctx.orig.w + dx; ctx.o.h = ctx.orig.h + dy; ctx.o.real = false; }
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
  if (f.id === 'drop-form') return;
  if (APP && f.id === 'email-form') {
    const email = String(f.elements.email.value || '').trim();
    if (!email) return;
    ACCT.signInEmail(email, '#/me').then(() => { S.ui.emailSent = email; A.err = null; render(); }).catch((x) => { A.err = x.message; render(); });
    return;
  }
  if (APP && f.id === 'profile-form') {
    const v = (n) => String(f.elements[n].value || '').trim();
    A.err = null;
    ACCT.updateProfile({ name: v('name').slice(0, 40), handle: v('handle').toLowerCase(), bio: v('bio').slice(0, 160) })
      .then(() => { S.flash = 'Saved.'; go('#/me'); }).catch((x) => { A.err = x.message; render(); });
    return;
  }
  if (APP && f.dataset.shareWall) {
    const w = store.getWall(f.dataset.shareWall);
    if (!w || !signedIn()) return;
    S.ui.sharing = true; A.err = null; render();
    pushWall(w, { isPublic: true, showPhoto: !!(f.elements.photo && f.elements.photo.checked), note: String(f.elements.note.value || '').trim().slice(0, 240) })
      .then((r) => { S.flash = 'Shared on your profile.'; S.sheet = null; go(`#/w/${r.id}`); })
      .catch((x) => { A.err = x.message; })
      .finally(() => { S.ui.sharing = false; render(); });
    return;
  }
  if (f.dataset.homeBudget !== undefined) {
    const v = Math.round(Number(f.elements.budget.value) || 0), h = myHome();
    h.budget = v >= 20 ? Math.min(100000, v) : null; saveHome(h); render(); return;
  }
  if (f.dataset.budgetForm) {
    const v = Math.round(Number(f.elements.budget.value) || 0);
    if (!v) return; // an empty box: nothing to set
    if (v < 20) { S.ui.budgetErr = f.dataset.budgetForm; if (f.dataset.budgetForm === 'sheet') { S.sheet = 'change'; S.ui.sheetStay = true; } render(); return; }
    S.ui.budgetErr = null;
    const d = S.draft, was = { budget: d.budget, budgetAsked: d.budgetAsked };
    d.budget = Math.min(20000, v); d.budgetAsked = true;
    S.undo = { label: `Budget $${d.budget.toLocaleString('en-US')}, all in.`, shape: true, run: () => { Object.assign(d, was); persist(); } };
    S.flash = null; persist();
    if (f.dataset.budgetForm === 'sheet') { S.sheet = 'change'; S.ui.sheetStay = true; }
    render(); return;
  }
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
    // The app's own words for a number out of range, not the browser's bubble.
    if (S.draft.photo.measure.which === 'width' ? known > 600 || known < 24 : known > 240 || known < 60) { S.ui.sizeErr = S.draft.photo.measure.which === 'width' ? 'A wall between 2 ft and 50 ft wide works here. Check the width.' : 'A wall between 5 ft and 20 ft tall works here. Check the height.'; render(); return; }
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
        S.busy = null; go(p.mode === 'auto' ? afterRead() : '#/check');
      }).catch(() => { S.busy = null; S.ui.sizeErr = "Couldn't flatten the photo. Try again, or use another photo."; render(); });
      return;
    }
    render();
  }
});

document.addEventListener('toggle', (e) => { if (e.target && e.target.classList && e.target.classList.contains('hangers')) S.ui.hangOpen = e.target.open; if (e.target && e.target.classList && e.target.classList.contains('filter-box')) S.ui.filtersOpen = e.target.open; }, true);

document.addEventListener('change', (e) => {
  const t = e.target;
  // The photo, caught at the document so a render while the picker is open can't lose it.
  if (t.id === 'photo-input' || t.id === 'photo-input-2') { onPhoto(t.files && t.files[0]); return; }
  // Your stuff: a piece of art from a photo, shaped like the photo until you type its size.
  if ((t.id === 'stuff-photo' || (t.dataset && t.dataset.stuffPhoto)) && t.files && t.files[0]) {
    openCrop(t.files[0], { kind: 'stuff', into: t.dataset.stuffPhoto || null });
    t.value = '';
    return;
  }
  if (t.dataset && t.dataset.browse) {
    const f = S.ui.browse; if (!f) return;
    S.ui.filtersOpen = true;
    f[t.dataset.browse] = t.value; f.n = BROWSE_PAGE; S.undo = null;
    render(); const el = document.querySelector(`[data-browse="${CSS.escape(t.dataset.browse)}"]`); if (el) el.focus({ preventScroll: true });
    return;
  }
  if (t.dataset && t.dataset.resize) {
    S.flash = null; S.undo = null;
    resizePiece(t.dataset.resize, t.value);
    S.focusAfter = `[data-resize="${CSS.escape(t.dataset.resize)}"]`;
    render();
    const f = document.querySelector(S.focusAfter); S.focusAfter = null; if (f) f.focus({ preventScroll: true });
    return;
  }
  if (t.dataset && t.dataset.sk && t.dataset.sid) {
    const list = myStuff(), x = list.find((y) => y.id === t.dataset.sid);
    if (!x) return;
    if (t.dataset.sk === 'title') x.title = t.value.trim() || 'piece';
    else { const k = t.dataset.sk, next = lockedSize(x, k, Math.max(2, Math.min(120, Number(t.value) || 2)), { w: x.w, h: x.h }); x.w = next.w; x.h = next.h; }
    saveStuff(list); syncStuff(x); setTimeout(render, 0);
    return;
  }
  if (t.id === 'hung-photo' && t.files && t.files[0]) {
    loadFile(t.files[0], 900).then((img) => { if (S.draft.hung) { S.draft.hung = { ...S.draft.hung, photo: img.url }; persist(); render(); } }).catch(() => { S.flash = "That photo won't open. Use a JPG or PNG."; render(); });
    return;
  }
  // A frame's hanger, set when it arrives: its kind, how far below the top, and for D-rings how far in.
  if (t.dataset && (t.dataset.hangType || t.dataset.hangDrop || t.dataset.hangIn)) {
    const id = t.dataset.hangType || t.dataset.hangDrop || t.dataset.hangIn;
    const L = shown(); const p = L && L.pieces.find((x) => x.ref.id === id);
    if (!p) return;
    const d = S.draft, cur = { ...hangerOf(p) };
    delete cur.set; delete cur.measured;
    const v = Number(t.value), ok = Number.isFinite(v) && v >= 0 && v <= 12;
    if (t.dataset.hangType) { const def = { sawtooth: 0.5, wire: RULES.defaultDrop, rings: 3 }; cur.type = t.value; if (!(d.hangers || {})[id]) cur.drop = def[t.value]; if (t.value === 'rings' && cur.inset == null) cur.inset = RULES.ringInset; }
    else if (t.dataset.hangDrop && ok) cur.drop = Math.round(v * 4) / 4;
    else if (t.dataset.hangIn && ok) cur.inset = Math.round(v * 4) / 4;
    else return;
    d.hangers = { ...(d.hangers || {}), [id]: cur };
    S.ui.hangOpen = true; persist(); render();
    const sel = t.dataset.hangType ? `[data-hang-type="${CSS.escape(id)}"]` : t.dataset.hangDrop ? `[data-hang-drop="${CSS.escape(id)}"]` : `[data-hang-in="${CSS.escape(id)}"]`;
    const again = document.querySelector(sel); if (again) again.focus({ preventScroll: true });
    return;
  }
  if (t.dataset && t.dataset.artPhoto && t.files && t.files[0]) {
    if (!S.draft.owned.some((x) => x.id === t.dataset.artPhoto)) return;
    openCrop(t.files[0], { kind: 'owned', id: t.dataset.artPhoto });
    t.value = '';
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
    if (o) {
      if (o.autoId) forgetAuto(o.autoId);
      // The inputs show the real size; typing one makes the whole box real, not the photo's.
      const tb = trueOb(o);
      if (!o.real) { o.x = tb.x; o.y = tb.y; o.w = tb.w; o.h = tb.h; o.real = true; }
      o[t.dataset.obk] = Number(t.value); clampOb(o); resetLayouts(); persist(); setTimeout(render, 0);
    }
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
  if (t.dataset.ok) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.oid);
    if (!o) return;
    if (t.dataset.ok === 'title') o.title = t.value.trim().replace(/^(my|your)\s+/i, '') || 'print';
    else if (t.dataset.ok === 'color') { o.color = t.value; o.palette = [{ hex: t.value, weight: 1 }]; }
    else {
      const k = t.dataset.ok, next = lockedSize(o, k, Math.max(2, Number(t.value) || 2), sizeShown(o));
      if (isFramed(o)) { o.w = next.w; o.h = next.h; } else { o.artSize = next; setOwnedArt(o); }
    }
    resetLayouts(); persist(); setTimeout(render, 0);
  }
  if (t.dataset.rename) { store.renameWall(t.dataset.rename, t.value.trim() || 'My wall'); if (S.draft && S.draft.id === t.dataset.rename) { S.draft.name = t.value.trim() || 'My wall'; persist(); } }
});

// What changing the wall's inputs does to the list: build it again, keep the open wall's place.
function rebuild(name, undo = null) { S.flash = null; S.undo = undo; S.openKey = null; S.sheet = null; S.selected = null; S.focusAfter = undo ? '[data-act="undo"]' : '[data-act="change"]'; persist(); render(); }

document.addEventListener('click', (e) => {
  if (S.ui.calm && e.timeStamp < S.ui.calm && !e.target.closest('#sheet')) { e.preventDefault(); return; }
  // A drawn piece inside a wall in the list opens that wall, like a tap anywhere else on it.
  const hit = e.target.closest('button, .art, a[data-act], a[data-wall], .backdrop');
  // The same for a drawn piece inside a saved wall's card: the tap belongs to the card.
  const link = hit && hit.classList.contains('art') ? hit.closest('a[data-wall], button') : null;
  const t = link || hit;
  if (!t) return;
  const a = t.dataset.act;
  if (t.dataset.wall) { S.openKey = t.dataset.wall; S.selected = null; S.undo = null; S.edit = false; S.sheet = null; if (location.hash === '#/wall') { e.preventDefault(); render(); } return; }
  if (t.dataset.goto !== undefined) { if (t.dataset.goto) { S.openKey = t.dataset.goto; S.selected = null; S.undo = null; S.edit = false; render(); } return; }
  if (t.dataset.which) { S.draft.photo.measure.which = t.dataset.which; S.draft.photo.measure.value = null; S.draft.photo.measure.override = null; persist(); render(); return; }
  if (t.dataset.fix !== undefined) { S.ui.fix = t.dataset.fix || null; render(); return; }
  if (t.dataset.fwidth) { S.flash = null; S.undo = null; setFrameWidth(t.dataset.fwidth); render(); const b = document.querySelector(`[data-fwidth="${CSS.escape(t.dataset.fwidth)}"]`); if (b) b.focus({ preventScroll: true }); return; }
  if (t.dataset.mwidth) { S.draft.matWidth = t.dataset.mwidth === 'wide' ? 'wide' : 'standard'; persist(); render(); const b = document.querySelector(`[data-mwidth="${CSS.escape(t.dataset.mwidth)}"]`); if (b) b.focus({ preventScroll: true }); return; }
  if (t.dataset.colorOne) {
    const id = t.dataset.colorOne, c = t.dataset.c, m = { ...(S.draft.colorFor || {}) };
    if (!FRAME_LOOKS[c]) return;
    if (c === lookOf()) delete m[id]; else m[id] = c;
    S.draft.colorFor = m; S.undo = null; persist(); render();
    const b = document.querySelector(`[data-color-one="${CSS.escape(id)}"][data-c="${CSS.escape(c)}"]`); if (b) b.focus({ preventScroll: true });
    return;
  }
  if (t.dataset.look) {
    // One color for the set: the pieces you'd colored one by one follow it, with Undo.
    const prev = S.draft.colorFor || {}, prevLook = S.draft.look;
    if (Object.keys(prev).length && t.dataset.look !== prevLook) { S.draft.colorFor = {}; S.undo = { label: `Every frame ${FRAME_LOOKS[t.dataset.look].name.toLowerCase()}.`, run: () => { S.draft.colorFor = prev; S.draft.look = prevLook; persist(); } }; }
    S.draft.look = t.dataset.look; if (S.sheet === 'change') S.ui.sheetStay = true; persist(); render(); const b = document.querySelector(`[data-look="${CSS.escape(t.dataset.look)}"]`); if (b) b.focus({ preventScroll: true }); return; }
  if (t.dataset.mat) {
    // The wall you're framing stays the wall you're framing, whatever the walls behind it do.
    const L0 = route()[0] === 'frames' ? shown() : null;
    S.draft.mat = MAT_SHARE[t.dataset.mat] != null ? t.dataset.mat : 'most'; S.draft.matFor = {};
    if (S.sheet === 'change') S.ui.sheetStay = true;
    if (L0) { S.draft.chosen = { layout: bareLayout(L0), inputKey: viewKey(), at: 0 }; S.openKey = L0.key; } { const me = store.loadMe(); me.matLevel = S.draft.mat; store.saveMe(me); ME_MAT = S.draft.mat; } persist(); render(); const b = document.querySelector(`[data-mat="${CSS.escape(t.dataset.mat)}"]`); if (b) b.focus({ preventScroll: true }); return; }
  if (t.dataset.matOne) { const L = shown(), p = L && L.pieces.find((x) => x.ref.id === t.dataset.matOne); if (p) { S.draft.matFor = { ...(S.draft.matFor || {}), [p.ref.id]: !matFor(p) }; persist(); render(); const b = document.querySelector(`[data-mat-one="${CSS.escape(p.ref.id)}"]`); if (b) b.focus({ preventScroll: true }); } return; }
  if (t.dataset.order) { const k = t.dataset.order, o = { ...(S.draft.orders || {}) }; if (o[k]) delete o[k]; else o[k] = true; S.draft.orders = o; persist(); render(); const b = document.querySelector(`[data-order="${CSS.escape(k)}"]`); if (b) b.focus({ preventScroll: true }); return; }
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
      S.busy = null; go(afterRead());
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
      const was = { keep: o.keep, pinned: o.pinned };
      o.keep = ['skip', 'happy'].includes(t.dataset.keep) ? t.dataset.keep : 'must';
      if (o.keep !== 'must') o.pinned = false;
      if (o.keep === was.keep) return;
      S.mem.clean = null;
      const label = { must: 'Kept in every wall.', happy: 'Maybe.', skip: 'Left out.' }[o.keep];
      const openWas = S.openKey;
      if (route()[0] === 'wall') { S.sheet = null; rebuild('keep', { label, run: () => { Object.assign(o, was); S.mem.clean = null; S.openKey = openWas; persist(); } }); return; }
      resetLayouts(); persist(); render();
    }
    return;
  }
  if (t.dataset.pin) {
    const o = S.draft.owned.find((x) => x.id === t.dataset.pin);
    if (o) {
      const was = { pinned: o.pinned, keep: o.keep }, chosen = S.draft.chosen;
      o.pinned = !o.pinned; o.keep = 'must'; S.mem.clean = null;
      rebuild('pin', { label: o.pinned ? 'Stays where it hangs.' : 'Can move again.', run: () => { Object.assign(o, was); S.draft.chosen = chosen; S.mem.clean = null; S.openKey = chosen ? chosen.layout.key : null; persist(); } });
    }
    return;
  }
  if (t.dataset.fullness !== undefined || t.dataset.style !== undefined || t.dataset.art !== undefined || t.dataset.count !== undefined || t.dataset.budget !== undefined || t.dataset.tone !== undefined) {
    const d = S.draft;
    const was = { fullness: d.fullness, style: d.style, art: d.art, justMine: d.justMine, pieces: d.pieces, budget: d.budget, tone: d.tone }, openWas = S.openKey;
    if (t.dataset.budget !== undefined) d.budget = Number(t.dataset.budget) || null; S.ui.budgetErr = null;
    if (t.dataset.tone !== undefined) d.tone = t.dataset.tone || null;
    if (t.dataset.fullness !== undefined) d.fullness = t.dataset.fullness;
    if (t.dataset.style !== undefined) d.style = t.dataset.style || null;
    if (t.dataset.art !== undefined) { if (t.dataset.art === 'mine') d.justMine = true; else { d.art = t.dataset.art; d.justMine = false; } }
    if (t.dataset.count !== undefined) {
      if (!t.dataset.count) return;
      const L = route()[0] === 'wall' ? shown() : null;
      // On an open wall, one more or one fewer keeps the frames already up where they are.
      S.stepBase = L && t.dataset.count !== 'any' ? L.pieces.filter((p) => p.role !== 'pinned').map((p) => (p.slot ? { ...p.slot } : { x: p.x, y: p.y, w: p.w, h: p.h })) : null;
      d.pieces = t.dataset.count === 'any' ? null : Number(t.dataset.count);
      // Setting the count this wall already has keeps this wall exactly, first in the list.
      if (L && d.pieces === L.pieces.length) { S.draft.chosen = { layout: bareLayout(L), inputKey: viewKey(), at: 0 }; S.stepBase = null; }
    }
    if (['fullness', 'style', 'art', 'justMine', 'pieces', 'budget', 'tone'].every((k) => was[k] === d[k])) { S.stepBase = null; return; }
    S.openKey = S.draft.chosen && S.draft.chosen.inputKey === viewKey() ? S.draft.chosen.layout.key : null;
    // Several changes in a row each step back on their own, newest first.
    const prevUndo = S.undo && S.undo.shape ? S.undo : null;
    // Like rebuild(), but the sheet never closes in between, so focus stays on the option you picked.
    S.flash = null; S.selected = null; S.openKey = null;
    S.undo = { label: 'Changed.', shape: true, prev: prevUndo, run: () => { Object.assign(d, was); S.stepBase = null; S.openKey = openWas; persist(); } };
    S.sheet = 'change'; S.ui.sheetStay = true; S.focusAfter = focusSelector(t); persist(); render();
    return;
  }
  if (t.dataset.save) {
    const id = t.dataset.save;
    toggleSave(id);
    // Taking one off the Favorites page removes it from the list, so it gets an Undo.
    if (t.dataset.unfav) { S.undo = { label: 'Out of favorites.', where: 'saved', run: () => toggleSave(id) }; S.focusAfter = '[data-act="undo"]'; }
    render(); return;
  }
  if (t.dataset.choice) {
    const to = t.dataset.choice;
    if (swapTo(t.dataset.for, to)) { S.sheet = { piece: to }; S.selected = to; S.ui.allFor = null; S.ui.sheetStay = true; }
    render(); return;
  }
  if (t.dataset.piece) { S.sheet = { piece: t.dataset.piece }; S.selected = t.dataset.piece; S.ui.allFor = null; S.ui.sheetStay = false; render(); window.scrollTo({ top: 0 }); return; }
  if (t.dataset.browseSave) {
    const id = t.dataset.browseSave, on = browseSave(id), it = byId.get(id);
    S.undo = on ? { label: `Saved ${it ? it.title : ''}.`.replace(' .', '.'), run: () => { browseSave(id); } } : null;
    S.focusAfter = `[data-browse-save="${CSS.escape(id)}"]`; render();
    const f = document.querySelector(S.focusAfter); S.focusAfter = null; if (f) f.focus({ preventScroll: true });
    return;
  }
  if (t.dataset.browseNo) { browseNo(t.dataset.browseNo); render(); return; }
  if (t.dataset.askset !== undefined) {
    const [id, v] = t.dataset.askset.split(':'), me = store.loadMe(), was = { ...(me.asked || {}) };
    if (!ASK.some((q) => q.id === id)) return;
    me.asked = { ...was, [id]: v || null }; store.saveMe(me);
    S.undo = { label: 'Changed.', run: () => { const m = store.loadMe(); m.asked = was; store.saveMe(m); } };
    S.sheet = 'change'; S.ui.sheetStay = true; persist(); render();
    const b = document.querySelector(`[data-askset="${CSS.escape(t.dataset.askset)}"]`); if (b) b.focus({ preventScroll: true });
    return;
  }
  if (t.dataset.ask) {
    const me = store.loadMe(), was = { ...(me.asked || {}) }, q = ASK.find((x) => x.id === t.dataset.ask);
    if (!q) return;
    me.asked = { ...was, [q.id]: t.dataset.v || null }; store.saveMe(me);
    // A warm room with wood: oak frames, unless you picked a color.
    if (q.id === 'room' && t.dataset.v === 'wood' && S.draft && !S.draft.look) S.draft.look = 'oak';
    const o = q.opts.find((x) => x[0] === t.dataset.v);
    S.undo = { label: o ? `${o[1]}. Every wall leans that way.` : 'Skipped.', run: () => { const m = store.loadMe(); m.asked = was; store.saveMe(m); } };
    persist(); render(); return;
  }
  if (t.dataset.budgetAsk !== undefined) {
    const d = S.draft, was = { budget: d.budget, budgetAsked: d.budgetAsked };
    d.budget = Number(t.dataset.budgetAsk) || null; d.budgetAsked = true;
    S.undo = { label: d.budget ? `Budget $${d.budget.toLocaleString('en-US')}, all in.` : 'No budget.', run: () => { Object.assign(d, was); persist(); } };
    S.flash = null; persist(); render(); window.scrollTo({ top: 0 }); return;
  }
  if (t.dataset.stuffSet || t.dataset.stuffColor || t.dataset.stuffRemove) {
    const list = myStuff(), id = t.dataset.sid || t.dataset.stuffRemove, x = list.find((y) => y.id === id);
    if (!x) return;
    if (t.dataset.stuffRemove) {
      list.splice(list.indexOf(x), 1);
      if (S.draft && S.draft.owned.some((o) => o.stuff === id)) { S.draft.owned = S.draft.owned.filter((o) => o.stuff !== id); resetLayouts(); persist(); }
    }
    else if (t.dataset.stuffColor) x.color = t.dataset.stuffColor;
    else x[t.dataset.stuffSet] = t.dataset.v === '1';
    saveStuff(list); if (!t.dataset.stuffRemove) syncStuff(x); S.focusAfter = t.dataset.stuffRemove ? null : focusSelector(t); render();
    if (S.focusAfter) { const f = document.querySelector(S.focusAfter); S.focusAfter = null; if (f) f.focus({ preventScroll: true }); }
    return;
  }
  if (t.dataset.stuffKeep) {
    // Keep: in every wall. Maybe: when it earns its place. Skip: not on this wall.
    const x = myStuff().find((y) => y.id === t.dataset.sid), d = S.draft;
    if (!x || !d) return;
    const v = t.dataset.stuffKeep, i = d.owned.findIndex((o) => o.stuff === x.id);
    if (v === 'skip') { if (i >= 0) d.owned.splice(i, 1); }
    else if (i >= 0) d.owned[i].keep = v;
    else d.owned.push({ ...ownedFromStuff(x), keep: v });
    resetLayouts(); persist(); S.focusAfter = `[data-stuff-keep="${v}"][data-sid="${CSS.escape(x.id)}"]`; render();
    const f = document.querySelector(S.focusAfter); S.focusAfter = null; if (f) f.focus({ preventScroll: true });
    return;
  }
  if (t.dataset.toStuff) {
    // A piece you added on this wall, kept in your stuff too, so other walls can use it.
    const o = S.draft.owned.find((y) => y.id === t.dataset.toStuff);
    if (!o || o.stuff) return;
    const list = myStuff(), a = sizeShown(o);
    const x = { id: stuffId(), kind: 'art', title: o.title, w: a.w, h: a.h, framed: isFramed(o), thumb: o.thumb || null, palette: o.palette || [], color: o.color || null, ...(o.ratio ? { ratio: o.ratio } : {}), ...(o.lock != null ? { lock: o.lock } : {}) };
    list.push(x); saveStuff(list); o.stuff = x.id; persist();
    S.flash = `Saved your ${o.title} to your stuff.`; render();
    return;
  }
  if (t.dataset.ownFramed) {
    const o = S.draft.owned.find((y) => y.id === t.dataset.oid);
    if (!o) return;
    setOwnedFramed(o, t.dataset.ownFramed === '1');
    resetLayouts(); persist(); S.focusAfter = `[data-own-framed="${t.dataset.ownFramed}"][data-oid="${CSS.escape(o.id)}"]`; render();
    const f = document.querySelector(S.focusAfter); S.focusAfter = null; if (f) f.focus({ preventScroll: true });
    return;
  }
  if (t.dataset.lock) {
    const own = t.dataset.lockKind === 'ok', list = own ? null : myStuff();
    const x = own ? S.draft.owned.find((y) => y.id === t.dataset.lock) : list.find((y) => y.id === t.dataset.lock);
    if (!x) return;
    x.lock = !lockOn(x);
    if (x.lock && !x.ratio) { const c = own ? sizeShown(x) : x; x.ratio = c.w / c.h; }
    if (!x.lock) delete x.ratio;
    if (own) persist(); else saveStuff(list);
    S.focusAfter = `[data-lock="${CSS.escape(x.id)}"]`; render();
    const f = document.querySelector(S.focusAfter); S.focusAfter = null; if (f) f.focus({ preventScroll: true });
    return;
  }
  if (t.dataset.stuffWall) {
    const x = myStuff().find((y) => y.id === t.dataset.stuffWall), d = S.draft;
    if (!x || !d) return;
    const on = d.owned.some((o) => o.stuff === x.id);
    d.owned = on ? d.owned.filter((o) => o.stuff !== x.id) : [...d.owned, ownedFromStuff(x)];
    resetLayouts(); persist(); S.focusAfter = `[data-stuff-wall="${CSS.escape(x.id)}"]`; render();
    const f = document.querySelector(S.focusAfter); S.focusAfter = null; if (f) f.focus({ preventScroll: true });
    return;
  }
  // The app site: follow, save someone's wall, try its pieces, the feed, share, report.
  if (APP && t.dataset.follow) {
    const id = t.dataset.follow, key = [...A.cache.keys()].find((k) => k.startsWith('u:') && A.cache.get(k).p && A.cache.get(k).p.id === id), u = key && A.cache.get(key);
    if (!u || !signedIn()) return;
    const on = !u.following;
    u.following = on; u.counts = { ...u.counts, followers: Math.max(0, u.counts.followers + (on ? 1 : -1)) }; render();
    (on ? ACCT.follow(id) : ACCT.unfollow(id)).then(() => { A.feed.at = 0; }).catch((e) => { u.following = !on; u.counts = { ...u.counts, followers: Math.max(0, u.counts.followers + (on ? -1 : 1)) }; S.flash = e.message; render(); });
    return;
  }
  if (APP && t.dataset.wsave) {
    const id = t.dataset.wsave;
    if (!signedIn()) { go('#/signin'); return; }
    const on = !A.saves.has(id);
    if (on) A.saves.add(id); else A.saves.delete(id);
    A.counts.set(id, Math.max(0, (A.counts.get(id) || 0) + (on ? 1 : -1))); A.cache.delete('saved'); render();
    (on ? ACCT.saveWall(id) : ACCT.unsaveWall(id)).catch((e) => { if (on) A.saves.delete(id); else A.saves.add(id); A.counts.set(id, Math.max(0, (A.counts.get(id) || 0) + (on ? -1 : 1))); S.flash = e.message; render(); });
    return;
  }
  if (APP && t.dataset.tryWall) { tryWall(t.dataset.tryWall); return; }
  if (APP && t.dataset.reportWall) {
    const id = t.dataset.reportWall;
    if (!signedIn()) { go('#/signin'); return; }
    if (S.ui.askReport !== id) { S.ui.askReport = id; S.flash = 'Tap Report again to hide this wall for you and flag it. Three reports hide it for everyone.'; render(); return; }
    S.ui.askReport = null; A.feed.posts = A.feed.posts.filter((r) => r.id !== id);
    ACCT.report(id, 'reported in app').then(() => { S.flash = 'Reported. Thanks.'; render(); }).catch((e) => { S.flash = e.message; render(); });
    render(); return;
  }
  if (APP && t.dataset.feedScope) { A.feed = { ...A.feed, scope: t.dataset.feedScope, posts: [], status: 'idle', more: false, at: 0 }; render(); return; }
  if (APP && t.dataset.unshareWall) {
    const w = store.getWall(t.dataset.unshareWall);
    if (!w) return;
    S.ui.sharing = true; render();
    pushWall(w, { isPublic: false, showPhoto: false }).then(() => { S.flash = 'Off your profile.'; }).catch((e) => { A.err = e.message; }).finally(() => { S.ui.sharing = false; render(); });
    return;
  }
  if (t.dataset.otherWall) {
    // Swap to the wall on that side; the one you had becomes the way back.
    const p = S.draft && S.draft.photo, i = p && (p.others || []).findIndex((o) => o.side === t.dataset.otherWall);
    if (i == null || i < 0) return;
    const o = p.others[i], back = { side: o.side === 'right' ? 'left' : 'right', corners: p.corners };
    p.corners = o.corners; p.others = [...p.others.filter((_, k) => k !== i).filter((x) => x.side !== back.side), back];
    p.seen = { ...(p.seen || {}), floorFrom: null, soffit: false };
    persist(); render(); return;
  }
  if (t.dataset.openHome || t.dataset.openHomeGet) {
    saveHomeDraft();
    const w = store.getWall(t.dataset.openHome || t.dataset.openHomeGet);
    if (w) { S.draft = upgradeDraft(clone(w)); S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; resetLayouts(); if (t.dataset.openHomeGet && w.chosen) S.openKey = w.chosen.layout.key; persist(); ensurePixels().then(() => { S.mem.clean = null; render(); }); go(t.dataset.openHomeGet && w.chosen ? '#/get' : '#/layouts'); }
    return;
  }
  if (t.dataset.homeRemove) {
    const h = myHome(); h.walls = h.walls.filter((x) => x !== t.dataset.homeRemove); h.planned = null; saveHome(h);
    if (S.draft && S.draft.id === t.dataset.homeRemove) S.draft.home = false;
    render(); return;
  }
  if (t.dataset.pick) {
    const q = S.quiz; const [x, y] = q.pair; const winner = x.id === t.dataset.pick ? x : y;
    q.picks.push({ winner, loser: winner === x ? y : x }); advanceQuiz(true); return;
  }
  if (t.dataset.open) {
    const w = store.getWall(t.dataset.open);
    if (w) { S.draft = upgradeDraft({ ...clone(w), id: store.newId(), from: w.from || w.id, base: w.base || w.name }); S.mem = { photo: null, flat: null, clean: null, cleanKey: null }; resetLayouts(); persist(); ensurePixels().then(() => { S.mem.clean = null; render(); }); go('#/wall'); }
    return;
  }
  if (t.dataset.onwall) {
    const id = t.dataset.onwall, it = byId.get(id), d = S.draft;
    const sizes = (it.record && it.record.sizes) || it.sizes || [];
    const pick = sizes.length ? [...sizes].sort((a, b) => a.w * a.h - b.w * b.h)[Math.floor((sizes.length - 1) / 2)] : null;
    if (!pick) { S.flash = 'That print has no size listed yet.'; render(); return; }
    const prev = clone(d.kept || []);
    d.kept = [...prev.filter((k) => k.id !== id), { id, w: pick.w, h: pick.h }];
    d.chosen = null;
    rebuild('onwall', { label: 'Kept in every wall.', run: () => { d.kept = prev; persist(); } });
    go('#/wall'); return;
  }
  if (t.dataset.wallcard) { S.sheet = { wall: t.dataset.wallcard }; S.ui.confirmDelete = null; render(); return; }
  if (t.dataset.pickwall) {
    const id = t.dataset.pickwall, p = S.ui.picking || [];
    S.ui.picking = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
    if (S.ui.picking.length === 2) { const [a, b] = S.ui.picking; S.ui.picking = null; go(`#/compare/${a}/${b}`); return; }
    render(); return;
  }
  if (t.dataset.askDelete) { S.ui.confirmDelete = t.dataset.askDelete; render(); return; }
  if (t.dataset.delete) {
    store.deleteWall(t.dataset.delete); S.sheet = null;
    if (S.draft && S.draft.id === t.dataset.delete) { S.draft = null; store.clearDraft(); }
    S.ui.confirmDelete = null; S.flash = store.demoMode ? 'Sample mode: nothing is deleted.' : 'Deleted, with its photo.'; render(); return;
  }
  if (S.edit && t.classList.contains('art')) return;
  if (t.classList.contains('art') && route()[0] === 'wall') { S.sheet = { piece: t.dataset.id }; S.selected = t.dataset.id; S.ui.allFor = null; S.ui.sheetStay = false; render(); return; }
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
    case 'stuff-add-art': { const list = myStuff(), x = { id: stuffId(), kind: 'art', title: `piece ${list.filter((y) => y.kind === 'art').length + 1}`, w: 16, h: 20, framed: true, color: '#8A8F94' }; list.push(x); saveStuff(list); syncStuff(x, fromOneWall()); render(); break; }
    case 'stuff-add-frame': { const list = myStuff(); list.push({ id: stuffId(), kind: 'frame', w: 11, h: 14, color: 'black' }); saveStuff(list); render(); break; }
    case 'browse-clear': { const f = S.ui.browse; if (f) { Object.assign(f, { theme: '', color: '', mood: '', shape: '', kind: '', price: '', n: BROWSE_PAGE }); render(); } break; }
    case 'browse-more': { const f = S.ui.browse; if (f) { f.n += BROWSE_PAGE; render(); } break; }
    case 'reset-taste': {
      // The taste test from scratch: your picks, the pairs you've seen, and the swaps that
      // taught it. Favorites stay saved. With Undo.
      const d = S.draft, me = store.loadMe(), q = S.quiz;
      // Picks made in a test that's still open count too, so Undo brings them back as taste.
      const open = q ? q.picks : d.quizState ? picksOf(d.quizState.picks) : [];
      const all = open.length ? [...(q ? q.prior || [] : yourPicks()), ...open].slice(-60) : null;
      const before = all ? { source: 'yours', weights: fitTaste(all), picks: all.map((x) => [x.winner.id, x.loser.id]) } : d.taste;
      const was = { taste: before, skipped: d.skipped, seen: me.quizSeen };
      d.taste = { source: 'none', weights: null, picks: [] }; d.skipped = []; d.quizState = null;
      me.quizSeen = []; store.saveMe(me); S.quiz = null;
      S.openKey = null; S.stepBase = null; S.flash = null; S.selected = null; if (S.view) S.view.rankKey = null;
      S.undo = { label: 'Taste test reset.', run: () => { d.taste = was.taste; d.skipped = was.skipped; const m = store.loadMe(); m.quizSeen = was.seen || []; store.saveMe(m); persist(); } };
      persist();
      if (route()[0] === 'taste') { go('#/layouts'); break; }
      S.sheet = 'change'; S.ui.sheetStay = true; S.focusAfter = '[data-act="undo"]'; render();
      break;
    }
    case 'reset-prefs': {
      const d = S.draft, keys = ['style', 'pieces', 'fullness', 'art', 'justMine', 'tone', 'budget'];
      const was = Object.fromEntries(keys.map((k) => [k, d[k]]));
      Object.assign(d, { style: null, pieces: null, fullness: 'balanced', art: 'both', justMine: false, tone: null, budget: null });
      if (keys.every((k) => was[k] === d[k] || (was[k] == null && d[k] == null))) break;
      S.openKey = null; S.stepBase = null; S.flash = null; S.selected = null;
      S.undo = { label: 'Preferences reset.', shape: true, run: () => { Object.assign(d, was); persist(); } };
      S.sheet = 'change'; S.ui.sheetStay = true; S.focusAfter = '[data-act="reset-prefs"]'; persist(); render();
      break;
    }
    case 'plan-home': planHome(); S.flash = 'Spread across your walls.'; render(); break;
    case 'signin-google': A.signing = true; A.err = null; render(); ACCT.signInGoogle(S.ui.afterSignIn || '#/me').catch((e) => { A.signing = false; A.err = e.message; render(); }); break;
    case 'signout': ACCT.signOut().then(() => { A.me = null; A.mine = null; A.saves = new Set(); A.cache.clear(); A.plan = { status: 'idle', err: null }; go('#/'); }).catch((e) => { S.flash = e.message; render(); }); break;
    // The full plan: a fake door for now. Unlock opens what it is; the yes is recorded.
    case 'unlock': {
      const from = t.dataset.from || '';
      S.ui.planFrom = from; S.ui.planBack = location.hash && !/^#\/plan/.test(location.hash) ? location.hash : '#/';
      S.sheet = null; S.selected = null;
      store.logEvent('plan-open', { from });
      go('#/plan');
      break;
    }
    case 'plan-signin': S.ui.afterSignIn = '#/plan'; go('#/signin'); break;
    case 'plan-yes': {
      if (!signedIn() || A.plan.status === 'saving') break;
      A.plan = { status: 'saving', err: null };
      store.logEvent('plan-yes', { from: S.ui.planFrom || '' });
      render();
      ACCT.wantPlan(S.ui.planFrom || 'plan', PLAN.price)
        .then(() => { A.plan = { status: 'on', err: null }; })
        .catch((e) => { A.plan = { status: 'error', err: e.message }; })
        .finally(() => { render(); const f = document.querySelector('.plan-done, .plan-page .error'); if (f) f.focus({ preventScroll: true }); });
      break;
    }
    case 'tab-walls': S.ui.savedTab = false; render(); break;
    case 'tab-saved': S.ui.savedTab = true; render(); break;
    case 'feed-retry': A.feed.status = 'idle'; render(); break;
    case 'feed-more': loadFeed(true); render(); break;
    case 'copy-wall-link': { const url = location.href; (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { S.ui.copied = 'wall'; render(); }).catch(() => { S.flash = url; render(); }); break; }
    case 'home-split': splitHomeBudget(); S.flash = 'Each wall has its share of the budget, by how wide it is.'; render(); break;
    case 'quiz-more': if (S.quiz) { S.quiz.check = false; saveQuiz(); render(); window.scrollTo({ top: 0 }); } break;
    case 'retry-save': persist(); if (!S.saveFailed) S.flash = 'Saved.'; render(); break;
    case 'change': S.sheet = 'change'; render(); break;
    case 'menu': S.sheet = 'menu'; render(); break;
    case 'crop-use': useCrop(false); break;
    case 'crop-whole': useCrop(true); break;
    case 'crop-cancel': S.crop = null; render(); break;
    case 'close-sheet': { const was = S.sheet; S.sheet = null; S.selected = null; render(); const back = was && was.piece ? document.querySelector(`[data-piece="${CSS.escape(was.piece)}"]`) : document.querySelector('[data-act="change"]'); if (back) back.focus({ preventScroll: true }); break; }
    case 'keep': {
      const id = t.dataset.id, prevKept = clone(S.draft.kept || []), prevChosen = S.draft.chosen ? clone(S.draft.chosen) : null, prevOpen = S.openKey;
      toggleKeep(id);
      const item = byId.get(id), on = (S.draft.kept || []).some((k) => k.id === id);
      S.openKey = S.draft.chosen ? S.draft.chosen.layout.key : null; S.flash = null; S.sheet = null; S.selected = null; S.focusAfter = '[data-act="undo"]';
      S.undo = { label: on ? 'Kept in every wall.' : 'Not kept.', run: () => { S.draft.kept = prevKept; S.draft.chosen = prevChosen; S.openKey = prevOpen || (prevChosen ? prevChosen.layout.key : null); persist(); } };
      render(); break;
    }
    case 'put-back': {
      const L = shown(), v = S.view;
      const orig = L && v.orig && v.orig[L.key];
      if (orig) { const now = L; replaceWall(L.key, orig); delete v.orig[L.key]; S.undo = { label: 'Put back.', run: () => replaceWall(now.key, now) }; persist(); }
      S.sheet = null; render(); break;
    }
    case 'more-walls': {
      S.busy = 'more'; S.ui.noMore = false; render();
      setTimeout(() => { try { moreWalls(); } finally { S.busy = null; render(); } }, 30);
      break;
    }
    case 'not-for-me': notForThis(t.dataset.id); S.sheet = null; S.selected = null; S.focusAfter = '[data-act="undo"]'; render(); { const u = document.querySelector('[data-act="undo"]'); if (u) u.focus({ preventScroll: true }); } break;
    case 'show-again': { const m = store.loadMe(); m.disliked = m.disliked.filter((x) => x !== t.dataset.id); store.saveMe(m); if (S.view) S.view.rankKey = null; render(); } break;
    case 'remove': removeFrame(t.dataset.id); S.sheet = null; S.selected = null; S.focusAfter = '[data-act="undo"]'; render(); { const u = document.querySelector('[data-act="undo"]'); if (u) u.focus({ preventScroll: true }); } break;
    case 'new-art': newArt(); S.sheet = null; S.selected = null; render(); { const u = document.querySelector('[data-act="undo"]'); if (u) u.focus({ preventScroll: true }); } break;
    case 'compare': {
      const all = store.listWalls();
      if (all.length === 2) { go(`#/compare/${all[0].id}/${all[1].id}`); break; }
      S.ui.picking = []; render(); break;
    }
    case 'compare-cancel': S.ui.picking = null; render(); break;
    case 'all-choices': S.ui.allFor = S.ui.allFor === t.dataset.id ? null : t.dataset.id; S.ui.sheetStay = true; render(); break;
    case 'swap': {
      const id = t.dataset.id; S.flash = null;
      S.busy = `swap:${id}`; render();
      setTimeout(() => { try { swapPiece(id); } finally { S.busy = null; S.sheet = null; S.selected = null; render(); const u = document.querySelector('[data-act="undo"]') || document.querySelector('#drawing-wrap'); if (u) u.focus({ preventScroll: true }); } }, 30);
      break;
    }
    case 'undo': if (S.undo) { const u = S.undo; u.run(); S.undo = u.prev || null; S.flash = null; render(); } break;
    case 'edit': S.edit = !S.edit; S.sheet = null; S.selected = null; S.flash = null; if (S.edit) S.measure = true; render(); break;
    case 'measure': S.measure = !S.measure; S.sheet = null; render(); break;
    case 'undo-move': case 'undo-all': { const L = shown(); if (L) undoMove(L, a === 'undo-all'); S.sheet = null; S.flash = null; render(); break; }
    case 'retry': resetLayouts(); S.mem.clean = null; render(); break;
    case 'save': saveThisWall(); render(); break;
    case 'get': { const L = shown(); S.draft.chosen = { layout: bareLayout(L), inputKey: viewKey() }; persist(); go(L.pieces.some((p) => p.ref.source === 'catalog') ? '#/frames' : '#/hang'); break; }
    case 'to-get': go('#/get'); break;
    case 'hung': { const L = shown(); if (L) { S.draft.hung = { key: L.key, photo: null }; persist(); render(); const h = document.querySelector('#done-h'); if (h) h.scrollIntoView({ block: 'start' }); } break; }
    case 'unhung': S.draft.hung = null; persist(); render(); break;
    case 'print': window.print(); break;
    case 'copy-ai': {
      if (locked()) break;
      const L = shown(); if (!L) break;
      const text = wallQuestion(L);
      const done = (ok) => { S.ui.copied = ok ? 'ok' : 'no'; render(); const b = document.querySelector('[data-act="copy-ai"]'); if (b) b.focus({ preventScroll: true }); };
      const old = () => { try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(old()));
      else done(old());
      break;
    }
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
// An image that doesn't load says so, instead of leaving a blank box.
document.addEventListener('error', (e) => {
  const img = e.target;
  // On the drawing, a print that doesn't load leaves its title on the paper or mat under it.
  if (img instanceof SVGImageElement) { img.remove(); return; }
  if (!(img instanceof HTMLImageElement)) return;
  // A taped thumbnail's corners are its tape, so its title goes in as text, not as ::after.
  const tn = img.closest('.tn');
  if (tn) { tn.classList.add('tn-gone'); const t = document.createElement('span'); t.className = 'tn-title'; t.textContent = img.alt || img.dataset.title || (tn.offsetWidth >= 60 ? 'No image' : ''); img.replaceWith(t); return; }
  const box = img.closest('.thumb, .art-big, .pick-art');
  if (box) { box.classList.add('is-missing'); if (img.alt) box.dataset.missing = img.alt; img.remove(); }
}, true);
// iOS needs a touch listener for :active press states.
document.addEventListener('touchstart', () => {}, { passive: true });

// Open where they left off: pixels for a saved photo load in the background.
ensurePixels().then(() => { S.mem.clean = null; if (['layouts', 'wall', 'get'].includes(route()[0])) render(); }).catch(() => {});
render();

