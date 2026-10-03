# Walldrobe v4 audit (B4: contrast, accessibility, iPhone, states, tells)

Branch v4 at a22ce0f, 2026-10-03. Audit only; no app code was changed.

How it was checked:

- Source read in full: web/main.js, web/draw.js, web/site.css, web/index.html, web/store.js, web/segment.js, web/social.js, tools/build_site.mjs.
- docs/index.html matches the source: rebuilt from a scratch copy with node_modules/.bin/esbuild and compared byte for byte (identical).
- Playwright (Chromium 141) against http://localhost:8830/index.html at 390 and 320 wide (touch, DPR 2) and 1280 desktop. Every screen in the brief was driven, including the photo path with test/photos/drawn-wall.jpg. In the browser the audit read computed colors with alpha and opacity composited up the tree, measured every visible control's box, sampled screenshot pixels behind SVG text and tape, tabbed through the wall page and the sheets, and emulated forced colors, a dark OS preference, reduced motion, 200% zoom (195 and 160 CSS px), blocked images and offline.
- Contrast: WCAG 2 ratio (gate 4.5 text, 3 large text and UI) and APCA Lc as a labeled diagnostic only (warn under 75 for body, under 60 for labels).

Severity: Blocker stops a core task for most people; High breaks a core task for some people or fails WCAG AA on a core screen; Medium is a real defect with a workaround; Low is polish or consistency.

No Blocker was confirmed. 5 High, 11 Medium, 21 Low, plus 8 risks that need a real iPhone.

---

## Part 1. Confirmed failures, ranked

### High

**H1. A store image that fails to load shows a broken-image icon, never its title** (STATES "Image missing").
- web/main.js:2474-2479: the error handler only catches images inside `.thumb, .art-big, .pick-art`. v4 draws everything else with `.tn` thumbnails (main.js:1298, 1412, 1545, 1637, 1672), and those are not covered.
- web/draw.js:181, 189: on the wall the SVG `<image>` is drawn over the fallback title. When the image fails, Chromium paints its broken-image glyph on top, so the title is hidden. Even when the title does show, it is 3.4 to 6.8 px on screen in the feed (draw.js:188, `font-size` capped at 2.4 in), which nobody can read.
- `.is-missing::after` says "No image" (site.css:242), not the title STATES asks for.
- Why it matters: every shop print is hotlinked from media.desenio.com and cdn.shopify.com (the request log showed 73 and 28 image GETs on one walk). Hotlinking is allowed by CLAUDE.md (no re-hosting), but it means a renamed file or a CDN hiccup puts broken icons on the wall people are judging.
- Confirmed: with those hosts and /art/ blocked, the open wall at 390 showed broken-image glyphs in all three pieces on the drawing, the two "Yours" thumbnails and the big new-piece tile. The `.is-missing` count was 0.

**H2. Tapping a piece in a saved wall's picture on Your walls does nothing.**
- web/main.js:2223-2225: the click handler runs `closest('button, .art, ...')`. The saved wall card's drawing still contains `g.art` groups (draw.js:171, 186, even with `still`), so `.art` matches before the `.wall-card` button (main.js:1615). The handler then finds no `a[data-wall]` and does nothing. The same applies to picking walls to compare (`data-pickwall`).
- Confirmed: at 390, a tap on a piece in the first card left the sheet closed; a tap on the card's name opened it. At 1280, a click in the middle of the card lands on a piece, so the sheet never opened and the desktop walk stopped there.

**H3. The focus ring is cut away on every segmented control.**
- web/site.css:123: `.seg { overflow: hidden }` clips the 2 px outline at 2 px offset (site.css:70), leaving only a 2 px vertical sliver on one side. This affects Adjust (Kind, How many, How full, Art), Keep / Maybe / Skip (main.js:757) and Width / Height (main.js:1008).
- Confirmed: screenshot of "Loose" focused in Adjust at 390 showed a single blue line at its left edge and no ring.

**H4. The main photo button shows no focus at all.**
- web/site.css:204: the real `#photo-input` sits over the label with `opacity: 0`, so its focus ring is invisible, and nothing styles the visible `.btn` span on `:focus-within`. The same happens with "Add a photo of it" (site.css:229).
- Confirmed: with `#photo-input` focused by keyboard, `:focus-visible` matched, computed opacity was 0, and the screenshot showed the plain button with no ring.

