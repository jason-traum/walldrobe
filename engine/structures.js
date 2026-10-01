// Layout families. Each generator returns structures: a group size (W x H) and
// slots positioned inside it, relative to the group's bottom-left corner. A slot
// either holds an owned piece already (fixed) or is waiting for art of its size.

import { RULES, SIZES, SEARCH } from './constants.js';
import { cmpStr, q } from './geometry.js';

const G = RULES.gap;
const sizeKey = (w, h) => `${w}x${h}`;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

const fixedUnit = (p) => ({ w: p.w, h: p.h, fixed: p });
const fillUnit = ([w, h]) => ({ w, h, fixed: null });

function unitOrder(a, b) {
  if (a.fixed && b.fixed) return cmpStr(a.fixed.id, b.fixed.id);
  if (a.fixed) return -1;
  if (b.fixed) return 1;
  return a.w - b.w || a.h - b.h;
}

// Pieces you must keep first, then tallest, in the middle, the rest alternating
// outward, so each row reads as one shape.
const isMust = (u) => (u.fixed && u.fixed.keep === 'must' ? 1 : 0);
export function organPipe(units, startRight) {
  const sorted = [...units].sort((a, b) => isMust(b) - isMust(a) || b.h - a.h || b.w - a.w || unitOrder(a, b));
  const out = [];
  let right = startRight;
  for (const u of sorted) {
    if (!out.length) out.push(u);
    else if (right) out.push(u);
    else out.unshift(u);
    if (out.length > 1) right = !right;
  }
  return out;
}

function* multisets(items, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]);
    yield* multisets(items, k, i, acc);
    acc.pop();
  }
}

// Enough art offered in these sizes to fill the slots?
function fitsAvail(fills, avail) {
  const need = new Map();
  for (const [w, h] of fills) need.set(sizeKey(w, h), (need.get(sizeKey(w, h)) || 0) + 1);
  for (const [k, n] of need) if ((avail.get(k) || 0) < n) return false;
  return true;
}

// Widths a family may generate. Scoring pulls toward the target inside this window.
// When the person asks for an exact number of pieces, the window opens up
// (RULES.countRange), so a count they pick fits more often.
function widthWindow(zone, pieces = null) {
  const [a, b] = pieces ? RULES.countRange : [zone.range[0] - 0.05, zone.range[1]];
  const lo = Math.max(RULES.minOpenWidth, zone.refW * a);
  const hi = Math.min(zone.refW * b, zone.interval.w);
  return [lo, hi];
}
// The frame sizes each family builds with: the sizes the art on offer actually
// comes in (so a shop's own framed sizes work), grouped by how big they are.
// The fixed lists in SIZES are the fallback when nothing is offered.
export function offeredSizes(avail) {
  const all = [...avail.keys()].map((k) => k.split('x').map(Number)).sort((a, b) => a[0] * a[1] - b[0] * b[1] || a[0] - b[0]);
  const long = ([w, h]) => Math.max(w, h);
  const pick = (f, fallback) => { const l = all.filter(f); return l.length ? l : fallback; };
  return {
    salon: pick((s) => long(s) >= 8 && long(s) <= 27, SIZES.salon),
    grid: pick((s) => long(s) >= 8 && long(s) <= 27, SIZES.grid),
    flank: pick((s) => long(s) >= 8 && long(s) <= 27, SIZES.flank),
    large: pick((s) => long(s) >= 24 && long(s) <= 60, SIZES.large),
  };
}

// With an exact count, only structures with that many pieces.
const countOk = (n, pieces) => !pieces || n === pieces;

// The size lever: -1 leans to fewer, bigger pieces, 1 to more, smaller ones.
// Used only to order structures before the cut, so the ones asked for survive it.
const lean = (n, scale) => (scale ? 0.08 * scale * (n - 4) : 0);

const sameSize = (a, b) => Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;

// ---------- Two-row hang around a horizontal axis ----------

function rowOptions(fixed, sizes, lo, hi, target, maxRowH = Infinity) {
  const base = fixed.map(fixedUnit);
  const out = [];
  for (let k = 0; k <= 4; k++) {
    for (const ms of multisets(sizes, k)) {
      const units = [...base, ...ms.map(fillUnit)];
      const n = units.length;
      if (n < 1 || n > 5) continue;
      if (n === 1 && !units[0].fixed) continue;
      const width = sum(units.map((u) => u.w)) + (n - 1) * G;
      if (width < lo * 0.85 || width > hi) continue;
      // A row too tall to fit with any row under it never makes the cut.
      if (Math.max(...units.map((u) => u.h)) > maxRowH) continue;
      const kinds = new Set(units.map((u) => sizeKey(u.w, u.h))).size;
      const rank = Math.abs(width - target) / target + (n > 1 && kinds === 1 ? 0.08 : 0);
      out.push({ units, width, maxH: Math.max(...units.map((u) => u.h)), fills: ms, rank });
    }
  }
  out.sort((a, b) => a.rank - b.rank || a.units.length - b.units.length);
  // The best few of each length, so every piece count stays possible.
  const per = new Map();
  return out.filter((o) => { const k = o.units.length, c = per.get(k) || 0; per.set(k, c + 1); return c < Math.ceil(SEARCH.rowOptions / 4); });
}

