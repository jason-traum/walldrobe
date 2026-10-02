**I recommend Layout / Art as two views of one continuously editable wall.** Put the switch **below the drawing**, within thumb reach. Tapping any piece should open Art directly, with alternatives already visible.

I tried all three links, but none were accessible from this environment. This recommendation follows your detailed description; I can’t claim to have audited the live screens.

I made a clickable prototype and both 390 px wireframes:

walldrobe-interaction-prototype.html[walldrobe-interaction-prototype.html](sandbox:/workspace/scratch/7ce9b4770ac5/output/walldrobe-interaction-prototype.html) · walldrobe-wireframes.png[walldrobe-wireframes.png](sandbox:/workspace/scratch/7ce9b4770ac5/output/walldrobe-wireframes.png)

The prototype uses illustrative layouts and artwork. Its state checks pass for swaps, kept pieces, undo, restoration, and the walkthrough below. I inspected the rendered wireframes; live browser testing wasn’t available.







**The two views need clear promises.**

In **Layout**, you are changing the arrangement. Kept pieces come along. Retain other chosen artwork wherever it fits, too: changing the shape shouldn’t unnecessarily replace everything the person was considering.

In **Art**, frame positions and sizes stay fixed. Tap a frame, then tap an alternative to see it immediately in the room. No extra Swap, Apply, or Save confirmation.

Switching views changes no content. There is no separate “accept layout” or “lock layout” step. Art implicitly holds the arrangement steady.

The tradeoff is that users must understand two views, and occasionally switch between them. Directly tapping a piece removes that extra tap from the common editing path. It also gives each control a predictable scope.

I would make **Remove frame** an explicit exception: it removes that frame, preserves the others, and returns to Layout. That directly supports “none of these prints works; perhaps I need one fewer.”

**Give each control one clear home.**

| Control | Where it lives and how it behaves |
|---|---|
| Piece count | A visible **− / 4 pieces / +** control in Layout. Preserve existing placements. Explain unavailable changes instead of silently replacing the wall. |
| How full | Express this through visible **roomier / fuller arrangements**. I would remove the separate fullness slider initially. Respect an explicitly chosen count. |
| Structured / loose | Visible layout thumbnails when available; always accessible in **Layout options**. |
| Which art | Tap a frame from either view. Art opens with four alternatives for that spot. |
| Swap | Tap an alternative. The wall updates immediately; the alternatives remain available. |
| Filters | **Art filters**, beside the alternatives or bulk refresh. Scope them to future suggestions; don’t remove current selections. |
| Refresh the art | **New art in 2 open frames** when no individual piece is selected. State the affected count. |
| Keep | **Keep in layouts** on a selected piece. A small checkmark identifies it on the wall. This protects inclusion, not position. |
| Maybe | In **Your art**, alongside Keep and Skip. It means the engine may use the piece. |
| Let it go | Retire this ambiguous phrase. Use **Make optional** to release Keep, **Remove frame** to reduce the count, and **Skip** to exclude owned art from suggestions. |
| Save it | **Save for later** in piece controls. Saving a print does not keep it in the current wall. |
| Versions | A persistent bottom action shared by both views. Show wall thumbnails, piece counts, and kept counts. |
| Suggestions | Three layout previews below the count control, plus **See all layouts**. Fold the ranked suggestions into this browser. |
| Frames | A persistent **Frames →** action. Choose a set-wide finish first, then allow individual exceptions. |
| Taste and owned art | Offer them during setup and keep them available through the wall menu. They remain editable throughout. |

I would avoid making swiping the only way to discover layouts. Visible thumbnails communicate that alternatives exist and what changes. Swiping can supplement them.

**Your six-step loop takes 16 taps in the pictured design.**

This assumes a four-piece starting wall, three swap attempts, and the earlier version visible in the Versions panel.

| Step | Actions | Taps |
|---|---|---:|
| 1. Like the shape | Tap a layout thumbnail. | 1 |
| 2. Keep two pieces | Tap first piece → Keep. Tap second piece → Keep. | 4 |
| 3. Try the third, then remove it | Tap third piece → tap three alternatives → Remove frame. | 5 |
| 4. Try a structured version | Tap the Structured thumbnail. The two kept pieces remain. | 1 |
| 5. Return to the earlier four-piece wall | Versions → tap that wall’s thumbnail. | 2 |
| 6. Settle and hang | Frames → choose a finish → Hang. | 3 |
| **Total** | **Through opening the hanging guide** | **16** |

If Structured isn’t among the visible previews, **Layout options → Structured** adds one tap. Physical hanging is outside this count.

Two details make that flow work:

- **Keep closes the piece controls.** You immediately return to the wall to select another piece.
- **Versions groups consecutive edits.** Three quick swaps shouldn’t bury the earlier composition beneath nearly identical thumbnails. Preserve each edit under “All changes,” while keeping meaningful stopping points easy to find.

Restoring a version restores its artwork, arrangement, and keep choices. It creates a new branch; it does not erase the intervening work. Label that behavior in the Versions panel.

**Show progress through the work itself.**

During setup, ask one concrete question at a time: photograph the wall, check what was found, then offer the optional taste exercise.

Once the wall appears, let **“Bedroom” and “Saved”** replace the wizard framing. The user has arrived at their workspace. Layout and Art are activities they can revisit freely.

The finishing path is visible through **Frames →**, followed by **Hang →**. Both screens provide a direct return to the wall. A wall menu can show useful status—wall checked, taste optional, frame choice—without numbered stages or a completion percentage.

On shorter phones, shorten the preview to keep the editing controls and bottom actions within reach. The wireframes show a 390 × 844 canvas; the production screen should accommodate browser controls.

**Three experiences offer useful patterns to borrow.**

- **A framer’s consultation:** Framebridge’s Designer’s Choice offers four personalized mockups and further recommendations after feedback. Borrow the small, considered shortlist around the person’s actual piece. Four swap candidates should feel chosen for this spot. [Framebridge](https://www.framebridge.com/pages/designers-choice?utm_source=chatgpt.com)
- **Pinterest:** Boards support collecting and revisiting ideas as a project evolves. Borrow the ability to save something without committing it to the current composition. That is the role of “Save for later.” [Pinterest Create](https://create.pinterest.com/product-features/how-to-create-boards/?utm_source=chatgpt.com)
- **Spotify Radio:** A familiar song, album, or artist becomes the starting point for discovery. Borrow that continuity: refresh the open frames around what the person has already kept. [Spotify](https://support.spotify.com/us/article/spotify-radio/?utm_source=chatgpt.com)

**The biggest mistakes to avoid are changes whose scope surprises the person.**

- Switching to Layout must not regenerate the wall automatically.
- A swap must not move or resize its frame.
- Keep, fixed position, and Save for later must have distinct meanings. A heart should not secretly perform all three.
- Removing a frame must not trigger a full rearrangement.
- Versions must be visually recognizable, rather than a row of indistinguishable timestamps.
- Don’t require people to understand count, fullness, structure, and filters before seeing a useful wall.
- Don’t make users reopen the same action menu for every swap. The room and the alternatives should remain visible together.

The decisive interaction is **tap a piece → try alternatives in place → keep working on the same wall**. I would build the rest of the screen around making that loop fast and dependable.