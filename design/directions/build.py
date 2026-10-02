"""Mock three visual directions for Walldrobe v4 on the real engine's bedroom walls.
Usage: python3 build.py  -> d1-feed.html, d1-wall.html, ... (served from this folder)."""
import json, math, random, html

D = json.load(open('walls.json'))
WALL = D['wall']; WW, WH = WALL['width'], WALL['height']
OBS = D['obstacles']
GUMBALL = {'id': 'des-lindsey-cherek-still-life-with-gumba', 'own': False, 'title': 'Still Life with Gumball Machine',
           'img': 'https://media.desenio.com/site_images/685dec7e97bfddc5cb9dbd40_1715130261_pre0386-8.jpg?auto=compress%2Cformat&fit=max&w=640',
           'aspect': 0.7143, 'artist': 'Lindsey Cherek', 'shop': 'Desenio', 'price': 55.95}

def esc(s): return html.escape(str(s))
def inch(v):
    w = int(v + 1e-9); f = round((v - w) * 4); fr = ['', '¼', '½', '¾'][f % 4] if f < 4 else ''
    if f == 4: w += 1
    return f'{w}{fr}'
def money(v): return f'${v:,.2f}'

def first_wall():
    return D['walls'][0]

def hard_wall():
    w = json.loads(json.dumps(D['walls'][2]))
    for p in w['pieces']:
        if p['title'] == 'Peaches and Cream': p['kept'] = True
        if p['title'] == 'Swedish Cafe':
            p.update({k: GUMBALL[k] for k in ('id', 'title', 'img', 'aspect', 'artist', 'shop', 'price')})
    return w

# ---------- shared drawing helpers ----------
def top(p): return WH - p['y'] - p['h']

CLIP=[0]
def image(p, inset, clip_id):
    CLIP[0]+=1; clip_id=f'{clip_id}-{CLIP[0]}'
    x, y, w, h = p['x'] + inset, top(p) + inset, p['w'] - 2 * inset, p['h'] - 2 * inset
    return (f'<clipPath id="{clip_id}"><rect x="{x}" y="{y}" width="{w}" height="{h}"/></clipPath>'
            f'<image href="{esc(p["img"])}" x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#{clip_id})"/>')

def torn_tab(cx, cy, L, T, ang, rnd):
    """A strip of tape L long, T thick, centered at (cx, cy), rotated ang degrees, torn at both ends."""
    pts = []
    n = 4
    for i in range(n + 1):  # left torn end, top to bottom
        pts.append((-L / 2 + (rnd.random() * 0.22 * T if 0 < i < n else 0), -T / 2 + T * i / n))
    for i in range(n + 1):  # right torn end, bottom to top
        pts.append((L / 2 - (rnd.random() * 0.22 * T if 0 < i < n else 0), T / 2 - T * i / n))
    a = math.radians(ang)
    out = [(cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)) for x, y in pts]
    return ' '.join(f'{x:.2f},{y:.2f}' for x, y in out)

