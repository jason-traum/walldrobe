// Where to print a free photo, and what it costs before any code. Regular prices for
// one plain paper print (photo or poster paper, not canvas, not framed), checked on
// each service's own site on the date below (design/print-research.md has the
// sources). Codes change every week, so the app shows these as a starting point and
// hands the person a ready-made question for their own AI to find today's codes.
// Walldrobe takes nothing on these prints: the photo licenses don't allow selling
// unaltered copies, directly or indirectly.

export const PRICES_CHECKED = 'Oct 3, 2026';

// Sizes are written short side first: '8x10' covers 8 x 10 and 10 x 8.
export const PRINTERS = [
  {
    id: 'walmart', name: 'Walmart Photo', kind: 'Store', url: 'https://photos3.walmart.com/category/332-poster-prints',
    pickup: 'Same day up to 20x30; 24x36 ships', ships: 'Free over $35',
    sizes: { '5x7': 1.28, '8x8': 2.84, '8x10': 2.94, '11x14': 7.86, '12x12': 5.86, '12x18': 10.86, '16x20': 14.86, '20x30': 20.86, '24x36': 22.86 },
    note: 'Cheapest every day; rarely has codes',
  },
  {
    id: 'cvs', name: 'CVS Photo', kind: 'Store', url: 'https://www.cvs.com/photo/poster-prints-prodid-7201020',
    pickup: 'Same day, order by 7 PM', ships: 'Ships too',
    sizes: { '5x7': 2.99, '8x8': 4.79, '8x10': 4.79, '11x14': 12.99, '12x18': 15.99, '16x20': 19.99, '18x24': 20.99, '24x36': 32.99 },
    note: 'New codes most weeks, often 40 to 60% off',
  },
  {
    id: 'walgreens', name: 'Walgreens Photo', kind: 'Store', url: 'https://photo.walgreens.com/store/posters',
    pickup: 'Same day, often within an hour', ships: 'Ships too',
    sizes: { '5x7': 2.99, '8x8': 4.49, '8x10': 4.49, '11x14': 12.99, '12x18': 14.99, '16x20': 19.99, '20x30': 25.99, '24x36': 31.99 },
    note: 'Rotating weekly codes, big poster sales a few times a year',
  },
  {
    id: 'snapfish', name: 'Snapfish', kind: 'Online', url: 'https://www.snapfish.com/large-print',
    pickup: 'Pickup at CVS or Walgreens for some sizes', ships: 'from $4.99',
    sizes: { '5x7': 0.99, '8x8': 3.49, '8x10': 3.29, '11x14': 9.99, '12x12': 10.99, '12x18': 12.99, '16x20': 15.99, '20x30': 21.99 },
    note: 'Almost always 60 to 75% off with a code',
  },
  {
    id: 'shutterfly', name: 'Shutterfly', kind: 'Online', url: 'https://www.shutterfly.com/prints/',
    pickup: 'Pickup at CVS or Walgreens for some sizes', ships: 'from $5.99',
    sizes: { '5x7': 1.69, '8x8': 3.99, '8x10': 4.44, '11x14': 12.29, '12x12': 8.39, '16x20': 22.99, '20x30': 29.99 },
    note: 'Costco members 51% off, Prime 45% off',
  },
  {
    id: 'mpix', name: 'Mpix', kind: 'Pro lab', url: 'https://www.mpix.com/photo-prints',
    pickup: 'Mail only', ships: '$9.99, free over $45',
    sizes: { '5x7': 1.88, '8x8': 3.59, '8x10': 3.99, '8x12': 4.65, '11x14': 11.98, '12x12': 8.25, '12x18': 16.49, '16x20': 24.99, '18x24': 31.99, '20x30': 44.99, '24x36': 68.65 },
    note: 'Top in recent tests; on sale most days',
  },
  {
    id: 'printique', name: 'Printique', kind: 'Pro lab', url: 'https://www.printique.com/products/photo-prints/',
    pickup: 'Mail only', ships: 'Free over $100',
    sizes: { '5x7': 1.20, '8x10': 2.65, '8x12': 3.50, '11x14': 5.00, '12x12': 5.50, '12x18': 8.20, '16x20': 18.00, '20x30': 35.00, '24x36': 48.00, '30x40': 101.99, '36x48': 156.99, '40x60': 179.99 },
    note: 'Gallery quality; 30x40 and up on fine art paper',
  },
  {
    id: 'nations', name: 'Nations Photo Lab', kind: 'Pro lab', url: 'https://www.nationsphotolab.com/products/prints-lustre',
    pickup: 'Mail only', ships: 'from $9.95',
    sizes: { '5x7': 1.95, '8x8': 3.89, '8x10': 3.75, '8x12': 5.58, '11x14': 10.99, '12x12': 8.25, '12x18': 15.30, '16x20': 23.99, '18x24': 36.80, '20x30': 46.58, '24x36': 78.95, '30x40': 82.45, '30x45': 95.45 },
    note: '25% off a first order; photo paper up to 30x45',
  },
  {
    id: 'bay', name: 'Bay Photo', kind: 'Pro lab', url: 'https://bayphoto.com/prints/photographic-prints/',
    pickup: 'Mail only', ships: '$3.99 to $7.99',
    sizes: { '5x7': 1.99, '8x8': 3.55, '8x10': 3.55, '8x12': 5.09, '11x14': 7.69, '12x12': 7.21, '12x18': 13.19, '16x20': 24.99, '20x30': 40.49, '24x36': 69.99, '30x40': 74.15, '40x60': 166.75 },
    note: 'Best for big photo prints, up to 48x96',
  },
  {
    id: 'printkeg', name: 'Printkeg', kind: 'Poster shop', url: 'https://www.printkeg.com/products/large-prints',
    pickup: 'Mail only', ships: '$10, free over $100',
    sizes: { '24x36': 29.99, '30x40': 49.99, '36x48': 69.99 },
    note: 'Cheapest big prints on archival matte',
  },
];

