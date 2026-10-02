# PRODUCT.md

Walldrobe is Rent the Runway, for art: a wardrobe for your walls. You show it one wall and the art you already own. It gives you a finished wall, sized and spaced for that wall, that you can change later.

Rotation is the product. The layout is the service that makes it fit.

Status: v2 reset, 2026-10-01. The v1 flow below replaces the one that shipped on 2026-10-01 (see DECISIONS, "v2 reset").

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
- What the new pieces cost at the store they link to.
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

## The flow (v3, 2026-10-02)

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
