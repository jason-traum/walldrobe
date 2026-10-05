# ENGINE.md

The layout engine. Wall, obstacles, owned pieces and candidate art go in. Ranked layouts come out, with every piece's position in inches and one plain sentence on why it's there.

It is a pure function: no DOM, no network, no clock, no randomness. The same input always gives the same output. It runs unchanged in the browser and in Node, in about 50 to 200 ms per wall, even with a few thousand catalog pieces.

Code: `engine/`. Tests: `test/` (`npm test`). Sample walls: `fixtures/`. Picture check: `npm run elevations`.

## Coordinates

Inches. The origin is the floor at the left edge of the wall. x goes right, y goes up. Every rectangle is `{ x, y, w, h }` with `(x, y)` at its bottom-left corner. Returned pieces also carry their center and a nail point.

## Input

```js
layout({
  wall: { width: 132, height: 96 },                  // floor to ceiling
  obstacles: [
    { id: 'couch', kind: 'couch',   x: 24,  y: 0,  w: 84, h: 32 },
    { id: 'win',   kind: 'window',  x: 110, y: 30, w: 20, h: 54 },
    { id: 'out1',  kind: 'outlet',  x: 10,  y: 12, w: 3,  h: 5 },
  ],
  owned: [
    { id: 'blue', title: 'Blue print', w: 24, h: 32,
      keep: 'must',            // 'must' | 'happy' | 'dontcare'
      pinned: false,           // true: stays exactly at `at`; the layout works around it
      at: null,                // current { x, y } of the bottom-left corner, if pinned
      palette: [{ hex: '#1F2FA8', weight: 0.7 }], drop: 3 },
  ],
  catalog: [
    { id: 'aic-27992', title, artist, year, source, url, image,
      palette: [{ hex, weight }],
      sizes: [{ w: 16, h: 20, price: 65 }, { w: 24, h: 30, price: 120 }] },
  ],
  taste: { 'aic-27992': 0.82 },        // 0 to 1 from the taste model; missing = 0.5
  room: { palette: [{ hex, weight }] },// optional, sampled from the photo
  prefs: { budget: null, maxPieces: 9, families: null, style: null, pieces: null, place: null, fullness: 'balanced' },
  // fullness: 'calm' | 'balanced' | 'full', the share of the open wall art should cover
  base: null, // optional: the frames of the layout on screen [{x, y, w, h}]; stepping the count keeps them
  // style: 'structured' (statement, line, grid, column) or 'gallery' (salon); pieces: an exact count, 1 to 12
  // place: 'over' (the TV or furniture), 'left' or 'right' of it, 'wall' (open wall), or null for anywhere
  count: 3,
})
```

Obstacles need a positive width and height, and palette colors must be hex values; anything else is rejected with a plain error that names the item.

Obstacle kinds fall into these groups:

- **Anchors below the art:** couch, sofa, bed, headboard, console, dresser, sideboard, credenza, desk, bench, table. Their top edge sets the clearance, and the widest one (at least 30 in) sets the group width.
- **Other furniture below the art:** radiator, furniture. Art clears their top by 6 in but they don't set the layout.
- **Blockers:** window, door, tv, mirror, shelf, vent, thermostat, sconce. Art never covers them, plus 3 in of clearance.
- **Small fixtures:** outlet, switch. Only their own rectangle plus 1 in is blocked.
- Unknown kinds (a lamp, an aquarium) are treated as blockers, the safe default.
- Pinned pieces become blockers with 2 in of clearance, and come back in the output where they are.

## Output

```js
{
  layouts: [{
    rank: 1, key: 'salon||56x33|...', family: 'salon', score: 0.81,  // key names the arrangement
    parts: { fit: 0.90, taste: 0.78, color: 0.84, design: 0.88 },
    checks: { harmony, proportion, repetition, temperature, saturation, value, room, balance, focal, rhythm, variety, flow, mirror },
    color: { scheme: 'analogous', colors: ['blue', 'teal'], shares: { blue: 0.55, white: 0.2 }, lean: 'cool', repeated: ['teal'] },
    notes: ['The blue and teal sit on the same side of the color wheel, so the wall reads as one mood.', 'Worth knowing: ...'],
    anchor: { id: 'couch', kind: 'couch' },          // or { kind: 'wall' }
    group: { x, y, w, h },
    pieces: [{
      ref: { source: 'owned', id: 'blue' },          // or 'catalog'
      title, w, h, x, y, cx, cy,
      nail: { x, y },                                // where the nail goes
      nailNote,                                      // only when the wire drop was guessed
      price, role: 'center',                         // center, flank, fill, pinned
      shares: { blue: 0.8, white: 0.2 },             // how much of the piece is each color
      kept,                                          // true for a catalog piece passed in keep
      slot,                                          // the frame slot, only when a piece you own is off a standard size
      reason: 'Your blue print stays, in the middle over the couch, because it's the one you said you'd keep.',
    }],
    left: [{ id: 'pink', reason: 'Left off this wall so the blue print has room. It would work on a narrower wall.' }],
    total: 245,
    summary: 'A two-row hang over the couch, 56 in wide, built around your blue print.',
  }],
  problems: [{ code: 'FAMILY_SKIPPED', message: 'No grid: your pieces are different sizes.' }],
  counts: [2, 3, 4, 5, 6, 8, 9],   // the piece counts the style can make on this wall
}
```

## Hanging rules (v1 numbers, from DECISIONS)

