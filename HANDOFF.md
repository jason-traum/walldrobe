# HANDOFF.md

Where Walldrobe stands and how to pick it up cold. Written 2026-10-01 for the next working session (a new chat, Claude Code, or a person). Read this first, then CLAUDE.md, PRODUCT.md, ENGINE.md, STATES.md, DESIGN.md and DECISIONS.md, in that order. When this file and DECISIONS.md disagree, DECISIONS.md wins for product calls; this file wins for "what's in flight".

## 0. Status, 2026-10-05 (read this before the older sections below)

- Branch `v4` is live: `main` is moved up to it after every batch, and GitHub Pages serves `docs/` from `main`. A frozen beta for testers lives at `/walldrobe/beta/` and is updated only when Jason says.
- Since Oct 2: the v4 interface (ranked walls, the open wall, Frame it, Get it, Hang it), budgets all in, prices on every wall, mats as a preference (Most by default), a frame color per piece, Society6 printed borders and House of Spoils' real options (white border or full bleed, three frame colors), a whole home with Get it all, quick questions in the list, the furniture split in the photo reader, 2,110 looked-at pieces.
- Checks: `node tools/check.mjs` runs what a change reaches (`--full` for everything, before pushing main). Underneath: `node --test` (287) and `python3 tools/ui_walk.py <out> [--only sections]` against the built site on port 8830 (about 520 checks at 320, 390 and desktop). The shop link check (`node tools/check_catalog.mjs --no-pages`, then `--apply`) runs from here now for the Shopify shops; Desenio still answers 429. Run them one at a time; together they ran out of memory once.
- Two sites, one codebase (Oct 6): the free site (docs/) and the app site (docs/app/, `node tools/build_site.mjs --app`) with sign in, profiles and Walls people hung. The app talks to its own Supabase project (server/app.sql; web/app.config.js holds its URL and publishable key, empty until the project exists). Oct 6 later: the project is live (oeqdhzzwhpsphmdubdxj) and the app's free tier hides where the art comes from, with Unlock the full plan as a fake door that records a yes (DECISIONS, Oct 6). Waiting on Jason: Google's keys in Supabase (sign-in says "provider is not enabled" until then), and an OK to add the plan_interest table (server/app.sql; the change from here was cancelled waiting for approval). Paying, and a price, come after.
- Open, in Jason's order: see PRODUCT.md "Next: buying it" (the cheapest place for the same print, more free photos, asking who else lives with the wall and what's framed, the photo reader's remaining misses) and the platform later (sign-in, sharing). FEEDBACK.md rows marked To do or Open are the rest.

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

Live is `main` at wd20 (editor and nail confirm). Bundles go up as wdNN, one number per push.

## 5. What shipped on 2026-10-01 evening (wd18)

- Free-form engine (`engine/flow.js`, section 6) live and leading the list: one group, two coordinated groups, "as it is", repair pass, shape score, staged ranking.
- How full (Calm, Balanced, Full) on the layouts screen.
- "Must keep" split: Stays put, Must use, Happy to move, Don't care. The count includes pieces that stay put. Stepping the count keeps the frames on screen (`input.base`).
- Core nesting sizes for new prints. Art that isn't up yet (add by size, optional photo). The "Where" control is gone.
- All 140 tests pass. A full set of layouts takes about 0.2 to 0.5 s per wall on a fast computer.

## 5b. What shipped after that (wd19, wd20)

- wd19 (eaab77f), photo reader: blank wall-mounted TVs found, couch backs never a TV, edges of frames and furniture never the wall's edge, `fuzz` clearance on boxes read from a photo. Section 7 has what's left.
- wd20, editor and nail confirm (all in `web/main.js`, section "Moving pieces by hand"):
  - "Move pieces" on the layouts screen. `snapSpot()` snaps each axis on its own within 9 screen px; `moveProblem()` checks a spot with the engine's own `blockedRegions` and `checkPieces` plus the hard gap to other frames; `movePiece()` updates x, y, cx, cy, nail and slot, regroups the bounding box, keeps an undo list on the layout (`L.history`, stripped before saving) and stores the layout as `draft.chosen` so it survives a reload. Arrow keys nudge (`nudge()`).
  - Refill and the count step use `slot` and `shown()`, so moved spots carry through refresh, swap and plus or minus.
  - Hanging guide: `draft.drop` (wire drop), `sizeMeasured()` for the estimate note, `nailRef()` for "Or 6 in right of the TV's right edge, 10 in above its top".
  - Checked with Playwright at 320, 390 and 1280 on the sample living room: drag, snap guides, refused spot, undo, keyboard, refresh and plus keep spots, drop changes nail heights, no sideways scroll, no console errors.

