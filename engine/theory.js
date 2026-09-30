// Color theory for a whole wall. Each piece has a color profile: how much of it is
// each color family, where its color sits on the color wheel, how much of it is
// colorful at all, and how dark or light it is. The wall's profile is the
// area-weighted sum of its pieces. Checks and weights: ENGINE.md, "v2".

import { lch, hexToLab } from './color.js';
import { clamp01 } from './geometry.js';

export const FAMILIES = ['red', 'pink', 'orange', 'yellow', 'brown', 'green', 'teal', 'blue', 'purple', 'black', 'gray', 'white'];
export const NEUTRAL = new Set(['black', 'gray', 'white']);
const BINS = 12;

// The same thresholds as tools/analyze.py families() and color.js colorName().
export function familyOfLab(lab) {
  const [L, C, h] = lch(lab);
  if (L < 18) return 'black';
  if (C < 12) return L > 88 ? 'white' : 'gray';
  if (h >= 345 || h < 15) return L > 70 ? 'pink' : 'red';
  if (h < 50) return L < 50 && C < 45 ? 'brown' : L > 72 ? 'pink' : 'red';
  if (h < 75) return L < 55 && C < 55 ? 'brown' : 'orange';
  if (h < 105) return L < 45 ? 'brown' : 'yellow';
  if (h < 170) return 'green';
  if (h < 225) return 'teal';
  if (h < 315) return 'blue';
  return L > 72 ? 'pink' : 'purple';
}

// A plain name for a place on the painter's wheel, in degrees.
export function hueName(deg) {
  const h = ((deg % 360) + 360) % 360;
  if (h >= 322 || h < 34) return 'red';
  if (h < 83) return 'orange';
  if (h < 131) return 'yellow';
  if (h < 195) return 'green';
  if (h < 223) return 'teal';
  if (h < 278) return 'blue';
  return 'purple';
}

// Lab hue angles don't match the painter's color wheel that color schemes come
// from (in Lab, blue sits 120 degrees from orange, not across from it). Schemes are
// judged on the painter's wheel: red 0, orange 60, yellow 120, green 180, blue 240,
// violet 300. These anchors map one onto the other, from typical colors of each.
const WHEEL = [[36, 0], [61, 60], [97, 120], [142, 180], [200, 210], [250, 235], [300, 255], [320, 285], [350, 330], [396, 360]];
export function toWheel(labDeg) {
  let h = ((labDeg % 360) + 360) % 360;
  if (h < WHEEL[0][0]) h += 360;
  for (let i = 1; i < WHEEL.length; i++) {
    const [a, x] = WHEEL[i - 1], [b, y] = WHEEL[i];
    if (h <= b) return (x + ((h - a) / (b - a)) * (y - x)) % 360;
  }
  return 0;
}

// A 12-slice Lab hue histogram, moved onto the painter's wheel. Each slice's
// share is split between the two wheel slices nearest to where it lands.
export function wheelHist(labHues) {
  const out = new Array(BINS).fill(0);
  labHues.forEach((v, i) => {
    if (!v) return;
    const pos = toWheel(i * 30 + 15) / 30 - 0.5;
    const lo = Math.floor(pos), t = pos - lo;
    out[((lo % BINS) + BINS) % BINS] += v * (1 - t);
    out[(((lo + 1) % BINS) + BINS) % BINS] += v * t;
  });
  return out;
}

// Which color families can sit in each slice of the painter's wheel (30 degrees a slice).
const BIN_FAMILIES = [
  ['red', 'pink', 'brown'], ['red', 'orange', 'pink', 'brown'], ['orange', 'yellow', 'brown'], ['yellow', 'brown'],
  ['yellow', 'green'], ['green'], ['green', 'teal'], ['teal', 'blue'], ['blue'], ['blue', 'purple'], ['purple', 'pink'], ['red', 'pink', 'purple'],
];

const WARM = (h) => h < 100 || h >= 330;
const COOL = (h) => h >= 170 && h < 300;

