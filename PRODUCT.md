# PRODUCT.md

Walldrobe is Rent the Runway, for art: a wardrobe for your walls. You show it one wall and the art you already own. It gives you a finished wall, sized and spaced for that wall, that you can change later.

Rotation is the product. The layout is the service that makes it fit.

## Who it's for

People who just moved, or just moved in with someone, in their late twenties to late thirties. Mostly renters. They own a few pieces they like and have rehung in every apartment, and the wall still doesn't look right. They are not art buyers. They don't know what size to buy, how high to hang it, or how far apart, and that is where most of the mistakes happen. Jason's New York wall took two years to get right, and nearly every mistake was size and spacing, not taste.

## When they open it

- A week or two after the move. Boxes mostly unpacked, one wall blank or half done. Evening or weekend, standing in the room with a phone. One wall at a time.
- Months later, bored of the wall. They want to change one or two things, not start over.
- After the next move. Same collection, new wall.

## The question the first screen must answer

"What would this wall look like finished, with the things I already own?"

## The decision they make before leaving

Which layout to hang, which of their pieces stay, and which new pieces to get. In v1 that means picking a layout and tapping through to buy at least one piece, or saving the wall for later.

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
- The wall preview: experience. The art is the content, and the interface gets out of the way.
- Marking pieces, the quiz, adjusting a layout: operate. Plain, fast, familiar controls.

## Words

Use: wall, piece, print, original, frame, hang, swap, keep, must keep, happy to move, don't care, your Walldrobe ("pick out something new from your Walldrobe").

Avoid in the interface: curate, elevate, AI, algorithm, SKU, inventory, "gallery wall solution", hype words, exclamation points, em dashes.

## v1 flow

1. Sign up. The demo skips this.
2. Upload a photo of one wall. Tap its four corners and give one known measurement: the wall's width, a standard door (80 in) or an outlet cover.
3. Mark what's in the way: furniture below the art, windows, doors, outlets, switches, a TV.
4. Mark the art you already own on that wall: must keep, happy to move or don't care. A separate "pin where it is" toggle is for a piece that can't move.
5. Taste quiz: pairwise "which one do you like more."
6. Get ranked layouts on your own wall, each with specific pieces, sizes, positions and one sentence on why each piece is there.
7. Buy: link out to each piece's product page. No shipping and no payments in v1.

## Not in v1

Shipping, payments, the printable hanging template, print swaps, renting originals as a transaction, whole-apartment scanning and the native iPhone scanner. Renting originals is still part of the core product (DECISIONS, Sept 21). In v1, local originals appear only with the artist's OK, and anything else is labeled as an example.

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

## Build order

1. Layout engine: a pure module with tests and no UI. Spec in ENGINE.md.
2. Demo UI: three sample walls, open-access art, `?demo`, embeddable at jason-traum.github.io/projects/walldrobe.html.
3. Wall geometry from a photo: corner taps, one known measurement, perspective correction, obstacle marking.
4. Taste: the pairwise quiz, image embeddings and palettes precomputed for the catalog, and a small preference model that runs in the browser.
5. Preview: warp each chosen piece onto the original photo at true scale.
6. Accounts and storage: Supabase auth, a private photo bucket, write functions.
7. A catalog of buyable pieces with link-outs.
8. Offline tuning pipeline: a cheaper model tags catalog art (colors, subject, mood, composition) and reviews sample layouts the engine generates; the reviews tune the scoring weights. It runs offline, never at request time.
9. Native iPhone scanner (RoomPlan with LiDAR) for whole apartments, feeding the same engine.
