// Taste from pairwise picks. Each piece becomes a feature vector built from its
// catalog record (theme, style, mood, and measured color and composition); each
// "I like this one more" nudges a weight vector toward the winner (a Bradley-Terry
// model, fit by gradient steps). The quiz picks each next pair where the model is
// least sure, so ten picks teach it more than ten random ones. Pure and deterministic.
// Later the features get image embeddings; the interface stays the same.

import { THEMES, STYLES, MOODS } from './catalog.js';
import { normalizePalette, paletteSimilarity, lch } from './color.js';
import { profileFromPalette, toWheel } from './theory.js';
import { PROFILE, COMPLEMENT } from './constants.js';

const rec = (item) => item.record || item;

export const FEATURE_NAMES = [
  ...THEMES.map((t) => `theme:${t}`),
  ...STYLES.map((s) => `style:${s}`),
  ...MOODS.map((m) => `mood:${m}`),
  'black and white', 'painting', 'people',
  'light', 'contrast', 'vivid', 'warm', 'busy', 'empty space',
];

export function features(item) {
  const r = rec(item);
  const t = r.tags, c = r.color, k = r.composition;
  const has = (list, v) => (list.includes(v) ? 1 : 0);
  return [
    ...THEMES.map((x) => (t.theme === x ? 1 : 0)),
    ...STYLES.map((x) => has(t.style, x)),
    ...MOODS.map((x) => has(t.mood, x)),
    c.bw ? 1 : 0,
    r.medium === 'painting' ? 1 : 0,
    t.people ? 1 : 0,
    c.brightness - 0.5,
    c.contrast - 0.5,
    c.colorfulness - 0.4,
    c.warmth / 2,
    (k.busyness - 0.2) * 2,     // busyness spans about 0 to 0.5, so scale it to match the others
    k.negativeSpace - 0.35,
  ];
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// picks: [{ winner, loser }]. Returns weights, or null with no picks.
export function fitTaste(picks, { steps = 80, rate = 0.6, l2 = 0.03 } = {}) {
  if (!picks.length) return null;
  const dim = FEATURE_NAMES.length;
  const w = new Array(dim).fill(0);
  const pairs = picks.map(({ winner, loser }) => {
    const a = features(winner), b = features(loser);
    return a.map((x, i) => x - b[i]);
  });
  for (let s = 0; s < steps; s++) {
    const g = new Array(dim).fill(0);
    for (const d of pairs) {
      const p = sigmoid(dot(w, d));
      for (let i = 0; i < dim; i++) g[i] += (1 - p) * d[i];
    }
    for (let i = 0; i < dim; i++) w[i] += rate * (g[i] / pairs.length - l2 * w[i]);
  }
  // Few picks, little confidence: the weights shrink toward neutral until there are
  // enough picks to trust them (one pick counts a quarter, ten about three quarters).
  const sure = picks.length / (picks.length + TASTE_PRIOR);
  return w.map((x) => x * sure);
}
const TASTE_PRIOR = 3;
const TASTE_SCALE = 1.5;

// Scores from 0.1 to 0.9 for every item, ready for layout({ taste }). Each piece's
// score depends only on the weights and that piece, never on what else is in the list,
// so adding art doesn't move the scores of the rest, and weak evidence stays near 0.5.
export function scoreTaste(weights, items) {
  const out = {};
  if (!weights) { for (const it of items) out[it.id] = 0.5; return out; }
  for (const it of items) out[it.id] = Math.round((0.5 + 0.4 * Math.tanh(dot(weights, features(it)) / TASTE_SCALE)) * 1000) / 1000;
  return out;
}

// A shortlist for the quiz: a few pieces per theme, the clearest examples first
// (strong measured character), so pairs are easy to judge.
function shortlist(items, perTheme = 6) {
  const out = [];
  for (const th of THEMES) {
    const list = items.filter((it) => rec(it).tags.theme === th)
      .sort((a, b) => {
        const ka = rec(a), kb = rec(b);
        const sa = ka.color.contrast + ka.color.colorfulness + (1 - ka.composition.busyness);
        const sb = kb.color.contrast + kb.color.colorfulness + (1 - kb.composition.busyness);
        return sb - sa || cmp(a.id, b.id);
      });
    // Spread picks across categories inside a theme.
    const byCat = new Map();
    for (const it of list) { const c = rec(it).category; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(it); }
    const cats = [...byCat.keys()];
    for (let i = 0; out.filter((x) => rec(x).tags.theme === th).length < perTheme && i < list.length; i++) {
      const pool = byCat.get(cats[i % cats.length]);
      const next = pool && pool.shift();
      if (next) out.push(next);
    }
  }
  return out;
}

const OPENERS = [['summer', 'art'], ['city', 'nature'], ['still life', 'mono'], ['animals', 'sport']];

function bestPair(sl, feats, scoreOf) {
  let best = null;
  for (let i = 0; i < sl.length; i++) {
    for (let j = i + 1; j < sl.length; j++) {
      const a = sl[i], b = sl[j];
      if (rec(a).category === rec(b).category) continue;
      const fa = feats.get(a.id), fb = feats.get(b.id);
      const d = fa.map((x, n) => x - fb[n]);
      const score = scoreOf(d, a, b);
      const key = `${a.id}|${b.id}`;
      if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && key < best.key)) best = { score, key, pair: [a, b] };
    }
  }
  return best ? best.pair : null;
}

