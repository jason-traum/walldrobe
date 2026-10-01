// One plain sentence per piece, built from facts recorded while placing it.
// No em dashes, under 140 characters, no jargon.

import { colorName, dominant, deltaE2000, lch } from './color.js';

const MAX = 140;

export function shortTitle(t) {
  const s = String(t || 'piece').trim();
  return s.length > 34 ? `${s.slice(0, 32).trimEnd()}…` : s;
}

export function anchorWord(kind) {
  if (!kind || kind === 'wall') return null;
  if (kind === 'sofa' || kind === 'couch') return 'couch';
  if (kind === 'headboard' || kind === 'bed') return 'bed';
  if (kind === 'tv') return 'TV';
  return kind;
}

// "in the middle", "on the left of the top row", "in the middle over the couch"
export function placePhrase(piece, group, anchorKind, family) {
  // In a stack, up and down is what tells pieces apart.
  if (family === 'column') {
    const up = (piece.cy - (group.y + group.h / 2)) / group.h;
    return Math.abs(up) < 0.12 ? 'in the middle' : up > 0 ? 'at the top' : 'at the bottom';
  }
  const rel = (piece.cx - (group.x + group.w / 2)) / group.w;
  const side = Math.abs(rel) < 0.12 ? 'in the middle' : rel < 0 ? 'on the left' : 'on the right';
  const row = piece.row === 'top' ? ' of the top row' : piece.row === 'bottom' ? ' of the bottom row' : '';
  const word = anchorWord(anchorKind);
  const over = word && side === 'in the middle' && !row ? ` over the ${word}` : '';
  return `${side}${row}${over}`;
}