function equalizeGaps(topN, botN, wT, wB) {
  let gT = G, gB = G;
  const gapsT = Math.max(0, topN - 1), gapsB = Math.max(0, botN - 1);
  let diff = Math.abs(wT - wB);
  const [narrowGaps, wideGaps] = wT < wB ? [gapsT, gapsB] : [gapsB, gapsT];
  const grow = Math.min((RULES.gapMax - G) * narrowGaps, diff);
  diff -= grow;
  const shrink = Math.min((G - RULES.gapMin) * wideGaps, diff);
  diff -= shrink;
  // Gaps land on the quarter inch so what's printed is what's hung.
  const gNarrow = Math.min(RULES.gapMax, q(G + (narrowGaps ? grow / narrowGaps : 0)));
  const gWide = Math.max(RULES.gapMin, q(G - (wideGaps ? shrink / wideGaps : 0)));
  if (wT < wB) { gT = gNarrow; gB = gWide; } else { gB = gNarrow; gT = gWide; }
  return { gT, gB };
}

function buildSalon(t, b) {
  const top = organPipe(t.units, true);
  const bot = organPipe(b.units, false);
  const { gT, gB } = equalizeGaps(top.length, bot.length, t.width, b.width);
  const wT = sum(top.map((u) => u.w)) + (top.length - 1) * gT;
  const wB = sum(bot.map((u) => u.w)) + (bot.length - 1) * gB;
  const ragged = Math.abs(wT - wB);
  const W = Math.max(wT, wB);
  const tH = Math.max(...top.map((u) => u.h));
  const bH = Math.max(...bot.map((u) => u.h));
  const H = tH + G + bH;
  const slots = [];
  let x = q((W - wB) / 2);
  for (const u of bot) { slots.push({ w: u.w, h: u.h, dx: x, dy: q(bH - u.h), fixed: u.fixed, row: 'bottom' }); x += u.w + gB; }
  x = q((W - wT) / 2);
  for (const u of top) { slots.push({ w: u.w, h: u.h, dx: x, dy: q(bH + G), fixed: u.fixed, row: 'top' }); x += u.w + gT; }
  return { family: 'salon', W, H, slots, meta: { ragged, gaps: [gT, gB], axis: bH + G / 2, rows: 2 } };
}

