// Walldrobe layout engine.
//
// layout(input) takes one wall, what's on it, the art the person owns and a list
// of candidate art, and returns ranked layouts with every piece's position in
// inches and one sentence on why it's there. Each layout is judged as a whole:
// fit, taste, color (theory.js) and design (design.js). refill() keeps a layout's
// frames where they are and changes the art in them. Pure: no DOM, no network,
// no clock. Same input, same output. Spec: ENGINE.md.

import { RULES, WEIGHTS, SEARCH, FAMILIES, STANDARD, STYLES } from './constants.js';
import { hexToRgb, normalizePalette, paletteSimilarity } from './color.js';
import { blockedRegions, findZones, placeGroup, checkPieces, clamp01, cmpStr, q, EPS } from './geometry.js';
import { salonStructures, lineStructures, gridStructures, statementStructures, columnStructures, columnZone, offeredSizes } from './structures.js';
import { flowStructures, openSpace } from './flow.js';
import { pieceReason, leftReason, summary, shortTitle, layoutNotes } from './reasons.js';
import { profileFromPalette, colorScore } from './theory.js';
import { designScore, lookalike, lookPenalty } from './design.js';

export { RULES, WEIGHTS } from './constants.js';
export const VERSION = '0.2.0';

const KEEPS = new Set(['must', 'happy', 'dontcare']);
const REUSE_BONUS = 0.04;
const SAME_ARTIST = 0.02;
// A layout beside the TV or furniture is shown among the first ones when it scores at least this share of the best.
const PLACE_SHOW = 0.85;
const LOOKALIKE_PAIR = 0.04; // off the total for each pair of pieces that look almost the same
const LOOK_PICK = 0.25;      // how hard the fast pick steers away from look-alikes
const QUALITY_PICK = 0.15;   // how much a reviewed quality score (0 to 1) leans the pick toward stronger photos
const OWNED_PICK_BONUS = { happy: 0.15, dontcare: 0.05 };
const ROOM = '\u0000room';
const sizeKey = (w, h) => `${w}x${h}`;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const titleOf = (p) => (p.title && String(p.title).trim()) || 'piece';
const idList = (v, name) => {
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new TypeError(`${name} should be a list of ids.`);
  return v;
};

// ---------- Input checks ----------

function checkPalette(palette, id) {
  if (palette == null) return;
  if (!Array.isArray(palette)) throw new TypeError(`Palette for ${id} should be a list of { hex, weight }.`);
  for (const c of palette) {
    try { hexToRgb(c && c.hex); } catch { throw new TypeError(`Palette for ${id} has a color that isn't a hex value: ${c && c.hex}.`); }
  }
}

function validate(input) {
  if (!input || typeof input !== 'object') throw new TypeError('layout() needs an input object.');
  const { wall } = input;
  if (!wall || !num(wall.width) || !num(wall.height) || wall.width <= 0 || wall.height <= 0) {
    throw new TypeError('wall needs a positive width and height in inches.');
  }
  for (const o of input.obstacles || []) {
    if (!o || !o.id || !o.kind || ![o.x, o.y, o.w, o.h].every(num)) throw new TypeError(`Obstacle ${(o && o.id) || '(no id)'} needs id, kind, x, y, w and h.`);
    if (o.w <= 0 || o.h <= 0) throw new TypeError(`Obstacle ${o.id} needs a positive width and height.`);
  }
  const ids = new Set();
  for (const p of input.owned || []) {
    if (!p || !p.id || !num(p.w) || !num(p.h) || p.w <= 0 || p.h <= 0) throw new TypeError(`Owned piece ${(p && p.id) || '(no id)'} needs id, w and h.`);
    if (!KEEPS.has(p.keep)) throw new TypeError(`Owned piece ${p.id} needs keep set to must, happy or dontcare.`);
    if (p.pinned && (!p.at || !num(p.at.x) || !num(p.at.y))) throw new TypeError(`Pinned piece ${p.id} needs its current position in at.`);
    if (ids.has(p.id)) throw new TypeError(`Duplicate id ${p.id}.`);
    checkPalette(p.palette, p.id);
    ids.add(p.id);
  }
  const catIds = new Set();
  for (const c of input.catalog || []) {
    if (!c || !c.id || !Array.isArray(c.sizes)) throw new TypeError(`Catalog piece ${(c && c.id) || '(no id)'} needs an id and sizes.`);
    if (ids.has(c.id)) throw new TypeError(`Duplicate id ${c.id}.`);
    checkPalette(c.palette, c.id);
    ids.add(c.id); catIds.add(c.id);
  }
  if (input.room) checkPalette(input.room.palette, 'the room');
  if (input.keep != null) {
    if (!Array.isArray(input.keep)) throw new TypeError('keep should be a list of { id, w, h }.');
    const seen = new Set();
    for (const k of input.keep) {
      if (!k || !catIds.has(k.id)) throw new TypeError(`Kept piece ${(k && k.id) || '(no id)'} isn't in the catalog.`);
      if (!num(k.w) || !num(k.h) || k.w <= 0 || k.h <= 0) throw new TypeError(`Kept piece ${k.id} needs the frame size it hangs in, w and h.`);
      if (seen.has(k.id)) throw new TypeError(`Kept piece ${k.id} is listed twice.`);
      seen.add(k.id);
    }
  }
  idList(input.exclude, 'exclude');
  idList(input.avoid, 'avoid');
}

function readPrefs(raw = {}) {
  return {
    budget: num(raw.budget) && raw.budget >= 0 ? raw.budget : null,
    maxPieces: num(raw.maxPieces) && raw.maxPieces >= 1 ? Math.floor(raw.maxPieces) : 9,
    families: STYLES[raw.style] ? [...STYLES[raw.style]] : Array.isArray(raw.families) ? raw.families.filter((f) => FAMILIES.includes(f)) : [...FAMILIES],
    style: STYLES[raw.style] ? raw.style : null,
    // An exact number of pieces, when the person picks one.
    pieces: num(raw.pieces) && raw.pieces >= 1 ? Math.min(RULES.maxCount, Math.floor(raw.pieces)) : null,
    // Where on the wall: 'over' the TV or furniture, 'left' or 'right' of it, or null for anywhere.
    place: typeof raw.place === 'string' ? raw.place : null,
    // The size lever: -1 fewer, bigger pieces; 1 more, smaller ones; null leaves it to the other scores.
    scale: num(raw.scale) && raw.scale !== 0 ? Math.max(-1, Math.min(1, raw.scale)) : null,
  };
}

const validProfile = (p) => p && p.shares && Array.isArray(p.hues) && p.hues.length === 12 && num(p.chromatic) && p.value && num(p.weight);

