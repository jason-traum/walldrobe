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
| `rights.sell` | May we sell prints of it. `false` for all Unsplash art | source | buy flow |
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
| `tags.subjects` | What's in it, plain nouns | rule, then model | search, reasons |
| `tags.mood` | Any of: sunny, calm, moody, bold, playful, elegant | rule from measurements | taste |
| `tags.style` | Any of: minimal, graphic, aerial, film, documentary, painterly, still life, portrait | rule | taste |
| `tags.people` | Anyone in it (rule: category, or a word like swimmer or rider in the title) | rule, then human | taste, filters |
| `tags.rooms` | Where it would sit well: living room, bedroom, kitchen, bathroom, entry, office | rule | filters |
| `sizes` | Standard outer frame sizes this image fits with a mat (shape within 14%). If none fits, the nearest size with `crop: true` | rule | layout |
| `offers` | Places to buy a print: vendor, link, size, price. Empty until a partner feed allows it | source | buy flow |
| `quality.score` | 0 to 1, how good a pick it is. Empty until reviewed | human or model | ranking |
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

## Rules for adding art

- `rights.show` must be true, with a license we can point to. Unsplash+ premium photos are not free and never go in.
- No images from museum or library archives in the demo (Jason: modern art and photos only).
- No logos or readable brand names as the subject, no interiors, no stock-office shots.
- No more than about ten pieces of one subject (ten horses is a horse store).
- A record that fails `validateRecord` doesn't ship; the build stops.
