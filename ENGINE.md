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
  prefs: { budget: null, maxPieces: 9, families: null },
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
    rank: 1, family: 'salon', score: 0.81,
    parts: { fit: 0.90, taste: 0.78, harmony: 0.72, balance: 0.85 },
    anchor: { id: 'couch', kind: 'couch' },          // or { kind: 'wall' }
    group: { x, y, w, h },
    pieces: [{
      ref: { source: 'owned', id: 'blue' },          // or 'catalog'
      title, w, h, x, y, cx, cy,
      nail: { x, y },                                // where the nail goes
      nailNote,                                      // only when the wire drop was guessed
      price, role: 'center',                         // center, flank, fill, pinned
      reason: 'Your blue print stays, in the middle over the couch, because it's the one you said you'd keep.',
    }],
    left: [{ id: 'pink', reason: 'Left off this wall so the blue print has room. It would work on a narrower wall.' }],
    total: 245,
    summary: 'A two-row hang over the couch, 56 in wide, built around your blue print.',
  }],
  problems: [{ code: 'FAMILY_SKIPPED', message: 'No grid: your pieces are different sizes.' }],
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

1. **Find the hanging zone.** Subtract blockers from the wall. If there's an anchor (the widest anchor at least 30 in wide), the zone sits over it: centered on it, bottom edge 8 in above its top. Otherwise the zone is the widest open span at 57 in, centered on that span.
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
