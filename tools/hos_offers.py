"""Turn House of Spoils' real options into offers, in the feed and the catalog.

    python3 tools/hos_offers.py

Reads tools/feeds/houseofspoils_variants.json (from fetch_hos_variants.py). Each size
becomes up to two framed offers:
  - Border: the frame's outside (14.5 x 18.5 in for a Small) with the art inside a white
    mount (8 x 12 in), so it hangs matted;
  - Full Bleed: the art to the frame's edge, a smaller frame (9.5 x 13.5 in).
Each offer links to the Black frame and lists every frame color it comes in
(`colors`: black, white, oak for their Natural Wood), each with its own link. Prices
are the same in every color. "No Frame" is left out: its paper sizes take custom frames.

Rewrites the offers column of tools/feeds/houseofspoils.tsv, and the offers and sizes
of every House of Spoils record in demo/catalog.json (sizes by tools/analyze.py's
shop_sizes, so the next full analyze run gives the same).
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.argv = sys.argv[:1]
from analyze import shop_sizes  # noqa: E402

VAR = os.path.join(ROOT, "tools", "feeds", "houseofspoils_variants.json")
FEED = os.path.join(ROOT, "tools", "feeds", "houseofspoils.tsv")
CAT = os.path.join(ROOT, "demo", "catalog.json")
COLOR = {"Black": "black", "White": "white", "Natural Wood": "oak"}
MOUNT = {"Border": "border", "Full Bleed": "bleed", None: "border"}
ORDER = ["Small", "Medium", "Large", "Giant", "Collector", "Exhibition", "Specialty"]

def offers_for(v):
    sizes = v.get("sizes") or {}
    groups = {}
    for x in v["variants"]:
        c = COLOR.get(x["frame"])
        if not c or x["size"] not in sizes: continue
        groups.setdefault((x["size"], MOUNT.get(x["mount"], "border")), []).append((c, x))
    out = []
    for (size, kind), xs in sorted(groups.items(), key=lambda g: (ORDER.index(g[0][0]) if g[0][0] in ORDER else 99, g[0][1])):
        d = sizes[size].get(kind)
        if not d or not d.get("final") or not d.get("image"): continue
        (w, h), (iw, ih) = d["final"], d["image"]
        colors = {c: x["url"] for c, x in xs}
        main = dict(xs)["black"] if "black" in colors else xs[0][1]
        price = min(x["price"] for _, x in xs if x["price"] is not None)
        o = {"vendor": "houseofspoils", "url": main["url"], "price": price, "currency": "USD", "framed": True,
             "w": w, "h": h, "label": size if kind == "border" else f"{size}, full bleed", "colors": colors}
        if kind == "border" and iw < w and ih < h: o["mount"] = {"w": iw, "h": ih}
        out.append(o)
    return out

def main():
    var = json.load(open(VAR))
    lines, n_feed, n_skip = [], 0, 0
    for line in open(FEED):
        if line.startswith("#") or not line.strip():
            lines.append(line); continue
        cols = line.rstrip("\n").split("\t")
        v = var.get(cols[0])
        offers = offers_for(v) if v else []
        if offers:
            cols[7] = json.dumps(offers); n_feed += 1
        else:
            n_skip += 1
        lines.append("\t".join(cols) + "\n")
    open(FEED, "w").writelines(lines)

    cat = json.load(open(CAT))
    n_cat = 0
    for r in cat["items"]:
        if not r["id"].startswith("hos-"): continue
        v = var.get(r["id"])
        offers = offers_for(v) if v else []
        if not offers: continue
        r["offers"] = offers
        r["sizes"] = shop_sizes(offers, r["image"]["aspect"])
        r.pop("health", None)
        n_cat += 1
    json.dump(cat, open(CAT, "w"), indent=1)
    print(f"feed: {n_feed} pieces with real options, {n_skip} kept as they were; catalog: {n_cat} records updated")

if __name__ == "__main__":
    main()
