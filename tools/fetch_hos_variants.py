"""Read every House of Spoils print's real options: size, frame color and mount.

    python3 tools/fetch_hos_variants.py [--limit N] [--only id,id]

House of Spoils sells each print in six sizes, each in a Black, White or Natural Wood
frame (or no frame), with a white border around the art ("Border") or the art to the
edge ("Full Bleed"). The border and full bleed versions of a size are different frames:
a Small with a border is 14.5 x 18.5 in outside with an 8 x 12 in image, the same Small
full bleed is 9.5 x 13.5 in. The product page lists both, per size, as Image and Final.

Writes tools/feeds/houseofspoils_variants.json, one entry per piece:
  { sizes: { Small: { border: {image, final}, bleed: {image, final}, unframed: {image, final} } },
    variants: [{ size, frame, mount, price, url }] }
Then tools/hos_offers.py turns it into offers. Reads the shop's public product JSON and
page, never its images. One request at a time, 400 ms apart.
"""
import html, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEED = os.path.join(ROOT, "tools", "feeds", "houseofspoils.tsv")
OUT = os.path.join(ROOT, "tools", "feeds", "houseofspoils_variants.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

args = sys.argv[1:]
def opt(k, d=None):
    return args[args.index(f"--{k}") + 1] if f"--{k}" in args else d
limit = int(opt("limit", "0") or 0)
only = set((opt("only", "") or "").split(",")) - {""}

def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:  # a 429 or a dropped connection: wait and try again
            if i == tries - 1: raise
            time.sleep(3 * (i + 1))

def dims(s):
    m = re.match(r"\s*([\d.]+)\s*x\s*([\d.]+)", s or "")
    return [float(m.group(1)), float(m.group(2))] if m else None

def sizes_from_page(page):
    u = html.unescape(page)
    m = re.search(r"metaFieldObject\s*=\s*(\{.*?\}\}\})", u)
    if not m: return None
    raw = json.loads(m.group(1))
    names = {"Mount": "border", "Full Bleed": "bleed", "No Frame": "unframed"}
    out = {}
    for kind, by in raw.items():
        for size, v in by.items():
            out.setdefault(size, {})[names.get(kind, kind)] = {"image": dims(v.get("Image")), "final": dims(v.get("Final"))}
    return out

def main():
    have = json.load(open(OUT)) if os.path.exists(OUT) else {}
    rows = [l.rstrip("\n").split("\t") for l in open(FEED) if l.strip() and not l.startswith("#")]
    todo = [r for r in rows if (not only or r[0] in only) and (only or r[0] not in have)]
    if limit: todo = todo[:limit]
    print(f"{len(todo)} to read, {len(have)} already read", file=sys.stderr)
    for n, r in enumerate(todo, 1):
        pid, page = r[0], r[2]
        try:
            prod = json.loads(get(page + ".json"))["product"]
            time.sleep(0.4)
            sizes = sizes_from_page(get(page))
        except Exception as e:
            print(f"{pid}: {e}", file=sys.stderr); time.sleep(2); continue
        names = [o["name"] for o in prod.get("options", [])]
        variants = []
        for v in prod["variants"]:
            vals = dict(zip(names, [v.get("option1"), v.get("option2"), v.get("option3")]))
            variants.append({"size": vals.get("Size"), "frame": vals.get("Frame"), "mount": vals.get("Mount"),
                             "price": float(v["price"]) if v.get("price") else None, "url": f"{page}?variant={v['id']}"})
        have[pid] = {"sizes": sizes, "variants": variants, "options": {o["name"]: o["values"] for o in prod.get("options", [])}}
        if n % 25 == 0:
            json.dump(have, open(OUT, "w"), indent=0)
            print(f"{n}/{len(todo)}", file=sys.stderr)
        time.sleep(0.4)
    json.dump(have, open(OUT, "w"), indent=0)
    print(f"done, {len(have)} pieces", file=sys.stderr)

if __name__ == "__main__":
    main()
