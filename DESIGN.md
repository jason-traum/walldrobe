# DESIGN.md

Status: demo direction picked on 2026-09-30 (see DECISIONS): wall first, hanging-diagram look. Tokens live at the top of web/site.css. The rules below are fixed.

## What the design is for

The wall is the hero. People are judging art, and art needs neutral surroundings, so the interface stays quiet and the pieces carry the color. Show the finished wall before any list of pieces. The one place the design earns attention is the thing that makes Walldrobe different: dimensions you can trust.

## Fixed rules

- The first thing on the first screen is a finished wall.
- Art is never stretched or distorted. Crop with `object-fit: cover`, keep the native aspect ratio.
- Metadata (title, artist, size, price, source) stays below the art in weight, the way a museum label sits next to a painting.
- One accent color, used only for actions, selection, focus and dimension marks.
- Sizes read as people say them: "24 x 36 in", "57 in to center", "11 ft 0 in wide".
- No em dashes in any copy. Sentence case. Buttons say what happens ("Buy on Etsy", "Save this wall"). No exclamation points, no hype words.
- Sample content is labeled everywhere it appears: "Sample wall", "Example. Not for rent yet."
- Tap targets about 44 px, inputs at least 16 px, safe areas respected, explicit background on html and body.
- WCAG 2.2 AA contrast for every text and background pair. Visible focus outline.
- Motion only with a reason: a piece settling into its slot, a layout swap. Under 250 ms, ease-out, and none with reduced motion.
- Check every screen at 320 and 390 wide and on desktop, with a long title fixture ("Portrait of a Woman in a Striped Dress Seated Beside a Window, 1887").

## Structure options to compare first

Same content in each, a real sample wall and a long title:

1. **Wall first:** the top layout on the wall at full width, swipe for the next layout, pieces listed below.
2. **Compare:** three layouts side by side as small walls, tap one to open it.
3. **Build up:** the wall starts with your own pieces, and suggestions arrive one at a time to keep or skip.

## Visual directions to try after the structure is picked

Each starts from something in the subject's own world:

- **Museum label.** White wall, black type, one small label style for metadata. The art is the only color. Risk: cold, and close to every gallery site.
- **Hanging diagram.** The wall drawn as an elevation with fine dimension lines, measurements and nail marks, like a framer's work order. Signature element: the measurements themselves. Risk: paper textures drift into the cream and brown look below; keep it on white or light gray.
- **Painter's tape.** How people actually mock up a gallery wall: blue tape rectangles on the wall. Proposed pieces show as tape outlines before they're placed. Risk: a gimmick if it's used for more than proposals.

## Looks to avoid unless we pick them on purpose

- Cream or off-white background with a serif display face and a terracotta or sage accent. The class pitch deck (bone #F6F4EF, Cambria, blue #1F2FA8) sits close to this, so it does not carry over by default.
- Near-black with one bright accent; indigo or violet accents; gradient text.
- Identical rounded cards with one soft gray shadow; colored side borders on cards.
- Tracked all-caps labels above headings; one italic word in a headline; monospace as decoration.
- Emoji as icons; arrows added to button text; fade-up on every section.
- In.'s look (pale green canvas, deep green, Saira Condensed and Hanken Grotesk). Walldrobe should not read as a sibling.

## Tokens

In `web/site.css` `:root`, light and dark: bg, surface, ink, ink-2, muted, line, field-line (input borders, 3:1 on both grounds), wall-ink (wall size label), accent (tape-measure red, #B53A22 light, #F08A6E dark), measure (#B0371F in both themes, because the wall drawing stays light), wall, furniture, frame, mat. Type: Archivo 400 to 700 for text, Archivo Narrow 500 to 600 for measurements and nail lines. Radius 6 px. Art sits in a black frame with a white mat on a light neutral wall in both themes. Dark mode never redefines the wall, furniture or glass tokens: the drawing stays light. Status notes use a fill, not a colored left border. Inputs and buttons are at least 44 px tall.

## Reference screens

`design/references/`: the approved first screen and one hard state, saved as files after the pick. Compare new work against these, not memory.
