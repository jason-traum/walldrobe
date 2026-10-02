I want to replan Walldrobe's interface from the ground up, the way we did the v2 redo, which worked. The repo is jason-traum/walldrobe. Attached is my design playbook, "Claude Code app design craft.md". It is the rulebook, especially sections 1 to 9, the avoid list in section 10, and Appendices A to D.

Why I'm redoing it: the engine, the photo reader and the art picks are good. The interface drifted. The build at commit a63c921 (Oct 1, 11:19 pm, right after the v2 redo) looked and felt right; it was only missing features. Every build since then added features by adding controls, and three rebuilds in one day (a strip of segments, numbered steps, Layout/Art views) made it worse: too many decisions at once, too many buttons, no clear process, AI slop. I want the calm of a63c921 with the features I've asked for since, each in a place that makes sense.

Work in this order and stop where I say to stop.

1. Read before touching anything
- Read CLAUDE.md, PRODUCT.md, FEEDBACK.md (all of it: it is every piece of feedback I've given and what came of it), DECISIONS.md, STATES.md, DESIGN.md and HANDOFF.md section 5g. Then the code in web/ and engine/.
- Walk three builds at 390x844 and 320, light, with a sample wall, and screenshot every screen:
  - a63c921, the one I liked: https://rawcdn.githack.com/jason-traum/walldrobe/a63c921/docs/index.html#/sample/bedroom
  - main, live now (v2 plus features): https://jason-traum.github.io/walldrobe/
  - v3, the latest attempt: https://rawcdn.githack.com/jason-traum/walldrobe/1ada475/docs/index.html#/sample/living
  If a link won't load from your environment, check out the commit and serve docs/ locally.
- Send me an honest review using the playbook's six questions (Fit, Structure, Identity, Behavior, Integrity, Continuity), with screenshots as evidence. Then answer two questions directly: what made a63c921 feel right, and what exactly each later change broke.
- Count the controls on each main screen of each build (buttons, segments, links, selects) and show the counts in a table.
- Stop and wait for me. Do not delete or rewrite anything yet.

2. Product reset
- From FEEDBACK.md, list every feature I've asked for and sort them into: must have for v4, can wait, and engine-only (no interface at all). Show it as a table and let me move things.
- Write down the loop I actually use, in my words: lock in a layout first, then curate the art, then save the wall with its pieces, keep playing, make another, compare them. Show how each must-have feature serves a step in that loop. Anything that serves no step waits.
- Set a control budget for each main screen (the most visible controls it may have), and say what lives one level down.
- Ask at most three questions at a time. Update PRODUCT.md and add a dated line to DECISIONS.md and a row to FEEDBACK.md for every call.

3. Structure before style
- Propose three structurally different versions of the core loop (layout, art, save, compare), each starting from a63c921's structure where it can, using the same real content: a real sample wall, my own pieces, and the long-title fixture.
- For each: an ASCII wireframe at 390 wide for each main screen, the control count against the budget, the tap count for my loop, where every must-have feature lives, what it optimizes, what it gives up, and how it handles the empty and failed states.
- Recommend one. Stop and wait for my pick.

4. Visual direction
- Keep a63c921's direction (painter's tape, its tokens and type in DESIGN.md) unless the review gives a strong reason to change it. Say so either way.
- Known asks: Save and Get as small icons, not big buttons. Light mode only.
- Save the approved first screen and one hard state as reference screenshots in design/references/. Stop and wait for my OK.

5. Build
- New branch v4, started from a63c921's web/ and site.css, with today's engine, photo reader, catalog, taste and server code carried over. Leave main and the live site alone until I approve the switch.
- Add features one at a time in the agreed order. After each one: screenshots at 390 and 320 against the references, the control count against the budget, and a FEEDBACK.md row. I say keep or cut before the next one starts.
- Guardrails, learned the hard way:
  - No new control on a main screen unless one is removed or the budget allows it.
  - No restructuring mid-build. If a feature doesn't fit the structure, stop and tell me instead of reshaping the screen around it.
  - One feature per round.
  - Never silently drop a feature or a click handler: every round walks the whole flow and checks that hearts, swaps, keeps and undo still work.
- Follow CLAUDE.md and the playbook rules: tokens only on :root, never stretch an image, no em dashes anywhere, plain verbs and sentence case, 44 px targets and 16 px inputs, safe areas, motion only with a reason, and the photo stays private.

6. Review and ship
- When the loop is complete, run a fresh-context review as a separate agent that didn't build it, using playbook prompt B3. Then run the B4 audit and fix the Blocker and High findings.
- Send me a short summary with before and after screenshots and the open risks, including anything that needs a real iPhone to check.
- Merge to main only when I say so.

How to talk to me: short and plain, lead with the answer, tables for lists, no hype, no em dashes. If a request of mine conflicts with PRODUCT.md, DESIGN.md or DECISIONS.md, say so before changing anything. Log every piece of my feedback and every call you make in FEEDBACK.md.
