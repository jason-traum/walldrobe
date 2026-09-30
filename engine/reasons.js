// One plain sentence per piece, built from facts recorded while placing it.
// No em dashes, under 140 characters, no jargon.

import { colorName, dominant, deltaE2000 } from './color.js';

const MAX = 140;

export function shortTitle(t) {
  const s = String(t || 'piece').trim();
  return s.length > 34 ? `${s.slice(0, 32).trimEnd()}…` : s;
}

export function anchorWord(kind) {
  if (!kind || kind === 'wall') return null;
  if (kind === 'sofa' || kind === 'couch') return 'couch';
  if (kind === 'headboard' || kind === 'bed') return 'bed';
  return kind;
}

// "in the middle", "on the left of the top row", "in the middle over the couch"
export function placePhrase(piece, group, anchorKind) {
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

// facts: { piece, group, anchorKind, family, ownedInLayout: [{ title, pal }], pal, taste }
export function pieceReason(f) {
  const { piece, group, anchorKind, family } = f;
  if (piece.role === 'pinned') return `Your ${shortTitle(piece.title)} stays exactly where it hangs now, as you asked.`;

  const place = placePhrase(piece, group, anchorKind);
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
  const color = dom ? colorName(dom.lab) : null;
  const liked = f.taste >= 0.7;
  const match = color && f.ownedInLayout
    .map((o) => ({ o, d: dominant(o.pal) }))
    .find(({ d }) => d && colorName(d.lab) === color && deltaE2000(d.lab, dom.lab) < 22);

  const why = liked ? 'close to what you picked in the quiz' : color ? `its ${color} ties in with the rest` : 'it sits well with the rest';
  const a = /^(8|11|18)$/.test(String(piece.w)) || String(piece.w).startsWith('8') ? 'An' : 'A';

  if (piece.role === 'center') {
    return fit([
      `${a} ${piece.w} x ${piece.h} in piece to anchor the wall${overAnchor}; ${why}.`,
      `${a} ${piece.w} x ${piece.h} in piece to anchor the wall; ${why}.`,
    ]);
  }
  if (piece.role === 'flank') {
    return fit([`Same size as the piece across from it, so both sides balance; ${why}.`, 'Same size as the piece across from it, so both sides balance.']);
  }
  if (match) {
    const t = shortTitle(match.o.title);
    return fit([`Its ${color} picks up the ${color} in your ${t}, ${place}.`, `Its ${color} picks up the ${color} in your ${t}.`]);
  }
  if (family === 'grid') return fit([`Same frame as the rest of the grid; ${why}.`]);
  if (liked) return fit([`Close to what you picked in the quiz, ${place}.`, 'Close to what you picked in the quiz.']);
  return fit([
    cap(`${color ? `its ${color}` : 'its colors'} sit${color ? 's' : ''} well with the rest of the wall, ${place}.`),
    cap(`${color ? `its ${color}` : 'its colors'} sit${color ? 's' : ''} well with the rest of the wall.`),
  ]);
}

export function leftReason(p) {
  if (p.keep === 'happy') return `Left off this wall so the rest fits. Your ${shortTitle(p.title)} would suit another spot.`;
  return 'Not needed on this wall. Keep it for another room.';
}

export function summary(layout, mustTitles, newCount) {
  const { family, variant, meta, group, anchor } = layout;
  const shape = family === 'salon' ? 'A two-row hang'
    : family === 'grid' ? `A ${meta.rows} by ${meta.cols} grid`
    : family === 'line' ? `A row of ${layout.pieces.length}`
    : variant === 'solo' ? 'One statement piece'
    : 'One big piece with smaller ones on each side';
  const word = anchorWord(anchor.kind);
  const where = word ? ` over the ${word}` : '';
  const built = mustTitles.length ? `, built around your ${shortTitle(mustTitles[0])}`
    : newCount ? `, with ${newCount} new piece${newCount === 1 ? '' : 's'}` : '';
  return `${shape}${where}, ${Math.round(group.w)} in wide${built}.`;
}