// Everything layout() and refill() share: the zone, colors, profiles and candidates.
function prepare(input) {
  validate(input);
  const wall = input.wall;
  const obstacles = input.obstacles || [];
  const owned = input.owned || [];
  const catalog = input.catalog || [];
  const taste = input.taste || {};
  const exclude = new Set(idList(input.exclude, 'exclude'));
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const tasteOf = (id) => (num(taste[id]) ? clamp01(taste[id]) : 0.5);

  const kept = (input.keep || []).map((k) => {
    const c = byId.get(k.id);
    return { id: c.id, w: k.w, h: k.h, keep: 'must', kept: true, title: titleOf(c), cat: c, taste: tasteOf(c.id) };
  });
  const keptIds = new Set(kept.map((k) => k.id));

  const pinned = owned.filter((p) => p.pinned);
  const loose = owned.filter((p) => !p.pinned);
  const regions = blockedRegions(obstacles, pinned);
  const zones = findZones(wall, obstacles, regions);
  const zone = zones[0] || null;
  const space = openSpace(wall, regions);

  const palettes = new Map();
  for (const p of owned) palettes.set(p.id, normalizePalette(p.palette));
  for (const c of catalog) palettes.set(c.id, normalizePalette(c.palette));
  const room = normalizePalette(input.room && input.room.palette);
  if (room.length) palettes.set(ROOM, room);
  const hasRoom = room.length > 0;
  const pairSim = pairSimFactory(palettes);

  const profiles = new Map();
  for (const p of owned) profiles.set(p.id, profileFromPalette(palettes.get(p.id)));
  for (const c of catalog) {
    profiles.set(c.id, validProfile(c.profile) ? c.profile : profileFromPalette(palettes.get(c.id), {
      weight: num(c.weight) && c.weight >= 0 && c.weight <= 1 ? c.weight : undefined, category: c.category, theme: c.theme,
    }));
  }

  const catalogCands = catalog.filter((c) => !exclude.has(c.id) && !keptIds.has(c.id)).map((c) => ({
    id: c.id, source: 'catalog', title: c.title, artist: c.artist || null, item: c,
    sizes: c.sizes.filter((s) => s && num(s.w) && num(s.h) && s.w > 0 && s.h > 0),
    taste: num(c.quality) ? (1 - QUALITY_PICK) * tasteOf(c.id) + QUALITY_PICK * clamp01(c.quality) : tasteOf(c.id),
  }));

  return {
    input, wall, obstacles, owned, catalog, prefs: readPrefs(input.prefs), exclude, kept, keptIds,
    pinned, loose, regions, zone, zones, space, palettes, hasRoom, pairSim, profiles,
    roomProfile: hasRoom ? profileFromPalette(room) : null,
    catalogCands, ownedById: new Map(owned.map((p) => [p.id, p])), catalogById: byId, tasteOf,
    look: lookFactory(profiles),
  };
}

// Palette similarity is the slow part (CIEDE2000), so results are remembered across
// calls by the palettes' colors. Same colors, same answer, so this stays pure.
const SIM_CACHE = new Map();
const SIM_CACHE_MAX = 400000;
function pairSimFactory(palettes) {
  const sig = new Map();
  for (const [id, pal] of palettes) sig.set(id, pal.map((c) => `${c.hex}:${c.weight.toFixed(4)}`).join(','));
  return (a, b) => {
    const sa = sig.get(a) || '', sb = sig.get(b) || '';
    const k = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
    let v = SIM_CACHE.get(k);
    if (v === undefined) {
      v = paletteSimilarity(palettes.get(a) || [], palettes.get(b) || []);
      if (SIM_CACHE.size >= SIM_CACHE_MAX) SIM_CACHE.clear();
      SIM_CACHE.set(k, v);
    }
    return v;
  };
}

// Look-alike penalty between two pieces by id (the room and unknown ids are never look-alikes).
function lookFactory(profiles) {
  const memo = new Map();
  return (a, b) => {
    const pa = profiles.get(a), pb = profiles.get(b);
    if (!pa || !pb) return 0;
    const k = a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
    let v = memo.get(k);
    if (v === undefined) { v = lookPenalty(lookalike(pa, pb)); memo.set(k, v); }
    return v;
  };
}

const ownedCand = (p) => ({
  id: p.id, source: 'owned', title: titleOf(p), artist: null, item: p,
  sizes: [{ w: p.w, h: p.h, price: 0 }], taste: p.keep === 'happy' ? 0.75 : 0.5,
});

// ---------- Filling slots ----------

// Candidates by exact frame size, best taste first, capped so big catalogs stay fast.
function indexCandidates(cands) {
  const bySize = new Map();
  for (const c of cands) {
    if (c.source !== 'catalog') continue;
    for (const s of c.sizes) {
      const k = sizeKey(s.w, s.h);
      if (!bySize.has(k)) bySize.set(k, []);
      bySize.get(k).push({ cand: c, size: s });
    }
  }
  for (const [k, list] of bySize) {
    list.sort((a, b) => b.cand.taste - a.cand.taste || cmpStr(a.cand.id, b.cand.id));
    bySize.set(k, list.slice(0, SEARCH.perSize));
  }
  const owned = cands.filter((c) => c.source === 'owned');
  return { bySize, owned };
}

function optionsFor(index, slot) {
  const out = [...(index.bySize.get(sizeKey(slot.w, slot.h)) || [])];
  for (const c of index.owned) {
    const s = c.sizes[0];
    if (Math.abs(s.w - slot.w) <= 1 && Math.abs(s.h - slot.h) <= 1) out.push({ cand: c, size: s });
  }
  return out;
}

// How good a pick is before the whole wall is judged: 0.6 x taste + 0.4 x how well
// its colors sit with the other pieces, plus an edge for pieces the person owns.
// Pieces that look almost the same as one already chosen are pushed down.
function pickValue(cand, ctxIds, pairSim, look) {
  const h = ctxIds.length ? ctxIds.reduce((s, id) => s + pairSim(cand.id, id), 0) / ctxIds.length : 0.5;
  let v = 0.6 * cand.taste + 0.4 * h;
  if (look) v -= LOOK_PICK * ctxIds.reduce((m, id) => Math.max(m, look(cand.id, id)), 0);
  if (cand.source === 'owned') v += OWNED_PICK_BONUS[cand.item.keep] || 0;
  return v;
}

