"""Build the demo catalog: one record per piece, in the shape CATALOG.md describes.

For every line in tools/picks.tsv (Unsplash), tools/picks_pexels.tsv and tools/picks_pixabay.tsv:
  - fetch the image from Unsplash (or reuse a cached copy),
  - measure color and composition (palette by k-means in Lab, brightness,
    contrast, saturation, colorfulness, warmth, busyness, negative space,
    focal point, symmetry, visual weight),
  - set first tags by rule (theme, style, rooms, people, mood), then lay over
    the tags written by looking at each image (tools/tags.json): a one-line
    description, subjects, mood, style, rooms, people, setting, time of day,
    season, vibe words, a 1 to 5 quality score, and hide for near-duplicates,
  - write a small image for the demo.

Usage: python3 tools/analyze.py [cache_dir]
Writes demo/catalog.json and demo/art/*.jpg. Same images in, same numbers out.
"""
import io, json, os, re, sys, urllib.request
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "demo")
CACHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".cache", "img")

# ---------- Sizes (matches engine/constants.js) ----------

PORTRAIT = [(8, 10), (11, 14), (12, 16), (16, 20), (18, 24), (24, 30), (24, 36), (30, 40)]
LANDSCAPE = [(h, w) for w, h in PORTRAIT]
SQUARE = [(12, 12), (16, 16), (20, 20), (30, 30)]

def sizes_for(aspect):
    # A mat takes up small differences, so a size fits when its shape is within 14%.
    pool = SQUARE if 0.9 <= aspect <= 1.1 else PORTRAIT if aspect < 1 else LANDSCAPE
    out = [(w, h) for w, h in pool if abs((w / h) / aspect - 1) <= 0.14]
    if out:
        return [{"w": w, "h": h} for w, h in out]
    # Nothing within 14%: the nearest size, with a slight crop, flagged.
    w, h = min(pool, key=lambda s: abs((s[0] / s[1]) / aspect - 1))
    return [{"w": w, "h": h, "crop": True}]

# ---------- Color science ----------

def rgb_to_lab(rgb):
    """rgb: (..., 3) floats 0..255 -> Lab (..., 3), D65."""
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)

def color_name(L, a, b):
    """Same thresholds as engine/color.js colorName."""
    C = float(np.hypot(a, b))
    h = float(np.degrees(np.arctan2(b, a))) % 360
    if L < 18: return "black"
    if C < 12: return "white" if L > 88 else "light gray" if L > 62 else "gray"
    if h >= 345 or h < 15: return "pink" if L > 70 else "red"
    if h < 50: return "brown" if (L < 50 and C < 45) else "pink" if L > 72 else "red"
    if h < 75: return "brown" if (L < 55 and C < 55) else "peach" if L > 82 else "orange"
    if h < 105: return "brown" if L < 45 else "ochre" if L < 65 else "yellow"
    if h < 170: return "green"
    if h < 225: return "teal"
    if h < 315: return "navy" if L < 22 else "light blue" if L > 75 else "blue"
    return "pink" if L > 72 else "purple"

def kmeans(X, k=6, iters=25):
    """Deterministic k-means: farthest-point init from the mean color."""
    centers = [X.mean(axis=0)]
    for _ in range(1, k):
        d = np.min([((X - c) ** 2).sum(axis=1) for c in centers], axis=0)
        centers.append(X[int(np.argmax(d))])
    C = np.array(centers)
    for _ in range(iters):
        lab = np.argmin(((X[:, None, :] - C[None, :, :]) ** 2).sum(axis=2), axis=1)
        newC = np.array([X[lab == j].mean(axis=0) if np.any(lab == j) else C[j] for j in range(k)])
        if np.allclose(newC, C): break
        C = newC
    counts = np.bincount(lab, minlength=k)
    return C, counts / counts.sum()

def lab_to_hex(L, a, b):
    fy = (L + 16) / 116; fx = fy + a / 500; fz = fy - b / 200
    def finv(t): return t ** 3 if t ** 3 > 216 / 24389 else (116 * t - 16) / (24389 / 27)
    x, y, z = finv(fx) * 0.95047, finv(fy), finv(fz) * 1.08883
    m = np.array([[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]])
    lin = m @ np.array([x, y, z])
    srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
    r, g, bb = (int(round(v)) for v in np.clip(srgb * 255, 0, 255))
    return "#%02X%02X%02X" % (r, g, bb)

