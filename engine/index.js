// Walldrobe layout engine.
//
// layout(input) takes one wall, what's on it, the art the person owns and a list
// of candidate art, and returns ranked layouts with every piece's position in
// inches and one sentence on why it's there. Pure: no DOM, no network, no clock.
// Same input, same output. Spec: ENGINE.md.

import { RULES, WEIGHTS, SEARCH, FAMILIES, STANDARD } from './constants.js';
import { hexToRgb, normalizePalette, paletteSimilarity, hueFamilyCount, tone } from './color.js';
import { blockedRegions, findZone, placeGroup, checkPieces, clamp01, cmpStr, q, EPS } from './geometry.js';
import { salonStructures, lineStructures, gridStructures, statementStructures } from './structures.js';
import { pieceReason, leftReason, summary, shortTitle } from './reasons.js';

export { RULES, WEIGHTS } from './constants.js';
export const VERSION = '0.1.1';

const KEEPS = new Set(['must', 'happy', 'dontcare']);
const REUSE_BONUS = 0.04;
const OWNED_PICK_BONUS = { happy: 0.15, dontcare: 0.05 };
const ROOM = '\u0000room';
const sizeKey = (w, h) => `${w}x${h}`;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const titleOf = (p) => (p.title && String(p.title).trim()) || 'piece';

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
  for (const c of input.catalog || []) {
    if (!c || !c.id || !Array.isArray(c.sizes)) throw new TypeError(`Catalog piece ${(c && c.id) || '(no id)'} needs an id and sizes.`);
    if (ids.has(c.id)) throw new TypeError(`Duplicate id ${c.id}.`);
    checkPalette(c.palette, c.id);
    ids.add(c.id);
  }
  if (input.room) checkPalette(input.room.palette, 'the room');
}

function readPrefs(raw = {}) {
  return {
    budget: num(raw.budget) && raw.budget >= 0 ? raw.budget : null,
    maxPieces: num(raw.maxPieces) && raw.maxPieces >= 1 ? Math.floor(raw.maxPieces) : 9,
    families: Array.isArray(raw.families) ? raw.families.filter((f) => FAMILIES.includes(f)) : [...FAMILIES],
  };
}

// ---------- Color memo ----------

function pairSimFactory(palettes, paletteSimilarity) {
  const memo = new Map();
  return (a, b) => {
    const k = a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
    let v = memo.get(k);
    if (v === undefined) { v = paletteSimilarity(palettes.get(a) || [], palettes.get(b) || []); memo.set(k, v); }
    return v;
  };
}

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

// A small beam search. Value of a pick is 0.6 x taste + 0.4 x how well its colors
// sit with what's already chosen, plus an edge for pieces the person already owns.
function fill(struct, index, pairSim, hasRoom) {
  const open = struct.slots
    .map((s, i) => ({ ...s, i }))
    .filter((s) => !s.fixed)
    .sort((a, b) => b.w * b.h - a.w * a.h
      || Math.abs(a.dx + a.w / 2 - struct.W / 2) - Math.abs(b.dx + b.w / 2 - struct.W / 2)
      || a.i - b.i);
  const fixedIds = struct.slots.filter((s) => s.fixed).map((s) => s.fixed.id);
  let beam = [{ picks: [], used: new Set(), artists: new Set(), value: 0, key: '' }];
  for (const slot of open) {
    const opts = optionsFor(index, slot);
    if (!opts.length) return null;
    const next = [];
    for (const st of beam) {
      const ctx = [...fixedIds, ...st.picks.map((p) => p.cand.id)];
      if (hasRoom) ctx.push(ROOM);
      for (const { cand, size } of opts) {
        if (st.used.has(cand.id)) continue;
        const h = ctx.length ? ctx.reduce((s, id) => s + pairSim(cand.id, id), 0) / ctx.length : 0.5;
        let v = 0.6 * cand.taste + 0.4 * h;
        if (cand.artist && st.artists.has(cand.artist)) v -= 0.1;
        if (cand.source === 'owned') v += OWNED_PICK_BONUS[cand.item.keep] || 0;
        next.push({ parent: st, pick: { slot, cand, size }, value: st.value + v, key: `${st.key},${cand.id}` });
      }
    }
    if (!next.length) return null;
    next.sort((a, b) => b.value - a.value || cmpStr(a.key, b.key));
    beam = next.slice(0, SEARCH.beam).map((n) => {
      const used = new Set(n.parent.used); used.add(n.pick.cand.id);
      const artists = new Set(n.parent.artists); if (n.pick.cand.artist) artists.add(n.pick.cand.artist);
      return { picks: [...n.parent.picks, n.pick], used, artists, value: n.value, key: n.key };
    });
  }
  return beam[0];
}