export function salonStructures({ fixed, zone, avail, maxPieces, scale = 0, pieces = null, sizes: offered = SIZES, collect = null }) {
  if (fixed.length > SEARCH.maxFixed) return [];
  const sizes = offered.salon.filter(([w, h]) => avail.has(sizeKey(w, h)));
  const [lo, hi] = widthWindow(zone, pieces || collect);
  const target = Math.min(Math.max(zone.target, lo), hi);
  const ideal = Math.max(4, Math.min(9, Math.round(target / 9) + Math.round(2 * scale)));
  const found = [];
  for (let mask = 0; mask < 1 << fixed.length; mask++) {
    const topFixed = fixed.filter((_, i) => mask & (1 << i));
    const botFixed = fixed.filter((_, i) => !(mask & (1 << i)));
    const minH = sizes.length ? Math.min(...sizes.map(([, h]) => h)) : 8;
    const tops = rowOptions(topFixed, sizes, lo, hi, target, zone.maxH - G - minH);
    const bots = rowOptions(botFixed, sizes, lo, hi, target, zone.maxH - G - minH);
    for (const t of tops) {
      for (const b of bots) {
        const n = t.units.length + b.units.length;
        if (n < (pieces || collect ? 3 : 4) || n > (collect ? 12 : Math.max(maxPieces, pieces || 0)) || !countOk(n, pieces)) continue;
        if (Math.max(t.width, b.width) < lo) continue;
        if (t.maxH + G + b.maxH > zone.maxH) continue;
        if (!fitsAvail([...t.fills, ...b.fills], avail)) continue;
        // One frame size throughout is a grid, not a loose gallery wall.
        if (new Set([...t.units, ...b.units].map((u) => sizeKey(u.w, u.h))).size < 2) continue;
        if (collect) { collect.add(n); continue; }
        const avgW = Math.max(t.width, b.width);
        const imbalance = Math.abs(t.maxH - b.maxH) / Math.max(t.maxH, b.maxH);
        const kinds = new Set([...t.units, ...b.units].map((u) => sizeKey(u.w, u.h))).size;
        const areaT = sum(t.units.map((u) => u.w * u.h)), areaB = sum(b.units.map((u) => u.w * u.h));
        const topHeavy = areaT > areaB * 1.3 ? Math.min(0.3, (areaT / areaB - 1.3) * 0.3) : 0;
        const orient = new Set([...t.units, ...b.units].map((u) => Math.sign(u.w - u.h))).size;
        const pre = -Math.abs(avgW - target) / target * 2
          - Math.abs(t.width - b.width) / target * 1.5
          - imbalance * 0.4
          - topHeavy
          - (kinds < 2 ? 0.15 : 0)
          + (orient > 1 ? 0.05 : 0)
          - Math.abs(n - ideal) * 0.03;
        found.push({ t, b, pre });
      }
    }
  }
  if (collect) return [];
  found.sort((a, b) => b.pre - a.pre);
  const out = [];
  const seen = new Set();
  for (const f of found) {
    const s = buildSalon(f.t, f.b);
    const sig = s.slots.map((sl) => `${sl.row}:${sl.fixed ? sl.fixed.id : sizeKey(sl.w, sl.h)}`).join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    s.pre = f.pre;
    out.push(s);
    if (out.length >= SEARCH.perFamily) break;
  }
  return out;
}

// ---------- One row, centers on one line ----------

export function lineStructures({ fixed, zone, avail, maxPieces, scale = 0, pieces = null, sizes: offered = SIZES }) {
  const [lo, hi] = widthWindow(zone, pieces);
  const base = fixed.map(fixedUnit);
  const heights = base.map((u) => u.h).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : null;
  const out = [];
  const seen = new Set();
  for (const [sw, sh] of offered.grid) {
    if (medH && (sh < 0.6 * medH || sh > 1.3 * medH)) continue;
    for (let nFill = 0; nFill + base.length <= (pieces ? Math.min(7, pieces) : Math.min(5, maxPieces)); nFill++) {
      const n = base.length + nFill;
      if (n < (pieces ? 2 : 3) || !countOk(n, pieces)) continue;
      const fills = Array.from({ length: nFill }, () => [sw, sh]);
      if (nFill && !fitsAvail(fills, avail)) continue;
      const units = [...base, ...fills.map(fillUnit)];
      const W = sum(units.map((u) => u.w)) + (n - 1) * G;
      const H = Math.max(...units.map((u) => u.h));
      if (W < lo || W > hi || H > zone.maxH) continue;
      const sig = nFill ? `${sizeKey(sw, sh)}x${nFill}` : 'fixed-only';
      if (seen.has(sig)) continue;
      seen.add(sig);
      const order = organPipe(units, true);
      const slots = [];
      let x = 0;
      for (const u of order) { slots.push({ w: u.w, h: u.h, dx: x, dy: q((H - u.h) / 2), fixed: u.fixed, row: null }); x += u.w + G; }
      out.push({ family: 'line', W, H, slots, meta: { ragged: 0, gaps: [G], rows: 1 }, pre: -Math.abs(W - zone.target) / zone.target + lean(n, scale) });
    }
  }
  out.sort((a, b) => b.pre - a.pre);
  return out.slice(0, 4);
}

// ---------- Grid of one frame size ----------

