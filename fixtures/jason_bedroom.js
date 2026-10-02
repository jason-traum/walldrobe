// Jason's bedroom wall as he hung it by hand, measured from his photo at about
// 9.9 px per inch (a queen headboard, 64 in wide, checked against a 32 in dresser).
// No photo data here, only the numbers.
//
// The photo was measured with x from the left end of the headboard and each frame's
// top measured down from the ceiling line. The photo doesn't show the floor, so this
// assumes an 8 ft 6 in ceiling (102 in). Here everything is in the engine's own
// convention: inches, origin at the floor on the left end of the wall, y up.
//
// Assumptions, so they can be checked against the room:
// - The wall runs from 30 in left of the headboard to the corner. The photo puts the
//   corner at about 99 in right of the headboard, but the dresser (a known 32 in) runs
//   to 105 and sits against the corner, so the wall is taken to 105: 135 in in all.
// - The headboard top is 31.3 in off the floor (70.7 in under the ceiling, "about 70"),
//   so the running poster's bottom is the half inch above it the photo shows.
// - The door frame and the leaning mirror are one blocker, 82 in tall.
// - Sizes are what the photo shows, to the half inch (frames come in whole and half
//   inches, and the engine's nails land on the quarter inch, so a frame's middle has
//   to as well). `frame` is the nearest standard frame, for buying.

const X = 30;        // headboard's left end, from the wall's left end
const CEIL = 102;    // floor to ceiling

// [x0, x1] from the headboard's left end, top measured down from the ceiling, w x h as measured
const HUNG = {
  smiley:   { x0: -5.8, top: 28.5, w: 22.7, h: 15.7, frame: [24, 16] },
  pink:     { x0: 21.2, top: 21.0, w: 11.7, h: 16.6, frame: [12, 16] },
  blue:     { x0: 36.0, top: 11.9, w: 18.3, h: 27.0, frame: [18, 27] },
  running:  { x0: -0.4, top: 47.0, w: 18.4, h: 23.2, frame: [18, 24] },
  drawing:  { x0: 21.4, top: 40.8, w: 33.1, h: 21.9, frame: [36, 24] },
  chair:    { x0: 57.1, top: 23.3, w: 14.0, h: 21.2, frame: [14, 21] },
  marathon: { x0: 74.0, top: 17.7, w: 18.9, h: 29.7, frame: [20, 30] },
};

const r1 = (v) => Math.round(v * 10) / 10;
const half = (v) => Math.round(v * 2) / 2;
const at = (k) => ({ x: r1(HUNG[k].x0 + X), y: r1(CEIL - HUNG[k].top - HUNG[k].h) });

const PALETTES = {
  smiley: [{ hex: '#E9C440', weight: 0.35 }, { hex: '#8A7F74', weight: 0.5 }, { hex: '#4A423B', weight: 0.15 }],
  pink: [{ hex: '#F2A7BC', weight: 0.6 }, { hex: '#F7DDE4', weight: 0.3 }, { hex: '#C76A86', weight: 0.1 }],
  blue: [{ hex: '#2B2FA8', weight: 0.85 }, { hex: '#F4F4F2', weight: 0.15 }],
  running: [{ hex: '#1C2A4A', weight: 0.55 }, { hex: '#F2F0EA', weight: 0.35 }, { hex: '#C8322B', weight: 0.1 }],
  drawing: [{ hex: '#F1EFEA', weight: 0.55 }, { hex: '#1A1A1A', weight: 0.25 }, { hex: '#8F8F8F', weight: 0.2 }],
  chair: [{ hex: '#C62F2A', weight: 0.3 }, { hex: '#F0EEE8', weight: 0.3 }, { hex: '#4A6E96', weight: 0.25 }, { hex: '#4E7A4A', weight: 0.15 }],
  marathon: [
    { hex: '#F5F3EE', weight: 0.5 }, { hex: '#3E9B57', weight: 0.09 }, { hex: '#E57FA6', weight: 0.08 }, { hex: '#EE8A2E', weight: 0.09 },
    { hex: '#2A9A9C', weight: 0.08 }, { hex: '#2F5FB3', weight: 0.08 }, { hex: '#D8352E', weight: 0.08 },
  ],
};

const TITLES = {
  smiley: 'smiley balloon photo', pink: 'pink photo', blue: 'blue poster', running: 'Running Room poster',
  drawing: 'black and white drawing', chair: 'red chair photo', marathon: 'marathon map poster',
};

export const jasonBedroom = {
  name: "Jason's bedroom, as he hung it",
  wall: { width: 135, height: CEIL },
  obstacles: [
    { id: 'door', kind: 'door', x: 2, y: 0, w: 17, h: 82 },          // door frame and the leaning mirror
    { id: 'bed', kind: 'headboard', x: X, y: 0, w: 64, h: 31.3 },
    { id: 'lamp', kind: 'lamp', x: X + 61, y: 0, w: 17, h: CEIL - 55 },
    { id: 'dresser', kind: 'dresser', x: X + 73, y: 0, w: 32, h: CEIL - 58 },
  ],
  // Keep: in every wall, free to move. `at` is where each one hangs now.
  owned: Object.keys(HUNG).map((id) => ({
    id, title: TITLES[id], w: half(HUNG[id].w), h: half(HUNG[id].h), keep: 'must', at: at(id), frame: HUNG[id].frame, palette: PALETTES[id],
  })),
};

// His arrangement, as placements for scoreArrangement().
export const jasonHung = jasonBedroom.owned.map((p) => ({ id: p.id, x: p.at.x, y: p.at.y }));