// The next pair to ask about, never showing a piece twice or two pieces of one
// category together. The first four pairs contrast whole themes. After that the
// quiz alternates:
//   test: a pair that differs most on what the model already leans toward, so a
//         real either-or choice confirms or corrects it;
//   explore: a pair that differs most on what the model knows nothing about yet.
// With no picks at all (every pair skipped), it keeps contrasting themes.
export function nextPair(items, picks, shownIds = new Set()) {
  // The shortlist is drawn from what hasn't been shown, so a second test gets fresh pairs, not leftovers.
  const sl = shortlist(items.filter((it) => !shownIds.has(it.id)));
  const step = Math.floor(shownIds.size / 2); // pairs shown so far, skips included
  const opener = OPENERS[step % OPENERS.length];
  if (step < OPENERS.length || !picks.length) {
    const a = sl.find((it) => rec(it).tags.theme === opener[0]);
    const b = sl.find((it) => rec(it).tags.theme === opener[1] && it !== a);
    if (a && b) return [a, b];
  }
  const w = fitTaste(picks) || new Array(FEATURE_NAMES.length).fill(0);
  const feats = new Map(sl.map((it) => [it.id, features(it)]));
  const abs = w.map(Math.abs);
  const maxW = Math.max(...abs, 1e-9);
  const known = abs.map((x) => x / maxW);
  if (step % 2 === 0) {
    return bestPair(sl, feats, (d) => d.reduce((s, x, n) => s + known[n] * Math.abs(x), 0));
  }
  return bestPair(sl, feats, (d) => d.reduce((s, x, n) => s + (1 - known[n]) * Math.abs(x), 0));
}

