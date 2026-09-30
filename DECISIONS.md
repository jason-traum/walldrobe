# DECISIONS.md

One line per call: date, decision, and why. Newest at the bottom. Change a decision by adding a new line, not by editing an old one.

## Product

- 2026-09-15: Owned pieces are not always the anchor. Why: most people struggle to find art they love and don't know what they want.
- 2026-09-17: Walldrobe (then Walls on Rotation) is the class venture, replacing the food hall.
- 2026-09-21: Rotation is the product; the layout is the service that makes it fit.
- 2026-09-21: When a print is swapped, the old one goes back. Why: returns are the Rent the Runway model.
- 2026-09-21: Trade-in credit dropped, replaced by a small discount. Why: people would trade in what they like least.
- 2026-09-21: Renting originals from local artists is core, not a later add-on.
- 2026-09-30: Prices are set aside for the build. The product doesn't charge in v1; buy links show each source's own price.
- 2026-09-21: Name is Walldrobe, a wardrobe for your walls. "Rent the Runway, for art" stays as a small line. Usage: "pick out something new from your Walldrobe." Rejected: Composed, Walls on Rotation, Reframe.
- 2026-09-30: v1 buys by linking out to each piece's product page. Why: shipping was always the hardest part.
- 2026-09-30: Start with one wall from one photo. Whole apartment later.
- 2026-09-30: Keep flags. Must keep: always on this wall, but the engine may move it. Happy to move: the engine may use it or leave it off this wall. Don't care: used only if it helps. A separate "pin where it is" toggle for a piece that can't move. Rejected: must keep means it stays exactly where it hangs.
- 2026-09-30: Demo art only from CC0 open-access collections (Art Institute of Chicago, The Met, National Gallery of Art, Rijksmuseum). Buyable pieces are link-outs; their images aren't re-hosted unless the source's feed allows it. Local artists only with their OK; anything else labeled as an example.

## Engineering

- 2026-09-30: Rules and scoring for layout and geometry; models only for taste and image understanding. Why: the Dreamy lesson, where an LLM writing plans got expensive and unreliable.
- 2026-09-30: Scanner is web first: one photo, four corner taps, one known measurement, perspective correction in the browser. A native iPhone scanner (RoomPlan with LiDAR) comes later and feeds the same engine. Rejected: native first. Why: no portfolio embed, and slower to test with real people.
- 2026-09-30: The engine is plain JavaScript ES modules with no dependencies, running unchanged in the browser and in Node, tested with node:test. Why: the app will be single-file Preact plus htm with no build step, and `?demo` has to work with no backend. Reopen: if scoring needs heavy math.
- 2026-09-30: Inches internally, origin at the floor on the left edge of the wall, y up. Why: that's how people measure.
- 2026-09-30: Hanging rules v1: centerline 57 in (57 to 60 on a bare wall); gaps 2.5 in (2 to 3); group about 2/3 the width of the furniture below; bottom edge 8 in above a couch back or headboard (6 to 10); over furniture, clearance wins over the centerline. Reopen: after five real walls.
- 2026-09-30: New pieces come in a fixed set of standard frame sizes. Why: the frames stay on the wall, so a swapped print has to fit the same frame.
- 2026-09-30: Scoring weights v1: fit 0.35, taste 0.30, harmony 0.20, balance 0.15. Guesses until the tuning pipeline or real walls say otherwise.
- 2026-09-30: Fit also scores presence (a thin strip over a couch loses to a group with height) and keeps must-keep pieces near the middle. Balance also marks down layouts heavy at the top. Why: the first elevations showed a row of small prints winning over the couch and a must-keep piece drifting to the edge.
- 2026-09-30: Owned pieces get an edge over new art: +0.15 in the pick for happy to move, +0.05 for don't care, and up to +0.04 on the final score. Why: using what you already own is the premise; without it a new print with the same taste score always won.
- 2026-09-30: Unknown obstacle kinds (a lamp, an aquarium) are treated as blockers. Why: the safe default is to keep art off anything we don't understand.
- 2026-09-30: After the first code review: must-keeps always take a statement center; a group over furniture may slide at most 15% of its width off center; positions round to the quarter inch before the hard checks; widths are generated only inside 0.5 to 0.8 of the furniture (0.45 to 0.7 of a bare wall); over tall furniture the center rises as needed and is marked down above 66 in; the search keeps the 40 best-liked pieces per frame size. Why: sixteen findings from a fresh review, each reproduced.
- 2026-09-30: Later, an offline pipeline where a cheaper model tags catalog art and reviews sample layouts to tune weights. Never at request time.
- 2026-09-30: Public repo, jason-traum/walldrobe, docs included. Why: it's a portfolio project for jason-traum.github.io.
- 2026-09-30: Security: every database write goes through a function that checks who is asking; only the publishable key in the frontend; wall photos private by default.

- 2026-09-30: Demo art is modern photography and painting from Unsplash (Unsplash License: free to show with credit, not sold), picked for what people actually hang: aerial pools and beaches, Mediterranean coast, tennis courts, Palm Springs, black-and-white film, neutral abstracts, food and drink. Credited to each photographer with a link. Replaces the CC0 museum line above for the demo. Why: Jason wants cool modern art and photos, not museum pieces; modern art is under copyright, and Unsplash is free to show. Unsplash+ premium photos are excluded.
- 2026-09-30: Taste v0 is a Bradley-Terry model over simple features (category, painting or photo, light, vivid, warm or cool, black and white), fit in the browser from 7 fixed quiz pairs. The demo opens on a labeled sample taste. Reopen: when image embeddings are precomputed for the catalog.

## Design

- 2026-09-30: Direction not picked. Compare structure options first, then visual directions, on real screens. The pitch deck's bone, serif and blue look does not carry over by default.
- 2026-09-30: Picked for the demo (Jason: "you are the expert"): structure 1, wall first, with the three layouts as tabs above a full-width drawing and the pieces beside it. Direction: the hanging diagram, a framer's measured drawing at true scale, tape-measure red for every measurement, nail spot and action. Archivo for text, Archivo Narrow for measurements. Rejected for now: compare view and build-up view; museum label and painter's tape directions. Reopen: after Jason reviews the live demo.

## Prior apps (so Walldrobe doesn't repeat them)

- In.: pale green canvas #EAF2EE, deep green #1E5F55, warm accent #9A4A16, Saira Condensed for wordmark and times, Hanken Grotesk for the rest, green dot on the wordmark.
- Walldrobe class deck: bone #F6F4EF, Cambria serif headlines, Calibri body, blue #1F2FA8.
