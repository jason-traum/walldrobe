# FEEDBACK.md

Every piece of feedback from Jason, what it changed, who made the call and why. Calls Claude made on its own are here too, marked Claude. Newest last. DECISIONS.md holds the full wording of each decision; this is the trail from what was said to what was done.

Status: Live (on the real link), v3 (on branch v3, not live), To do, Reversed (a later row undid it), Open (not settled).

## 2026-10-01

| # | Jason said | What changed | Who | Why | Status |
|---|---|---|---|---|---|
| 1 | "The UI UX has generally got awful... complete AI slop, too many buttons, not intuitive." | Full v2 redo: review, product reset, three structures, three directions, rebuild every screen. Engine and photo reader kept. | Jason (redo), Claude (what to keep) | The review scored Fit, Structure and Identity as failing; the engine and reader worked. | Live |
| 2 | "Random buttons you are pushing that gives you alternatives... you should see a list of options, sometimes 3, sometimes 10, ranked best to worst and why." | Choosing became a ranked list of whole walls with a why line. Style, count and fullness left the main screen. | Jason | Knobs made people coax alternatives out instead of choosing. | Reversed by 13, then 25 |
| 3 | "Should generate a ton of options then rank them based on the fit and preferences, which can change." | Generate once, rank many times. Ranking split from generating so a save or swap re-orders in place. | Jason | Fast re-ranking without rebuilding. | Live |
| 4 | "You might accidentally swap art then want to go back." | Every change has a visible Undo, never only a toast. | Jason | Mistakes must be cheap. | Live |
| 5 | "'Save' pieces that help continuously inform your art preferences." | Hearts on every piece; saves feed taste, swaps count as weak signals. | Jason | Learn taste from use, not only a quiz. | Live |
| 6 | (Claude) | Corners, then one confirm screen instead of three that repeated each other. | Claude | Check, What's in the way and Your art showed the same things three times. | Live |
| 7 | (Claude) | The first wall always adds new art; "just my pieces" is one tap away. | Claude | On Jason's photo the top result was his prints moved, nothing new. The first screen must answer "what would this look like finished". | Live |
| 8 | "Honestly I'm not sure" (about keep vs pin) | Keep or Skip on the confirm screen; Pin is one level deeper. | Claude (default) | Simplest default until real walls say otherwise. | Open |
| 9 | (Claude) | Painter's tape direction: blue tape for new, green for kept, orange for pinned. | Jason picked from three | Tape is what people actually use to plan a wall. | Live |

## 2026-10-02, overnight and morning

| # | Jason said | What changed | Who | Why | Status |
|---|---|---|---|---|---|
| 10 | "I wouldn't stress about price for now... test data." | No price term in ranking. | Jason | The catalog is placeholder art. | Live |
| 11 | "What if a user owns art but hasn't hung it, vs has and would move it?" | Moving hung art costs a little in ranking, more the farther it moves; art you added but haven't hung is remembered for your next wall. | Claude | Rehanging means new holes. | Live |
| 12 | (his bedroom photo) "Why might that be? The variance? It's a bit playful." | Free-form walls: the biggest piece anchors, neighbors line up, centered over two pieces of furniture. Packer added so all seven of his pieces fit. | Claude | His wall already scored best on design; it lost on fit. | Live |
| 13 | "The old one was working really well too... I didn't realize how much you were cutting... calm balanced full, structured loose either, add or take away a piece, photos vs prints or both." | The four choices came back, first as chips. | Jason | The ranked list only half replaced them. | Reversed by 14 |
| 14 | "I HATE the UI on the button switching. It's not intuitive at all and looks like AI slop." | Chips replaced with on-screen segments and a stepper. | Jason | A chip that opens a sheet is two taps for a one-tap choice. | Reversed by 25 |
| 15 | "I miss the rotate this art button." | Refresh the art: same frames, new picks. | Jason | Seeing more art in a layout you like. | Live; in Adjust on v3 |
| 16 | "If you go up to four from three then back to three you should have the same layout as before." | Views are kept by their inputs and brought back, not rebuilt. | Jason | Stepping back must not lose what you saw. | Live |
| 17 | "Drag is better than typing the sizes... furniture should be able to move any corner." | Drag any corner of a box on the confirm photo; a close-up above the finger when placing corners. | Jason | Fingers hide the spot; typing still needs moving. | Live |
| 18 | "An option for it telling me how many pieces vs I know how many I want." | Any number vs Set number. | Jason | A stepper showing a number read as a choice already made. | Live; stepper in Adjust on v3 |
| 19 | "Can we always have it in light mode. Dark mode is bad here." | Light mode only. | Jason | Art reads truest on a light page. | Live |
| 20 | (his couch and column photos) "My wall has a built-in dent so I labeled that a super thin lamp." | "Wall edge" kind; any found thing can change its kind; door and ceiling only set scale when the floor is seen; free-form width must match the couch. | Claude | The reader read the couch wall as 16 ft 7 in; a 28 in stack beat a 74 in couch. | Live |
| 21 | "Change isn't clear that it's how you get prompted." / "Make the taste test more obvious." | Taste box moved onto the feed. | Jason | Hidden behind Change, nobody found it. | Reversed by 25 |
| 22 | "Standard framing options for each? Pick styles that work with each piece and as a collection." | Frames on Get it: a suggested frame per piece, matched set or each its own. | Jason | Framing is part of the wall. | Live; moved to Frames step on v3 |
| 23 | "Matting as a buffer... styles for the frames... a black and white wall with a blue or red frame." | Looks (Classic, Gallery, Warm wood, Clean, Gold, Color pop), mats, weights, walnut. | Jason | One tap sets the whole wall; details for those who want them. | Live |
| 24 | "Push this to the real link and save the old one as v1." | v2 on main; v1 kept at /v1/, branch and tag. | Jason | | Live |
| 25 | "A page to see other people's walls? Before and after? Ideas they considered?" / "LOVE IT. YES" | Walls people hung: before, after, also considered, pieces, Try these on my wall. | Jason | A social reason to come back. | Live |
| 26 | "Share in-wharton." (no third free Supabase project) | The public feed lives in the in-wharton project, every object prefixed wd_, writes only through functions that check the phone's secret. | Jason | Free, ready now; In.'s tables untouched. | Live |
| 27 | (Claude) | Found the strip rewrite had cut the heart and other handlers for about four hours; restored them and added a heart check to the test walk. | Claude | A tap with no response is a release blocker. | Live |

