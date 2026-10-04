"""Read Juniper Print Shop prints into tools/feeds/juniper.tsv (beta, link out only).

Juniper Print Shop runs on Shopify: /products.json lists every product. This keeps
prints (not bundles or frames), leaves out vintage reproductions (the demo is modern art
and photos), and writes one row per artwork in the tools/feeds format: id, artist, page,
title, medium, category, image url, offers (JSON). The category is a first guess from
the shop's tags; looking at each piece (tools/tags.json) corrects it. Images stay on the
shop's CDN.

Usage: python3 tools/fetch_juniper.py
"""
import json, os, re, time, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "tools", "feeds", "juniper.tsv")
SHOP = "https://juniperprintshop.com"
OLD = re.compile(r"vintage|antique|old master|public domain|19th|18th|century|victorian|renaissance|baroque|classic painting", re.I)
# Shop tag words -> Walldrobe category, first match wins.
GUESS = [
    ("abstract", "abstract"), ("line", "lines"), ("geometric", "graphic"), ("mid century", "graphic"),
    ("flower", "flowers"), ("floral", "flowers"), ("botanical", "flowers"), ("tulip", "flowers"),
    ("beach", "beach"), ("ocean", "water"), ("sea", "coast"), ("coast", "coast"), ("lake", "water"),
    ("desert", "desert"), ("cactus", "desert"), ("mountain", "landscape"), ("landscape", "landscape"), ("field", "landscape"), ("tree", "landscape"),
    ("city", "city"), ("architecture", "architecture"), ("house", "architecture"),
    ("dog", "dogs"), ("horse", "horses"), ("cowboy", "western"), ("western", "western"),
    ("food", "food"), ("fruit", "food"), ("lemon", "food"), ("coffee", "coffee"), ("cocktail", "drinks"), ("wine", "drinks"),
    ("figure", "figure"), ("woman", "figure"), ("portrait", "figure"), ("nude", "figure"),
    ("still life", "objects"), ("vase", "objects"), ("moon", "moon"), ("sky", "sky"), ("cloud", "sky"),
    ("golf", "golf"), ("tennis", "tennis"), ("ski", "ski"), ("surf", "surf"), ("sail", "sailing"), ("pool", "pool"),
]
SIZE = re.compile(r"(\d+)\s*x\s*(\d+)")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Walldrobe beta; links to the shop)"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def main():
    rows, page = [], 1
    while True:
        ps = get(f"{SHOP}/products.json?limit=250&page={page}").get("products", [])
        if not ps: break
        for p in ps:
            if p.get("product_type") not in ("Horizontal", "Vertical", "Square"): continue
            text = " ".join([p["title"], " ".join(p.get("tags", []))])
            if OLD.search(text) or not p.get("images") or (p.get("vendor") or "").strip().lower() == "vintage": continue
            offers = []
            for v in p["variants"]:
                if not v.get("available", True): continue
                kind = v["title"].split(" / ")[0].strip().lower()
                m = SIZE.search(v["title"])
                if not m or kind not in ("paper", "framed", "framed paper"): continue
                a, b = int(m.group(1)), int(m.group(2))
                w, h = (b, a) if p["product_type"] == "Horizontal" else (a, b)
                offers.append({"vendor": "juniper", "url": f"{SHOP}/products/{p['handle']}?variant={v['id']}", "price": float(v["price"]),
                               "currency": "USD", "framed": kind != "paper", "w": w, "h": h, "label": v["title"]})
            if not offers: continue
            low = text.lower()
            category = next((c for k, c in GUESS if k in low), "landscape")
            medium = "photo" if "photo" in low else "print"
            img = p["images"][0]["src"]
            img += ("&" if "?" in img else "?") + "width=560"
            pid = "jp-" + re.sub(r"[^a-z0-9-]", "", p["handle"])[:44]
            artist = p.get("vendor") or "Juniper Print Shop"
            rows.append([pid, artist, f"{SHOP}/products/{p['handle']}", p["title"].strip(), medium, category, img, json.dumps(offers, separators=(",", ":"))])
        page += 1
        time.sleep(1)
    with open(OUT, "w") as f:
        f.write("# Juniper Print Shop prints, read from juniperprintshop.com product lists (beta, link out only): id, artist, page, title, medium, category, image url, offers (JSON)\n")
        for r in rows: f.write("\t".join(x.replace("\t", " ").replace("\n", " ") for x in r) + "\n")
    print("wrote", OUT, len(rows))


if __name__ == "__main__":
    main()
