# DESIGN.md

Status: v2 direction picked on 2026-10-01 (DECISIONS, "v2 step 4"): painter's tape. The structure is the feed (DECISIONS, "v2 step 3"). Tokens live on `:root` in the v2 stylesheet and nowhere else. The reference screens in `design/references/` are what new work is compared against, not memory.

## What the design is for

The wall is the hero. People are judging art, and art needs neutral surroundings, so the interface stays quiet and the pieces carry the color. The one thing Walldrobe does that nothing else does is show you your wall finished, at true scale, before you buy or drill. Everything on screen serves that picture.

## The direction and its source

Blue painter's tape on a white wall. It is what the person already does: tape rectangles on the wall to see where frames would go before hanging anything. In Walldrobe, proposed pieces are drawn as tape, pieces you own are drawn as frames, and the hanging guide tells you where to put real tape before you drill.

The tape is drawn as tape, not as a blue border:

- Strips at true width, 1.41 in at wall scale (the standard roll), one strip per side, overlapping at the corners by about 0.4 in the way hand-applied tape does.
- Each strip is a hair off square, up to 0.6 degrees, and no two strips on a wall lean the same way.
- Ends are torn: a short jagged edge, never a clean cut, never a rounded cap.
- Slightly translucent (0.85), so the wall shows through a little.
- Flat color. No gradient, no shadow, no texture overlay.
- The art sits inside the tape with a thin paper-white mat; the tape covers the mat's edge.

Tape is a code. Three colors, each a real roll, each with one meaning, the same on every screen including the hanging guide:

| Tape | Token | Hex | Means | Where |
|---|---|---|---|---|
| Blue, the standard roll | `--tape-strip` | #2F7FD0 | New, proposed | Around every new piece |
| Green, FrogTape | `--tape-keep` | #2F8A4E | New and kept: in every wall, survives re-ranking | Replaces the blue on that piece |
| Orange, rough-surface tape | `--tape-pin` | #C8551A | Stays put: a piece of yours pinned where it hangs | One short strip across a corner of its frame |

All three pass 3:1 on the drawn wall (3.3, 3.5, 3.5). Yellow tape fails (1.6) and is not used. Your other pieces are plain frames: they are real and need no tape. Never a fourth color. The first time two colors appear on a screen, one line under the wall says what they mean ("Blue is new, green is kept, orange stays put"). The saved heart is the marker color in lists and never becomes a tape. Tape never outlines furniture or a control. A button is a solid tape-blue rectangle, not a tape strip.

## Tokens

Light, on `:root`:

| Token | Hex | Role |
|---|---|---|
| `--canvas` | #F4F4F2 | The page. A wall white. |
| `--surface` | #FFFFFF | Sheets, piece rows, controls at rest. |
| `--ink` | #1A1B1A | Text. |
| `--pencil` | #585C5F | Secondary text and every measurement. |
| `--hairline` | #D9DBD8 | Rules between rows. Never around cards. |
| `--tape` | #1B62AC | Action, selection, focus, proposed frames. |
| `--tape-strip` | #2F7FD0 | Blue tape on the drawing: new. 3:1 on the wall is the bar; it is never text. |
| `--tape-keep` | #2F8A4E | Green tape on the drawing: new and kept. |
| `--tape-pin` | #C8551A | Orange tape on the drawing: yours, stays put. |
| `--tape-soft` | #D6E6F7 | Selected background. |
| `--on-tape` | #FFFFFF | Text on a tape button. |
| `--marker` | #9C3A66 | The china marker. Small things only: the saved heart, nail marks, the tick on a piece that's yours. Never a button, never a measurement, never text longer than a word. |
| `--marker-soft` | #F3E2EA | Behind a saved heart. |
| `--error` | #A12A14 | Something went wrong. Not the marker. |
| `--wall` | #E7E6E2 | The drawn wall when there's no photo. |
| `--frame` | #1B1B1B | Frames on pieces you own and in the hanging guide. |
| `--mat` | #FBFBF9 | Mats. |