// Estimated profile from a palette ([{ lab, weight }]), for owned pieces, test art
// and the room. Rougher than a measured one, since a palette is only a few colors.
export function profileFromPalette(pal, extra = {}) {
  const shares = {};
  const hues = new Array(BINS).fill(0);
  const value = { dark: 0, mid: 0, light: 0 };
  let chromatic = 0, bright = 0, chromaSum = 0, warm = 0, cw = 0;
  for (const c of pal || []) {
    const lab = c.lab || hexToLab(c.hex);
    const [L, C, h] = lch(lab);
    const f = familyOfLab(lab);
    shares[f] = (shares[f] || 0) + c.weight;
    if (C >= 12) {
      chromatic += c.weight;
      hues[Math.floor(h / 30) % BINS] += c.weight * C;
    }
    value[L < 35 ? 'dark' : L > 70 ? 'light' : 'mid'] += c.weight;
    bright += c.weight * L / 100;
    chromaSum += c.weight * C;
    warm += c.weight * C * (WARM(h) ? 1 : COOL(h) ? -1 : 0);
    cw += c.weight * C;
  }
  const hs = hues.reduce((a, b) => a + b, 0);
  const known = (pal || []).length > 0;
  return {
    measured: false,
    known,
    shares: known ? shares : { gray: 1 },
    hues: hs > 0 ? hues.map((v) => v / hs) : hues,
    chromatic: known ? chromatic : 0,
    value: known ? value : { dark: 0, mid: 1, light: 0 },
    brightness: known ? bright : 0.5,
    saturation: clamp01(chromaSum / 60),
    warmth: cw > 0 ? Math.max(-1, Math.min(1, (warm / cw) * Math.min(1, chromaSum / 20))) : 0,
    busy: extra.busy ?? 0.2,
    contrast: extra.contrast ?? 0.4,
    negativeSpace: extra.negativeSpace ?? 0.35,
    styles: extra.styles || [],
    weight: extra.weight ?? clamp01(0.55 * (known ? 1 - bright : 0.5) + 0.25 * clamp01(chromaSum / 60) + 0.2 * 0.2),
    focal: null,
    category: extra.category ?? null,
    theme: extra.theme ?? null,
    bw: known ? chromatic < 0.02 : false,
  };
}

// Measured profile from a catalog record (see CATALOG.md).
export function profileFromRecord(r) {
  const c = r.color, k = r.composition;
  return {
    measured: true,
    known: true,
    shares: { ...c.shares },
    hues: [...c.hues],
    chromatic: c.chromatic,
    value: { ...c.value },
    brightness: c.brightness,
    saturation: c.saturation,
    warmth: c.warmth,
    busy: k.busyness,
    contrast: c.contrast,
    negativeSpace: k.negativeSpace,
    styles: [...r.tags.style],
    weight: k.weight,
    focal: { ...k.focal },
    category: r.category,
    theme: r.tags.theme,
    bw: c.bw,
  };
}

// Area-weighted sum of piece profiles. items: [{ profile, area }]
export function wallColors(items) {
  const shares = Object.fromEntries(FAMILIES.map((f) => [f, 0]));
  const hues = new Array(BINS).fill(0);
  const value = { dark: 0, mid: 0, light: 0 };
  let area = 0, chromatic = 0;
  for (const { profile: p, area: a } of items) {
    area += a;
    for (const [f, s] of Object.entries(p.shares)) if (f in shares) shares[f] += a * s;
    for (let i = 0; i < BINS; i++) hues[i] += a * p.chromatic * p.hues[i];
    for (const v of ['dark', 'mid', 'light']) value[v] += a * p.value[v];
    chromatic += a * p.chromatic;
  }
  const hs = hues.reduce((x, y) => x + y, 0);
  const n = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, area ? v / area : 0]));
  return { shares: n(shares), hues: hs ? hues.map((v) => v / hs) : hues, value: n(value), chromatic: area ? chromatic / area : 0 };
}

// ---------- Harmony schemes ----------

// Slices of the painter's wheel each scheme covers, relative to a rotation. A slice is 30 degrees.
export const SCHEMES = [
  { name: 'monochromatic', lobes: [[0, 1, 2]], cost: 0 },
  { name: 'analogous', lobes: [[0, 1, 2, 3, 4]], cost: 0.06 },
  { name: 'complementary', lobes: [[0, 1], [6, 7]], cost: 0.06 },
  { name: 'split complementary', lobes: [[0, 1], [5], [8]], cost: 0.08 },
  { name: 'triadic', lobes: [[0, 1], [4, 5], [8, 9]], cost: 0.1 },
];

function smooth(h) {
  return h.map((v, i) => 0.8 * v + 0.1 * h[(i + BINS - 1) % BINS] + 0.1 * h[(i + 1) % BINS]);
}

// Circular mean hue (degrees) of the histogram mass in some bins.
function lobeHue(hist, bins) {
  let x = 0, y = 0;
  for (const b of bins) {
    const a = ((b * 30 + 15) * Math.PI) / 180;
    x += hist[b] * Math.cos(a); y += hist[b] * Math.sin(a);
  }
  const d = (Math.atan2(y, x) * 180) / Math.PI;
  return d < 0 ? d + 360 : d;
}

