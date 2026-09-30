// The three sample walls for the demo. Inches, origin at the floor on the left
// end of the wall. Room palettes are the colors already in each room (couch,
// wood, bedding), which the engine uses for color harmony.

export const WALLS = [
  {
    key: 'living',
    name: 'Living room',
    note: 'An 84 in couch, a window on the right, two outlets.',
    wall: { width: 132, height: 96 },
    obstacles: [
      { id: 'couch', kind: 'couch', x: 24, y: 0, w: 84, h: 32 },
      { id: 'window', kind: 'window', x: 112, y: 30, w: 18, h: 54 },
      { id: 'outlet-1', kind: 'outlet', x: 10, y: 12, w: 3, h: 5 },
      { id: 'outlet-2', kind: 'outlet', x: 100, y: 12, w: 3, h: 5 },
    ],
    owned: [],
    room: { palette: [{ hex: '#8D8F8E', weight: 0.5 }, { hex: '#A0714A', weight: 0.3 }, { hex: '#E7E6E2', weight: 0.2 }] },
  },
  {
    key: 'bedroom',
    name: 'Bedroom',
    note: "Jason's bedroom: a bed, a lamp and a dresser, and two prints he already owns. Measurements are estimates.",
    wall: { width: 120, height: 96 },
    obstacles: [
      { id: 'bed', kind: 'headboard', x: 18, y: 0, w: 62, h: 40 },
      { id: 'lamp', kind: 'lamp', x: 84, y: 0, w: 10, h: 64 },
      { id: 'dresser', kind: 'dresser', x: 96, y: 0, w: 22, h: 36 },
      { id: 'switch', kind: 'switch', x: 4, y: 46, w: 3, h: 5 },
    ],
    owned: [
      { id: 'blue', title: 'blue print', w: 20, h: 28, keep: 'must', drop: 3, color: '#1F2FA8', palette: [{ hex: '#1F2FA8', weight: 0.8 }, { hex: '#F2F2F2', weight: 0.2 }] },
      { id: 'pink', title: 'pink photo', w: 11, h: 14, keep: 'happy', color: '#E7A3B5', palette: [{ hex: '#E7A3B5', weight: 0.5 }, { hex: '#F3E6E0', weight: 0.3 }, { hex: '#2E6FA8', weight: 0.2 }] },
    ],
    room: { palette: [{ hex: '#5B3A2E', weight: 0.4 }, { hex: '#F1F0EC', weight: 0.4 }, { hex: '#1C1C1C', weight: 0.2 }] },
  },
  {
    key: 'hallway',
    name: 'Hallway',
    note: 'A 5 ft wall with nothing in front of it and a light switch at the end.',
    wall: { width: 60, height: 96 },
    obstacles: [{ id: 'switch', kind: 'switch', x: 4, y: 46, w: 3, h: 5 }],
    owned: [],
    room: { palette: [{ hex: '#D9D4CC', weight: 0.6 }, { hex: '#6E5A48', weight: 0.4 }] },
  },
];

// A sample taste so the first view isn't generic: someone who picked the
// Mediterranean summer shots (coast, pools, tennis, lemons). Labeled as a sample.
export const SAMPLE_PICKS = [
  ['coast', 'desert'],
  ['pool', 'abstract'],
  ['tennis', 'architecture'],
  ['food', 'flowers'],
  ['coast', 'black and white'],
];