function fit(options) {
  for (const s of options) if (s && s.length <= MAX) return s;
  const last = options[options.length - 1];
  return last.length <= MAX ? last : `${last.slice(0, MAX - 1).trimEnd()}.`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The color a person would name for a whole piece: "black and white" when it has
// no real color, otherwise its dominant color.
export function colorWord(pal) {
  if (!pal || !pal.length) return null;
  if (pal.every((c) => lch(c.lab)[1] < 12)) return 'black and white';
  const d = dominant(pal);
  return d ? colorName(d.lab) : null;
}

// facts: { piece, group, anchorKind, family, ownedInLayout: [{ title, pal }], pal, taste }
export function pieceReason(f) {
  const { piece, group, anchorKind, family } = f;
  if (piece.role === 'pinned') return `Your ${shortTitle(piece.title)} stays exactly where it hangs now, as you asked.`;

  const place = placePhrase(piece, group, anchorKind, family);
  if (piece.kept) return fit([`You kept this one, ${place}, and the rest was picked around it.`, 'You kept this one, and the rest was picked around it.']);
  const word = anchorWord(anchorKind);
  const overAnchor = word ? ` over the ${word}` : '';

  if (piece.ref.source === 'owned') {
    const t = shortTitle(piece.title);
    if (piece.keep === 'must') {
      if (piece.role === 'center') return fit([`Your ${t} is the one you said you'd keep, so it gets the middle${overAnchor}.`, `Your ${t} is the one you said you'd keep, so it gets the middle.`]);
      return fit([`Your ${t} stays, ${place}, because you said you'd keep it.`, `Your ${t} stays because you said you'd keep it.`]);
    }
    if (piece.fixed) return fit([`Your ${t} works with the rest, so it stays, ${place}.`, `Your ${t} works with the rest, so it stays.`]);
    return fit([`Your ${t} fits this spot, so there's nothing to buy for it.`]);
  }

  const dom = dominant(f.pal);
  // With measured color amounts, name the piece by its main color family and count
  // the other pieces that carry real amounts of it, the same test the wall notes use.
  const measured = f.colorFamily !== undefined && f.othersShares;
  const named = colorWord(f.pal);
  // A mostly neutral piece that isn't black and white has no color worth naming.
  const color = measured ? (f.colorFamily || (named === 'black and white' ? named : null)) : named;
  const liked = f.taste >= 0.7;
  const match = color && color !== 'black and white' && f.ownedInLayout
    .map((o) => ({ o, d: dominant(o.pal) }))
    .find(({ o, d }) => d && colorWord(o.pal) === color && deltaE2000(d.lab, dom.lab) < 22);
  // How many other pieces on this wall share its color: the fact that makes each reason specific.
  const same = !color ? 0 : f.colorFamily && f.othersShares
    ? f.othersShares.filter((s) => (s[f.colorFamily] || 0) >= 0.08).length
    : (f.othersPal || []).filter((p) => colorWord(p) === color).length;
  const tie = !color ? 'it sits well with the rest'
    : same ? `its ${color} repeats in ${same} other piece${same === 1 ? '' : 's'}`
    : `the one ${color} piece, for contrast`;
  const why = liked ? 'close to what you picked in the quiz' : tie;
  const a = /^(8|11|18)$/.test(String(piece.w)) || String(piece.w).startsWith('8') ? 'An' : 'A';

  if (piece.role === 'center') {
    return fit([
      `${a} ${piece.w} x ${piece.h} in piece to anchor the wall${overAnchor}; ${why}.`,
      `${a} ${piece.w} x ${piece.h} in piece to anchor the wall; ${why}.`,
    ]);
  }
  if (piece.role === 'flank') {
    return fit([`Same size as the piece across from it, so both sides balance; ${tie}.`, 'Same size as the piece across from it, so both sides balance.']);
  }
  if (match) {
    const t = shortTitle(match.o.title);
    return fit([`Its ${color} picks up the ${color} in your ${t}, ${place}.`, `Its ${color} picks up the ${color} in your ${t}.`]);
  }
  if (family === 'grid') return fit([`Same frame as the rest of the grid; ${tie}.`]);
  if (liked) return fit([`Close to what you picked in the quiz; ${tie}.`, 'Close to what you picked in the quiz.']);
  return fit([cap(`${tie}, ${place}.`), cap(`${tie}.`)]);
}

export function leftReason(p) {
  if (p.keep === 'happy') return `Left off this wall so the rest fits. Your ${shortTitle(p.title)} would suit another spot.`;
  return 'Not needed on this wall. Keep it for another room.';
}

export function summary(layout, mustTitles, newCount, keptTitles = []) {
  const { family, variant, meta, group, anchor } = layout;
  const shape = family === 'salon' ? 'A two-row hang'
    : family === 'grid' ? `A ${meta.rows} by ${meta.cols} grid`
    : family === 'line' ? `A row of ${layout.pieces.length}`
    : family === 'column' ? `A stack of ${layout.pieces.length}`
    : variant === 'solo' ? 'One statement piece'
    : 'One big piece with smaller ones on each side';
  const word = anchorWord(anchor.kind);
  const by = anchorWord(layout.beside);
  const where = (layout.place === 'left' || layout.place === 'right') && by ? `, ${layout.place} of the ${by}` : word ? ` over the ${word}` : '';
  const built = mustTitles.length ? `, built around your ${shortTitle(mustTitles[0])}`
    : keptTitles.length === 1 ? `, built around the ${shortTitle(keptTitles[0])} you kept`
    : keptTitles.length > 1 ? `, built around the ${keptTitles.length} pieces you kept`
    : newCount ? `, with ${newCount} new piece${newCount === 1 ? '' : 's'}` : '';
  // Same quarter-inch rounding as the drawing's dimension line, so the two always agree.
  const q = Math.round(group.w * 4) / 4, whole = Math.floor(q), f = ['', '¼', '½', '¾'][Math.round((q - whole) * 4)];
  return `${shape}${where}, ${whole}${f} in wide${built}.`;
}

// ---------- Notes on the whole wall ----------

const pct = (v) => Math.round(v * 20) * 5;
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const EARTHY = new Set(['red', 'orange', 'yellow']);

function schemeNote(c, checks) {
  if (checks.harmony < 0.5) return null;
  const [a, b, d] = c.schemeColors;
  // Brown is a dark orange or yellow, so brown with its lighter cousin is one warm family.
  if (['monochromatic', 'analogous'].includes(c.scheme) && b && (a === 'brown' || b === 'brown') && EARTHY.has(a === 'brown' ? b : a)) {
    return `Built on ${a} and ${b}, warm earthy tones from one part of the color wheel, so it reads calm.`;
  }
  switch (c.scheme) {
    case 'neutral': return 'Mostly black, white and gray, so it works with any room.';
    case 'monochromatic': return b ? `Built on ${a} and ${b}, close neighbors on the color wheel, so it reads calm.` : a ? `Built on one color, ${a}, in lighter and darker versions, so it reads calm.` : null;
    case 'analogous': return b ? `The ${a} and ${b} sit on the same side of the color wheel, so the wall reads as one mood.` : a ? `Built on ${a} and the colors beside it, so the wall reads as one mood.` : null;
    case 'complementary': return b ? `The ${a} and ${b} sit across the color wheel from each other, so each makes the other stand out.` : null;
    case 'split complementary': return d ? cap(`${a} with ${b} and ${d}, the colors either side of its opposite, so it's lively without clashing.`) : null;
    case 'triadic': return d ? cap(`${a}, ${b} and ${d} are evenly spaced around the color wheel, which keeps a bold mix balanced.`) : null;
    default: return null;
  }
}

function proportionNote(c, checks) {
  if (checks.proportion < 0.9) return null;
  const w = c.wall;
  if (w.chromatic < 0.05) {
    const parts = [['light', w.value.light], ['mid', w.value.mid], ['dark', w.value.dark]].sort((x, y) => y[1] - x[1]).filter(([, v]) => pct(v) >= 5);
    if (parts.length < 2) return null;
    return `About ${list(parts.map(([k, v]) => `${pct(v)}% ${k}`))} tones, which gives it depth without color.`;
  }
  const neutral = (w.shares.black || 0) + (w.shares.gray || 0) + (w.shares.white || 0);
  const parts = [['neutral', neutral], ...Object.entries(w.shares).filter(([f]) => !['black', 'gray', 'white'].includes(f))]
    .sort((x, y) => y[1] - x[1]).slice(0, 3).filter(([, v]) => pct(v) >= 5);
  if (parts.length < 2) return null;
  return `About ${list(parts.map(([k, v]) => `${pct(v)}% ${k}`))}, close to the 60, 30, 10 split designers use.`;
}

function repetitionNote(c, pieces) {
  const rep = c.repeated.filter((r) => r.pieces >= 2).sort((x, y) => (c.wall.shares[x.family] || 0) - (c.wall.shares[y.family] || 0));
  if (rep.length) return `The ${rep[0].family} shows up in ${rep[0].pieces} pieces, so it reads as a choice, not an accident.`;
  const room = c.repeated.find((r) => r.room);
  if (room) return `The ${room.family} picks up the ${room.family} in the room.`;
  const solo = c.lonely.find((l) => l.allowed);
  if (solo && pieces[solo.piece]) return `The only ${solo.family} is in the ${shortTitle(pieces[solo.piece].title)}, so that's where the eye goes first.`;
  return null;
}

function designNotes(d, checks, family, n) {
  const out = [];
  if (d.pairs.length && d.busyCount && d.busyPairs === 0 && family !== 'grid') out.push('Busy pieces never touch, so the eye has somewhere to rest.');
  if (d.inward) out.push('The pieces on the sides face inward, which pulls the eye to the middle.');
  if ((family === 'grid' || family === 'line') && checks.variety >= 0.95) out.push('They read as one set: the same kind of subject, treated the same way.');
  if (n > 1 && checks.balance >= 0.9) {
    out.push(d.mirrorPairs && checks.mirror >= 0.9 ? 'Matching frames on each side carry about the same weight, so it feels steady.'
      : !d.mirrorPairs ? 'The heavier pieces sit low and near the middle, so it feels steady.' : null);
  }
  return out.filter(Boolean);
}

function caveat(c, d, checks, family, pieces) {
  const order = [
    ['harmony', () => "Worth knowing: the colors don't follow one scheme. Refresh the rest for a calmer mix."],
    ['repetition', () => {
      const l = c.lonely.find((x) => !x.allowed);
      return l ? `Worth knowing: the ${l.family} shows up in only one piece. Swap it, or keep it and refresh the rest.` : null;
    }],
    ['rhythm', () => 'Worth knowing: two busy pieces sit side by side.'],
    ['balance', () => (d.topHeavy ? 'Worth knowing: the top looks heavier than the bottom.' : d.heavier ? `Worth knowing: the ${d.heavier} side looks heavier.` : null)],
    ['temperature', () => 'Worth knowing: warm and cool colors are split about evenly, which can feel unsettled.'],
    ['variety', () => (d.variety.kind === 'series' ? "Worth knowing: the pieces don't quite read as one set."
      : d.variety.topCategory ? `Worth knowing: more than half the wall is ${d.variety.topCategory}.` : 'Worth knowing: two pieces with the same subject sit side by side.')],
    ['saturation', () => 'Worth knowing: one piece is much more vivid than the rest.'],
    ['distinct', () => {
      const pair = d.alike && d.alike[0];
      return pair ? `Worth knowing: the ${shortTitle(pieces[pair[0]].title)} and the ${shortTitle(pieces[pair[1]].title)} look a lot alike. Swap one for more contrast.` : null;
    }],
  ];
  const limit = { harmony: 0.4, distinct: 0.99 };
  const low = order.filter(([k]) => checks[k] < (limit[k] ?? 0.5)).sort((a, b) => checks[a[0]] - checks[b[0]]);
  for (const [, say] of low) { const s = say(); if (s) return s; }
  return null;
}

// Up to four sentences on why the wall works, and one honest caveat when a check is low.
export function layoutNotes({ color, design, checks, family, pieces }) {
  const good = [schemeNote(color, checks), repetitionNote(color, pieces), proportionNote(color, checks), ...designNotes(design, checks, family, pieces.length)]
    .filter(Boolean).slice(0, 4);
  const warn = caveat(color, design, checks, family, pieces);
  return warn ? [...good, warn] : good;
}
