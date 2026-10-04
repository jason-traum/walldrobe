// Walldrobe layout engine.
//
// layout(input) takes one wall, what's on it, the art the person owns and a list
// of candidate art, and returns ranked layouts with every piece's position in
// inches and one sentence on why it's there. Each layout is judged as a whole:
// fit, taste, color (theory.js) and design (design.js). refill() keeps a layout's
// frames where they are and changes the art in them. Pure: no DOM, no network,
// no clock. Same input, same output. Spec: ENGINE.md.

import { RULES, WEIGHTS, SEARCH, FAMILIES, STANDARD, STYLES } from './constants.js';
import { assignMats, matScore, MAT_LEVELS } from './mats.js';
export { assignMats, matScore, MAT_LEVELS, isStructured } from './mats.js';
export { assignHome, HOME } from './home.js';
import { hexToRgb, normalizePalette, paletteSimilarity } from './color.js';
import { blockedRegions, findZones, placeGroup, checkPieces, clamp01, cmpStr, q, EPS, FURNITURE } from './geometry.js';
import { salonStructures, lineStructures, gridStructures, statementStructures, columnStructures, columnZone, offeredSizes } from './structures.js';
import { flowStructures, openSpace, shapeScore, canPack } from './flow.js';
import { pieceReason, leftReason, summary, shortTitle, layoutNotes, whyLine } from './reasons.js';
import { profileFromPalette, colorScore } from './theory.js';
import { designScore, lookalike, lookPenalty } from './design.js';

export { RULES, WEIGHTS } from './constants.js';
export { rerank } from './rank.js';
export const VERSION = '0.2.0';

const KEEPS = new Set(['must', 'happy', 'dontcare']);
const REUSE_BONUS = 0.08;
const SAME_ARTIST = 0.02;
// A layout beside the TV or furniture is shown among the first ones when it scores at least this share of the best.
const PLACE_SHOW = 0.85;
const COMP_FIT = 0.55;     // share of the composition score that is fit; the rest is design
const COMP_GATE = 0.15;    // layouts this far below the best composition are dropped when enough others are left
// Look-alikes are steered away from when picking (LOOK_PICK) and judged once, in the
// design score's `distinct`. A third penalty on the total (0.04 a pair) came off on
// Oct 3: three of them punished a planned series or an eclectic wall three times over.
const LOOK_PICK = 0.25;      // how hard the fast pick steers away from look-alikes
const QUALITY_PICK = 0.15;   // how much a reviewed quality score (0 to 1) leans the pick toward stronger photos
const OWNED_PICK_BONUS = { happy: 0.15, dontcare: 0.05 };
const PREFER_PICK = 0.3;     // art the person picked on another wall goes in first where its size fits
const PREFER_WALL = 0.03;
const MAT_WEIGHT = 0.04;     // a wall whose mats break the principles (a grid half matted) scores a little lower    // and a wall with it scores a little higher, so the improvement pass keeps it
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
  idList(input.prefer, 'prefer');
}

function readPrefs(raw = {}) {
  return {
    budget: num(raw.budget) && raw.budget >= 0 ? raw.budget : null,
    maxPieces: num(raw.maxPieces) && raw.maxPieces >= 1 ? Math.floor(raw.maxPieces) : 9,
    maxGiven: num(raw.maxPieces) && raw.maxPieces >= 1,
    families: STYLES[raw.style] ? [...STYLES[raw.style]] : Array.isArray(raw.families) ? raw.families.filter((f) => FAMILIES.includes(f)) : [...FAMILIES],
    style: STYLES[raw.style] ? raw.style : null,
    // An exact number of pieces, when the person picks one.
    pieces: num(raw.pieces) && raw.pieces >= 1 ? Math.min(RULES.maxCount, Math.floor(raw.pieces)) : null,
    // Where on the wall: 'over' the TV or furniture, 'left' or 'right' of it, or null for anywhere.
    place: typeof raw.place === 'string' ? raw.place : null,
    // How full the wall should be: calm, balanced or full.
    fullness: RULES.fullness[raw.fullness] ? raw.fullness : 'balanced',
    // The size lever: -1 fewer, bigger pieces; 1 more, smaller ones; null leaves it to the other scores.
    scale: num(raw.scale) && raw.scale !== 0 ? Math.max(-1, Math.min(1, raw.scale)) : null,
    // 'none': no shop print hangs matted in a bigger frame.
    mats: raw.mats === 'none' ? 'none' : null,
    // How many new pieces get a mat, a preference: none, few, some, most, all (engine/mats.js).
    matLevel: MAT_LEVELS.includes(raw.matLevel) ? raw.matLevel : 'some',
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
  const prefer = new Set(idList(input.prefer, 'prefer'));
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const tasteOf = (id) => (num(taste[id]) ? clamp01(taste[id]) : 0.5);
  // The taste a catalog piece is picked and judged by, the same on every path: your
  // taste, leaned a little toward stronger photos when a reviewed quality score exists.
  const pickTaste = (c) => (num(c.quality) ? (1 - QUALITY_PICK) * tasteOf(c.id) + QUALITY_PICK * clamp01(c.quality) : tasteOf(c.id));

  // A kept print comes as the size it's sold in; on the wall it takes its frame's outside.
  const kept = (input.keep || []).map((k) => {
    const c = byId.get(k.id);
    const z = (c.sizes || []).find((s) => s.w === k.w && s.h === k.h) || soldAs(c, k.w, k.h) || { w: k.w, h: k.h };
    const o = outerOf(z);
    return { id: c.id, w: o.w, h: o.h, frame: frameOf(z), keep: 'must', kept: true, title: titleOf(c), cat: c, taste: pickTaste(c) };
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
    sizes: c.sizes.filter((s) => s && num(s.w) && num(s.h) && s.w > 0 && s.h > 0 && !(s.matted && input.prefs && input.prefs.mats === 'none')).map((s) => ({ ...outerOf(s), ...(num(s.price) ? { price: s.price } : {}), frame: frameOf(s) })),
    taste: pickTaste(c), prefer: prefer.has(c.id),
  }));

  return {
    input, wall, obstacles, owned, catalog, prefs: readPrefs(input.prefs), exclude, kept, keptIds,
    pinned, loose, regions, zone, zones, space, palettes, hasRoom, pairSim, profiles,
    roomProfile: hasRoom ? profileFromPalette(room) : null,
    catalogCands, ownedById: new Map(owned.map((p) => [p.id, p])), catalogById: byId, tasteOf, pickTaste, prefer,
    look: lookFactory(profiles),
  };
}

