"""Write tools/vision.json into demo/catalog.json as each record's `vision`.

How good a piece looks is ranked within its theme (posters against posters, black and
white against black and white), because the aesthetic model on its own favors landscapes
and marks down type and flat graphic prints that hang well. `looks` is the mean of that
rank and the art-not-stock rank, both within the theme. Usage: python3 tools/apply_vision.py
"""
import json, os
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CONCEPTS = ['retro', 'minimal', 'moody', 'playful', 'serene', 'energetic', 'dreamy', 'gritty', 'elegant', 'cozy', 'surreal', 'film',
            'graphic', 'botanical', 'architecture', 'coastal', 'mountains', 'pastel', 'earthy', 'neon', 'textured', 'geometric',
            'cinematic', 'fashion', 'witty', 'luxe', 'rustic', 'food', 'travel', 'figure']

def main():
    v = json.load(open(os.path.join(ROOT, "tools/vision.json")))
    assert v["concepts"] == CONCEPTS, "concept order differs from engine/taste.js VISION_CONCEPTS"
    path = os.path.join(ROOT, "demo/catalog.json")
    cat = json.load(open(path))
    groups = defaultdict(list)
    for r in cat["items"]:
        if r["id"] in v["items"]:
            groups[r["tags"]["theme"]].append(r)
    for th, rs in groups.items():
        def ranks(key):
            order = sorted(rs, key=lambda r: (v["items"][r["id"]][key], r["id"]))
            n = max(1, len(order) - 1)
            return {r["id"]: i / n for i, r in enumerate(order)}
        a, b = ranks("aestheticRaw"), ranks("art")
        for r in rs:
            x = v["items"][r["id"]]
            r["vision"] = {
                "aesthetic": round(a[r["id"]], 3),
                "art": round(b[r["id"]], 3),
                "looks": round((a[r["id"]] + b[r["id"]]) / 2, 3),
                "concepts": x["concepts"],
                "embed": x["embed"],
                "by": "clip-vit-l-14+laion-aesthetic",
            }
    with open(path, "w") as f:
        json.dump(cat, f, indent=1)
    print("vision on", sum(len(rs) for rs in groups.values()), "records")

if __name__ == "__main__":
    main()
