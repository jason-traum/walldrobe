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
| New visitor | One finished sample wall, full width, before any text. One line: "A wardrobe for your walls." | "Start", "See a sample wall" |
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
| Tip | Under the lede: "The farther back you stand, the truer furniture sizes come out. Use the 1x lens if the wall fits; 0.5x bends the edges." | |

## 4. Corners and measurement

| State | What they see | Action |
|---|---|---|
| Getting the reader | First photo only: "Getting the photo reader ready… 45%" on the button while the image model downloads (about 30 MB) | Wait |
| Reader didn't load | The corners screen says "The photo reader didn't load, so these are rougher guesses than usual." | Drag, "Looks right" |
| Dragging a dot | A round close-up floats above the finger showing the spot under it, with a cross. The picked dot is filled, and a nudge pad under the photo moves it a pixel at a time | Drag, nudge |
| Checking | The photo with a dot on each corner of the wall where we found it. A note when the ceiling or the floor wasn't in the photo, or when a soffit is over the wall | Drag, "Looks right" |
| Another wall in the photo (Oct 5) | When there's a good stretch of wall past a side (a corner, a wall that steps forward) and reading just that part finds a wall on its own: "Use the wall on the right" (or left) under the photo | Tap it: the dots move to that wall, and "Use the wall on the left" takes you back |
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
| Furniture, corrected for depth | Under "In the way": "Furniture stands out from the wall, so the photo makes it look bigger. We take that out from where you stood, about 13 ft back. If you know a piece's real width, tap Fix and type it." Each piece's row: "74 x 24 in, about 82.5 in wide in the photo". The box on the photo stays where the photo shows it; its size label is the real size | Fix |
| Taken close | Under 6 ft away: "You took this close to the wall (about 5 ft back), so furniture sizes are rough. If you know a piece's real width, tap Fix and type it." | Fix |
| A size typed | The row reads "68 x 34 in, as you typed it"; no correction | Fix |

Pinning (stays exactly where it hangs) is not here. It lives one tap deeper, in the piece sheet on the open wall (section 9).

## 1b. One wall or a whole home (Oct 4)

From Start. "What are you doing?" Two cards: One wall (Basic): "One photo of the wall, a few minutes." A whole home (Advanced): "What you already own first, then a photo of each wall."

| State | What they see | Action |
|---|---|---|
| First time | Both cards | One wall goes to the photo; A whole home goes to Your stuff |
| A home already started | The same; A whole home goes to Your home | |

## 1c. Your stuff (Oct 4)

"What you already have": art you own, up now or in a closet, and empty frames. Kept on the person, used by every wall.