| Rule | Target | Allowed |
|---|---|---|
| Centerline of the group, bare wall | 57 in | 57 to 60 |
| Gap between frames | 2.5 in | 2 to 3 (hard floor 1.5) |
| Group width over furniture | 2/3 of the furniture | 0.55 to 0.8 scored; generated only between 0.5 and 0.8 |
| Group width on a bare wall | 0.6 of the open span | 0.5 to 0.7 scored; generated only between 0.45 and 0.7 |
| Bottom edge above a couch back or headboard | 8 in | 6 to 10 |
| Top of the group below the ceiling | at least 10 in | hard floor 6 |
| Clearance from blockers | 3 in | hard |

Over furniture, clearance wins over the centerline: over a tall headboard the center rises as far as it has to, and above 66 in the fit score marks it down. A group over furniture may slide at most 15% of the furniture's width off center to clear a blocker; past that it isn't "over the couch" any more, so the layout is dropped. On a bare wall the group stays on the open stretch it was centered on.

Every position and gap lands on the quarter inch before the hard checks run, so the numbers that pass are the numbers printed.

## Steps

1. **Find the hanging zones.** Subtract blockers from the wall. If there's an anchor (the widest anchor at least 30 in wide), the main zone sits over it: centered on it, bottom edge 8 in above its top. Otherwise the zone is the widest open span at 57 in, centered on that span. With an anchor, each open stretch at 57 in to its left or right that's at least 20 in wide is a zone too (`place` 'left' or 'right'), where the group fills 0.75 of the stretch and may move up to 6 in from eye level to clear furniture. Every zone is tried unless `prefs.place` picks one; each layout says its `place`, and the output lists `zones`. A column (a stack of two to four pieces on one center line) is built only in a side zone or on open wall under 48 in.
2. **Pick a target box.** Target width from the table above. Target height from the zone and the piece count.
3. **Generate candidates per family.**
   - **Statement:** one large piece, optionally with one or a stacked pair of matching smaller pieces on each side, centered on the big one. A must-keep always takes the center. One piece alone may be as narrow as 0.35 of the furniture, because frames stop at 40 in; the fit score still marks it down.
   - **Line:** three to five pieces in a row, centers on the centerline, equal gaps.
   - **Grid:** 2 or 3 rows by 2 to 4 columns of one frame size, equal gaps, up to `maxPieces`. Skipped when an owned must-keep piece doesn't match a standard size within 1 in.
   - **Salon:** two rows around a horizontal axis. The top row's bottom edges sit on the axis plus half a gap, the bottom row's top edges on the axis minus half a gap. Gaps stretch within 2 to 3 in so the outer edges line up. Pieces to keep and the tallest pieces go in the middle of each row. Rows much heavier on top are marked down. Stacked pairs inside a row come later.
4. **Choose pieces.** Must-keeps are required and take the most prominent slots that fit. Each family is built twice when there are happy-to-move pieces: once with them fixed in, once with them free to fill any slot their size matches. Catalog pieces must offer the slot's exact size; owned pieces may be off by an inch. Only the 40 best-liked pieces per frame size are searched, so a catalog of thousands stays under a quarter second. Value of a pick = 0.6 x taste + 0.4 x color harmony with what's already chosen, plus 0.15 for a happy-to-move piece and 0.05 for a don't-care piece (already theirs, nothing to buy), minus 0.1 for a second piece by the same artist. A small beam search (width 8) avoids greedy dead ends. Ties break by id, so results are stable.
5. **Hard checks.** Inside the wall, no overlaps, gaps at least 1.5 in, nothing covering a blocker, clearance over furniture at least 6 in, top at least 6 in below the ceiling, every must-keep present, within budget when one is set. A layout that fails any check is thrown out, never shown.
6. **Score**, each part from 0 to 1, weighted: fit 0.35, taste 0.30, harmony 0.20, balance 0.15.
   - **Fit:** width ratio against target (0.25), height on the wall (0.2), sideways shift (0.1), even gaps and lined-up edges (0.1), how full the group's outline is (0.1), presence, so a thin strip over a couch loses to something with height (0.15), and pieces to keep near the middle (0.1).
   - **Taste:** mean taste score of the new pieces. A layout of only owned pieces scores 0.7. Happy-to-move pieces count as 0.75, don't-care as 0.5.
   - **Harmony:** color distance (CIEDE2000 on weighted palettes) between each new piece and the owned pieces plus the room. Rewards shared hue families, penalizes more than three.
   - **Balance:** visual weight (area x darkness x saturation). The weight center should sit near the group center (0.4), left and right halves close to equal (0.4), and the weight not riding high (0.2).
   - **Reuse:** plus up to 0.04 for using the happy-to-move pieces.
7. **Rank for variety.** Best of each family first, then the next best overall. No two returned layouts with the same family and the same pieces.
8. **Write the reasons.** Built from facts recorded while placing each piece, by template, one sentence, under 140 characters, plain words, no em dashes. Every piece gets one. Every owned piece left off gets one.

The nail point is the top center of the piece minus its hanger drop. If the drop is unknown the engine uses 2 in and adds a `nailNote`: "Assumes the wire sits 2 in below the top. Measure yours first." Positions come back rounded to the quarter inch.

## Problems the engine reports instead of failing quietly

