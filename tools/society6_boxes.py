"""Point Society6 rows at the print alone: find the paper on each white mockup.

Society6 shows an art print as paper with a white margin on a pale backdrop, the paper
portrait or landscape. This fetches each row's full 8x10 mockup, finds the paper (what
arrives and goes in the frame, margin and all) against the backdrop, and rewrites the
row's image link to ask Shopify's CDN for that region. Only the link changes; nothing is
copied. Usage: python3 tools/society6_boxes.py [ids.json] (default: every row)
"""
import io, json, os, sys, urllib.request
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
FEED = os.path.join(ROOT, "tools", "feeds", "society6.tsv")


def paper_box(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Walldrobe beta; links to the shop)"})
    a = np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert("RGB")).astype(int)
    edge = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    m = np.abs(a - np.median(edge, 0)).sum(2) > 30
    r, c = np.where(m.mean(1) > 0.04)[0], np.where(m.mean(0) > 0.04)[0]
    if len(r) < 40 or len(c) < 40: return None
    return int(c[0]), int(r[0]), int(c[-1] - c[0] + 1), int(r[-1] - r[0] + 1)


def main():
    only = set(json.load(open(sys.argv[1]))) if len(sys.argv) > 1 else None
    lines = open(FEED).read().split("\n")
    rows = [l.split("\t") for l in lines if l and not l.startswith("#")]
    todo = [f for f in rows if only is None or f[0] in only]
    def one(f):
        base = f[6].split("&crop=")[0]
        b = paper_box(base)
        if b:
            x, y, w, h = b
            f[6] = f"{base}&crop=region&crop_left={x + 1}&crop_top={y + 1}&crop_width={w - 2}&crop_height={h - 2}"
        return f
    with ThreadPoolExecutor(6) as ex: done = {f[0]: f for f in ex.map(one, todo)}
    out = [l if (not l or l.startswith("#")) else "\t".join(done.get(l.split("\t")[0], l.split("\t"))) for l in lines]
    open(FEED, "w").write("\n".join(out))
    print("boxed", len(done))


if __name__ == "__main__":
    main()