# ---------- How much of each color ----------

FAMILIES = ["red", "pink", "orange", "yellow", "brown", "green", "teal", "blue", "purple", "black", "gray", "white"]

def families(L, A, B):
    """Per-pixel color family, the same thresholds as color_name, folded into 12 families."""
    C = np.hypot(A, B)
    h = np.degrees(np.arctan2(B, A)) % 360
    f = {n: i for i, n in enumerate(FAMILIES)}
    conds = [
        L < 18,
        C < 12,
        (h >= 345) | (h < 15),
        h < 50,
        h < 75,
        h < 105,
        h < 170,
        h < 225,
        h < 315,
    ]
    picks = [
        np.full(L.shape, f["black"]),
        np.where(L > 88, f["white"], f["gray"]),
        np.where(L > 70, f["pink"], f["red"]),
        np.where((L < 50) & (C < 45), f["brown"], np.where(L > 72, f["pink"], f["red"])),
        np.where((L < 55) & (C < 55), f["brown"], f["orange"]),
        np.where(L < 45, f["brown"], f["yellow"]),
        np.full(L.shape, f["green"]),
        np.full(L.shape, f["teal"]),
        np.full(L.shape, f["blue"]),
    ]
    return np.select(conds, picks, default=np.where(L > 72, f["pink"], f["purple"]))

