# Walldrobe

Read before changing anything, in this order: PRODUCT.md, ENGINE.md (for engine work), STATES.md, DESIGN.md, DECISIONS.md. If a request conflicts with them, say so before changing anything. Record every product call as a dated line in DECISIONS.md.

- The engine (`engine/`) is pure: no DOM, no network, no clock, seeded randomness only. Run `node --test` after every engine change.
- Layout and geometry are rules and scoring. Models only for taste and image understanding.
- No em dashes anywhere, including comments and test names. Plain words.
- Never stretch an image. Crop, keep the native aspect ratio.
- Demo art: modern photos from Unsplash, credited, shown under the Unsplash License, never sold. No Unsplash+ premium, no museum archives. Never re-host a store's images.
- Security: writes go through a function that checks who is asking; only the publishable key in the frontend; wall photos private.
- UI checks: 320 and 390 wide and desktop, every state in STATES.md, real screenshots only.
