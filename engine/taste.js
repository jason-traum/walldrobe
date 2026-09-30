// Taste from pairwise picks. Each piece becomes a small feature vector (what kind
// of image it is and what its colors do); each "I like this one more" nudges a
// weight vector toward the winner (a Bradley-Terry model, fit by gradient steps).
// Pure and deterministic. Later this gets image embeddings; the interface stays.

import { normalizePalette, lch } from './color.js';

export const CATEGORIES = ['architecture', 'abstract', 'aerial', 'black and white', 'coast', 'desert', 'film', 'flowers', 'food', 'lines', 'palm springs', 'pool', 'surf', 'tennis'];

export function features(item) {
  const pal = normalizePalette(item.palette);
  let L = 0, C = 0, warm = 0, cool = 0;
  for (const c of pal) {
    const [l, ch, h] = lch(c.lab);
    L += c.weight * l;
    C += c.weight * ch;
    const w = ch > 12 ? c.weight : 0;
    if (h < 100 || h >= 330) warm += w; else if (h >= 170 && h < 330) cool += w;
  }
  const cat = CATEGORIES.map((k) => (item.category === k ? 1 : 0));
  return [
    ...cat,
    item.medium === 'painting' ? 1 : 0,
    L / 100 - 0.5,          // light or dark
    Math.min(1, C / 60),    // muted or vivid
    warm - cool,            // warm or cool
    C < 8 ? 1 : 0,          // black and white
  ];
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// picks: [{ winner, loser }] as catalog items. Returns weights.
export function fitTaste(picks, { steps = 60, rate = 0.5, l2 = 0.02 } = {}) {
  if (!picks.length) return null;
  const dim = features(picks[0].winner).length;
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

// A fixed set of quiz pairs that cover the categories, so every quiz is comparable.
export function quizPairs(items, n = 7) {
  const byCat = new Map(CATEGORIES.map((c) => [c, items.filter((i) => i.category === c)]));
  const plan = [
    ['pool', 'abstract'], ['black and white', 'coast'], ['tennis', 'flowers'], ['palm springs', 'architecture'],
    ['food', 'desert'], ['surf', 'aerial'], ['abstract', 'black and white'], ['coast', 'food'],
  ];
  const used = new Map();
  const take = (c) => {
    const list = byCat.get(c) || [];
    const k = used.get(c) || 0;
    used.set(c, k + 1);
    return list[(k * 3) % Math.max(1, list.length)];
  };
  return plan.slice(0, n).map(([a, b]) => [take(a), take(b)]).filter(([a, b]) => a && b);
}
