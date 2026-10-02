# STATES.md

Every screen in every situation. For each state: what the person sees, what they can do, and what is kept. Check every state at 320 and 390 wide and on desktop.

States that apply everywhere:

- **Loading:** a quiet placeholder in the shape of what's coming: the bare wall with a line under it. Never a spinner over a blank screen. (The plan was nothing for the first half second; v2 shows the placeholder at once. Open risk.)
- **Image missing:** a piece whose image fails shows its title in the mat where the art would be, never a blank or a broken-image icon.
- **Offline:** a one-line note at the top: "You're offline. Nothing is lost; we'll save when you're back." Inputs stay.
- **Failed save:** the input stays on screen, with "Didn't save. Try again." and a retry button.
- **Signed out mid-flow:** sign in again and land back on the same step with the same inputs.
- **Demo (`?demo`):** a small fixed label, "Sample walls. Nothing is saved." Every screen works, nothing is written, no photo leaves the device.
- **Event log:** every save, unsave, swap, skip, keep, pin, wall opened, Get this wall, quiz pick, browse filter and See it on my wall adds one line to `walldrobe.events.v1` on the device (newest 2,000; piece ids and wall keys only, never a photo, a name or anything typed). Nothing on screen changes. Not written in `?demo`. Your walls says what is kept, with "Clear that list".

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
| Dragging a dot | A round close-up floats above the finger showing the spot under it, with a cross. The picked dot is filled, and a nudge pad under the photo moves it a pixel at a time | Drag, nudge |
| Checking | The photo with a dot on each corner of the wall where we found it. A note when the ceiling or the floor wasn't in the photo, or when a soffit is over the wall | Drag, "Looks right" |
| Reading | "Reading your wall…" on the button while the wall inside the corners is flattened and read | Wait |
| Corners crossed or off photo | Handles turn to the error style, "Corners should go clockwise from top left." | Fix |
| Sized from a TV | On the check screen: "Worked out from your TV, taken as a 55 in TV." with the TV size to change | Change the TV size, type the width |
| Things agree on the size | No TV, but two or more of the door, a queen bed, the couch and an 8 ft ceiling agree within 15%: "Use 9 ft 2 in wide" first, with "The bed and an 8 ft ceiling agree on it." | Tap it, measure, pick one |
| Measurement empty | Only when no TV is clear of everything else: "Give us one real measurement." Wall width, or its height when the ceiling is in the photo. Under it, "No tape measure?" with what's in the photo: the door (6 ft 8 in), a queen bed, the couch (about 7 ft), an 8 ft ceiling, or just guess | Enter feet and inches, or pick one |
| Measurement doesn't add up | "That makes the wall 31 ft tall. Check the number." | Edit |
| Done | Straight to the confirm screen (section 6) | Next |

## 5. What's in the way

| State | What they see | Action |
|---|---|---|
| Empty | The flattened wall, "Mark anything the art should clear." Buttons: couch, bed, dresser, console, TV, lamp, plant, window, door, wall edge, outlet, switch | Add, drag, skip |
| Wall edge | A dashed line floor to ceiling where the wall steps or turns. Art doesn't cross it | Drag it |
| One or more marked | Boxes with their names, each editable | Move, resize, delete, next |
| Furniture height unknown | "How tall is the couch back?" with a default of 32 in | Accept, edit |
| Everything blocked | "There's no stretch of wall wide enough to hang on." | Edit boxes |

## 6. Your pieces (the confirm screen, "Here's your wall")

One screen after the corners: the flattened photo with what we found marked, the wall size, your art and what's in the way. One primary, "Show me my wall", docked at the bottom.