## 2026-10-02, afternoon (v3)

| # | Jason said | What changed | Who | Why | Status |
|---|---|---|---|---|---|
| 28 | "Art preferences are deeper than just the metrics you picked." | To do: taste beyond the seven axes (subject, era, medium, mood, how pieces talk to each other), learned from saves and hangs. | Jason | Seven axes are a start, not a taste. | To do |
| 29 | "With all of these buttons it's feeling more and more like AI slop... maybe a dropdown." / "Too many things you have to pick all at once, even on the matting." | Review against the playbook: 17 controls above the first wall, 21 frame controls under the nails. Strip, Filters, taste box and Change sheet removed; one Adjust sheet of dropdowns; Frames its own step with one look and a per-piece sheet. | Jason (redo), Claude (design) | Fit, Structure and Identity failed again; every feature since v2 added its own row of buttons. | v3 |
| 30 | "The flow isn't clear... doesn't tell you what the process is... should feel like a white glove service." | Five named steps on every screen: Wall, Taste, Pick, Frames, Hang. | Jason picked the consultation structure | People need to know where they are and what's next. | v3 |
| 31 | "I see a layout and like some of it... save a few pieces, rotate out a few... change the number... how can I save what I had before and not lose it? Play around." | Pick is your wall that you build: tap a piece to Keep, Swap it for one of four, Let it go, Save for later. Every version saved in a row under the drawing. Suggestions one tap away. | Jason (the loop), Claude (the design) | People build a wall over several passes and need a way back. | v3 |
| 32 | (screenshot of the step bar) "This does not look good at all." | Step bar redrawn: numbers with names, current one in ink; on phones only the current step keeps its name. | Claude | The underline bars looked broken and labels collided. | v3 |
| 33 | "Add back the option for maybe keep... I'm not always locked in to keeping what I have." | Your pieces are Keep, Maybe or Skip. Maybe goes in a wall only when it earns its place, and ranking doesn't penalize leaving it out. | Jason | Keep was all or nothing. | v3 |
| 34 | "We don't need all of this info here... too much for artwork I KNOW I'm keeping." | Your pieces collapse to one row of thumbnails and one line on what moves; tap one to change it. Only new pieces get full rows. The "because you said you'd keep it" line is gone. | Jason | Your own art isn't a decision on this screen; the nails are on Hang. | v3 |
| 35 | "First we go from taste into layout, lock in a layout, then refine the art... but go back and forth, it's iterative, that's the creative process." | Proposed: one wall, two lenses (Layout and Art) a tap apart, kept art carried across, versions spanning both. Brief written for Astra. | Jason | Layout and art are separate decisions people revisit many times. | Open, waiting on Astra |
| 36 | "Make sure you're updating the log of all my feedback and why... and decisions you made." | This file. A row is added with every change from now on. | Jason | | Live |
