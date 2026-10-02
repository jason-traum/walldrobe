// Ranking walls again without building them again. layout() builds the whole
// list once; when a preference changes (a piece saved or skipped, the taste
// test, a new taste score) the list is re-ordered here in a few milliseconds.
// Pure: no DOM, no clock, no randomness.

import { WEIGHTS } from './constants.js';

const SAVE_BONUS = 0.05;   // each saved piece on a wall
const SAVE_CAP = 0.15;
const SKIP_PENALTY = 0.06; // each piece you swapped away from, on a wall
const ORDER_PRIOR = 0.004; // keeps layout()'s own order (its variety) when nothing has changed
const MOVE_PENALTY = 0.02;  // per foot a piece of yours that's already up would move
const MOVE_CAP = 0.08;
const WANT_PENALTY = 0.1;   // each piece you said to keep that a wall leaves out (only when they can't all fit with new art)      // per piece: a wall that moves your print across the room isn't ruled out, just lower

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
 * @param {{ taste?: Object<string, number>|null, saved?: string[], skipped?: string[], hung?: {id: string, at: {x: number, y: number}}[] }} prefs
 *   want: ids of your pieces you said to keep. A wall that leaves one out ranks lower, and the first wall keeps as many as any wall with new art does.
 *   hung: pieces of yours that are up now, with where they hang. A wall that moves one ranks a little lower, more the farther it moves; rehanging means new holes.
 * @returns {object[]} the same layouts, re-ordered, with rank and rankScore set
 */
export function rerank(layouts, { taste = null, saved = [], skipped = [], hung = [], want = [], distinct = false } = {}) {
  if (!Array.isArray(layouts)) throw new TypeError('rerank() needs the layouts layout() returned.');
  const sv = new Set(saved), sk = new Set(skipped);
  const up = new Map((hung || []).filter((h) => h && h.at && typeof h.at.x === 'number' && typeof h.at.y === 'number').map((h) => [h.id, h.at]));
  const scored = layouts.map((L, i) => {
    const fresh = L.pieces.filter((p) => p.ref.source === 'catalog');
    const was = L.parts && typeof L.parts.taste === 'number' ? L.parts.taste : 0.5;
    const now = taste && fresh.length ? mean(fresh.map((p) => (typeof taste[p.ref.id] === 'number' ? taste[p.ref.id] : 0.5))) : was;
    const savedN = fresh.filter((p) => sv.has(p.ref.id)).length;
    const skippedN = fresh.filter((p) => sk.has(p.ref.id)).length;
    const moved = up.size ? L.pieces.reduce((t, p) => { const a = p.ref.source !== 'catalog' && up.get(p.ref.id); if (!a) return t; const d = Math.hypot(p.x - a.x, p.y - a.y); return t + (d < 1 ? 0 : Math.min(MOVE_CAP, MOVE_PENALTY * d / 12)); }, 0) : 0;
    const missing = want.length ? want.filter((id) => !L.pieces.some((p) => p.ref.id === id)).length : 0;
    const s = (L.score || 0) + WEIGHTS.taste * (now - was) + Math.min(SAVE_CAP, SAVE_BONUS * savedN) - SKIP_PENALTY * skippedN - moved - WANT_PENALTY * missing - ORDER_PRIOR * i;
    return { L, s, i, fresh: fresh.length, asis: L.variant === 'asis', missing };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  // The first wall is a finished one: it adds new art whenever any wall does.
  // Of those, it leaves out as few of the pieces you said to keep as any of them does.
  const least = Math.min(...scored.filter((x) => x.fresh > 0 && !x.asis).map((x) => x.missing));
  const first = scored.findIndex((x) => x.fresh > 0 && !x.asis && x.missing === least);
  if (first > 0) scored.unshift(...scored.splice(first, 1));
  // Two walls that would look the same in the list: keep the better one.
  const kept = distinct ? scored.filter((x, k) => scored.findIndex((y) => look(y.L) === look(x.L)) === k) : scored;
  return kept.map((x, k) => ({ ...x.L, rank: k + 1, rankScore: Math.round(x.s * 1000) / 1000 }));
}