export const sizeKey = (w, h) => `${Math.min(w, h)}x${Math.max(w, h)}`;

// Every service with a price for each size needed: [{ p, each: [price or null], total, all }],
// those that print every size first, cheapest first.
export function printOptions(needed) {
  const rows = PRINTERS.map((p) => {
    const each = needed.map((n) => (p.sizes[n.key] != null ? p.sizes[n.key] * n.count : null));
    const all = each.every((x) => x != null);
    const total = each.reduce((t, x) => t + (x || 0), 0);
    return { p, each, total: Math.round(total * 100) / 100, all, some: each.some((x) => x != null) };
  }).filter((r) => r.some);
  rows.sort((a, b) => (b.all - a.all) || a.total - b.total);
  return rows;
}

// The rows worth pointing at: the cheapest that prints everything, the cheapest same-day
// store, and the best-reviewed pro lab that prints everything.
export function picks(rows) {
  const full = rows.filter((r) => r.all);
  const cheapest = full[0] || null;
  const today = full.find((r) => r.p.kind === 'Store' && r !== cheapest) || null;
  const better = full.find((r) => ['mpix', 'printique', 'nations', 'bay'].includes(r.p.id) && r !== cheapest) || null;
  return { cheapest, today, better };
}

// The question to paste into ChatGPT, Gemini or Claude: what to print, the regular
// prices we found, and a request to find today's codes and the cheapest way.
export function aiQuestion(needed, rows, frames = null) {
  const sizes = needed.map((n) => `${n.count} print${n.count > 1 ? 's' : ''} at ${n.key.replace('x', ' x ')} in`).join(', ');
  const head = `| Service | ${needed.map((n) => `${n.key}${n.count > 1 ? ` (x${n.count})` : ''}`).join(' | ')} | Total | Pickup | Shipping |`;
  const line = `|---|${needed.map(() => '---').join('|')}|---|---|---|`;
  const body = rows.map((r) => `| ${r.p.name} | ${r.each.map((x) => (x == null ? 'not offered' : `$${x.toFixed(2)}`)).join(' | ')} | ${r.all ? `$${r.total.toFixed(2)}` : 'not every size'} | ${r.p.pickup} | ${r.p.ships} |`).join('\n');
  const printing = needed.length ? `I'm printing photos for my wall in the US: ${sizes}. Plain photo or poster paper, not canvas, not framed.

Here are the regular prices (before any codes) I found on ${PRICES_CHECKED}:

${head}
${line}
${body}

` : '';
  const framing = frames && frames.needed.length ? `${needed.length ? 'I also need' : "I'm framing prints for my wall in the US and need"} plain black frames: ${frames.needed.map((n) => `${n.count} x ${n.key.replace('x', ' x ')} in${n.mat ? ` with a mat for a ${n.mat.replace('x', ' x ')} in print` : ''}`).join(', ')}.

Regular frame prices (before any sale) I found on ${frames.checked}:

${frames.table}

` : '';
  const ask = needed.length && frames && frames.needed.length ? 'printing and framing' : needed.length ? 'printing' : 'framing';
  return `${printing}${framing}Please search for discount codes and sales live today for each of these (and any I missed), work out what the ${ask} would cost me today with codes and shipping or pickup, and tell me the cheapest good way to get all of it. If a seller doesn't have one of my sizes, tell me the nearest size it does, or where to get a mat cut to fit. Link your sources.`;
}