// A small beam search over the open slots, biggest first.
function fill(struct, index, pairSim, hasRoom, banned, look) {
  const open = struct.slots
    .map((s, i) => ({ ...s, i }))
    .filter((s) => !s.fixed)
    .sort((a, b) => b.w * b.h - a.w * a.h
      || Math.abs(a.dx + a.w / 2 - struct.W / 2) - Math.abs(b.dx + b.w / 2 - struct.W / 2)
      || a.i - b.i);
  const fixedIds = struct.slots.filter((s) => s.fixed).map((s) => s.fixed.id);
  let beam = [{ picks: [], used: new Set(), artists: new Set(), value: 0, key: '' }];
  for (const slot of open) {
    const opts = optionsFor(index, slot).filter((o) => !(banned && banned.has(o.cand.id)));
    if (!opts.length) return null;
    const next = [];
    for (const st of beam) {
      const ctx = [...fixedIds, ...st.picks.map((p) => p.cand.id)];
      if (hasRoom) ctx.push(ROOM);
      for (const { cand, size } of opts) {
        if (st.used.has(cand.id)) continue;
        let v = pickValue(cand, ctx, pairSim, look);
        if (cand.artist && st.artists.has(cand.artist)) v -= 0.1;
        next.push({ parent: st, pick: { slot, cand, size }, value: st.value + v, key: `${st.key},${cand.id}` });
      }
    }
    if (!next.length) return null;
    next.sort((a, b) => b.value - a.value || cmpStr(a.key, b.key));
    beam = next.slice(0, open.length > 8 ? SEARCH.beam / 2 : SEARCH.beam).map((n) => {
      const used = new Set(n.parent.used); used.add(n.pick.cand.id);
      const artists = new Set(n.parent.artists); if (n.pick.cand.artist) artists.add(n.pick.cand.artist);
      return { picks: [...n.parent.picks, n.pick], used, artists, value: n.value, key: n.key };
    });
  }
  return beam[0];
}

const catalogExtra = (c) => ({ artist: c.artist || null, year: c.year || null, collection: c.source || null, url: c.url || null, image: c.image || null });
const priceOf = (c, w, h) => {
  const s = (c.sizes || []).find((z) => z.w === w && z.h === h);
  return s && num(s.price) ? s.price : null;
};

// Every slot gets its piece, centered in the slot, on the quarter inch.
function buildPieces(st, place, bySlot) {
  return st.slots.map((slot, i) => {
    let ref, title, w, h, price, extra = {}, keep = null, pickTaste = null, drop = null, kept = false, artist = null;
    if (slot.fixed && slot.fixed.cat) {
      // A catalog piece that stays: kept by the person, or not being changed by refill().
      const p = slot.fixed, c = p.cat;
      ref = { source: 'catalog', id: c.id }; title = titleOf(c); w = p.w; h = p.h; price = priceOf(c, w, h);
      extra = catalogExtra(c); pickTaste = p.taste; kept = !!p.kept; keep = p.kept ? 'must' : null; artist = c.artist || null;
    } else if (slot.fixed) {
      const p = slot.fixed;
      ref = { source: 'owned', id: p.id }; title = titleOf(p); w = p.w; h = p.h; price = 0; keep = p.keep; drop = p.drop;
    } else {
      const { cand: c, size } = bySlot.get(i);
      ref = { source: c.source, id: c.id }; title = c.title; w = size.w; h = size.h; pickTaste = c.taste;
      if (c.source === 'catalog') { price = num(size.price) ? size.price : null; extra = catalogExtra(c.item); artist = c.artist; }
      else { price = 0; keep = c.item.keep; drop = c.item.drop; }
    }
    const x = q(place.x + slot.dx + (slot.w - w) / 2);
    const y = q(place.y + slot.dy + (slot.h - h) / 2);
    return {
      id: ref.id, ref, title, w, h, x, y, cx: x + w / 2, cy: y + h / 2, row: slot.row, role: slot.role || 'fill', side: slot.side || null,
      fixed: !!slot.fixed, keep, kept, price, taste: pickTaste, drop, artistName: artist, ...extra,
      slot: { x: q(place.x + slot.dx), y: q(place.y + slot.dy), w: slot.w, h: slot.h },
    };
  });
}

// ---------- Judging a whole wall ----------

// A free-form layout's own zone: the whole open wall.
function flowZone(ctx, g) {
  return { type: 'flow', place: 'flow', anchor: null, base: null, cx: g.x + g.w / 2, refW: ctx.wall.width, target: ctx.wall.width * RULES.wallRatio, ratio: RULES.wallRatio, range: RULES.wallRange, interval: { x0: RULES.edge, x1: ctx.wall.width - RULES.edge, w: ctx.wall.width - 2 * RULES.edge }, maxH: ctx.wall.height, space: ctx.space };
}

// Free-form: how much of the open wall it uses, how tight the group is, whether
// it sits near eye level, and pieces you keep near its middle.
function flowFit(L, zone) {
  const g = L.group;
  const area = L.pieces.reduce((s, p) => s + p.w * p.h, 0);
  const fc = clamp01(area / Math.max(1, zone.space.area) / 0.3);
  const fd = clamp01((area / (g.w * g.h) - 0.35) / 0.35);
  const cy = L.pieces.reduce((s, p) => s + (p.y + p.h / 2) * p.w * p.h, 0) / area;
  const fv = clamp01(1 - Math.max(0, Math.abs(cy - RULES.centerline - 3) - 6) / 18);
  const gcx = g.x + g.w / 2;
  const musts = L.pieces.filter((p) => p.keep === 'must' && p.fixed);
  const fm = musts.length ? clamp01(1 - musts.reduce((s, p) => s + Math.abs(p.cx - gcx) / (g.w / 2), 0) / musts.length) : 1;
  return 0.35 * fc + 0.3 * fd + 0.25 * fv + 0.1 * fm;
}

function fitScore(L, zone) {
  if (zone.type === 'flow') return flowFit(L, zone);
  const g = L.group;
  const ratio = g.w / zone.refW;
  const target = zone.ratio;
  const fw = clamp01(1 - Math.abs(ratio - target) / 0.3);
  const cy = g.y + g.h / 2;
  let fv;
  if (zone.type === 'anchor') {
    const c = g.y - zone.base;
    const high = cy > RULES.centerlineSoftMax ? clamp01(1 - (cy - RULES.centerlineSoftMax) / 12) : 1;
    fv = Math.min(clamp01(1 - Math.abs(c - RULES.clearance) / 10), high);
  } else {
    const d = cy < RULES.centerline ? RULES.centerline - cy : cy > RULES.centerlineMax ? cy - RULES.centerlineMax : 0;
    fv = clamp01(1 - d / 10);
  }
  const fs = clamp01(1 - L.shift / 18);
  const gapsOk = L.meta.gaps.every((x) => x >= RULES.gapMin - EPS && x <= RULES.gapMax + EPS) ? 1 : 0.6;
  const fg = gapsOk * clamp01(1 - (L.meta.ragged || 0) / (0.15 * g.w));
  const area = L.pieces.reduce((s, p) => s + p.w * p.h, 0);
  const fd = L.pieces.length === 1 ? 1 : clamp01((area / (g.w * g.h) - 0.5) / 0.3);
  // Presence: a group much shorter than its width looks thin over furniture.
  const fp = clamp01(g.h / (0.45 * zone.target));
  // Pieces you must keep should sit near the middle, not drift to an edge.
  const gcx = g.x + g.w / 2;
  const musts = L.pieces.filter((p) => p.keep === 'must' && p.fixed);
  const fm = musts.length ? clamp01(1 - musts.reduce((s, p) => s + Math.abs(p.cx - gcx) / (g.w / 2), 0) / musts.length) : 1;
  return 0.25 * fw + 0.2 * fv + 0.1 * fs + 0.1 * fg + 0.1 * fd + 0.15 * fp + 0.1 * fm;
}

