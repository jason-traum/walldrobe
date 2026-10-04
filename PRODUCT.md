# PRODUCT.md

Walldrobe is Rent the Runway, for art: a wardrobe for your walls. You show it one wall and the art you already own. It gives you a finished wall, sized and spaced for that wall, that you can change later.

Rotation is the product. The layout is the service that makes it fit.

Status: v4 product reset, 2026-10-02 evening, waiting on Jason (see "v4" below). v4 starts from the a63c921 interface (Oct 1, 11:19 pm) with today's engine, photo reader, catalog, taste and server. The v3 flow further down is paused. Live is still v2 on main.

## Who it's for

People who just moved, or just moved in with someone, in their late twenties to late thirties. Mostly renters. They own a few pieces they like and have rehung in every apartment, and the wall still doesn't look right. They are not art buyers. They don't know what size to buy, how high to hang it, or how far apart, and that is where most of the mistakes happen. Jason's New York wall took two years to get right, and nearly every mistake was size and spacing, not taste.

## When they open it

- A week or two after the move. Boxes mostly unpacked, one wall blank or half done. Evening or weekend, standing in the room with a phone. One wall at a time.
- Months later, bored of the wall. They want to change one or two things, not start over.
- After the next move. Same collection, new wall.

## The question the first screen must answer

"What would this wall look like finished, with the things I already own?"

Finished means with new art in it. The first wall a person sees always adds new pieces around what they own. "Just my pieces" and "as it hangs now" exist, but never first.

## The decision they make before leaving

Which wall to hang. Then: which of their pieces stay, which new pieces to get, and where each nail goes. In v1 that means picking a wall from the ranked list, tapping through to buy at least one piece, or saving the wall for later.

## How choosing works

Not knobs. Walldrobe generates every wall that fits the space once, keeps all of them that pass, and ranks them best to worst for this wall and this person. Ranking is separate from generating, so when a preference changes (a save, a swap, the quiz, how full) the list re-orders in place. It shows them as one scrollable list: the wall drawn at true scale, and one line on why it fits ("Two of yours, three new, lined up over the couch at eye level"). Some walls get 3 options, some get 10. The person scrolls and picks; they don't push Structured or 6 pieces or Balanced to coax an alternative out.

- Every change is reversible. Swapping a piece, changing a wall, moving a frame: there is always a visible way back, never a disappearing toast as the only record.
- Any piece can be saved. Saves feed taste from then on. Swaps and skips count as weak signals. The 10-pick quiz still exists as "Make it mine", one tap from the wall, for people who want to tell us more at once.
- Your own pieces: Keep or Skip on the confirm screen. Keep means it's in every wall and may move. "Pin it where it hangs" is one tap deeper, on the wall, for a piece that can't move. (Default, not settled; see DECISIONS.)

## Facts that change the decision

- Does it actually fit: real inches, clear of the window, the outlet and the couch.
- Are my pieces in it, and did it respect the ones I said I'd keep.
- What the new pieces cost at the store they link to. (Hidden in v4 for now: pricing will change, FEEDBACK 72.)
- Does it look like me, or like a catalog.
- Can I change it later without new holes (the frames stay, the prints swap).

## What makes them hesitate

- Putting holes in a rental wall in the wrong place.
- Spending on art they'll be tired of in a year.
- A photo of their apartment going somewhere they didn't expect.
- Generic picks that could be anyone's wall.
- Feeling sold to.

## What they do today

Rehang the same prints. Or Pinterest, a tape measure and painter's tape. Or a matching gallery-wall set from Desenio or IKEA that ignores what they already own.

## Surface types

- First screen and demo: persuade. Show a finished wall right away, before any piece list.
- The wall and the list of walls: experience. The art is the content, and the interface gets out of the way.
- Corners, the confirm screen, the quiz, moving a piece: operate. Plain, fast, familiar controls.

## Words

Use: wall, piece, print, original, frame, hang, swap, keep, skip, save, pin, your Walldrobe ("pick out something new from your Walldrobe").

Avoid in the interface: curate, elevate, AI, algorithm, SKU, inventory, "gallery wall solution", layout (say wall), hype words, exclamation points, em dashes.