## 5c. The v2 redo (started 2026-10-01, late evening)

Jason: the site "looks like complete AI slop, too many buttons, not intuitive", full overhaul. He wrote a six-step prompt (Walldrobe_redo_prompt.md) and a design playbook ("Claude Code app design craft", about 2,000 lines; its six review questions, the avoid list in section 10 and appendices A to D are the rulebook). Steps 1 to 6 are done on branch `v2`; `main` and the live site are untouched until he approves the switch.

- Step 1, review: screenshots at 390, 320, 1280, light and dark, in the scratchpad `review/` folder and sent to him as three sheets. Verdict: Fit, Structure and Identity fail; Behavior mostly works; Integrity is good; Continuity partial. Keep the engine and the photo reader, rebuild every screen.
- Step 2, product reset: PRODUCT.md rewritten. The first wall always adds new art. Choosing is a ranked scrollable list of 3 to 10 walls, not knobs. Generate once, rank many: the engine keeps the whole pool past the gate and re-ranks in place when a preference changes (engine work: split taste and color out of generation). Corners, then one confirm screen. Undo everywhere. Saves feed taste. Keep settings default to Keep or Skip (unsettled).
- Step 3, structure: the feed (A) picked over the stage (B) and pieces-first (C), with B's pinned-photo swipe inside an open wall and C's piece rows.
- Step 4, direction: painter's tape. DESIGN.md rewritten with tokens, type, components, motion, named anti-patterns. Prototype: `node tools/v2_proto.mjs` writes `web/v2/proto-feed.html`, `proto-wall.html` and `v2.css` from the real engine on the sample living room with Jason's two prints and the long-title fixture; serve the repo root and open `/web/v2/proto-feed.html`. Reference screens in `design/references/` (feed-390, wall-open-390, light and dark).
- Step 5, build: done on `v2`. `web/main.js` rewritten around the feed: home, start, corners, size, one confirm screen ("Here's your wall"), the feed (`#/layouts`), an open wall (`#/wall`) with a piece sheet and a Change sheet, Get it (`#/get`), Your walls, Make it mine (`#/taste`). New stylesheet on the v2 tokens; `web/draw.js` draws tape (blue new, green kept, orange pin strip) and always frames your pieces. Engine: `layout({count: 24})` returns long lists, `rerank()` in `engine/rank.js` re-orders on saves, skips and taste, `whyLine()` in `engine/reasons.js` writes the one line per wall. `test/rank.test.js` covers it. STATES.md sections 6 to 10 describe every v2 state.
- Step 6, review: a fresh-context review and the B4 audit (findings in the scratchpad `review/audit.md`). Fixed every Blocker and High: the build error loop (now a "Something broke" screen), dark-theme colors on the always-light wall, tape contrast, 44 px targets, focus after every action, "stays" copy on pieces that move, failed images, undo for keep, pin and put back, the open wall jumping on re-rank, one primary on Get it, the confirm screen's notes pushing the photo down, Just mine still using kept new pieces, the tape legend.
- Checked with Playwright: no console errors, no sideways scroll at 320, 390 and 1280, light and dark, sample and photo flows; swap and undo, keep and undo, pin, move by hand, save, how full, just mine.
- Not merged. `main` and the live demo are untouched until Jason says.

Open risks (need a real iPhone or real use):

