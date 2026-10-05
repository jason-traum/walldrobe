"""Read Society6 art prints into tools/feeds/society6.tsv (beta, link out only).

Society6 runs on Shopify, so each collection lists its products as JSON at
/collections/<handle>/products.json. For each collection below, this reads the first
pages in the collection's own order, keeps Art Prints only, and writes one row per
artwork: id, artist, page, title, medium, category, image url, offers (JSON), the same
format as tools/feeds/desenio.tsv. Images stay on Society6's CDN: the row's image link
asks Shopify's CDN for the print alone, cut out of the white mockup (the print sits in
the same place on every 8x10 mockup). Nothing is copied to the site.

Rows already in the feed are kept exactly as they are (their image links and margins
were set by tools/society6_boxes.py and tools/society6_art.py), and pieces already scored
(tools/vision_candidates_society6.json) are not read again, though both count toward the
number read per collection. New pieces are added at the end as candidates; after scoring
and looking, only the keepers stay in the feed.

Usage: python3 tools/fetch_society6.py [per collection, default 120]
"""
import json, os, re, sys, time, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "tools", "feeds", "society6.tsv")
SCORED = os.path.join(ROOT, "tools", "vision_candidates_society6.json")
PER = int(sys.argv[1]) if len(sys.argv) > 1 else 120

# Society6 collection -> Walldrobe category.
COLLECTIONS = {
    "art-prints-abstract": "abstract", "art-prints-abstract-landscapes": "landscape", "art-prints-geometric": "graphic",
    "art-prints-mid-century-modern": "graphic", "art-prints-minimalist": "lines", "art-prints-line-art": "lines", "art-prints-line-drawing": "lines",
    "art-prints-botanical": "flowers", "art-prints-floral": "flowers", "art-prints-wildflower": "flowers", "art-prints-flower-market": "flowers",
    "art-prints-landscape": "landscape", "art-prints-mountains": "landscape", "art-prints-desert": "desert", "art-prints-southwestern": "desert",
    "art-prints-ocean": "water", "art-prints-ocean-waves": "water", "art-prints-beach": "beach", "art-prints-coastal": "coast", "art-prints-tropical": "coast",
    "art-prints-palm-trees": "palm springs", "art-prints-palm-springs": "palm springs", "art-prints-swimming-pool": "pool",
    "art-prints-surf": "surf", "art-prints-surfing": "surf", "art-prints-surfboard": "surf", "art-prints-sailboat": "sailing",
    "art-prints-golf": "golf", "art-prints-tennis": "tennis", "art-prints-ski": "ski",
    "art-prints-architecture": "architecture", "art-prints-city": "city", "art-prints-new-york-city": "city", "art-prints-paris": "city", "art-prints-italy": "coast",
    "art-prints-travel-poster": "graphic", "art-prints-retro-poster": "graphic",
    "art-prints-food": "food", "art-prints-food-photography": "food", "art-prints-cocktails": "drinks", "art-prints-bar-cart": "drinks", "art-prints-coffee": "coffee",
    "art-prints-dog": "dogs", "art-prints-horse": "horses", "art-prints-western": "western", "art-prints-cowboy": "western",
    "art-prints-moon-art": "moon", "art-prints-night-sky": "moon", "art-prints-cloud": "sky",
    "art-prints-black-and-white": "black and white", "art-prints-photography": "landscape", "art-prints-film-photography": "film", "art-prints-street-photography": "city",
    # Added Oct 4, 2026, for categories with few pieces.
    "art-prints-aerial": "aerial", "art-prints-swimming": "pool", "art-prints-beach-photography": "beach", "art-prints-sunset": "sky",
    "art-prints-wine": "drinks", "art-prints-martini": "drinks", "art-prints-lemon": "food", "art-prints-wabi-sabi": "abstract",
}
# Old masters resold as prints are left out (the demo is modern art and photos).
OLD = re.compile(r"matisse|van gogh|vangogh|monet|klimt|hokusai|mucha|renoir|cezanne|degas|hiroshige|audubon|kandinsky|william morris|"
                 r"public domain|vintage botanical|haeckel|redoute|rembrandt|vermeer|da vinci|botticelli|klee|munch|hopper|seurat|gauguin|turner", re.I)