// Where a wall sits between one big piece (0) and many small ones (1): mostly the
// count, partly the average frame size (8 x 10 in is small, 30 x 40 in is big).
const SIZE_WEIGHT = 0.12;
function sizeFit(pieces, scale) {
  const n = pieces.length;
  const mean = pieces.reduce((s, p) => s + p.w * p.h, 0) / n;
  const count = clamp01((n - 1) / 7);
  const small = 1 - clamp01((Math.log(mean) - Math.log(80)) / (Math.log(1200) - Math.log(80)));
  const s = 0.7 * count + 0.3 * small;
  return clamp01(1 - Math.abs(s - (scale + 1) / 2) * 1.4);
}

function judge(L, ctx) {
  const fit = fitScore(L, ctx.zone);
  // Taste covers every piece that was chosen from art, kept or new, but not the ones you own and fixed.
  const chosen = L.pieces.filter((p) => p.ref.source === 'catalog' || !p.fixed);
  const taste = chosen.length ? chosen.reduce((s, p) => s + (p.taste ?? 0.5), 0) / chosen.length : 0.7;

  const P = L.pieces.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, role: p.role, area: p.w * p.h, profile: ctx.profiles.get(p.ref.id) }));
  const d = designScore(P, L.group, L.family);
  let room = null;
  if (ctx.hasRoom) {
    const A = P.reduce((s, p) => s + p.area, 0);
    const sim = L.pieces.reduce((s, p) => s + p.w * p.h * ctx.pairSim(p.ref.id, ROOM), 0) / A;
    room = { profile: ctx.roomProfile, sim };
  }
  const c = colorScore(P, d.focalIdx, room);

  const artists = L.pieces.map((p) => p.artistName).filter(Boolean);
  const dupArtists = artists.length - new Set(artists).size;
  // Using what you already own is the point: a small bonus for each happy-to-move piece on the wall.
  const happyUsed = L.pieces.filter((p) => p.keep === 'happy').length;
  const reuse = L.happyTotal ? REUSE_BONUS * (happyUsed / L.happyTotal) : 0;
  const parts = { fit, taste, color: c.score, design: d.score };
  // How close the wall is to the size lever, when it's set.
  const checks = { ...c.checks, ...d.checks };
  let size = 0;
  if (ctx.prefs.scale !== null) {
    checks.size = sizeFit(L.pieces, ctx.prefs.scale);
    size = SIZE_WEIGHT * checks.size;
  }
  const score = WEIGHTS.fit * fit + WEIGHTS.taste * taste + WEIGHTS.color * c.score + WEIGHTS.design * d.score + reuse - SAME_ARTIST * dupArtists - LOOKALIKE_PAIR * d.alike.length;
  return { score: score + size, parts, checks, color: c, design: d };
}

// Try the best few alternatives in each open slot and keep a swap when the whole
// wall scores higher. Frames and positions don't change.
function improve(R, ctx, banned) {
  let best = R;
  const open = R.st.slots.map((s, i) => ({ s, i })).filter(({ s }) => !s.fixed)
    .sort((a, b) => b.s.w * b.s.h - a.s.w * a.s.h || a.i - b.i);
  // Big walls get a lighter pass, so they stay quick.
  const big = open.length > 8;
  for (let pass = 0; pass < (big ? 1 : SEARCH.passes); pass++) {
    let changed = false;
    for (const { s, i } of open) {
      const current = best.bySlot.get(i).cand.id;
      const onWall = new Set(best.pieces.map((p) => p.ref.id));
      const others = best.pieces.filter((p) => p.ref.id !== current).map((p) => p.ref.id);
      if (ctx.hasRoom) others.push(ROOM);
      const alts = optionsFor(R.index, s)
        .filter((o) => !onWall.has(o.cand.id) && !(banned && banned.has(o.cand.id)))
        .map((o) => ({ o, v: pickValue(o.cand, others, ctx.pairSim, ctx.look) }))
        .sort((a, b) => b.v - a.v || cmpStr(a.o.cand.id, b.o.cand.id))
        .slice(0, big ? SEARCH.alternatives / 2 : SEARCH.alternatives);
      for (const { o } of alts) {
        const bySlot = new Map(best.bySlot); bySlot.set(i, o);
        const pieces = buildPieces(R.st, best.group, bySlot);
        if (o.cand.source === 'owned' && checkPieces(pieces, ctx.regions, ctx.wall).length) continue;
        const L = { ...best, pieces, bySlot };
        const j = judge(L, ctx);
        if (j.score > best.score + 1e-6) { best = { ...L, ...j }; changed = true; }
      }
    }
    if (!changed) break;
  }
  return best;
}

// The same arrangement, filled again without some pieces.
function redo(L, banned, ctx) {
  const picked = fill(L.st, L.index, ctx.pairSim, ctx.hasRoom, banned, ctx.look);
  if (!picked) return null;
  const bySlot = new Map(picked.picks.map((p) => [p.slot.i, p]));
  const done = place(L.st, bySlot, L.group, ctx);
  if (!done) return null;
  const R = { ...L, pieces: done.pieces, group: done.where, shift: done.where.shift, bySlot };
  return improve({ ...R, ...judge(R, ctx) }, ctx, banned);
}

// Beside the TV is another place from over it, so the same frames there are another layout.
const placeKey = (z, key) => (z.place === 'left' || z.place === 'right' ? `${z.place}|${key}` : key);

// A layout's identity is its arrangement: family, frame sizes and where they go.
function structureKey(st) {
  const slots = st.slots.map((s) => `${q(s.dx)},${q(s.dy)},${s.w}x${s.h}`).sort(cmpStr).join(';');
  return `${st.family}|${st.variant || ''}|${q(st.W)}x${q(st.H)}|${slots}`;
}

function place(st, pickedBySlot, base, ctx) {
  let where = base, pieces = buildPieces(st, base, pickedBySlot);
  // Positions are on the quarter inch before the hard checks, so what passes is what's printed.
  for (const dx of [0.25, -0.25]) {
    if (!checkPieces(pieces, ctx.regions, ctx.wall).length) break;
    where = { ...base, x: base.x + dx, shift: Math.abs(base.x + dx + st.W / 2 - ctx.zone.cx) };
    pieces = buildPieces(st, where, pickedBySlot);
  }
  if (checkPieces(pieces, ctx.regions, ctx.wall).length) return null;
  return { where, pieces };
}