export function gridStructures({ fixed, zone, avail, maxPieces, scale = 0, pieces = null, sizes: offered = SIZES }) {
  const [lo, hi] = widthWindow(zone, pieces);
  const out = [];
  let mismatch = fixed.length > 0;
  for (const [sw, sh] of offered.grid) {
    if (!fixed.every((p) => sameSize(p, { w: sw, h: sh }))) continue;
    mismatch = false;
    for (const r of [2, 3]) {
      for (const c of [2, 3, 4]) {
        const n = r * c;
        if (n > Math.max(maxPieces, pieces || 0) || n < fixed.length || !countOk(n, pieces)) continue;
        const W = c * sw + (c - 1) * G;
        const H = r * sh + (r - 1) * G;
        if (W < lo || W > hi || H > zone.maxH) continue;
        const nFill = n - fixed.length;
        if ((avail.get(sizeKey(sw, sh)) || 0) < nFill) continue;
        const cells = [];
        for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
          cells.push({ w: sw, h: sh, dx: j * (sw + G), dy: i * (sh + G), fixed: null, row: null });
        }
        const byCenter = [...cells].sort((a, b) =>
          Math.hypot(a.dx + sw / 2 - W / 2, a.dy + sh / 2 - H / 2) - Math.hypot(b.dx + sw / 2 - W / 2, b.dy + sh / 2 - H / 2)
          || a.dy - b.dy || a.dx - b.dx);
        fixed.forEach((p, i) => { byCenter[i].fixed = p; });
        out.push({
          family: 'grid', W, H, slots: cells, meta: { ragged: 0, gaps: [G], rows: r, cols: c },
          pre: -Math.abs(W - zone.target) / zone.target - (r > c ? 0.05 : 0) + lean(n, scale),
        });
      }
    }
  }
  out.sort((a, b) => b.pre - a.pre);
  return { structures: out.slice(0, 3), skipped: mismatch ? "No grid: every piece in a grid is one frame size, and the pieces you're keeping don't match one." : null };
}

// ---------- One statement piece, alone or with matching pieces on each side ----------

export function statementStructures({ fixed, zone, avail, maxPieces, scale = 0, pieces = null, sizes: offered = SIZES }) {
  const [lo, hi] = widthWindow(zone, pieces);
  // Frames stop at 40 in, so one piece alone may be as narrow as 0.35 of the
  // furniture; the fit score still marks it down for being narrow.
  const soloLo = Math.max(RULES.minOpenWidth, zone.refW * RULES.soloMinRatio);
  // Pieces you must keep take the center before anything else, then the biggest.
  const mustFirst = (p) => (p.keep === 'must' ? 0 : 1);
  const sorted = [...fixed].sort((a, b) => mustFirst(a) - mustFirst(b) || b.w * b.h - a.w * a.h || cmpStr(a.id, b.id));
  const center = sorted[0] || null;
  const others = sorted.slice(1);
  const centers = center
    ? [fixedUnit(center)]
    : offered.large.filter(([w, h]) => avail.has(sizeKey(w, h))).map(fillUnit);

  let flankSizes = [];
  let flankFixed = [];
  let skipped = null;
  if (!others.length) flankSizes = offered.flank.filter(([w, h]) => avail.has(sizeKey(w, h)));
  else if (others.length === 1 || (others.length === 2 && sameSize(others[0], others[1]))) {
    flankSizes = [[others[0].w, others[0].h]];
    flankFixed = others;
  } else {
    skipped = 'No statement layout: too many pieces to keep, in different sizes.';
  }

  const out = [];
  if (!others.length && countOk(1, pieces)) {
    for (const c of centers) {
      if (c.w < soloLo || c.w > hi || c.h > zone.maxH) continue;
      out.push({
        family: 'statement', variant: 'solo', W: c.w, H: c.h,
        slots: [{ w: c.w, h: c.h, dx: 0, dy: 0, fixed: c.fixed, row: null, role: 'center' }],
        meta: { ragged: 0, gaps: [], rows: 1 }, pre: -Math.abs(c.w - zone.target) / zone.target - 0.05 + lean(1, scale),
      });
    }
  }

  for (const c of centers) {
    for (const [fw, fh] of flankSizes) {
      const W = c.w + 2 * (fw + G);
      if (W < lo || W > hi) continue;
      const modes = [];
      if (fh >= 0.45 * c.h && fh <= 0.85 * c.h) modes.push('single');
      const stackH = 2 * fh + G;
      if (stackH >= 0.8 * c.h && stackH <= 1.1 * c.h) modes.push('stack');
      for (const mode of modes) {
        const H = mode === 'stack' ? Math.max(c.h, stackH) : c.h;
        const n = 1 + (mode === 'stack' ? 4 : 2);
        if (H > zone.maxH || n > Math.max(maxPieces, pieces || 0) || flankFixed.length > n - 1 || !countOk(n, pieces)) continue;
        const cy = H / 2; // positions quantized below
        const slots = [{ w: c.w, h: c.h, dx: fw + G, dy: cy - c.h / 2, fixed: c.fixed, row: null, role: 'center' }];
        const flankSlots = [];
        for (const side of ['left', 'right']) {
          const dx = side === 'left' ? 0 : fw + G + c.w + G;
          if (mode === 'single') flankSlots.push({ w: fw, h: fh, dx, dy: cy - fh / 2, fixed: null, row: null, role: 'flank', side });
          else {
            const y0 = cy - stackH / 2;
            flankSlots.push({ w: fw, h: fh, dx, dy: y0 + fh + G, fixed: null, row: null, role: 'flank', side });
            flankSlots.push({ w: fw, h: fh, dx, dy: y0, fixed: null, row: null, role: 'flank', side });
          }
        }
        flankFixed.forEach((p, i) => { flankSlots[i].fixed = p; });
        for (const sl of [...slots, ...flankSlots]) { sl.dx = q(sl.dx); sl.dy = q(sl.dy); }
        const fills = [...(c.fixed ? [] : [[c.w, c.h]]), ...flankSlots.filter((s) => !s.fixed).map((s) => [s.w, s.h])];
        if (!fitsAvail(fills.filter(([w, h]) => offered.flank.concat(offered.large).some(([a, b]) => a === w && b === h)), avail)) continue;
        out.push({
          family: 'statement', variant: mode, W, H, slots: [...slots, ...flankSlots],
          meta: { ragged: 0, gaps: [G], rows: 1 }, pre: -Math.abs(W - zone.target) / zone.target + lean(n, scale),
        });
      }
    }
  }
  out.sort((a, b) => b.pre - a.pre);
  const solos = out.filter((s) => s.variant === 'solo').slice(0, 2);
  const rest = out.filter((s) => s.variant !== 'solo').slice(0, 4);
  return { structures: [...rest, ...solos].sort((a, b) => b.pre - a.pre), skipped };
}