# ---------- furniture per direction ----------
def furniture(style):
    s = []
    for o in OBS:
        x, y, w, h = o['x'], WH - o['y'] - o['h'], o['w'], o['h']
        k = o['kind']
        if style == 'outline':
            st = 'fill="none" stroke="var(--furn-line)" stroke-width="1.1" vector-effect="non-scaling-stroke"'
            fill = 'fill="var(--furn-fill)" stroke="var(--furn-line)" stroke-width="1.1" vector-effect="non-scaling-stroke"'
            if k == 'headboard':
                s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h - 8}" rx="2.5" {fill}/>')
                s.append(f'<rect x="{x - 3}" y="{WH - 22}" width="{w + 6}" height="22" rx="2" {fill}/>')
                s.append(f'<rect x="{x + 7}" y="{WH - 27}" width="{w / 2 - 11}" height="7" rx="2.5" {fill}/>')
                s.append(f'<rect x="{x + w / 2 + 4}" y="{WH - 27}" width="{w / 2 - 11}" height="7" rx="2.5" {fill}/>')
            elif k == 'lamp':
                s.append(f'<path d="M{x + 1.5} {y + 10} L{x + 3.2} {y} L{x + w - 3.2} {y} L{x + w - 1.5} {y + 10} Z" {fill}/>')
                s.append(f'<line x1="{x + w / 2}" y1="{y + 10}" x2="{x + w / 2}" y2="{WH}" {st}/>')
                s.append(f'<line x1="{x + 2}" y1="{WH}" x2="{x + w - 2}" y2="{WH}" {st}/>')
            elif k == 'dresser':
                s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h - 3}" rx="1" {fill}/>')
                for i in (1, 2):
                    s.append(f'<line x1="{x + 2}" y1="{y + (h - 3) * i / 3}" x2="{x + w - 2}" y2="{y + (h - 3) * i / 3}" {st}/>')
                s.append(f'<line x1="{x + 1.5}" y1="{WH - 3}" x2="{x + 1.5}" y2="{WH}" {st}/><line x1="{x + w - 1.5}" y1="{WH - 3}" x2="{x + w - 1.5}" y2="{WH}" {st}/>')
            elif k == 'switch':
                s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="0.4" {fill}/>')
        elif style == 'room':
            if k == 'headboard':
                s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h - 6}" rx="1.5" fill="var(--wood)"/>')
                s.append(f'<rect x="{x + 1.5}" y="{y + 1.5}" width="{w - 3}" height="{h - 9}" rx="1" fill="var(--wood-2)"/>')
                s.append(f'<rect x="{x - 3}" y="{WH - 21}" width="{w + 6}" height="17" rx="2.5" fill="var(--linen)"/>')
                s.append(f'<rect x="{x - 3}" y="{WH - 12}" width="{w + 6}" height="8" rx="1" fill="var(--linen-2)"/>')
                s.append(f'<rect x="{x - 2}" y="{WH - 4}" width="{w + 4}" height="4" fill="var(--wood)"/>')
                s.append(f'<rect x="{x + 6}" y="{WH - 27}" width="{w / 2 - 10}" height="8" rx="3.5" fill="var(--pillow)"/>')
                s.append(f'<rect x="{x + w / 2 + 4}" y="{WH - 27}" width="{w / 2 - 10}" height="8" rx="3.5" fill="var(--pillow)"/>')
            elif k == 'lamp':
                s.append(f'<path d="M{x + 1.5} {y + 10} L{x + 3.2} {y} L{x + w - 3.2} {y} L{x + w - 1.5} {y + 10} Z" fill="var(--shade)"/>')
                s.append(f'<rect x="{x + w / 2 - 0.4}" y="{y + 10}" width="0.8" height="{WH - y - 10}" fill="var(--metal)"/>')
                s.append(f'<rect x="{x + 2.5}" y="{WH - 1}" width="{w - 5}" height="1" rx="0.5" fill="var(--metal)"/>')
            elif k == 'dresser':
                s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h - 3}" rx="0.8" fill="var(--wood)"/>')
                for i in (1, 2):
                    s.append(f'<rect x="{x + 1.2}" y="{y + (h - 3) * i / 3 - 0.25}" width="{w - 2.4}" height="0.5" fill="var(--wood-2)"/>')
                s.append(f'<rect x="{x + 1}" y="{WH - 3}" width="1.2" height="3" fill="var(--wood)"/><rect x="{x + w - 2.2}" y="{WH - 3}" width="1.2" height="3" fill="var(--wood)"/>')
            elif k == 'switch':
                s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="0.4" fill="#F7F6F2" stroke="#D8D5CE" stroke-width="0.2"/>')
    return ''.join(s)

# ---------- the three drawings ----------
def draw_tape(wall, px_per_in, seed=3):
    """D1: new prints taped up unframed with readable corner tabs; yours framed."""
    rnd = random.Random(seed)
    s = [f'<rect width="{WW}" height="{WH}" fill="var(--wall)"/>',
         f'<rect y="{WH - 1.2}" width="{WW}" height="1.2" fill="var(--floor)"/>', furn_flat()]
    tabT = max(1.41, 5 / px_per_in); tabL = max(3.2, 15 / px_per_in)  # the real roll's width, never under 5 px on screen
    for i, p in enumerate(wall['pieces']):
        x, y, w, h = p['x'], top(p), p['w'], p['h']
        if p['own']:
            f = max(0.9, 2.2 / px_per_in)
            s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="var(--frame)"/>')
            s.append(f'<rect x="{x + f}" y="{y + f}" width="{w - 2 * f}" height="{h - 2 * f}" fill="var(--mat)"/>')
            s.append(image(p, f + min(w, h) * 0.09, f'c{i}'))
        else:
            s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="var(--paper)"/>')
            s.append(image(p, min(w, h) * 0.045, f'c{i}'))
            col = 'var(--tape-keep)' if p.get('kept') else 'var(--tape-strip)'
            for cx, ang in ((x, -42 + rnd.uniform(-5, 5)), (x + w, 42 + rnd.uniform(-5, 5))):
                s.append(f'<polygon points="{torn_tab(cx, y, tabL, tabT, ang, rnd)}" fill="{col}"/>')
            if h > 20:
                for cx, ang in ((x, 42 + rnd.uniform(-5, 5)), (x + w, -42 + rnd.uniform(-5, 5))):
                    s.append(f'<polygon points="{torn_tab(cx, y + h, tabL, tabT, ang, rnd)}" fill="{col}"/>')
    return ''.join(s)

