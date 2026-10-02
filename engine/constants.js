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
  columnMaxOpen: 48,
  groupApart: 8,         // two groups on one wall stay at least this far apart
  // How full the wall should be: art area as a share of the open wall (after buffers).
  fullness: Object.freeze({ calm: 0.15, balanced: 0.28, full: 0.45 }),
  // New prints come in these frame sizes when the catalog offers them: shop sizes that
  // nest (two 14.5 in frames and a 2.5 in gap make 31.5 in). Either way up.
  coreSizes: Object.freeze([[12, 16], [14.5, 18.5], [19.5, 26], [20, 28], [24.5, 33.5], [31.5, 44], [39.5, 56]]),     // an open wall narrower than this may take a stack of pieces
});

// The two styles a person picks between.
export const STYLES = Object.freeze({ structured: ['flow', 'statement', 'line', 'grid', 'column'], gallery: ['flow', 'salon'] });

// The arrangement (fit and design) carries half the score; taste and color share the rest.
export const WEIGHTS = Object.freeze({ comp: 0.5, taste: 0.25, color: 0.25 });

// The deeper taste test (engine/taste.js, ENGINE.md "Taste, deeper"). Axis leans are
// fit from picks with a weak prior; an axis gets words once it leans and the picks
// have tested it enough.
export const PROFILE = Object.freeze({
  prior: 0.1,      // how hard axis weights are pulled to no lean, and the prior that "sure" counts from
  leanMin: 0.25,   // |lean| at least this to get a word
  sureMin: 0.55,   // sure at least this to get a word: two pairs that split the axis, not one
  correct: 0.8,    // the lean a correction sets when it names a side ("actually cool")
  blend: 0.5,      // share of scoreProfile from the axes when tag weights exist too
  hold: 0.6,       // pair picking: cost per unit the two pieces differ on the other axes
  repeat: 0.08,    // pair picking: cost per earlier piece of the same subject already shown
});

// Pieces that go together (taste.js complement, rank.js rerank). The wall term is the
// mean complement of neighboring pieces, centered on 0.5, times weight, so two walls
// trade places only when their scores are within weight of each other.
export const COMPLEMENT = Object.freeze({
  weight: 0.05,    // share of the rank score; small, so it reorders close walls without overriding fit
  near: 6,         // frames within this many inches of each other are neighbors
  color: 0.45,     // shared or complementary hues, and palettes that sit together
  mood: 0.15,
  style: 0.1,
  busy: 0.3,       // one busy piece beside calm ones is good; two busy side by side is not
});

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

// Free-form walls (flow.js shapeScore), from hanging Jason's own bedroom wall
// against the engine's (ENGINE.md, "His wall against the engine's"). Set a weight
// to 0 to switch its rule off.
export const FREEFORM = Object.freeze({
  // The biggest frame anchors the group: near its center line and not in its top
  // part. Share of the shape score; the other parts share the rest.
  anchor: 0.08,
  anchorMin: 5,            // only in a gallery wall of at least this many pieces; fewer may balance a big piece off to one side
  anchorLead: [1.1, 1.4],  // how much bigger than the next frame the biggest must be to count as the anchor (none to full)
  // In a loose wall, order comes from each frame lining up with a frame it touches,
  // more than from rows across the whole wall. Share of the lines part that is this,
  // in one-group loose walls. At 1 (rows don't count at all) a loose row lifted a
  // two-group wall 1.14 times the couch's width into the living room's list.
  internal: 0.75,
  // Free-form runs that grow around the first frame, keeping the group's weight on its
  // center line (how hard, per foot off it); 0 leaves these runs out.
  centered: 1,
  // A group over more than one piece of furniture is centered on them taken together.
  // How much that counts against centering on one of them (1: as much).
  span: 1,
  spanCover: 1 / 3,        // a piece of furniture counts when the art covers at least this share of its width
});