// Plain words for what the model learned, strongest first, e.g.
// ["sunny summer shots", "black and white", "lots of empty space"].
const WORDS = {
  'theme:summer': 'summer and the sea', 'theme:sport': 'sport outdoors', 'theme:city': 'cities and buildings', 'theme:nature': 'nature and open sky',
  'theme:still life': 'still lifes', 'theme:art': 'paintings and graphic art', 'theme:animals': 'animals', 'theme:mono': 'black and white',
  'style:minimal': 'minimal', 'style:graphic': 'graphic', 'style:aerial': 'views from above', 'style:film': 'film photos',
  'style:documentary': 'real moments', 'style:painterly': 'painterly', 'style:still life': 'objects up close', 'style:portrait': 'portraits',
  'mood:sunny': 'sunny', 'mood:calm': 'calm', 'mood:moody': 'moody and dark', 'mood:bold': 'bold color', 'mood:playful': 'playful', 'mood:elegant': 'elegant',
  'black and white': 'black and white', painting: 'paintings', people: 'people in the picture', light: 'light and bright',
  contrast: 'high contrast', vivid: 'vivid color', warm: 'warm tones', busy: 'lots going on', 'empty space': 'lots of empty space',
};
// Words that say the same thing share a group, and only the strongest of a
// group is used. Opposites share a group too, so "calm" and "lots going on"
// never both appear.
const GROUP = {
  'mood:bold': 'color', vivid: 'color',
  'theme:art': 'art', painting: 'art', 'style:painterly': 'art', 'style:graphic': 'graphic',
  'theme:mono': 'mono', 'black and white': 'mono', 'style:film': 'film',
  'mood:sunny': 'light', light: 'light', 'mood:moody': 'light',
  'mood:calm': 'busy', busy: 'busy', 'empty space': 'busy', 'style:minimal': 'busy',
  'theme:still life': 'still', 'style:still life': 'still',
};
export function describeTaste(weights, n = 3) {
  if (!weights) return [];
  const used = new Set();
  const out = [];
  for (const { f } of FEATURE_NAMES.map((f, i) => ({ f, w: weights[i] })).filter((x) => x.w > 0.05).sort((a, b) => b.w - a.w || cmp(a.f, b.f))) {
    const g = GROUP[f] || f;
    const word = WORDS[f];
    if (!word || used.has(g) || out.includes(word)) continue;
    used.add(g);
    out.push(word);
    if (out.length >= n) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Taste, deeper: axes, a profile in words, corrections and complements.
// ENGINE.md, "Taste, deeper". Pure: no clock, seeded randomness only.


// The axes, each from what the catalog record actually carries. 0 is the low
// side, 1 the high side; a lean above 0 is toward the high side.
export const AXES = Object.freeze([
  { axis: 'warm', low: 'cool', high: 'warm', name: 'warm vs cool' },
  { axis: 'busy', low: 'calm', high: 'busy', name: 'calm vs busy' },
  { axis: 'abstract', low: 'figurative', high: 'abstract', name: 'figurative vs abstract' },
  { axis: 'print', low: 'photos', high: 'prints', name: 'photos vs prints' },
  { axis: 'light', low: 'dark', high: 'light', name: 'light vs dark' },
  { axis: 'vivid', low: 'muted', high: 'vivid', name: 'muted vs vivid' },
  { axis: 'bw', low: 'color', high: 'black and white', name: 'color vs black and white' },
]);
export const AXIS_NAMES = AXES.map((a) => a.axis);
const AX = new Map(AXES.map((a, i) => [a.axis, i]));
const K = AXES.length;
// Axes that say nothing about a black and white piece: it sits in the middle of
// them, and pairs and picks with one don't count on them (the bw axis does that).
const COLOR_ONLY = new Set(['warm', 'vivid']);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const r3 = (v) => Math.round(v * 1000) / 1000;
const recordOf = (item) => {
  if (!item) return null;
  const r = item.record || item;
  return r && r.color && r.composition && r.tags ? r : null;
};

const ABSTRACT_CAT = { abstract: 0.85, lines: 0.75, shadows: 0.55, graphic: 0.45 };
const ABSTRACT_WORDS = new Set(['abstract', 'pattern', 'stripes', 'shapes', 'lines', 'line', 'curves', 'curve', 'color blocks',
  'circles', 'circle', 'layers', 'geometric', 'brushstrokes', 'brushstroke', 'brushwork', 'texture', 'drips', 'blocks', 'loops',
  'forms', 'grid', 'paper shapes', 'op art']);
function abstractness(r) {
  const t = r.tags, subj = t.subjects || [];
  const share = subj.length ? subj.filter((s) => ABSTRACT_WORDS.has(s)).length / subj.length : 0;
  let v = Math.max(ABSTRACT_CAT[r.category] ?? 0.1, 0.15 + 0.85 * share);
  if (subj.includes('abstract')) v = Math.max(v, 0.9);
  if (t.style.includes('minimal') && t.style.includes('graphic')) v += 0.1;
  if (t.people) v -= 0.15;
  return clamp01(v);
}

// Warmth of a palette, -1 to 1, on the painter's wheel: red-orange is warmest,
// blue-green coolest, and grays count for nothing.
function paletteWarmth(pal) {
  let s = 0, w = 0, chroma = 0;
  for (const c of pal) {
    const [, C, h] = lch(c.lab);
    chroma += c.weight * C;
    if (C < 12) continue;
    s += c.weight * C * Math.cos(((toWheel(h) - 30) * Math.PI) / 180);
    w += c.weight * C;
  }
  return w ? (s / w) * Math.min(1, chroma / 20) : 0;
}

const axesCache = new WeakMap();
// Where a piece sits on every axis, 0 to 1. A catalog piece from its record; a
// piece of yours from its palette (axes the palette can't tell sit at 0.5).
export function axesOf(item) {
  if (item && typeof item === 'object' && axesCache.has(item)) return axesCache.get(item);
  const r = recordOf(item);
  let out;
  if (r) {
    const c = r.color, k = r.composition;
    out = {
      warm: c.bw ? 0.5 : clamp01((c.warmth + 1) / 2),
      busy: clamp01(0.7 * clamp01((k.busyness - 0.03) / 0.42) + 0.3 * (1 - clamp01(k.negativeSpace / 0.7))),
      abstract: abstractness(r),
      print: r.medium === 'photo' ? 0 : 1,
      light: clamp01((c.brightness - 0.2) / 0.65),
      vivid: c.bw ? 0.5 : clamp01(c.colorfulness / 0.8),
      bw: c.bw ? 1 : 0,
    };
  } else {
    const pal = normalizePalette((item && item.palette) || []);
    const p = profileFromPalette(pal);
    const bw = p.known && p.bw;
    out = {
      warm: bw ? 0.5 : clamp01((paletteWarmth(pal) + 1) / 2),
      busy: item && typeof item.busy === 'number' ? clamp01(item.busy) : 0.5,
      abstract: 0.5,
      print: 0.5,
      light: clamp01((p.brightness - 0.2) / 0.65),
      vivid: bw ? 0.5 : clamp01(p.saturation),
      bw: bw ? 1 : 0,
    };
  }
  for (const a of AXIS_NAMES) out[a] = r3(out[a]);
  Object.freeze(out);
  if (item && typeof item === 'object') axesCache.set(item, out);
  return out;
}

const isBw = (item) => axesOf(item).bw === 1;

// How two pieces differ on every axis, winner minus loser. Warmth and vividness
// are not compared when either piece is black and white.
function axisDiff(a, b) {
  const pa = axesOf(a), pb = axesOf(b);
  const bw = isBw(a) || isBw(b);
  return AXIS_NAMES.map((x) => (bw && COLOR_ONLY.has(x) ? 0 : pa[x] - pb[x]));
}

// Small dense linear algebra for the K by K systems below.
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let j = c; j <= n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c || !M[r][c]) continue;
      const f = M[r][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row[n]);
}
function inverseDiag(A) {
  const n = A.length;
  return A.map((_, i) => solve(A, A.map((__, j) => (j === i ? 1 : 0)))[i]);
}
const eye = (n, v) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? v : 0)));

