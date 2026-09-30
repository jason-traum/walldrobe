"""Build the demo art set from Unsplash photos listed in tools/picks.tsv.

Unsplash License: free to show, credit given, not sold. Each piece gets a small
image, its color palette, and the standard frame sizes its shape fits.
Run: python3 tools/build_catalog.py  (writes demo/catalog.json and demo/art/)
"""
import io, json, os, sys, urllib.request
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "demo")

PORTRAIT = [(8, 10), (11, 14), (12, 16), (16, 20), (18, 24), (24, 30), (24, 36), (30, 40)]
LANDSCAPE = [(h, w) for w, h in PORTRAIT]
SQUARE = [(12, 12), (16, 16), (20, 20), (30, 30)]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Walldrobe demo"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()

def palette(img, k=5):
    q = img.convert("RGB").resize((64, 64)).quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: k * 3]
    counts = sorted(q.getcolors(), reverse=True)
    total = sum(c for c, _ in counts)
    return [{"hex": "#%02X%02X%02X" % tuple(pal[i * 3: i * 3 + 3]), "weight": round(c / total, 3)} for c, i in counts]

def sizes_for(aspect):
    # A mat takes up small differences, so a size fits when its shape is within 14%.
    pool = SQUARE if 0.9 <= aspect <= 1.1 else PORTRAIT if aspect < 1 else LANDSCAPE
    out = [(w, h) for w, h in pool if abs((w / h) / aspect - 1) <= 0.14]
    if not out:
        out = [min(pool, key=lambda s: abs((s[0] / s[1]) / aspect - 1))]
    return [{"w": w, "h": h} for w, h in out]

def main():
    os.makedirs(os.path.join(OUT, "art"), exist_ok=True)
    items = []
    for line in open(os.path.join(ROOT, "tools", "picks.tsv")):
        if line.startswith("#") or not line.strip():
            continue
        pid, who, slug, title, medium, category = line.rstrip("\n").split("\t")
        name = pid.split("/")[-1] + ".jpg"
        img = Image.open(io.BytesIO(get(f"https://images.unsplash.com/{pid}?w=900&q=80&fm=jpg"))).convert("RGB")
        aspect = img.width / img.height
        img.thumbnail((420, 420))
        img.save(os.path.join(OUT, "art", name), quality=78, optimize=True, progressive=True)
        items.append({
            "id": "u-" + pid.split("photo-")[-1][:13],
            "title": title,
            "artist": who,
            "source": "Unsplash",
            "url": f"https://unsplash.com/photos/{slug}",
            "image": f"art/{name}",
            "medium": medium,
            "category": category,
            "aspect": round(aspect, 4),
            "palette": palette(img),
            "sizes": sizes_for(aspect),
        })
        print(len(items), category, title, file=sys.stderr)
    with open(os.path.join(OUT, "catalog.json"), "w") as f:
        json.dump({"source": "Unsplash (Unsplash License)", "items": items}, f, indent=1)

if __name__ == "__main__":
    main()