def color_amounts(L, A, B):
    fam = families(L, A, B)
    counts = np.bincount(fam.ravel(), minlength=len(FAMILIES)) / fam.size
    shares = {n: round(float(c), 3) for n, c in zip(FAMILIES, counts) if c >= 0.005}
    tot = sum(shares.values())
    shares = {n: round(v / tot, 3) for n, v in shares.items()}
    C = np.hypot(A, B)
    h = np.degrees(np.arctan2(B, A)) % 360
    chromatic = C >= 12
    hist = np.zeros(12)
    if chromatic.any():
        np.add.at(hist, (h[chromatic] // 30).astype(int) % 12, C[chromatic])
        hist = hist / hist.sum()
    value = {"dark": float(np.mean(L < 35)), "mid": float(np.mean((L >= 35) & (L <= 70))), "light": float(np.mean(L > 70))}
    return {
        "shares": shares,
        "hues": [round(float(v), 3) for v in hist],
        "chromatic": round(float(chromatic.mean()), 3),
        "value": {k: round(v, 3) for k, v in value.items()},
    }

# ---------- Measurements ----------

def measure(img):
    small = img.convert("RGB").resize((160, int(round(160 * img.height / img.width))) if img.width >= img.height else (int(round(160 * img.width / img.height)), 160), Image.LANCZOS)
    rgb = np.asarray(small, dtype=np.float64)
    lab = rgb_to_lab(rgb)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    chroma = np.hypot(A, B)

    # Palette
    X = lab.reshape(-1, 3)
    C, w = kmeans(X, k=6)
    order = np.argsort(-w)
    palette = []
    kept = []
    for j in order:
        strong = np.hypot(C[j][1], C[j][2]) > 25
        if w[j] < (0.005 if strong else 0.02): continue
        hx = lab_to_hex(*C[j])
        # Name from the rounded hex, so the name matches what the engine computes from the same hex.
        rgbh = np.array([int(hx[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)
        palette.append({"hex": hx, "weight": round(float(w[j]), 3), "name": color_name(*rgb_to_lab(rgbh))})
        kept.append(j)
    # Accent: a small, strongly colored subject (a blue vase on white) that k-means
    # averages away. Take the mean of the clearly colored pixels and add it.
    colored = chroma > 12
    share = float(colored.mean())
    if share >= 0.01:
        acc = lab[colored].mean(axis=0)
        if all(np.linalg.norm(acc - C[j]) > 15 for j in kept) and len(palette) < 6:
            hx = lab_to_hex(*acc)
            rgbh = np.array([int(hx[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)
            palette.append({"hex": hx, "weight": round(max(share, 0.01), 3), "name": color_name(*rgb_to_lab(rgbh))})
            C = np.vstack([C, acc])
            kept.append(len(C) - 1)
    tot = sum(p["weight"] for p in palette)
    for p in palette: p["weight"] = round(p["weight"] / tot, 3)

    # Black and white only when almost no pixel has real color (a small blue vase is not black and white).
    bw = bool(np.mean(chroma) < 6 and np.percentile(chroma, 95) < 14 and np.mean(chroma > 15) < 0.005)
    if bw:
        dominant = "black and white"
    else:
        # The color a person names first: same-named colored clusters add up.
        by_name = {}
        for p, j in zip(palette, kept):
            if np.hypot(C[j][1], C[j][2]) > 18:
                by_name[p["name"]] = by_name.get(p["name"], 0) + p["weight"]
        best = max(sorted(by_name.items()), key=lambda kv: kv[1], default=None)
        neutral = sum(p["weight"] for p, j in zip(palette, kept) if np.hypot(C[j][1], C[j][2]) < 12)
        accents = sorted(((p["weight"], p["name"]) for p, j in zip(palette, kept) if np.hypot(C[j][1], C[j][2]) >= 12), reverse=True)
        if best and best[1] >= 0.1:
            dominant = best[0]
        elif accents and neutral >= 0.8:
            dominant = accents[0][1]  # a small colored subject on a plain ground: the blue vase is blue
        else:
            dominant = palette[0]["name"]

    # Colorfulness, Hasler and Susstrunk (2003), on 0..255 RGB
    rg = rgb[..., 0] - rgb[..., 1]
    yb = 0.5 * (rgb[..., 0] + rgb[..., 1]) - rgb[..., 2]
    colorful = np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)

    # Gradients on lightness
    gy, gx = np.gradient(L)
    grad = np.hypot(gx, gy)
    busy = float(np.clip(np.mean(grad > 6), 0, 1))

    # Negative space: 8x8 blocks with little change
    h, wd = L.shape
    bh, bw_ = h // 8, wd // 8
    quiet = 0
    blocks = 0
    for i in range(0, h - bh + 1, bh):
        for j in range(0, wd - bw_ + 1, bw_):
            blk = L[i:i + bh, j:j + bw_]
            blocks += 1
            if blk.std() < 4 and grad[i:i + bh, j:j + bw_].mean() < 2.5: quiet += 1
    negative = quiet / max(1, blocks)

    # Focal point: where color differs most from the image's average, weighted by edges
    sal = np.sqrt(((lab - lab.reshape(-1, 3).mean(axis=0)) ** 2).sum(axis=2)) * (0.5 + grad / (grad.max() + 1e-9))
    sal = sal ** 2
    ys, xs = np.mgrid[0:h, 0:wd]
    fx = float((sal * xs).sum() / sal.sum() / (wd - 1))
    fy = float((sal * ys).sum() / sal.sum() / (h - 1))

    symmetry = float(1 - np.mean(np.abs(L - L[:, ::-1])) / 50)

    brightness = float(L.mean() / 100)
    contrast = float(np.clip(L.std() / 35, 0, 1))
    saturation = float(np.clip(chroma.mean() / 60, 0, 1))
    # Warmth by hue: reds, oranges and yellows count warm, blues and teals cool, greens and grays neither.
    hue = np.degrees(np.arctan2(B, A)) % 360
    sign = np.where((hue < 100) | (hue >= 330), 1.0, np.where((hue >= 170) & (hue < 300), -1.0, 0.0))
    wsum = chroma.sum()
    warmth = float(np.clip((chroma * sign).sum() / wsum * min(1.0, chroma.mean() / 20), -1, 1)) if wsum > 0 else 0.0
    colorfulness = float(np.clip(colorful / 110, 0, 1))
    weight = float(np.clip(0.55 * (1 - brightness) + 0.25 * saturation + 0.2 * busy, 0, 1))
    r = lambda v: round(float(v), 3)
    return {
        "color": {"palette": palette, "dominant": dominant, "bw": bw, "brightness": r(brightness), "contrast": r(contrast),
                  "saturation": r(saturation), "colorfulness": r(colorfulness), "warmth": r(warmth), **color_amounts(L, A, B)},
        "composition": {"busyness": r(busy), "negativeSpace": r(negative), "focal": {"x": r(fx), "y": r(fy)},
                        "symmetry": r(np.clip(symmetry, 0, 1)), "weight": r(weight)},
    }

# ---------- Tag rules ----------

THEMES = {
    "summer": ["pool", "coast", "beach", "palm springs", "film"],
    "sport": ["tennis", "surf", "sailing", "golf", "ski"],
    "city": ["city", "architecture", "cars"],
    "nature": ["aerial", "landscape", "desert", "water", "sky", "moon", "flowers", "shadows"],
    "still life": ["food", "drinks", "coffee", "objects", "sculpture"],
    "art": ["abstract", "graphic", "lines", "figure"],
    "animals": ["dogs", "horses", "western"],
    "mono": ["black and white"],
}
THEME_OF = {c: t for t, cs in THEMES.items() for c in cs}
ROOMS = {
    "summer": ["living room", "bedroom", "bathroom"],
    "sport": ["living room", "office", "entry"],
    "city": ["living room", "office", "entry"],
    "nature": ["living room", "bedroom", "entry"],
    "art": ["living room", "bedroom", "office"],
    "animals": ["living room", "office", "entry"],
    "mono": ["living room", "bedroom", "office"],
}
STILL_ROOMS = {"food": ["kitchen"], "drinks": ["kitchen", "living room"], "coffee": ["kitchen", "office"], "objects": ["living room", "bedroom", "entry"], "sculpture": ["living room", "bedroom", "entry"]}
STYLE = {
    "aerial": ["aerial"], "pool": ["aerial", "graphic"], "golf": ["aerial"], "film": ["film"], "surf": ["film"],
    "graphic": ["graphic"], "shadows": ["graphic", "minimal"], "lines": ["graphic"], "architecture": ["graphic", "minimal"],
    "sky": ["minimal"], "water": ["minimal"], "moon": ["minimal"], "objects": ["still life", "minimal"], "sculpture": ["still life"],
    "food": ["still life"], "drinks": ["still life"], "coffee": ["still life", "minimal"], "dogs": ["portrait"],
    "abstract": ["painterly"], "landscape": ["painterly"], "figure": ["portrait"], "city": ["documentary"], "western": ["documentary"], "horses": ["documentary"],
    "cars": ["documentary"], "ski": ["documentary"], "sailing": ["documentary"], "tennis": ["graphic"],
    "coast": ["documentary"], "beach": ["graphic"], "palm springs": ["graphic"], "desert": ["minimal"], "flowers": ["still life"], "black and white": ["film"],
}
PEOPLE = {"film", "surf", "ski", "western"}
PEOPLE_WORDS = {"swimmer", "swimmers", "sitter", "sitters", "surfer", "surfers", "rider", "riders", "skier", "walker", "figure", "figures",
                "crew", "walking", "woman", "man", "cyclist", "reading", "portrait", "serve", "two", "people", "suit"}
STOP = {"a", "an", "the", "and", "on", "in", "of", "at", "by", "from", "with", "no", "to", "over", "under", "for", "two", "three", "five", "big", "small", "little", "open", "long"}
COLORS = {"red", "blue", "white", "black", "gray", "grey", "green", "yellow", "orange", "pink", "brown", "teal", "gold", "purple", "dark", "mono", "light"}

def tags_for(category, title, medium, m):
    theme = THEME_OF.get(category, "art")
    words = [w for w in re.findall(r"[a-z]+", title.lower()) if w not in STOP and w not in COLORS]
    subjects = list(dict.fromkeys([category] + words))[:4]
    c, k = m["color"], m["composition"]
    mood = []
    if c["brightness"] < 0.35: mood.append("moody")
    if c["brightness"] > 0.55 and (c["warmth"] > 0.05 or theme == "summer") and c["saturation"] > 0.12 and not c["bw"]: mood.append("sunny")
    if k["busyness"] < 0.2 and c["contrast"] < 0.6: mood.append("calm")
    if c["colorfulness"] > 0.45 or (c["contrast"] > 0.7 and c["saturation"] > 0.35): mood.append("bold")
    if c["bw"] or (c["saturation"] < 0.12 and c["contrast"] > 0.35): mood.append("elegant")
    if c["colorfulness"] > 0.4 and c["brightness"] > 0.5 and category in {"graphic", "dogs", "food", "pool", "palm springs"}: mood.append("playful")
    if not mood: mood.append("calm")
    style = list(STYLE.get(category, []))
    if medium == "painting" and "painterly" not in style: style.append("painterly")
    if c["bw"] and "film" not in style: style.append("film")
    rooms = STILL_ROOMS.get(category) if theme == "still life" else ROOMS.get(theme, ["living room"])
    people = category in PEOPLE or any(w in PEOPLE_WORDS for w in re.findall(r"[a-z]+", title.lower()))
    return {"theme": theme, "subjects": subjects, "mood": mood, "style": style, "people": people, "rooms": rooms}

# ---------- Main ----------

PROVIDERS = {
    # name: (license, license page, credit suffix, file of picks)
    "unsplash": ("Unsplash License", "https://unsplash.com/license", "on Unsplash", "picks.tsv"),
    "pexels": ("Pexels License", "https://www.pexels.com/license/", "on Pexels", "picks_pexels.tsv"),
    "pixabay": ("Pixabay Content License", "https://pixabay.com/service/license-summary/", "on Pixabay", "picks_pixabay.tsv"),
}

def fetch(key, url):
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, key + ".jpg")
    if not os.path.exists(fn):
        req = urllib.request.Request(url, headers={"User-Agent": "Walldrobe demo"})
        with urllib.request.urlopen(req, timeout=40) as r, open(fn, "wb") as f:
            f.write(r.read())
    return Image.open(fn).convert("RGB")

# Shops whose affiliate feeds we import (tools/feeds/<shop>.tsv, written by tools/import_feed.mjs).
SHOP_NAMES = {"minted": "Minted", "saatchiart": "Saatchi Art", "saatchi": "Saatchi Art", "society6": "Society6", "desenio": "Desenio",
              "juniqe": "JUNIQE", "artfinder": "Artfinder", "turningart": "TurningArt", "example": "Example Shop"}

def shop_picks():
    folder = os.path.join(ROOT, "tools", "feeds")
    if not os.path.isdir(folder): return
    for fname in sorted(os.listdir(folder)):
        if not fname.endswith(".tsv"): continue
        shop = fname[:-4]
        for line in open(os.path.join(folder, fname)):
            if line.startswith("#") or not line.strip(): continue
            pid, who, page, title, medium, category, url, offers = line.rstrip("\n").split("\t")
            yield {"provider": shop, "shop": SHOP_NAMES.get(shop, shop.title()), "imageId": pid, "key": pid, "id": pid, "who": who,
                   "page": page, "title": title, "medium": medium, "category": category, "url": url, "offers": json.loads(offers)}

def shop_sizes(offers, aspect):
    """The sizes the shop actually sells, cheapest price for each, flagged when the shape is off."""
    best = {}
    for o in offers:
        if not o.get("w"): continue
        w, h = o["w"], o["h"]
        if (w > h) != (aspect > 1) and abs(aspect - 1) > 0.1: w, h = h, w
        k = (w, h)
        if k not in best or (o.get("price") is not None and (best[k] is None or o["price"] < best[k])): best[k] = o.get("price")
    out = []
    for (w, h), price in sorted(best.items(), key=lambda x: x[0][0] * x[0][1]):
        s = {"w": w, "h": h}
        if price is not None: s["price"] = price
        if abs((w / h) / aspect - 1) > 0.14: s["crop"] = True
        out.append(s)
    return out or sizes_for(aspect)

def picks():
    """Every pick from every provider, as dicts."""
    yield from shop_picks()
    for provider, (_, _, _, fname) in PROVIDERS.items():
        path = os.path.join(ROOT, "tools", fname)
        if not os.path.exists(path): continue
        for line in open(path):
            if line.startswith("#") or not line.strip(): continue
            f = line.rstrip("\n").split("\t")
            if provider == "unsplash":
                pid, who, slug, title, medium, category = f
                yield {"provider": provider, "imageId": pid, "key": pid.split("/")[-1], "id": "u-" + pid.split("photo-")[-1][:13],
                       "who": who, "page": f"https://unsplash.com/photos/{slug}", "title": title, "medium": medium, "category": category,
                       "url": f"https://images.unsplash.com/{pid}?w=640&q=80&fm=jpg"}
            else:
                pid, who, page, title, medium, category, url = f
                tag = provider[:2]
                yield {"provider": provider, "imageId": pid, "key": f"{tag}-{pid}", "id": f"{tag}-{pid}", "who": who, "page": page,
                       "title": title, "medium": medium, "category": category, "url": url}

def merge_tags(rule, seen):
    """Tags from looking win over tags from rules; rules fill any gap."""
    out = dict(rule)
    for k in ("subjects", "mood", "style", "rooms", "people", "setting", "time", "season", "vibe"):
        if k in seen and seen[k] not in (None, [], ""):
            out[k] = seen[k]
    return out

def load_tags():
    """Tags written by looking at each image (tools/tags.json), keyed by record id."""
    path = os.path.join(ROOT, "tools", "tags.json")
    return json.load(open(path))["items"] if os.path.exists(path) else {}

def main():
    os.makedirs(os.path.join(OUT, "art"), exist_ok=True)
    looked = load_tags()
    records, seen = [], set()
    for p in picks():
        if p["id"] in seen: continue
        seen.add(p["id"])
        try:
            img = fetch(p["key"], p["url"])
        except Exception as e:
            print("SKIP", p["provider"], p["id"], p["title"], e, file=sys.stderr)
            continue
        m = measure(img)
        aspect = img.width / img.height
        name = p["key"] + ".jpg"
        shop = p.get("shop")
        if not shop:
            # Free photo sites allow a small copy; a shop's image is shown from the shop, never re-hosted.
            thumb = img.copy()
            thumb.thumbnail((360, 360), Image.LANCZOS)
            thumb.save(os.path.join(OUT, "art", name), quality=74, optimize=True, progressive=True)
            lic, lic_url, suffix, _ = PROVIDERS[p["provider"]]
        else:
            lic, lic_url = f"{shop} affiliate program", re.sub(r"^(https://[^/]+).*$", r"\1", p["page"])
        who = p["who"]
        tags = tags_for(p["category"], p["title"], p["medium"], m)
        seen_by = "rule"
        look = looked.get(p["id"])
        if look:
            tags = merge_tags(tags, look)
            seen_by = "model"
        rec = {
            "id": p["id"],
            # Nothing from a shop shows until someone has looked at it and tagged it.
            "status": "hidden" if (look and look.get("hide")) or (shop and not look) else "active",
            "title": p["title"],
            "medium": p["medium"],
            "category": p["category"],
            "artist": {"name": who},
            "source": {"provider": p["provider"], "page": p["page"], "imageId": p["imageId"], "license": lic, "licenseUrl": lic_url, **({"name": shop} if shop else {})},
            "rights": {"show": True, "sell": False, "credit": f"Art by {who}, sold by {shop}" if shop else f"Photo by {who} {suffix}"},
            "image": {"src": p["url"] if shop else f"art/{name}", "width": img.width, "height": img.height, "aspect": round(aspect, 4),
                      "orientation": "square" if 0.9 <= aspect <= 1.1 else "portrait" if aspect < 1 else "landscape"},
            **m,
            "tags": tags,
            "sizes": shop_sizes(p["offers"], aspect) if shop else sizes_for(aspect),
            "offers": p.get("offers", []),
            "quality": {"score": round((look["quality"] - 1) / 4, 2), "by": "model"} if look else {"score": None, "by": None},
            "provenance": {"source": "source", "image": "measured", "color": "measured", "composition": "measured",
                           "tags": seen_by, "sizes": "rule", "quality": "model" if look else None, "title": "human", "category": "human"},
        }
        if look and look.get("description"):
            rec["description"] = look["description"]
        records.append(rec)
        print(len(records), p["provider"], p["category"], p["title"], file=sys.stderr)
    with open(os.path.join(OUT, "catalog.json"), "w") as f:
        json.dump({"schema": "walldrobe.catalog/1", "source": "Unsplash, Pexels and Pixabay (each under its own license)", "items": records}, f, indent=1)

if __name__ == "__main__":
    main()
