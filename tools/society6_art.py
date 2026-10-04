"""Point Society6 rows at the art alone, and say how wide each size's white border is.

Society6 prints every art print on paper with a white border built in: "Sizes listed
reflect overall paper dimensions, including a white border: 1" for X-Small and Small, 2"
for Medium and larger sizes" (each product page, Oct 2026). The listed size is the paper,
which is what goes in the frame; the art sits inside the border at its own shape.

The row's image link already asks Shopify's CDN for the paper on the 8 x 10 mockup
(tools/society6_boxes.py). This finds the art inside that paper and rewrites the link to
ask for the art's region instead, so the app draws the paper and border itself at the
true size for each print size. Each offer gets `margin`, the border in inches.

Art that fades into the paper at its edges can't be found by looking, so a box that
doesn't sit on the 1 in border on two opposite sides falls back to the border itself.
Only the link changes; nothing is copied. Usage: python3 tools/society6_art.py
"""
import io, json, os, re, urllib.request
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FEED = os.path.join(ROOT, "tools", "feeds", "society6.tsv")
SHADOW = 6     # px: the mockup's drop shadow along the paper's right and bottom edges
ON_EDGE = 0.2  # in: how near the 1 in border a side of the art has to be to count as on it


def margin_of(label):
    """The white border in inches, from the size's name on Society6."""
    return 1 if re.search(r"x-small|\bsmall\b", label, re.I) and not re.search(r"x-large", label, re.I) else 2


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Walldrobe beta; links to the shop)"})
    return np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert("RGB")).astype(int)


def art_box(base, x, y, w, h):
    """The art's box inside the paper, in the mockup's pixels, and how it was found."""
    a = get(base)[y:y + h - SHADOW, x:x + w - SHADOW]
    pw_px, ph_px = w - SHADOW, h - SHADOW
    land = pw_px > ph_px
    pw, ph = (10, 8) if land else (8, 10)  # the mockup is the 8 x 10
    ppi = (pw_px / pw + ph_px / ph) / 2
    paper = np.median(np.concatenate([a[:4].reshape(-1, 3), a[:, :4].reshape(-1, 3)]), 0)
    ink = np.abs(a - paper).sum(2) > 24
    r, c = np.where(ink.mean(1) > 0.02)[0], np.where(ink.mean(0) > 0.02)[0]
    rule = (round(ppi), round(ppi), pw_px - 2 * round(ppi), ph_px - 2 * round(ppi))
    if len(r) < 10 or len(c) < 10: return rule, "rule"
    l, rt = c[0] / ppi, (pw_px - 1 - c[-1]) / ppi
    t, b = r[0] / ppi, (ph_px - 1 - r[-1]) / ppi
    near = lambda v: abs(v - 1) <= ON_EDGE
    if not ((near(l) and near(rt)) or (near(t) and near(b))): return rule, "rule"
    # Two pixels in on each side, so no sliver of paper shows along the art's edge.
    return (int(c[0]) + 2, int(r[0]) + 2, int(c[-1] - c[0] + 1) - 4, int(r[-1] - r[0] + 1) - 4), "looked"


def main():
    lines = open(FEED).read().split("\n")
    rows = [l.split("\t") for l in lines if l and not l.startswith("#")]
    found = {"looked": 0, "rule": 0, "kept": 0}

    def one(f):
        url = f[6]
        offers = json.loads(f[7])
        for o in offers: o["margin"] = margin_of(o.get("label", ""))
        f[7] = json.dumps(offers, separators=(",", ":"))
        m = re.search(r"crop_left=(\d+)&crop_top=(\d+)&crop_width=(\d+)&crop_height=(\d+)", url)
        if not m or "&art=1" in url: return f, "kept"
        x, y, w, h = map(int, m.groups())
        base = url.split("&crop=")[0]
        (ax, ay, aw, ah), how = art_box(base, x, y, w, h)
        # &art=1 marks a link that already points at the art, so a second run leaves it.
        f[6] = f"{base}&crop=region&crop_left={x + ax}&crop_top={y + ay}&crop_width={aw}&crop_height={ah}&art=1"
        return f, how

    with ThreadPoolExecutor(6) as ex: done = list(ex.map(one, rows))
    by = {}
    for f, how in done: by[f[0]] = f; found[how] += 1
    out = [l if (not l or l.startswith("#")) else "\t".join(by[l.split("\t")[0]]) for l in lines]
    open(FEED, "w").write("\n".join(out))
    print("art found by looking", found["looked"], "by the 1 in border", found["rule"], "already done", found["kept"])


if __name__ == "__main__":
    main()
