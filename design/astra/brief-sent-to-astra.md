I'm building Walldrobe, a phone web app that plans the art on one wall. I need help with the interaction design of the core screen. The engine works well. The flow doesn't feel right yet. Please read all of this, try the links, and give me a concrete recommendation.

Links (open on a phone, or at 390 px wide):
- Current work in progress (v3): https://rawcdn.githack.com/jason-traum/walldrobe/2afb20f/docs/index.html#/sample/bedroom
- Live version (v2): https://jason-traum.github.io/walldrobe/
- First version (v1): https://jason-traum.github.io/walldrobe/v1/

WHAT IT DOES
You take one photo of a wall. It finds the wall's size, the furniture, windows and outlets, and the art already up, and you fix anything it got wrong. Then it lays out new art around the pieces you own, at true scale, and gives you the nail spots. Prints link to shops; free photos you print yourself. The longer-term idea is rotation: the frames stay up and the prints swap.

WHO IT'S FOR
Renters in their late 20s to late 30s who just moved. They own a few pieces and the wall still doesn't look right. They aren't art buyers. They're standing in the room with a phone in one hand.

WHAT THE ENGINE CAN DO
- Generate every layout that fits the wall, using rules for spacing, eye level, width against the furniture, and anchoring. Then rank them by taste (a pairs quiz plus hearts and swaps), color fit with the room, and how little it moves art that's already hung.
- Keep a layout's frames and swap the art in one spot, or in all of them.
- Step to one more or one fewer piece while keeping the frames already placed.
- Treat each of your own pieces as Keep (in every wall), Maybe (in a wall only if it earns its place) or Skip. A new piece can also be kept, which locks it into every suggestion.
- Save every version of the wall, so nothing is lost.
- Afterwards: frames (one look for the set, then any one piece), and a hanging guide.

HOW PEOPLE ACTUALLY USE IT (the loop I need to support)
They don't see a wall and buy it. They:
1. See a layout and like the shape.
2. Like two of the pieces, not the third.
3. Swap the third a few times. Nothing lands, so they try one fewer piece.
4. Want a more structured version that still has the two pieces they kept.
5. Want the earlier four-piece version back.
6. Settle and hang it.

The order is roughly taste, then layout, lock a layout, then refine the art. But people go back and forth between layout and art many times. That back and forth is the creative process, and it has to feel seamless.

WHAT I'VE TRIED AND WHY IT FAILED
- v1: knobs (structured or loose, calm to full, piece count) that generated alternatives. Flexible, but confusing.
- v2: a ranked feed of whole walls, with those knobs as rows of buttons on screen. It grew to 17 controls above the first wall and 21 controls for frames and mats. It reads as AI slop: everything looks equal, there's no visible process, and too much has to be picked at once.
- v3 (the first link):
  - Five named steps (Wall, Taste, Pick, Frames, Hang).
  - The Pick screen is "your wall". Tap a piece to Keep, Swap (four alternatives for that spot), Let it go, or Save it.
  - Versions sit in a row under the drawing, and a ranked Suggestions list is one tap away.
  - One Adjust sheet holds every lever as a dropdown.
  - It's calmer, but layout and art are still blended on one screen, the step bar feels like a form wizard, and the loop above isn't natural yet.

The idea I'm considering: one wall, two lenses, with a Layout / Art toggle right above the drawing.
- Layout lens: swipe through layouts, and your kept pieces come along. Count, fullness and structured or loose live here.
- Art lens: the layout is locked. Tap a frame to swap, keep or let go. "New art in the open frames" and the art filters live here.
- Versions span both lenses.

CONSTRAINTS
- A phone, one hand, standing in the room.
- Plain words. No hype. No control panel as the first thing you see.
- 44 px tap targets. Light mode only.
- The art is the content, and the interface gets out of the way.
- Every change can be undone.

WHAT I'D LIKE FROM YOU
1. Your recommended interaction model for the layout and art loop. Two lenses, or something better? Say why, and what it gives up.
2. A wireframe of the main screen at 390 px wide (ASCII is fine), in both modes if there are modes.
3. Where each control lives: piece count, how full, structured or loose, which art, filters, refresh the art, keep, maybe, swap, let go, versions, suggestions, frames.
4. How the back and forth works step by step for the six-step loop above. Count the taps.
5. How to show progress through the whole flow (photo, taste, layout, art, frames, hang) without a step bar that looks like a form wizard.
6. Two or three real apps or physical experiences that get this kind of iterative choosing right, and the one thing to borrow from each. Think of a framer's consultation, Pinterest, design tools with variants, or Spotify radio.
7. The biggest mistakes to avoid.
