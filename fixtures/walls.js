// The three sample walls. Inches, origin at the floor on the left end of the wall.

export const livingRoom = {
  name: 'Living room',
  wall: { width: 132, height: 96 },
  obstacles: [
    { id: 'couch', kind: 'couch', x: 24, y: 0, w: 84, h: 32 },
    { id: 'window', kind: 'window', x: 112, y: 30, w: 18, h: 54 },
    { id: 'outlet-1', kind: 'outlet', x: 10, y: 12, w: 3, h: 5 },
    { id: 'outlet-2', kind: 'outlet', x: 100, y: 12, w: 3, h: 5 },
  ],
  owned: [],
};

// Jason's bedroom, from the before photo. PLACEHOLDER measurements until he
// sends real ones: wall, bed, headboard, dresser, lamp, and both prints.
export const bedroom = {
  name: "Jason's bedroom",
  placeholder: true,
  wall: { width: 120, height: 96 },
  obstacles: [
    { id: 'bed', kind: 'headboard', x: 18, y: 0, w: 62, h: 40 },
    { id: 'lamp', kind: 'lamp', x: 84, y: 0, w: 10, h: 64 },
    { id: 'dresser', kind: 'dresser', x: 96, y: 0, w: 22, h: 36 },
    { id: 'switch', kind: 'switch', x: 4, y: 46, w: 3, h: 5 },
  ],
  owned: [
    { id: 'blue', title: 'blue print', w: 20, h: 28, keep: 'must', drop: 3, palette: [{ hex: '#1F2FA8', weight: 0.8 }, { hex: '#F2F2F2', weight: 0.2 }] },
    { id: 'pink', title: 'pink photo', w: 11, h: 14, keep: 'happy', palette: [{ hex: '#E7A3B5', weight: 0.5 }, { hex: '#F3E6E0', weight: 0.3 }, { hex: '#2E6FA8', weight: 0.2 }] },
  ],
};

export const hallway = {
  name: 'Hallway',
  wall: { width: 60, height: 96 },
  obstacles: [
    { id: 'switch', kind: 'switch', x: 4, y: 46, w: 3, h: 5 },
  ],
  owned: [],
};

export const SAMPLE_WALLS = [livingRoom, bedroom, hallway];
