// Where to frame a print, and what one plain black frame costs before any sale.
// Prices checked on each seller's own site on the date below (a research pass on
// Oct 3, 2026; Amazon blocks reading, so brands that sell there are priced from their
// own stores). Sizes are the frame's size as sold, short side first. `mat` is the print
// the included mat holds, or null when the frame comes without one.
// Walldrobe takes nothing on these.

export const FRAMES_CHECKED = 'Oct 3, 2026';

export const FRAMERS = [
  {
    id: 'walmart', name: 'Walmart (Mainstays)', kind: 'Store', url: 'https://www.walmart.com/browse/home/picture-frames/4044_133012_1155693',
    pickup: 'Pickup next day', ships: 'Free over $35',
    sizes: { '8x10': [1.98], '11x14': [9.92, '8x10'], '12x16': [4.98], '16x20': [5.72], '18x24': [9.92], '24x36': [11.92], '12x12': [9.92] },
    note: 'Cheapest; most have a plastic front, not glass',
  },
  {
    id: 'ikea', name: 'IKEA', kind: 'Store', url: 'https://www.ikea.com/us/en/cat/frames-18746/',
    pickup: 'In store', ships: 'Delivery from $29, orders over $35',
    // FISKBO without a mat; RÖDALM with one, a size down.
    // 8x12 is A4 (YLLEVAD), 20x28 is 50 x 70 cm and 28x39 is 70 x 100 cm (RÖDALM): the metric sizes many shop prints come in.
    sizes: { '8x10': [3.99], '8x12': [4.99], '12x16': [6.99], '16x20': [11.99], '20x28': [24.99], '24x36': [34.99, '20x28'], '28x39': [49.99, '20x28'] },
    note: 'Fits the metric sizes shop prints come in; no 11x14 or 18x24',
  },
  {
    id: 'target', name: 'Target', kind: 'Store', url: 'https://www.target.com/c/frames-home-decor/-/N-5xtfi',
    pickup: 'Same day pickup', ships: 'Ships too',
    sizes: { '8x10': [6.0], '11x14': [20.0, '8x10'], '16x20': [28.0, '11x14'], '18x24': [15.0], '24x36': [22.0], '16x16': [25.0, '12x12'] },
    note: 'Room Essentials poster frames are the cheap ones',
  },
  {
    id: 'michaels', name: 'Michaels', kind: 'Store', url: 'https://www.michaels.com/shop/frames',
    pickup: 'Same day pickup', ships: 'Free over $49',
    sizes: { '8x10': [9.79], '11x14': [12.99, '5x7'], '12x16': [13.99], '16x20': [24.99, '11x14'], '18x24': [44.99, '12x18'], '24x30': [48.99, '18x24'], '12x12': [22.49, '8x8'] },
    note: 'Often 50% off frames; check before you pay full price',
  },
  {
    id: 'americanflat', name: 'Americanflat', kind: 'Online', url: 'https://americanflat.com/collections/picture-frames',
    pickup: 'Mail only, also on Amazon', ships: 'From $7, free over $99',
    // Streamline Matted where a mat fits, Streamline without one past that. Their 16x20 is
    // matted to 12x16 (their size guide), not 11x14 like most stores.
    sizes: { '8x10': [8.99, '5x7'], '11x14': [11.99, '8x10'], '12x16': [15.99, '8x12'], '16x20': [21.99, '12x16'], '18x24': [24.99, '12x18'], '24x30': [45.99, '18x24'], '24x36': [36.99], '30x40': [59.99], '16x16': [19.99, '12x12'], '20x20': [29.99, '16x16'] },
    note: 'Real glass, slim black frame; the top seller on Amazon',
  },
  {
    id: 'upsimples', name: 'Upsimples', kind: 'Online', url: 'https://upsimples.com/collections/picture-frames',
    pickup: 'Mail only, also on Amazon', ships: 'Varies',
    sizes: { '11x14': [10.99, '8x10'], '12x16': [15.99], '16x20': [25.99, '11x14'], '18x24': [33.99, '16x20'], '24x36': [53.99, '20x30'], '12x12': [12.99, '8x8'], '16x16': [29.99, '12x12'] },
    note: 'Mats a size down; plastic front',
  },
];

