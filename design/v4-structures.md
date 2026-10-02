# v4 step 3: three structures for the loop

2026-10-02, evening. Proposed by Claude, waiting on Jason's pick.

Content held constant for all three, from the real engine (`tools/v2_proto.mjs` setup): the sample living room (11 ft wide, 8 ft tall, an 84 in couch, a window on the right), Jason's two prints (the blue print, 23 x 32 in, and the smiley print, 26 x 18 in), and the long-title fixture on the first new piece. The engine makes 24 walls for this setup; the first is "Both of yours, two new. A loose gallery wall over the couch, 51½ in across." with the long-title piece and Ocean Waves.

In the drawings, `═` is blue tape (a new piece) and `─` is a frame (yours). Widths are 390 px, about 40 characters. "Adjust" is a placeholder name for the one door per screen; the real name is a step 4 call (FEEDBACK 21: "Change" wasn't clear).

What is the same in all three, so it isn't repeated below:

- The piece sheet (tap any piece, on the drawing or its row): choices for that spot with favorites that fit first, "See all that fit", Keep in every wall, Remove this frame, the heart, sizes. For your own pieces: Stays where it hangs, Leave it out.
- The door (Adjust): layout preferences (kind, how many, how full, which art), new art in the open frames, move pieces by hand, measurements, put it back, taste test, your pieces, favorites, fix what's marked, new wall.
- Get it: as a63c921, with each piece's suggested frame in words.
- The working wall keeps itself after every change; Save adds it to Your walls; Undo steps back one change.

## The loop used for tap counts

1. Pick the second wall in the list.
2. Swap one new piece for a favorite that fits; keep the other new piece in every wall.
3. Save the wall.
4. Remove a frame, then undo it.
5. Make another: a different layout (the kept piece comes along), swap one piece, save.
6. Compare the two saved walls.

## A. The Oct 1 build, extended

The a63c921 structure with nothing reorganized: the feed is where a layout is chosen, the open wall is where art is curated, and a new Your walls screen is where saved walls are compared.

### A1. Feed

```
 Walldrobe         Your walls 2   Adjust
┌──────────────────────────────────────┐
│ Sample wall                          │
│    ┌────┐ ╔═══════╗ ┌──────┐ ╔══╗  ▮ │
│    │blue│ ║  new  ║ │smiley│ ║  ║  ▮ │
│    │    │ ║       ║ └──────┘ ╚══╝  ▮ │
│    └────┘ ╚═══════╝                ▮ │
│  ┌─────────────────────────────┐     │
│  │            couch            │     │
└──────────────────────────────────────┘
 1 of 24
 Both of yours, two new. A loose
 gallery wall over the couch, 51½ in
 across.
 $ for 2 new prints

┌──────────────────────────────────────┐
│ wall 2 of 24, same size              │
```

Controls: 3 of 4 (wordmark, Your walls once one is saved, Adjust). Content: every wall that fits, full width, best first.

### A2. Open wall

```
 ‹ All walls                     Adjust
┌──────────────────────────────────────┐
│ the wall, full width; tap any piece  │
└──────────────────────────────────────┘
 ‹  Wall 1 of 24  ›         [save] [get]
 Both of yours, two new. A loose
 gallery wall over the couch, 51½ in.
 $ for 2 new prints
 Swapped Ocean Waves for Cherries. Undo

 Yours   [blue] [smiley]
 The blue print moves 4 in right.
 ──────────────────────────────────────
 [img] Portrait of a Woman in a       ♡
       Striped Dress Seated Beside a
       Window, 1887
       26 x 19½ in, $ at Desenio
 ──────────────────────────────────────
 [img] Ocean Waves                    ♡
       16 x 12 in, $ at Desenio
```

Controls: 7 of 8 (back, Adjust, previous and next wall, save icon, get icon, Undo only after a change). Content: the drawn pieces, your pieces as one thumbnail row, a row and a heart per new piece.

### A3. Piece sheet

```
 Portrait of a Woman in a Striped     ×
 Dress Seated Beside a Window, 1887
 26 x 19½ in, $ at Desenio
 Its blue picks up your blue print.

 Try another for this spot
 ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
 │  ♥  │ │  ♥  │ │     │ │     │
 └─────┘ └─────┘ └─────┘ └─────┘
 See all that fit

 [Keep in every wall] [Remove this frame]
 ♡ Favorite
 Sizes  12 x 16  20 x 28  26 x 19½
```

Controls: 6 of 6 (close, See all that fit, Keep, Remove, heart, sizes) plus the choices. The two hearts are favorites that come in this spot's size; the other two are the engine's best.

### A4. Your walls

```
 ‹ Back                        New wall
 Your walls
 ┌─────────────────┐┌─────────────────┐
 │ wall A          ││ wall B          │
 │ ┌──┐╔══╗┌──┐    ││  ┌──┐┌──┐╔═══╗  │
 └─────────────────┘└─────────────────┘
 4 pieces, 2 new    3 pieces, 1 new
 $                  $
 Only here: Cherries Only here: Gateway
 [Compare]
```

Controls: 3 of 4 (back, New wall, Compare). With exactly two saved walls they show side by side at once; with more, tap two to compare. Each drawing at about 180 px wide keeps the shape readable, not the art.

### A in numbers

| | |
|---|---|
| Taps for the loop | 19 (1, 5, 1, 3, 6, 3) |
| Over budget | Nowhere. Spares: one on the feed, one on the wall, one on Your walls |
| Optimizes | Calm and continuity: the build you liked, the ranked list full width, one job per screen |
| Gives up | Compare is two screens from the wall (back, then Your walls). Changing the layout means going back to the list; the previous and next arrows soften that |
| Empty | No saved walls: Your walls is hidden on the feed until the first save; opened from Adjust it says "Save a wall and it lands here. Save two to compare them." No favorite fits a spot: "None of your favorites come in this size here." then the best four |
| Failed | Engine error: "Something broke building your walls. Your photo and pieces are saved on this device." with Try again. A save that fails stays on screen with "Didn't save. Try again." An image that fails shows its title in the mat; the long title wraps to three lines and never truncates |

## B. Shortlist from the feed

Save walls straight from the list without opening them; they collect in a strip at the top of the feed, where you compare. The open wall is the same as A.

### B1. Feed

```
 Walldrobe                       Adjust
 Your walls  [A ][B ]          Compare
┌──────────────────────────────────────┐
│ Sample wall                   [save] │
│    ┌────┐ ╔═══════╗ ┌──────┐ ╔══╗  ▮ │
│    │blue│ ║  new  ║ │smiley│ ║  ║  ▮ │
│  ┌─────────────────────────────┐     │
│  │            couch            │     │
└──────────────────────────────────────┘
 1 of 24
 Both of yours, two new. A loose
 gallery wall over the couch, 51½ in.
 $ for 2 new prints
```

Controls: 3 of 4 (wordmark, Adjust, Compare once two are saved), plus a save icon on every wall in the list (24 here) and a thumbnail per saved wall in the strip.

### B2. Open wall: as A2. B3. Piece sheet: as A3.

### B4. Compare (from the strip)

```
 ‹ Back
 ┌─────────────────┐┌─────────────────┐
 │ wall A          ││ wall B          │
 └─────────────────┘└─────────────────┘
 4 pieces, 2 new    3 pieces, 1 new
 [Open A]            [Open B]
```

### B in numbers

| | |
|---|---|
| Taps for the loop | 18 (1, 5, 1, 3, 6, 2) |
| Over budget | Not by the count, but every wall card gains a control, and the strip pushes the first wall down about 80 px once something is saved |
| Optimizes | Steps 3, 5 and 6: collecting candidates fast and comparing without leaving the list |
| Gives up | Your order. It invites saving before curating, and it puts a row of things above the first wall again, which is what broke main |
| Empty | No strip until the first save |
| Failed | As A; a save that fails stays marked on the card with "Didn't save. Try again." |

## C. One wall, the list under it

No separate feed: your wall is the home screen, and the ranked list continues full width underneath it ("Other walls that fit, with your kept pieces"). Tapping one makes it your wall; the one you had keeps itself, and Undo brings it back.

### C1. Your wall

```
 Walldrobe                       Adjust
┌──────────────────────────────────────┐
│ your wall, full width; tap any piece │
└──────────────────────────────────────┘
 Both of yours, two new. A loose
 gallery wall over the couch, 51½ in.
 $ for 2 new prints         [save] [get]
 In this wall [blue][smiley][new][new]

 Other walls that fit, with your kept
 pieces
┌──────────────────────────────────────┐
│ wall 2 of 24                         │
└──────────────────────────────────────┘
 Both of yours, one new. Lined up,
 74¾ in across.
```

Controls: 5 of 8 (wordmark, Adjust, save icon, get icon, Undo after a change, plus Your walls inside Adjust). Content: your wall's pieces as one thumbnail row, then every other wall.

### C2. Piece sheet: as A3. C3. Your walls: as A4.

### C in numbers

| | |
|---|---|
| Taps for the loop | 18 (1, 5, 1, 3, 5, 3) |
| Over budget | No |
| Optimizes | Going back and forth between layout and art without changing screens and without modes; what Astra wanted, without the switch |
| Gives up | The list starts below your wall, about 600 px down, so browsing layouts means scrolling past it. A tap in the list replaces your wall, which can surprise even with Undo. One screen does two jobs, against the playbook's one dominant job per screen. Per-piece rows shrink to one thumbnail row |
| Empty | No saved walls: as A. One wall fits: the "Other walls" heading says "This is the only wall that fits here." |
| Failed | As A; if the list below fails to build, your wall still shows |

## Side by side

| | A. Oct 1, extended | B. Shortlist | C. Wall over list |
|---|---|---|---|
| Where a layout is chosen | Feed, full width | Feed, full width, with save marks | Under your wall, full width |
| Where art is curated | Open wall | Open wall | Your wall |
| Save | Icon on the open wall | Icon on every wall card and the open wall | Icon on your wall |
| Make another | Back, or the arrows | Back | Tap another wall below |
| Compare | Your walls | Strip on the feed | Your walls |
| Loop taps | 19 | 18 | 18 |
| Most visible controls on one screen | 7 | 3 plus 24 card icons | 5 |
| Changes to the a63c921 structure | Adds Your walls | Adds the strip and card icons | Merges the feed into the wall |

## Recommendation: A

Tap counts are within one of each other, so they don't decide it. A keeps the structure that worked, keeps the ranked list as the first and only thing on its screen, matches Jason's loop one step per screen, and fits every must-have with a spare left on each screen. B brings controls back above the first wall, which is how main drifted. C asks one screen to do two jobs and pushes the list you liked below the fold.