## v4 (proposed 2026-10-02, waiting on Jason)

### The loop, in Jason's words

"First lock in a layout preference, then curate the art, then save a wall with the pieces in it, then keep playing, make another, then compare them."

1. Lock in a layout.
2. Curate the art.
3. Save the wall with its pieces.
4. Keep playing.
5. Make another.
6. Compare them.

Before the loop: the photo, the corners and one confirm screen (as built). After it: Get it (what to buy, the nails). A feature that serves no step waits.

### Structure: A, the Oct 1 build extended (picked 2026-10-02)

Feed of ranked walls, full width, to choose a layout. The open wall, a stable place to curate one. Your walls, to compare saved walls. Wireframes in design/v4-structures.md. Three rules on top (Astra, via Jason):

- Previous and next on the open wall mean "try another arrangement with my kept pieces". Every wall you have touched keeps its edits, so going back to it finds your swaps and keeps where you left them.
- Your walls is reachable straight from the open wall (it takes the open wall's spare), shown once at least one wall is saved.
- Save adds this wall, as it is now, to Your walls. It is a copy: editing afterwards changes the working wall, never the saved one. Saving again adds another.

First thing to test in the build: after swapping and keeping pieces, can someone try another arrangement and come back without wondering what happened to their work?

### Structure kept from a63c921

The feed of ranked walls is where a layout is chosen. The open wall is where the art is curated. Get it is where you buy and hang. Every lever lives one level down, behind one door per screen. Nothing new goes on a main screen unless the budget below allows it or something comes off.

### Favorites (Jason, 2026-10-02)

"Four alternatives are fine but if you are really buying something you are eventually going to want to see more than four... preference first for your favorites, especially if one of your favorites actually works in the scheme you already have... a way to look at favorites... favorites also feeds the preferences."

- A spot's choices show your favorites that come in a size that fits that spot first, marked with the heart, then the best others. Four show at once; "See all that fit" lists every print that fits that spot, favorites first.
- Favorites have their own page, one level down, with "See it on my wall".
- Hearts keep feeding taste (style, subject and the ranking bonus, as built), and a favorite that fits an open frame is tried there first when walls are filled.

### Must have for v4

| Feature | Loop step | Where it lives | FEEDBACK |
|---|---|---|---|
| Ranked walls, each with its why line and cost | 1 | Feed | 2, 3 |
| Layout preferences in one place: kind (any, structured, loose), how many (any, or a set number), how full, which art (shop prints, free art, both, just mine) | 1 | One level down from the feed and the open wall | 13, 18 |
| Stepping the count and back brings the same walls back | 1, 4 | Engine and state, no control | 16 |
| Kept pieces, and art you chose, come along to a new layout where they fit | 1, 5 | Engine, no control | 41 |
| Tap a piece (on the drawing or its row) to open it: its choices with favorites that fit first, then the best four, then "See all that fit"; Keep, Remove this frame and the heart are in the same sheet. No double tap, no long press | 2 | Piece sheet, then a full list for that spot | 31, 59, 64 |
| Three meanings kept apart: keep in every wall, stays where it hangs (yours), favorite (heart) | 2 | Piece sheet; the heart also on each row | 5, 8, 37 |
| Remove this frame: one fewer, the other frames stay | 2 | Piece sheet | 31, 38 |
| New art in the open frames: same frames, new picks, kept and yours stay | 2 | One level down from the open wall | 15 |
| Undo every change, visible, inline | 2, 4 | Under the drawing, only after a change | 4 |
| Your pieces as Keep, Maybe or Skip; one row of thumbnails on the wall, not full rows | 1, 2 | Confirm screen; the thumbnail row on the open wall | 8, 33, 34 |
| The wall you are working on keeps itself: every change is kept on the device as you go, so leaving and coming back finds it as you left it. Save (a small icon) adds it to Your walls to compare; a saved wall keeps its pieces and reopens exactly. No automatic version history: Undo steps back one change at a time | 3, 4 | Open wall | 43, 44, 66 |
| A swap changes only that one piece; every other frame and print stays. Only "New art in the open frames" changes several at once, never kept pieces or yours, and Undo brings them back | 2 | Piece sheet; the door | 31, 66 |
| Make another: back to the feed with everything kept, nothing lost | 5 | The back link, as built | 44 |
| Compare saved walls side by side | 6 | Your walls | 44 |
| Favorites page; hearts feed taste | 2 | One level down | 5, 45, 59 |
| Taste test, easy to find | 1, 2 | One level down, named plainly | 21, 40 |
| Sizes each print comes in | 2 | Piece sheet | 45 |
| Get this wall as a small icon; Get it with the buy list, the engine's suggested frame per piece in words, the nails and the wire drop | after 6 | Open wall, then Get it | 22, 43 |
| Move pieces by hand, measurements | 4 | One level down | (built) |
| Confirm-screen fixes since a63c921: drag any box, close-up above the finger, nudge pad, wall edge, change what a found thing is | before 1 | Corners and confirm screens | 17, 20, 55, 56 |
| Light mode only | all | Tokens | 19 |

### Later: kept, rebuilt after the loop works

These are secondary, not dropped. Their code stays on the v2 and v3 branches and they come back one at a time once the core loop is done. Walldrobe will later have sign-in and become a platform where these live (Jason, 2026-10-02).

| Feature | Why it waits | FEEDBACK |
|---|---|---|
| Frame looks, mats, weights, per-piece finishes | Comes after the loop; the suggested frame in words covers Get it for now | 22, 23 |
| Walls people hung, sharing | Serves no loop step | 25, 26 |
| Browse every print | "See all that fit" covers the loop's need | 45 |
| Art filters: people, price, color, shop | Not asked for in the loop; which art is enough for now | 13 |
| What we learned page and Never show me | The engine keeps using them; the page waits | 40, 46 |
| Your art from before on a new wall | Small; after compare works | 11 |
| Wall sections and a whole home | Sections on one wall built (2026-10-03); corner photos and a home next | 49, 92 |
| On a computer, small icons on hover (heart, keep) to skip opening the sheet | The phone comes first; same actions, added later | 39, 64 |
| Tap to lock, double tap to like | Replaced: a tap opens the piece (row 64); no double tap, it fights zoom on iPhone | 39 |

### Next: buying it (to do, after framing)

Jason, 2026-10-03: "after framing the next steps we should do are like helping connect people with the cheapest place to actually buy and download the prints... and get the frames."

| To do | What it means | FEEDBACK |
|---|---|---|
| Cheapest way to get each print | For the same art at the frame's size: every shop that sells it, a digital download where the artist offers one, and printing a free photo at an online or local print lab; price with shipping, cheapest first. Links only, never their images re-hosted | 93 |
| Done Oct 3: printing free photos | Where to print on Get it: every print service with prices for your sizes, the best three marked, Copy for your AI to find today's codes | 101 |
| Cheapest frame that fits | A frame in that exact size (and the mat opening for the print), from a few frame sellers, cheapest first, with the mat said in words | 93 |
| One list for the whole wall | Every print and frame with its cheapest source and the total; prices come back here once they are real (hidden for now, row 72) | 72, 93 |
| Way more art (Oct 4) | Today 1,406 active pieces: 658 free photos (Unsplash, Pexels, Pixabay) and Desenio and House of Spoils prints. Next, in order: more free photos through the same pipeline (cheapest, already works); the affiliate feeds decided Sept 30 (Minted, Saatchi Art, Society6, JUNIQE, Artfinder, through Impact, CJ, Awin, Sovrn) once a shop approves; local Philadelphia artists (Open Studio Tours Oct 17 to 18, First Friday Old City, Crane Arts, InLiquid, Cherry Street Pier). Every new piece: tags in tools/tags.json, then `python3 tools/vision.py` and `python3 tools/apply_vision.py` | 127 |
| Ask more (Oct 4) | Jason: "data is powerful and we should ask a ton". Questions asked in the feed, one at a time, never blocking: budget first (built); room colors, who else lives with the wall, what's already framed | 127 |
| Wall reading | Dressers, couch and shelf read as one, corner photos, soffits. Matters more now that the check is skipped by default | 124 |

### Engine only (no interface)

Generate once, rank many (3). The first wall adds new art (7). No price term (10). Move penalty for hung pieces (11). Free-form walls, the packer, the anchor (12, 51). Wall edges (20). Subject in taste, the adaptive test (40). Deeper taste beyond seven axes (28). Seven axes, complements, the event log (46). Scale from every reference, early model download (47). Catalog health (48). Reader fixes (52). Favorites that fit tried first when filling and in a spot's choices (59).

### Control budget

Visible controls per main screen. Content (wall cards, drawn pieces, piece rows, one heart per new piece) is counted separately.

| Screen | a63c921 | v4 budget | On the screen | One level down |
|---|---|---|---|---|
| Feed | 3 | 4 | Wordmark (Your home on a home wall), one door, Your walls once one is saved, the spare spent on "Something off? Fix it" after a read photo (Oct 4) | Layout preferences (with color and an all-in budget), taste test, your pieces, fix what's marked, favorites, new wall |
| Open wall | 7 | 8 | Back, one door, previous and next wall, Save icon, Get icon, Undo after a change, Your walls once one is saved (the spare, spent) | Piece sheet; the door: new art in the open frames, layout preferences, move by hand, measurements, put it back |
| Piece sheet | 5 | 6 plus the choices | Choices (favorites first), See all that fit, Keep in every wall, Remove this frame, heart, sizes; for yours: Stays where it hangs, Leave it out | The full list for that spot |
| Your walls | none | 4 plus wall cards | Back, Compare, New wall, one spare | Rename, delete |
| Frame it | none | 6 plus a size and a Mat tick per piece | Back, frame look, frame width, mat (free photos only), mat width (when a free photo has a mat), Get it | none |
| Get it | 7 | 8 | Back, Print, each row's source link and ticks (one kind each), the price links, Copy for your AI, Hang it, Save | none |
| Hang it | none | 5 plus a hanger per frame | Back, Print, each frame's hanger and measurements, It's up; after: Add a photo, Save, Not up yet | none |

A spare is held, not given to anything until Jason says.

## The flow (v3, 2026-10-02, paused; v4 replaces it once approved)

Five named steps, shown on every screen past the photo: Wall, Taste, Pick, Frames, Hang. One decision per step. Every lever lives one level down, inside the step it belongs to, never on the screen beside the wall.

1. Wall. Photo, corners, then one confirm screen: the flattened photo with everything found, the width and where it came from, Keep or Skip on each of your pieces.
2. Taste. Pairs for about a minute, skippable. "What we learned" shows each lean as one dropdown.
3. Pick. Your wall: the one you're building, drawn full width. Tap a piece to Keep it (it is then in every suggestion), swap it for one of four others for that spot, let it go (one fewer, built around the rest), or save it for later. Every wall you have had stays as a version under the drawing; tap one to bring it back, and the one on screen is kept too. Suggestions is the ranked list of every wall that fits, each with your kept pieces; tapping one makes it your wall. Adjust is one sheet: how many pieces, how full, kind of wall, which art, people, price, color, shop; and this wall's own tools (new art in the open frames, move by hand, measurements, put it back).
4. Frames. The wall drawn with frames. One look for the set; details one level down; tap a piece to change just that one.
5. Hang. What to get, with each frame in words, the nails, the guide, save and share.

Why: people build a wall over a few passes. They like a layout and two of the pieces, swap the third, try one fewer, want the earlier one back. The app has to keep up and never lose a version.

## Walls with sections, and a whole home (proposed, not built)

Most walls aren't one clean rectangle, and walls in one home are seen together. In the 81 stock photos, 33 show a second wall at a corner, 14 have two sections on one plane (panels, slats, two-tone, wainscot), 6 a soffit, 5 an alcove, 3 a sloped ceiling. The shape we'd build to:

- **A wall is one or more sections.** Each section is a rectangle on the wall's plane with its own height and depth: a bump-out sits forward, an alcove back, a soffit lowers the top. Art never crosses a section edge that isn't flush. Each section gets its own layout, and the wall is scored as a whole: a shared center line or top line across sections, the bigger section carrying the bigger group.
- **A home is walls seen together.** Walls that are visible from one spot (a corner, an open plan) share a score: one color story across them, no piece on two walls, different kinds of wall side by side, the biggest group on the wall you see first. Your art and your taste are already per person, so a home just draws on them.
- **Your art across the home.** Which piece goes on which wall comes first (an assignment by fit, size and color), then each wall's layout. A piece can be pinned to a wall.
- **Photos.** One photo per wall is simplest and stays the default. A corner photo could be read as two walls later; today the reader merges the two in 22 of the 33 corner photos.

Order to build: sections on one wall (the soffit is already half of it), then two walls from one corner photo, then a home.

Built (2026-10-03): sections on one wall, split by wall edges, each with its own group and the wall judged as one (ENGINE.md, "Walls with sections"). Not yet: each face of a corner photo flattened on its own, sections with their own height or depth, and a home.

## Side pages (planned)

- **Saved** (built): your hearts from any wall, the sizes each comes in, "See it on my wall".
- **Browse:** every print, by size, price, color and shop; each with its sizes and "See it on my wall". A page of its own, so the wall screen stays free of filters.
- **Taste, deeper:** a longer test whose pairs split one thing at a time (warm or cool, busy or calm, figurative or abstract), then a summary in words you can correct ("You lean warm and calm"). Complementary pairs (pieces that go together, not just each one alone) in the rank pass.
- **Learning from everyone:** log every save, swap, skip and "Get this wall" from day one, so a shared prior exists when there are people; each person's own picks then move them off it.

## Not in v1

- Picking a style (Structured / Loose) or a piece count by hand. The ranked list covers it.
- The Art switch (Prints / Both / Photos) and the filter panel. The catalog is picked for the room.
- Sign-up, sign-in, accounts. Walls save on the device.
- Shipping, payments, print swaps, renting originals as a transaction, whole-apartment scanning and the native iPhone scanner. Renting originals is still part of the core product (DECISIONS, Sept 21). In v1, local originals appear only with the artist's OK, and anything else is labeled as an example.

## Privacy

- Wall photos are private to the person who uploaded them: a private storage bucket, no public URLs, signed links that expire.
- Every database write goes through a function that checks who is asking. The only key in the frontend is the publishable one.
- One tap deletes a wall and its photo.
- `?demo` saves nothing and sends no photo anywhere.
- We don't need people in the photo, and the upload screen says so.

## Success signals

- v1: someone finishes the flow on their own wall and taps a buy link or saves the layout.
- Experiment: a "$50 deposit" button next to an "I'd rather choose" button, to see whether people want Walldrobe picking for them.
- Experiment: a keep, swap or return round with the 15 New York neighbors who asked to borrow prints, then a real price with a deposit.

## Open questions

- Will people let Walldrobe pick, or do they want to choose from options?
- How accurate is one photo plus one measurement? Target: within 2 in across a 10 ft wall.
- Do rule-based layouts produce walls people would actually hang? Test on five real walls before tuning any weights.
- Which buy-link sources allow showing their images (Etsy API, Desenio affiliate, poster shops with feeds)?
- How many walls should the ranked list show before it stops being a list and becomes noise? Start with everything that passes the composition gate, watch where people stop scrolling.

## Build order

1. Layout engine: a pure module with tests and no UI. Spec in ENGINE.md. Done (v0.2, free-form).
2. Demo UI: three sample walls, free-to-show modern art, embeddable at jason-traum.github.io/projects/walldrobe.html. Done.
3. Wall geometry from a photo: corner taps, one known measurement, perspective correction, obstacle marking. Done in `web/` (the site on GitHub Pages).
4. Taste: the pairwise quiz, image embeddings and palettes precomputed for the catalog, and a small preference model that runs in the browser. Quiz done; saves as signals are v2 work.
5. v2 rebuild of the site on the flow above (branch `v2`): structure, then visual direction, then one flow at a time.
6. Preview: warp each chosen piece onto the original photo at true scale.
7. Accounts and storage: Supabase auth, a private photo bucket, write functions.
8. A catalog of buyable pieces with link-outs.
9. Offline tuning pipeline: a cheaper model tags catalog art (colors, subject, mood, composition) and reviews sample layouts the engine generates; the reviews tune the scoring weights. It runs offline, never at request time.
10. Native iPhone scanner (RoomPlan with LiDAR) for whole apartments, feeding the same engine.