// ---------- Main ----------

function structuresFor(fam, sctx) {
  if (fam === 'salon') return { structures: salonStructures(sctx) };
  if (fam === 'line') return { structures: lineStructures(sctx) };
  if (fam === 'grid') return gridStructures(sctx);
  if (fam === 'column') return columnStructures(sctx);
  return statementStructures(sctx);
}

/**
 * @param {object} input see ENGINE.md
 * @returns {{ layouts: object[], problems: {code: string, message: string}[], zone: object|null }}
 */
export function layout(input) {
  const ctx = prepare(input);
  const { prefs, loose, kept } = ctx;
  // The places to try: the one asked for, or all of them.
  // The places to try for the set shapes: the one asked for, or the main one. Free-form
  // layouts look at the whole open wall on their own.
  const asked = prefs.place ? ctx.zones.filter((z) => z.place === prefs.place) : [];
  const zones = asked.length ? asked : ctx.zones.slice(0, 1);
  const zone = zones[0] || null;
  const count = num(input.count) && input.count >= 1 ? Math.floor(input.count) : 3;
  const avoid = new Set(idList(input.avoid, 'avoid'));
  const problems = [];

  const must = [...loose.filter((p) => p.keep === 'must'), ...kept];
  const happy = loose.filter((p) => p.keep === 'happy');
  if (!zone && !(prefs.families.includes('flow') && ctx.space.area >= 150)) {
    const short = ctx.wall.height - RULES.ceilingHard - RULES.centerline < 4;
    problems.push({
      code: 'NO_OPEN_SPACE',
      message: short ? 'This wall is too short to hang art at eye level.' : "There's no stretch of wall wide enough to hang on.",
    });
    return { layouts: [], problems, zone: null, zones: [], counts: [] };
  }

  const variants = happy.length ? [[...must, ...happy], must] : [must];
  const counts = new Set();
  const mismatch = new Map(); // family -> number of variants it was skipped in, with its message
  const results = [];

  // Free-form layouts over all the open wall.
  if (prefs.families.includes('flow') && !asked.length) {
    // One pass with every piece you'd keep or move: one that doesn't fit is left out as it goes.
    for (const fixed of variants.slice(0, 1)) {
      const fixedIds = new Set(fixed.map((p) => p.id));
      const cands = [...ctx.catalogCands, ...loose.filter((p) => !fixedIds.has(p.id) && p.keep !== 'must').map(ownedCand)];
      const index = indexCandidates(cands);
      const avail = new Map();
      for (const [k, list] of index.bySize) avail.set(k, list.length);
      const os = offeredSizes(avail);
      const sizes = [...new Set([...os.salon, ...os.large].map(([w, h]) => sizeKey(w, h)))].map((k) => k.split('x').map(Number));
      const fr = flowStructures({ wall: ctx.wall, obstacles: ctx.obstacles, space: ctx.space, pinned: ctx.pinned, fixed, sizes, avail, pieces: prefs.pieces, style: prefs.style });
      for (const n of fr.counts) counts.add(n);
      for (const st of fr.structures) {
        const picked = fill(st, index, ctx.pairSim, ctx.hasRoom, null, ctx.look);
        if (!picked) continue;
        const base = { x: st.at.x, y: st.at.y, w: st.W, h: st.H, shift: 0 };
        const zc = { ...ctx, zone: flowZone(ctx, base) };
        const bySlot = new Map(picked.picks.map((p) => [p.slot.i, p]));
        const done = place(st, bySlot, base, zc);
        if (!done) continue;
        const L = {
          family: st.family, variant: st.variant || null, meta: st.meta, group: done.where, shift: 0,
          pieces: done.pieces, happyTotal: happy.length, st, index, bySlot, key: `${structureKey(st)}@${q(st.at.x)},${q(st.at.y)}`, zc,
        };
        results.push({ ...L, ...judge(L, zc) });
      }
    }
  }

  for (const z of zone ? zones : []) {
  const zc = { ...ctx, zone: z };
  for (const fixed of variants) {
    const fixedIds = new Set(fixed.map((p) => p.id));
    const cands = [...ctx.catalogCands, ...loose.filter((p) => !fixedIds.has(p.id) && p.keep !== 'must').map(ownedCand)];
    const index = indexCandidates(cands);
    const avail = new Map();
    for (const [k, list] of index.bySize) avail.set(k, list.length);
    for (const c of index.owned) for (const [w, h] of STANDARD) {
      if (Math.abs(c.sizes[0].w - w) <= 1 && Math.abs(c.sizes[0].h - h) <= 1) avail.set(sizeKey(w, h), (avail.get(sizeKey(w, h)) || 0) + 1);
    }
    const sctx = { fixed, zone: z, avail, maxPieces: prefs.maxPieces, scale: prefs.pieces ? 0 : prefs.scale || 0, pieces: prefs.pieces, sizes: offeredSizes(avail) };
    // Which piece counts this style can make on this wall, for the count control.
    if (fixed === variants[variants.length - 1]) {
      // Two-row hangs report every count they can make in one pass; the rest are quick to try.
      if (prefs.families.includes('salon')) salonStructures({ ...sctx, scale: 0, pieces: null, collect: counts });
      for (let n = 1; n <= RULES.maxCount; n++) {
        if (counts.has(n)) continue;
        const c = { ...sctx, scale: 0, pieces: n };
        if (prefs.families.some((fam) => fam !== 'salon' && fam !== 'flow' && structuresFor(fam, c).structures.length)) counts.add(n);
      }
    }

    const structs = [];
    for (const fam of prefs.families) {
      if (fam === 'flow') continue;
      const r = structuresFor(fam, sctx);
      structs.push(...r.structures);
      if (r.skipped) mismatch.set(fam, { n: (mismatch.get(fam)?.n || 0) + 1, message: r.skipped });
    }

    for (const st of structs) {
      const picked = fill(st, index, ctx.pairSim, ctx.hasRoom, null, ctx.look);
      if (!picked) continue;
      const base = placeGroup(z, st.W, st.H, ctx.regions, ctx.wall);
      if (!base) continue;
      const bySlot = new Map(picked.picks.map((p) => [p.slot.i, p]));
      const done = place(st, bySlot, base, zc);
      if (!done) continue;
      const L = {
        family: st.family, variant: st.variant || null, meta: st.meta, group: done.where, shift: done.where.shift,
        pieces: done.pieces, happyTotal: happy.length, st, index, bySlot, key: placeKey(z, structureKey(st)), zc,
      };
      results.push({ ...L, ...judge(L, zc) });
    }
  }
  }

  // The best few get the improvement pass, one per arrangement.
  const byKey = new Map();
  for (const R of results) if (!byKey.has(R.key) || R.score > byKey.get(R.key).score) byKey.set(R.key, R);
  let pool = [...byKey.values()].sort((a, b) => b.score - a.score || cmpStr(a.key, b.key));
  const fresh = pool.filter((R) => !avoid.has(R.key));
  if (avoid.size && pool.length && !fresh.length) {
    problems.push({ code: 'ALL_SHOWN', message: "That's every layout that fits this wall. Starting again from the best." });
  } else pool = fresh;
  // Improve the best of each family first, so variety survives, then the next best overall.
  const toImprove = [];
  const fams = new Set();
  for (const R of pool) if (!fams.has(R.family)) { fams.add(R.family); toImprove.push(R); }
  for (const R of pool) { if (toImprove.length >= SEARCH.improveTop) break; if (!toImprove.includes(R)) toImprove.push(R); }
  const improved = new Map(toImprove.map((R) => [R, improve(R, R.zc)]));
  let valid = pool.map((R) => improved.get(R) || R);

  // Budget: drop layouts over it, but say what the cheapest one costs.
  const total = (L) => L.pieces.reduce((s, p) => s + (p.price || 0), 0);
  if (prefs.budget !== null) {
    const all = valid;
    valid = all.filter((L) => total(L) <= prefs.budget + EPS);
    if (!valid.length && all.length) {
      problems.push({ code: 'BUDGET_TOO_LOW', message: `The cheapest layout that fits is $${Math.round(Math.min(...all.map(total)))}.` });
    }
  }

  // With the size lever set, drop walls far from it, as long as enough others are left.
  if (prefs.scale !== null && !prefs.pieces) {
    const near = valid.filter((L) => L.checks.size >= 0.35);
    if (near.length >= Math.min(count, valid.length)) valid = near;
  }

  // Rank for variety: best of each family first, then the next best overall. Each
  // layout after the first gets art the earlier ones don't use, when there's enough.
  valid.sort((a, b) => b.score - a.score || cmpStr(a.key, b.key));
  const order = [];
  const top = valid.length ? valid[0].score : 0;
  // Your own happy-to-move pieces are the point: the best layout that uses the most
  // of them leads.
  const ownUse = (L) => L.pieces.filter((p) => p.keep === 'happy').length;
  const mostOwn = happy.length && valid.length ? Math.max(...valid.map(ownUse)) : 0;
  const ownLead = mostOwn ? valid.find((L) => ownUse(L) === mostOwn) : null;
  if (ownLead) order.push(ownLead);
  // Then free-form layouts over the whole open wall, a light, a medium and a full
  // one, before the set shapes.
  const flows = valid.filter((L) => L.family === 'flow');
  for (const band of [[5, 8], [9, RULES.flowMax], [2, 4]]) {
    const L = flows.find((x) => !order.includes(x) && x.pieces.length >= band[0] && x.pieces.length <= band[1]);
    if (L) order.push(L);
  }
  // With more than one place, the best layout in each place comes next, if it's
  // close to the best overall. Only one side, so most stay in the main place.
  const placesSeen = new Set(order.map((L) => L.zc.zone.place));
  const side = (pl) => pl === 'left' || pl === 'right';
  for (const L of valid) {
    const pl = L.zc.zone.place;
    if (placesSeen.has(pl) || (side(pl) && [...placesSeen].some(side))) continue;
    if (!placesSeen.size || L.score >= PLACE_SHOW * top) { placesSeen.add(pl); order.push(L); }
  }
  // Variety after that comes from the main place.
  const mainPlace = valid.filter((L) => L.zc.zone === zones[0]);
  const famsSeen = new Set(order.map((L) => L.family));
  for (const L of mainPlace) if (!famsSeen.has(L.family)) { famsSeen.add(L.family); order.push(L); }
  // Then a different arrangement before the same one with other art.
  const shapeOf = (L) => `${L.zc.zone.place}|${L.family}|${L.st.slots.map((sl) => `${q(sl.dx)},${q(sl.dy)},${sl.w}x${sl.h}`).sort().join(';')}`;
  const shapes = new Set(order.map(shapeOf));
  for (const L of mainPlace) if (!order.includes(L) && !shapes.has(shapeOf(L))) { shapes.add(shapeOf(L)); order.push(L); }
  for (const L of valid) if (!order.includes(L) && !shapes.has(shapeOf(L))) { shapes.add(shapeOf(L)); order.push(L); }
  for (const L of valid) if (!order.includes(L)) order.push(L);
  const chosen = [];
  const used = new Set();
  const newArt = (L) => L.pieces.filter((p) => p.ref.source === 'catalog' && !p.kept).map((p) => p.ref.id);
  for (const L of order) {
    if (chosen.length >= count) break;
    let pick = L;
    if (newArt(L).some((id) => used.has(id))) {
      const alt = redo(L, used, L.zc);
      if (alt && (prefs.budget === null || total(alt) <= prefs.budget + EPS)) pick = alt;
    }
    chosen.push(pick);
    for (const id of newArt(pick)) used.add(id);
  }
  chosen.sort((a, b) => b.score - a.score || cmpStr(a.key, b.key));
  // First: the one with your pieces, else the best in the main place (over the TV
  // or furniture); the rest by score.
  const lead = (ownLead && chosen.find((L) => L.key === ownLead.key && ownUse(L) === mostOwn)) || chosen.find((L) => L.family === 'flow') || chosen.find((L) => L.zc.zone === zones[0]);
  if (lead) chosen.splice(0, chosen.length, lead, ...chosen.filter((L) => L !== lead));

  const present = new Set(results.map((L) => L.family));
  for (const fam of prefs.families) {
    if (present.has(fam) || (fam === 'column' && !zones.some(columnZone))) continue;
    const m = mismatch.get(fam);
    const message = m && m.n === variants.length * zones.length ? m.message : {
      salon: 'No two-row layout fits this wall with the art available.',
      line: 'No single row fits this wall with the art available.',
      grid: 'No grid fits this wall with the art available.',
      statement: 'No statement piece fits this wall with the art available.',
      column: 'No stack of pieces fits this wall with the art available.',
      flow: 'No free-form layout fits this wall with the art available.',
    }[fam];
    problems.push({ code: 'FAMILY_SKIPPED', family: fam, message });
  }

  const fits = [...counts].sort((a, b) => a - b);
  if (!chosen.length && prefs.pieces) {
    const near = fits.length ? fits.reduce((b, n) => (Math.abs(n - prefs.pieces) < Math.abs(b - prefs.pieces) ? n : b), fits[0]) : null;
    const style = { structured: 'a structured layout', gallery: 'a gallery wall' }[prefs.style] || 'a layout';
    problems.unshift({ code: 'COUNT_DOESNT_FIT', pieces: prefs.pieces, near, message: near ? `${prefs.pieces} pieces don't make ${style} here. ${near} do.` : `${prefs.pieces} pieces don't fit here.` });
  } else if (!chosen.length && !problems.some((p) => p.code === 'BUDGET_TOO_LOW')) {
    problems.unshift(zone ? whyNothing(must, zone, ctx.catalogCands, loose) : { code: 'NO_OPEN_SPACE', message: "There's no stretch of wall wide enough to hang on." });
  }

  const layouts = chosen.map((L, i) => finish(L, i + 1, L.zc));
  return { layouts, problems, zone: zone ? zoneOut(zone) : null, zones: ctx.zones.map(zoneOut), counts: fits };
}