| State | What they see | Action |
|---|---|---|
| Empty | "Nothing yet." under Art and "None." under Empty frames | Add art from a photo, Add without a photo, Add an empty frame |
| A piece of art | Its picture (or a color swatch), What is it?, Framed or Not framed, Wide and Tall, a line: framed "Measure the outside of the frame."; not framed "The art itself. It goes in a 12 x 16 in frame with a mat." | Edit, Remove |
| Added from a photo | Shaped like the photo, 20 in on the long side, and "Added. Put in its real size, and say whether it is framed." | |
| An empty frame | A swatch in its color, Wide and Tall, Black, White, Oak, Brass, "Walls that need this size use it, and it costs nothing." | Edit, Remove |
| On a wall after spreading | "On Living room." after the size line | |
| In the home path | "Next: your walls" docked ("Nothing yet, go to your walls" when empty) | |
| From one wall (the Menu, or the budget's link) | Each piece says Keep, Maybe or Skip for this wall; back goes to Your walls | Keep: in every wall. Maybe: when it earns its place. Skip: saved for later, not on this wall |
| A photo of a piece | Crop to the piece: the photo, the found box, four corner dots, Use this and Whole photo | The piece takes the crop's shape; Keep shape is on |
| Keep shape | A tick beside Wide and Tall, on by default with a photo | Typing one side sets the other |

## 1d. Your home (Oct 4)

| State | What they see | Action |
|---|---|---|
| No walls yet | "Your home", a line on how it works, "No walls yet." | Add a wall, Your stuff |
| Walls | Each wall: a small drawing, its name (Main wall first), width, its preferences, how many are up already, "Yours here: ..." | Rename, Open, Remove, Add a wall |
| Ready to spread | "Spread your pieces": biggest on the main wall, then by fit, color and warm or cool | Spread my pieces across the walls |
| Spread | "Done. Open a wall to see it with your pieces..." | Spread them again |
| A piece too big for every wall | "Too big for these walls: ..." | |
| Adding a wall | The photo screen says "A photo of Wall 2", back goes to Your home; after the photo (or the size and pieces), "Done, back to your home" | |
| An open home wall | The feed's back link is "Your home" | |
| A piece already up in a photo (Oct 5) | Spreading leaves a piece from your stuff where it hangs when a wall's photo has it (same size within 2 in, same colors): "Already up in a photo, so left where it hangs: ..."; that wall lists it under "Yours here" | |
| Get it all, nothing picked (Oct 5) | "Get it all", "Pick a wall on each to see what it all costs.", each wall with Pick a wall | Pick a wall (opens it) |
| Get it all, walls picked (Oct 5) | The total ("$1,427 (+$84 to frame)", "for 1 of 2 walls" when some aren't picked), each wall's price, each wall drawn as picked | Everything to order |
| A home budget (Oct 5) | "Budget for the home, all in" with a box and Set; then "Over by $611." or "$120 to spare." with Split it across the walls | Set, Split: "Each wall has its share of the budget, by how wide it is." |
| Everything to order (Oct 5, `#/home-get`) | "Get it all", the total, each wall's price with Its list, a line that shop prints are ordered from each wall's list, then Print the free photos and Get the frames for every wall in one table each ("Your home needs 6 frames: ...") | Its list (that wall's Get it), Back to Your home |

## 7. Taste quiz ("Make it mine")

After the first wall, never before it. Reached from Change.

| State | What they see | Action |
|---|---|---|
| Question | Two pieces side by side, "Which would you rather have on your wall?", "38% known" in the bar and a thin meter under the title. Only good-looking art, the two about as good as each other | Tap one, "Neither, show me another two" |
| After three picks | Also "That's enough, show my walls" | Finish early |
| Every ten picks | "We know your taste 38%", the meter, You like, Less into, Still learning (the three things we know least), a line that it climbs toward 100 and never gets there | Show my walls, Keep going |
| Image failed | The failed one shows its title | Pick the other, or Neither |
| Done | Back to the feed, ranked again for the picks. The feed's taste card becomes "We know your taste 38%" with the meter | Tap it to keep going |

## 8. Suggestions (every wall that fits, ranked)

Oct 4: after a photo is read, this is where you land, not the confirm screen. Above the list: "We read your wall: 11 ft wide (from the TV); couch, lamp; 2 pieces of yours. Something off? Fix it", the link going to the confirm screen. With a budget nothing fits: "Nothing fits a $150 budget yet." and why, with Change the budget. After the fourth wall, until a budget is set or No limit picked: "What's your budget for this wall, all in?", what it counts ("the art (or printing a free photo), a frame for each new piece, and any mat. Not shipping, tax or nails. Frames you already have cost nothing."), Add frames and art you have, $150, $300, $600, $1,000, No limit, and "Or type it" with Set. Picking one says "Budget $300, all in." with Undo and the walls build again. Preferences has the same, under Color.

Reached from "Suggestions" at the top of your wall. The five-step bar shows Pick as the current step.

| State | What they see | Action |
|---|---|---|
| Building | The bare wall, "Finding every wall that fits…" | Wait |
| Ready | "Every wall that fits, best first, each with the 2 pieces you keep. Tap one to make it your wall; the one you have now is kept as a version." Then the list: each wall at full width, "1 of 12", the why line, the cost | Tap a wall, Preferences |
| The one you have | "3 of 12 · the one you have now" | |
| Has a piece you saved | "1 of 12 · has a piece you saved" | |
| Kept pieces don't all fit | The engine leaves out as few as it can and says which at the top | |
| A count this kind can't make | Moves to the nearest one that works and says so | |
| Nothing fits the picks | Kind and count let go: "Nothing structured, 6 pieces fits here, so these are what does." | |
| End of the list | "That's every wall that fits." and a link to Preferences | |
| No room for art | The bare wall, "There isn't room for art on this wall." and the reason | Check what's marked, Try another wall |
| Engine error | "Something broke building your walls. Your photo and pieces are saved on this device." | Try again |

Oct 5, quick questions: after the budget card (or after the fourth wall once a budget is set), one card at a time: "What is the room like?" (Calm and light, Warm with wood, Bold and colorful, Dark and moody), then "Real scenes or abstract?" (Real scenes, Abstract, Both), then "Busy art or quiet art?" (Quiet, Busy, A mix), each with Skip and "1 of 3. Every wall leans that way." An answer leans every wall's art (each piece up to 1.3 times when it fits, 0.7 when it doesn't) and builds the walls again; Warm with wood also makes the frames oak unless you picked a color. When all three are answered or skipped, the card is gone. A taste at 0% (picks undone) shows the taste test card again, never "We know your taste 0%".

Preferences (one sheet, from your wall and from Suggestions): "Any change here builds the walls again. The one you have now stays as a version." How many pieces (minus, the count, plus; "Any number" when a count is set); dropdowns for How full (Calm, Balanced, Full), Kind of wall (Any, Structured, Loose), Which art (Shop prints, Free photos, Both, Just my pieces), People in the art (Fine, Leave them out), Price per print, Color (Any, Color only, Black and white only), From (when Both). This wall: New art in the open frames, Move pieces by hand, Show measurements, Put it back, See it as it hangs now. Links: Fix what's marked, Taste test, What we learned, New wall.

## 9. Your wall (the Pick step)

| State | What they see | Action |
|---|---|---|
| Love the layout, not the art (Oct 4) | Under the drawing: "Love the layout, not the art? New art in these frames" | Tap: same frames, new picks, with Undo |
| Default | The step bar (3 Pick), the drawing at true scale, the why line, the cost, "Frames next" (or "Hang it next" with nothing new), "Preferences". "Tap a piece below to keep it, swap it or let it go." Under it, "In this wall": your pieces first, each with a state (Yours, Kept, New), thumbnail, size, price and shop, one reason, a heart | Tap a piece, Frames next, Preferences, Suggestions |
| Versions | Once the wall has changed: "Every version so far. Tap one to bring it back." and a row of small drawings, newest first, the one on screen marked "Now", the others "3 pieces" | Tap a version |
| Brought back | The version is on screen; the one you had joins the row | |
| New piece sheet | Title, size and price, the reason, then Keep it, Let it go, Save for later. "Swap it for": four other pieces for this spot at this size. Then the image, artist and shop, the sizes the shop sells, the nail spot | Keep it, Let it go, Save, tap a swap, pick a size, See it at [shop] |
| Finding swaps | Opening a new piece's sheet takes a moment while the other art for its spot is found | Wait |
| No swaps | "No other art comes in this size for this spot." | |
| Kept | Green tape on the piece, "Kept" by its name. "[title] is kept in every wall. The others were built again around it. Undo". The sheet says "Kept: it is in every suggestion. Tap Kept to let it change again." | Undo, tap Kept |
| Swapped | "Swapped [title] for [title]. Undo"; the wall you had is a version | Undo |
| Let go | One fewer, the other frames stay where they are: "[title] is out. 3 pieces now. Undo" | Undo |
| Last piece | "That is the last piece. Pick another wall from Suggestions instead." | |
| Your piece sheet | Thumbnail, size, move note, reason, nail spot | Pin it where it hangs (or Let it move), Leave it out |
| One more or fewer | In Preferences, minus and plus from this wall; frames already up stay where they are | |
| As it hangs now | From the tools row under the wall. When a spot breaks a rule: "This is how it hangs now. 2 spots are closer than we'd hang art: ..." | |
| Tape colors | No legend (v4). The row of a kept piece says "Kept in every wall"; a pinned piece of yours says "Stays where it hangs"; keeping one says so once in the Undo line | |
| A piece of yours, moved | Row meta: "Moves 4 in right and 2 in higher: take it down and rehang it." | |
| New art in the open frames | From Preferences: the same frames, new picks; kept and yours stay. "New art in all 6 frames. Undo" | Undo |
| Favorited a piece | Heart fills; the piece lands on Favorites. The button is "Favorite", so it never reads like the wall's Save (v4) | Tap again to take it off |
| Moving pieces | Preferences, "Move pieces by hand": drag a frame or use the arrow keys; snaps as before | Done, Undo, Put them back |
| Moved to a spot that breaks a rule | The frame turns to the error style with the reason; on letting go it goes back | |
| Changed, want it back | A version in the row, or Preferences, "Put it back as it was built" | |
| Sample | "Sample wall" chip on the drawing | |

Undo stays until the next change. Versions stay with the wall, on this device.

## 9b. Frame it (v4, Oct 3)

From the open wall's Frame it. One look for every new frame, a mat or not, and the sizes.

| State | What they see | Action |
|---|---|---|
| Default | "Frame it", "One color for the set. Tap a dot on a piece to change just that one.", the wall drawn with its frames, Frame: Black, White, Oak, Brass (Black pressed), "Sizes": each new piece with its print, mat and frame in words ("Print 8 x 10 in with a mat, in a 11 x 14 in frame, 12.5 x 15.5 in outside"), Get it docked | Pick a look, Get it |
| A frame color per piece (Oct 5) | Each piece that takes a frame has four dots (Black, White, Oak, Brass, 44 px to tap), its color ringed; a House of Spoils print has the three it comes in | Tap a dot: that frame changes on the drawing and its thumbnail, the price and Get the frames follow; Get it adds "Oak frame." to that piece. Picking one color for the set puts every frame on it: "Every frame white." with Undo |
| Free photos on the wall | "How many mats": None, Few, Some, Most, All (Most pressed since Oct 5, or the level you picked last), and a line on what a mat is and how they're chosen. Each free photo that can take a mat has a Mat tick | Pick a level, flip one |
| A shop print hung a frame up | "Print 12 x 16 in with a mat, in a 16 x 20 in frame, 17.5 x 21.5 in outside"; no tick (the wall is sized for it) | |
| A piece without a mat | "Print 11 x 14 in, no mat, in a 11 x 14 in frame, 12.5 x 15.5 in outside" | Tick Mat |
| Flipped by hand | None of the three is pressed; that piece keeps its own | Pick one of the three to reset all |
| Shop sells it framed | "Comes framed, 14.5 x 18.5 in." | |
| Shop sells it framed with a white border (House of Spoils, Oct 5) | Drawn as the frame, a wide white border and the art inside at its size. "Comes framed with a white border, art 8 x 12 in, 14.5 x 18.5 in outside." The size list has its full bleed size too ("9.5 x 13.5") | Color dots; the buy link opens that size and frame color |
| Nothing new | The wall's Hang it goes straight to Hang it | |
| Frame width (Oct 4) | Slim, Standard (pressed), Wide; a line on the moulding; with Wide, "easy in 8 x 10, 12 x 16, 16 x 20 and 20 x 28 (IKEA EDSBRUK); other sizes are made to order" | Pick one: the frames grow or shrink about their centers, "Slim frames." with Undo |
| A width that doesn't fit | "Wide frames don't fit this wall as it's laid out." and the rule it breaks; nothing changes | |
| Mat width (Oct 4) | When a free photo has a mat: Standard (pressed), Wide; Wide prints the photo two sizes down, "a precut mat with that window, about $10 to $15" | Pick one |
| A size per piece (Oct 4) | Each new piece with more than one size its way round has a size list | Pick a size: "Now 16 x 20 in." with Undo |
| A size that doesn't fit | "24 x 36 in doesn't fit there." and the rule it breaks; nothing changes | |
| Your art that isn't framed | "Your print: 12 x 16 in, in a 12 x 16 in frame, no mat." | |

## 10a. Get it (v4, Oct 3)

| State | What they see | Action |
|---|---|---|
| Default | "Get it", the three steps with what each takes, "Ordered so far: 0 of 5 pieces, 0 of 5 frames. Tick each one as you go.", each piece with its words, its source link and ticks (Ordered or Printed, and Frame ordered), then Print the free photos, Get the frames, Copy for your AI, and "When it all arrives" with Hang it and Save | Buy, tick, Hang it, Save |
| Some ticked | The count follows; a ticked box is green | Untick |
| All ordered | "Everything is ordered."; Hang it becomes the main button | Hang it |
| Coming back | The open wall says "Ordered 3 of 10. Continue" under the pager | Continue |

## 10. Hang it (the hanging guide)

| State | What they see | Action |
|---|---|---|
| Default | The step bar (5 Hang), "Get it, hang it", the why line, "What to get": each new piece with artist, shop, print size and price, its frame in words with a Change link back to Frames, then the total | Buy at [shop], Find a frame, Change |
| Free photo | "Print it 8 x 10 in. Mat with a 7.5 x 9.5 in window. Frame 11 x 14 in, 12.5 x 15.5 in outside." and the credit, free under the site's license | Get it on [site], Find a frame |
| Shop print | "Print 20 x 28 in. Frame 20 x 28 in, no mat, 21.5 x 29.5 in outside." or "Comes framed, 14.5 x 18.5 in outside." | Buy at [shop], Find a frame |
| Where to print | With free photos on the wall: "Your free photos need 2 at 8 x 10 in, 1 at 11 x 14 in." Best price, Same day and Better print with totals, then every service with its price per size and the total ("No" where it doesn't print a size, "Not all" for the total), what it ships for or when pickup is, and its usual codes. "Prices checked [date]." | A service's name opens its site, Copy for your AI |
| Where to frame | "This wall needs 3 frames: 1 at 16 x 20 in with a mat for 11 x 14, ..." Best price, Same day and Better frame or Done for you, then each seller's price per size with "mat fits", "mat 5 x 7" or "no mat", the total, pickup and shipping, and its usual sales. "Where the mat doesn't fit your print, buy the frame alone and a mat cut to the window above." | A seller's name opens its site |
| The wall in a line | Top of What to get: "2 new pieces: 2 to print, 2 frames, 2 with a mat. Printing and frames from about $33.54 at the cheapest, before codes." With shop prints: "plus the shop prints" | |
| Copied | "Copied. Paste it into your AI." beside the button; focus stays on it. If the browser won't copy: "Could not copy. Select the table and copy it." | |
| Nothing new | "Hang it", no buy list | |
| Hanging guide | The drawing with measurements and nails always on, and a table: piece, frame, from the left, up from the floor. Under a piece's name, when something is within 30 in: the same spot from its nearest edge | Change the wire drop, Print |
| A piece of yours moves | "Take it down and rehang it here." under its name | |
| Hang it page | "Hang it": 1. What each frame hangs on (open: each frame's hanger and measurements), 2. Where the nails go (drawing, table, steps), 3. Done? with It's up | Set a hanger, It's up |
| It's up | "It's up", "Nice. When you want a change, open this wall and swap a piece; the frames and nails stay.", Add a photo of it, Save, Not up yet; the open wall says "This wall is up. See it" | Add a photo, Save, Not up yet |
| A photo of it | The photo of the hung wall, whole, above the line | New photo of it |
| Hangers, assumed | Under "Where the nails go": "Nail spots assume the hanger each frame usually comes with. When your frames arrive, check them at the bottom of this page." Each row: "Sawtooth hanger, assumed", "Wire, assumed" or "Two D-rings, assumed"; D-ring frames list two nails ("21½ in, and 39 in") | |
| Checking the hangers | Last on the page, closed: "When your frames arrive: check the hangers". Open: each frame with its hanger (Sawtooth hanger, Wire, Two D-rings), how far below the top, and for D-rings how far in from each side. A change moves its nails at once; the section stays open | Pick, type |
| Size from the photo | "These spots are estimates. The wall's size was worked out from [the TV] in your photo, not measured, so a spot can be off by several inches. Measure the wall's width once and every spot firms up." | Measure |
| Width measured, photo wall | "The wall's width is your measurement. Heights and furniture are read from the photo, so check one spot before drilling." | |
| Check before drilling (photo walls) | First step: "Before the first hole, check one spot: mark where the biggest frame's nail goes and see that it sits where the drawing shows it next to [the couch]. If it's off, fix the wall's width and every spot moves with it." Last step: "A photo can't see wires or studs. Near an outlet or switch, check with a stud finder before you drill." | Fix the wall's width |
| Leaving the site | Opens in a new tab; the wall stays | |

## 10b. Saved

| State | What they see | Action |
|---|---|---|
| None | "Tap the heart on any print and it lands here." (v4) | |
| Taken off Favorites | The piece leaves the list. "Out of favorites. Undo" (v4) | Undo |
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

## 10d. Walls people hung

| State | What they see | Action |
|---|---|---|
| None | "Share a wall from its Get it screen and it lands here." | |
| Posts | Name, room, date, a line; Before and After drawings; Also considered, three small walls with their why lines; the pieces with hearts | Save a piece, Try these on my wall, Remove |
| Share sheet (Get it) | What goes up, a name field, a line | Share, Not now |
| Try these on my wall | Their new pieces kept in every wall of yours at their sizes: "3 pieces from that wall, kept in every wall of yours." | |

## 10e. Browse (Oct 4)

From Preferences ("Browse all the art"), the feed (after the seventh wall) and Favorites.

| State | What they see | Action |
|---|---|---|
| Default | "All the art", the count, a line on what saving does (and "Teach it your taste" before the test), Filter and sort folded, then a grid of every piece at its own shape: title, artist and shop (or "free photo"), "from $29", a heart, Not for me | Open Filter and sort, save, Not for me, Favorites |
| Filters open | Subject, Color, Mood, Shape, From, Price, Sort (For you once there's a taste) | Pick; "Clear filters" when any are on |
| Saved | "Saved The Dream." with Undo; the heart filled | Undo |
| Not for me | The piece leaves the grid, "Not for me." with Undo | Undo |
| Nothing matches | "Nothing matches. Try fewer filters." | |
| More than 60 | "Show more" and "60 of 442" | Show more |

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

### Oct 4: where things live on the walls

| State | Shows | Notes |
|---|---|---|
| Bar on the walls and an open wall | Back or the wordmark, then Menu and Preferences | |
| Preferences | Taste, Look (kind and how full), How many, Art, Color, Room (Any, Light, Wood, Bold, Dark), Scenes (Any, Real, Abstract), Busy (Any, Quiet, Busy), Frames, Mats (Most by default), Budget, Reset preferences. Nothing else | Only choices that change the walls. Room, Scenes and Busy are the quick questions' answers, kept for you across walls; a change says "Changed." with Undo |
| Menu | Your walls (count), Favorites (count), Browse all the art, Your art and frames, Check the wall (not on a sample), Start a new wall | |
| Open wall tools | One row under the pager: Move pieces (Done moving while on), Measurements, Put it back (after a change), As it hangs now (when it differs) | |
| Your art (a wall's pieces) | Each piece: name, Framed or Not framed, Wide and Tall with Keep shape, the frame it goes in when not framed, Keep, Maybe, Skip, Save to your stuff (or In your stuff), Remove | |
| A Society6 print on a wall | The frame, the paper with its printed white border (1 in small, 2 in medium and up), the art inside at its own shape | Never a second mat |
| Start, the wall photo | Phone: Take a photo (camera), Or choose one you have. Computer: Choose a photo | |