// Picks may hold the pieces or their ids ([winnerId, loserId] or { winner, loser }).
function resolvePicks(picks, catalog) {
  const byId = catalog ? new Map(catalog.map((c) => [c.id, c])) : new Map();
  const get = (x) => (typeof x === 'string' ? byId.get(x) : x);
  return (picks || []).map((p) => (Array.isArray(p) ? { winner: get(p[0]), loser: get(p[1]) } : { winner: get(p.winner), loser: get(p.loser) }))
    .filter((p) => p.winner && p.loser);
}

// How much the picks have tested each axis: 0 (never) to 1. From the information
// the pairs carry (0.25 d d' each, as if every pick were a coin flip), so pairs
// that split two axes at once count for less on each.
function sureOf(diffs) {
  const I = eye(K, PROFILE.prior);
  for (const d of diffs) for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) I[i][j] += 0.25 * d[i] * d[j];
  return inverseDiag(I).map((v) => clamp01(1 - Math.sqrt(PROFILE.prior * v)));
}

// Axis weights from picks: a Bradley-Terry model on the axis differences, fit by
// Newton steps with a weak prior toward no lean.
function fitAxisWeights(diffs) {
  const w = new Array(K).fill(0);
  if (!diffs.length) return w;
  for (let it = 0; it < 30; it++) {
    const g = w.map((x) => -PROFILE.prior * x);
    const H = eye(K, PROFILE.prior);
    for (const d of diffs) {
      const p = 1 / (1 + Math.exp(-d.reduce((s, x, i) => s + x * w[i], 0)));
      for (let i = 0; i < K; i++) {
        g[i] += (1 - p) * d[i];
        for (let j = 0; j < K; j++) H[i][j] += p * (1 - p) * d[i] * d[j];
      }
    }
    const step = solve(H, g);
    let big = 0;
    for (let i = 0; i < K; i++) { w[i] += step[i]; big = Math.max(big, Math.abs(step[i])); }
    if (big < 1e-9) break;
  }
  return w;
}

const leanOfWeight = (w) => Math.tanh(w / 4);
const weightOfLean = (lean) => 4 * Math.atanh(Math.max(-0.9, Math.min(0.9, lean)));

function wordsFor(a, lean, sure) {
  if (sure < PROFILE.sureMin || Math.abs(lean) < PROFILE.leanMin) return null;
  return lean > 0 ? a.high : a.low;
}