**H5. "Kept" text fails contrast.**
- web/site.css:448: `.piece-kept` is `--tape-keep` #2F8A4E at 13 px on canvas #F4F4F2. That is **3.92:1** (APCA Lc 62.9) against a 4.5 gate. It is the only visible text for the kept state on the open wall, and on Favorites ("On your wall", main.js:1639).
- Confirmed from the computed color in the wall-kept state at 390 and 320.

### Medium

**M1. Focus jumps or is lost after common actions** (WCAG 2.4.3).
- Any change in Adjust rebuilds and re-renders the sheet, and render() then moves focus to the sheet heading (main.js:1719, 2334). Confirmed: after pressing Enter on "Full", focus was on "Adjust" (h2).
- Saving or unsaving with the heart inside the piece sheet does the same. Confirmed: focus went to the h2.
- "Save" on the open wall turns itself disabled (main.js:1317), so focus drops to the body. Confirmed: activeElement was the body. The same happens on Get it (main.js:1597).
- Closing the Your walls sheet with Escape or the close button sends focus to `[data-act="change"]`, which isn't on that page (main.js:2400, 2444). Confirmed: activeElement was the body both ways.
- A sheet opened from a piece on the drawing returns focus to the grid button, not the piece (main.js:2400). Confirmed.

**M2. Drag targets in the photo path are well under 44 px, and boxes can't be reached by keyboard.**
- Corner handles (main.js:922, 940): the hit area is 33 px across at 390 and 26.6 px at 320. When the corners sit on the photo's edges, as the reader places them by default, half to three quarters of each is clipped (all four were clipped in the test). The tap-to-move-nearest-corner and the nudge pad soften this.
- Box corners on the confirm screen (main.js:769-771): a 30 px hit and a 12 px dot on a 33 x 50 px box, so the four corners overlap.
- Resize dot on What's in the way (main.js:1066): 15 x 15 px.
- `g.box` on the confirm screen and `g.ob` on What's in the way have no tabindex. The number fields are the keyboard route, which is acceptable, but the drag has no keyboard equivalent.

**M3. "Saved" on Get it reads at 2.05:1.**
- web/site.css:101: `.btn:disabled { opacity: 0.5 }` applies because the `opacity: 1` override is scoped to `.wall-acts` (site.css:479). The result is #87AACC on #E5EDF5, 2.05:1 (Lc 36.4). Disabled controls are exempt from 1.4.3, but this one is the status people read to know the wall is saved. Confirmed in the get state at 390 and 320 (see the get-320 screenshot).

**M4. The sheet plays its entrance again on every re-render.**
- web/site.css:344 with main.js:1353: `.sheet` animates `rise` (220 ms) each time it is recreated. Only `.stay` (set after a swap) turns this off. Confirmed: one heart tap in the piece sheet started a new `rise` animation, and each Adjust change does the same. Reduced motion correctly turns it off (confirmed: no animations).

**M5. "Sample wall" overprints "10 ft x 8 ft" in the measurement view.**
- The chip (site.css:130, at top 8 px, left 10 px) and the wall-size label (draw.js:262, at `s * 0.4, s * 1.1`) occupy the same spot. Confirmed in the wall-measure screenshot at 390, where the two strings print over each other and can't be read.

