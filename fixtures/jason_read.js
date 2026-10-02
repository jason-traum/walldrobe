// Jason's bedroom wall as the live app's photo reader read it (2026-10-02): the
// numbers only, from the app's saved draft, no image data. Inches, floor-up. The
// reader's frame sizes run 1 to 3 in big on each piece (being fixed separately), so
// tests also use them 12% smaller (`scaled`). All seven are pieces he keeps, each with
// the spot it hangs now in `at`.

export const jasonRead = {
  name: "Jason's bedroom, as the photo reader read it",
  wall: { width: 110, height: 97 },
  obstacles: [
    {id: 'auto7', kind: 'dresser', label: 'Dresser', fuzz: 1.5, x: 89.5, y: 0, w: 20.5, h: 33.5},
    {id: 'auto8', kind: 'headboard', label: 'Bed', fuzz: 1.5, x: 13.5, y: 0, w: 63, h: 21.5},
    {id: 'auto9', kind: 'lamp', label: 'Lamp', fuzz: 1.5, x: 72, y: 6.5, w: 19, h: 41.5},
  ],
  owned: [
    {id: 'auto0', title: 'print', w: 14.5, h: 18.5, at: {x: 28.5, y: 55}, keep: 'must', palette: [{hex: '#CDBEBD', weight: 0.2498}, {hex: '#8C676A', weight: 0.228}, {hex: '#B88F8F', weight: 0.2226}, {hex: '#594B4C', weight: 0.1876}, {hex: '#221F1D', weight: 0.112}]},
    {id: 'auto1', title: 'print 2', w: 16.5, h: 23.5, at: {x: 67.5, y: 47}, keep: 'must', palette: [{hex: '#A19289', weight: 0.2691}, {hex: '#D0C3BC', weight: 0.213}, {hex: '#2A2A27', weight: 0.178}, {hex: '#936159', weight: 0.1773}, {hex: '#514B48', weight: 0.1627}]},
    {id: 'auto2', title: 'print 3', w: 21.5, h: 30.5, at: {x: 44, y: 53}, keep: 'must', palette: [{hex: '#253375', weight: 0.6005}, {hex: '#DAD8D4', weight: 0.1979}, {hex: '#1F1F1D', weight: 0.0865}, {hex: '#9C9CA3', weight: 0.0665}, {hex: '#5D6179', weight: 0.0486}]},
    {id: 'auto3', title: 'print 4', w: 35.5, h: 23, at: {x: 31.5, y: 29}, keep: 'must', palette: [{hex: '#DFDBD6', weight: 0.3209}, {hex: '#747472', weight: 0.1853}, {hex: '#4B4B49', weight: 0.1747}, {hex: '#A7A6A2', weight: 0.1697}, {hex: '#2C2C29', weight: 0.1494}]},
    {id: 'auto4', title: 'print 5', w: 20.5, h: 32, at: {x: 85.5, y: 44}, keep: 'must', palette: [{hex: '#B2B3AC', weight: 0.2769}, {hex: '#D6D1CA', weight: 0.2557}, {hex: '#BB6C56', weight: 0.2}, {hex: '#617F77', weight: 0.171}, {hex: '#2F2D2A', weight: 0.0963}]},
    {id: 'auto5', title: 'print 6', w: 25.5, h: 17.5, at: {x: 1.5, y: 48}, keep: 'must', palette: [{hex: '#6C5D55', weight: 0.2869}, {hex: '#372D28', weight: 0.2644}, {hex: '#93857C', weight: 0.2635}, {hex: '#B38D2B', weight: 0.1079}, {hex: '#C5BEB1', weight: 0.0772}]},
    {id: 'auto6', title: 'print 7', w: 21.5, h: 24, at: {x: 9, y: 21.5}, keep: 'must', palette: [{hex: '#DAD6D0', weight: 0.4279}, {hex: '#38395D', weight: 0.2388}, {hex: '#1E1E1D', weight: 0.2045}, {hex: '#A6A19D', weight: 0.1172}]},
  ],
};

// The same wall with every piece's size times f, to the half inch (frames come in
// whole and half inches). Positions stay where they were read.
export const scaled = (f) => ({ ...jasonRead, owned: jasonRead.owned.map((p) => ({ ...p, w: Math.round(p.w * f * 2) / 2, h: Math.round(p.h * f * 2) / 2 })) });