Dark (`prefers-color-scheme: dark`): `--canvas` #1C1D1C, `--surface` #242624, `--ink` #ECEDEB, `--pencil` #A9ADB1, `--hairline` #343635, `--tape` #7FB3EC, `--tape-soft` #203247, `--on-tape` #0E1A28, `--marker` #E08DB4, `--marker-soft` #3A2430, `--error` #FF9C85. The drawn wall, frames, mats and the three tape strips do not change: a wall is light in both themes.

Contrast, WCAG 2.2 (computed):

| Pair | Light | Dark |
|---|---|---|
| ink on canvas | 15.7 | 14.4 |
| ink on surface | 17.3 | 12.9 |
| pencil on canvas | 6.1 | 7.5 |
| pencil on surface | 6.8 | 6.6 |
| tape on canvas | 5.6 | 7.7 |
| tape on surface | 6.2 | 6.9 |
| on-tape on tape | 6.2 | 7.7 |
| tape on tape-soft | 4.9 | 5.1 |
| marker on canvas | 5.9 | 7.0 |
| marker on surface | 6.5 | 6.2 |
| pencil on wall (measurements) | 5.1 | 5.1 |

Every pair at or above 4.5. Re-run the check when a token changes.

## Type

One family: Switzer (Fontshare, free for commercial use), self-hosted, weights 400, 500, 600. Fallback stack: `Switzer, -apple-system, "Helvetica Neue", Arial, sans-serif` with a size-adjusted fallback face so nothing shifts when the font lands.

| Role | Size / line | Weight | Notes |
|---|---|---|---|
| Why line | 18 / 24 | 500 | One sentence under each wall. The biggest text on the wall screen. |
| Piece name | 16 / 22 | 500 | Wraps. The long-title fixture wraps to two lines. Never truncated. |
| Body, reasons | 15 / 22 | 400 | `--ink` |
| Meta: size, price, shop | 14 / 20 | 400 | `--pencil`, tabular numerals |
| Measurement on a drawing | scales with the wall, never under 13 px on screen | 500 | `--pencil`, tabular numerals |
| Button | 16 / 20 | 600 | Sentence case |
| Count ("1 of 9") | 14 / 20 | 500 | `--pencil` |
| Page title | 24 / 30 | 600 | Only where there is no wall above it |

No all-caps labels. No italic. No bold for emphasis in running text. Numbers that line up get `font-variant-numeric: tabular-nums`. Headings get `text-wrap: balance`, paragraphs `text-wrap: pretty`. Inputs are 16 px or larger.

## Space, radius, surfaces

- Spacing scale: 4, 8, 12, 16, 24, 32, 48. 8 inside a row, 16 between related rows, 32 between a wall and its text, 48 between walls in the feed.
- Radius roles: controls 6 px, sheets 10 px, thumbnails 3 px, tape 0. Nested radius = outer minus padding.
- Surfaces: the feed sits on `--canvas`. A wall drawing has no border and no card around it; its edge is the wall's edge. Piece rows share one `--surface` with hairlines between them, never one card each. Sheets (Change, a piece's detail) are `--surface` with a 10 px radius and one faint shadow, `0 8px 24px rgba(20, 24, 28, 0.12)`, the only shadow in the product.
- Side gutter 16 px at every width. On desktop the feed is a single column at most 760 px wide; a second column to the right holds the piece rows of the wall in view.

## Components