// Palette similarity is the slow part (CIEDE2000), so results are remembered across
// calls by the palettes' colors. Same colors, same answer, so this stays pure.
const SIM_CACHE = new Map();
const SIM_CACHE_MAX = 400000;
// Each distinct palette gets a small number once, so a pair's cache key is a number,
// not two long strings joined on every call (that was the slowest line in a profile).
const SIG_NUM = new Map();
const SIG_SPAN = 1 << 20;
function pairSimFactory(palettes) {
  const num = new Map();
  for (const [id, pal] of palettes) {
    const sig = pal.map((c) => `${c.hex}:${c.weight.toFixed(4)}`).join(',');
    let n = SIG_NUM.get(sig);
    if (n === undefined) { n = SIG_NUM.size + 1; SIG_NUM.set(sig, n); }
    num.set(id, n);
  }
  return (a, b) => {
    const na = num.get(a) || 0, nb = num.get(b) || 0;
    const k = na < nb ? na * SIG_SPAN + nb : nb * SIG_SPAN + na;
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
  const idx = new Map();
  const at = (id) => { let i = idx.get(id); if (i === undefined) { i = idx.size; idx.set(id, i); } return i; };
  return (a, b) => {
    const pa = profiles.get(a), pb = profiles.get(b);
    if (!pa || !pb) return 0;
    const ia = at(a), ib = at(b);
    const k = ia < ib ? ia * SIG_SPAN + ib : ib * SIG_SPAN + ia;
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
    // Picked art first, so the cap never cuts it.
    list.sort((a, b) => (!!b.cand.prefer - !!a.cand.prefer) || b.cand.taste - a.cand.taste || cmpStr(a.cand.id, b.cand.id));
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
  if (cand.prefer) v += PREFER_PICK;
  return v;
}

// What one option costs: yours are free; a catalog size with no price is unknown,
// and an unknown price never counts as within a budget.
const optCost = (o) => (o.cand.source !== 'catalog' ? 0 : num(o.size.price) ? o.size.price : Infinity);
// What the pieces that stay in a structure cost (kept catalog prints).
function fixedCost(struct) {
  let t = 0;
  for (const sl of struct.slots) if (sl.fixed && sl.fixed.cat) { const pr = priceOf(sl.fixed.cat, sl.fixed.w, sl.fixed.h); t += pr == null ? Infinity : pr; }
  return t;
}
// The least a structure could cost with this art: each open slot's cheapest option.
// A floor, since one print can't fill two slots.
function costFloor(struct, index, banned) {
  let t = fixedCost(struct);
  for (const sl of struct.slots) {
    if (sl.fixed) continue;
    const opts = optionsFor(index, sl).filter((o) => !(banned && banned.has(o.cand.id)));
    t += opts.length ? Math.min(...opts.map(optCost)) : Infinity;
  }
  return t;
}

// A small beam search over the open slots, biggest first. With a budget, a partial
// pick is dropped as soon as it, plus the cheapest way to fill what's left, goes over:
// the search looks for the best wall within the budget, not the best wall and then
// a price check.
function fill(struct, index, pairSim, hasRoom, banned, look, budget = null) {
  const open = struct.slots
    .map((s, i) => ({ ...s, i }))
    .filter((s) => !s.fixed)
    .sort((a, b) => b.w * b.h - a.w * a.h
      || Math.abs(a.dx + a.w / 2 - struct.W / 2) - Math.abs(b.dx + b.w / 2 - struct.W / 2)
      || a.i - b.i);
  const fixedIds = struct.slots.filter((s) => s.fixed).map((s) => s.fixed.id);
  const optsOf = open.map((slot) => optionsFor(index, slot).filter((o) => !(banned && banned.has(o.cand.id))));
  const capped = budget !== null && num(budget);
  // The cheapest way to fill the slots after this one, for the budget check.
  const restMin = open.map(() => 0);
  if (capped) for (let k = open.length - 2; k >= 0; k--) restMin[k] = restMin[k + 1] + (optsOf[k + 1].length ? Math.min(...optsOf[k + 1].map(optCost)) : Infinity);
  const base = capped ? fixedCost(struct) : 0;
  let beam = [{ picks: [], used: new Set(), artists: new Set(), value: 0, key: '', cost: base }];
  for (const [k, slot] of open.entries()) {
    const opts = optsOf[k];
    if (!opts.length) return null;
    const next = [];
    for (const st of beam) {
      const ctx = [...fixedIds, ...st.picks.map((p) => p.cand.id)];
      if (hasRoom) ctx.push(ROOM);
      for (const o of opts) {
        const { cand, size } = o;
        if (st.used.has(cand.id)) continue;
        const cost = capped ? st.cost + optCost(o) : 0;
        if (capped && cost + restMin[k] > budget + EPS) continue;
        let v = pickValue(cand, ctx, pairSim, look);
        if (cand.artist && st.artists.has(cand.artist)) v -= 0.1;
        next.push({ parent: st, pick: { slot, cand, size }, value: st.value + v, key: `${st.key},${cand.id}`, cost });
      }
    }
    if (!next.length) return null;
    next.sort((a, b) => b.value - a.value || cmpStr(a.key, b.key));
    beam = next.slice(0, open.length > 8 ? SEARCH.beam / 2 : SEARCH.beam).map((n) => {
      const used = new Set(n.parent.used); used.add(n.pick.cand.id);
      const artists = new Set(n.parent.artists); if (n.pick.cand.artist) artists.add(n.pick.cand.artist);
      return { picks: [...n.parent.picks, n.pick], used, artists, value: n.value, key: n.key, cost: n.cost };
    });
  }
  return beam[0];
}

// What a wall costs: the known prices, how many are unknown, and the total a budget
// is checked against (unknown counts as over).
function costOf(pieces) {
  let known = 0, unknown = 0;
  for (const p of pieces) {
    if (p.ref.source !== 'catalog') continue;
    if (num(p.price)) known += p.price; else unknown++;
  }
  return { known, unknown, forBudget: unknown ? Infinity : known };
}

const catalogExtra = (c) => ({ artist: c.artist || null, year: c.year || null, collection: c.source || null, url: c.url || null, image: c.image || null });
// Frames. A catalog size is what the frame is sold as (an 11 x 14 frame), or, when the
// shop sells it framed, the framed piece itself. On the wall it takes the frame's
// outside: the size plus the moulding on each side. All geometry (gaps, clearances,
// nails) uses the outside; the buy list uses the size it's sold as.
// A size can say how wide its frame's moulding is (`border`, a slim or a wide frame);
// a size the shop sells framed is already its outside.
const borderOf = (z) => (z && z.framed ? 0 : z && num(z.border) && z.border >= 0 ? z.border : RULES.frameBorder);
const outerOf = (z) => { const b = borderOf(z); return { w: z.w + 2 * b, h: z.h + 2 * b }; };
// The catalog size behind an outside size on the wall.
const soldAs = (c, w, h) => (c.sizes || []).find((z) => { const o = outerOf(z); return Math.abs(o.w - w) < 1e-6 && Math.abs(o.h - h) < 1e-6; }) || null;
// What a size can be bought as, when the catalog says: matted (the print inside) and/or plain.
const canOfSize = (z) => (z.matPrint || z.matted || z.plainOk != null
  ? { mat: z.matPrint ? { w: z.matPrint.w, h: z.matPrint.h } : z.matted ? { w: z.matted.w, h: z.matted.h } : null, plain: z.plainOk != null ? !!z.plainOk : !z.matted }
  : null);
const frameOf = (z) => {
  if (!z) return null;
  const can = canOfSize(z);
  return { w: z.w, h: z.h, border: borderOf(z), ...(z.matted ? { print: { w: z.matted.w, h: z.matted.h } } : {}), ...(can ? { can } : {}) };
};
const priceOf = (c, w, h) => {
  const s = soldAs(c, w, h);
  return s && num(s.price) ? s.price : null;
};

// Every slot gets its piece, centered in the slot, on the quarter inch.
function buildPieces(st, place, bySlot) {
  return st.slots.map((slot, i) => {
    let ref, title, w, h, price, extra = {}, keep = null, pickTaste = null, drop = null, kept = false, artist = null, frame = null;
    if (slot.fixed && slot.fixed.cat) {
      // A catalog piece that stays: kept by the person, or not being changed by refill().
      const p = slot.fixed, c = p.cat;
      ref = { source: 'catalog', id: c.id }; title = titleOf(c); w = p.w; h = p.h; price = priceOf(c, w, h); frame = p.frame || frameOf(soldAs(c, w, h));
      extra = catalogExtra(c); pickTaste = p.taste; kept = !!p.kept; keep = p.kept ? 'must' : null; artist = c.artist || null;
    } else if (slot.fixed) {
      const p = slot.fixed;
      ref = { source: 'owned', id: p.id }; title = titleOf(p); w = p.w; h = p.h; price = 0; keep = p.keep; drop = p.drop;
    } else {
      const { cand: c, size } = bySlot.get(i);
      ref = { source: c.source, id: c.id }; title = c.title; w = size.w; h = size.h; pickTaste = c.taste;
      if (c.source === 'catalog') { price = num(size.price) ? size.price : null; extra = catalogExtra(c.item); artist = c.artist; frame = size.frame || null; }
      else { price = 0; keep = c.item.keep; drop = c.item.drop; }
    }
    const x = q(place.x + slot.dx + (slot.w - w) / 2);
    const y = q(place.y + slot.dy + (slot.h - h) / 2);
    return {
      id: ref.id, ref, title, w, h, x, y, cx: x + w / 2, cy: y + h / 2, row: slot.row, role: slot.role || 'fill', side: slot.side || null,
      fixed: !!slot.fixed, keep, kept, price, taste: pickTaste, drop, artistName: artist, ...(frame ? { frame } : {}), ...extra,
      slot: { x: q(place.x + slot.dx), y: q(place.y + slot.dy), w: slot.w, h: slot.h },
    };
  });
}

// ---------- Judging a whole wall ----------

// A free-form layout's own zone: the whole open wall.
function flowZone(ctx, g) {
  return { type: 'flow', place: 'flow', anchor: null, base: null, cx: g.x + g.w / 2, refW: ctx.wall.width, target: ctx.wall.width * RULES.wallRatio, ratio: RULES.wallRatio, range: RULES.wallRange, interval: { x0: RULES.edge, x1: ctx.wall.width - RULES.edge, w: ctx.wall.width - 2 * RULES.edge }, maxH: ctx.wall.height, space: ctx.space };
}

// The picture as a whole, on this wall: fullness, one shape per group, shared
// lines, eye level, relation to the furniture, balance across the wall (flow.js).
// Pinned pieces count as part of it.
function wallShape(L, ctx) {
  const frames = L.pieces.map((p, i) => ({ x: p.x, y: p.y, w: p.w, h: p.h, g: (L.st.slots[i] && L.st.slots[i].g) || 0 }));
  for (const p of ctx.pinned) frames.push({ x: p.at.x, y: p.at.y, w: p.w, h: p.h, g: 0 });
  const free = L.family === 'flow';
  return shapeScore(frames, { space: ctx.space, wall: ctx.wall, obstacles: ctx.obstacles, fullness: ctx.prefs.fullness, free, loose: free && L.variant !== 'neat' }).score;
}

function fitScore(L, ctx) {
  const zone = ctx.zone;
  if (zone.type === 'flow') return wallShape(L, ctx);
  return 0.5 * setFit(L, zone) + 0.5 * wallShape(L, ctx);
}

// The set shapes, against the zone they were built for.
function setFit(L, zone) {
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
  const fit = fitScore(L, ctx);
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
  // Your pinned pieces stay where they hang, but they are on the wall: they count in
  // its colors (after the others, so the focal piece's index holds).
  const PC = ctx.pinned.length ? [...P, ...ctx.pinned.map((p) => ({ x: p.at.x, y: p.at.y, w: p.w, h: p.h, role: 'pinned', area: p.w * p.h, profile: ctx.profiles.get(p.id) }))] : P;
  if (ctx.hasRoom && ctx.pinned.length) {
    const A = PC.reduce((s, p) => s + p.area, 0);
    room.sim = (L.pieces.reduce((s, p) => s + p.w * p.h * ctx.pairSim(p.ref.id, ROOM), 0) + ctx.pinned.reduce((s, p) => s + p.w * p.h * ctx.pairSim(p.id, ROOM), 0)) / A;
  }
  const c = colorScore(PC, d.focalIdx, room);

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
  // The arrangement first: fit and design make the composition score, and great
  // color or taste can't rescue an awkward arrangement (layouts far below the best
  // composition are dropped before ranking).
  const comp = COMP_FIT * fit + (1 - COMP_FIT) * d.score;
  const picked = ctx.prefer && ctx.prefer.size ? L.pieces.filter((p) => ctx.prefer.has(p.ref.id)).length : 0;
  // Mats: a structured wall all the same; a loose one mixed with care (engine/mats.js).
  const mopts = { family: L.family, variant: L.variant, level: ctx.prefs.matLevel };
  const mats = matScore(L.pieces, assignMats(L.pieces, mopts), mopts);
  parts.mats = mats;
  const score = WEIGHTS.comp * comp + WEIGHTS.taste * taste + WEIGHTS.color * c.score + reuse + PREFER_WALL * picked - SAME_ARTIST * dupArtists - MAT_WEIGHT * (1 - mats);
  return { score: score + size, comp, parts: { ...parts, comp }, checks, color: c, design: d };
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
        if (ctx.prefs.budget !== null && costOf(pieces).forBudget > ctx.prefs.budget + EPS) continue;
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
  const picked = fill(L.st, L.index, ctx.pairSim, ctx.hasRoom, banned, ctx.look, ctx.prefs.budget);
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
  const r = layoutOnce(input);
  const prefs = (input && input.prefs) || {};
  const out = !r.layouts.length && prefs.dropFewest ? dropFewest(input, r) : r;
  return withSections(input, withAsIs(input, out));
}

function layoutOnce(input) {
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
  if (!zone && !(prefs.families.includes('flow') && ctx.space.area >= 150 && ctx.wall.height - RULES.ceilingHard - RULES.centerline >= 4)) {
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
  // With a budget: the arrangements that only failed on price, and the least any of
  // them would have cost.
  let cheapest = Infinity, budgetMiss = 0;
  const overBudget = (st, index) => {
    if (prefs.budget === null || !fill(st, index, ctx.pairSim, ctx.hasRoom, null, ctx.look)) return;
    budgetMiss++;
    cheapest = Math.min(cheapest, costFloor(st, index, null));
  };

  // Free-form layouts over all the open wall.
  const tooShort = ctx.wall.height - RULES.ceilingHard - RULES.centerline < 4;
  if (prefs.families.includes('flow') && !asked.length && !tooShort) {
    // One pass with every piece you'd keep or move: one that doesn't fit is left out as it goes.
    for (const fixed of variants.slice(0, 1)) {
      const fixedIds = new Set(fixed.map((p) => p.id));
      const cands = [...ctx.catalogCands, ...loose.filter((p) => !fixedIds.has(p.id) && p.keep !== 'must').map(ownedCand)];
      const index = indexCandidates(cands);
      const avail = new Map();
      for (const [k, list] of index.bySize) avail.set(k, list.length);
      const os = offeredSizes(avail);
      const sizes = [...new Set([...os.salon, ...os.large].map(([w, h]) => sizeKey(w, h)))].map((k) => k.split('x').map(Number));
      // Pieces of theirs already hanging (and free to stay or move) can stay as they are.
      const hung = fixed.filter((p) => p.at && num(p.at.x) && num(p.at.y) && p.keep !== 'dontcare');
      const shown = Array.isArray(input.base) ? input.base.filter((b) => b && [b.x, b.y, b.w, b.h].every(num)) : null;
      const fr = flowStructures({ wall: ctx.wall, obstacles: ctx.obstacles, space: ctx.space, pinned: ctx.pinned, fixed, hung, sizes, avail, pieces: prefs.pieces, style: prefs.style, fullness: prefs.fullness, base: shown, most: prefs.maxGiven && !prefs.pieces ? Math.min(RULES.flowMax, prefs.maxPieces) : RULES.flowMax });
      for (const n of fr.counts) counts.add(n);
      for (const st of fr.structures) {
        const picked = fill(st, index, ctx.pairSim, ctx.hasRoom, null, ctx.look, prefs.budget);
        if (!picked) { overBudget(st, index); continue; }
        const base = { x: st.at.x, y: st.at.y, w: st.W, h: st.H, shift: 0 };
        const zc = { ...ctx, zone: flowZone(ctx, base) };
        const bySlot = new Map(picked.picks.map((p) => [p.slot.i, p]));
        const done = place(st, bySlot, base, zc);
        if (!done) continue;
        const L = {
          family: st.family, variant: st.variant || null, meta: st.meta, group: done.where, shift: 0,
          pieces: done.pieces, happyTotal: happy.length, st, index, bySlot, key: `${structureKey(st)}@${q(st.at.x)},${q(st.at.y)}`, zc,
        };
        const j = judge(L, zc);
        // Stepping the count from a layout on screen: how many of its frames this one keeps.
        if (shown && shown.length) {
          const had = new Set(shown.map((b) => `${q(b.x)},${q(b.y)},${b.w}x${b.h}`));
          L.keeps = done.pieces.filter((p) => had.has(`${p.slot.x},${p.slot.y},${p.slot.w}x${p.slot.h}`)).length / had.size;
        }
        results.push({ ...L, ...j });
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
    // Your frames are measured outside to outside, like a standard frame with its moulding.
    const b2 = 2 * RULES.frameBorder;
    for (const c of index.owned) for (const [w0, h0] of STANDARD) {
      const w = w0 + b2, h = h0 + b2;
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
      const picked = fill(st, index, ctx.pairSim, ctx.hasRoom, null, ctx.look, prefs.budget);
      if (!picked) { overBudget(st, index); continue; }
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

  // Budget: the search already stayed within it; this is the last check (an unknown
  // price never passes). When nothing is left, say what the cheapest one would cost.
  const total = (L) => costOf(L.pieces).forBudget;
  if (prefs.budget !== null) {
    const all = valid;
    valid = all.filter((L) => total(L) <= prefs.budget + EPS);
    if (!valid.length && (all.length || budgetMiss)) {
      const least = Math.min(cheapest, ...all.map(total));
      problems.push({ code: 'BUDGET_TOO_LOW', message: Number.isFinite(least) ? `The cheapest layout that fits is $${Math.round(least)}.` : 'Some of this art has no price yet, so no layout can be checked against your budget.' });
    }
  }

  // With the size lever set, drop walls far from it, as long as enough others are left.
  if (prefs.scale !== null && !prefs.pieces) {
    const near = valid.filter((L) => L.checks.size >= 0.35);
    if (near.length >= Math.min(count, valid.length)) valid = near;
  }

  // The arrangement has to pass before taste and color rank it.
  // Asking for more walls never lets a weaker one in ahead of a stronger one: walls
  // below the gate only fill what's left, after all the passing ones, marked weak.
  if (valid.length) {
    const bestComp = Math.max(...valid.map((L) => L.comp));
    const passing = valid.filter((L) => L.comp >= bestComp - COMP_GATE);
    if (passing.length >= Math.min(count, valid.length)) valid = passing;
    else valid = [...passing, ...valid.filter((L) => !passing.includes(L)).sort((a, b) => b.comp - a.comp).slice(0, count - passing.length).map((L) => ({ ...L, weak: true }))];
  }
  // Rank for variety: best of each family first, then the next best overall. Each
  // layout after the first gets art the earlier ones don't use, when there's enough.
  valid.sort((a, b) => (!!a.weak - !!b.weak) || b.score - a.score || cmpStr(a.key, b.key));
  const order = [];
  const top = valid.length ? valid[0].score : 0;
  // Your own happy-to-move pieces are the point: the best layout that uses the most
  // of them leads.
  const ownUse = (L) => L.pieces.filter((p) => p.keep === 'happy').length;
  const mostOwn = happy.length && valid.length ? Math.max(...valid.map(ownUse)) : 0;
  // Stepping the count from a layout on screen: the one that keeps its frames leads.
  const baseLead = Array.isArray(input.base) && input.base.length ? valid.filter((L) => (L.keeps || 0) >= 0.99).sort((a, b) => b.score - a.score)[0] || null : null;
  const ownLead = baseLead || (mostOwn ? valid.find((L) => ownUse(L) === mostOwn) : null);
  if (ownLead) order.push(ownLead);
  // Then the best free-form layout, the best with two groups, and the best of the
  // set shapes, so the first few differ in kind, not just in art.
  const flows = valid.filter((L) => L.family === 'flow' && L.variant !== 'asis');
  const kinds = [
    flows.find((L) => (L.meta.groups || 1) === 1),
    flows.find((L) => (L.meta.groups || 1) > 1),
    valid.find((L) => L.family !== 'flow'),
    valid.find((L) => L.variant === 'asis'),
  ];
  for (const L of kinds) if (L && !order.includes(L)) order.push(L);
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
  chosen.sort((a, b) => (!!a.weak - !!b.weak) || b.score - a.score || cmpStr(a.key, b.key));
  // First: the one with your pieces, else the best in the main place (over the TV
  // or furniture); the rest by score.
  const lead = (baseLead && chosen.find((L) => L.key === baseLead.key)) || (ownLead && chosen.find((L) => L.key === ownLead.key && ownUse(L) === mostOwn)) || chosen.find((L) => L.family === 'flow') || chosen.find((L) => L.zc.zone === zones[0]);
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
    const together = prefs.families.includes('flow') && must.length >= 2 ? mustsDontFit(must, ctx) : null;
    problems.unshift(together || (zone ? whyNothing(must, zone, ctx.catalogCands, loose) : { code: 'NO_OPEN_SPACE', message: "There's no stretch of wall wide enough to hang on." }));
  }

  const layouts = chosen.map((L, i) => finish(L, i + 1, L.zc));
  return { layouts, problems, zone: zone ? zoneOut(zone) : null, zones: ctx.zones.map(zoneOut), counts: fits };
}

/**
 * Judge an arrangement someone already has: the same hard checks and the same
 * scoring layout() uses on its own free-form walls, on pieces placed by hand.
 * @param {object} input the same input layout() gets
 * @param {{ id: string, x: number, y: number, w?: number, h?: number }[]} placed pieces by id
 *   (yours, or catalog pieces with the frame size w x h), bottom-left corner in inches
 * @returns {{ ok: boolean, fails: string[], score: number, comp: number, parts: object, checks: object, layout: object }}
 */
export function scoreArrangement(input, placed, opts = {}) {
  if (!Array.isArray(placed) || !placed.length) throw new TypeError('scoreArrangement() needs a list of placed pieces.');
  const a = arrangement(prepare(input), placed, opts.variant || 'asis');
  return { ok: !a.fails.length, fails: a.fails, breaks: a.breaks, score: a.j.score, comp: a.j.comp, parts: a.j.parts, checks: a.j.checks, layout: a.out };
}

// Pieces placed by hand, judged as a free-form wall: the layout, its score, the hard
// checks it fails and every rule it breaks.
function arrangement(ctx, placed, variant, rank = 0) {
  // A pinned piece of yours hangs where it is and is added by finish(); listed here too, it would collide with itself.
  const pinnedIds = new Set(ctx.pinned.map((p) => p.id));
  placed = placed.filter((pl) => !(pl && pinnedIds.has(pl.id)));
  if (!placed.length) throw new TypeError('scoreArrangement() needs at least one piece that is not pinned.');
  const pieces = placed.map((pl) => {
    if (!pl || !pl.id || !num(pl.x) || !num(pl.y)) throw new TypeError(`Placed piece ${(pl && pl.id) || '(no id)'} needs id, x and y.`);
    const own = ctx.ownedById.get(pl.id);
    const cat = own ? null : ctx.catalogById.get(pl.id);
    if (!own && !cat) throw new TypeError(`${pl.id} isn't one of your pieces or in the catalog.`);
    const w = own ? own.w : pl.w, h = own ? own.h : pl.h;
    if (!num(w) || !num(h) || w <= 0 || h <= 0) throw new TypeError(`Placed piece ${pl.id} needs a positive frame size.`);
    const base = { id: pl.id, title: titleOf(own || cat), w, h, x: pl.x, y: pl.y, cx: pl.x + w / 2, cy: pl.y + h / 2, row: null, role: 'fill', side: null, slot: { x: pl.x, y: pl.y, w, h } };
    return own
      ? { ...base, ref: { source: 'owned', id: own.id }, fixed: true, keep: own.keep, kept: false, price: 0, taste: null, drop: own.drop, artistName: null }
      : { ...base, ref: { source: 'catalog', id: cat.id }, fixed: false, keep: null, kept: false, price: priceOf(cat, w, h), taste: ctx.pickTaste(cat), drop: null, artistName: cat.artist || null, ...(soldAs(cat, w, h) ? { frame: frameOf(soldAs(cat, w, h)) } : {}), ...catalogExtra(cat) };
  });
  const x0 = Math.min(...pieces.map((p) => p.x)), y0 = Math.min(...pieces.map((p) => p.y));
  const group = { x: x0, y: y0, w: Math.max(...pieces.map((p) => p.x + p.w)) - x0, h: Math.max(...pieces.map((p) => p.y + p.h)) - y0, shift: 0 };
  const st = {
    family: 'flow', variant, W: group.w, H: group.h,
    slots: pieces.map((p) => ({ w: p.w, h: p.h, dx: p.x - x0, dy: p.y - y0, fixed: p.fixed ? ctx.ownedById.get(p.id) : null, row: null, role: null, g: 0 })),
    meta: { ragged: 0, gaps: [RULES.gap], rows: null, groups: 1 },
  };
  const L = {
    family: 'flow', variant, meta: st.meta, group, shift: 0, pieces, st, index: null, bySlot: new Map(),
    happyTotal: ctx.loose.filter((p) => p.keep === 'happy').length, key: `hand|${structureKey(st)}@${q(x0)},${q(y0)}`,
  };
  const zc = { ...ctx, zone: flowZone(ctx, group) };
  const j = judge(L, zc);
  const fails = checkPieces(pieces, ctx.regions, ctx.wall);
  const ids = new Set(pieces.map((p) => p.ref.id));
  for (const p of ctx.loose) if (p.keep === 'must' && !ids.has(p.id)) fails.push(`${p.id} must be on the wall`);
  if (ids.size !== pieces.length) fails.push('a piece is placed twice');
  // Diagnostic scoring works on any wall; these say whether it is one we would suggest.
  for (const p of pieces) {
    if (p.ref.source !== 'catalog') continue;
    if (ctx.exclude.has(p.ref.id)) fails.push(`${p.ref.id} is excluded`);
    const c = ctx.catalogById.get(p.ref.id);
    if (!soldAs(c, p.w, p.h)) fails.push(`${p.ref.id} doesn't come in ${p.w} x ${p.h}`);
  }
  for (const k of ctx.kept) if (!ids.has(k.id)) fails.push(`${k.id} is kept and must be on the wall`);
  if (ctx.prefs.budget !== null && costOf(pieces).forBudget > ctx.prefs.budget + EPS) fails.push('over the budget');
  return { fails, breaks: breaksOf(pieces, ctx), j, out: finish({ ...L, ...j }, rank, zc) };
}

// ---------- The wall as it hangs now ----------

const r4 = (v) => Math.round(v * 4) / 4;
const fmt = (v) => `${v}`;

// Every rule an arrangement breaks, hard and soft: { rule, piece, by (inches), hard, with?, message }.
export function breaksOf(pieces, ctx) {
  const out = [];
  const add = (rule, p, by, hard, message, w) => out.push({ rule, piece: p.ref ? p.ref.id : p.id, by: r4(by), hard, ...(w ? { with: w } : {}), message });
  const name = (p) => shortTitle(p.title || p.id);
  const W = ctx.wall;
  for (const p of pieces) {
    if (p.x < RULES.edge - EPS) add('wall-end', p, RULES.edge - p.x, true, `Your ${name(p)} is ${fmt(r4(RULES.edge - p.x))} in too close to the left end of the wall (the rule is ${RULES.edge} in).`);
    if (p.x + p.w > W.width - RULES.edge + EPS) add('wall-end', p, p.x + p.w - (W.width - RULES.edge), true, `Your ${name(p)} is ${fmt(r4(p.x + p.w - (W.width - RULES.edge)))} in too close to the right end of the wall (the rule is ${RULES.edge} in).`);
    if (p.y < -EPS) add('floor', p, -p.y, true, `Your ${name(p)} runs ${fmt(r4(-p.y))} in below the floor.`);
    const top = W.height - (p.y + p.h);
    if (top < RULES.ceilingHard - EPS) add('ceiling', p, RULES.ceilingHard - top, true, `Your ${name(p)} is ${fmt(r4(top))} in under the ceiling; the rule is at least ${RULES.ceilingHard}.`);
    else if (top < RULES.ceilingSoft - EPS) add('ceiling-soft', p, RULES.ceilingSoft - top, false, `Your ${name(p)} is ${fmt(r4(top))} in under the ceiling; ${RULES.ceilingSoft} or more looks better.`);
    for (const r of ctx.regions) {
      if (!overlapsBox(p, r)) continue;
      const o = ctx.obstacles.find((x) => x.id === r.id);
      const what = o ? String(o.label || o.kind).toLowerCase() : 'piece that stays put';
      if (o && FURNITURE.has(o.kind)) {
        add('furniture-clearance', p, r.y + r.h - p.y, true, `Your ${name(p)} is ${fmt(r4(p.y - (o.y + o.h)))} in above the ${what}; the rule is at least ${fmt(r4(r.y + r.h - (o.y + o.h)))}.`, r.id);
      } else {
        const by = Math.min(p.x + p.w - r.x, r.x + r.w - p.x, p.y + p.h - r.y, r.y + r.h - p.y);
        add(r.kind === 'pinned' ? 'pinned-clearance' : 'blocker-clearance', p, by, true, `Your ${name(p)} is ${fmt(r4(by))} in too close to the ${what}.`, r.id);
      }
    }
  }
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    const a = pieces[i], b = pieces[j];
    const xg = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), yg = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    const gap = Math.max(xg, yg);
    const side = xg >= yg ? Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) : Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (gap < RULES.gapHard - EPS) add('gap', a, RULES.gapHard - gap, true, gap < 0 ? `Your ${name(a)} and ${name(b)} overlap.` : `Your ${name(a)} and ${name(b)} are ${fmt(r4(gap))} in apart; the rule is at least ${RULES.gapHard}.`, b.ref ? b.ref.id : b.id);
    else if (side > 1 && gap <= 6 && (gap < RULES.gapMin - EPS || gap > RULES.gapMax + EPS)) add('gap-soft', a, gap < RULES.gapMin ? RULES.gapMin - gap : gap - RULES.gapMax, false, `Your ${name(a)} and ${name(b)} are ${fmt(r4(gap))} in apart; ${RULES.gapMin} to ${RULES.gapMax} looks most even.`, b.ref ? b.ref.id : b.id);
  }
  return out;
}
const overlapsBox = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

// When every piece of yours has a spot where it hangs now, the wall as it is always
// comes back, even when it breaks a rule: it's the person's real wall. `breaks` says
// which rules, by how much. Added after the others when layout() didn't make it.
function withAsIs(input, r) {
  const owned = (input.owned || []).filter((p) => !p.pinned);
  const prefs = input.prefs || {};
  if (!owned.length || !owned.every((p) => p.at && num(p.at.x) && num(p.at.y)) || (num(prefs.pieces) && prefs.pieces >= 1) || (Array.isArray(input.base) && input.base.length)) return r;
  const ctx = prepare(input);
  const a = arrangement(ctx, owned.map((p) => ({ id: p.id, x: p.at.x, y: p.at.y })), 'asis');
  const have = r.layouts.findIndex((L) => L.variant === 'asis');
  if (have >= 0) {
    const layouts = r.layouts.slice();
    layouts[have] = { ...layouts[have], breaks: a.breaks };
    return { ...r, layouts };
  }
  const L = { ...a.out, rank: r.layouts.length + 1, breaks: a.breaks };
  return { ...r, layouts: [...r.layouts, L] };
}

// ---------- Leaving out as few pieces as possible ----------

function* combos(list, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i < list.length; i++) { acc.push(list[i]); yield* combos(list, k, i + 1, acc); acc.pop(); }
}

// Pieces you keep that can't all go up together: try leaving out one, then two, the
// smallest first, and return the walls of the first ones that work. Never more than
// a third of them (rounded down), so seven never become three.
const DROP_TRIES = 12;   // combinations tried per number left out, smallest first
const DROP_SETS = 2;     // how many different sets left out the list shows
function dropFewest(input, first) {
  const owned = input.owned || [];
  const musts = owned.filter((p) => p.keep === 'must' && !p.pinned);
  if (musts.length < 2) return first;
  const ctx = prepare(input);
  const maxDrop = Math.max(1, Math.floor(musts.length / 3));
  const area = (ps) => ps.reduce((s, p) => s + p.w * p.h, 0);
  const prefs = { ...(input.prefs || {}), dropFewest: false };
  for (let k = 1; k <= maxDrop; k++) {
    const sets = [...combos(musts, k)].sort((a, b) => area(a) - area(b) || cmpStr(a.map((p) => p.id).join(), b.map((p) => p.id).join())).slice(0, DROP_TRIES);
    const found = [];
    for (const [i, drop] of sets.entries()) {
      const out = new Set(drop.map((p) => p.id));
      const rest = musts.filter((p) => !out.has(p.id));
      // A quick look first: can the rest be packed on the open wall at all? (The first set is always tried in full.)
      if (i > 0 && !canPack({ wall: ctx.wall, obstacles: ctx.obstacles, space: ctx.space, pinned: ctx.pinned, pieces: rest })) continue;
      const sub = layoutOnce({ ...input, prefs, owned: owned.map((p) => (out.has(p.id) ? { ...p, keep: 'dontcare' } : p)) });
      const walls = sub.layouts.filter((L) => drop.every((p) => !L.pieces.some((x) => x.ref.id === p.id)));
      if (walls.length) found.push({ drop, walls });
      if (found.length >= DROP_SETS) break;
    }
    if (!found.length) continue;
    const n = musts.length;
    const layouts = [];
    // "The smallest" only when it is; otherwise it's the smallest that makes room.
    const smallest = sets[0].map((p) => p.id).join();
    for (const { drop, walls } of found) {
      const ids = new Set(drop.map((p) => p.id));
      const least = drop.map((p) => p.id).join() === smallest;
      const why = drop.length === 1
        ? `Left off so the other ${words(n - 1)} fit: all ${words(n)} don't fit on this wall together, and ${least ? "it's the smallest" : "it's one of the smallest"}.`
        : `Left off so the other ${words(n - drop.length)} fit: all ${words(n)} don't fit on this wall together, and ${least ? 'these are the smallest' : 'these are among the smallest'}.`;
      for (const L of walls) layouts.push({ ...L, dropped: [...ids], left: L.left.map((l) => (ids.has(l.id) ? { ...l, reason: why, dropped: true } : l)) });
    }
    const count = num(input.count) && input.count >= 1 ? Math.floor(input.count) : 3;
    const list = layouts.slice(0, Math.max(count, found.length)).map((L, i) => ({ ...L, rank: i + 1 }));
    const names = found[0].drop.map((p) => shortTitle(titleOf(p)));
    const problem = { code: 'LEFT_OUT', pieces: found[0].drop.map((p) => p.id), sets: found.map((f) => f.drop.map((p) => p.id)), message: `All ${words(n)} of your pieces don't fit on this wall together, so these walls leave out ${k === 1 ? `your ${names[0]}` : `${words(k)} of them`}${found[0].drop.map((p) => p.id).join() === smallest ? (k === 1 ? ', the smallest' : ', the smallest') : ''}.` };
    return { ...first, layouts: list, problems: [problem, ...first.problems.filter((p) => p.code === 'FAMILY_SKIPPED')] };
  }
  return first;
}
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const words = (n) => WORDS[n] || String(n);

// The pieces you keep can't all go up together here: say so plainly, with the area
// when that's the reason, instead of comparing their widths with one stretch of wall.
function mustsDontFit(must, ctx) {
  const art = must.reduce((s, p) => s + p.w * p.h, 0);
  const n = must.length;
  if (canPack({ wall: ctx.wall, obstacles: ctx.obstacles, space: ctx.space, pinned: ctx.pinned, pieces: must })) return null;
  const sqft = (v) => Math.round(v / 144 * 10) / 10;
  const big = art > 0.8 * ctx.space.area;
  return {
    code: 'MUSTS_DONT_FIT', count: n,
    message: big
      ? `Your ${words(n)} pieces cover ${sqft(art)} sq ft together, and this wall has ${sqft(ctx.space.area)} sq ft of open space.`
      : `Your ${words(n)} pieces don't all fit on this wall together, around the furniture and with room between them.`,
  };
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
    return { id: c.id, w: p.w, h: p.h, frame: p.frame || frameOf(soldAs(c, p.w, p.h)), keep: keepIds.has(c.id) ? 'must' : null, kept: keepIds.has(c.id), title: titleOf(c), cat: c, taste: ctx.pickTaste(c) };
  };
  const slots = hung.map((p) => {
    const sl = p.slot || { x: p.x, y: p.y, w: p.w, h: p.h };
    return { w: sl.w, h: sl.h, dx: sl.x - g.x, dy: sl.y - g.y, row: p.row, role: p.role, side: p.side || null, g: p.group || 0, fixed: stays(p) ? fixedFor(p) : null };
  });
  const st = { family: prev.family, variant: prev.variant, W: g.w, H: g.h, slots, meta: { rows: prev.meta.rows, cols: prev.meta.cols, gaps: prev.meta.gaps, ragged: prev.meta.ragged || 0, groups: prev.meta.groups || 1 } };

  const onWall = new Set(hung.filter(stays).map((p) => p.ref.id));
  // opts.to: put this one catalog piece in the swapped spot (a person picked it).
  const to = swap && typeof opts.to === 'string' ? opts.to : null;
  if (to && onWall.has(to)) throw new TypeError(`${to} is already on this layout.`);
  const cands = to
    ? ctx.catalogCands.filter((c) => c.id === to)
    : [
      ...ctx.catalogCands.filter((c) => !onWall.has(c.id)),
      ...ctx.loose.filter((p) => p.keep !== 'must' && !onWall.has(p.id)).map(ownedCand),
    ];
  const index = indexCandidates(cands);
  const where = { x: g.x, y: g.y, w: g.w, h: g.h, shift: Math.abs(g.x + g.w / 2 - ctx.zone.cx) };
  const picked = fill(st, index, ctx.pairSim, ctx.hasRoom, replaced, ctx.look, ctx.prefs.budget);
  if (!picked) {
    if (ctx.prefs.budget !== null && fill(st, index, ctx.pairSim, ctx.hasRoom, replaced, ctx.look)) {
      return { layouts: [], zone: zoneOut(ctx.zone), problems: [{ code: 'BUDGET_TOO_LOW', message: `New art for these frames would cost at least $${Math.round(costFloor(st, index, replaced))}, over your budget.` }] };
    }
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
  const cost = costOf(best.pieces);
  if (ctx.prefs.budget !== null && cost.forBudget > ctx.prefs.budget + EPS) {
    return { layouts: [], zone: zoneOut(ctx.zone), problems: [{ code: 'BUDGET_TOO_LOW', message: cost.unknown ? 'Some of this art has no price yet, so it can\'t be checked against your budget.' : `New art for these frames would cost $${Math.round(cost.known)}, over your budget.` }] };
  }
  return { layouts: [finish(best, 1, ctx)], problems, zone: zoneOut(ctx.zone) };
}

/**
 * Every catalog piece that comes in the frame size of one spot on a layout, best
 * first: favorites that fit first, then the rest, each by how well it sits there
 * (taste, colors with the pieces around it, not a look-alike of one of them). The
 * pieces already on the wall are left out.
 * @param {object} input the same input layout() gets
 * @param {object} prev a layout layout() or refill() returned
 * @param {string} id the catalog piece in the spot
 * @param {{ favorites?: string[] }} [opts]
 * @returns {{ id: string, favorite: boolean, value: number }[]}
 */
export function spotChoices(input, prev, id, opts = {}) {
  if (!prev || !Array.isArray(prev.pieces)) throw new TypeError('spotChoices() needs a layout.');
  const p = prev.pieces.find((x) => x.ref.id === id);
  if (!p) throw new TypeError(`${id} isn't on this layout.`);
  const ctx = prepare(input);
  const onWall = new Set(prev.pieces.map((x) => x.ref.id));
  const around = prev.pieces.filter((x) => x.ref.id !== id).map((x) => x.ref.id);
  if (ctx.hasRoom) around.push(ROOM);
  const fav = new Set(idList(opts.favorites, 'favorites'));
  const key = sizeKey(p.w, p.h);
  const out = [];
  for (const c of ctx.catalogCands) {
    if (onWall.has(c.id) || !c.sizes.some((sz) => sizeKey(sz.w, sz.h) === key)) continue;
    out.push({ id: c.id, favorite: fav.has(c.id), value: r3(pickValue(c, around, ctx.pairSim, ctx.look)) });
  }
  out.sort((a, b) => (b.favorite - a.favorite) || b.value - a.value || cmpStr(a.id, b.id));
  return out;
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
  const b2 = 2 * RULES.frameBorder;
  const fitsStandard = (s, tol) => STANDARD.some(([w, h]) => [[w, h], [w + b2, h + b2]].some(([a, b]) => Math.abs(s.w - a) <= tol && Math.abs(s.h - b) <= tol)) && s.w <= zone.interval.w && s.h <= zone.maxH;
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

// A wire or hanger drop is a distance below the frame's top, inside the frame.
// Anything else (negative, past the bottom) is treated as not measured.
const goodDrop = (p) => num(p.drop) && p.drop >= 0 && p.drop < p.h;

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
  const matMap = assignMats(L.pieces, { family: L.family, variant: L.variant, level: ctx.prefs.matLevel });
  const pieces = L.pieces.map((p, i) => {
    const drop = goodDrop(p) ? p.drop : RULES.defaultDrop;
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
    if (!goodDrop(p)) out.nailNote = `Assumes the wire sits ${RULES.defaultDrop} in below the top. Measure yours first.`;
    // Which group the piece is in, so a refill keeps the groups.
    const gi = L.st && L.st.slots[i] && L.st.slots[i].g;
    if (gi) out.group = gi;
    if (p.ref.source === 'catalog') Object.assign(out, { artist: p.artist, year: p.year, collection: p.collection, url: p.url, image: p.image }, p.frame ? { frame: p.frame } : {});
    if (matMap.has(p.ref.id)) { out.mat = matMap.get(p.ref.id); if (out.mat && p.frame && p.frame.can && p.frame.can.mat) out.print = p.frame.can.mat; }
    if (p.ref.source === 'owned' && p.keep) out.keep = p.keep;
    if (p.kept) out.kept = true;
    return out;
  });
  for (const p of pinned) {
    const drop = goodDrop(p) ? p.drop : RULES.defaultDrop;
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
    rank, key: L.key, place: zone.place, family: L.family, variant: L.variant, score: r3(Math.max(0, Math.min(1, L.score))), ...(L.weak ? { weak: true } : {}),
    parts: r3map(L.parts),
    checks: r3map(L.checks),
    color: {
      scheme: c.scheme, colors: c.schemeColors, lean: c.lean,
      shares: topShares(c.wall.shares), chromatic: r3(c.wall.chromatic), value: r3map(c.wall.value),
      repeated: c.repeated.map((x) => x.family),
    },
    anchor, group: { x: q(group.x), y: q(group.y), w: q(group.w), h: q(group.h) },
    pieces, left, ...(() => { const c = costOf(pieces); return { total: c.known, priceUnknown: c.unknown }; })(),
    meta: { rows: L.meta.rows, cols: L.meta.cols || null, gaps: L.meta.gaps.map(q), ragged: q(L.meta.ragged || 0), groups: L.meta.groups || 1 },
  };
  out.summary = summary({ ...out, meta: L.meta, group, beside: zone.beside }, mustTitles, newCount, keptTitles);
  out.why = whyLine(out, { ownedTotal: (ctx.owned || []).length, obstacles: ctx.obstacles || [] });
  out.notes = layoutNotes({ color: c, design: L.design, checks: L.checks, family: L.family, pieces: L.pieces });
  return out;
}

// ---------- Walls with sections ----------
// A wall edge (a corner, a step, a column) splits the wall into sections that art
// never crosses. One group can only sit in one of them, so on its own layout() leaves
// the others bare. Here each section wide enough gets its own walls, and they are put
// together and judged as one: the whole wall's color, balance and design, each
// section's own score, a line the groups share, and the bigger section carrying the
// bigger group. No print goes up twice.

const SECTION = {
  minWidth: 24,      // narrower than this, a section gets no art of its own
  perSection: 6,     // walls tried per section
  combos: 240,       // most combinations judged quickly
  finalists: 10,     // combinations judged as a whole wall
  count: 8,          // walls asked of each section
  keep: 6,           // section walls returned
  weights: { whole: 0.55, sections: 0.3, together: 0.15 },
};

// The wall's sections, left to right, from its wall edges: [{ x0, x1 }].
export function wallSections(input) {
  const W = input && input.wall ? input.wall.width : 0;
  const edges = ((input && input.obstacles) || []).filter((o) => o && o.kind === 'edge').map((o) => o.x + o.w / 2).filter((x) => x > 0 && x < W).sort((a, b) => a - b);
  const out = [];
  let x0 = 0;
  for (const e of edges) { if (e - x0 > 0.5) out.push({ x0, x1: e }); x0 = e; }
  if (W - x0 > 0.5) out.push({ x0, x1: W });
  return out;
}

const centerX = (o) => (o.at ? o.at.x + o.w / 2 : null);

// One section as a wall of its own: the obstacles in it, shifted; your pieces that hang
// in it; the pieces with no place yet and the kept prints go to the widest section.
function sectionInput(input, sec, widest) {
  const obstacles = (input.obstacles || []).filter((o) => o.kind !== 'edge' && o.x < sec.x1 && o.x + o.w > sec.x0).map((o) => {
    const x0 = Math.max(o.x, sec.x0), x1 = Math.min(o.x + o.w, sec.x1);
    return { ...o, x: x0 - sec.x0, w: Math.max(0.5, x1 - x0) };
  });
  const owned = (input.owned || []).filter((o) => {
    const cx = centerX(o);
    return cx === null ? widest : cx >= sec.x0 && cx < sec.x1;
  }).map((o) => (o.at ? { ...o, at: { x: o.at.x - sec.x0, y: o.at.y } } : o));
  const prefs = { ...(input.prefs || {}) };
  delete prefs.pieces;
  return {
    ...input, wall: { width: sec.x1 - sec.x0, height: input.wall.height }, obstacles, owned,
    keep: widest ? input.keep : [], base: undefined, avoid: undefined, count: SECTION.count, prefs,
  };
}

function withSections(input, r) {
  const prefs = (input && input.prefs) || {};
  if (!input || !input.wall || (num(prefs.pieces) && prefs.pieces >= 1) || (Array.isArray(input.base) && input.base.length)) return r;
  const secs = wallSections(input);
  if (secs.length < 2) return r;
  const open = secs.filter((sc) => sc.x1 - sc.x0 >= SECTION.minWidth);
  if (open.length < 2) return r;
  const widest = open.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
  const owned = input.owned || [];
  const mustIn = (sec) => owned.some((o) => !o.pinned && o.keep === 'must' && (centerX(o) === null ? sec === widest : centerX(o) >= sec.x0 && centerX(o) < sec.x1));
  // Each section's own walls, back in the whole wall's inches.
  const options = [];
  for (const sec of open) {
    const sub = sectionInput(input, sec, sec === widest);
    let got = [];
    try { got = layoutOnce(sub).layouts; } catch { got = []; }
    const walls = got.filter((L) => L.variant !== 'asis').slice(0, SECTION.perSection).map((L) => ({ sec, sub, L, score: L.score }));
    const list = mustIn(sec) ? walls : [{ sec, sub, L: null, score: 0 }, ...walls];
    if (!list.length) return r; // a section that must hold your pieces has no wall
    options.push(list);
  }
  const total = open.reduce((t, sc) => t + (sc.x1 - sc.x0), 0);
  // Walls already shown stay out (Show more walls), like layout()'s own.
  const avoid = new Set(idList(input.avoid, 'avoid'));
  const placedOf = (o) => (o.L ? o.L.pieces.filter((p) => p.role !== 'pinned').map((p) => {
    const sl = p.slot || { x: p.x, y: p.y, w: p.w, h: p.h };
    return { id: p.ref.id, x: sl.x + o.sec.x0, y: sl.y, w: sl.w, h: sl.h, src: p.ref.source, cy: sl.y + sl.h / 2, top: sl.y + sl.h };
  }) : []);
  // How the groups sit together: a shared middle or top line, and art in step with each section's width.
  const together = (combo) => {
    const lit = combo.filter((o) => o.L);
    if (lit.length < 2) return 0;
    const spans = lit.map((o) => { const ps = placedOf(o); const y0 = Math.min(...ps.map((p) => p.y)), y1 = Math.max(...ps.map((p) => p.top)); return { mid: (y0 + y1) / 2, top: y1, area: ps.reduce((a, p) => a + p.w * p.h, 0), width: o.sec.x1 - o.sec.x0 }; });
    let line = 0, n = 0;
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
      const d = Math.min(Math.abs(spans[i].mid - spans[j].mid), Math.abs(spans[i].top - spans[j].top));
      line += Math.max(0, 1 - d / 8); n++;
    }
    const art = spans.reduce((a, x) => a + x.area, 0), wid = spans.reduce((a, x) => a + x.width, 0);
    const share = 1 - spans.reduce((a, x) => a + Math.abs(x.area / art - x.width / wid), 0) / 2;
    return 0.6 * (line / n) + 0.4 * share;
  };
  const quick = (combo) => combo.reduce((t, o) => t + (o.L ? o.score : 0) * ((o.sec.x1 - o.sec.x0) / total), 0);
  // Every combination, up to the cap, judged quickly first.
  let combos = [[]];
  for (const list of options) {
    const next = [];
    for (const c of combos) for (const o of list) next.push([...c, o]);
    combos = next.slice(0, SECTION.combos * 4);
  }
  combos = combos.filter((c) => c.filter((o) => o.L).length >= 2);
  if (!combos.length) return r;
  combos = combos.map((c) => ({ c, q: quick(c) * 0.75 + together(c) * 0.25 })).sort((a, b) => b.q - a.q).slice(0, SECTION.combos);
  const finals = [];
  const seenKeys = new Set();
  for (const { c } of combos) {
    if (finals.length >= SECTION.finalists) break;
    // No print twice: a section that repeats one from an earlier section gets another in that frame.
    const used = new Set();
    const fixed = [];
    let ok = true;
    for (const o of c) {
      if (!o.L) { fixed.push(o); continue; }
      let L = o.L;
      for (const p of L.pieces.filter((x) => x.ref.source === 'catalog' && used.has(x.ref.id))) {
        let rr = null;
        try { rr = refill({ ...o.sub, exclude: [...idList(o.sub.exclude, 'exclude'), ...used] }, L, { swap: p.ref.id }); } catch { rr = null; }
        if (!rr || !rr.layouts.length) { ok = false; break; }
        L = rr.layouts[0];
      }
      if (!ok) break;
      for (const p of L.pieces) if (p.ref.source === 'catalog') used.add(p.ref.id);
      fixed.push({ ...o, L, score: L.score });
    }
    if (!ok) continue;
    const placed = fixed.flatMap(placedOf).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    let a;
    try { a = scoreArrangement(input, placed, { variant: 'sections' }); } catch { continue; }
    if (!a.ok) continue;
    const key = `sections|${fixed.map((o) => (o.L ? o.L.key : 'bare')).join('|')}`;
    if (seenKeys.has(key) || avoid.has(key)) continue;
    seenKeys.add(key);
    const secMean = quick(fixed);
    const tog = together(fixed);
    const w = SECTION.weights;
    const score = w.whole * a.score + w.sections * secMean + w.together * tog;
    finals.push({ ...a.layout, key, family: 'flow', variant: 'sections', score: r3(Math.max(0, Math.min(1, score))), sections: fixed.map((o) => ({ x0: o.sec.x0, x1: o.sec.x1, art: !!o.L })), parts: { ...a.layout.parts, together: r3(tog), sections: r3(secMean) } });
  }
  if (!finals.length) return r;
  finals.sort((x, y) => y.score - x.score || cmpStr(x.key, y.key));
  const add = finals.slice(0, SECTION.keep);
  // Section walls go in among the others by score; the wall as it hangs stays last.
  const asis = r.layouts.filter((L) => L.variant === 'asis');
  const rest = r.layouts.filter((L) => L.variant !== 'asis');
  const merged = [...rest, ...add].sort((x, y) => y.score - x.score || cmpStr(x.key, y.key));
  // The first wall stays the one layout() led with unless a section wall beats it clearly.
  if (rest.length && merged[0] !== rest[0] && merged[0].score < rest[0].score + 0.02) { merged.splice(merged.indexOf(rest[0]), 1); merged.unshift(rest[0]); }
  const layouts = [...merged, ...asis].map((L, i) => ({ ...L, rank: i + 1 }));
  // Walls were found after all: drop the problems that said none fit.
  const problems = rest.length ? r.problems : r.problems.filter((p) => p.code === 'FAMILY_SKIPPED');
  return { ...r, layouts, problems, sections: secs };
}
