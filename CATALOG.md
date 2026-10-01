# CATALOG.md

Every piece of art in Walldrobe is one record. This file says what's in a record, what each field is for, and where its value comes from. The machine-checkable version is `engine/catalog.js` (`validateRecord`), and `npm test` runs it over the whole demo catalog.

Who fills each field, in order of trust:

- **source:** copied from where the art came from (the photographer's name, the page link). Never edited by hand.
- **measured:** computed from the image by `tools/analyze.py`. Same image, same numbers.
- **rule:** set by a rule from other fields (for example, food goes in the kitchen). Good enough to start, meant to be replaced.
- **model:** set by the offline tagging pipeline (build order step 8). Not used yet.
- **human:** set or corrected by a person. Wins over everything else.

Each record keeps `provenance`, a map from field group to who set it, so a later pass knows what it may overwrite.

## A record

```json
{
  "id": "u-1561616256-75",
  "status": "active",
  "title": "Five swimmers",
  "medium": "photo",
  "category": "pool",
  "artist": { "name": "Silas Baisch", "url": "https://unsplash.com/@..." },
  "source": {
    "provider": "unsplash",
    "page": "https://unsplash.com/photos/S_laDe2hxeM",
    "imageId": "photo-1561616256-75e353eae131",
    "license": "Unsplash License",
    "licenseUrl": "https://unsplash.com/license"
  },
  "rights": { "show": true, "sell": false, "credit": "Photo by Silas Baisch on Unsplash" },
  "image": { "src": "art/photo-1561616256-75e353eae131.jpg", "width": 900, "height": 1350, "aspect": 0.6667, "orientation": "portrait" },
  "color": {
    "palette": [{ "hex": "#2FA7C9", "weight": 0.41, "name": "teal" }],
    "dominant": "teal",
    "bw": false,
    "brightness": 0.62,
    "contrast": 0.35,
    "saturation": 0.44,
    "colorfulness": 0.51,
    "warmth": -0.38,
    "shares": { "teal": 0.727, "white": 0.117, "gray": 0.088, "blue": 0.067 },
    "hues": [0, 0, 0.001, 0, 0, 0.002, 0.353, 0.629, 0.016, 0, 0, 0],
    "chromatic": 0.794,
    "value": { "dark": 0.029, "mid": 0.603, "light": 0.367 }
  },
  "composition": {
    "busyness": 0.22,
    "negativeSpace": 0.48,
    "focal": { "x": 0.46, "y": 0.41 },
    "symmetry": 0.81,
    "weight": 0.37
  },
  "tags": {
    "theme": "summer",
    "subjects": ["pool", "swimmers"],
    "mood": ["sunny", "calm"],
    "style": ["aerial", "graphic"],
    "people": true,
    "rooms": ["living room", "bedroom", "bathroom"]
  },
  "sizes": [{ "w": 16, "h": 20 }, { "w": 24, "h": 36 }],
  "offers": [],
  "quality": { "score": null, "by": null },
  "provenance": { "source": "source", "image": "measured", "color": "measured", "composition": "measured", "tags": "rule", "sizes": "rule", "quality": null }
}
```

## Fields

| Field | What it is | Who sets it | Used by |
|---|---|---|---|
| `id` | Stable id, never reused | source | everything |
| `status` | `active`, `hidden` (kept but not shown), `removed` (rights pulled) | human | catalog |
| `title` | Short plain title, 1 to 5 words, sentence case | human (from alt text) | screens |
| `medium` | `photo`, `painting`, `illustration`, `print` | rule | taste |
| `category` | One of the categories below | human | taste, quiz |
| `artist` | Name, and profile link when known | source | credit line |
| `source` | Where it came from: provider, page, image id, license | source | credit, rights |
| `rights.show` | May we show the image | source | the gate for every screen |
| `rights.sell` | May we sell prints of it. `false` for all Unsplash, Pexels and Pixabay art | source | buy flow |
| `rights.credit` | The exact credit line to show | source | screens |
| `image` | Local file, original pixel size, aspect ratio, orientation | measured | layout, screens |
| `color.palette` | Up to 6 colors (k-means in Lab), weights sum to 1, each named from its hex exactly as the engine names it. Tiny clusters are dropped unless strongly colored | measured | harmony, reasons |
| `color.dominant` | The color a person would name first, adding up clusters of the same name; `black and white` exactly when `bw` is true | measured | reasons, taste |
| `color.bw` | No real color anywhere: low average color and under 0.5% of pixels with real color, so a small blue vase on white is not black and white | measured | taste |
| `color.brightness` | Mean lightness, 0 dark to 1 light | measured | taste, balance |
| `color.contrast` | Spread of lightness, 0 flat to 1 punchy | measured | taste |
| `color.saturation` | Mean chroma, 0 gray to 1 vivid | measured | taste |
| `color.colorfulness` | How many strong colors (Hasler and Süsstrunk), 0 to 1 | measured | taste |
| `color.shares` | How much of the image is each color family: red, pink, orange, yellow, brown, green, teal, blue, purple, black, gray, white. Shares over 0.5% only, summing to 1. Each pixel is named with the same thresholds as the palette | measured | wall color proportions, repetition |
| `color.hues` | The color wheel in 12 slices of 30 degrees (slice 0 is red at 0 to 30 degrees in Lab), weighted by how colorful each pixel is, summing to 1. All zeros when the image has no real color | measured | harmony schemes |
| `color.chromatic` | Share of pixels with real color, 0 to 1 | measured | how much a piece counts toward the wall's color scheme |
| `color.value` | Share of dark (L under 35), mid and light (L over 70) pixels | measured | value balance, black and white walls |
| `color.warmth` | -1 cool (blues, teals) to 1 warm (reds, oranges, yellows), weighted by how colorful each pixel is; greens and grays count as neither | measured | taste, harmony |
| `composition.busyness` | Edge density, 0 calm to 1 busy | measured | taste, layout balance |
| `composition.negativeSpace` | Share of the image that's quiet, 0 to 1 | measured | taste, reasons |
| `composition.focal` | Where the eye goes, 0 to 1 from the top left | measured | future: which way a piece faces in a row |
| `composition.symmetry` | Left-right mirror match, 0 to 1 | measured | future: center versus flank |
| `composition.weight` | How heavy it looks per square inch, 0 to 1 (dark, vivid, busy) | measured | layout balance |
| `tags.theme` | Broad theme: summer, sport, city, nature, still life, art, animals, mono. Must match the category (table below) | rule | taste |
| `description` | One line on what you see, written by looking at the image | model | the piece card |
| `tags.subjects` | What's in it, plain nouns, up to five | model (rule as fallback) | search, reasons |
| `tags.mood` | Any of: sunny, calm, moody, bold, playful, elegant | rule from measurements | taste |
| `tags.style` | Any of: minimal, graphic, aerial, film, documentary, painterly, still life, portrait | rule | taste |
| `tags.people` | Anyone in it (rule: category, or a word like swimmer or rider in the title) | rule, then human | taste, filters |
| `tags.rooms` | Where it would sit well: living room, bedroom, kitchen, bathroom, entry, office | model (rule as fallback) | filters |
| `tags.setting` | outdoor, indoor, studio or abstract | model | filters |
| `tags.time` | day, golden hour, night or any | model | filters |
| `tags.season` | summer, winter, spring, fall or any | model | filters |
| `tags.vibe` | A few free words: mid century, film, italian summer, brutalist | model | search |
| `sizes` | Standard outer frame sizes this image fits with a mat (shape within 14%). If none fits, the nearest size with `crop: true` | rule | layout |
| `offers` | Places to buy a print: vendor, link, size, price. Empty until a partner feed allows it | source | buy flow |
| `quality.score` | 0 to 1, how good it looks framed (a 1 to 5 review, scaled). Leans the pick 15% toward stronger photos | model | ranking |
| `provenance` | Who set each group | all | the tagging pipeline |

## Categories

abstract, aerial, architecture, beach, black and white, cars, city, coast, coffee, desert, dogs, drinks, film, flowers, food, golf, graphic, horses, lines, moon, objects, palm springs, pool, sailing, sculpture, shadows, ski, sky, surf, tennis, water, western.

Themes group them for taste, so a pick for a tennis court also says something about pools:

| Theme | Categories |
|---|---|
| summer | pool, coast, beach, palm springs, film |
| sport | tennis, surf, sailing, golf, ski |
| city | city, architecture, cars |
| nature | aerial, desert, water, sky, moon, flowers, shadows |
| still life | food, drinks, coffee, objects, sculpture |
| art | abstract, graphic, lines |
| animals | dogs, horses, western |
| mono | black and white |

## Shop feeds (real prints)

When a shop approves Walldrobe as an affiliate, its network (Impact, CJ, Awin or Sovrn) gives a product feed: a CSV or TSV of every product with its link, image, price and size.

1. Download the feed as CSV or TSV.
2. `node tools/import_feed.mjs feed.csv --merchant minted` writes `tools/feeds/minted.tsv`: one row per artwork, every size and frame option folded in as offers. It drops anything that isn't wall art (mugs, pillows, cards), sold-out pieces, plain http links and pieces with no artist. If a column has an odd name, map it: `--map title=product name,url=buy link`.
3. `python3 tools/analyze.py <cache>` measures each image (colors, shape, weight) from a cached copy that never ships. The record shows the shop's own image link, its real sizes and prices, and `offers` for the buy buttons.
4. Every new piece stays `hidden` until it has a line in `tools/tags.json`. Look at each one (contact sheets, same as the photos), tag it, and hide anything weak or a near-duplicate.

For the beta, `tools/feeds/desenio.tsv` was read from Desenio's product pages (each page carries its sizes and prices as schema.org data) in a real browser, not from an affiliate feed. Same file format, same rules.

Credit reads "Art by {artist}, sold by {shop}". `rights.sell` stays false: the shop sells, Walldrobe links.

## Rules for adding art

- `rights.show` must be true, with a license we can point to. Unsplash+ premium photos are not free and never go in. Pexels and Pixabay are fine under their own licenses; no 3D renders or AI images.
- No images from museum or library archives in the demo (Jason: modern art and photos only).
- No logos or readable brand names as the subject, no interiors, no stock-office shots.
- No more than about 35 pieces of one category, and near-duplicates get `hide` in tools/tags.json so they never show.
- Every new piece is looked at before it ships: a line in tools/tags.json with description, subjects, mood, style, rooms, people, setting, time, season, vibe and quality.
- A record that fails `validateRecord` doesn't ship; the build stops.