def draw_plan(wall, px_per_in):
    """D2: a hanging plan. Grid, outlined furniture, dashed proposals, solid settled frames, dimensions, nails."""
    u = 1 / px_per_in
    s = [f'<rect width="{WW}" height="{WH}" fill="var(--paper)"/>']
    for gx in range(12, WW, 12): s.append(f'<line x1="{gx}" y1="0" x2="{gx}" y2="{WH}" stroke="var(--grid)" stroke-width="{0.8 * u}"/>')
    for gy in range(12, WH, 12): s.append(f'<line x1="0" y1="{WH - gy}" x2="{WW}" y2="{WH - gy}" stroke="var(--grid)" stroke-width="{0.8 * u}"/>')
    s.append(f'<line x1="0" y1="{WH}" x2="{WW}" y2="{WH}" stroke="var(--ink)" stroke-width="{2 * u}"/>')
    s.append(furniture('outline'))
    ps = wall['pieces']
    for i, p in enumerate(ps):
        x, y, w, h = p['x'], top(p), p['w'], p['h']
        s.append(image(p, 0, f'c{i}'))
        settled = p['own'] or p.get('kept')
        dash = '' if settled else f'stroke-dasharray="{4 * u} {2.5 * u}"'
        col = 'var(--ink)' if p['own'] else ('var(--keep)' if p.get('kept') else 'var(--propose)')
        s.append(f'<rect x="{x - 1.2 * u}" y="{y - 1.2 * u}" width="{w + 2.4 * u}" height="{h + 2.4 * u}" fill="none" stroke="{col}" stroke-width="{1.6 * u}" {dash}/>')
        # nail: a small cross 2 in below the top, centered
        nx, ny, r = x + w / 2, y + 2, 2.6 * u
        s.append(f'<path d="M{nx - r} {ny - r} L{nx + r} {ny + r} M{nx + r} {ny - r} L{nx - r} {ny + r}" stroke="var(--nail)" stroke-width="{1.4 * u}"/>')
    x0 = min(p['x'] for p in ps); x1 = max(p['x'] + p['w'] for p in ps)
    yt = min(top(p) for p in ps); yb = max(top(p) + p['h'] for p in ps)
    dy = yt - 5
    t = 3 * u
    s.append(f'<g stroke="var(--dim)" stroke-width="{1 * u}"><line x1="{x0}" y1="{dy}" x2="{x1}" y2="{dy}"/>'
             f'<line x1="{x0}" y1="{dy - t}" x2="{x0}" y2="{dy + t}"/><line x1="{x1}" y1="{dy - t}" x2="{x1}" y2="{dy + t}"/></g>')
    fs = 11 * u
    s.append(f'<text x="{(x0 + x1) / 2}" y="{dy - 2.2 * u}" font-size="{fs}" text-anchor="middle" fill="var(--dim)" class="dimtxt">{inch(x1 - x0)} in</text>')
    cy = (yt + yb) / 2; left = x0 > 18; dx = x0 - 6 if left else x1 + 6
    s.append(f'<g stroke="var(--dim)" stroke-width="{1 * u}"><line x1="{dx}" y1="{cy}" x2="{dx}" y2="{WH}"/>'
             f'<line x1="{dx - t}" y1="{cy}" x2="{dx + t}" y2="{cy}"/></g>')
    s.append(f'<text x="{dx - 2.5 * u if left else dx + 2.5 * u}" y="{(cy + WH) / 2}" font-size="{fs}" text-anchor="{'end' if left else 'start'}" fill="var(--dim)" class="dimtxt">{inch(WH - cy)} in</text>')
    return ''.join(s)