# A first cut: where the print sits on the 8x10 white mockup. The keepers get their own
# paper box (portrait or landscape), found on the full mockup, before they ship.
CROP = "crop=region&crop_left=236&crop_top=195&crop_width=326&crop_height=408"
SIZE = re.compile(r'(\d+(?:\.\d+)?)"\s*x\s*(\d+(?:\.\d+)?)"')


def get(url):
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Walldrobe beta; links to the shop)"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except Exception as e:
            if i == 3: raise
            time.sleep(3 * (i + 1))


def row(p, category):
    if p.get("product_type") != "Art Print": return None
    title = re.sub(r"\s*Art Print$", "", p["title"]).strip()
    text = " ".join([title, p.get("vendor", ""), " ".join(p.get("tags", []))])
    if OLD.search(text): return None
    img = next((i["src"] for i in p.get("images", []) if "whitebg-8x10" in i["src"]), None)
    if not img: return None
    offers = []
    for v in p.get("variants", []):
        m = SIZE.search(v["title"])
        if not m or not v.get("available", True): continue
        w, h = float(m.group(1)), float(m.group(2))
        w, h = (int(w) if w.is_integer() else w), (int(h) if h.is_integer() else h)
        frame = v["title"].split(" / ")[0]
        offers.append({"vendor": "society6", "url": f"https://society6.com/products/{p['handle']}?variant={v['id']}", "price": float(v["price"]),
                       "currency": "USD", "framed": not frame.lower().startswith("no frame"), "w": w, "h": h, "label": v["title"]})
    if not offers: return None
    tags = " ".join(p.get("tags", [])).lower()
    medium = "photo" if ("photo" in tags or category in ("black and white", "film")) else "print"
    pid = "s6-" + re.sub(r"[^a-z0-9-]", "", p["handle"].replace("_art-print", ""))[:44]
    sep = "&" if "?" in img else "?"
    return [pid, p.get("vendor", "").strip() or "Society6 artist", f"https://society6.com/products/{p['handle']}", title, medium, category,
            img + sep + CROP, json.dumps(offers, separators=(",", ":"))]


def main():
    head, kept = None, []
    if os.path.exists(OUT):
        for line in open(OUT):
            if line.startswith("#"): head = line.rstrip("\n"); continue
            if line.strip(): kept.append(line.rstrip("\n").split("\t"))
    scored = set(json.load(open(SCORED))) if os.path.exists(SCORED) else set()
    rows, seen = [], set()
    have = {r[0] for r in kept} | {r[3].lower() for r in kept} | scored
    for handle, category in COLLECTIONS.items():
        got, page = 0, 1
        while got < PER and page <= 4:
            d = get(f"https://society6.com/collections/{handle}/products.json?limit=250&page={page}")
            ps = d.get("products", [])
            if not ps: break
            for p in ps:
                r = row(p, category)
                if not r or r[0] in seen or r[3].lower() in seen: continue
                seen.add(r[0]); seen.add(r[3].lower())
                got += 1
                # In the feed already, or scored before: counts toward this collection, not read again.
                if r[0] not in have and r[3].lower() not in have: rows.append(r)
                if got >= PER: break
            page += 1
            time.sleep(1)
        print(handle, got, flush=True)
    with open(OUT, "w") as f:
        f.write((head or "# Society6 art prints, read from society6.com product lists (beta, link out only): id, artist, page, title, medium, category, image url, offers (JSON)") + "\n")
        for r in kept + rows: f.write("\t".join(x.replace("\t", " ").replace("\n", " ") for x in r) + "\n")
    print("wrote", OUT, len(kept), "kept as they were,", len(rows), "new")


if __name__ == "__main__":
    main()