/**
 * Same frames in the same places, new art in them.
 * @param {object} input the same input layout() got (keep, exclude and taste may change)
 * @param {object} prev a layout layout() or refill() returned
 * @param {{ keep?: string[], swap?: string }} opts keep: ids that stay; swap: change only this one
 */
export function refill(input, prev, opts = {}) {
  if (!prev || !Array.isArray(prev.pieces) || !prev.group) throw new TypeError('refill() needs a layout that layout() returned.');
  const all = prepare(input);
  // The layout's own place on the wall.
  const ctx = { ...all, zone: prev.family === 'flow' ? flowZone(all, prev.group) : all.zones.find((z) => z.place === (prev.place || 'over')) || all.zone };
  const problems = [];
  if (!ctx.zone) return { layouts: [], problems: [{ code: 'NO_OPEN_SPACE', message: "There's no stretch of wall wide enough to hang on." }], zone: null };
  const keepIds = new Set([...idList(opts.keep, 'keep'), ...ctx.keptIds]);
  const swap = typeof opts.swap === 'string' ? opts.swap : null;
  const hung = prev.pieces.filter((p) => p.role !== 'pinned');
  if (swap && !hung.some((p) => p.ref.id === swap)) throw new TypeError(`${swap} isn't on this layout.`);

  const owned = (p) => p.ref.source === 'owned';
  const stays = (p) => {
    if (swap) return p.ref.id !== swap;
    return owned(p) || keepIds.has(p.ref.id);
  };
  const ownedMust = (p) => owned(p) && ctx.ownedById.get(p.ref.id)?.keep === 'must';
  if (swap && (ownedMust(hung.find((p) => p.ref.id === swap)) || keepIds.has(swap))) throw new TypeError(`${swap} is a piece you must keep.`);
  const replaced = new Set(hung.filter((p) => !stays(p)).map((p) => p.ref.id));
  if (!replaced.size) {
    problems.push({ code: 'NOTHING_TO_CHANGE', message: 'Every piece on this wall is kept or yours, so there is nothing to change.' });
  }

  const g = prev.group;
  const fixedFor = (p) => {
    if (owned(p)) return ctx.ownedById.get(p.ref.id);
    const c = ctx.catalogById.get(p.ref.id);
    if (!c) throw new TypeError(`${p.ref.id} isn't in the catalog.`);
    return { id: c.id, w: p.w, h: p.h, keep: keepIds.has(c.id) ? 'must' : null, kept: keepIds.has(c.id), title: titleOf(c), cat: c, taste: ctx.tasteOf(c.id) };
  };
  const slots = hung.map((p) => {
    const sl = p.slot || { x: p.x, y: p.y, w: p.w, h: p.h };
    return { w: sl.w, h: sl.h, dx: sl.x - g.x, dy: sl.y - g.y, row: p.row, role: p.role, side: p.side || null, fixed: stays(p) ? fixedFor(p) : null };
  });
  const st = { family: prev.family, variant: prev.variant, W: g.w, H: g.h, slots, meta: { rows: prev.meta.rows, cols: prev.meta.cols, gaps: prev.meta.gaps, ragged: prev.meta.ragged || 0 } };

  const onWall = new Set(hung.filter(stays).map((p) => p.ref.id));
  const cands = [
    ...ctx.catalogCands.filter((c) => !onWall.has(c.id)),
    ...ctx.loose.filter((p) => p.keep !== 'must' && !onWall.has(p.id)).map(ownedCand),
  ];
  const index = indexCandidates(cands);
  const where = { x: g.x, y: g.y, w: g.w, h: g.h, shift: Math.abs(g.x + g.w / 2 - ctx.zone.cx) };
  const picked = fill(st, index, ctx.pairSim, ctx.hasRoom, replaced, ctx.look);
  if (!picked) {
    const stuck = hung.find((p) => !stays(p) && !optionsFor(index, p.slot || p).some((o) => !replaced.has(o.cand.id)));
    return {
      layouts: [], zone: zoneOut(ctx.zone),
      problems: [{ code: 'NO_ART_FOR_SLOT', message: stuck ? `No other art comes in a ${stuck.w} x ${stuck.h} in frame.` : 'Not enough other art in these frame sizes.' }],
    };
  }
  const bySlot = new Map(picked.picks.map((p) => [p.slot.i, p]));
  const pieces = buildPieces(st, where, bySlot);
  if (checkPieces(pieces, ctx.regions, ctx.wall).length) {
    return { layouts: [], zone: zoneOut(ctx.zone), problems: [{ code: 'NO_LAYOUT', message: "The new art doesn't fit these frames on this wall." }] };
  }
  const happyTotal = ctx.loose.filter((p) => p.keep === 'happy').length;
  const L = { family: st.family, variant: st.variant, meta: st.meta, group: where, shift: where.shift, pieces, happyTotal, st, index, bySlot, key: prev.key || structureKey(st) };
  const best = improve({ ...L, ...judge(L, ctx) }, ctx, replaced);
  const cost = best.pieces.reduce((s, p) => s + (p.price || 0), 0);
  if (ctx.prefs.budget !== null && cost > ctx.prefs.budget + EPS) {
    return { layouts: [], zone: zoneOut(ctx.zone), problems: [{ code: 'BUDGET_TOO_LOW', message: `New art for these frames would cost $${Math.round(cost)}, over your budget.` }] };
  }
  return { layouts: [finish(best, 1, ctx)], problems, zone: zoneOut(ctx.zone) };
}

