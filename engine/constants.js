// Hanging rules and scoring weights. Every number here has a line in DECISIONS.md.
// Change a number only with evidence, and record the change there.

export const RULES = Object.freeze({
  centerline: 57,        // group center on a bare wall, inches from the floor
  centerlineMax: 60,     // still fine up to here
  gap: 2.5,              // space between frames
  gapMin: 2,
  gapMax: 3,
  gapHard: 1.5,          // never closer than this
  anchorRatio: 2 / 3,    // group width over furniture
  anchorRange: [0.55, 0.8],
  wallRatio: 0.6,        // group width on a bare wall, share of the open span
  wallRange: [0.5, 0.7],
  clearance: 8,          // bottom edge above a couch back or headboard
  clearanceMin: 6,
  clearanceMax: 10,
  ceilingSoft: 10,       // keep the top at least this far below the ceiling
  ceilingHard: 6,
  blockerClear: 3,       // windows, doors, TVs and the like
  fixtureClear: 1,       // outlets and switches
  pinnedClear: 2,        // pieces pinned where they hang
  edge: 3,               // distance from the ends of the wall
  minAnchorWidth: 30,    // narrower furniture doesn't set the layout
  minOpenWidth: 12,      // narrower than this is not a place to hang art
  defaultDrop: 2,        // wire or hanger below the top edge, when unknown
  soloMinRatio: 0.35,    // one piece alone may be this narrow, since frames stop at 40 in
  anchorShift: 0.15,     // a group may slide at most this share of the furniture's width off center
  centerlineSoftMax: 66, // over tall furniture the center may rise; above this it's marked down
  countRange: [0.35, 0.9], // with an exact piece count asked for, widths generated over this share of the furniture or open span
  maxCount: 20,          // the most pieces a person can ask for
  flowLow: 20,           // free-form layouts: no frame's bottom lower than this from the floor
  flowMax: 20,           // free-form layouts: the most pieces one wall gets
  minSideWidth: 20,      // an open stretch beside the TV or furniture narrower than this isn't offered
  sideRatio: 0.75,       // group width in a stretch beside the TV or furniture, share of the stretch
  sideRange: [0.5, 0.95],
  sideLow: 20,           // beside the TV or furniture, a group's bottom no lower than this from the floor
  slideMax: 6,           // on open wall, how far a group may move up or down from eye level to clear furniture
  columnMaxOpen: 48,     // an open wall narrower than this may take a stack of pieces
});

// The two styles a person picks between.
export const STYLES = Object.freeze({ structured: ['flow', 'statement', 'line', 'grid', 'column'], gallery: ['flow', 'salon'] });

export const WEIGHTS = Object.freeze({ fit: 0.25, taste: 0.25, color: 0.25, design: 0.25 });

// Outer frame sizes in inches, [width, height]. New pieces only come in these,
// so a swapped print always fits the frame already on the wall.
export const SIZES = Object.freeze({
  salon: [[8, 10], [11, 14], [16, 20], [18, 24], [10, 8], [14, 11], [20, 16], [12, 12]],
  grid: [[8, 10], [11, 14], [12, 16], [16, 20], [10, 8], [14, 11], [16, 12], [20, 16], [12, 12], [16, 16]],
  flank: [[8, 10], [11, 14], [12, 16], [16, 20], [18, 24], [12, 12], [10, 8], [14, 11]],
  large: [[18, 24], [24, 30], [24, 36], [30, 40], [24, 18], [30, 24], [36, 24], [40, 30], [30, 30]],
});

export const STANDARD = Object.freeze([...new Set(Object.values(SIZES).flat().map(([w, h]) => `${w}x${h}`))]
  .map((k) => k.split('x').map(Number)));

export const SEARCH = Object.freeze({
  perSize: 40,          // candidates kept per frame size, best taste first
  beam: 8,              // partial assignments kept while filling slots
  rowOptions: 40,       // row compositions kept per row in the two-row search
  perFamily: 6,         // structures kept per family before filling
  maxFixed: 8,          // more owned pieces than this on one wall is not supported
  improveTop: 10,       // finished layouts that get the improvement pass
  alternatives: 12,     // pieces tried in each open slot during that pass
  passes: 2,
});

export const FAMILIES = Object.freeze(['flow', 'statement', 'line', 'grid', 'column', 'salon']);
