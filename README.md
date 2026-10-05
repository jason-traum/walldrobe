# Walldrobe

Rent the Runway, for art: a wardrobe for your walls.

You show it one wall and the art you already own. It gives you a finished wall, with specific pieces, sizes, positions and spacing for that wall, and you can change it later.

This repo holds the layout engine, the photo reader and the site. The catalog has 2,110 pieces, each one looked at and tagged: 641 free photos from Unsplash, Pexels and Pixabay, and 1,469 real prints from Society6, House of Spoils, Desenio and Juniper Print Shop that link out to the shop.

**Live: [jason-traum.github.io/walldrobe](https://jason-traum.github.io/walldrobe/)**. Take a photo of a wall (or a few, for a whole home). The site finds the wall, the furniture and the art already up, then shows a ranked list of finished walls around the pieces you own, at true scale, each with its price ("$1,000 (+$200 to frame)"). Swap any piece, pick frames and mats (one color for the set or one per piece), then get a list of what to order, the cheapest places to print and frame, and where every nail goes. Walls save on your device; photos never leave it.

## The site

`web/` is the app: `detect.js` (the photo reader: corners, furniture, art, outlets, scale), `segment.js` and `segcore.js` (the image model, run on the phone), `photo.js` (flattening a photo to true scale, painting out a piece, palettes, white balance), `camera.js` (where the camera stood), `draw.js` (walls drawn to scale), `framers.js` and `printers.js` (where to frame and print, with prices), `store.js` (saving on the device) and `main.js` (the screens). Build it into `docs/`, which GitHub Pages serves:

```sh
npm install --no-save esbuild
npm run site -- node_modules/.bin/esbuild   # writes docs/
```

`npm run demo` builds the older one-page explainer into `out/`.

Photos are from Unsplash, Pexels and Pixabay, credited to each photographer and shown under each site's license ([Unsplash](https://unsplash.com/license), [Pexels](https://www.pexels.com/license/), [Pixabay](https://pixabay.com/service/license-summary/)). Walldrobe doesn't sell them.

Real prints come from shops' public product lists for the beta (Society6, Juniper Print Shop and House of Spoils with their own fetch tools in `tools/`, Desenio read in a browser) and later from affiliate feeds (`node tools/import_feed.mjs feed.csv --merchant minted`). Each one links to the shop to buy, with its real sizes, prices, printed borders and frame options. See CATALOG.md, Shop feeds.

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
npm test               # 284 tests, including 300 random walls and real room photos
python3 tools/ui_walk.py out/walk   # every screen at 320, 390 and desktop, against the built site on :8830
node tools/bench_read.mjs <dir>     # how well the photo reader boxes furniture side by side
npm run elevations     # draws the sample walls' top layouts as SVG in out/
```

## How it's built

- [PRODUCT.md](PRODUCT.md): who it's for, when they use it, and the build order.
- [ENGINE.md](ENGINE.md): the layout engine spec.
- [STATES.md](STATES.md): every screen in every situation.
- [DESIGN.md](DESIGN.md): the design rules.
- [DECISIONS.md](DECISIONS.md): one dated line per call.

Rules and scoring handle layout and geometry. Models only come in where they earn it: taste and image understanding.