// Which scheme the wall's color follows, and how much of its color fits it.
// nameShares: the color amounts to name colors from (the art alone, not the room).
export function harmony(wc, nameShares = wc.shares) {
  if (wc.chromatic < 0.12) return { scheme: 'neutral', score: 0.9, coverage: 1, colors: [] };
  const hist = smooth(wheelHist(wc.hues));
  let best = null;
  for (const s of SCHEMES) {
    for (let r = 0; r < BINS; r++) {
      const lobes = s.lobes.map((l) => l.map((b) => (b + r) % BINS));
      const cover = lobes.flat().reduce((a, b) => a + hist[b], 0);
      // Every lobe of a multi-color scheme must actually be used, or it's a simpler scheme.
      const used = lobes.every((l) => l.reduce((a, b) => a + hist[b], 0) >= 0.06);
      if (!used) continue;
      const value = cover - s.cost;
      if (!best || value > best.value + 1e-9) best = { s, lobes, cover, value };
    }
  }
  if (!best) return { scheme: 'mixed', score: 0.3, coverage: 0, colors: [] };
  // Name each lobe by the color families that live there: each slice's color is
  // shared among the families that can sit in that slice, by how much of the wall they are.
  const colors = [];
  const lobes = best.lobes.map((l) => ({ l, mass: l.reduce((a, b) => a + hist[b], 0) })).sort((a, b) => b.mass - a.mass);
  for (const { l } of lobes) {
    const mass = {};
    for (const b of l) {
      const fams = BIN_FAMILIES[b].filter((f) => (nameShares[f] || 0) >= 0.02);
      const tot = fams.reduce((x, f) => x + nameShares[f], 0);
      for (const f of fams) mass[f] = (mass[f] || 0) + hist[b] * (nameShares[f] / tot);
    }
    const ranked = Object.entries(mass).filter(([f]) => !colors.includes(f))
      .sort((x, y) => y[1] - x[1] || FAMILIES.indexOf(x[0]) - FAMILIES.indexOf(y[0]));
    if (!ranked.length) continue;
    colors.push(ranked[0][0]);
    // A one-lobe scheme may be two families worth naming, like yellow and orange.
    if (best.lobes.length === 1 && ranked[1] && ranked[1][1] >= 0.3 * ranked[0][1]) colors.push(ranked[1][0]);
  }
  if (!colors.length) colors.push(hueName(lobeHue(hist, lobes[0].l)));
  // A little color matters less than a lot: blend toward neutral when the wall is only slightly colorful.
  const raw = clamp01((best.value - 0.5) / 0.4);
  const t = clamp01((wc.chromatic - 0.12) / 0.2);
  const scheme = best.value < 0.6 ? 'mixed' : best.s.name;
  return { scheme, score: (1 - t) * 0.9 + t * raw, coverage: best.cover, colors };
}

// ---------- Proportion ----------

// How close the wall's color amounts are to 60/30/10. Neutrals count as one color.
// A wall with almost no color is judged on its dark, mid and light split instead.
export function proportion(wc) {
  let parts;
  if (wc.chromatic < 0.05) parts = Object.values(wc.value);
  else {
    const neutral = [...NEUTRAL].reduce((s, f) => s + (wc.shares[f] || 0), 0);
    parts = [neutral, ...FAMILIES.filter((f) => !NEUTRAL.has(f)).map((f) => wc.shares[f] || 0)];
  }
  const sorted = parts.sort((a, b) => b - a);
  const ideal = [0.6, 0.3, 0.1];
  const d = sorted.reduce((s, v, i) => s + Math.abs(v - (ideal[i] || 0)), 0) / 2;
  return { score: clamp01(1 - Math.max(0, d - 0.1) / 0.45), split: sorted.slice(0, 3) };
}

// ---------- Repetition ----------

// Every color that's at least 4% of the wall should show up in two places (a piece
// or the room), so it reads as a choice. One lonely accent is fine in the focal piece.
export function repetition(pieces, wc, focalIdx, room) {
  if (pieces.length < 2) return { score: 1, repeated: [], lonely: [] };
  let ok = 0, total = 0, allowance = 1;
  const repeated = [], lonely = [];
  const fams = FAMILIES.filter((f) => !NEUTRAL.has(f) && (wc.shares[f] || 0) >= 0.04)
    .sort((a, b) => wc.shares[b] - wc.shares[a] || FAMILIES.indexOf(a) - FAMILIES.indexOf(b));
  for (const f of fams) {
    const share = wc.shares[f];
    const holders = pieces.map((p, i) => ((p.profile.shares[f] || 0) >= 0.08 ? i : -1)).filter((i) => i >= 0);
    const inRoom = room && (room.shares[f] || 0) >= 0.1;
    total += share;
    // Spread thin across the wall with no piece strong in it: it isn't a lonely accent.
    if (!holders.length && !inRoom) { ok += share; continue; }
    if (holders.length + (inRoom ? 1 : 0) >= 2) { ok += share; repeated.push({ family: f, pieces: holders.length, room: !!inRoom }); }
    else if (allowance && holders.length === 1 && holders[0] === focalIdx) { ok += share; allowance = 0; lonely.push({ family: f, piece: holders[0], allowed: true }); }
    else lonely.push({ family: f, piece: holders[0] ?? null, allowed: false });
  }
  return { score: total ? ok / total : 1, repeated, lonely };
}

