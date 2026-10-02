// Ranking walls again without building them again. layout() builds the whole
// list once; when a preference changes (a piece saved or skipped, the taste
// test, a new taste score) the list is re-ordered here in a few milliseconds.
// Pure: no DOM, no clock, no randomness.

import { WEIGHTS } from './constants.js';

const SAVE_BONUS = 0.05;   // each saved piece on a wall
const SAVE_CAP = 0.15;
const SKIP_PENALTY = 0.06; // each piece you swapped away from, on a wall
const ORDER_PRIOR = 0.004; // keeps layout()'s own order (its variety) when nothing has changed

// What a wall looks like at a glance: its kind, how many pieces (yours and new),
// and its size to the nearest 6 in.
export function look(L) {
  const own = L.pieces.filter((p) => p.ref.source !== 'catalog').length;
  const g = L.group || { w: 0, h: 0 };
  return `${L.family}|${L.variant || ''}|${L.pieces.length}|${own}|${Math.round(g.w / 6)}x${Math.round(g.h / 6)}`;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * @param {object[]} layouts what layout() returned, in its order
 * @param {{ taste?: Object<string, number>|null, saved?: string[], skipped?: string[] }} prefs
 * @returns {object[]} the same layouts, re-ordered, with rank and rankScore set
 */
export function rerank(layouts, { taste = null, saved = [], skipped = [], distinct = false } = {}) {
  if (!Array.isArray(layouts)) throw new TypeError('rerank() needs the layouts layout() returned.');
  const sv = new Set(saved), sk = new Set(skipped);
  const scored = layouts.map((L, i) => {
    const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
    const was = L.parts && typeof L.parts.taste === 'number' ? L.parts.taste : 0.5;
    const now = taste && fresh.length ? mean(fresh.map((p) => (typeof taste[p.ref.id] === 'number' ? taste[p.ref.id] : 0.5))) : was;
    const savedN = fresh.filter((p) => sv.has(p.ref.id)).length;
    const skippedN = fresh.filter((p) => sk.has(p.ref.id)).length;
    const s = (L.score || 0) + WEIGHTS.taste * (now - was) + Math.min(SAVE_CAP, SAVE_BONUS * savedN) - SKIP_PENALTY * skippedN - ORDER_PRIOR * i;
    return { L, s, i, fresh: fresh.length, asis: L.variant === 'asis' };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  // The first wall is a finished one: it adds new art whenever any wall does.
  const first = scored.findIndex((x) => x.fresh > 0 && !x.asis);
  if (first > 0) scored.unshift(...scored.splice(first, 1));
  // Two walls that would look the same in the list: keep the better one.
  const kept = distinct ? scored.filter((x, k) => scored.findIndex((y) => look(y.L) === look(x.L)) === k) : scored;
  return kept.map((x, k) => ({ ...x.L, rank: k + 1, rankScore: Math.round(x.s * 1000) / 1000 }));
}
