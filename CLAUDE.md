# Walldrobe

Read before changing anything, in this order: PRODUCT.md, ENGINE.md (for engine work), STATES.md, DESIGN.md, DECISIONS.md. If a request conflicts with them, say so before changing anything. Record every product call as a dated line in DECISIONS.md, and every piece of Jason's feedback (and every call you make on your own) as a row in FEEDBACK.md: what he said, what changed, who decided, why, status.

- The engine (`engine/`) is pure: no DOM, no network, no clock, seeded randomness only. Run `node --test` after every engine change.
- Layout and geometry are rules and scoring. Models only for taste and image understanding.
- No em dashes anywhere, including comments and test names. Plain words.
- Never stretch an image. Crop, keep the native aspect ratio.
- Demo art: modern photos from Unsplash, Pexels and Pixabay, credited, shown under each site's license, never sold. No Unsplash+ premium, no museum archives, no 3D renders or AI images. Never re-host a store's images. Every new piece gets looked-at tags in tools/tags.json.
- Security: writes go through a function that checks who is asking; only the publishable key in the frontend; wall photos private.
- UI checks: 320 and 390 wide and desktop, every state in STATES.md, real screenshots only.

## Checking a change (keep it cheap)

- `node tools/check.mjs` after a change: it picks the tests and the walk sections the changed files reach, builds and serves when needed, and prints one line per step with only the failures. `--plan` says what it would run. Full output and screenshots go to out/check/; read them only when something fails.
- `node tools/check.mjs --full` once, before pushing to main. Run it in the background and wait on it with one watch that fires when it ends, not repeated polls.
- Add new screen checks to an existing section of tools/ui_walk.py (or a new named section) instead of writing a one-off browser script. Look at a screenshot only for a change you need to see (layout, a new screen), at one width, not every width.
- Never run the walk and `node --test` at the same time (memory).
