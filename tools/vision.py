"""Look at every catalog image once with open image models and write tools/vision.json.

For each piece:
  aesthetic   how good it looks, 0 to 1 (its rank in the catalog), from the LAION
              aesthetic predictor on CLIP ViT-L/14 image features
  art         how much it looks like art rather than a stock photo, 0 to 1 (rank),
              from CLIP: "a fine art print" against "a generic stock photo"
  concepts    how strongly it reads as each of a few dozen plain ideas (retro, moody,
              botanical...), as a z-score across the catalog, from CLIP text prompts
  embed       the image's CLIP features squeezed to a few numbers (PCA), so the taste
              model can learn likes the words don't cover

Free, open models, run once offline. The engine reads the numbers; it never runs a
model. Usage: python3 tools/vision.py [cache dir] [--feed tools/feeds/x.tsv]
With --feed, it scores a shop feed's rows instead (before they're in the catalog) and
writes tools/vision_candidates_<shop>.json: how good each looks and how much it reads as art,
so only the strong ones get looked at and tagged. The image features are cached either way.
Needs: torch (CPU is fine), open_clip_torch, numpy, pillow.
"""

import io
import json
import os
import sys
import urllib.request

import numpy as np
import open_clip
import torch
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
FEED = sys.argv[sys.argv.index("--feed") + 1] if "--feed" in sys.argv else None
if FEED in ARGS: ARGS.remove(FEED)
CACHE = ARGS[0] if ARGS else os.path.join(ROOT, ".vision-cache")
os.makedirs(os.path.join(CACHE, "img"), exist_ok=True)

AES_URL = "https://huggingface.co/camenduru/improved-aesthetic-predictor/resolve/main/sac%2Blogos%2Bava1-l14-linearMSE.pth"
EMBED_DIMS = 8

# Plain ideas a person might like or not. The key is what the app shows; the prompts
# are what CLIP compares the image with (averaged).
CONCEPTS = {
    "retro": ["a retro vintage style picture", "a picture with a 1970s retro look"],
    "minimal": ["a minimalist picture, simple and clean", "a minimal composition with lots of empty space"],
    "moody": ["a dark and moody picture", "a moody atmospheric image"],
    "playful": ["a playful and fun picture", "a cheerful whimsical picture"],
    "serene": ["a calm and serene picture", "a peaceful quiet scene"],
    "energetic": ["an energetic dynamic picture full of motion", "an action shot"],
    "dreamy": ["a soft dreamy hazy picture", "a dreamlike ethereal image"],
    "gritty": ["a gritty urban street photo", "a raw gritty picture"],
    "elegant": ["an elegant sophisticated picture", "a refined classy image"],
    "cozy": ["a warm cozy homey picture", "a cozy interior scene"],
    "surreal": ["a surreal strange picture", "a surrealist artwork"],
    "film": ["a nostalgic film photograph with grain", "an analog film photo"],
    "graphic": ["a bold graphic design poster", "a graphic illustration with flat shapes"],
    "botanical": ["a botanical picture of plants and flowers", "a botanical illustration"],
    "architecture": ["a photo of architecture and buildings", "architectural lines and structures"],
    "coastal": ["a beach and ocean picture", "a coastal seaside scene"],
    "mountains": ["a mountain landscape", "a wild landscape with mountains and sky"],
    "pastel": ["a picture in soft pastel colors", "pale pastel tones"],
    "earthy": ["a picture in earthy natural tones", "warm browns and terracotta tones"],
    "neon": ["a picture with neon bright saturated colors", "electric vivid colors"],
    "textured": ["a painting with rich texture and brushstrokes", "a textured artwork"],
    "geometric": ["an artwork of geometric shapes", "a pattern of lines and shapes"],
    "cinematic": ["a cinematic picture like a film still", "a dramatic cinematic scene"],
    "fashion": ["a fashion editorial photo", "a stylish fashion photograph"],
    "witty": ["a witty humorous picture", "a funny clever artwork"],
    "luxe": ["a luxurious glamorous picture", "a glamorous luxury scene"],
    "rustic": ["a rustic countryside picture", "a rural farmhouse scene"],
    "food": ["a picture of food and drink", "a still life of food"],
    "travel": ["a travel photo of a famous place", "a vacation postcard view"],
    "figure": ["a portrait of a person", "a picture of people"],
}
ART_PROMPTS = ["a fine art print for a gallery wall", "a beautiful art photograph", "a museum quality artwork"]
STOCK_PROMPTS = ["a generic stock photo", "a boring snapshot", "a low quality cheap image"]


