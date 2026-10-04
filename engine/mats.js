// Mats: which new pieces get one, and how good that choice looks on the wall. Pure.
//
// Design principles (how framers and stylists do it):
//  - A structured wall (a grid, a row, a stack, one statement piece, a neat free-form) is
//    one system: every frame the same, so every mat the same, all or none.
//  - A loose wall (a salon hang, a free-form gallery) can mix, and a mix should look
//    chosen: pieces the same size match; no single piece is the odd one out; the matted
//    ones spread across the wall rather than bunching on one side.
//  - A mat gives a small print room; a big piece does the work on its own. When mixing,
//    the smallest frames get mats first.
//  - Only what's easy to buy: each size says whether it can go matted (`can.mat`, the
//    print inside) and whether it can go without (`can.plain`). A piece with one way has
//    that way.
//  - How many is a preference (`level`): none, few, some, most, all.

export const MAT_LEVELS = Object.freeze(['none', 'few', 'some', 'most', 'all']);
const SHARE = { none: 0, few: 0.25, some: 0.5, most: 0.75, all: 1 };
const STRUCTURED = new Set(['grid', 'line', 'column', 'statement']);

export const isStructured = (family, variant) => STRUCTURED.has(family) || (family === 'flow' && variant === 'neat');
const shareOf = (level) => (SHARE[level] != null ? SHARE[level] : SHARE.some);
const key = (p) => `${Math.min(p.w, p.h)}x${Math.max(p.w, p.h)}`;
const canOf = (p) => (p.frame && p.frame.can) || null;

/**
 * Which new pieces get a mat.
 * @param {object[]} pieces a layout's pieces (catalog pieces carry frame.can)
 * @param {{ family?: string, variant?: string, level?: string }} opts
 * @returns {Map<string, boolean>} piece id to matted, for every piece that has frame.can
 */
export function assignMats(pieces, { family = 'flow', variant = null, level = 'some' } = {}) {
  const out = new Map();
  const flex = [];
  for (const p of pieces) {
    const can = canOf(p);
    if (!can) continue;
    if (can.mat && can.plain) flex.push(p);
    else out.set(p.ref ? p.ref.id : p.id, !!can.mat);
  }
  if (!flex.length) return out;
  const share = shareOf(level);
  const id = (p) => (p.ref ? p.ref.id : p.id);
  if (isStructured(family, variant)) {
    // One system: all the same. Some leans to whatever the pieces that have no choice already are.
    const forced = [...out.values()];
    const m = forced.filter(Boolean).length;
    const all = share > 0.5 ? true : share < 0.5 ? false : m > forced.length - m;
    for (const p of flex) out.set(id(p), all);
    return out;
  }
  // A mix: a whole size at a time, smallest first, while that brings the count closer.
  const groups = new Map();
  for (const p of flex) { const k = key(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const area = (k) => k.split('x').reduce((a, b) => a * b, 1);
  const order = [...groups].sort((a, b) => area(a[0]) - area(b[0]) || (a[0] < b[0] ? -1 : 1));
  const want = share * flex.length;
  let n = 0;
  for (const [, ps] of order) {
    const take = share >= 1 || (share > 0 && Math.abs(n + ps.length - want) < Math.abs(n - want));
    for (const p of ps) out.set(id(p), take);
    if (take) n += ps.length;
  }
  // No odd one out: with four or more, a single piece that differs from all the rest
  // matches them, when it has the choice, unless it's the one big piece (a statement
  // piece without a mat among small matted ones reads as chosen).
  const states = [...out.entries()];
  if (states.length >= 4) {
    const lone = loneOne(pieces.filter((p) => out.has(id(p))), out, id);
    if (lone && flex.some((p) => id(p) === lone)) out.set(lone, !out.get(lone));
  }
  return out;
}

// The one piece whose mat differs from every other, unless it's the single biggest.
function loneOne(ps, mats, id) {
  const on = ps.filter((p) => mats.get(id(p)));
  const odd = on.length === 1 ? on[0] : on.length === ps.length - 1 ? ps.find((p) => !mats.get(id(p))) : null;
  if (!odd) return null;
  const a = odd.w * odd.h;
  if (ps.every((p) => p === odd || p.w * p.h < a)) return null;
  return id(odd);
}

/**
 * How well a wall's mats follow the principles, 0 to 1.
 * @param {object[]} pieces
 * @param {Map<string, boolean>} mats from assignMats()
 * @param {{ family?: string, variant?: string, level?: string }} opts
 */
export function matScore(pieces, mats, { family = 'flow', variant = null, level = 'some' } = {}) {
  const ps = pieces.filter((p) => mats.has(p.ref ? p.ref.id : p.id));
  const n = ps.length;
  if (n < 2) return 1;
  const on = (p) => mats.get(p.ref ? p.ref.id : p.id);
  const m = ps.filter(on).length;
  const majority = Math.max(m, n - m) / n;
  const fit = 1 - Math.abs(m / n - shareOf(level));
  if (isStructured(family, variant)) return 0.75 * ((majority - 0.5) * 2) + 0.25 * fit;
  const lonely = n >= 4 && loneOne(ps, mats, (p) => (p.ref ? p.ref.id : p.id)) ? 0 : 1;
  let pairs = 0, off = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (key(ps[i]) === key(ps[j])) { pairs++; if (on(ps[i]) !== on(ps[j])) off++; }
  const same = pairs ? 1 - off / pairs : 1;
  let balance = 1;
  if (m && m < n) {
    const x0 = Math.min(...ps.map((p) => p.x)), x1 = Math.max(...ps.map((p) => p.x + p.w));
    const mid = (x0 + x1) / 2, W = Math.max(1, x1 - x0);
    const mat = ps.filter(on), A = mat.reduce((s, p) => s + p.w * p.h, 0);
    const cx = mat.reduce((s, p) => s + (p.x + p.w / 2) * p.w * p.h, 0) / A;
    balance = Math.max(0, 1 - (2 * Math.abs(cx - mid)) / W);
  }
  return 0.6 * (0.35 * lonely + 0.35 * same + 0.3 * balance) + 0.4 * fit;
}
