// Taste from pairwise picks. Each piece becomes a feature vector built from its
// catalog record (theme, style, mood, and measured color and composition); each
// "I like this one more" nudges a weight vector toward the winner (a Bradley-Terry
// model, fit by gradient steps). The quiz picks each next pair where the model is
// least sure, so ten picks teach it more than ten random ones. Pure and deterministic.
// Later the features get image embeddings; the interface stays the same.

import { THEMES, STYLES, MOODS } from './catalog.js';

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
  return w;
}

// Scores from 0.2 to 0.9 for every item, ready for layout({ taste }).
export function scoreTaste(weights, items) {
  const out = {};
  if (!weights) { for (const it of items) out[it.id] = 0.5; return out; }
  const raw = items.map((it) => dot(weights, features(it)));
  const lo = Math.min(...raw), hi = Math.max(...raw);
  items.forEach((it, i) => { out[it.id] = Math.round((0.2 + 0.7 * (hi > lo ? (raw[i] - lo) / (hi - lo) : 0.5)) * 1000) / 1000; });
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
  const sl = shortlist(items).filter((it) => !shownIds.has(it.id));
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