| Code | When | Message the user sees |
|---|---|---|
| `MUST_KEEPS_TOO_WIDE` | Must-keeps don't fit the zone together | "Your must-keep pieces are 94 in wide together and the open wall is 80 in." |
| `MUST_KEEPS_TOO_TALL` | A must-keep is taller than the space | "Your tall scroll is 90 in tall, and this wall has 66 in to hang it in." |
| `NO_OPEN_SPACE` | Blockers leave no zone, or the wall is too short | "There's no stretch of wall wide enough to hang on." or "This wall is too short to hang art at eye level." |
| `TOO_FEW_CANDIDATES` | Fewer than two pieces come in a standard size that fits | "Not enough art in sizes that fit this wall. Try a looser taste setting." |
| `BUDGET_TOO_LOW` | Nothing fits the budget (optional; prices are set aside for now) | "The cheapest layout that fits is $180." |
| `NO_LAYOUT` | Anything else that leaves no layout | "We couldn't fit a layout here. Try marking fewer pieces as must keep." |
| `FAMILY_SKIPPED` | A family can't be built | Info only, with the reason. |
| `COUNT_DOESNT_FIT` | `prefs.pieces` asks for a count the style can't make here | "6 pieces don't make a structured layout here. 5 do." (`near` carries the closest count that does) |

## Taste interface (built in step 4 of the build order)

The engine only reads `taste[id]`, clamped to 0 to 1. The taste model is separate: pairwise picks from the quiz train a small preference model over precomputed image embeddings and palettes, in the browser. Until it exists, fixtures pass hand-set scores.

## Tests

- **Three fixture walls:**
  1. Living room: 132 x 96 in, an 84 in couch with a 32 in back, a window at the right, two outlets, nothing owned.
  2. Jason's bedroom: bed and headboard, a dresser at the right, the blue print (must keep) and the pink photo (happy to move). Placeholder measurements until Jason sends real ones.
  3. Hallway: 60 x 96 in, no furniture, a light switch at 48 in beside a door.
- **Invariants on 300 seeded random walls:** no overlaps, gaps in range, nothing on a blocker, inside the wall, must-keeps present, same input gives the same output, reasons non-empty with no em dashes.
- **Unit tests:** zone finding, gap math, balance, color distance, nail points, each problem code.
- **Eyeball check:** a dev script writes an SVG elevation of each fixture's top layouts, with dimensions, so a person can look at them. It is a dev tool, not the product UI.

## Tuning later

Weights and rule numbers are v1 guesses. They change only from evidence: real walls people hung, and the offline review pipeline (build order step 8), where a cheaper model reviews sample layouts and tags catalog art. Every change gets a DECISIONS line.

## v2: judging the whole wall

v1 scored pieces mostly one at a time. v2 judges the finished wall the way a designer would: what colors it's made of and in what amounts, whether they follow a known harmony, whether accents repeat, and whether the arrangement has balance, a clear focal piece, rhythm and the right amount of variety. The search then improves the wall against that judgment, not just piece by piece.

Every piece has a color profile. Catalog records carry a measured one (`color.shares`, `color.hues`, `color.chromatic`, `color.value`, warmth, saturation, brightness, and busyness, empty space, focal point and visual weight from `composition`; see CATALOG.md). Owned pieces and the room get an estimated profile from their palette.

The wall's colors are the area-weighted sum of its pieces' profiles: a 24 x 36 piece counts nine times as much as an 8 x 12.

### Color (engine/theory.js)

| Check | What it looks at | Good means |
|---|---|---|
| Harmony scheme | The wall's color wheel (12 slices), smoothed | Most of the colorful area falls inside one scheme: monochromatic (one hue, 90 degrees wide), analogous (neighbors, 150 degrees), complementary (two opposite hues), split complementary (one hue and the two beside its opposite), triadic (three hues 120 degrees apart). Simpler schemes win ties. A wall that's under 12% colorful is neutral, which always works. |
| Proportion | Area share of each color family, neutrals counted together | Close to 60/30/10: one main color, one second, a small accent. A black and white wall is judged on its dark, mid and light split instead. |
| Repetition | Every color that's at least 4% of the wall | It appears in at least two pieces (or in a piece you own, or in the room), so it reads as a choice. One single-appearance accent is allowed if it's in the focal piece. |
| Temperature | Each piece's warmth, by area | Warm and cool don't fight. Mixing is fine with enough neutral between them. |
| Saturation | How vivid each colorful piece is | Similar across the wall; only the focal piece may be louder. |
| Value | Brightness of each piece | Some light and dark variation, not all the same and not all extremes. |
| Room | The wall's colors against the room's palette | They share colors. |

Schemes are judged on the painter's color wheel (red 0, orange 60, yellow 120, green 180, blue 240, violet 300), not on raw Lab hue, where blue sits only 120 degrees from orange. `theory.js` maps Lab hue onto it with fixed anchors taken from typical colors, and scheme colors are named from the art's own color amounts, never the room's.

