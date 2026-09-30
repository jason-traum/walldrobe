# Walldrobe

Rent the Runway, for art: a wardrobe for your walls.

You show it one wall and the art you already own. It gives you a finished wall, with specific pieces, sizes, positions and spacing for that wall, and you can change it later.

This repo holds the layout engine and a demo with three sample walls and 275 modern photos from Unsplash.

## The layout engine

`engine/` is a pure JavaScript module with no dependencies. It runs in the browser and in Node.

```js
import { layout } from './engine/index.js';

const { layouts, problems } = layout({
  wall: { width: 132, height: 96 },                           // inches
  obstacles: [{ id: 'couch', kind: 'couch', x: 24, y: 0, w: 84, h: 32 }],
  owned: [{ id: 'blue', title: 'blue print', w: 20, h: 28, keep: 'must' }],
  catalog,                                                   // candidate art with sizes and palettes
  taste,                                                     // { [artId]: 0 to 1 }
});
```

Each layout lists every piece with its position in inches, where the nail goes, and one sentence on why it's there. Every wall is judged whole: fit, taste, color (the scheme on the color wheel, how much of each color, whether accents repeat) and design (balance, a focal piece, busy next to quiet). `refill(input, layout, { keep, swap })` keeps the frames where they are and changes the art in them. The rules (57 in to center, 2 to 3 in gaps, about two thirds the width of the couch, 8 in above it) and the scoring are in [ENGINE.md](ENGINE.md).

```sh
npm test               # 98 tests, including 300 random walls
npm run elevations     # draws the sample walls' top layouts as SVG in out/
```

## How it's built

- [PRODUCT.md](PRODUCT.md): who it's for, when they use it, and the build order.
- [ENGINE.md](ENGINE.md): the layout engine spec.
- [STATES.md](STATES.md): every screen in every situation.
- [DESIGN.md](DESIGN.md): the design rules.
- [DECISIONS.md](DECISIONS.md): one dated line per call.

Rules and scoring handle layout and geometry. Models only come in where they earn it: taste and image understanding.