- Button, primary: `--tape` fill, `--on-tape` text, 44 px tall, 6 px radius, 16 px side padding. Pressed: scale 0.97, 120 ms. One per screen.
- Button, quiet: `--surface` fill, `--ink` text, 1 px `--hairline`. Pressed as above.
- Selected (a chip, a row, a toggle): `--tape-soft` fill and `--tape` text. Unselected is outlined, never filled.
- Focus: `outline: 2px solid var(--tape); outline-offset: 2px` on `:focus-visible`.
- Saved: a heart in `--marker`, filled when saved. The only place the marker appears on the wall screen.
- Piece row: thumbnail 56 px wide at the art's own aspect (never stretched), name, meta line, one line of reason, heart. Tap the row for the piece sheet.
- Wall drawing: `web/draw.js` elevation at true scale. Owned pieces as `--frame` frames with `--mat` mats. Proposed pieces as tape. Furniture flat in two greys. Measurements only when asked for, in `--pencil`, except the hanging guide, where they are always on.
- Why line: one sentence, built from the layout: who's in it ("Both of yours, four new"), the shape ("lined up over the couch"), one number ("77 in across"). Then the cost on its own line in `--pencil`.
- Count: "1 of 9" above the why line, `--pencil`.
- Change: one quiet button at the top right of the wall screen. Opens a sheet with how full, just my pieces, as it hangs now, move pieces, make it mine. Nothing from the sheet is on the main screen.
- Undo: every change (swap, move, wall picked) shows "Undo" inline where the change happened, for 10 seconds, and the Change sheet has "Put it back the way it was".
- Sample content: "Sample wall" as a `--surface` chip with `--pencil` text at the top left of the drawing, on every sample.

## Motion

- Press feedback 120 ms, scale 0.97.
- Opening a wall from the feed: the wall drawing stays where it is and the rest of the feed fades, 180 ms ease-out. Back reverses it.
- Swiping between walls with the photo pinned: the art crossfades, 180 ms. The photo never moves.
- Swapping a piece: the new art fades in, 180 ms. No movement.
- Nothing animates on load, on scroll, or on hover. Reduced motion: fades become instant.
- Easing: `cubic-bezier(0.23, 1, 0.32, 1)` on enter. Never ease-in on enter.

## Copy

Sentence case. Plain verbs. Buttons say the outcome: "Get this wall", "Save this wall", "Put it back". Errors say what to do next and never apologize. Say "wall", not "layout". No exclamation points, no hype words, no em dashes anywhere, including comments.

## Named anti-patterns for this project

Things that appeared in the Sept 30 to Oct 1 build and are not allowed back:

- Every block in a white rounded card with a 1 px grey line (the drawing, the tabs, the notes, each piece, each found item).
- One accent doing six jobs: brand, selected, measurement, danger, link, step marker. Tape is action and proposal; pencil is measurement; marker is small marks; error is error.
- Controls stacked above the wall so the first wall is below the fold.
- Segment controls for things the ranked list already covers (style, count).
- Three-column "How it works" rows and feature rows on the home page.
- A step bar whose labels are cut to "1, 2 Layouts, 3" on a phone.
- Measurement labels overlapping art ("57 in to center" across a print).
- 40 px buttons and 18 px checkboxes.

And the playbook's list, which stands: cream with serif and terracotta or sage; near-black with one acid accent; broadsheet hairlines with zero radius; identical rounded cards with one soft shadow; tracked all-caps eyebrows; one italic or colored word in a headline; monospace as decoration; colored left or right borders; gradient text; indigo or violet; slate-900 dark mode; emoji as icons; arrows on button text; fade-up on every section.

## Prior apps, so Walldrobe doesn't read as a sibling

- In.: pale green #EAF2EE, deep green #1E5F55, Saira Condensed and Hanken Grotesk.
- DrinkDock: white and light grey, ink #15181B, amber #F2A20C, Archivo.
- The Sept 30 Walldrobe: tape-measure red #B53A22, Archivo and Archivo Narrow. Gone in v2.
- The Walldrobe class deck: bone #F6F4EF, Cambria, blue #1F2FA8. Tape blue is a different hue (253 vs 269), lighter, on white, with a grotesk.

## Reference screens

`design/references/feed-390.png`: the approved first screen, the feed on the sample living room with Jason's two prints, at 390 wide, light.
`design/references/wall-open-390.png`: one hard state, a wall open with the long-title fixture wrapping and a saved piece, at 390 wide, light.
Compare new work against these, not against memory. Dark versions sit beside them.