// ---------- Scoring ----------

function scoreLayout(L, zone, palettes, pairSim, hasRoom) {
  const g = L.group;
  const ids = L.pieces.map((p) => p.ref.id);

  // Fit
  const ratio = g.w / zone.refW;
  const target = zone.type === 'anchor' ? RULES.anchorRatio : RULES.wallRatio;
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
  const fg = gapsOk * clamp01(1 - L.meta.ragged / (0.15 * g.w));
  const area = L.pieces.reduce((s, p) => s + p.w * p.h, 0);
  const fd = L.pieces.length === 1 ? 1 : clamp01((area / (g.w * g.h) - 0.5) / 0.3);
  // Presence: a group much shorter than its width looks thin over furniture.
  const fp = clamp01(g.h / (0.45 * zone.target));
  // Pieces you must keep should sit near the middle, not drift to an edge.
  const gcx = g.x + g.w / 2;
  const musts = L.pieces.filter((p) => p.keep === 'must' && p.fixed);
  const fm = musts.length ? clamp01(1 - musts.reduce((s, p) => s + Math.abs(p.cx - gcx) / (g.w / 2), 0) / musts.length) : 1;
  const fit = 0.25 * fw + 0.2 * fv + 0.1 * fs + 0.1 * fg + 0.1 * fd + 0.15 * fp + 0.1 * fm;

  // Taste
  const fresh = L.pieces.filter((p) => !p.fixed);
  const taste = fresh.length ? fresh.reduce((s, p) => s + p.taste, 0) / fresh.length : 0.7;

  // Harmony
  const withPal = (id) => (palettes.get(id) || []).length > 0;
  const context = L.pieces.filter((p) => p.fixed && withPal(p.ref.id)).map((p) => p.ref.id);
  if (hasRoom) context.push(ROOM);
  const freshIds = fresh.map((p) => p.ref.id).filter(withPal);
  let sim = 0.5;
  if (freshIds.length && context.length) {
    let s = 0;
    for (const a of freshIds) for (const b of context) s += pairSim(a, b);
    sim = s / (freshIds.length * context.length);
  } else {
    const all = ids.filter(withPal);
    let s = 0, n = 0;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { s += pairSim(all[i], all[j]); n++; }
    if (n) sim = s / n;
  }
  const fams = hueFamilyCount(ids.map((id) => palettes.get(id) || []));
  const harmony = 0.6 * sim + 0.4 * (fams <= 3 ? 1 : fams === 4 ? 0.7 : 0.4);

  // Balance
  let wsum = 0, wx = 0, wy = 0, left = 0, right = 0;
  for (const p of L.pieces) {
    const t = tone(palettes.get(p.ref.id) || []);
    const wgt = p.w * p.h * (0.3 + 0.7 * t.dark) * (1 + 0.5 * t.sat);
    wsum += wgt; wx += wgt * p.cx; wy += wgt * p.cy;
    if (p.cx < gcx - EPS) left += wgt; else if (p.cx > gcx + EPS) right += wgt; else { left += wgt / 2; right += wgt / 2; }
  }
  const off = wsum ? Math.abs(wx / wsum - gcx) / (g.w / 2) : 0;
  const lr = Math.max(left, right) ? Math.min(left, right) / Math.max(left, right) : 1;
  // Heavier at the bottom reads as settled; heavier at the top reads as about to tip.
  const up = wsum ? (wy / wsum - cy) / (g.h / 2) : 0;
  const fvb = up > 0.1 ? clamp01(1 - (up - 0.1) * 2.5) : 1;
  const balance = 0.4 * clamp01(1 - off * 2) + 0.4 * (L.pieces.length === 1 ? 1 : lr) + 0.2 * fvb;

  const parts = { fit, taste, harmony, balance };
  // Using what you already own is the point: a small bonus for each
  // happy-to-move piece that makes it onto the wall.
  const happyUsed = L.pieces.filter((p) => p.keep === 'happy').length;
  const reuse = L.happyTotal ? REUSE_BONUS * (happyUsed / L.happyTotal) : 0;
  const score = WEIGHTS.fit * fit + WEIGHTS.taste * taste + WEIGHTS.harmony * harmony + WEIGHTS.balance * balance + reuse;
  return { score, parts };
}