const ADJ = new Set(['warm', 'cool', 'calm', 'busy', 'figurative', 'abstract', 'light', 'dark', 'muted', 'vivid']);
const list = (xs, joiner = 'and') => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${joiner} ${xs[xs.length - 1]}`);

// One plain sentence: "You lean warm, calm and figurative; no lean yet on photos vs prints."
export function summarize(axes) {
  // The four clearest leans, clearest first; the rest are still in the axis lines.
  const leaning = axes.filter((a) => a.words).sort((x, y) => Math.abs(y.lean) * y.sure - Math.abs(x.lean) * x.sure || AX.get(x.axis) - AX.get(y.axis)).slice(0, 4);
  const adj = leaning.filter((a) => ADJ.has(a.words)).map((a) => a.words);
  // Sides that aren't adjectives read as a choice: "you pick prints over photos".
  const over = leaning.filter((a) => !ADJ.has(a.words)).map((a) => { const x = AXES[AX.get(a.axis)]; return a.lean > 0 ? `${x.high} over ${x.low}` : `${x.low} over ${x.high}`; });
  const open = axes.filter((a) => !a.corrected && a.sure < PROFILE.sureMin);
  if (!leaning.length && open.length === axes.length) return 'No lean yet: pick a few pairs and this fills in.';
  const unknown = open.sort((x, y) => x.sure - y.sure || AX.get(x.axis) - AX.get(y.axis)).slice(0, 2).map((a) => AXES[AX.get(a.axis)].name);
  const parts = [];
  if (adj.length) parts.push(`You lean ${list(adj)}`);
  if (over.length) parts.push(`${adj.length ? 'you' : 'You'} pick ${list(over)}`);
  if (!parts.length) parts.push('No clear lean so far');
  if (unknown.length) parts.push(`no lean yet on ${list(unknown, 'or')}`);
  const s = parts.join('; ');
  return `${s}.`;
}

function buildProfile(weights, sure, corrected, tagWeights, n) {
  const axes = AXES.map((a, i) => {
    const lean = r3(leanOfWeight(weights[i]));
    const s = r3(corrected.has(a.axis) ? 1 : sure[i]);
    const out = { axis: a.axis, lean, sure: s, words: wordsFor(a, lean, s) };
    if (corrected.has(a.axis)) out.corrected = true;
    return out;
  });
  return {
    axes,
    summary: summarize(axes),
    weights: Object.fromEntries(AXES.map((a, i) => [a.axis, r3(weights[i])])),
    tagWeights,
    picks: n,
  };
}

/**
 * The taste profile from picks, in words.
 * @param {({winner, loser}|[string, string])[]} picks pieces or ids; ids are looked up in catalog
 * @param {object[]} [catalog]
 * @returns {{ axes: {axis: string, lean: number, sure: number, words: string|null, corrected?: true}[],
 *   summary: string, weights: Object<string, number>, tagWeights: number[]|null, picks: number }}
 */
export function tasteProfile(picks, catalog) {
  const ps = resolvePicks(picks, catalog);
  const diffs = ps.map((p) => axisDiff(p.winner, p.loser));
  const tagWeights = ps.length && ps.every((p) => recordOf(p.winner) && recordOf(p.loser)) ? fitTaste(ps) : null;
  return buildProfile(fitAxisWeights(diffs), sureOf(diffs), new Set(), tagWeights, ps.length);
}

// Tag features that say the same thing as an axis. When the person corrects the
// axis, these stop counting, so the old picks can't argue with the correction.
const AXIS_TAGS = {
  warm: ['warm', 'mood:sunny'],
  busy: ['busy', 'empty space', 'mood:calm', 'style:minimal'],
  abstract: ['theme:art', 'style:graphic'],
  print: ['painting', 'style:painterly', 'theme:art'],
  light: ['light', 'mood:moody', 'mood:sunny'],
  vivid: ['vivid', 'mood:bold'],
  bw: ['black and white', 'theme:mono'],
};

/**
 * The person corrects one line: "Not warm, actually cool" or "No lean".
 * @param {object} profile what tasteProfile() (or this) returned
 * @param {{ axis: string, lean: number|string|null }} change a number -1 to 1, a side's word ('cool'), or null / 0 / 'none' for no lean
 * @returns {object} a new profile, same shape, with that axis set and sure, and weights scoreProfile() uses
 */
export function correctProfile(profile, { axis, lean } = {}) {
  if (!AX.has(axis)) throw new TypeError(`Unknown taste axis: ${axis}`);
  const a = AXES[AX.get(axis)];
  let v;
  if (lean == null || lean === 'none' || lean === 0) v = 0;
  else if (typeof lean === 'number' && Number.isFinite(lean)) v = Math.max(-1, Math.min(1, lean));
  else if (lean === a.high) v = PROFILE.correct;
  else if (lean === a.low) v = -PROFILE.correct;
  else throw new TypeError(`A lean on ${axis} is a number, '${a.low}', '${a.high}' or null.`);
  const base = profile || tasteProfile([]);
  const weights = AXES.map((x) => (x.axis === axis ? weightOfLean(v) : (base.weights && base.weights[x.axis]) || 0));
  const sure = AXES.map((x) => { const e = base.axes.find((y) => y.axis === x.axis); return e ? e.sure : 0; });
  const corrected = new Set(base.axes.filter((x) => x.corrected).map((x) => x.axis));
  corrected.add(axis);
  let tagWeights = base.tagWeights ? [...base.tagWeights] : null;
  if (tagWeights) for (const f of AXIS_TAGS[axis]) { const i = FEATURE_NAMES.indexOf(f); if (i >= 0) tagWeights[i] = 0; }
  const out = buildProfile(weights, sure, corrected, tagWeights, base.picks || 0);
  // Keep the lean the person said exactly, not rounded through the weight.
  const e = out.axes.find((x) => x.axis === axis);
  e.lean = r3(v);
  e.words = wordsFor(a, e.lean, 1);
  out.summary = summarize(out.axes);
  return out;
}

const minmax = (raw) => {
  const lo = Math.min(...raw), hi = Math.max(...raw);
  return raw.map((x) => (hi > lo ? (x - lo) / (hi - lo) : 0.5));
};

/**
 * Taste scores from a profile, ready for layout({ taste }) and rerank({ taste }).
 * The axes and the tag weights are each spread 0 to 1 over the catalog, then
 * blended (PROFILE.blend from the axes when both exist), then put on 0.2 to 0.9
 * like scoreTaste().
 * @returns {Object<string, number>} id to 0..1
 */
export function scoreProfile(profile, catalog) {
  const out = {};
  if (!profile || !catalog.length) { for (const it of catalog) out[it.id] = 0.5; return out; }
  const w = AXES.map((a) => (profile.weights && profile.weights[a.axis]) || 0);
  const hasAxes = w.some((x) => Math.abs(x) > 1e-9);
  const hasTags = Array.isArray(profile.tagWeights) && catalog.every(recordOf);
  if (!hasAxes && !hasTags) { for (const it of catalog) out[it.id] = 0.5; return out; }
  const ax = hasAxes ? minmax(catalog.map((it) => { const p = axesOf(it); return AXIS_NAMES.reduce((s, x, i) => s + w[i] * (p[x] - 0.5), 0); })) : null;
  const tg = hasTags ? minmax(catalog.map((it) => dot(profile.tagWeights, features(it)))) : null;
  const b = ax && tg ? PROFILE.blend : ax ? 1 : 0;
  catalog.forEach((it, i) => {
    const v = (ax ? b * ax[i] : 0) + (tg ? (1 - b) * tg[i] : 0);
    out[it.id] = r3(0.2 + 0.7 * v);
  });
  return out;
}

// A seeded generator (mulberry32) and a stable hash, for variety without a clock.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str, seed) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/**
 * How sure the picks make us on each axis, least sure first.
 * @returns {{ axis: string, sure: number }[]}
 */
export function axisUncertainty(picks, catalog) {
  const ps = resolvePicks(picks, catalog);
  const s = sureOf(ps.map((p) => axisDiff(p.winner, p.loser)));
  return AXES.map((a, i) => ({ axis: a.axis, sure: r3(s[i]) })).sort((x, y) => x.sure - y.sure || AX.get(x.axis) - AX.get(y.axis));
}

const TAIL = 80; // pieces from each end of the axis that pairs are made from

/**
 * The next pair for the deeper test: it splits the axis the picks have tested
 * least, holds the other axes about equal, and brings a subject not shown yet.
 * Never shows a piece twice. Deterministic for a seed.
 * @param {object[]} catalog
 * @param {({winner, loser}|[string, string])[]} picks
 * @param {Set<string>|string[]} shown ids already shown
 * @param {{ seed?: number }} [opts]
 * @returns {[object, object] & { axis: string } | null} the two pieces, with the axis they split
 */
export function nextAxisPair(catalog, picks = [], shown = new Set(), { seed = 1 } = {}) {
  const seen = shown instanceof Set ? shown : new Set(shown || []);
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const catSeen = new Map();
  for (const id of seen) { const c = byId.get(id); const r = c && recordOf(c); if (r) catSeen.set(r.category, (catSeen.get(r.category) || 0) + 1); }
  const pool = catalog.filter((c) => !seen.has(c.id) && recordOf(c));
  const rnd = rng(hash(String(seen.size), seed));
  const order = axisUncertainty(picks, catalog);
  for (const { axis } of order) {
    const t = AX.get(axis);
    const eligible = pool.filter((c) => !(COLOR_ONLY.has(axis) && isBw(c)));
    const key = (c) => hash(c.id, seed);
    const sorted = [...eligible].sort((a, b) => axesOf(a)[axis] - axesOf(b)[axis] || key(a) - key(b));
    const lowEnd = sorted.slice(0, TAIL), highEnd = sorted.slice(-TAIL).reverse();
    let best = null;
    for (const a of lowEnd) {
      for (const b of highEnd) {
        if (a === b) continue;
        const d = axisDiff(b, a);
        if (d[t] < 0.3) continue;
        let off = 0;
        for (let i = 0; i < K; i++) if (i !== t) off += Math.abs(d[i]);
        const ra = recordOf(a), rb = recordOf(b);
        const repeat = (catSeen.get(ra.category) || 0) + (catSeen.get(rb.category) || 0);
        const q = ((ra.quality && ra.quality.score) ?? 0.5) + ((rb.quality && rb.quality.score) ?? 0.5);
        const score = d[t] - PROFILE.hold * off - PROFILE.repeat * repeat + 0.05 * q;
        const k = `${a.id}|${b.id}`;
        if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && k < best.k)) best = { score, k, a, b };
      }
    }
    if (best) {
      const pair = rnd() < 0.5 ? [best.a, best.b] : [best.b, best.a];
      pair.axis = axis;
      return pair;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Complements: pieces that go together, not just each fine alone.

const infoCache = new WeakMap();
function infoOf(x) {
  if (x && typeof x === 'object' && infoCache.has(x)) return infoCache.get(x);
  const r = recordOf(x);
  const pal = normalizePalette(r ? r.color.palette : (x && x.palette) || []);
  // Colorful colors on the painter's wheel, weighted by area and by how colorful.
  const hues = [];
  for (const c of pal) {
    const [, C, h] = lch(c.lab);
    if (C > 15 && c.weight >= 0.04) hues.push({ deg: toWheel(h), w: c.weight * Math.min(1, C / 50) });
  }
  const tagsOf = r ? r.tags : (x && x.tags) || null;
  const out = {
    pal,
    hues,
    colorful: Math.min(1, hues.reduce((s, c) => s + c.w, 0)),
    busy: r ? r.composition.busyness : x && typeof x.busy === 'number' ? x.busy : null,
    mood: tagsOf && Array.isArray(tagsOf.mood) && tagsOf.mood.length ? tagsOf.mood : null,
    style: tagsOf && Array.isArray(tagsOf.style) && tagsOf.style.length ? tagsOf.style : null,
  };
  if (x && typeof x === 'object') infoCache.set(x, out);
  return out;
}

// How two hues on the painter's wheel sit together: the same hue or neighbors are
// best, opposites (complements) good, triads fair, a quarter turn apart worst.
const HUE_CURVE = [[0, 1], [35, 1], [85, 0.25], [120, 0.6], [160, 0.9], [180, 0.9]];
function hueFit(deg) {
  for (let i = 1; i < HUE_CURVE.length; i++) {
    const [a, x] = HUE_CURVE[i - 1], [b, y] = HUE_CURVE[i];
    if (deg <= b) return x + ((deg - a) / (b - a)) * (y - x);
  }
  return 0.9;
}
function colorFit(A, B) {
  const sim = paletteSimilarity(A.pal, B.pal);
  let rel = 0.75, tw = 0;
  if (A.hues.length && B.hues.length) {
    let s = 0;
    for (const a of A.hues) for (const b of B.hues) {
      const d = Math.abs(a.deg - b.deg) % 360;
      s += a.w * b.w * hueFit(Math.min(d, 360 - d));
      tw += a.w * b.w;
    }
    rel = s / tw;
  }
  // A mostly neutral piece goes with most things.
  const n = clamp01(Math.min(A.colorful, B.colorful) / 0.5);
  return clamp01(0.35 * sim + 0.65 * ((1 - n) * 0.75 + n * rel));
}
const jaccard = (a, b) => { const sa = new Set(a), sb = new Set(b); let i = 0; for (const x of sa) if (sb.has(x)) i++; return i / (sa.size + sb.size - i); };
const OPPOSITE_MOODS = [['sunny', 'moody'], ['calm', 'bold']];
function moodFit(A, B) {
  if (!A.mood || !B.mood) return 0.5;
  let v = 0.35 + 0.65 * jaccard(A.mood, B.mood);
  for (const [x, y] of OPPOSITE_MOODS) {
    if ((A.mood.includes(x) && !A.mood.includes(y) && B.mood.includes(y) && !B.mood.includes(x))
      || (A.mood.includes(y) && !A.mood.includes(x) && B.mood.includes(x) && !B.mood.includes(y))) v -= 0.2;
  }
  return clamp01(v);
}
const styleFit = (A, B) => (A.style && B.style ? 0.3 + 0.7 * jaccard(A.style, B.style) : 0.5);
function busyFit(A, B) {
  if (A.busy == null || B.busy == null) return 0.6;
  const za = clamp01((A.busy - 0.08) / 0.3), zb = clamp01((B.busy - 0.08) / 0.3);
  return 0.75 * (1 - za * zb) + 0.25 * Math.abs(za - zb);
}

/**
 * How well two pieces go together, 0 to 1, the same either way round. Catalog
 * pieces (with a record) or pieces of yours ({ palette }, optional busy, tags).
 * @returns {number}
 */
export function complement(a, b) {
  const A = infoOf(a), B = infoOf(b);
  const C = COMPLEMENT;
  const v = C.color * colorFit(A, B) + C.mood * moodFit(A, B) + C.style * styleFit(A, B) + C.busy * busyFit(A, B);
  return r3(clamp01(v / (C.color + C.mood + C.style + C.busy)));
}

/**
 * Mean complement over the neighbors on one wall: pieces whose frames are within
 * COMPLEMENT.near inches of each other. 0.5 when no two neighbors are both known.
 * @param {object[]} pieces a layout's pieces ({ ref: { id }, x, y, w, h })
 * @param {Map<string, object>} art id to the piece's catalog item or owned piece
 */
export function wallComplement(pieces, art, cache = null) {
  let s = 0, n = 0;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const a = art.get(p.ref.id) || (p.palette ? p : null);
    if (!a) continue;
    for (let j = i + 1; j < pieces.length; j++) {
      const q = pieces[j];
      const dx = Math.max(0, Math.max(p.x, q.x) - Math.min(p.x + p.w, q.x + q.w));
      const dy = Math.max(0, Math.max(p.y, q.y) - Math.min(p.y + p.h, q.y + q.h));
      if (Math.hypot(dx, dy) > COMPLEMENT.near) continue;
      const b = art.get(q.ref.id) || (q.palette ? q : null);
      if (!b) continue;
      const k = p.ref.id < q.ref.id ? `${p.ref.id}|${q.ref.id}` : `${q.ref.id}|${p.ref.id}`;
      let v = cache && cache.get(k);
      if (v == null) { v = complement(a, b); if (cache) cache.set(k, v); }
      s += v; n++;
    }
  }
  return n ? s / n : 0.5;
}

// ---------------------------------------------------------------------------
// Subjects: what a piece is of (horses, cars, the sea). Subject outweighs style: a black and
// white photo of a horse is a horse first, so someone who doesn't want horses never gets it
// for being black and white. Learned from picks (strong), saves (strong) and swaps (weak),
// shrunk toward neutral until there's evidence, and a subject set to "never" is out.

export const SUBJECT_NAMES = Object.freeze({
  horses: 'horses', abstract: 'abstract', figure: 'people and figures', drinks: 'drinks', flowers: 'flowers', graphic: 'graphic prints',
  food: 'food', objects: 'objects', pool: 'pools', coffee: 'coffee', landscape: 'landscapes', western: 'the West', city: 'cities',
  cars: 'cars', beach: 'beaches', surf: 'surfing', coast: 'the coast', water: 'water', moon: 'the moon', sky: 'skies', dogs: 'dogs',
  architecture: 'architecture', lines: 'line drawings', sailing: 'sailing', 'black and white': 'black and white photos', ski: 'skiing',
  golf: 'golf', desert: 'desert', tennis: 'tennis', sculpture: 'sculpture', aerial: 'from above', 'palm springs': 'Palm Springs', shadows: 'shadows', film: 'film stills',
});
export const subjectOf = (x) => { const r = recordOf(x); return r ? r.category : (x && x.category) || null; };
export const subjectName = (s) => SUBJECT_NAMES[s] || s;

// Evidence per subject: picks count 1, saves 1, swaps away 0.35, "not for me" 1.5. Lean is -1 to 1, shrunk by n / (n + 2).
export function subjectStats({ picks = [], saved = [], skipped = [], disliked = [] } = {}, byId = null) {
  const at = new Map();
  const add = (s, w, n) => { if (!s) return; const o = at.get(s) || { win: 0, loss: 0, n: 0 }; if (w > 0) o.win += w; else o.loss -= w; o.n += n; at.set(s, o); };
  // A pair is relative ("I like this one more"), so the loser's subject loses half as much as the winner's gains.
  for (const p of picks) { const a = subjectOf(p.winner), b = subjectOf(p.loser); if (a && b && a === b) continue; add(a, 1, 1); add(b, -0.5, 0.5); }
  const get = (id) => (byId ? byId.get(id) : null);
  for (const id of saved) add(subjectOf(get(id)), 1, 1);
  for (const id of skipped) add(subjectOf(get(id)), -0.35, 0.35);
  for (const id of disliked) add(subjectOf(get(id)), -1.5, 1.5);
  const out = new Map();
  for (const [s, o] of at) {
    const raw = (o.win - o.loss) / Math.max(1, o.win + o.loss);
    out.set(s, { ...o, lean: raw * (o.n / (o.n + 2)) });
  }
  return out;
}
// How much a subject moves a piece's taste score: a clear dislike pulls a piece most of the way
// down whatever its style, a clear like lifts it some. Never means out.
export function subjectFactor(stats, never, s) {
  if (!s) return 1;
  if (never && never.has(s)) return 0;
  const o = stats.get(s);
  if (!o) return 1;
  return o.lean < 0 ? Math.max(0.3, 1 + 0.9 * o.lean) : 1 + 0.35 * o.lean;
}
// Subjects people clearly turned down: three losses' worth and no wins (an explicit
// "not for me" counts one and a half; a lost pair, a half).
export function dislikedSubjects(stats) {
  return [...stats].filter(([, o]) => o.loss >= 3 && o.win === 0).map(([s]) => s);
}
export function likedSubjects(stats) {
  return [...stats].filter(([, o]) => o.lean >= 0.3 && o.win >= 2).sort((a, b) => b[1].lean - a[1].lean).map(([s]) => s);
}

// The next pair for an adaptive test. Like an adaptive exam, each answer changes what comes
// next: about one round in three tests subjects (two pieces of different subjects, alike in
// style, from subjects we know least about), the rest split the least known style axis.
// Subjects turned down or set to never stop showing up. Seeded, so the same answers give the
// same next pair, with a little randomness among close choices.
export function nextAdaptivePair(catalog, picks = [], shown = new Set(), { seed = 1, never = new Set(), saved = [], skipped = [] } = {}) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const stats = subjectStats({ picks, saved, skipped }, byId);
  const out = new Set([...never, ...dislikedSubjects(stats)]);
  const pool = catalog.filter((c) => !out.has(subjectOf(c)));
  const rnd = rng(hash(`${picks.length}|${shown.size || 0}`, seed));
  const subjectTurn = picks.length >= 1 && (picks.length % 3 === 1 || rnd() < 0.15);
  if (subjectTurn) {
    const seen = shown instanceof Set ? shown : new Set(shown || []);
    const subjects = [...new Set(pool.map(subjectOf).filter(Boolean))];
    const known = (s) => (stats.get(s) ? stats.get(s).n : 0);
    const order = subjects.map((s) => ({ s, k: known(s) + rnd() * 0.9 })).sort((a, b) => a.k - b.k).map((x) => x.s);
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < Math.min(order.length, i + 6); j++) {
        const A = pool.filter((c) => subjectOf(c) === order[i] && !seen.has(c.id));
        const B = pool.filter((c) => subjectOf(c) === order[j] && !seen.has(c.id));
        if (!A.length || !B.length) continue;
        let best = null;
        for (const a of A.slice(0, 24)) for (const b of B.slice(0, 24)) {
          const d = axisDiff(a, b); let off = 0; for (let t = 0; t < K; t++) off += Math.abs(d[t]);
          const q = ((recordOf(a).quality && recordOf(a).quality.score) ?? 0.5) + ((recordOf(b).quality && recordOf(b).quality.score) ?? 0.5);
          const score = -off + 0.1 * q + 0.05 * rnd();
          if (!best || score > best.score) best = { score, a, b };
        }
        if (best) { const pair = rnd() < 0.5 ? [best.a, best.b] : [best.b, best.a]; pair.subject = [order[i], order[j]]; return pair; }
      }
    }
  }
  return nextAxisPair(pool, picks, shown, { seed });
}

// Art like a piece you said is not for you comes up less: the closer a piece is to one
// of them in style, color and subject (cosine of the taste features), the lower it
// scores, down to 0.35 for a near twin. Pieces unlike every one of them keep 1.
export function dislikeFactor(item, dislikedItems = []) {
  if (!item || !dislikedItems.length) return 1;
  const f = features(item);
  const norm = (v) => Math.sqrt(dot(v, v)) || 1;
  const nf = norm(f);
  let worst = 0;
  for (const d of dislikedItems) {
    if (!d) continue;
    const g = features(d);
    const sim = dot(f, g) / (nf * norm(g));
    if (sim > worst) worst = sim;
  }
  // Below 0.5 alike, no change; from 0.5 to 1, down in a straight line to 0.35.
  return worst <= 0.5 ? 1 : 1 - 0.65 * ((worst - 0.5) / 0.5);
}