Color score = 0.3 harmony + 0.15 proportion + 0.2 repetition + 0.1 temperature + 0.1 saturation + 0.05 value + 0.1 room (spread over the others when there's no room palette).

### Design (engine/design.js)

| Check | What it looks at | Good means |
|---|---|---|
| Balance | Visual weight (measured weight x area) | Even left and right, centered, not top heavy |
| Focal piece | The heaviest piece (area x weight) | It's near the middle. In a center-and-sides layout, the center is the heaviest. Grids don't need one. |
| Rhythm | Pieces that touch (side by side or above and below) | Two busy pieces don't sit next to each other; busy and quiet alternate |
| Variety | Categories, themes, black and white | Grids and rows read as a series (same theme, all color or all black and white, one exception allowed in the middle). Two-row hangs and center layouts mix subjects, with no subject over half the wall and no two of the same subject side by side. |
| Flow | Focal points of the pieces on each side | Side pieces look inward: the subject of a left piece sits right of its center, and the reverse |
| Mirror | Mirrored slots in symmetric layouts | Mirrored pieces carry similar weight |
| Distinct | Every pair of pieces: same subject, same colors (the colorful part counts more than the white and gray around it), same light, busyness and empty space, same style | No two look almost the same. A set can share a theme or a color, but three nearly identical water photos is one idea three times. At 0.88 or more a pair counts as look-alikes: 0.04 off the total per pair, a caveat naming them, and the fast pick steers away from them |

Design score = 0.25 balance + 0.15 focal piece + 0.15 rhythm + 0.15 variety + 0.1 flow + 0.05 mirror + 0.15 distinct.

### Total and search

Total = 0.25 fit + 0.25 taste + 0.25 color + 0.25 design, plus the reuse bonus. The beam search fills slots with a fast pick value (taste, color match with what's chosen so far, owned-piece bonus). The best structures then get an improvement pass: for each open slot, the dozen best alternatives are tried in place and kept when the whole-wall score goes up. Two passes.

Each layout returns `notes`: up to four plain sentences on why the wall works (its scheme and proportions, the repeated accent, balance, rhythm), plus one honest caveat when a check scored low.

### Frame sizes

Frames are built in the sizes the art passed in actually comes in: for two-row hangs, grids, rows and the sides of a statement, every offered size from 8 to 27 in on its long side; for a statement piece, 24 to 60 in. The lists in `SIZES` are used only when nothing is offered.

### Style and count

`prefs.style` picks the families: `structured` is statement, line, grid and column (a stack, in narrow stretches only); `gallery` is salon (with at least two frame sizes). `prefs.pieces` asks for an exact count: only structures with that many pieces are built, widths may run over `RULES.countRange` (0.35 to 0.9 of the reference width), and the size lever is ignored. `counts` in the output lists every count the chosen families can make on the wall, so a control can step through only those. Returned layouts show a different arrangement before the same arrangement with other art.

### The size lever

`prefs.scale` from -1 (fewer, bigger pieces) to 1 (more, smaller ones); leave it out for balanced. A wall's size is mostly its piece count (1 to 8 or more) and partly its average frame (8 x 10 in small, 30 x 40 in big). When the lever is set, the structures closest to it are kept through the early cut, their match adds up to 0.12 to the total (`checks.size`), and walls far from it are dropped while enough others are left.

### Keep, swap, refresh, try another

- `layout({ ..., keep: [{ id, w, h }] })`: catalog pieces the person wants to keep go on every layout, like pieces they own and must keep.
- `layout({ ..., exclude: [ids] })`: never use these.
- `layout({ ..., avoid: [keys] })`: skip layouts already shown (every layout has a `key`), for "try a new layout".
- `refill(input, layout, { keep: [ids], swap: id })`: same frames in the same places. With `swap`, only that piece changes; otherwise every piece not kept (and not owned) changes. Pieces it replaces are never picked again for their slot in the same call.


## Free-form layouts (engine/flow.js)

Family `flow`, in both Structured (neat runs) and Loose (loose runs), and first in the list. Nothing fixes where the art goes; the open wall does.

1. **Open wall.** The wall inset 3 in from the ends, 20 in up from the floor to 6 in under the ceiling, minus every blocked region (obstacle plus buffer). Its area is measured on a 2 in grid.
2. **Starting spots.** Over the middle of the two widest anchors, at the lowest height a frame fits. Plus pockets: every place a mid-size frame fits, joined into connected areas; a big area gets up to 4 spots, spread apart, near 60 in.
3. **Growth.** First frame at the spot (or the nearest fit within 30 in). Each next frame beside, above or below one already up, one gap apart, lined up with its top, bottom or middle (edges only in neat runs). Spots are scored on closeness to the group's center (round, wide or tall growth), shared lines, eye level and a little seeded noise. Runs cover spot x size plan (hero, mixed, small; even, even-small, pair) x growth. Owned pieces go in first, biggest first (and smallest first when several must be used). A snapshot after every frame gives every count.
4. **Two groups.** A group of 1 to 4 from one spot, then a second of up to 5 from another spot at least 30 in away, starting on the first one's top or bottom line, kept 8 in clear of it.
5. **As it is.** The person's hung pieces where they are, nothing new.
6. **Stepping the count.** With `base`, runs also grow on from the frames on screen, and the layout that keeps them all leads.
7. **Shape score** (`shapeScore`): fullness 0.24 (log-normal around the target), cohesion 0.18 (art over the open area inside each group's outline), lines 0.13 (frames on a line that 3 or more share), ears 0.10 (no frame attached by under 35% of its side), eye 0.13 (center of mass within 7 in of 60), room 0.14 (centered on the anchor it sits over or wraps; sharing a line with it when beside), balance 0.08 (art plus TV, furniture and lamps across the whole wall). With two groups, room drops to 0.07 and the pair (shared line, repeated sizes) takes 0.07.
8. **Shortlist and repair.** The best of each kind (groups, neat or loose, light/right/full, which thirds of the wall, own pieces used), then a repair pass on the best: drop a piece, shift a group 1.5 or 3 in, move the least attached piece, swap a frame's size.

Every layout's fit is the shape score (free-form) or half the old zone fit and half the shape score (set shapes). Composition = 0.55 fit + 0.45 design; score = 0.5 composition + 0.25 taste + 0.25 color + reuse 0.08 x share of happy pieces used. Layouts more than 0.15 below the best composition are dropped when enough remain.

## Many walls, ranked again (v2 site, 2026-10-01)

- `layout({ ..., count: 24 })` returns up to 24 walls, not 3. The site asks for 24 once per wall and keeps them. On the three sample walls this takes 0.1 to 0.9 s on a laptop.
- Each wall has `why`: `{ who, shape, where, across, text }`, e.g. "Both of yours, one new. Lined up over the couch, 73½ in across." Built by `whyLine()` in engine/reasons.js from the pieces (yours and new), the family, and the furniture or TV the group sits over.
- `rerank(layouts, { taste, saved, skipped, distinct, art })` in engine/rank.js re-orders the list without building anything: the wall's own score, plus the change in taste (a new taste test, a new score map), plus 0.05 for each saved piece on it (at most 0.15), minus 0.06 for each piece swapped away from, minus a tiny amount by its place in layout()'s order so the order holds when nothing has changed. The first wall always adds new art when any wall does, and "as it hangs now" is never first. `distinct: true` keeps only the best of walls that look the same at a glance (`look()`: family, piece count, yours, size to 6 in).
- Fullness, the pieces you own and what's marked on the wall still build the list again; they change which walls exist, not only their order.

## His wall against the engine's (2026-10-02)

Jason hung seven pieces by hand over his bed and likes his wall better than the engine's. `fixtures/jason_bedroom.js` has it (measured from his photo, assumptions listed there), and `scoreArrangement(input, placed)` in engine/index.js judges any hand-hung arrangement with the same hard checks and the same parts layout() uses on a free-form wall, so the two can be compared.

What the numbers said (balanced, his seven pieces kept and free to move, no new art, so taste and color are the same for every wall and only fit and design differ):

- His wall fails one hard rule: the Running Room poster's bottom is 0.5 in above the headboard; the rule is 6. Raised 5.75 in, with the smiley photo above it, it passes.
- His design score is the best of all of them (0.97). He loses on fit, the shape score, against the engine's top two: rows across the wall (lines 0 against 0.71 and 0), centering on the bed (room 0.64 against 0.80 and 0.98), a ragged outline (cohesion 0.77 against 0.79 and 0.96) and balance across the whole wall (0.83 against 0.97 and 0.99).
- What his wall does that the engine's didn't: the biggest piece (the drawing) sits low and on the group's center line, where the engine's best walls put it at a side or on top; and the group spans the bed and the dresser, which the room part only judged against the bed.
- What didn't hold up: his gaps are less even than the engine's (sd 0.46 in against 0 to 0.2), fewer of his neighbors share an edge (2 of 8 pairs against 6 to 8), his skyline has two peaks, not one (the marathon poster rises again past the chair photo), and the weight center sits no lower than the engine's. Warm and dark are split more evenly left and right on his wall, but color by color it's no more even, and the balance check already rates his best. Orientation and size range are the same pieces on every wall.

Three rules came out of it, each behind a weight in `FREEFORM` (engine/constants.js), for free-form walls:

- **Anchor** (0.08 of the shape score): in a gallery wall of five or more, the biggest piece, when it's clearly the biggest (1.1 to 1.4 times the next), sits near the group's center line and not in its top quarter. Three or four pieces may balance a big one off to one side, and an even set has no anchor. A shape whose biggest frame anchors it is its own kind in the shortlist, so one survives to the list.
- **Lines in a loose wall** (0.75 of the lines part): each frame lining up with a frame it touches counts for more than rows across the wall, which a loose wall isn't meant to have. One-group walls only; two groups answer each other through lines across the wall. At 1, a loose row lifted a two-group wall 1.14 times the couch's width into the living room's list.
- **Over two pieces of furniture**: a group that covers at least a third of each of two anchors (a bed and a dresser) is centered on them together, as well as on each one.

And one change to how walls are grown: centered runs (`FREEFORM.centered`) add each next frame where it keeps the group's weight on the first frame's center line, so the first and biggest frame stays in the middle and the rest step out to both sides. They have their own seeds, so every other run is the same as before. No new structure was needed: the free-form runs already make interlocked clusters (every frame locked to a neighbor); they just didn't keep the biggest one in the middle. (The name "salon" is taken by the two-row hang.)

After: the engine's best wall for his pieces puts the drawing low and central over the bed (anchor 0.80, from 0.38), and three of its top five do. His wall comes out 0.765 against 0.782 for the best (0.739 against 0.769 before), so the gap shrank from 0.030 to 0.017; it ranks last of nine, because the engine's walls gained more than his did. The sample walls barely move. Tests: test/jason_bedroom.test.js.

## Every piece you keep, on one wall (2026-10-02)

On Jason's real bedroom photo (fixtures/jason_read.js: seven pieces he keeps, a bed, a dresser and a lamp on a 110 x 97 in wall) layout() returned nothing. Not the width, the fullness or a count cap: the set shapes can't hold seven different sizes (two rows over the bed stop at 0.8 of its width), and free-form growth puts one frame at a time with no going back, so seven pieces covering 66% of the open wall never all went up, though they fit with 2 in gaps.

- **Packing.** When three or more pieces must go up and growth puts all of them up in fewer than three walls, `packAll()` in flow.js packs them: each next piece beside, above or below one already up, a gap apart, settling as low as it can, with a beam of the 48 most compact partial walls (little wasted open wall inside the outline, centered on the furniture, near eye level), at 2.5 in gaps and then 2. Up to two new pieces grow on from each pack where there's room. `canPack()` is the quick yes or no.
- **When they can't all fit.** `prefs.dropFewest: true` leaves out one piece, then two, trying the smallest first (by area), and never more than a third of them. Walls come from the first two sets that work; each carries `dropped: [ids]`, and each piece left out is in `left` with `dropped: true` and the reason. The first problem is `LEFT_OUT` (`pieces`, `sets`). Without `dropFewest`, or when even that can't fit them, the problem is `MUSTS_DONT_FIT`, with the area when that's why.
- **As it hangs now.** When every piece of yours has `at` (and no exact count or base is asked for), that wall always comes back, last, even when it breaks a rule, with `breaks: [{ rule, piece, by, hard, with, message }]`. Rules: `wall-end`, `floor`, `ceiling`, `ceiling-soft`, `furniture-clearance`, `blocker-clearance`, `pinned-clearance`, `gap`, `gap-soft`; `by` is how many inches it's off. When it passes, it ranks with the others and still carries its soft breaks.

## Taste, deeper (2026-10-02)

The longer taste test from PRODUCT.md ("Side pages"): pairs that split one thing at a time, a summary in words the person can correct, and pieces that go together. All in engine/taste.js; numbers in `PROFILE` and `COMPLEMENT` (engine/constants.js).

### Axes

Seven, each from what a record carries. `axesOf(item)` gives every piece a position from 0 (the first word) to 1 (the second):

| Axis | 0 to 1 | From |
|---|---|---|
| `warm` | cool to warm | `color.warmth`; black and white sits at 0.5 |
| `busy` | calm to busy | 0.7 `composition.busyness` (0.03 to 0.45) + 0.3 less empty space |
| `abstract` | figurative to abstract | category (abstract, lines, shadows, graphic), the share of subjects like pattern, stripes, shapes, brushstrokes; minimal and graphic together a little up, people a little down |
| `print` | photos to prints | `medium`: photo 0, print, painting and illustration 1 |
| `light` | dark to light | `color.brightness` (0.2 to 0.85) |
| `vivid` | muted to vivid | `color.colorfulness` (0 to 0.8); black and white sits at 0.5 |
| `bw` | color to black and white | `color.bw` |

A piece of yours has only a palette: warm, light, vivid and bw come from it (warmth on the painter's wheel), the rest sit at 0.5. Warm and vivid aren't compared when either piece is black and white, so black and white is its own axis and doesn't read as muted. (`setting: 'abstract'` turned out to mean a plain background, a painted horse included, so it isn't used.)

Left out: people in the picture (a subject, and the tag weights already carry it), indoor vs outdoor (88% outdoor), time of day and season (mostly day and "any"), symmetric vs loose (measured, but not a thing people name), old vs new (no dates on photos).

### Pairs that learn

`nextAxisPair(catalog, picks, shown, { seed })` asks about the axis the picks have tested least (`axisUncertainty`), from the information the pairs carried so far, so two pairs that split warm and busy at once count for less on each. The pair is one piece from each end of that axis (80 from each end), scored on how far apart they are on it, minus 0.6 for every unit they differ on the other axes, minus 0.08 for each earlier piece of the same subject already shown, plus a little for quality. Which piece goes left is seeded. It returns `[a, b]` with `axis` set, or null; with no picks it starts with warm vs cool. On the demo catalog sixteen pairs ask about all seven axes, and the other axes differ by under 0.15 on average.

### The profile in words

`tasteProfile(picks, catalog)` fits one weight per axis (Bradley-Terry on the axis differences, Newton steps, prior 0.1 toward no lean). Per axis: `lean` is tanh(weight / 4), -1 to 1; `sure` is 1 minus the spread left after the picks against the spread before (0 untested, about 0.46 after one clean pair, 0.59 after two); `words` is the side's word when |lean| is at least 0.25 and sure at least 0.55, else null. The summary is one sentence: up to four leans, clearest first, adjectives as "You lean warm, calm and figurative", the other sides as "you pick prints over photos", then the two least tested axes, "no lean yet on photos vs prints or light vs dark". With nothing known: "No lean yet: pick a few pairs and this fills in." Picks can be pieces or `[winnerId, loserId]`. The profile also carries `weights` (by axis) and `tagWeights` (fitTaste() of the same picks).

`correctProfile(profile, { axis, lean })` takes a side's word ("cool"), a number, or null for no lean. A named side sets a lean of 0.8, the axis is marked `corrected` with sure 1, and the tag weights that say the same thing (warm, sunny for warm; busy, empty space, calm, minimal for busy; and so on) go to 0 so old picks can't argue with it. It returns a new profile; the old one is untouched.

`scoreProfile(profile, catalog)` spreads the axis score and the tag score each 0 to 1 over the catalog, blends them half and half (axes alone when there are no tag weights), and maps onto 0.2 to 0.9 like scoreTaste(). fitTaste() and scoreTaste() are unchanged.

### Pieces that go together

`complement(a, b)` is 0 to 1 and the same either way round: 0.45 color, 0.15 mood, 0.1 style, 0.3 busyness.

- **Color:** 0.35 palette similarity (color.js) and 0.65 how the colorful hues sit on the painter's wheel: the same or neighbors 1, a quarter turn apart 0.25, a triad 0.6, opposites 0.9. A mostly neutral piece goes with most things (0.75).
- **Mood and style:** shared tags, with sunny against moody and calm against bold marked down. Unknown (a piece of yours) is 0.5.
- **Busyness:** two busy pieces side by side score 0, a busy one beside a calm one 1, two calm ones 0.75.

In `rerank(layouts, { ..., art })`, `art` is the catalog items and your pieces (an array or a Map by id). Each wall gets 0.05 x (mean complement of neighboring pieces - 0.5); neighbors are frames within 6 in of each other. So no wall moves more than 0.025, and two walls trade places only when their scores were within 0.05. Without `art` nothing changes. On the first sample wall with the demo catalog it swaps two pairs of walls next to each other in a list of 21, in about 15 ms.

Scale contrast between frames isn't in complement(); the design checks already judge sizes on the wall.

Tests: test/taste_axes.test.js.

## Walls with sections (2026-10-03)

A wall edge (kind `edge`: a corner, a step, a column) splits the wall into sections, and art never crosses one (it keeps 3 in clear, like any blocker). On its own, layout() builds one group, so it sits in one section and the others stay bare. `wallSections(input)` lists the sections left to right as `{ x0, x1 }`.

When there are two or more sections at least 24 in wide (and no exact piece count or base is asked for), layout() also builds walls with art in more than one section:

1. **Each section as its own wall.** The obstacles in it, shifted to its own inches; your pieces whose middle hangs in it; pieces with no place yet and kept prints go to the widest section. Up to 6 of its walls, plus "bare" for a section that holds none of your must-keeps.
2. **Every combination, judged quickly.** Each section's score weighted by its width (0.75) and how the groups sit together (0.25): a middle or top line they share (within 8 in, 0.6) and art in step with each section's width (0.4). At least two sections must have art.
3. **No print twice.** In the best combinations, a print already used in an earlier section is swapped (refill) for the next best in that frame.
4. **Judged as one wall.** `scoreArrangement()` on the whole wall: the same hard checks and the same fit, color and design layout() uses, across every section at once, so one color story, balance across the whole wall and no look-alikes. Score = 0.55 whole wall + 0.3 sections + 0.15 together.
5. **In the list.** Up to 6 section walls (`variant: 'sections'`, family `flow`, `sections: [{ x0, x1, art }]`, `parts.together`) go in among the others by score; the first wall stays the one layout() led with unless a section wall beats it by 0.02. refill() and spotChoices() work on them like any free-form wall.

Two walls seen in one corner photo are still read as one plane, so the far face is drawn flat; reading each face with its own corners comes next. Tests: test/sections.test.js.


## One contract on every path (2026-10-03, from Astra's review)

layout(), refill(), walls with sections and scoreArrangement() now keep the same promises. `test/invariants.test.js` checks each one.

- **Budget inside the search.** With a budget, the beam drops a partial pick as soon as it plus the cheapest way to fill the rest goes over. Before, the search picked the best-liked art and then threw the wall out on price, so a $20 budget could fail when $10 prints fit. When nothing fits, the message names the cheapest wall it could have built (a floor: one print can't fill two frames), and only when price was the reason.
- **Unknown prices.** A catalog size with no price adds nothing to `total` and is counted in `priceUnknown`. It never passes a budget.
- **Sizes a shop stopped selling.** `toCandidate()` keeps only the sizes a live offer comes in, when the record has offers.
- **Walls with sections** skip keys in `avoid` (Show more walls), are checked against the budget as a whole wall, and drop "nothing fits" problems when they add walls.
- **scoreArrangement()** still scores any wall (a person's own), but `fails` also says when it isn't one we'd suggest: excluded art, a size the art doesn't come in, a kept print missing, over the budget. Frame sizes must be positive. A pinned piece listed in `placed` is ignored (finish() adds it once).
- **Pinned pieces count in the wall's colors.** They stay out of the design measures (alignment, gaps), which are about the art being placed.
- **A wire drop outside the frame** (negative, or past the bottom) is treated as not measured: default drop and the "measure yours" note.
- **refill()** keeps each piece's group (`piece.group`, `meta.groups`), and kept or unchanged prints are judged by the same taste as new picks (quality blended in).
- **rerank()'s order prior** is capped at ten places, so it never outweighs a save.

## Frames on the wall (2026-10-03)

A catalog size is what the frame is sold as. On the wall it takes the frame's outside: the size plus `RULES.frameBorder` (0.75 in) each side, unless the shop sells it framed (`framed: true` on the size, from its offers), when the size is already the outside. Candidates, kept prints and refills all work in outside sizes; `priceOf` and the checks look up the size sold through `soldAs()`. Each catalog piece in a result has `frame: { w, h, border }`, the size sold and the moulding. `keep` takes the size sold. Your own frames are measured outside to outside and match a standard frame's outside within 1 in.

## Look-alikes, the gate and speed (2026-10-03)

- Look-alikes are steered away from when picking (`LOOK_PICK`) and judged once in the design score (`distinct`). The extra per-pair penalty on the total is gone.
- The composition gate always applies. When fewer walls pass than were asked for, the best of the rest come after them, marked `weak: true`; `rerank()` keeps weak walls after every passing one.
- Palette similarity and look-alike caches use numeric pair keys.

## Shop prints matted a frame up (2026-10-04)

`toCandidate()` adds, for a shop print sold unframed, the next standard frame up with the print matted inside (`MATTED_UP`: 8x12 in 12x16, 12x16 in 16x20, 12x18 in 18x24, 20x28 in 24x36), unless the shop sells that size itself. The size carries `matted` (the print); a result piece's `frame.print` says so. `prefs.mats: 'none'` leaves these sizes out.

## Mats (2026-10-04, engine/mats.js)

`assignMats(pieces, { family, variant, level })` and `matScore(pieces, mats, opts)`. A catalog size can say how it's easy to buy: `matPrint` (the print a frame sold matted to it holds) and `plainOk`; shop sizes hung a frame up carry `matted`. These become `frame.can = { mat, plain }` on the piece.

- Structured (grid, line, column, statement, flow neat): all the same. Level above some: all matted; below: none; some: the majority of the pieces with no choice.
- Loose: sizes grouped, smallest area first; a size is matted when that brings the count closer to level x pieces with a choice. No single odd one out among four or more, unless it's the unique biggest piece.
- Bare pieces: on a structured wall, the statement piece (the unique biggest in a statement wall) and any frame `BIG_FRAME` (30 in) or more on its long side go without a mat unless the level is All. The rest stay uniform among themselves.
- Score: structured, (0.75 x uniformity + 0.25 x level fit, both over the pieces that are not bare) x (0.8 + 0.2 x share of bare pieces left plain); loose, 0.6 x (0.35 no lone one, 0.35 same sizes match, 0.3 matted pieces centered) + 0.4 x level fit. `judge()` subtracts 0.04 x (1 minus it); `parts.mats` reports it; `finish()` sets each piece's `mat` and `print`.
- `prefs.matLevel`: none, few, some, most (default since Oct 5), all.


## Image scores and the taste meter (2026-10-04, engine/taste.js)

`tools/vision.py` looks at every catalog image once, offline, with free open models (CLIP ViT-L/14 and the LAION improved aesthetic predictor) and writes `tools/vision.json`; `tools/apply_vision.py` puts it on each record as `vision`: `aesthetic` and `art` (ranks within the record's theme, 0 to 1), `looks` (their mean), `concepts` (z-scores for the 30 ideas in `VISION_CONCEPTS`: retro, moody, botanical...) and `embed` (8 PCA numbers). The engine never runs a model.

- Features: `features()` adds `well made` (looks), `art not stock`, one per concept (z / 3) and the 8 image numbers (/ 4). Knowing how well made each piece is lets a pick that's explained by one piece being better stop counting as a lean to its color or subject.
- The quiz (`nextPair`): the shortlist is pieces with looks at least 0.55, art at least 0.35 and the tag pass's quality at least 0.75, best first. A pair differs by at most 0.15 in looks (`QUIZ_GAP`), and pairs are chosen on what can be named; looks and the image numbers are never what's asked about.
- `tasteKnown(picks)`: how sure the picks make us on each of the 7 axes and the 30 concepts, by the information the pairs carry (as `sureOf`, prior 0.04), averaged half and half. 0 with no picks, rising with each pick, never 1. About 36% after 10 picks, 57% after 30, 75% after 60 on a steady picker. `unsure` names the three least known. Saves against swaps count as picks.
- `describeTaste(weights, n, -1)` says what you're less into.

## A whole home (2026-10-04, engine/home.js)

`assignHome(walls, pieces)`: walls main first ({ id, width, height, obstacles, tone }), pieces as they hang ({ id, w, h, palette }). The biggest piece goes on the main wall when it fits there; then each piece, biggest first, goes to the wall where it fits (at most 0.8 of the width and 0.55 of the height) scoring 1 x room left (of 30% of the wall's art zone) + 0.6 x color fit with what's already there + 0.4 x match to the wall's warm or cool. Returns { byWall, unplaced }. Each wall is then laid out on its own with its pieces as must-keeps and its own preferences.

## Frame width (2026-10-04)

A catalog size may carry `border`, the moulding's width; `borderOf` uses it (a size sold framed is still 0). The app sets it for every size when the wall's frame width is Slim (0.5) or Wide (1.5), so outside sizes, slots and the hanging guide all follow.

## A stylist's rules (2026-10-04, engine/styling.js)

`stylingScore(P)` over every piece on the wall (pinned ones too), each part 0 to 1: busy (share of neighbor pairs, frames within 6 in, not both busier than 0.3), balance (the visual weight's center left to right, weight = area x (0.4 + 0.4 x darkness + 0.2 x saturation)), thread (the best non-neutral color family at 12% or more of at least two color pieces, as a share of the color pieces, full at half), bw (0.5 + 0.5 x how far from half black and white). Weighted 0.3, 0.25, 0.25, 0.2. `judge()` subtracts 0.04 x (1 minus it); `parts.styling` reports it.

## Printed borders, core sizes and fair ties (2026-10-04)

- A size can carry `margin`, a white border printed on the paper in inches (Society6: 1 in on X-Small and Small, 2 in on Medium and up). The size is the paper, so the frame is that size. `frameOf()` passes it to the piece's frame; such a size never hangs matted a frame up (`candidateSizes`), and `assignMats()` counts it as matted with no choice, so a grid of matted pieces stays even with it and it never gets a second mat.
- `RULES.coreSizes` adds the standard US sizes (8 x 10, 11 x 14, 16 x 20, 18 x 24, 24 x 36) and the 12 and 20 squares. With three or more core sizes in the catalog only core sizes are used, so before this every Society6 and Juniper size and every square was left out. Every square size made the search about twice as slow, so only the two most sold are in.
- Ties: pieces that score the same are ordered by a fixed hash of the id (`cmpTie` in geometry.js), not its spelling, so no shop prefix wins every tie. Same ids, same order, every time.
- Picking leans on quality as before (`QUALITY_PICK`), now the mean of the reviewed quality score and the image score (`record.vision.looks`) when a piece has both.
- Taste words: a model-read idea (`concept:*`) counts at 0.6 of a tagged fact when choosing the words, so "black and white" beats "gritty" at the same weight.

## Mats asked for, and prints sold with a white border (2026-10-05)

- The default mat level is Most (`prefs.matLevel`, was Some). With Most or All, a wall whose share of matted new pieces is short of the level ranks lower: `MAT_LEAN` (0.05) times the shortfall, so a wall with no mats under Most loses about 0.04. Under Some or less there's no lean; `matScore` still judges how the mats are spread.
- A catalog size can carry `mount` (the art inside a white border, inches) when the shop sells it framed that way (House of Spoils "Border": a Small is an 8 x 12 in image in a 14.5 x 18.5 in frame). `toCandidate` turns it into `{ framed: true, matted: mount }`: the size is the frame's outside, it hangs matted, it can't be flipped, and with `prefs.mats: 'none'` it's left out like any matted size. The same print's full bleed size is another, smaller framed size with no mount. `validateRecord` checks a mount sits inside its frame and checks the 14% shape rule against the mount, not the frame.
- `frameOf` marks a size the shop frames with `shopFramed: true`, so the app prices it as sold (frame included) and finds its offer by the outside size.