// ---------- Main ----------

/**
 * @param {object} input see ENGINE.md
 * @returns {{ layouts: object[], problems: {code: string, message: string}[], zone: object|null }}
 */
export function layout(input) {
  validate(input);
  const wall = input.wall;
  const obstacles = input.obstacles || [];
  const owned = input.owned || [];
  const catalog = input.catalog || [];
  const taste = input.taste || {};
  const prefs = readPrefs(input.prefs);
  const count = num(input.count) && input.count >= 1 ? Math.floor(input.count) : 3;
  const problems = [];

  const pinned = owned.filter((p) => p.pinned);
  const loose = owned.filter((p) => !p.pinned);
  const must = loose.filter((p) => p.keep === 'must');
  const happy = loose.filter((p) => p.keep === 'happy');
  const regions = blockedRegions(obstacles, pinned);
  const zone = findZone(wall, obstacles, regions);
  if (!zone) {
    const short = wall.height - RULES.ceilingHard - RULES.centerline < 4;
    problems.push({
      code: 'NO_OPEN_SPACE',
      message: short ? 'This wall is too short to hang art at eye level.' : "There's no stretch of wall wide enough to hang on.",
    });
    return { layouts: [], problems, zone: null };
  }

  const palettes = new Map();
  for (const p of owned) palettes.set(p.id, normalizePalette(p.palette));
  for (const c of catalog) palettes.set(c.id, normalizePalette(c.palette));
  const room = normalizePalette(input.room && input.room.palette);
  if (room.length) palettes.set(ROOM, room);
  const hasRoom = room.length > 0;
  const pairSim = pairSimFactory(palettes, paletteSimilarity);

  const catalogCands = catalog.map((c) => ({
    id: c.id, source: 'catalog', title: c.title, artist: c.artist || null, item: c,
    sizes: c.sizes.filter((s) => s && num(s.w) && num(s.h) && s.w > 0 && s.h > 0),
    taste: num(taste[c.id]) ? clamp01(taste[c.id]) : 0.5,
  }));
  const ownedCand = (p) => ({
    id: p.id, source: 'owned', title: titleOf(p), artist: null, item: p,
    sizes: [{ w: p.w, h: p.h, price: 0 }], taste: p.keep === 'happy' ? 0.75 : 0.5,
  });

  const variants = happy.length ? [[...must, ...happy], must] : [must];
  const mismatch = new Map(); // family -> number of variants it was skipped in, with its message
  const results = [];

  for (const fixed of variants) {
    const fixedIds = new Set(fixed.map((p) => p.id));
    const cands = [...catalogCands, ...loose.filter((p) => !fixedIds.has(p.id) && p.keep !== 'must').map(ownedCand)];
    const index = indexCandidates(cands);
    const avail = new Map();
    for (const [k, list] of index.bySize) avail.set(k, list.length);
    for (const c of index.owned) for (const [w, h] of STANDARD) {
      if (Math.abs(c.sizes[0].w - w) <= 1 && Math.abs(c.sizes[0].h - h) <= 1) avail.set(sizeKey(w, h), (avail.get(sizeKey(w, h)) || 0) + 1);
    }
    const ctx = { fixed, zone, avail, maxPieces: prefs.maxPieces };

    const structs = [];
    for (const fam of prefs.families) {
      let r;
      if (fam === 'salon') r = { structures: salonStructures(ctx) };
      if (fam === 'line') r = { structures: lineStructures(ctx) };
      if (fam === 'grid') r = gridStructures(ctx);
      if (fam === 'statement') r = statementStructures(ctx);
      structs.push(...r.structures);
      if (r.skipped) mismatch.set(fam, { n: (mismatch.get(fam)?.n || 0) + 1, message: r.skipped });
    }

    for (const st of structs) {
      const picked = fill(st, index, pairSim, hasRoom);
      if (!picked) continue;
      const base = placeGroup(zone, st.W, st.H, regions, wall);
      if (!base) continue;
      const bySlot = new Map(picked.picks.map((p) => [p.slot.i, p]));
      const build = (place) => st.slots.map((slot, i) => {
        let ref, title, w, h, price, extra = {}, keep = null, pickTaste = null, drop = null;
        if (slot.fixed) {
          const p = slot.fixed;
          ref = { source: 'owned', id: p.id }; title = titleOf(p); w = p.w; h = p.h; price = 0; keep = p.keep; drop = p.drop;
        } else {
          const { cand: c, size } = bySlot.get(i);
          ref = { source: c.source, id: c.id }; title = c.title; w = size.w; h = size.h; pickTaste = c.taste;
          if (c.source === 'catalog') {
            price = num(size.price) ? size.price : null;
            extra = { artist: c.item.artist || null, year: c.item.year || null, collection: c.item.source || null, url: c.item.url || null, image: c.item.image || null };
          } else { price = 0; keep = c.item.keep; drop = c.item.drop; }
        }
        const x = q(place.x + slot.dx + (slot.w - w) / 2);
        const y = q(place.y + slot.dy + (slot.h - h) / 2);
        return { id: ref.id, ref, title, w, h, x, y, cx: x + w / 2, cy: y + h / 2, row: slot.row, role: slot.role || 'fill', fixed: !!slot.fixed, keep, price, taste: pickTaste, drop, ...extra };
      });
      // Positions are on the quarter inch before the hard checks, so what passes is what's printed.
      let place = base, pieces = build(base);
      for (const dx of [0.25, -0.25]) {
        if (!checkPieces(pieces, regions, wall).length) break;
        place = { ...base, x: base.x + dx, shift: Math.abs(base.x + dx + st.W / 2 - zone.cx) };
        pieces = build(place);
      }
      if (checkPieces(pieces, regions, wall).length) continue;
      const L = { family: st.family, variant: st.variant || null, meta: st.meta, group: place, shift: place.shift, pieces, happyTotal: happy.length };
      const { score, parts } = scoreLayout(L, zone, palettes, pairSim, hasRoom);
      results.push({ ...L, score, parts });
    }
  }

  // Budget: drop layouts over it, but say what the cheapest one costs.
  const total = (L) => L.pieces.reduce((s, p) => s + (p.price || 0), 0);
  let valid = results;
  if (prefs.budget !== null) {
    valid = results.filter((L) => total(L) <= prefs.budget + EPS);
    if (!valid.length && results.length) {
      problems.push({ code: 'BUDGET_TOO_LOW', message: `The cheapest layout that fits is $${Math.round(Math.min(...results.map(total)))}.` });
    }
  }

  // Rank for variety: best of each family first, then the next best overall.
  valid.sort((a, b) => b.score - a.score || cmpStr(keyOf(a), keyOf(b)));
  const chosen = [];
  const keys = new Set();
  const famsSeen = new Set();
  for (const L of valid) {
    if (chosen.length >= count) break;
    if (famsSeen.has(L.family)) continue;
    famsSeen.add(L.family); keys.add(keyOf(L)); chosen.push(L);
  }
  for (const L of valid) {
    if (chosen.length >= count) break;
    if (keys.has(keyOf(L))) continue;
    keys.add(keyOf(L)); chosen.push(L);
  }
  chosen.sort((a, b) => b.score - a.score || cmpStr(keyOf(a), keyOf(b)));

  const present = new Set(valid.map((L) => L.family));
  for (const fam of prefs.families) {
    if (present.has(fam)) continue;
    const m = mismatch.get(fam);
    const message = m && m.n === variants.length ? m.message : {
      salon: 'No two-row layout fits this wall with the art available.',
      line: 'No single row fits this wall with the art available.',
      grid: 'No grid fits this wall with the art available.',
      statement: 'No statement piece fits this wall with the art available.',
    }[fam];
    problems.push({ code: 'FAMILY_SKIPPED', family: fam, message });
  }

  if (!chosen.length && !problems.some((p) => p.code === 'BUDGET_TOO_LOW')) problems.unshift(whyNothing(must, zone, catalogCands, loose));

  const layouts = chosen.map((L, i) => finish(L, i + 1, zone, owned, pinned, palettes));
  return { layouts, problems, zone: zoneOut(zone) };
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

const keyOf = (L) => `${L.family}:${L.pieces.map((p) => p.ref.id).sort(cmpStr).join(',')}`;

function zoneOut(z) {
  return {
    type: z.type, anchor: z.anchor ? { id: z.anchor.id, kind: z.anchor.kind } : null,
    cx: q(z.cx), target: q(z.target), open: { x0: q(z.interval.x0), x1: q(z.interval.x1) },
  };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

function finish(L, rank, zone, owned, pinned, palettes) {
  const anchor = zone.anchor ? { id: zone.anchor.id, kind: zone.anchor.kind } : { kind: 'wall' };
  const group = { x: L.group.x, y: L.group.y, w: L.group.w, h: L.group.h };
  const ownedIn = L.pieces.filter((p) => p.ref.source === 'owned').map((p) => ({ id: p.ref.id, title: p.title, pal: palettes.get(p.ref.id) || [] }));
  const pieces = L.pieces.map((p) => {
    const drop = num(p.drop) ? p.drop : RULES.defaultDrop;
    const out = {
      ref: p.ref, title: p.title, w: p.w, h: p.h,
      x: p.x, y: p.y, cx: q(p.cx), cy: q(p.cy),
      nail: { x: q(p.cx), y: q(p.y + p.h - drop) },
      role: p.role, row: p.row, price: p.price,
      reason: pieceReason({ piece: p, group, anchorKind: anchor.kind, family: L.family, ownedInLayout: ownedIn.filter((o) => o.id !== p.ref.id), pal: palettes.get(p.ref.id) || [], taste: p.taste ?? 0.5 }),
    };
    if (!num(p.drop)) out.nailNote = `Assumes the wire sits ${RULES.defaultDrop} in below the top. Measure yours first.`;
    if (p.ref.source === 'catalog') Object.assign(out, { artist: p.artist, year: p.year, collection: p.collection, url: p.url, image: p.image });
    if (p.keep) out.keep = p.keep;
    return out;
  });
  for (const p of pinned) {
    const drop = num(p.drop) ? p.drop : RULES.defaultDrop;
    const title = titleOf(p);
    pieces.push({
      ref: { source: 'owned', id: p.id }, title, w: p.w, h: p.h,
      x: p.at.x, y: p.at.y, cx: q(p.at.x + p.w / 2), cy: q(p.at.y + p.h / 2),
      nail: { x: q(p.at.x + p.w / 2), y: q(p.at.y + p.h - drop) }, role: 'pinned', row: null, price: 0, keep: p.keep,
      reason: pieceReason({ piece: { title, role: 'pinned', ref: { source: 'owned' } } }),
    });
  }
  const inIds = new Set(pieces.map((p) => p.ref.id));
  const left = owned.filter((p) => !inIds.has(p.id)).map((p) => ({ id: p.id, title: titleOf(p), reason: leftReason({ ...p, title: titleOf(p) }) }));
  const mustTitles = L.pieces.filter((p) => p.keep === 'must' && p.fixed).map((p) => p.title);
  const newCount = L.pieces.filter((p) => p.ref.source === 'catalog').length;
  const out = {
    rank, family: L.family, variant: L.variant, score: r3(Math.min(1, L.score)),
    parts: Object.fromEntries(Object.entries(L.parts).map(([k, v]) => [k, r3(v)])),
    anchor, group: { x: q(group.x), y: q(group.y), w: q(group.w), h: q(group.h) },
    pieces, left, total: pieces.reduce((s, p) => s + (p.price || 0), 0),
    meta: { rows: L.meta.rows, cols: L.meta.cols || null, gaps: L.meta.gaps.map(q) },
  };
  out.summary = summary({ ...out, meta: L.meta, group }, mustTitles, newCount);
  return out;
}