| State | What they see | Action |
|---|---|---|
| A box picked | Tap any box on the photo: four corner handles and its size under it. Drag a corner to resize, the middle to move; the same close-up follows the finger. The row's fields follow | Drag, Fix |
| Found art | Each piece as a row: thumbnail cut from the photo, "Your [title]", size, Keep / Skip (Keep is on) | Keep, Skip, Fix |
| Fixing a piece | Name, wide and tall in the row, and a photo button for art that isn't up | Done, Remove |
| Fixing something in the way | "It's a" picks its kind (couch to wall edge), then wide, tall, from left, from floor | Done, Remove, It's art |
| None found | "We didn't find any art on this wall." | Add art that isn't up yet, Mark art we missed |
| A piece might be the TV | "It's the TV" link on the biggest wide piece when no TV was found | Tap it |
| Sized from a TV | Under the width: "From your TV, taken as a 55 in TV. Measure the wall to be exact." and a TV size picker | Change the TV size, type the width |
| Size doesn't add up | "That makes the wall 31 ft wide and 8 ft tall. Check the number." | Edit |
| References disagree | Under the width: "The TV says 11 ft 2 in and the door says 9 ft 8 in. Measure to be sure." | Measure, change the TV size |
| Art from before | "Your art from before": pieces added on another wall that aren't up yet | Add it to this wall, Forget it |
| Adding art that isn't up | A frame size picker (standard sizes) with Turn it sideways or upright, and wide and tall fields | Pick, turn, type |
| Skipped piece | Its mark on the photo goes faint | Keep again |

Pinning (stays exactly where it hangs) is not here. It lives one tap deeper, in the piece sheet on the open wall (section 9).

## 7. Taste quiz ("Make it mine")

After the first wall, never before it. Reached from Change.

| State | What they see | Action |
|---|---|---|
| Question | Two pieces side by side, "Which would you rather have on your wall?", "7 of 20" | Tap one, "Neither, show me another two" |
| After three picks | Also "That's enough, show my walls" | Finish early |
| Image failed | The failed one shows its title | Pick the other, or Neither |
| Done | Back to the feed, ranked again for the picks | |

## 8. The feed (your walls, ranked)

| State | What they see | Action |
|---|---|---|
| Building | The bare wall, "Finding every wall that fits…" | Wait |
| Art filters | Behind "Filters" beside the stepper: People (Fine, No people), Price (Any, Under $50, $100, $250), Color (Any, Color only, Black and white), From (each shop on or off). The link reads "2 filters" when any are on | Tap, Clear the filters |
| Choices | Above the list and under the open wall: Either / Structured / Loose, Calm / Balanced / Full, Prints / Both / Photos / Mine, and Any number / Set number; Set number shows minus, plus and the count, starting from the open wall's. "Filters" opens the art pool filters | One tap each |
| A count this kind can't make | Moves to the nearest one that works and says so: "6 pieces don't make a structured layout here. 5 do." | |
| Nothing fits the picks | Kind and count let go: "Nothing structured, 6 pieces fits here, so these are what does." | |
| Ready | A ranked list, best first. Each wall at full width, then "1 of 12", the why line ("Both of yours, one new. Lined up over the couch, 73½ in across."), the cost. The first wall always has new art in it | Tap a wall to open it, Change |
| Has a piece you saved | "1 of 12 · has a piece you saved" | |
| Ranked again | After saves, swaps or the quiz: "Ranked again for what you saved and swapped." | |
| Kept pieces don't all fit | The engine leaves out as few as it can, smallest first, and says which at the top; each wall says what it left off and why | Change one to Skip, Just mine |
| Few walls at this fullness | The walls from the other two fullness levels come after, so the list is never two walls long | |
| End of the list | "That's every wall that fits." and a link to Change | Change |
| No room for art | The bare wall, "There isn't room for art on this wall." and the reason. "Not every wall needs art." | Check what's marked, Try another wall |
| Engine error | "Something broke building your walls. Your photo and pieces are saved on this device." | Try again, Check what's marked, Start a new wall |
| Sample | "Sample wall" chip on each drawing | |

Change (a sheet, on the feed and the open wall): How full (Calm, Balanced, Full); With new art / Just mine (when you have pieces you keep); Move pieces by hand; Put this wall back the way it was; Show it as it hangs now; Show measurements and nails; Make it mine; Check what's marked; Start a new wall; Browse every print; Saved pieces; Your walls.