class Aesthetic(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = torch.nn.Sequential(
            torch.nn.Linear(768, 1024), torch.nn.Dropout(0.2), torch.nn.Linear(1024, 128), torch.nn.Dropout(0.2),
            torch.nn.Linear(128, 64), torch.nn.Dropout(0.1), torch.nn.Linear(64, 16), torch.nn.Linear(16, 1))

    def forward(self, x):
        return self.layers(x)


def fetch(url, path):
    if os.path.exists(path):
        return path
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 walldrobe-vision"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    with open(path, "wb") as f:
        f.write(data)
    return path


def image_of(item):
    src = item["image"]["src"]
    if not src.startswith("http"):
        return Image.open(os.path.join(ROOT, "demo", src)).convert("RGB")
    p = fetch(src, os.path.join(CACHE, "img", item["id"] + ".jpg"))
    return Image.open(p).convert("RGB")


def rank01(v):
    order = np.argsort(np.argsort(v, kind="stable"), kind="stable")
    return order / max(1, len(v) - 1)


def main():
    torch.set_num_threads(os.cpu_count() or 2)
    if FEED:
        items = []
        for line in open(FEED):
            if line.startswith("#") or not line.strip(): continue
            f = line.rstrip("\n").split("\t")
            items.append({"id": f[0], "title": f[3], "category": f[5], "image": {"src": f[6]}})
    else:
        items = json.load(open(os.path.join(ROOT, "demo/catalog.json")))["items"]
    model, _, prep = open_clip.create_model_and_transforms("ViT-L-14-quickgelu", pretrained="openai")
    tok = open_clip.get_tokenizer("ViT-L-14-quickgelu")
    model.eval()

    feats_path = os.path.join(CACHE, "feats-quickgelu.npz")
    have = dict(np.load(feats_path)) if os.path.exists(feats_path) else {}
    todo = [it for it in items if it["id"] not in have]
    print(f"{len(items)} pieces, {len(todo)} to look at", flush=True)
    for i in range(0, len(todo), 16):
        batch, ids = [], []
        for it in todo[i:i + 16]:
            try:
                batch.append(prep(image_of(it)))
                ids.append(it["id"])
            except Exception as e:  # a gone image: skip it, the piece keeps its old numbers
                print("skip", it["id"], e, flush=True)
        if batch:
            with torch.no_grad():
                f = model.encode_image(torch.stack(batch)).float()
            f = f / f.norm(dim=-1, keepdim=True)
            for k, v in zip(ids, f.numpy()):
                have[k] = v
        np.savez(feats_path, **have)
        print(f"{min(i + 16, len(todo))}/{len(todo)}", flush=True)

    ids = [it["id"] for it in items if it["id"] in have]
    X = np.stack([have[k] for k in ids])

    aes = Aesthetic()
    aes.load_state_dict(torch.load(fetch(AES_URL, os.path.join(CACHE, "aesthetic.pth")), map_location="cpu"))
    aes.eval()
    with torch.no_grad():
        raw_aes = aes(torch.from_numpy(X)).squeeze(-1).numpy()

    def text(prompts):
        with torch.no_grad():
            t = model.encode_text(tok(prompts)).float()
        t = t / t.norm(dim=-1, keepdim=True)
        m = t.mean(0)
        return (m / m.norm()).numpy()

    art_raw = X @ text(ART_PROMPTS) - X @ text(STOCK_PROMPTS)
    if FEED:
        by = {it["id"]: it for it in items}
        out = {k: {"aestheticRaw": round(float(raw_aes[n]), 2), "artRaw": round(float(art_raw[n]), 4), "category": by[k]["category"], "title": by[k]["title"]} for n, k in enumerate(ids)}
        name = "tools/vision_candidates_%s.json" % os.path.basename(FEED).rsplit(".", 1)[0]
        with open(os.path.join(ROOT, name), "w") as f:
            json.dump(out, f, separators=(",", ":"))
        print("wrote", name, len(out), flush=True)
        return
    concept = {}
    for k, prompts in CONCEPTS.items():
        s = X @ text(prompts)
        concept[k] = (s - s.mean()) / (s.std() + 1e-9)

    Xc = X - X.mean(0)
    _, sv, vt = np.linalg.svd(Xc, full_matrices=False)
    P = Xc @ vt[:EMBED_DIMS].T
    P = P / (P.std(0) + 1e-9)

    a_rank, art_rank = rank01(raw_aes), rank01(art_raw)
    out = {"model": "CLIP ViT-L/14 quickgelu (OpenAI) + LAION improved aesthetic predictor", "concepts": list(CONCEPTS), "items": {}}
    for n, k in enumerate(ids):
        out["items"][k] = {
            "aesthetic": round(float(a_rank[n]), 3),
            "aestheticRaw": round(float(raw_aes[n]), 2),
            "art": round(float(art_rank[n]), 3),
            "concepts": [round(float(concept[c][n]), 2) for c in CONCEPTS],
            "embed": [round(float(x), 2) for x in P[n]],
        }
    with open(os.path.join(ROOT, "tools/vision.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote tools/vision.json", len(ids), flush=True)


if __name__ == "__main__":
    main()