// ---------- A stack in a narrow stretch, centers on one vertical line ----------

// A column only makes sense where the wall is narrow: beside the TV or furniture,
// or a narrow open wall.
export const columnZone = (zone) => zone.place === 'left' || zone.place === 'right' || zone.interval.w < RULES.columnMaxOpen;

export function columnStructures({ fixed, zone, avail, maxPieces, scale = 0, pieces = null, sizes: offered = SIZES }) {
  if (!columnZone(zone) || fixed.length > 4) return { structures: [], skipped: null };
  const [lo, hi] = widthWindow(zone, pieces);
  const base = fixed.map(fixedUnit);
  const most = Math.min(4, pieces || Math.max(2, maxPieces));
  const out = [];
  const seen = new Set();
  const fillSizes = [null, ...offered.flank.filter(([w, h]) => avail.has(sizeKey(w, h)))];
  for (const sz of fillSizes) {
    for (let nFill = sz ? 1 : 0; base.length + nFill <= most && (sz || nFill === 0); nFill++) {
      const n = base.length + nFill;
      if (n < 2 || !countOk(n, pieces)) continue;
      const fills = sz ? Array.from({ length: nFill }, () => sz) : [];
      if (nFill && !fitsAvail(fills, avail)) continue;
      const units = [...base, ...fills.map(fillUnit)];
      const W = Math.max(...units.map((u) => u.w));
      const H = sum(units.map((u) => u.h)) + (n - 1) * G;
      if (W < lo || W > hi || H > zone.maxH) continue;
      // Every piece at least most of the column's width, so it reads as one stack.
      if (units.some((u) => u.w < 0.6 * W)) continue;
      // Each order once: top to bottom.
      for (const order of orders(units)) {
        const sig = order.map((u) => (u.fixed ? u.fixed.id : sizeKey(u.w, u.h))).join('|');
        if (seen.has(sig)) continue;
        seen.add(sig);
        const slots = [];
        let y = 0;
        for (const u of [...order].reverse()) { slots.push({ w: u.w, h: u.h, dx: q((W - u.w) / 2), dy: q(y), fixed: u.fixed, row: null }); y += u.h + G; }
        // Heavier at the bottom reads as steadier; a much bigger piece on top is marked down.
        const area = (u) => u.w * u.h;
        const topHeavy = area(order[0]) > 1.6 * area(order[order.length - 1]) ? 0.1 : 0;
        out.push({ family: 'column', W, H, slots, meta: { ragged: 0, gaps: [G], rows: n }, pre: -Math.abs(W - zone.target) / zone.target - topHeavy + lean(n, scale) });
      }
    }
  }
  out.sort((a, b) => b.pre - a.pre);
  return { structures: out.slice(0, 4), skipped: null };
}

// The different top-to-bottom orders of a few pieces (same-size fills are alike).
function orders(units) {
  if (units.length <= 1) return [units];
  const out = [];
  const seen = new Set();
  units.forEach((u, i) => {
    const k = u.fixed ? u.fixed.id : sizeKey(u.w, u.h);
    if (seen.has(k)) return;
    seen.add(k);
    for (const rest of orders(units.filter((_, j) => j !== i))) out.push([u, ...rest]);
  });
  return out;
}
