# STATES.md

Every screen in every situation. For each state: what the person sees, what they can do, and what is kept. Check every state at 320 and 390 wide and on desktop.

States that apply everywhere:

- **Loading:** nothing shown for the first half second, then a quiet placeholder in the shape of what's coming. Never a spinner over a blank screen.
- **Offline:** a one-line note at the top: "You're offline. Nothing is lost; we'll save when you're back." Inputs stay.
- **Failed save:** the input stays on screen, with "Didn't save. Try again." and a retry button.
- **Signed out mid-flow:** sign in again and land back on the same step with the same inputs.
- **Demo (`?demo`):** a small fixed label, "Sample walls. Nothing is saved." Every screen works, nothing is written, no photo leaves the device.

## 1. First screen

| State | What they see | Action |
|---|---|---|
| New visitor | One finished sample wall, full width, before any text. One line: "A wardrobe for your walls." | "Start with your wall", "See a sample wall" |
| Returning, signed in | Their last saved wall | "Open", "Start a new wall" |
| Demo embed | A sample wall picker (three walls) | Pick a wall |

## 2. Sign up and sign in

| State | What they see | Action |
|---|---|---|
| Empty | Email field, "Email me a link" | Send link |
| Link sent | "Check your email. The link works for 60 minutes." | Resend after 30 s, change email |
| Bad or expired link | "That link expired." | Send a new one |
| Signed in | Straight to the wall step they were on | |

## 3. Wall photo

| State | What they see | Action |
|---|---|---|
| Empty | "Stand back and take the whole wall, floor to ceiling if you can. People in the photo aren't needed." | Take photo, choose from library |
| Uploading | The photo, dimmed, with a progress bar | Cancel |
| Too dark or blurry | The photo, with "Hard to see the corners. Try more light." | Retake, use anyway |
| Wrong type or too large | "That file won't open. Use a JPG, PNG or HEIC under 20 MB." | Choose another |
| Upload failed | The photo stays on the device | Retry |
| Private note | Under the photo: "Only you can see this photo." | Link to delete |

## 4. Corners and measurement

| State | What they see | Action |
|---|---|---|
| Getting the reader | First photo only: "Getting the photo reader ready… 45%" on the button while the image model downloads (about 30 MB) | Wait |
| Reader didn't load | The corners screen says "The photo reader didn't load, so these are rougher guesses than usual." | Drag, "Looks right" |
| Checking | The photo with a dot on each corner of the wall where we found it. A note when the ceiling or the floor wasn't in the photo, or when a soffit is over the wall | Drag, "Looks right" |
| Reading | "Reading your wall…" on the button while the wall inside the corners is flattened and read | Wait |
| Corners crossed or off photo | Handles turn to the error style, "Corners should go clockwise from top left." | Fix |
| Sized from a TV | On the check screen: "Worked out from your TV, taken as a 55 in TV." with the TV size to change | Change the TV size, type the width |
| Measurement empty | Only when no TV is clear of everything else: "Give us one real measurement." Wall width, or its height when the ceiling is in the photo | Enter feet and inches |
| Measurement doesn't add up | "That makes the wall 31 ft tall. Check the number." | Edit |
| Done | The flattened wall with its size: "11 ft 0 in wide, 8 ft 0 in tall" | Next |

## 5. What's in the way

| State | What they see | Action |
|---|---|---|
| Empty | The flattened wall, "Mark anything the art should clear." Buttons: furniture, window, door, outlet, switch, TV, other | Draw a box, skip |
| One or more marked | Boxes with their names, each editable | Move, resize, delete, next |
| Furniture height unknown | "How tall is the couch back?" with a default of 32 in | Accept, edit |
| Everything blocked | "There's no stretch of wall wide enough to hang on." | Edit boxes |

## 6. Your pieces

| State | What they see | Action |
|---|---|---|
| None owned | "Any art on this wall already?" | Add a piece, "Nothing yet" |
| Adding | Box drawn around the piece in the photo, size filled in from the wall scale | Adjust size, set keep: must keep, happy to move, don't care; pin where it is |
| Size looks off | "This reads as 60 x 4 in. Check it." | Edit |
| Several pieces | A list with thumbnails cut from the photo and their keep setting | Change, remove, next |
| Must-keeps too wide | "Your must-keep pieces are 94 in wide together and the open wall is 80 in." | Change a keep setting, edit wall |

## 7. Taste quiz

| State | What they see | Action |
|---|---|---|
| Question | Two pieces side by side, "Which one do you like more?", "7 of 20" | Tap one, "Neither" |
| Image failed | The other piece stays, the failed one shows its title | Skip this pair |
| Early exit | "We can build with what you've told us so far." | Keep going, see my wall |
| Done | Straight to layouts | |

## 8. Layouts

| State | What they see | Action |
|---|---|---|
| Building | Their wall with the zone outlined | |
| Ready | Top layout on their wall, full width, first. Then two more as smaller walls. | Swipe or tap between layouts |
| Only one or two families fit | Only those, plus one line saying why ("No grid: your pieces are different sizes.") | |
| Too few candidates | "Not enough art in your sizes. Try a looser taste setting." | Retake quiz, allow more sizes |
| Over budget | "The cheapest layout that fits is $180." | Change budget |
| Engine error | "Something broke building your wall. Your photo and pieces are saved." | Try again |

## 9. One layout, up close

| State | What they see | Action |
|---|---|---|
| Default | The wall with the pieces placed at true scale, dimensions on tap | Tap a piece |
| Piece open | Image, title, artist, size, price, source, and the one-sentence reason | "Buy on [source]", swap this piece, remove it |
| Owned piece open | Its reason and keep setting | Change keep setting |
| Example original | Label: "Example. Not for rent yet." | |
| Swapping a piece | Three alternatives that fit the same slot | Pick one, cancel |
| Buy link dead | "This one isn't available anymore." | Swap it |

## 10. Buy list

| State | What they see | Action |
|---|---|---|
| Default | Each new piece with size, price and source, and the total | "Buy on [source]" per piece |
| Nothing new | "This layout only uses what you own. Nothing to buy." | Save the wall |
| Leaving the site | Opens in a new tab; the layout stays | |

## 11. Your walls

| State | What they see | Action |
|---|---|---|
| None saved | "No walls yet." | Start a wall |
| Saved | Each wall as a small picture with its name and date | Open, rename, delete |
| Deleting | "Delete this wall and its photo? This can't be undone." | Delete, cancel |

## 12. Settings

| State | What they see | Action |
|---|---|---|
| Default | Email, "Delete all my photos", "Delete my account", sign out | |
| Deleting everything | Confirmation that names what goes | Confirm, cancel |
