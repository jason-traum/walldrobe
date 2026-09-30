// A synthetic art catalog for tests. Not real art: made-up titles, palettes that
// cover the common cases, and the standard sizes a print shop would offer.

const THEMES = {
  bw: ['#111111', '#F2F2F2', '#8A8A8A'],
  blue: ['#1F2FA8', '#E8ECF5', '#0B1A5C'],
  earth: ['#8B5A2B', '#D9C3A0', '#3E2A1A'],
  warm: ['#C2362B', '#F4E1C9', '#2B1B17'],
  green: ['#2F5D3A', '#C9D8C0', '#10231A'],
  pastel: ['#F2B8C6', '#F7F1E8', '#9CC5E0'],
  teal: ['#1B6F73', '#EADFC8', '#0E2E30'],
  yellow: ['#E3B23C', '#F5F0E6', '#3A3A3A'],
};

const PORTRAIT = [[8, 10], [11, 14], [12, 16], [16, 20], [18, 24], [24, 30], [24, 36], [30, 40]];
const LANDSCAPE = PORTRAIT.map(([w, h]) => [h, w]);
const SQUARE = [[12, 12], [16, 16], [20, 20], [30, 30]];

const price = (w, h) => Math.round((20 + w * h * 0.08) / 5) * 5;

export const TEST_TASTE_LIKES = ['bw', 'blue'];

export function testCatalog(n = 48) {
  const themes = Object.keys(THEMES);
  const items = [];
  for (let i = 0; i < n; i++) {
    const theme = themes[i % themes.length];
    const orient = ['portrait', 'landscape', 'portrait', 'square'][i % 4];
    const sizes = (orient === 'portrait' ? PORTRAIT : orient === 'landscape' ? LANDSCAPE : SQUARE)
      .map(([w, h]) => ({ w, h, price: price(w, h) }));
    const [a, b, c] = THEMES[theme];
    const shift = (i % 3) * 0.05;
    items.push({
      id: `t-${String(i).padStart(3, '0')}`,
      title: `Test piece ${i} (${theme})`,
      artist: `Artist ${i % 16}`,
      source: 'Test catalog',
      url: `https://example.com/art/${i}`,
      palette: [{ hex: a, weight: 0.5 - shift }, { hex: b, weight: 0.35 }, { hex: c, weight: 0.15 + shift }],
      sizes,
      theme,
    });
  }
  return items;
}

export function testTaste(catalog) {
  const out = {};
  catalog.forEach((c, i) => {
    const base = TEST_TASTE_LIKES.includes(c.theme) ? 0.8 : c.theme === 'earth' ? 0.6 : 0.4;
    out[c.id] = Math.round((base + ((i * 7) % 10) / 100 - 0.05) * 100) / 100;
  });
  return out;
}