**M6. Boxes on the confirm photo are white outlines that vanish on a light wall.**
- web/site.css:275 (`.ob-box` stroke #FFFFFF) and 279 (a skipped piece's mark, white dashed). White against the sampled photo wall #E1DDD2 is 1.36:1, and 1.25:1 against `--wall`, under the 3:1 needed for UI graphics. Only the label (14:1) and the furniture in the photo show where a box is.

**M7. No apple-touch-icon and no manifest.**
- web/index.html has neither. In iOS 26 a site added to the Home Screen opens as a web app by default, so Walldrobe gets a screenshot tile and no name. There is no service worker either, so there is no stale-build problem to manage, but also no offline shell.

**M8. The onnxruntime script loads from a CDN with no integrity check, on a page that holds the private photo.**
- web/segment.js:8, 14-21: `ort.wasm.min.js` and its `.mjs` and `.wasm` files load from cdn.jsdelivr.net with no `integrity`. The script runs with full access to the page, including the photo in memory and localStorage. The photo itself was never sent anywhere (see Part 5), but this is the one path by which it could be.

**M9. The offline note in STATES is not built.**
- There is no `offline` listener or note anywhere in web/. Confirmed: going offline and firing the event changed nothing on screen. The app mostly works offline; the 30 MB photo reader download and the store images do not.

**M10. The event log and "What we keep" are not built.**
- `store.logEvent` (store.js:146) is never called from main.js, and Your walls has no "What we keep" line or "Clear that list" (STATES, Event log and section 11).

**M11. Selected and unselected segments differ mainly by a 1.27:1 fill.**
- web/site.css:126: the picked segment changes to `--tape-soft` (#D6E6F7 against white, 1.27:1), to tape-blue text (ink against tape is 2.66:1 in luminance) and from weight 500 to 600. That clears 1.4.1 thanks to the weight change, but it is faint. The same pattern applies to `aria-pressed` buttons (site.css:103).

### Low

1. The theme-color meta for dark mode is still there (web/index.html:11). With a dark OS preference it resolves to #1C1D1C, so Chrome on Android and older iOS draw a near-black bar over a light page. Confirmed. The page itself stays light (html and body #F4F4F2, `color-scheme: light`, inputs white), as intended.
2. The favicon still uses the v2 tape blue #2F7FD0 (index.html:12), but v4's one blue is #1A5FA6.
3. The open wall scrolls sideways at 200% page zoom (195 CSS px): it is 276 px wide, because the pager row does not wrap (site.css:91, 430). Get it does the same at 160 px. There is no sideways scroll at 320 on any screen (confirmed on all of them).
4. Text is sized in px, so a larger default font size changes nothing (confirmed: `.piece-name` stayed 14 px with the root at 200%). Page zoom still works. Only inputs use `max(16px, 1rem)`.
5. The corner error ("Corners should go clockwise...") is not announced: `#corner-msg` has no live region (main.js:943), and it changes on arrow keys without a re-render.
6. A corner handle's focus is shown only by filling its dot, which is the same as the picked style (site.css:290, 293, 506). Corner 0 starts picked, so focusing it shows no change.
7. The hearts' label changes with their state ("Save X" or "Saved X", plus `aria-pressed`, main.js:1306), so the state is announced twice. Favorites uses "Unsave X" (main.js:1641).
8. The demo label is `position: static` and scrolls away (site.css:89). STATES says it is fixed.
9. Text on the photo is small: the box size is 11.7 px (main.js:772, `s * 0.85`) and "Above here is drawn, not photographed" is 11 px (main.js:742, `s * 0.8`). DESIGN asks for 13 px or more on measurements. Their contrast is fine (12.7:1 and 5.7:1).
10. At 320 on Get it, "46 in" sits across its own measure line and the headboard (draw.js:211), and "57 in to center" touches the right print's tape.
11. Quiet buttons, chips, segments and the stepper are outlined in `--hairline`, 1.26:1 on canvas and 1.39:1 on white (site.css:102, 123, 129, 473). The text identifies them, so this is not a 1.4.11 failure, but they read faintly as buttons.
12. In forced colors the sheet loses its edge (it is a box-shadow only, site.css:342). The framed and taped thumbnails lose their frame and tape (box-shadow and `::before` backgrounds, site.css:437-441), so yours and new look the same. HTML focus rings and the SVG select ring stay visible (confirmed by screenshot).
13. Several controls have no press state while the tap highlight is off (site.css:56, 117): `.piece-open`, `.yours-pc`, `.wall-card`, `.walls-link`, `.back`, `.wordmark`, the photo button's span (the input on top is what gets `:active`), inline links, and pieces on the drawing.
14. "Fix" is 18.8 x 44 px (main.js:795, 803) and the inline Undo is 42.7 x 44 px (site.css:137). Both pass WCAG's 24 px rule through spacing but miss 44.
15. Pieces on the open wall drawing can be as small as 34 x 41 px at 320 and 43 x 51 px at 390. Each also has a 44 px button under the drawing.
16. There is no `enterkeyhint` on any input. The 0.5-step number fields have no `inputmode="decimal"` (main.js:785, 1075, 1110). The text fields "What is it?" and the rename field (main.js:791, 1109, 1658) set no `autocomplete="off"` or `autocapitalize`. All inputs are 16 px (confirmed), so iOS will not zoom.
17. The sheet is a `div` with `role="dialog"` and `aria-modal`, and the page behind it is not `inert` (main.js:1353; confirmed `main.inert` was false). The Tab trap and Escape work (confirmed). VoiceOver behavior is listed under risks.
18. Hex literals outside `:root` (details in Part 4).
19. Tokens have drifted from DESIGN. `--tape-strip` is #1A5FA6 in the CSS (site.css:13), but the DESIGN Tokens table says #2F7FD0; the v4 section says one blue, so the table is stale. `--on-wall-tape` is #1B62AC (site.css:44), almost the same as `--tape` #1A5FA6. `--frame` is #1E1E1E in the CSS and #1B1B1B in DESIGN. DESIGN's contrast table lists `--tape` as #1B62AC.
20. ArrowLeft and ArrowRight anywhere on the wall page switch walls (main.js:2460). That can surprise keyboard and screen reader users who expect arrows to scroll.
21. `warm()` (segment.js:69) is never called, so the 30 MB reader only starts downloading once a photo is picked. This matches the copy on the start page, but it makes the first wait longer.

---

## Part 2. Contrast inventory (light, as computed in the browser)

HTML text, every pair found in any state at 390 and 320. Each is the computed color composited through alpha and opacity:

| Pair | Where | WCAG | APCA Lc | Verdict |
|---|---|---|---|---|
| ink #1A1B1A on canvas #F4F4F2 | body, names, back link | 15.69 | 97.5 | pass |
| ink on surface #FFFFFF | sheets, rows, quiet buttons | 17.28 | 104.2 | pass |
| ink on tape-soft #D6E6F7 | flash, pressed chips and rows | 13.59 | 88.3 | pass |
| ink on error-soft #F8E6E1 | failed-save note | 14.31 | 91.5 | pass |
| pencil #585C5F on canvas | meta, help, count, piece names | 6.13 | 76.6 | pass (12 to 15 px) |
| pencil on surface | meta in sheets | 6.75 | 83.3 | pass |
| pencil on the drawn wall #EEECE7 (sampled) | "Sample wall" chip, 12 px | 5.72 | 72.1 | pass; APCA under 75 |
| wall-ink #4F555A on wall #E7E6E2 | quiz pick names, 14 px | 6.05 | 71.5 | pass; APCA under 75 |
| tape #1A5FA6 on canvas | links, Adjust, Your walls | 5.90 | 75.1 | pass |
| tape on surface | links in sheets | 6.50 | 81.8 | pass |
| tape on tape-soft | selected segment, Saved (wall page) | 5.11 | 65.9 | pass; APCA under 75 |
| white on tape | primary buttons | 6.50 | -86.9 | pass |
| white on tape hover #1D5794 (desktop) | primary hover | 7.39 | -90.2 | pass |
| ink on canvas (quiet hover, desktop) | quiet hover | 15.69 | 97.5 | pass |
| error #A12A14 on canvas / surface | errors | 6.68 / 7.35 | 77.6 / 84.3 | pass |
| white on error | Delete | 7.35 | -89.2 | pass |
| **tape-keep #2F8A4E on canvas** | **"Kept", 13 px** | **3.92** | **62.9** | **FAIL (H5)** |
| #87AACC on #E5EDF5 (opacity 0.5) | "Saved" on Get it, disabled | 2.05 | 36.4 | exempt as disabled; M3 |
| #FAFAF9 on #87AACC (opacity 0.5) | "Looks right" disabled on a corner error | 2.32 | -49.4 | exempt |
| #878886 on #FAFAF9 (opacity 0.5) | Undo / Put them back disabled in Move mode | 3.41 | 60.2 | exempt |
| hairline #D9DBD8 on canvas | disabled pager chevron | 1.26 | 12.5 | exempt |

Text drawn on the SVG wall (fill against pixels sampled just outside the text's box):

| Text | Screen size | Fill on sampled bg | WCAG | APCA | Halo |
|---|---|---|---|---|---|
| "57 in to center", "55¾ in", "46 in" | 13.1 px | #4F555A on #E6E3DD to #EEEBE6 | 5.90 to 6.35 | 69.9 to 74.6 | --wall stroke, 6.05 |
| "10 ft x 8 ft" | 13.1 px | #4F555A on #EEECE7 | 6.40 | 75.1 | none; collides with chip (M5) |
| Obstacle labels on What's in the way | 12.3 px | #1A1B1A on #EAE8E2 | 14.1 | 90.6 | white 0.9, 17.3 |
| Box size on the confirm photo | 11.7 px | #1A1B1A on #E1DDD2 | 12.7 | 84.3 | mat, 16.7 |
| "Above here is drawn, not photographed" | 11 px | #4F555A on #E3DFD4 | 5.67 | 67.5 | none |
| Fallback title in the mat (image failed) | 3.4 to 6.8 px | #4F555A on paper | about 7 | n/a | unreadable size (H1) |
| Snap gap labels (Move mode) | scales | #1B62AC on wall | 5.2 (token) | 67 | --wall stroke |

Non-text (graphics and UI, gate 3:1):

| Pair | WCAG | Verdict |
|---|---|---|
| Blue tape #1A5FA6 on the drawn wall (sampled #EDEAE5 / #E9E6E0) | 5.22 to 5.45 | pass |
| Blue tape on paper | 6.38 | pass |
| Green tape #2F8A4E on wall / wall top / paper | 3.46 / 3.69 / 4.24 | pass |
| Orange pin #C8551A on wall / on a black frame | 3.52 / 3.79 | pass |
| Nail mark #9C3A66 on wall / paper | 5.24 / 6.42 | pass |
| Heart #9C3A66 on canvas / surface / marker-soft | 5.94 / 6.54 / 5.26 | pass |
| Focus ring tape on canvas / surface / tape-soft | 5.90 / 6.50 / 5.11 | pass (when not clipped, H3) |
| Select ring (ink, dashed) on wall | 13.8 | pass |
| Field edge #777B7F on surface / canvas | 4.26 / 3.87 | pass |
| Quad and picked box (tape) on the photo wall | 4.79 | pass |
| Your-art mark (marker) on the photo wall | 4.82 | pass |
| Corner error stroke on the photo | 5.42 | pass |
| **Obstacle box and skipped mark, white on the photo wall** | **1.36 (1.25 on --wall)** | **FAIL (M6)** |
| Quiet button / chip / segment edge, hairline on canvas | 1.26 | text identifies the control; Low 11 |
| Selected segment fill against unselected | 1.27 | M11 |

Dark OS preference: html and body stay #F4F4F2, text #1A1B1A, `color-scheme: light`, inputs white, and the screenshots match light mode. The only thing that follows dark is the theme-color meta (Low 1).

---

## Part 3. Accessibility and iPhone checklist

| Check | Result |
|---|---|
| Focus visible | `:focus-visible` 2 px tape outline everywhere (site.css:70), except segments (H3), the photo and art-photo file inputs (H4) and corner handles (Low 6). SVG pieces show a dashed select ring (site.css:179). |
| Forced colors | HTML rings painted in system colors; SVG ring still visible. No `@media (forced-colors)` rules; losses in Low 12. |
| Keyboard order | Wall page: back, Adjust, the three drawn pieces, Next wall, Save, Get it, yours, piece, heart. Logical. Disabled "Wall before" is skipped. |
| Dialogs and sheets | `role="dialog"`, `aria-modal`, `aria-labelledby` on every sheet (the wall sheet's heading is visually hidden). Focus goes to the heading on open. The Tab trap works (confirmed through 12 stops). Escape closes. Focus return has gaps (M1). The background is not inert (Low 17). |
| Names on icon-only controls | Hearts "Save / Saved / Unsave [title]"; pager "Wall before", "Next wall"; nudge "Up", "Left", "Right", "Down" in a labeled group; sheet close "Close"; stepper "Fewer pieces", "More pieces"; your pieces "Your [title]"; choices "Put [title] here". All present. |
| Live regions | One polite `#live` outside #app announces Undo lines and flashes (confirmed "Swapped.", "Changed.", "Saved as Sample bedroom 1."). The progress percentage is not live (correct). The corner error is not live (Low 5). |
| Reflow at 320 | No sideways scroll on any screen at 320 or 390 (scrollWidth equal to clientWidth everywhere). |
| 200% | Page zoom: the wall overflows (Low 3). Text-only: px sizes don't respond (Low 4). |
| Reduced motion | The sheet entrance and button transitions are off (site.css:347); confirmed no animations. Press scale stays instant, which is fine. |
| viewport-fit and safe areas | `viewport-fit=cover` (index.html:5). Body pads all four insets (site.css:59). The sheet and dock pad the bottom inset (site.css:272, 343). The sticky bar is a risk (R2). |
| svh / dvh | svh on the sheet (88svh, 52svh), photo (60svh) and wall editor (64svh). No vh, no dvh. Pass. |
| Inputs | All 16 px. ft and in fields `type=number inputmode=numeric`; wire drop `inputmode=decimal`. Gaps in Low 16. |
| Targets | Every HTML control is 44 px or more at 390 and 320 except those in Low 14 and Low 15. SVG drag targets: M2. |
| Hover | Every hover rule sits inside `(hover: hover) and (pointer: fine)` (site.css:111). Pass. |
| Tap highlight | Off (site.css:56), with press states on `.btn`, chips, segments, sheet items, hearts, icon buttons, links, quiz picks and choices, plus the iOS touchstart listener (main.js:2481). Gaps in Low 13. |
| html/body background | Explicit `--canvas` on both (site.css:55). Pass. |
| Inactive backdrops | Not rendered at all when no sheet is open (main.js:1348). Pass. |
| apple-touch-icon, manifest | Missing (M7). |
| Service worker | None, so there is no stale-build risk and no update path to need. |

---

## Part 4. Tells (grep of web/, excluding the unbuilt web/v2 prototypes)

| Tell | Result |
|---|---|
| Em dashes | None in web/*.js, web/*.css or web/index.html. web/v2 has none either. |
| Hex literals outside `:root` in site.css | 164 `.furn .leaf` #8FA48A; 167 `.tv rect` #25272A; 275 `.ob-box` stroke #FFFFFF; 276 `.ob-label` fill #1A1B1A (equals `--ink` / `--on-wall`); 279 skipped mark #FFFFFF; 424 print block #FFFFFF / #000000 (acceptable for print). rgba literals on lines 169, 172, 275, 276, 280, 288, 289, 359, 368, 437, 438, 453, 465, 502. |
| Inline colors in JS | draw.js:237 `flood-color="#5B5245"` twice (shadow filters); draw.js:178 `fill="${hex}"` (frame color from data, fine). main.js `'#8A8F94'` seven times (787, 1107, 1111, 1298, 1545, 2389, 2393), which duplicates `--swatch`. index.html:10-12 theme-color and favicon hex. |
| `transition: all` | None. |
| ease-in | None. The only easing is `cubic-bezier(0.23, 1, 0.32, 1)` (site.css:51). |
| `scale(0)` | None. The only scale is 0.97 on press. |
| border-left accents | None. `border-left` at site.css:124 is the divider between segment buttons; 208 is the details chevron. |
| Gradient text | None. draw.js:237 has a `linearGradient` on the wall fill ("wall lit a touch lighter at the top", DESIGN v4). That is intentional and not text. |
| Uppercase and letter-spacing labels | None. The only letter-spacing is -0.01em on h1 and the wordmark (site.css:65, 85). |
| Emoji in UI strings | None. Non-ASCII in UI: ‹ › × − … ↑ ← → ↓ ¼ ½ ¾ · (the middle dot only in document.title, main.js:1705). |

---

## Part 5. Privacy, keys and images

- **The wall photo stays on the device. Confirmed.** Request logs across both walks and the photo path at 390 and 320 had zero non-GET requests. The only third-party hosts were media.desenio.com and cdn.shopify.com (store images), cdn.jsdelivr.net (onnxruntime, 3 files) and huggingface.co plus its CDN (the model, one GET). The photo and the flattened wall are stored as data URLs in localStorage (`walldrobe.draft.v1`) and used locally (canvas, SVG, the loupe's background-image). There is no fetch, XHR, sendBeacon, FormData or navigator.share in the bundle. The one fetch is the model download (segment.js:28). The remaining exposure is M8.
- **Keys.** web/social.js holds `sb_publishable_...` (the publishable kind, social.js:8), but social.js is not imported by main.js. The built docs/index.html contains no "supabase" and no "sb_publishable" (grep count 0). So no key ships today, and the only one in the source is publishable.
- **No image is stretched. Confirmed.** Every `<img>` found in every state uses `object-fit: cover` (`.tn`, `.thumb`, `.pick-art`, `.art-big`; site.css:238, 360, 369, 436). Every SVG `<image>` for art and walls uses `preserveAspectRatio="xMidYMid slice"` (draw.js:167, 169, 181, 189, 235). The corners photo (main.js:937) has no attribute, which defaults to `xMidYMid meet`; its viewBox equals the image size, so it is not distorted. The loupe scales both axes by the same factor (main.js:1789). No `object-fit: fill` image was found with an aspect mismatch.

---

## Part 6. States in STATES.md against the v4 build

Legend: Yes (built and seen), Partial (built, differs), No (not in v4), By design (v4 removed it on purpose per DESIGN v4).

**Everywhere**

| State | v4 | What the user sees |
|---|---|---|
| Loading | Partial | Feed, wall and Get it show the bare wall and "Finding every wall that fits…" (main.js:1243). First paint is the text "Loading your wall…" (index.html:17), not a wall-shaped placeholder. |
| Image missing | No | Broken-image glyphs (H1). |
| Offline | No | Nothing (M9). |
| Failed save | Partial | A bar note, "Didn't save on this device. It may be full..." with Try again (main.js:117). Save on the wall uses a flash instead (main.js:1443). |
| Signed out mid-flow | No | No accounts in v4. |
| Demo (?demo) | Partial | "Sample walls. Nothing is saved." Not fixed (Low 8). Saves say "Sample mode: nothing is saved." |
| Event log | No | M10. |

**1. First screen**: New visitor Yes (sample wall full width first, "A wardrobe for your walls", Start with your wall, See a sample wall). Returning Partial ("Start a new wall" plus "Back to your wall", not the last saved wall drawn). Demo embed picker No.

**2. Sign in**: No (no accounts).

**3. Wall photo**: Empty Yes (copy matches). Uploading Partial (the button label only: "Getting the photo reader ready… N%", then "Reading your wall…"; no dimmed photo, no progress bar, no Cancel). Too dark or blurry Partial (a note on Corners; "Use another photo" serves as Retake). Wrong type or too large Yes (main.js:503, photo.js:269). Upload failed: n/a, since nothing uploads. Private note Partial ("Only you can see it" above the button on Start, not under the photo, no delete link).

**4. Corners and measurement**: Getting the reader Yes. Reader didn't load Yes (main.js:928). Dragging a dot Yes (loupe, picked dot, nudge pad; confirmed). Checking Yes, including ceiling, floor and soffit notes (seen in the walk). Reading Yes. Corners crossed Yes (error style plus message; "Looks right" disabled; confirmed). Sized from a TV Yes (on the confirm screen). Things agree No (detect.js `reconcileScale` builds the note, but main.js never shows it). Measurement empty Yes (the size screen plus "No tape measure?" options). Measurement doesn't add up Yes on the size screen; on the confirm screen it is a range error instead. Done Yes.

**5. What's in the way**: Empty Yes (12 chips). Wall edge Yes. One or more marked Yes. Furniture height unknown Partial (a help line, no question or default prompt). Everything blocked Yes ("There isn't room for art on this wall.").

**6. Confirm screen**: A box picked Yes (confirmed four corners plus size; targets M2). Found art Partial (Keep / Maybe / Skip, not Keep / Skip). Fixing a piece Yes. Fixing something in the way Yes ("It's a" picker, It's art). None found Yes. "It's the TV" Yes. Sized from a TV Yes. Size doesn't add up Partial. References disagree No. Art from before No (`loadMe().art` is never read). Adding art not up Partial (adds 16 x 20 in with fields; no standard-size picker or Turn). Skipped piece Partial (white dashed mark, M6).

**7. Taste quiz**: Question Partial ("1 of 10", not 20; reached from Adjust). After three picks Yes. Image failed Partial ("No image", not the title). Done Yes.

**8. Suggestions**: Building Yes. Ready By design (no header copy, no counts under walls). "The one you have" and "Has a piece you saved" By design (removed). Kept don't fit Yes (LOOSENED note). Nearest count, nothing fits: engine messages only. End of list Yes (no Adjust link). No room Yes. Engine error Yes (main.js:1728). Adjust Partial: Kind, How many, How full and Art are built; People, Price, Color and From are missing.

**9. Your wall**: Default Partial (By design: no step bar, no why line; pager, Save, Get it, Yours row, a two-across grid with hearts). Versions No (replaced by Save copies and Your walls). Brought back No. New piece sheet Partial (choices, Save, Keep in every wall, Remove this frame, See it at shop; no shop sizes and no nail spot). Finding swaps No (synchronous). No swaps Yes. Kept Yes (green tape, "Kept", "Kept in every wall. Undo", the sheet line). Swapped Yes ("Swapped. Undo"). Let go Yes ("Removed. Undo"). Last piece Partial (Remove is hidden at one piece). Your piece sheet Yes (Keep / Maybe / Skip, Pin it where it hangs). One more or fewer Yes. As it hangs now Partial (a link when that variant exists). Tape colors Yes (no legend). Moved piece Yes (in the sheet meta). New art Yes. Saved heart Yes. Moving pieces Yes. Rule break Yes. Changed, want it back Yes (Put this wall back). Sample chip Yes.

**9b. Frames**: No (the step is not in v4).

**10. Hang it**: Default Yes (no prices, by design; the frame in words; Buy and Find a frame in new tabs). Change link back to Frames No. Free photo Yes. Nothing new Yes. Hanging guide Yes (table, nearest-edge line). Yours moves Yes. Wire drop Yes. Size from the photo Yes. Leaving the site Yes.

**10b. Saved (Favorites)**: None Partial ("Tap the heart on any print and it lands here."; no Browse). Saved pieces Partial (thumbnail, title, See it on my wall, shop link; no sizes or prices, by design). See it on my wall Yes. No wall yet Yes.

**10c. Browse**: No. **10d. Walls people hung**: No (social.js unbundled).

**11. Your walls**: None Partial ("Save a wall and it lands here. Save two to compare them."; New wall sits in the bar). Saved Yes (a two-across grid, name; date in the sheet; tapping a piece is broken, H2). What we keep No. Deleting Yes ("Delete this wall? This can't be undone.", Delete, Keep it).

**12. Settings**: No.

---

## Part 7. Risks that need a real iPhone

- **R1 (High risk). localStorage quota.** Each Save copies the whole draft, including `photo.src`, `photo.flat`, `photo.clean` and `photo.seg` (main.js:1441-1442), into the single `walldrobe.walls.v1` key (store.js:114-117). The drawn test photo needed 70 KB. A real 1400 px phone photo stored three times as JPEG data URLs is likely 1 to 1.5 MB per wall, so Safari's roughly 5 MB per origin could fill on the third or fourth save. The failure path exists (a flash), but saving would stop working. Measure with real photos on device.
- **R2. The sticky bar in a Home Screen web app.** `.bar` sticks at `top: 0` (site.css:81) while the safe-area top is body padding (site.css:59). With `viewport-fit=cover`, a scrolled bar may slide under the status bar or Dynamic Island in standalone mode.
- **R3. Press feedback.** The touchstart listener is there (main.js:2481); confirm `:active` fires on iOS 26 and check the controls in Low 13.
- **R4. HEIC and the camera.** `accept="image/*"` with no `capture` should offer camera and library; check that HEIC decodes through `loadFile` (photo.js) and that the 20 MB check is right for camera originals.
- **R5. Long-press callouts.** Thumbnails are `<img>` inside buttons with no `-webkit-touch-callout: none`, so a long press may open the image menu instead of the button.
- **R6. VoiceOver.** The `aria-modal` div sheet with a non-inert background, SVG `role="button"` pieces inside a `role="group"` SVG, and the heart's changing label with `aria-pressed`.
- **R7. Safari 26 bar tint.** `body.has-sheet { overflow: hidden }` (site.css:61) and the white fixed sheet at the bottom edge will tint the bottom bar white while a sheet is open. Check that this looks intended.
- **R8. The 30 MB photo reader on cellular, and Cache Storage eviction** of `walldrobe-model-v1` (segment.js:9) on iOS, which would make the first-photo wait come back.

---

Counts: Blocker 0, High 5, Medium 11, Low 21; 8 risks need a real iPhone.

Screenshots and data from this audit (not in the repo): the session scratchpad, `out/` and `out2/`.