| Risk | Why it matters |
|---|---|
| Swipe between walls vs page scroll | Only tested with a mouse and touch emulation |
| Sheet safe areas and scroll lock on iOS | The page behind can scroll under a sheet on iOS Safari |
| Text size setting | Text is in px, so iOS larger text doesn't apply |
| VoiceOver with a sheet open | The page behind isn't inert yet |
| Phone speed | Builds take 0.5 to 1.5 s; the loading screen shows at once |
| Big moves of hung pieces under Keep | A kept piece can move far; the move note says so, but it may feel wrong |
| Tape tears at phone size | Faint at 390; may read as a plain border on a real photo |
| Control edges | Quiet button edges are 1.39:1; the labels carry them |
| Desktop feed | One column; the open wall has two |
| Color reasons | Sometimes say left or right wrongly |

## 5e. v2 is live (2026-10-02, noon)

Jason said to switch. `main` is v2 (e2ae9ea) and the site at jason-traum.github.io/walldrobe is v2. The first version is kept three ways: branch `v1`, tag `v1` (both at 6f3fe32), and a working copy at jason-traum.github.io/walldrobe/v1/ (`docs/v1/`, which the build leaves alone). Pushes go from Jason's Mac with a bundle, as before.

## 5g. Where things stand (2026-10-02, 4 pm). Read this first in a new chat.

- Live site (v2, main): https://jason-traum.github.io/walldrobe/ . v1: /v1/. Work in progress: branch `v3`, preview at https://rawcdn.githack.com/jason-traum/walldrobe/<commit>/docs/index.html#/sample/living (use the latest v3 commit).
- v3's wall screen (`wallScreen`, `layoutLens`, `artLens`, `layoutCards`, `artOptions`, `openPiece`, `moreOptions`, `tapArt`, `keepPiece`, `lockOwn`, `likeArt`) is Astra's two-view model plus Jason's tap to lock / double tap to like. Sheets: `layoutSheet`, `artSheet`, `ownedSheet`, `menuSheet`, `versionsSheet` (opened with `data-act="sheet" data-sheet=...`).
- Taste now has subjects (`engine/taste.js`: `subjectStats`, `subjectFactor`, `dislikedSubjects`, `likedSubjects`, `nextAdaptivePair`; `test/subjects.test.js`). In the app: `bySubject` inside `tasteScores`, `nextPairFor` in the quiz, `ME.never` (stored with the person), `subjectsHtml` on the profile.
- FEEDBACK.md is the trail from each piece of Jason's feedback to what changed. Add a row with every change.
- Push flow: bundle from the cloud repo, commit to the Mac's Projects folder, push from there (see section 4). Never print the token.
- Open, in order: Jason tries v3 on his phone; retain non-kept art across layout changes (FEEDBACK 41); merge v3 to main when he says; deeper taste beyond subjects (era, medium, mood); the reader fixes in section 7.

## 5f. v3, the flow (2026-10-02, afternoon, on branch `v3`, not live)