function whyNothing(must, zone, catalogCands, loose) {
  const tall = must.find((p) => p.h > zone.maxH + EPS);
  if (tall) {
    return { code: 'MUST_KEEPS_TOO_TALL', message: `Your ${shortTitle(titleOf(tall))} is ${Math.round(tall.h)} in tall, and this wall has ${Math.round(zone.maxH)} in to hang it in.` };
  }
  const mustW = must.reduce((s, p) => s + p.w, 0) + Math.max(0, must.length - 1) * RULES.gap;
  if (must.length && mustW > zone.interval.w + EPS) {
    const message = must.length === 1
      ? `Your ${shortTitle(titleOf(must[0]))} is ${Math.round(mustW)} in wide and the open wall is ${Math.round(zone.interval.w)} in.`
      : `Your must-keep pieces are ${Math.round(mustW)} in wide together and the open wall is ${Math.round(zone.interval.w)} in.`;
    return { code: 'MUST_KEEPS_TOO_WIDE', message };
  }
  // Catalog art must come in a standard frame size exactly; owned pieces may be off by an inch.
  const fitsStandard = (s, tol) => STANDARD.some(([w, h]) => Math.abs(s.w - w) <= tol && Math.abs(s.h - h) <= tol) && s.w <= zone.interval.w && s.h <= zone.maxH;
  const usable = [...catalogCands.filter((c) => c.sizes.some((s) => fitsStandard(s, 0.01))), ...loose.filter((p) => p.keep !== 'must' && fitsStandard(p, 1))];
  if (usable.length < 2) return { code: 'TOO_FEW_CANDIDATES', message: 'Not enough art in sizes that fit this wall. Try a looser taste setting.' };
  return {
    code: 'NO_LAYOUT',
    message: must.length > 1 ? "We couldn't fit a layout here. Try marking fewer pieces as must keep."
      : must.length === 1 ? `We couldn't fit a layout around your ${shortTitle(titleOf(must[0]))} here. Try allowing more pieces or another wall.`
      : "We couldn't fit a layout on this wall with the art available.",
  };
}