def draw_room(wall, px_per_in):
    """D3: the finished wall. Light on the wall, real frames with mats and one soft shadow, furniture in room colors."""
    u = 1 / px_per_in
    s = ['<defs><linearGradient id="light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--wall-hi)"/><stop offset="1" stop-color="var(--wall-lo)"/></linearGradient>'
         '<filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="0.6" stdDeviation="0.6" flood-color="#5B5245" flood-opacity="0.28"/></filter></defs>',
         f'<rect width="{WW}" height="{WH}" fill="url(#light)"/>',
         f'<rect y="{WH - 3}" width="{WW}" height="3" fill="var(--base)"/>', furniture('room')]
    for i, p in enumerate(wall['pieces']):
        x, y, w, h = p['x'], top(p), p['w'], p['h']
        mould = 'var(--frame)' if p['own'] else ('var(--oak)' if i % 2 else 'var(--frame)')
        fw = 0.9
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{mould}" filter="url(#sh)"/>')
        s.append(f'<rect x="{x + fw}" y="{y + fw}" width="{w - 2 * fw}" height="{h - 2 * fw}" fill="var(--mat)"/>')
        s.append(image(p, fw + min(w, h) * 0.1, f'c{i}'))
    return ''.join(s)

# ---------- directions ----------
def furn_flat():
    return furniture('outline').replace('stroke="var(--furn-line)"','stroke="none"').replace('fill="none" stroke="none"','fill="none" stroke="var(--furn-fill)"')

DIRS = {
 'd1': dict(name='Taped up', fonts='https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600&display=swap',
    family='"Familjen Grotesk", -apple-system, sans-serif', draw=draw_tape,
    tokens='--canvas:#F2F2EF;--surface:#FFFFFF;--ink:#1B1C1E;--pencil:#5C6064;--hairline:#DADBD7;--action:#1A5FA6;--on-action:#FFFFFF;'
           '--wall:#E7E6E1;--floor:#CFCDC6;--furn-line:#9EA2A5;--furn-fill:#D9D7D1;--frame:#1B1B1B;--mat:#FBFBF9;--paper:#FCFCFA;'
           '--tape-strip:#2F7FD0;--tape-keep:#2F8A4E;--marker:#9C3A66;',
    word='<span class="wm"><span class="tab" aria-hidden="true"></span>walldrobe</span>'),
 'd2': dict(name='Hanging plan', fonts='https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600&display=swap',
    family='"Schibsted Grotesk", -apple-system, sans-serif', draw=draw_plan,
    tokens='--canvas:#FFFFFF;--surface:#FFFFFF;--ink:#17191C;--pencil:#5A6067;--hairline:#E3E5E8;--action:#1F4FA0;--on-action:#FFFFFF;'
           '--paper:#FFFFFF;--grid:#EDEFF2;--furn-line:#A3A9B0;--furn-fill:none;--propose:#1F4FA0;--keep:#2F8A4E;--dim:#6B7178;--nail:#9C3A66;--marker:#9C3A66;',
    word='<span class="wm">Walldrobe<span class="tick" aria-hidden="true"></span></span>'),
 'd3': dict(name='Finished wall', fonts='https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Figtree:wght@400;500;600&display=swap',
    family='Figtree, -apple-system, sans-serif', draw=draw_room,
    tokens='--canvas:#F6F6F4;--surface:#FFFFFF;--ink:#141516;--pencil:#64686C;--hairline:#E2E2DF;--action:#141516;--on-action:#FFFFFF;'
           '--wall-hi:#EFEDE8;--wall-lo:#E3E0D9;--base:#F7F6F2;--wood:#5B3A2E;--wood-2:#6A4636;--linen:#F1F0EC;--linen-2:#E6E4DE;--pillow:#FAF9F6;'
           '--shade:#F4EFE3;--metal:#2B2B2B;--frame:#1E1E1E;--oak:#B98F62;--mat:#FBFBF8;--marker:#9C3A66;',
    word='<span class="wm">Walldrobe</span>'),
}

CSS = """
:root{%(tokens)s color-scheme: light}
html,body{background:var(--canvas);margin:0}
body{font-family:%(family)s;color:var(--ink);-webkit-font-smoothing:antialiased;font-size:15px;line-height:22px}
.bar{display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 16px;height:56px}
.bar a,.bar button{font:inherit;font-size:16px;color:var(--action);background:none;border:0;min-height:44px;display:inline-flex;align-items:center;padding:0 8px;text-decoration:none}
.bar .back{color:var(--ink);padding-left:0}
.wm{font-size:20px;font-weight:600;letter-spacing:-0.01em;color:var(--ink)}
.r{display:flex;gap:2px}
.draw{margin:0 16px;display:block}
.draw svg{display:block;width:100%%;height:auto}
.chip{font-size:13px;color:var(--pencil);margin:8px 16px 0}
.count{color:var(--pencil);font-size:14px;font-variant-numeric:tabular-nums}
.why{font-size:20px;line-height:26px;font-weight:500;margin:6px 16px 4px;text-wrap:balance;letter-spacing:-0.005em}
.cost{color:var(--pencil);font-size:14px;margin:0 16px;font-variant-numeric:tabular-nums}
.feed .item{margin-bottom:28px}
.feed .count{margin:12px 16px 0}
.pager{display:flex;align-items:center;margin:4px 8px 0 8px}
.pager .nav{width:44px;height:44px;border:0;background:none;color:var(--ink);font-size:22px}
.pager .nav[disabled]{color:var(--hairline)}
.pager .acts{margin-left:auto;display:flex;gap:6px;align-items:center}
.small{font:inherit;font-size:15px;font-weight:500;height:36px;margin:4px 0;padding:0 14px;border-radius:6px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink)}
.small.primary{background:var(--action);border-color:var(--action);color:var(--on-action)}
.undo{margin:10px 16px 0;font-size:15px;line-height:22px}
.undo button{font:inherit;color:var(--action);background:none;border:0;padding:0 0 0 6px;text-decoration:underline;text-underline-offset:3px;position:relative}
.undo button::after{content:"";position:absolute;inset:-11px -8px}
.yours{display:flex;align-items:center;gap:10px;margin:24px 16px 4px}
.yours .lab{color:var(--pencil);font-size:14px;width:44px}
.note{color:var(--pencil);font-size:14px;margin:6px 16px 8px 70px}
.dwrap{position:relative}.sample{position:absolute;left:8px;top:6px;font-size:12px;color:var(--pencil)}
ul.rows{list-style:none;margin:16px 0 0;padding:0 16px;border-top:1px solid var(--hairline)}
.row{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--hairline);align-items:flex-start}
.row .t{flex:0 0 52px;display:flex;justify-content:center}
.row .txt{flex:1;min-width:0}
.row .name{font-size:16px;line-height:21px;font-weight:500;display:block}
.row .meta{color:var(--pencil);font-size:14px;line-height:20px;display:block;font-variant-numeric:tabular-nums}
.row .reason{font-size:14px;line-height:20px;display:block;margin-top:2px}
.heart{width:44px;height:44px;border:0;background:none;color:var(--marker);display:flex;align-items:flex-start;justify-content:center;padding-top:2px}
.kept{color:#2F8A4E;font-weight:500}
%(extra)s
"""

EXTRA = {
 'd1': """.wm{position:relative;padding-left:2px}.tab{position:absolute;left:-3px;top:3px;width:15px;height:5px;background:var(--tape-strip);transform:rotate(-38deg)}
.thumbnew{position:relative;background:var(--paper);padding:2px;box-shadow:0 0 0 1px var(--hairline)}
.thumbnew::before,.thumbnew::after{content:"";position:absolute;top:-2px;width:12px;height:4px;background:var(--tape-strip)}
.thumbnew::before{left:-5px;transform:rotate(-40deg)}.thumbnew::after{right:-5px;transform:rotate(40deg)}
.thumbnew.k::before,.thumbnew.k::after{background:var(--tape-keep)}
.thumbown{padding:4px;background:var(--mat);box-shadow:0 0 0 2px var(--frame)}""",
 'd2': """.wm{position:relative}.tick{position:absolute;left:0;right:0;bottom:-5px;height:5px;border:1px solid var(--dim);border-top:0}
.thumbnew{outline:1.5px dashed var(--propose);outline-offset:2px}.thumbnew.k{outline:1.5px solid var(--keep)}
.thumbown{outline:1.5px solid var(--ink);outline-offset:2px}
.dimtxt{font-family:"Schibsted Grotesk",sans-serif;font-variant-numeric:tabular-nums}
.why{font-weight:500}
.cost,.row .meta{font-variant-numeric:normal}""",
 'd3': """.wm{font-family:"Source Serif 4",Georgia,serif;font-weight:600;font-size:21px}
.row .name{font-family:"Source Serif 4",Georgia,serif;font-weight:600;font-size:17px;line-height:22px}
.why{font-family:"Source Serif 4",Georgia,serif;font-weight:400;font-size:21px;line-height:27px}
.thumbnew,.thumbown{padding:3px;background:var(--mat);box-shadow:0 0 0 1.5px var(--frame),0 1px 2px rgba(60,50,40,.25)}""",
}

def thumb(p, d):
    ar = p['w'] / p['h']
    hgt = 52 if ar < 1 else 52 / ar
    wid = hgt * ar
    cls = 'thumbown' if p['own'] else ('thumbnew k' if p.get('kept') else 'thumbnew')
    return (f'<span class="{cls}" style="display:inline-block;width:{wid:.0f}px;height:{hgt:.0f}px">'
            f'<img src="{esc(p["img"])}" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></span>')

def svg(dkey, wall, px_per_in):
    return (f'<div class="dwrap"><svg viewBox="0 0 {WW} {WH}" role="img" aria-label="Sample wall">{DIRS[dkey]["draw"](wall, px_per_in)}</svg><span class="sample">Sample wall</span></div>')

def page(dkey, body):
    d = DIRS[dkey]
    css = CSS % dict(tokens=d['tokens'], family=d['family'], extra=EXTRA[dkey])
    return (f'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
            f'<link rel="stylesheet" href="{d["fonts"]}"><style>{css}</style></head><body>{body}</body></html>')

HEART = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>'

def feed(dkey, width):
    ppi = (width - 32) / WW
    w1, w2 = D['walls'][0], D['walls'][1]
    def cost(w):
        new = [p for p in w['pieces'] if not p['own']]
        return f'{money(sum(p["price"] for p in new))} for {len(new)} new print{"s" if len(new) > 1 else ""}'
    body = (f'<header class="bar">{DIRS[dkey]["word"]}<span class="r"><a href="#">Your walls 2</a><button>Adjust</button></span></header>'
            f'<main class="feed"><div class="item"><div class="draw">{svg(dkey, w1, ppi)}</div>'
            f'<p class="count">1 of 24</p></div>'
            f'<div class="item"><div class="draw">{svg(dkey, w2, ppi)}</div><p class="count">2 of 24</p></div></main>')
    return page(dkey, body)

def wallpage(dkey, width):
    ppi = (width - 32) / WW
    w = hard_wall()
    own = [p for p in w['pieces'] if p['own']]
    new = [p for p in w['pieces'] if not p['own']]
    total = sum(p['price'] for p in new)
    reasons = {'Still Life with Fake Cake': 'Its red repeats in two other pieces.'}
    rows = ''.join(
        f'<li class="row"><span class="t">{thumb(p, dkey)}</span><span class="txt"><span class="name">{esc(p["title"])}</span>'
        f'<span class="meta">{inch(p["w"])} x {inch(p["h"])} in, at {esc(p["shop"])}{" <span class=kept>Kept</span>" if p.get("kept") else ""}</span>'
        +
        f'</span><button class="heart" aria-label="Favorite">{HEART}</button></li>' for p in new)
    yours = ''.join(thumb(p, dkey) for p in own)
    body = (f'<header class="bar"><a class="back" href="#">‹ All walls</a><span class="r"><a href="#">Your walls 2</a><button>Adjust</button></span></header>'
            f'<main><div class="draw">{svg(dkey, w, ppi)}</div>'
            f'<div class="pager"><button class="nav" aria-label="Wall before">‹</button><span class="count">3 of 24</span><button class="nav" aria-label="Next wall">›</button>'
            f'<span class="acts"><button class="small">Save</button><button class="small primary">Get</button></span></div>'
            f'<p class="undo">Swapped.<button>Undo</button></p>'
            f''
            f'<div class="yours"><span class="lab">Yours</span>{yours}</div>'
            f'<ul class="rows">{rows}</ul></main>')
    return page(dkey, body)

if __name__ == '__main__':
    for k in DIRS:
        for wd in (390, 320):
            open(f'{k}-feed-{wd}.html', 'w').write(feed(k, wd))
            open(f'{k}-wall-{wd}.html', 'w').write(wallpage(k, wd))
    print('ok')