## 9. One wall, open

| State | What they see | Action |
|---|---|---|
| One more or fewer | Minus and plus in the strip under the drawing, starting from this wall; frames already up stay where they are | Tap minus or plus |
| Default | The drawing at true scale, "Wall 3 of 12" with back and next, the why line, the cost, "Get this wall", "Save this wall". Under it, "In this wall": your pieces first, then the new ones, each with thumbnail, size, price and shop, one reason, a heart | Swipe or back and next, tap a piece, save a piece, Get this wall, Change |
| Desktop | Drawing and actions on the left, the piece rows on the right | |
| As it hangs now | Your pieces where they are, always in the list when every piece has a spot. When a spot breaks a rule: "This is how it hangs now. 2 spots are closer than we'd hang art: [the first two]." | |
| Tape colors on screen | When kept or pinned pieces are in the wall: "Tape: blue is new, green is kept in every wall, orange stays where it hangs." | |
| A piece of yours, moved | Row meta: "Moves 4 in right and 2 in higher: take it down and rehang it." Or "Stays where it hangs now." or "Not up yet: hang it here." | |
| New piece sheet | Image, title, artist and shop, frame size and price, every size the shop sells with its price, reason, nail spot | Pick a size, Save, Swap this one, Keep it in every wall, See it at [shop] |
| Refresh the art | In the strip: the same frames with new picks, kept pieces and yours stay. "New art in all 6 frames. Undo" On the feed, every wall at once: "New art on 22 walls, same layouts. Undo" | Undo |
| Step and step back | Minus then plus, or plus then minus, brings back the walls you had, swaps and all | |
| Your piece sheet | Thumbnail, size, move note, reason, nail spot ("Already up." when pinned) | Pin it where it hangs (or Let it move), Leave it out |
| Swapped | The new piece fades in, the wall keeps its place in the list. "Swapped [title] for [title]. Undo" | Undo |
| No other art fits | "No other art fits this frame." | |
| Kept in every wall | Green tape on it. "[title] is kept in every wall. The others were built again around it. Undo" | Undo |
| Pinned | Orange strip on its corner, the walls built again around it | Let it move |
| Saved a piece | Heart fills. The list re-ranks, the open wall stays where it is | Unsave |
| Moving pieces | Change, "Move pieces by hand": the drawing becomes an editor. Drag a frame, or focus it and use the arrow keys (Shift for 3 in). Snaps to frame edges and centers, the spacing, the middle of the wall, 57 in, and the edges of what's in the way, with the guide drawn | Done, Undo, Put them back |
| Moved to a spot that breaks a rule | The frame turns to the error style with the reason under the drawing; on letting go it goes back: "Too close to the TV, so it went back." | Drag again |
| Moved by hand | The why line reads "Placed by you: 6 pieces, 92 in across." | Put them back |
| Changed, want it back | Change, "Put this wall back the way it was" | |
| Saved wall | "Saved on this device. Find it under Your walls." In `?demo`: "Sample mode: nothing is saved." | |
| Save failed | "Didn't save. This device's storage may be full. Try again after deleting an old wall." | Try again |

Undo stays until you open another wall or leave the screen.

## 10. Get it (the hanging guide)

| State | What they see | Action |
|---|---|---|
| Default | "Get it, tape it, hang it", the why line, "What to get": each new piece with artist, shop, print size and price, then the total | Buy at [shop], Find a frame (both quiet) |
| Free photo | "Photo by [artist] on Unsplash. Print it 8 x 10 in for an 11 x 14 in frame with a mat. Free under the Unsplash License." | Get it on [site], Find a frame |
| Nothing new | "Tape it, hang it", no buy list | |
| Hanging guide | The drawing with measurements and nails always on, and a table: piece, frame, from the left, up from the floor. Under a piece's name, when something is within 30 in: the same spot from its nearest edge | Change the wire drop, Print |
| A piece of yours moves | "Take it down and rehang it here." under its name | |
| Wire drop | "Wire or hanger sits [2] in below the top of the frame." Every nail height follows | Type a number |
| Size from the photo | "These spots are estimates. The wall's size came from your photo, so a spot can be off by an inch or two. Measure the wall's width once and every spot firms up." | Measure |
| Leaving the site | Opens in a new tab; the wall stays | |