function zoneOut(z) {
  return {
    type: z.type, place: z.place, beside: z.beside || null, anchor: z.anchor ? { id: z.anchor.id, kind: z.anchor.kind } : null,
    cx: q(z.cx), target: q(z.target), open: { x0: q(z.interval.x0), x1: q(z.interval.x1) },
  };
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const r3map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r3(v)]));
const topShares = (shares) => Object.fromEntries(Object.entries(shares).filter(([, v]) => v >= 0.01)
  .sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0])).map(([k, v]) => [k, r3(v)]));

function finish(L, rank, ctx) {
  const { zone, owned, pinned, palettes, profiles } = ctx;
  const anchor = zone.anchor ? { id: zone.anchor.id, kind: zone.anchor.kind } : { kind: 'wall' };
  const group = { x: L.group.x, y: L.group.y, w: L.group.w, h: L.group.h };
  const ownedIn = L.pieces.filter((p) => p.ref.source === 'owned').map((p) => ({ id: p.ref.id, title: p.title, pal: palettes.get(p.ref.id) || [] }));
  const NEUTRALS = new Set(['black', 'gray', 'white']);
  const mainFamily = (sh) => {
    const top = Object.entries(sh).filter(([k, v]) => !NEUTRALS.has(k) && v >= 0.1).sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]))[0];
    return top ? top[0] : null;
  };
  const pieces = L.pieces.map((p) => {
    const drop = num(p.drop) ? p.drop : RULES.defaultDrop;
    const sh = profiles.get(p.ref.id).shares;
    const othersShares = L.pieces.filter((o) => o.ref.id !== p.ref.id).map((o) => profiles.get(o.ref.id).shares);
    const out = {
      ref: p.ref, title: p.title, w: p.w, h: p.h,
      x: p.x, y: p.y, cx: q(p.cx), cy: q(p.cy),
      nail: { x: q(p.cx), y: q(p.y + p.h - drop) },
      role: p.role, row: p.row, price: p.price,
      shares: topShares(profiles.get(p.ref.id).shares),
      reason: pieceReason({ piece: p, group, anchorKind: anchor.kind, family: L.family, ownedInLayout: ownedIn.filter((o) => o.id !== p.ref.id), othersPal: L.pieces.filter((o) => o.ref.id !== p.ref.id).map((o) => palettes.get(o.ref.id) || []), pal: palettes.get(p.ref.id) || [], taste: p.taste ?? 0.5, colorFamily: mainFamily(sh), othersShares }),
    };
    if (p.side) out.side = p.side;
    // The frame slot, when a piece you own is a little off a standard size.
    if (p.slot && (p.slot.w !== p.w || p.slot.h !== p.h)) out.slot = p.slot;
    if (!num(p.drop)) out.nailNote = `Assumes the wire sits ${RULES.defaultDrop} in below the top. Measure yours first.`;
    if (p.ref.source === 'catalog') Object.assign(out, { artist: p.artist, year: p.year, collection: p.collection, url: p.url, image: p.image });
    if (p.ref.source === 'owned' && p.keep) out.keep = p.keep;
    if (p.kept) out.kept = true;
    return out;
  });
  for (const p of pinned) {
    const drop = num(p.drop) ? p.drop : RULES.defaultDrop;
    const title = titleOf(p);
    pieces.push({
      ref: { source: 'owned', id: p.id }, title, w: p.w, h: p.h,
      x: p.at.x, y: p.at.y, cx: q(p.at.x + p.w / 2), cy: q(p.at.y + p.h / 2),
      nail: { x: q(p.at.x + p.w / 2), y: q(p.at.y + p.h - drop) }, role: 'pinned', row: null, price: 0, keep: p.keep,
      shares: topShares(profiles.get(p.id).shares),
      reason: pieceReason({ piece: { title, role: 'pinned', ref: { source: 'owned' } } }),
    });
  }
  const inIds = new Set(pieces.map((p) => p.ref.id));
  const left = owned.filter((p) => !inIds.has(p.id)).map((p) => ({ id: p.id, title: titleOf(p), reason: leftReason({ ...p, title: titleOf(p) }) }));
  const mustTitles = L.pieces.filter((p) => p.keep === 'must' && p.fixed && !p.kept).map((p) => p.title);
  const keptTitles = L.pieces.filter((p) => p.kept).map((p) => p.title);
  const newCount = L.pieces.filter((p) => p.ref.source === 'catalog' && !p.kept).length;
  const c = L.color;
  const out = {
    rank, key: L.key, place: zone.place, family: L.family, variant: L.variant, score: r3(Math.max(0, Math.min(1, L.score))),
    parts: r3map(L.parts),
    checks: r3map(L.checks),
    color: {
      scheme: c.scheme, colors: c.schemeColors, lean: c.lean,
      shares: topShares(c.wall.shares), chromatic: r3(c.wall.chromatic), value: r3map(c.wall.value),
      repeated: c.repeated.map((x) => x.family),
    },
    anchor, group: { x: q(group.x), y: q(group.y), w: q(group.w), h: q(group.h) },
    pieces, left, total: pieces.reduce((s, p) => s + (p.price || 0), 0),
    meta: { rows: L.meta.rows, cols: L.meta.cols || null, gaps: L.meta.gaps.map(q), ragged: q(L.meta.ragged || 0) },
  };
  out.summary = summary({ ...out, meta: L.meta, group, beside: zone.beside }, mustTitles, newCount, keptTitles);
  out.notes = layoutNotes({ color: c, design: L.design, checks: L.checks, family: L.family, pieces: L.pieces });
  return out;
}
