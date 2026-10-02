# HANDOFF.md

Where Walldrobe stands and how to pick it up cold. Written 2026-10-01 for the next working session (a new chat, Claude Code, or a person). Read this first, then CLAUDE.md, PRODUCT.md, ENGINE.md, STATES.md, DESIGN.md and DECISIONS.md, in that order. When this file and DECISIONS.md disagree, DECISIONS.md wins for product calls; this file wins for "what's in flight".

## 1. What Walldrobe is

"Rent the Runway, for art." You photograph one wall. The site reads it (corners, size in inches, what's on it), and proposes layouts with real prints in real frame sizes, nail positions included. You keep or swap pieces later. Free beta, built by Jason Traum (Wharton MBA, first year) as an entrepreneurship project that started as "Walls on Rotation".

- Live site: https://jason-traum.github.io/walldrobe/ (GitHub Pages, served from `docs/` on `main`)
- Also embedded on Jason's portfolio at https://jason-traum.github.io/projects/walldrobe.html
- Repo: github.com/jason-traum/walldrobe (public)
- Two working docs live in Jason's Claude account, not in this repo: the "Walldrobe Layout Engine Brief" (problem, history, approach, reviewed by an outside AI called Astra) and "Walldrobe To-Dos" (the checklist). Don't link them from anything public.

## 2. How Jason wants to work

- No em dashes anywhere: code, comments, test names, docs, UI copy, messages.
- Plain words, short sentences. Answer first. He's direct and impatient with hedging; he'll say "wth" when something regresses.
- Never stretch an image. Crop and keep the native aspect.
- `?demo` saves nothing.
- No links to Claude artifacts on public sites.
- Ask before running "stop-slop" style edits on his own writing.
- He approves GitHub device codes himself. Never enter or print credentials.
- His apartment photos stay private: never in the public repo.
- Every product call gets a dated line in DECISIONS.md.
- Run `node --test` after every engine change. UI checks at 320, 390 and desktop widths, every state in STATES.md, real screenshots only.

## 3. Code map

Everything runs in the browser. No server, no account, the photo never leaves the phone.

| Path | What it is |
| --- | --- |
| `engine/` | Pure layout engine. No DOM, no network, no clock, seeded randomness only. Same input, same output. |
| `engine/index.js` | `layout(input)` and `refill(input, prev, opts)`. Prepares candidates, runs generators, fills frames with prints (beam search), judges, ranks, explains. |
| `engine/geometry.js` | Blocked regions (obstacles plus buffers), free intervals, zones (`findZone`, `findZones`), `placeGroup`, hard checks. |
| `engine/structures.js` | The set shapes ("families"): statement (one piece, or one with matching sides), line (row), grid, column (stack, narrow stretches only), salon (two-row gallery). `offeredSizes()` builds frames in the sizes the catalog sells. |
| `engine/flow.js` | NEW, not live: the free-form packer. Maps the open wall, grows layouts frame by frame from seed spots. See section 6. |
| `engine/design.js` | Design checks: balance, focal piece, rhythm, variety, flow, mirror pairs, look-alikes. |
| `engine/theory.js`, `color.js` | Color profiles (CIELAB, CIEDE2000), schemes, 60/30/10, repetition. |
| `engine/taste.js` | Ten-pick quiz model and taste scores. |
| `engine/reasons.js` | One-sentence reasons per piece, layout summaries and notes. |
| `engine/constants.js` | Every rule number (gap 2.5 in, eye level 57 in, buffers, ratios). Each has a dated reason in DECISIONS.md. |
| `web/main.js` | The whole site: hash-router single page. Screens: start, corners, size, check, things, pieces, taste, layouts, get. |
| `web/detect.js` | Photo reader: `suggestWall` (corners from Hough lines plus model labels, soffits, hidden floor from a TV stand), `readWall` (items), `guessWidth` (scale from a 55 in TV with a depth factor, or a door, bed, couch, ceiling). |
| `web/segcore.js`, `web/segment.js` | Image model: SegFormer B2 ADE20K, quantized, about 29 MB from Hugging Face, run with onnxruntime-web 1.21.0 (jsdelivr), single thread, cached with the Cache API. Non-commercial license: fine for the beta, must be replaced before charging. |
| `web/photo.js` | Homography, flatten, palettes, paint-out. |
| `web/draw.js` | SVG wall drawings. |
| `tools/build_site.mjs` | Bundles `web/main.js` with esbuild into `docs/index.html`. |
| `tools/segment.mjs` | Labels a photo in Node with onnxruntime-node (model cached in `tools/.cache/`). |
| `test/` | About 136 tests. `detect.test.js` uses Jason's living room fixture (`test/fixtures/living_room*.png`, 450 px wide, plus model labels). |
| `demo/catalog.json` | About 1,500 pieces: about 840 real prints (Desenio, House of Spoils) in 13 frame sizes, plus free photos (Unsplash, Pexels, Pixabay). |

## 4. Build, test, check, ship

```
npm install --no-save esbuild        # once per machine
node --test                          # all tests
node tools/build_site.mjs node_modules/.bin/esbuild   # writes docs/index.html
cd docs && python3 -m http.server 8765               # local check
```

Browser checks were done with Playwright (Chromium) against `http://localhost:8765/?demo`, with the onnxruntime files and the model routed from local copies so the photo reader runs offline. Upload a fixture with `#photo-input`, click `[data-act="corners-ok"]`, then read `.found .f-name` and `.layout-tab .lt-name`.

**Pushing (the way it's been done from a cloud session).** The cloud container can't push. Jason's Mac is linked; his clone is `~/Projects/walldrobe`, and his git credentials live on the linked machine. Flow: commit in the container, `git bundle create wdNN.bundle <last-pushed>..main`, send the bundle to the Mac (`~/Projects/wdNN.bundle`), then on the Mac clone fresh into a temp folder, fetch from the bundle, fast-forward, and `git push origin main`. Don't run git inside `~/Projects/walldrobe` from a sandboxed shell that can't delete files: it leaves lock files behind. If it happens, remove `.git/index.lock` and friends (with Jason's OK) and fast-forward that clone from origin. Bundles wd9 to wd16 sit in `~/Projects`.

Live is `main` at commit 02b4bea (wd16): layouts beside the TV, the "Where" choice, stack shape, "It's the TV" on the likeliest piece.

## 5. What shipped on 2026-10-01 evening (wd18)

- Free-form engine (`engine/flow.js`, section 6) live and leading the list: one group, two coordinated groups, "as it is", repair pass, shape score, staged ranking.
- How full (Calm, Balanced, Full) on the layouts screen.
- "Must keep" split: Stays put, Must use, Happy to move, Don't care. The count includes pieces that stay put. Stepping the count keeps the frames on screen (`input.base`).
- Core nesting sizes for new prints. Art that isn't up yet (add by size, optional photo). The "Where" control is gone.
- All 140 tests pass. A full set of layouts takes about 0.2 to 0.5 s per wall on a fast computer.

## 6. The layout engine: where it's going

The core lesson (DECISIONS 2026-10-01): every earlier version hard-coded the designer's first decision, where the art goes ("over the anchor"), then patched in more places. Jason's living room broke it: 26 to 29 in of height over the TV, a 34 in print, open wall on the left. He wants the engine to look at all the open space plus buffers and decide like a person would, including untraditional layouts, and it must not say "above the TV" or "to the left" as options.

The free-form packer, as built:

1. Open space: the wall inset 3 in from the ends, 20 in up from the floor to 6 in under the ceiling, minus every obstacle grown by its buffer (3 in around TV, window, door, lamp; 1 in around outlets; furniture footprint plus 6 in above it; 2 in around pinned pieces). Area measured on a 2 in grid.
2. Seeds (up to 6): centered over the two widest anchors; middle of each open stretch 14 in or wider at 47, 57 and 67 in.
3. Grow: first frame at the seed (or nearest fit within 30 in). Each next frame beside, above or below a frame already up, one 2.5 in gap away, lined up with its top, bottom or middle (edges only for neat runs). Score each spot: closeness to the group's center (weighted round, wide or tall), shared lines, eye level, a little seeded noise. Take the best spot for the size the plan wants, falling back through sizes.
4. Runs: 6 seeds x 6 size plans (hero, mixed, small, and three neat ones with one or two sizes) x 3 growth directions. Own pieces go in first, largest first; a must-keep that can't fit kills the run; a happy-to-move one that can't fit is skipped. A snapshot after every frame, so one run gives every count.
5. Shortlist: pre-score shapes (coverage of open space up to 30%, bounding-box fill, eye level); best per count band and look.
6. Fill with prints, judge, rank.

**Done in wd18:** items 1 to 4 below, except the speed target on a phone (not yet measured on a phone). **Still open:** the photo reader (section 7), the drag-and-snap editor, the nail-confirm step, the stock-wall review sheet. The original list, for reference:

1. Fix the scoring.
   - Bounding-box fill must not punish wrapping the TV: measure art against the open area inside the box, per group.
   - "Fill the wall" becomes a fullness target the person picks: Calm, Balanced (default), Full. Penalize too little and too much.
   - A lead piece only when the composition wants one; an equal set (grid) is fine.
   - Don't pull owned art to the middle.
   - Judge balance against the furniture and the wall, not only inside the group.
   - Rank in stages: valid, then the arrangement must pass, then taste, color, reuse and cost. Great color must not rescue an awkward arrangement.
   - Using the person's own pieces counts much more.
   - "Leave it as it is" (their pieces where they hang, nothing new) must be a real candidate.
2. Better candidates.
   - Seeds from where each frame size actually fits: pockets, not 3 fixed heights.
   - A repair pass on the best few: move a whole group, move an edge piece, swap sizes, drop a piece, rebuild a small area.
   - A shortlist that keeps different structures, regions, main sizes and uses of own art.
   - More than one placement order for movable must-keeps.
   - Measure generation (was a good layout in the pool?) separately from ranking (did the top 3 show it?).
3. Two coordinated groups across a window, door or empty stretch: shared top or bottom line, repeated sizes, balanced masses. Judge each group and the pair. Record each layout's structure (groups, shared lines, lead, anchor).
4. Frames and controls.
   - New prints from a curated core of about 6 to 7 shop sizes that nest: 12x16, 14.5x18.5, 19.5x26, 20x28, 24.5x33.5, 31.5x44, plus 39.5x56 for big walls. Two 14.5 wide frames plus a 2.5 in gap make 31.5. Owned art stays at its real size.
   - "One more piece" adds a piece instead of reshuffling: pass the shown layout's frames, prefer candidates that contain them.
   - Under 1 s on a phone. It's about 0.4 to 1 s per wall on a fast computer now.
   - Fix the failing tests.

Then the screens: the fullness choice; "must keep" split into "stays exactly where it hangs" and "must be in it, can move" (and decide whether the count includes pieces that stay put); ship "art that isn't up yet"; later a drag-and-snap editor with locks and spacing guides, and a step that confirms one real measurement and the hanger drop before showing nails (until then nail spots are estimates).

## 7. The photo reader: known problems

From a run on 81 Unsplash room photos (section 8):

- Corners often stop at the furniture or cover part of the wall. The floor was found in 9 of 81, the ceiling in 16.
- A TV mounted on the wall and off is read as art; the TV rules assume a stand.
- A couch back is sometimes read as a TV, which then sets the wall's scale.
- Gallery walls: some frames are missed.
- A TV that's on (showing a picture) reads as a painting. The code now catches it on the composite fixture (`test/fixtures/living_room_tv_on.png`), and "It's the TV" goes on the biggest wide piece as a fallback; still unverified on Jason's real phone photo.
- Add error margins: grow uncertain boxes, and check layouts still fit at plus or minus 5 to 10% scale.
- Ask only the questions that change the answer: TV or art, does this piece stay, a known measurement.

## 8. Test assets (private, not in the repo)

Copied to Jason's Mac at `~/Projects/walldrobe-private/`:

- `jason/`: his 9 apartment photos (the 09:04 batch) and the living room set with model labels (`setcm/*.png`, `*.labels.json`).
- `stock/`: 81 Unsplash room photos picked for whole, fairly straight-on walls (`full/NN.png`, `NN.labels.json`), `evalset.json` (photographer, page link, category: bare, sofa, tv, bed, other), `eval_read.json` (what the reader found), overlay sheets `read0-4.jpg`, and the scripts `run_eval.mjs` and `seg_all.mjs`. Unsplash license; credit the photographers if any are ever shown.
- `bundles/`: nothing yet; the `wdNN.bundle` files are in `~/Projects`.

The cohort message asking classmates for wall photos is drafted (without promising them a layout) and not sent.

## 9. Decisions taken today (all in DECISIONS.md except where noted)

- Layouts beside the TV, then free-form over all open wall (2026-10-01).
- Defaults Jason accepted for the next build (record these in DECISIONS.md when they ship): core of about 6 nesting sizes for new prints; fullness defaults to Balanced with Calm and Full one tap away; the editor comes before the nail-confirm step.
- Defer: owning a modular frame system, a metric depth model, a vision-model critic (offline experiment only, later), whole-home allocation (grow the "closet" over time instead).

## 10. Other open items

- Design pass on the layouts screen; earlier proposal of near-black main buttons with red kept for measurements, never answered.
- The image model's license is non-commercial.
- Budget should be a hard limit, not a ranking factor.