Jason: the app "doesn't tell you what the process is", "too many things you have to pick all at once", "reverting back to slop", "think thru how a real person would be using this". Same redo process as v2 (review against the playbook's six questions, keep/rework/drop, three structures, his pick). He picked the consultation: five named steps, one decision per step, and the Pick step as a wall you build with versions. See PRODUCT.md "The flow (v3)".

- `web/main.js`: `stepBar(i)` on every screen past the photo; `wallScreen` is your wall (versions row, Frames next, Adjust, tap a piece); `suggestScreen` (`#/suggest`) is the old feed; `adjustSheet` replaces the strip, Filters and Change (selects, a count stepper, this wall's tools); `pieceSheet` has Keep, Let it go, Save and "Swap it for" (four `swapOptions` found with `refill` when the sheet opens); `letGo`; versions: `noteVersion`, `openVersion`, `versionsRow`, `S.versions` persisted as `draft.versions`, `S.injected` brings a version back into the view; `framesScreen` (`#/frames`) with `frameSheet` per piece; `frameWords`; `#/layouts` redirects to `#/wall`; the profile's axes are selects.
- Removed: `shapeStrip`, `tasteLine`, `chipSheet`, `changeSheet`, `swapPiece`, swipe between walls, arrow keys between walls, `framePicker` on Get it.
- Checked with Playwright at 320 and 390 (scratchpad `v3/walk3.py`): keep, swap for an alternative, let go, versions back, Adjust (fullness), Suggestions pick, Frames look and per-piece mat, Hang, Taste, profile. No console errors, no sideways scroll. 193 tests pass.
- Not merged. Preview from the `v3` branch via raw.githack.

## 5d. After v2 (2026-10-02, overnight, all on `v2`, then merged)

Built, each with a DECISIONS line:

| Area | What |
|---|---|
| You, across walls | Saves, swaps and art that isn't up live on you (`walldrobe.me.v1`); Saved page; "Your art from before" on a new wall |
| Browse | `#/browse`, every print with size, color and shop filters, sizes and prices per piece, See it on my wall |
| Taste | Seven axes, the quiz splits the least-known one, "What we learned" with one-tap corrections (`#/profile`), complements in ranking |
| Ranking | Move penalty for pieces already up; walls that drop kept pieces rank lower; no price term (test data) |
| Your art on a full wall | Drop as few as possible (`prefs.dropFewest`), a packer when growing frame by frame can't fit them, the wall as it hangs always shown with its breaks |
| Free-form | Anchor (biggest piece low and central), neighbors lining up, centered over two pieces of furniture; from Jason's own bedroom wall (`fixtures/jason_bedroom.js`, `fixtures/jason_read.js`, numbers only) |
| Photo reader | Corner creases, frame splitting, furniture split by kind, edge snap, lean agreement; scale from every reference with a disagreement note; agreeing references as one tap when there's no TV; paint-out samples only wall |
| Setup | Model downloads on the start screen; standard frame size picker |
| Catalog | `tools/check_catalog.mjs` (network check from Jason's machine, `--dry` audit, `--apply`), gone offers and items dropped |
| Learning | Device event log (`walldrobe.events.v1`), nothing sent |

The photo reader bench (40 stock photos plus Jason's bedroom, read by eye) is in the scratchpad `bench/` folder with `run.sh`; it's private and not in the repo. Copy it next to `walldrobe-private/` when the session's files go to the Mac.

Open, needing Jason: headboard clearance for a piece not centered over the bed (his real wall has one 0.5 in above it; the rule is 6 in); a corner photo (ask to shoot square, or read two walls); sections on one plane as layout boundaries; whether a dresser counts as a scale reference; a cap on new pieces added to a wall of your own art (now up to 2 on the packer path, 3 by normal growth); free photos in Browse.

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

### Scale from every reference

`web/detect.js` no longer sizes the wall from the TV alone. `scaleEstimates(found, photo)` lists every reference the read wall offers, each as pixels per inch with the size it was taken at and a confidence: a TV found on its own (48.5 in wide for a 55 in set, times the stand-out depth factor; 0.5, since it could be any size from 43 to 75 in; 0.9 when the person picked the size), a door taller than 40% of the read (80 in; 0.8), a headboard (a queen, 64 in; 0.5), a couch (84 in; 0.4), the ceiling when `photo.ceiling` is passed (96 in; 0.4), an outlet or switch plate (4.5 in tall; 0.9 shrinking with its height in pixels, 0.45 at 40 px, under 0.2 and not counted below about 18 px), and a typed width (1). `reconcileScale(estimates, { w, tvPicked, depthFor })` turns them into one scale: a typed width is the whole answer; otherwise, when the other references disagree with the TV by more than 15% and the person did not pick its size, the TV's size is re-picked from `TV_SIZES` to agree with them best (`tvInches`, `tvWhy: 'others'`); with three or more, an estimate more than 25% off the confidence-weighted median is dropped when two others sit within 25% of it; the rest average as a confidence-weighted geometric mean. `agree` is false when the ones that count still span more than 15% (`spread` is max over min). `from` is the most confident reference that counted, so with a TV and a door it is the door and the check screen shows the door's sentence.

`guessWidth(items, wallWidthPx, tvInches, depth, photo)` now runs both and returns, beside the old `inches`, `from` and `tvInches`: `tvWhy` (`'others'` when re-picked, else null), `ppi`, `agree`, `spread`, `refs` (each reference: from, inches as a wall width, confidence, px, note, counted, why when not) and `note`, one or two plain sentences for the confirm screen: "The door and the TV agree on the size.", "The door and the TV agree on the size, with the TV taken as 65 in.", "The door says 13 ft 4 in and the couch says 16 ft 8 in. Measure to be sure.", "The door and the TV agree on the size. The couch disagrees and was left out.", "Only the TV sets the size. Measure to be sure.", "From your measurement." It still returns null with no TV clear of everything else (DECISIONS 2026-10-01: no quiet default; the person measures or picks a no-tape option), so the door, bed and couch only count beside a TV until that call is changed. `test/scale.test.js` covers it on made-up label maps and the living room fixture (still 120 in with the model, 118 in without: the TV is the only reference there).

Still a guess, and not yet wired:
- `web/main.js` doesn't show `note`, `agree` or `refs` yet, and keeps its own `p.auto.tvInches`: when `guess.tvWhy === 'others'` it should copy `guess.tvInches` and `guess.tvWhy` into `p.auto` (and the `why` map on the check screen needs an `others` line), and the TV-size picker handler should pass `{ tvPicked: true }` as the fifth argument so a chosen size is never re-picked. Until then a re-picked TV sets the width while the picker still reads 55 in.
- The reader doesn't find outlets or switches: ADE20K has no such class and a plate is about 5 by 8 px in the 220 px read, under the smallest blob it keeps. The outlet path takes any item of kind `outlet` or `switch` with a box in the read's pixels, so it works as soon as one is found or marked on the photo.
- The sizes are assumptions: a 7 ft door, a king bed, a 9 ft ceiling or a loveseat each move the answer and only the disagreement flag catches them. The depth factor for a re-picked TV size is recomputed only when `depthFor(dg)` is passed.
- Two references that disagree can't say which is wrong; the note gives both widths and asks for a measurement.

## 8. Test assets (private, not in the repo)

Copied to Jason's Mac at `~/Projects/walldrobe-private/`:

- `jason/`: his 9 apartment photos (the 09:04 batch) and the living room set with model labels (`setcm/*.png`, `*.labels.json`).
- `stock/`: 81 Unsplash room photos picked for whole, fairly straight-on walls (`full/NN.png`, `NN.labels.json`), `evalset.json` (photographer, page link, category: bare, sofa, tv, bed, other), `eval_read.json` (what the reader found), overlay sheets `read0-4.jpg`, and the scripts `run_eval.mjs` and `seg_all.mjs`. Unsplash license; credit the photographers if any are ever shown.
- `bundles/`: nothing yet; the `wdNN.bundle` files are in `~/Projects`.

The cohort message asking classmates for wall photos is drafted (without promising them a layout) and not sent.

## 9. Decisions taken today (all in DECISIONS.md except where noted)

- Layouts beside the TV, then free-form over all open wall (2026-10-01).
- Defaults Jason accepted for the next build (record these in DECISIONS.md when they ship): core of about 6 nesting sizes for new prints; fullness defaults to Balanced with Calm and Full one tap away; the editor comes before the nail-confirm step (both shipped in wd20).
- Defer: owning a modular frame system, a metric depth model, a vision-model critic (offline experiment only, later), whole-home allocation (grow the "closet" over time instead).

## 10. Other open items

- **Rethink the controls (Jason, 2026-10-02):** "with all of these buttons, its feeling more and more like ai slop... we need them but we need to rethink them... maybe its a drop down." The strip (style, fullness, art, count, refresh), the frame looks and the Change sheet all need one calmer pattern. Start from what a person changes most and hide the rest one level down.
- **Taste goes deeper than the seven axes (Jason, 2026-10-02):** "art preferences are def more deep than just the metrics you picked." Warm, busy, abstract, print, light, vivid and black and white are a start. Next: subject (people, places, plants, type), era and style movement, medium, mood, and how pieces talk to each other on one wall. Learn from the pieces people save and hang, not only from a fixed list.
- **Walls feed next:** follow people, most-saved pieces, a page to review reported walls. Walldrobe could move to its own Supabase project after Oct 25 if the race project is paused.
- Design pass on the layouts screen; earlier proposal of near-black main buttons with red kept for measurements, never answered.
- The image model's license is non-commercial.
- Budget should be a hard limit, not a ranking factor.