// Framebridge prints your photo, mats it and frames it, priced by the print's size.
export const FRAMEBRIDGE = {
  id: 'framebridge', name: 'Framebridge', kind: 'Custom', url: 'https://www.framebridge.com/pricing',
  pickup: 'Mail, or pickup at their stores', ships: 'Free over $100',
  note: 'Prints, mats and frames it for you; the finished option',
  // [longest short side, longest long side, price with a mat]
  tiers: [[5, 7, 90], [9, 12, 115], [12, 18, 150], [18, 24, 200], [24, 34, 265], [32, 40, 365]],
};
function framebridgePrice(printKey) {
  const [a, b] = printKey.split('x').map(Number);
  const t = FRAMEBRIDGE.tiers.find(([s, l]) => a <= s && b <= l);
  return t ? t[2] : null;
}

export const frameKey = (w, h) => `${Math.min(w, h)}x${Math.max(w, h)}`;

/**
 * Every seller with a price for each frame needed.
 * @param {{ key: string, mat: string|null, count: number }[]} needed key: the frame as sold; mat: the print it should hold, or null
 * @returns {{ p, each: ({ price: number, matOk: boolean }|null)[], total: number, all: boolean }[]} every size first, cheapest first
 */
export function frameOptions(needed) {
  const rows = FRAMERS.map((p) => {
    const each = needed.map((n) => {
      const s = p.sizes[n.key];
      if (!s) return null;
      const [price, mat] = s;
      return { price: price * n.count, matOk: !n.mat || mat === n.mat, mat: mat || null };
    });
    return row(p, each);
  });
  // Framebridge, by the print's size (the frame's own size when there's no mat).
  rows.push(row(FRAMEBRIDGE, needed.map((n) => { const pr = framebridgePrice(n.mat || n.key); return pr == null ? null : { price: pr * n.count, matOk: true, mat: n.mat, custom: true }; })));
  const out = rows.filter((r) => r.some);
  out.sort((a, b) => (b.all - a.all) || a.total - b.total);
  return out;
}
function row(p, each) {
  const all = each.every((x) => x != null);
  const total = Math.round(each.reduce((t, x) => t + (x ? x.price : 0), 0) * 100) / 100;
  return { p, each, total, all, some: each.some((x) => x != null), mats: each.every((x) => !x || x.matOk) };
}

// The rows worth pointing at: the cheapest that has every size, the cheapest store to
// pick up today, and a better frame (real glass or done for you).
export function framePicks(rows) {
  const full = rows.filter((r) => r.all);
  const cheapest = full[0] || null;
  const today = full.find((r) => r.p.kind === 'Store' && r !== cheapest) || null;
  const better = full.find((r) => (r.p.id === 'americanflat' || r.p.id === 'framebridge') && r !== cheapest) || null;
  return { cheapest, today, better };
}

// The frames part of the question for your AI: the table, with whether each mat fits.
export function framesTable(needed, rows) {
  const head = `| Seller | ${needed.map((n) => `${n.key} frame${n.mat ? `, mat for ${n.mat}` : ''}${n.count > 1 ? ` (x${n.count})` : ''}`).join(' | ')} | Total | Pickup | Shipping |`;
  const line = `|---|${needed.map(() => '---').join('|')}|---|---|---|`;
  const cell = (x, n) => (x == null ? 'not offered' : `$${x.price.toFixed(2)}${n.mat ? (x.matOk ? ', mat fits' : x.mat ? `, mat is for ${x.mat}` : ', no mat') : ''}`);
  const body = rows.map((r) => `| ${r.p.name} | ${r.each.map((x, i) => cell(x, needed[i])).join(' | ')} | ${r.all ? `$${r.total.toFixed(2)}` : 'not every size'} | ${r.p.pickup} | ${r.p.ships} |`).join('\n');
  return `${head}\n${line}\n${body}`;
}
