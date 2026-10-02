# The v4 build walk: run after every round. Checks that every tap on the core
# loop still does something, at 390 and 320 wide, and writes screenshots.
# Usage: serve docs/ (cd docs && python3 -m http.server 8830), then
#   python3 tools/ui_walk.py [out_dir]
# Needs Playwright for Python with Chromium.
import sys, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('WD_BASE', 'http://localhost:8830/index.html')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'walk'
os.makedirs(OUT, exist_ok=True)

def vis(pg, sel):
    l = pg.locator(sel)
    v = [l.nth(i) for i in range(l.count()) if l.nth(i).is_visible()]
    return v[0] if v else None

def arts(pg):
    return pg.evaluate("[...document.querySelectorAll('#drawing g.art')].map(g => g.dataset.id)")

results, fails = [], []
def check(name, ok, detail=''):
    results.append((name, ok, detail))
    if not ok: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    for W in (390, 320):
        ctx = b.new_context(viewport={'width': W, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, color_scheme='light')
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.goto(BASE + '#/sample/bedroom'); pg.wait_for_timeout(3500)
        pg.screenshot(path=f'{OUT}/feed-{W}.png')
        check(f'{W} feed has walls', pg.locator('.entry-link').count() > 2)
        check(f'{W} feed no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= W)
        # A tap on a drawn piece in the list opens that wall, not the first one.
        n = pg.locator('.entry-link').count()
        target = next((i for i in range(n) if pg.locator('.entry-link').nth(i).locator('g.art.is-new').count() >= 3), 2)
        want = pg.locator('.entry-link').nth(target).get_attribute('data-wall')
        pg.locator('.entry-link').nth(target).locator('g.art.is-new').first.click(); pg.wait_for_timeout(1500)
        got = pg.evaluate("(() => { const c = document.querySelector('.pager .count'); return c ? c.innerText : ''; })()")
        check(f'{W} tap a piece in the list opens that wall', got.startswith(f'{target + 1} of'), got)
        pg.screenshot(path=f'{OUT}/wall-{W}.png', full_page=True)
        check(f'{W} wall no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= W)
        # Heart toggles.
        h = vis(pg, '.piece .heart'); before = h.get_attribute('aria-pressed'); h.click(); pg.wait_for_timeout(600)
        check(f'{W} heart toggles', vis(pg, '.piece .heart').get_attribute('aria-pressed') != before)
        vis(pg, '.piece .heart').click(); pg.wait_for_timeout(600)
        # Swap one piece: only that piece changes; Undo brings it back.
        a0 = arts(pg)
        opens = pg.locator('button.piece-open'); opens.nth(opens.count() - 1).click(); pg.wait_for_timeout(900)
        check(f'{W} piece sheet opens', vis(pg, '#sheet') is not None)
        vis(pg, '[data-act=swap]').click(); pg.wait_for_timeout(2200)
        a1 = arts(pg)
        check(f'{W} swap changes one piece', len(set(a0) - set(a1)) == 1 and len(a0) == len(a1), f'{len(set(a0) - set(a1))} changed')
        pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/swapped-{W}.png', full_page=True)
        u = vis(pg, '[data-act=undo]'); check(f'{W} undo after swap', u is not None)
        if u: u.click(); pg.wait_for_timeout(1500); check(f'{W} undo restores the swap', arts(pg) == a0)
        # Keep in every wall, then Undo.
        vis(pg, 'button.piece-open').click(); pg.wait_for_timeout(900)
        vis(pg, '[data-act=keep]').click(); pg.wait_for_timeout(2200)
        check(f'{W} keep shows Kept', pg.locator('.piece-kept').count() >= 1)
        u = vis(pg, '[data-act=undo]'); check(f'{W} undo after keep', u is not None)
        if u: u.click(); pg.wait_for_timeout(1500); check(f'{W} undo removes Kept', pg.locator('.piece-kept').count() == 0)
        # Your piece opens its sheet.
        y = vis(pg, '.yours-pc')
        if y: y.click(); pg.wait_for_timeout(800); check(f'{W} your piece sheet opens', vis(pg, '#sheet') is not None); vis(pg, '.sheet-x').click(); pg.wait_for_timeout(400)
        # Previous and next.
        cnt = lambda: pg.evaluate("document.querySelector('.pager .count').innerText")
        here = cnt(); nx = vis(pg, '.pager [aria-label="Next wall"]'); nx.click(); pg.wait_for_timeout(1200)
        k = int(here.split(' of ')[0])
        check(f'{W} next wall', cnt().startswith(f'{k + 1} of'), f'{here} then {cnt()}')
        check(f'{W} still on the wall it opened after keep and undo', here.startswith(f'{target + 1} of'), here)
        # Adjust opens.
        vis(pg, '[data-act=change]').click(); pg.wait_for_timeout(800)
        check(f'{W} Adjust opens', vis(pg, '#sheet') is not None)
        pg.screenshot(path=f'{OUT}/adjust-{W}.png')
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(400)
        # Get it.
        vis(pg, '[data-act=get]').click(); pg.wait_for_timeout(1500)
        check(f'{W} Get it opens', '#/get' in pg.url)
        pg.screenshot(path=f'{OUT}/get-{W}.png', full_page=True)
        check(f'{W} no prices on Get it', '$' not in pg.evaluate('document.body.innerText'))
        check(f'{W} no errors', not errs, '; '.join(errs[:2]))
        ctx.close()
    b.close()

for name, ok, detail in results:
    print(('ok  ' if ok else 'FAIL'), name, detail)
print(f'{len(results) - len(fails)} of {len(results)} passed')
sys.exit(1 if fails else 0)
