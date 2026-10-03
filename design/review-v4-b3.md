# Walldrobe v4: B3 screenshot critique

Reviewer: a fresh agent that did not build v4. Date: 2026-10-03. Build: docs/index.html served at localhost:8830.

User and moment: Jason, standing in his bedroom or living room with his phone, choosing a whole-wall arrangement from the ranked list, curating it (swap, keep, remove, heart), comparing two saved walls, then getting the buy list and the nail spots.

How it was checked: Playwright with Chromium, has_touch, is_mobile, device scale 2. 390x844 and 320x700 on the phone, 1280x800 on desktop, a dark color-scheme preference, the keyboard-open state approximated by focusing an input and shortening the viewport, slow network through CDP (400 ms latency, 50 KB/s), 4x CPU throttle, blocked image hosts, offline, double taps, Undo after every change, browser back and forward, and a 100-character wall name. Sample path from #/sample/bedroom; photo path from #/start with test/photos/drawn-wall.jpg, Looks right, 10 ft, the confirm screen.

Screenshots are in the session scratchpad: `/tmp/claude-0/-home-claude-walldrobe/7db4f646-4def-563a-a949-7ba40c773bd3/scratchpad/b3/`. Names below are relative to that folder.

Not flagged, on purpose: hidden prices (DECISIONS, FEEDBACK 72), the removed why lines, reason lines and move notes on the wall screen (DECISIONS v4 step 4), no tape legend, light mode only. The dark preference renders the light design correctly on every screen checked, with an explicit page background (`24-dark390-feed.png`, `24-dark390-wall-hard.png`, `24-dark390-getit.png`).

## What works

- The first screen is a finished wall at true scale with both of yours framed and a new print taped up, nothing above it but the wordmark and Adjust (`01-feed-390.png`). It matches `v4-feed-390.png`.
- The open wall matches the approved hard state at 390 and 320: green tape on the kept piece, "Swapped. Undo", your two framed thumbnails, the two-across grid, long titles wrapping (`24-320-wall-hard.png`, `04-after-swap-wall.png`). No horizontal scroll at 320, 390 or 1280.
- The first v4 test passes: after a swap and a remove on wall 3, stepping to walls 2 and 4 and back, and leaving for the list and back, wall 3 still has its edits (s7 run; `07-edited-wall3.png`).
- A swap changes only that one piece; Undo restores it exactly. Keep, Remove, New art in the open frames, a layout preference and Save each show an inline Undo, and each Undo restored the prior state.
- Save makes a copy; editing afterwards turns the button back to Save and leaves the saved copy unchanged (`13-edit-after-save.png`, `14-compare-full.png`). Saved is disabled, so a double tap cannot make two copies.
- Favorites that fit come first in a spot's choices, marked with a heart and named in the label ("Put Swans Martini here, a favorite", `16-choices-with-favorites.png`).
- Keyboard: visible 2 px focus ring, Enter opens a piece, focus stays inside the sheet, Escape closes it and returns focus to the piece that opened it. Icon buttons and hearts have names.
- Control budget holds: feed 3 of 4, open wall 8 of 8 once a wall is saved and a change is made, piece sheet 6 plus the choices, Your walls 3 of 4, Get it 6 of 7.

## Findings

### Blocker

None. The loop can be finished end to end on the sample and on a photo.

### High

**H1. On your own photo, the frame and mat of a piece of yours stay on the wall as a ghost, with new prints taped over it.**
On the confirm screen the reader boxes only the art inside the mat of the larger piece (the plum outline sits inside the white mat). The flattened photo keeps the black frame and mat, with a grey gradient inside where the art was painted out. Every ranked wall then shows that frame where nothing will hang, partly under the new prints, while the same piece is drawn again at the left as a bare blue rectangle with no frame or mat. The wall reads as new prints overlapping a frame you own. The hanging guide drops the ghost but also draws your piece unframed. This is the product's own path, and it attacks "does it actually fit".
Screens: `22-check.png`, `23-photo-feed.png`, `23-photo-wall.png`, `29-photo-getit-drawing.png`.
Repro: #/start, upload drawn-wall.jpg, Looks right, type 10 ft, Show me my wall.