## 10b. Saved

| State | What they see | Action |
|---|---|---|
| None | "Nothing saved yet. Tap the heart on any piece and it lands here, and the walls rank for it." | Browse every print |
| Saved pieces | Each with its thumbnail, artist, the sizes it comes in with the price at each, and where it is ("On the wall you have open", "Kept in every wall"); "Browse every print" after the list | See it on my wall, See it at [shop], unsave, Browse every print |
| See it on my wall | Back to the feed, the piece kept in every wall at a size it comes in: "[title] is in every wall now, at 20 x 28 in." | |
| No wall yet | The list, without See it on my wall | Start a wall |

## 10c. Browse

Every piece in the catalog, apart from any wall: shop prints (Desenio, House of Spoils) and free photos. Reached from Change ("Browse every print"), from Saved, and from the home page ("Or just browse every print", a text link under the copy, not in the bar).

| State | What they see | Action |
|---|---|---|
| Default | "Every print", one row of quiet controls (Size, Color, Shop, Sort; on a phone they wrap and fill the width), "1,406 prints", then a grid of pieces: each at its own shape in a mat on a bit of wall, its name, and one line with the artist and the price ("from $45", or "free photo"). 2 across up to 600 px, 3 up to 1,000, 4 above | Pick a filter, tap a piece |
| A wall is open | The sort reads "Best for this wall": the feed's taste score (the quiz, then saves over swaps) with how well the piece's colors sit with the room | Change the sort |
| No wall | The sort reads "A to Z"; "Price, low to high" is the other choice. No See it on my wall | Start a wall |
| Filtered | The picked controls turn tape-soft, the count follows ("145 prints"), and "Clear filters" sits beside it. Size is the long side of any size the piece comes in: up to 12 in, 12 to 20, 20 to 30, over 30. Color is a color family the piece is at least a fifth of (a third for black or white), or black and white | Clear filters |
| Nothing matches | "Nothing matches all of these. Clear a filter or two to see more." | Clear filters |
| More than 48 | The first 48, then "Show 48 more" (or the number left). Focus moves to the first new piece | Show more |
| All shown | "That's all 214." | |
| Image missing | The piece's title in the mat | |
| Piece sheet | Big image at its own shape, title, "Art by [artist], sold by [shop]" or "Photo by [artist] on [site]", every size with its price, the description | See it on my wall (the one primary, only with a wall open), Save, See it at [shop] (new tab) |
| Saved from Browse | The heart fills in the sheet; the piece shows a small heart on its tile and lands on Saved | Unsave |
| See it on my wall | Back to the feed, the piece kept in every wall at a size it comes in: "[title] is in every wall now, at 12 x 16 in. Tap it on a wall to change that." | Keep it in every wall, on its sheet, turns it off |
| Already kept | "Kept in every wall." in the sheet, no See it on my wall | |
| Closing the sheet | Focus goes back to the piece that opened it | |

## 11. Your walls

| State | What they see | Action |
|---|---|---|
| None saved | "No walls yet." | Start a wall |
| Saved | Each wall as a small picture with its name and date | Open, rename, delete |
| What we keep | Under the first line: "This device also keeps a list of the pieces you save, swap, skip and pick, with no photos and nothing about you, so Walldrobe can learn what people like. Nothing is sent anywhere yet." Not shown in `?demo` | Clear that list |
| Deleting | "Delete this wall and its photo? This can't be undone." | Delete, cancel |

## 12. Settings

| State | What they see | Action |
|---|---|---|
| Default | Email, "Delete all my photos", "Delete my account", sign out | |
| Deleting everything | Confirmation that names what goes | Confirm, cancel |
