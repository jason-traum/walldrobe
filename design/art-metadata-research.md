# Art metadata and gallery wall design: research for Walldrobe (Oct 4, 2026)

Why: Jason, "we prob need more options for like art? more metrics?... digging into design and gallery wall making research", then "we may already have the adequate metadata". This is the research and what's worth doing next; nothing here is built yet unless it says so.

## How art sites describe art
- Artsy's Art Genome Project: genes in families (subject, styles and movements, design movements, visual qualities, medium and techniques, regions), each 0 to 100. https://en.wikipedia.org/wiki/The_Art_Genome_Project
- Minted filters: orientation, pairs and sets, room, palette, medium, style. https://www.minted.com/art ; Desenio: style, room, subject (black and white, vintage, maps and cities). https://desenio.com/posters-prints/ ; Getty AAT facets. https://en.wikipedia.org/wiki/Art_%26_Architecture_Thesaurus

## Fields worth adding (most can be filled automatically)
| Field | Values | Fill |
|---|---|---|
| color_mode | bw, monochrome, muted, full | measured |
| palette_family | neutral, earth, ocean, sage, pastel, jewel, primary, neon | measured |
| accent_hue | the strongest saturated minority color, or none | measured |
| representation | abstract, semi-abstract, figurative | image model, checked by eye |
| look_medium | color photo, bw photo, painterly, line or graphic, typographic | image model, checked by eye |
| text_present | none, small, dominant | OCR |
| era_feel | contemporary, vintage, mid-century, deco | image model, checked by eye |
| line_character | geometric, mixed, organic | measured (edges) |
| detail_scale | fine, medium, bold | measured (edge energy at several scales) |
| novelty | 0 to 1, distance from its theme's center | image features |
| interior_fit | 0 to 100 per interior style | rule table over the above |
| set_id | a designed pair or set | by hand |

Interior styles and the art that fits them: mid-century (geometric, retro abstracts), Scandinavian and minimal (one large piece, black and white or monochrome, line drawings, muted botanicals), Japandi (minimal line, organic abstracts, earth tones), boho (warm earthy abstracts, botanicals, textural photos), coastal (beach and ocean, blues and sand), farmhouse (botanicals), industrial (maps, bold lettering, pop), traditional (black and white photos, pastoral landscapes), maximalist (big bold abstracts, oversized botanicals), Mediterranean (terracotta, ochre, sea blue, lemons, harbors). https://www.phaidon.com/en-gb/blogs/artspace/pair-artworks-with-your-favorite-decorating-styles , https://oliveetoriel.com/pages/interior-design-styles-wall-art-guide , https://stoneandgray.co.za/blogs/news/what-is-mediterranean-art

## Wall-level rules designers use
1. A common thread: one thing every piece shares (frame finish, medium, palette or style). https://www.homesandgardens.com/interior-design/gallery-wall-mistakes
2. One unifying detail, the rest can vary; when medium or style varies a lot, keep one frame finish. https://montcarta.com/blogs/articles/how-to-create-a-gallery-wall
3. A color family that shows up in at least half the pieces. https://oliveetoriel.com/blogs/on-the-wall/gallery-walls-with-abstract-art-the-complete-composition-method
4. An accent color appears at least twice, never once (an analogy to Emily Henderson's metallic-frame rule; a hypothesis).
5. At most black, white and one wood frame, plus a metallic only if used twice or more (Henderson).
6. Color pieces stay in a narrow range of saturation and warmth. https://www.artfullywalls.com/artful-insights/7-tips-for-mixing-black-and-white-color-photos-on-a-gallery-wall
7. A quiet piece for every couple of busy ones; two busy pieces never side by side; black and white as resting points (MontCarta, Artfully Walls).
8. On a mixed wall, abstract is a third to a half of the pieces, spread out (Olive et Oriel).
9. Mostly black and white or mostly color, not half and half (Artfully Walls; weakly supported).
10. Scale: the anchor at least twice the smallest, three or more sizes, mixed orientations; in a column the biggest is never on top. https://www.framebridge.com/blogs/how-tos/how-to-build-a-column-gallery-wall
11. Heavier, darker pieces toward the center; strong colors spread, not all on one side (MontCarta).
12. Viewing distance: fine detail needs a bigger piece or a spot near seating; from 10 to 15 ft only a strong overall shape reads. https://montcarta.com/blogs/art-guide-inspiration/viewing-distance-guide-art-detail-room-size
Also: the room's palette pulls the art's; one wildcard piece per wall (Desenio; MAYA, most advanced yet acceptable, Hekkert et al. https://www.jimdavies.org/summaries/HekkertSneldersVanwieringen2003.html).

## What preference research says
- Typical and novel both predict liking; for art, novelty matters more. A per-person novelty dial.
- Complexity: no clean peak; learn each person's busyness preference (https://pmc.ncbi.nlm.nih.gov/articles/PMC5095118).
- Fractal dimension about 1.3 to 1.5 is widely preferred in nature images (https://www.mi.sanu.ac.rs/vismath/proceedings/taylor.htm).
- Curved over sharp (Bar and Neta 2006).
- Blues and cyans most liked, olive and brown least, driven by what the colors remind people of (Palmer and Schloss 2010, https://palmerlab.berkeley.edu/pdf/Palmer%26Schloss%282010%29.pdf); only a cold-start prior.
- Openness predicts liking abstract work; one "real or abstract" question captures most of it (https://www.bps.org.uk/psychologist/personality-and-art).
- "If you don't love a piece enough on its own, it falls short in a gallery wall" (Apartment Therapy): taste for each piece outweighs filler that only fits.

## Questions worth asking people
How should the room feel; the room's style; real scenes or abstract; color level; safe or surprising; frames all the same or mixed; what you love looking at; busy or quiet art.

## What Walldrobe already covers
Scale to furniture, center height, spacing, structured vs loose, color harmony, look-alikes, mats, frame color, taste (with image features), black and white vs color in taste, busyness.

## Next, smallest first (not built)
1. Wall rules 1, 3, 7 and 11 as scoring terms: measured fields only, no new tagging.
2. color_mode, palette_family, accent_hue and detail_scale computed from what's measured.
3. Interior style as a Preferences choice, from a rule table.