**H2. "Save" means two different things on the same screen.**
The heart is labeled Save, Saved and Unsave (the sheet button and every heart's name, "Save Polignano a Mare II"), and the wall's bookmark is also Save and Saved. With a piece sheet open both are visible at once (`03-sheet-390.png`); after saving the wall the bar says "Saved" next to filled hearts that are also "Saved" (`13-after-save.png`). The page the hearts land on is called Favorites. PRODUCT keeps keep, stays and favorite apart as three meanings; here favorite and save-this-wall share one word, so a person can heart a piece believing they saved their wall, or the reverse.
Repro: open wall 3, tap a print, read the sheet's "Save" and the wall's "Save" together.

**H3. Changing a layout preference in Adjust freezes, then the sheet disappears and fades back in over the page, and the open wall is replaced without a word.**
After tapping Structured, Calm or Full, the page does not respond for about 0.8 s on desktop CPU and about 2 s at 4x throttle (a mid phone), with no sign the tap landed. Then the sheet is gone and re-enters from transparent: the wall drawing, the pager and "Changed. Undo" show through the sheet's own buttons, text on text (`10-adjust-structured-300ms.png`, `11-calm-t1.png`, `12-full-tap-immediate.png`). When the sheet settles, the wall you had open (3 of 15) has become another wall (1 of 14 or 1 of 8); the only record is "Changed. Undo" under the drawing, hidden by the sheet. DECISIONS round 5 says the change happens behind a light scrim with the sheet open.
Repro: open wall 3, Adjust, tap Structured, then Full; watch the sheet.

### Medium

**M1. Back with a sheet open leaves the wall.** With a piece sheet open (also after "See all"), browser back or the iPhone back swipe goes to the list instead of closing the sheet. Edits are kept, but the person is thrown out of the wall they were curating. `16-after-back-from-see-all.png`. Repro: open a wall, tap a print, See all, press back.

**M2. A double tap on a sheet button falls through to what is underneath.** Keep in every wall closes the sheet on the first tap; the second tap lands on the grid below and opens a different piece's sheet (Ocean Waves after keeping Polignano). With a mouse double click the open wall moved to another wall. `26-double-tap-keep.png`. Repro: open wall 3, tap the first print, double tap Keep in every wall.

**M3. Unhearting on Favorites removes the piece at once, with no Undo.** The tile vanishes; getting it back means finding it again among up to 269 choices. PRODUCT: every change has a visible way back. `18-fav-after-unheart.png`. Repro: heart two pieces, Adjust, Favorites, tap a filled heart.

**M4. Failed and slow images show browser broken-image icons or blank paper, never the title.** With image hosts blocked, the drawing, your stand-in pieces, the grid and the choices all show the broken-image icon (`27-images-failed-sheet.png`, `27-images-failed-wall.png`). On a slow connection the choices are blank paper with no title while the drawing shows titles (`25-slow-sheet-choices.png`). STATES: the title in the mat, never a broken-image icon or a blank.

**M5. A slow first load is a blank page with one line.** At 50 KB/s the 3.6 MB page shows only "Loading your wall…" on an empty canvas for about 70 s (`25-slow-load-12s.png`). STATES asks for the bare wall with a line under it.

**M6. The width screen's errors are browser bubbles, not Walldrobe's words.** An empty width gives "Please fill out this field." and 99 ft gives "Value must be less than or equal to 50." with an orange warning icon (`22-size-keyboard-open.png`, `22-size-99ft.png`). STATES has "That makes the wall 31 ft tall. Check the number." Keyboard-open itself is fine: the field and Show me my wall stay in view.

**M7. The photo path states things that are not so.**
The corners screen says "We couldn't see where the wall meets the floor" while the bottom dots sit on the floor line, and the corner dots are cut in half by the photo's edge (`20-corners.png`). The corners and size screens both say "you'll set the ceiling height next", but nothing asks; the confirm screen fills Ceiling height with 8 ft 0 in in the same fields as the typed width, and its note ("Your photo shows the bottom 6 ft 3 in. Check this.") sits under the docked button (`22-check.png`). "Nothing in the way. A bare wall." is shown with a dresser plainly in the photo, and the dresser is missing from the hanging guide drawing (`22-check-full.png`, `29-photo-getit-drawing.png`).

**M8. The list reorders after a heart, a Remove or a Keep, and nothing says so.** Hearting a print on wall 1 moved walls 4 and 5 out of the first five; Remove on wall 3 grew the list from 15 to 16 and moved most walls; Keep took it from 15 to 11. Reordering is by design (PRODUCT), but previous and next from the open wall now step to different neighbours than a moment ago, and the count jumps with no reason given. s8 and s33 runs; `33-feed-before-heart.png`, `33-feed-after-heart.png`.

**M9. "See all N that fit" buries the piece's own actions.** It expands all 269 choices inline in the sheet; Save, Keep, Remove and the shop link move about 5,000 px down (`16-see-all.png`, `17-see-all-bottom.png`).

**M10. The "Sample wall" label is bare 12 px text, not a chip, and things draw over it.** At 320 a tape tab covers it (`24-320-wall-hard.png`); in Move pieces by hand it prints on top of "10 ft x 8 ft" and neither can be read (`30-move-by-hand.png`). DESIGN: a `--surface` chip at the top left of every sample.

**M11. "Kept" fails contrast.** The word is 13 px, weight 400, `#2F8A4E` on the canvas: 3.9:1, under 4.5. `05-after-keep.png`. It is the only word that says a piece is kept.

**M12. Measurement labels sit on art and furniture.** "57 in to center" runs across the Air Conditioners print on the photo wall's hanging guide and over the lamp shade on the sample; "10 ft x 8 ft" crowds the 56 in dimension line. DESIGN lists measurement labels over art as an anti-pattern not allowed back. `29-photo-getit-drawing.png`, `19-get-it-drawing-crop.png`.

**M13. Get it gives a print and a frame in opposite orientations.** "Print 12 x 16 in. Frame 16 x 12 in, no mat." for Swans Martini and Ocean Waves. Someone ordering a frame from that line can buy the wrong way up, or wonder whether the print fits. `19-get-it-full.png`.

**M14. Sizes each print comes in are not in the piece sheet.** Every sheet shows one size (`28-sheet-sizes-check.png`). PRODUCT's must-have table and the piece sheet's budget both list sizes. If DECISIONS round 11 meant they moved to Later, PRODUCT still says otherwise.

**M15. Move pieces by hand shows two Undo buttons at once** (the move pad's, disabled, and the "Swapped. Undo" line under it), with no way to tell which change each one reverses. `30-move-by-hand.png`.

### Nitpick

- N1. The Undo line is hidden behind the piece sheet and Adjust while they are open, and Adjust's line only says "Changed." (`04-after-swap-sheet.png`, `09-adjust-wall.png`).
- N2. Your walls' back link reads "‹ Your wall", one letter from the page title "Your walls"; Favorites uses the same words (`13-your-walls.png`, `16-favorites.png`).
- N3. Wall cards on Your walls have no date (STATES: name and date); the date is only in the card's sheet (`13-your-walls.png`).
- N4. A long wall name is cut at 40 characters with no sign, and the rename has no confirmation (`15-your-walls-long-title.png`).
- N5. Compare's strip of pieces only that wall has carries no words, so it is not clear what it lists (`14-compare-full.png`).
- N6. A filled heart's circle crosses the 16 px gutter in the right column and overlaps the print's paper edge (`13-after-save.png`, `16-favorites.png`).
- N7. A large empty gap sits between the Yours row and the grid, wider than in `v4-wall-hard-390.png` (`02-wall-390-full.png`); the wall drawing is inset 24 px rather than the reference's 16.
- N8. Neighbouring tape tabs cross in V shapes where two prints are close (`23-photo-wall.png`).
- N9. Favorites' shop link is just the shop's name ("Desenio"), with no verb (`16-favorites.png`).
- N10. Going offline shows no note (STATES: "You're offline. Nothing is lost...") (`27-offline.png`). Sample walls keep working.

## Scores

| Question | Score (1 to 5) | Evidence |
|---|---|---|
| Fit | 4 | The first screen answers the trigger question with a finished sample wall; the loop (choose, curate, save, compare, Get it) completes. Docked for H1: on a real photo the wall shows a frame that won't be there. |
| Structure | 4 | Wall first everywhere, budgets held, one door per screen. See all buries the sheet's actions (M9); Adjust covers the wall while it rebuilds it. |
| Identity | 4 | Matches the approved references: taped prints, framed own pieces, the room in its colors, Familjen Grotesk, one blue. Off-system pieces: browser validation bubbles (M6), broken-image icons (M4), the bare Sample label (M10). |
| Behavior | 3 | Undo after every change, good focus and keyboard. Fails on the Adjust freeze and flash (H3), back with a sheet open (M1), double-tap fall-through (M2), no Undo for unhearting (M3), blank slow load (M5). |
| Integrity | 3 | Samples labeled, no invented prices. But the ghost frame (H1), the floor and ceiling claims and "Nothing in the way" (M7), Save meaning two things (H2), Kept under 4.5:1 (M11), print and frame orientations disagreeing (M13). |
| Continuity | 4 | Tokens and components match DESIGN v4 and the references at 320, 390 and desktop; dark preference renders light. Drift: the Sample label, measurement labels over art (M12), spacing under Yours (N7). |

## Confirmation round (build ad66a58, 2026-10-03)

One read-only pass, same method: screens, not code. Screenshots are in `.../scratchpad/b3/confirm/`.

| Item | Result | Evidence |
|---|---|---|
| H1 frame ghost on the photo path | Fixed | The confirm screen now boxes the whole frame (`c1-check.png`). No ghost frame on any wall, and your larger piece is drawn framed with its mat on the wall, in Yours and on the hanging guide (`c1-photo-feed.png`, `c1-photo-wall.png`, `c1-photo-getit-crop.png`). |
| H2 the heart is Favorite | Fixed | The sheet reads Favorite while the wall's button reads Save, and every heart is named "Favorite [title]". After a save the bar says Saved and the hearts keep their own word (`c2-sheet-and-wall.png`, `c2-after-fav-and-save.png`). |
| H3 Adjust, Structured then Full on wall 3 | Fixed | The sheet stays up. At 4x CPU the first painted frame (115 ms after the tap) shows the pressed segment and "Building the walls…"; then "Changed. Undo" appears inside the sheet. Nothing shows through from the page (`c4-frame-00-115ms.png`, `c4-frame-01-2814ms.png`). The page still does not respond for about 2.7 s at 4x, but the tap is acknowledged first. |
| Images failing (media.desenio.com, cdn.shopify.com, /art/ blocked) | Partly | No broken-image icons on any screen. Titles show in the grid, on Favorites and on most of the drawing. Still open: the sheet's four choices all read "No image", so they can't be told apart (`c5-img-fail-sheet.png`). The drawing cuts titles to "Swans.", "Ocean.", "Aiqi." Your two pieces show empty mats, with no title and no swatch (`c5-img-fail-wall.png`). On Get it one thumbnail is blank and the next reads "No image" (`c5-fav-getit-combo.png`). |
| Drawn piece inside a Your walls card | Fixed | At both 390 and 1280, tapping a print inside the card opens that wall's sheet (`c6-390-card-piece-tap.png`, `c6-1280-card-piece-tap.png`). |
| Focus ring on an Adjust segment and the photo button | Fixed | The segment shows a 2 px blue ring inside its edge (`c7-adjust-segment-focus-crop.png`), and the photo button shows a 2 px ring with offset (`c7-start-photo-focus-crop.png`). The photo button's ring is square around a rounded button, which is cosmetic. |
| Kept at 4.5:1 | Fixed | The word is now `#25733F`: 5.3:1 on the page and 5.8:1 on white (`c8-320-wall-hard.png`). |
| M2 double tap Keep | Fixed | The second tap no longer opens another piece's sheet. One keep, no sheet left open (`c2-double-tap-keep.png`). |
| M13 print and frame orientation | Fixed | Every row now matches, for example "Print 16 x 12 in. Frame 16 x 12 in, no mat." (`c7-getit-orientation.png`). |

The fixes broke nothing I could find. At 320, swap, keep, remove and their Undos still work, with no horizontal scroll, and the open wall matches the reference (`c8-320-wall-hard.png`).

New or remaining notes from this pass:

- "Changed. Undo" is inserted at the top of the Adjust sheet and pushes every segment down about 24 px at the moment it appears. A second tap made during that shift can land on the wrong option. Medium.
- Adjust's Undo goes back only one step. After Structured then Full, one Undo restores Balanced, but no Undo is left for Structured, and closing the sheet leaves you on wall 1 rather than the wall 3 you started from. PRODUCT says Undo steps back one change at a time. Medium. Seen in the c4 run; same-run screenshot: `c4-frame-03-6843ms.png`.
- On the photo wall's hanging guide, "57 in to center" still runs up to the edge of a print (M12, `c1-photo-getit-crop.png`), and the dresser is still missing from that drawing (M7).