// ---------- Temperature, saturation, value ----------

export function temperature(pieces, wc) {
  let warm = 0, cool = 0;
  for (const p of pieces) {
    const w = p.area * p.profile.chromatic * Math.abs(p.profile.warmth);
    if (p.profile.warmth > 0.05) warm += w; else if (p.profile.warmth < -0.05) cool += w;
  }
  const neutral = [...NEUTRAL].reduce((s, f) => s + (wc.shares[f] || 0), 0);
  const conflict = warm + cool > 0 ? Math.min(warm, cool) / (warm + cool) : 0;
  const lean = warm > cool * 1.5 ? 'warm' : cool > warm * 1.5 ? 'cool' : warm + cool > 0 ? 'mixed' : 'neutral';
  return { score: clamp01(1 - (Math.max(0, 2 * conflict - 0.3) / 0.7) * (1 - 0.6 * neutral)), lean };
}

export function saturation(pieces, focalIdx) {
  const vivid = pieces.map((p, i) => ({ s: p.profile.saturation, i })).filter(({ i }) => pieces[i].profile.chromatic > 0.15);
  if (vivid.length < 2) return { score: 1 };
  const max = Math.max(...vivid.map((v) => v.s));
  // Only the focal piece may be the loud one.
  const rest = vivid.filter((v) => !(v.i === focalIdx && v.s === max)).map((v) => v.s);
  if (rest.length < 2) return { score: 1 };
  const range = Math.max(...rest) - Math.min(...rest);
  return { score: clamp01(1 - Math.max(0, range - 0.12) / 0.3) };
}

export function valueCheck(pieces) {
  if (pieces.length < 2) return { score: 1 };
  const A = pieces.reduce((s, p) => s + p.area, 0);
  const mean = pieces.reduce((s, p) => s + p.area * p.profile.brightness, 0) / A;
  const sd = Math.sqrt(pieces.reduce((s, p) => s + p.area * (p.profile.brightness - mean) ** 2, 0) / A);
  // Some light and dark variation; not all the same, not all extremes.
  const score = sd < 0.06 ? 0.6 + 0.4 * (sd / 0.06) : sd > 0.28 ? clamp01(1 - (sd - 0.28) / 0.2) : 1;
  return { score, sd };
}

// ---------- The color score ----------

export const COLOR_WEIGHTS = Object.freeze({ harmony: 0.3, proportion: 0.15, repetition: 0.2, temperature: 0.1, saturation: 0.1, value: 0.05, room: 0.1 });

// pieces: [{ profile, area }]; room: { profile, sim } or null, where sim is how
// close the wall's pieces are to the room's palette (0 to 1).
export function colorScore(pieces, focalIdx, room) {
  const wallArea = pieces.reduce((s, p) => s + p.area, 0);
  // The room counts as one more piece, a quarter of the wall's area, for the scheme only.
  const withRoom = room ? [...pieces, { profile: room.profile, area: 0.25 * wallArea }] : pieces;
  const wcAll = wallColors(withRoom);
  const wc = wallColors(pieces);
  const h = harmony(wcAll, wc.shares);
  const pr = proportion(wc);
  const rep = repetition(pieces, wc, focalIdx, room && room.profile);
  const t = temperature(pieces, wc);
  const s = saturation(pieces, focalIdx);
  const v = valueCheck(pieces);
  const checks = { harmony: h.score, proportion: pr.score, repetition: rep.score, temperature: t.score, saturation: s.score, value: v.score };
  if (room) checks.room = clamp01((room.sim - 0.2) / 0.5);
  const W = COLOR_WEIGHTS;
  const keys = Object.keys(checks);
  const wsum = keys.reduce((a, k) => a + W[k], 0);
  const score = keys.reduce((a, k) => a + W[k] * checks[k], 0) / wsum;
  return { score, checks, wall: wc, scheme: h.scheme, schemeColors: h.colors, repeated: rep.repeated, lonely: rep.lonely, lean: t.lean, split: pr.split };
}
