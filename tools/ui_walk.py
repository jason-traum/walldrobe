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
        ch = vis(pg, '#sheet [data-choice]'); check(f'{W} piece sheet shows choices', ch is not None)
        pick = ch.get_attribute('data-choice'); ch.click(); pg.wait_for_timeout(1500)
        check(f'{W} the sheet stays open on the new piece', vis(pg, '#sheet') is not None and pick in arts(pg))
        pg.screenshot(path=f'{OUT}/choices-{W}.png')
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(400)
        a1 = arts(pg)
        check(f'{W} swap changes one piece', len(set(a0) - set(a1)) == 1 and len(a0) == len(a1), f'{len(set(a0) - set(a1))} changed')
        pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/swapped-{W}.png', full_page=True)
        u = vis(pg, '[data-act=undo]'); check(f'{W} undo after swap', u is not None)
        if u: u.click(); pg.wait_for_timeout(1500); check(f'{W} undo restores the swap', arts(pg) == a0)
        # Favorites that fit come first and are marked; See all lists more than four.
        opens = pg.locator('button.piece-open'); opens.nth(opens.count() - 1).click(); pg.wait_for_timeout(900)
        second = pg.locator('#sheet [data-choice]').nth(2).get_attribute('data-choice')
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(300)
        # Make the third choice a favorite: put it up, save it, undo the swap. It should then lead the list, marked.
        opens = pg.locator('button.piece-open'); opens.nth(opens.count() - 1).click(); pg.wait_for_timeout(900)
        pg.locator('#sheet [data-choice]').nth(2).click(); pg.wait_for_timeout(1500)
        vis(pg, '#sheet [data-save]').click(); pg.wait_for_timeout(800)
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(300)
        vis(pg, '[data-act=undo]').click(); pg.wait_for_timeout(1500)
        opens = pg.locator('button.piece-open'); opens.nth(opens.count() - 1).click(); pg.wait_for_timeout(900)
        lead = pg.locator('#sheet [data-choice]').first
        check(f'{W} a favorite that fits comes first, marked', lead.get_attribute('data-choice') == second and lead.locator('.fav-mark').count() == 1, f"{lead.get_attribute('data-choice')} vs {second}")
        pg.screenshot(path=f'{OUT}/favorite-first-{W}.png')
        sa = vis(pg, '[data-act=all-choices]')
        if sa:
            n4 = pg.locator('#sheet [data-choice]').count(); sa.click(); pg.wait_for_timeout(800)
            check(f'{W} See all shows more', pg.locator('#sheet [data-choice]').count() > n4, f"{n4} then {pg.locator('#sheet [data-choice]').count()}")
            pg.screenshot(path=f'{OUT}/all-{W}.png')
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(300)
        # Keep in every wall: the same wall, same place in the list, the piece marked; then Undo.
        cnt = lambda: pg.evaluate("document.querySelector('.pager .count').innerText")
        here0, a0 = cnt(), arts(pg)
        vis(pg, 'button.piece-open').click(); pg.wait_for_timeout(900)
        vis(pg, '[data-act=keep]').click(); pg.wait_for_timeout(2200)
        check(f'{W} keep shows Kept', pg.locator('.piece-kept').count() >= 1)
        check(f'{W} keep stays on the same wall', cnt().split(' of ')[0] == here0.split(' of ')[0] and sorted(arts(pg)) == sorted(a0), f'{here0} then {cnt()}')
        check(f'{W} kept piece has green tape', pg.locator('#drawing g.art.is-kept').count() == 1)
        u = vis(pg, '[data-act=undo]'); check(f'{W} undo after keep', u is not None)
        if u: u.click(); pg.wait_for_timeout(1500); check(f'{W} undo removes Kept', pg.locator('.piece-kept').count() == 0)
        # Remove this frame: one fewer, every other frame where it was; Undo brings it back.
        box = lambda: pg.evaluate("[...document.querySelectorAll('#drawing g.art')].map(g => { const r = g.querySelector('rect'); return g.dataset.id + '@' + r.getAttribute('x') + ',' + r.getAttribute('y'); }).sort()")
        b0 = box()
        opens = pg.locator('button.piece-open'); gone = opens.nth(opens.count() - 1).get_attribute('data-piece'); opens.nth(opens.count() - 1).click(); pg.wait_for_timeout(900)
        rm = vis(pg, '[data-act=remove]'); check(f'{W} Remove this frame is there', rm is not None)
        if rm:
            rm.click(); pg.wait_for_timeout(1500)
            b1 = box()
            check(f'{W} remove takes one frame off', len(b1) == len(b0) - 1)
            check(f'{W} the other frames stay put', b1 == [x for x in b0 if not x.startswith(gone + '@')])
            pg.evaluate('window.scrollTo(0, 0)'); pg.screenshot(path=f'{OUT}/removed-{W}.png')
            u = vis(pg, '[data-act=undo]'); check(f'{W} undo after remove', u is not None)
            if u: u.click(); pg.wait_for_timeout(1500); check(f'{W} undo puts the frame back', box() == b0)
        # Your piece opens its sheet.
        y = vis(pg, '.yours-pc')
        if y:
            y.click(); pg.wait_for_timeout(800); check(f'{W} your piece sheet opens', vis(pg, '#sheet') is not None)
            pg.screenshot(path=f'{OUT}/yours-sheet-{W}.png')
            check(f'{W} your piece has Keep, Maybe, Skip', pg.locator('#sheet [data-keep]').count() == 3)
            n0 = pg.locator('.yours-pc').count()
            vis(pg, '#sheet [data-keep=skip]').click(); pg.wait_for_timeout(2000)
            check(f'{W} Skip takes your piece out', pg.locator('.yours-pc').count() == n0 - 1)
            u = vis(pg, '[data-act=undo]'); check(f'{W} undo after skip', u is not None)
            if u: u.click(); pg.wait_for_timeout(2000); check(f'{W} undo brings your piece back', pg.locator('.yours-pc').count() == n0)
        # Previous and next.
        cnt = lambda: pg.evaluate("document.querySelector('.pager .count').innerText")
        here = cnt(); nx = vis(pg, '.pager [aria-label="Next wall"]'); nx.click(); pg.wait_for_timeout(1200)
        k = int(here.split(' of ')[0])
        check(f'{W} next wall', cnt().startswith(f'{k + 1} of'), f'{here} then {cnt()}')
        check(f'{W} still on the wall it opened after keep and undo', here.startswith(f'{target + 1} of'), here)
        # The working wall keeps itself: swap here, go next and back, then out to the list and back in.
        pg.evaluate('window.scrollTo(0, 0)')
        opens = pg.locator('button.piece-open'); opens.nth(0).click(); pg.wait_for_timeout(900)
        vis(pg, '#sheet [data-choice]').click(); pg.wait_for_timeout(1500); vis(pg, '.sheet-x').click(); pg.wait_for_timeout(300)
        mine = sorted(arts(pg)); at = cnt()
        vis(pg, '.pager [aria-label="Wall before"]').click(); pg.wait_for_timeout(1000)
        vis(pg, '.pager [aria-label="Next wall"]').click(); pg.wait_for_timeout(1000)
        check(f'{W} previous and next keep your swap', sorted(arts(pg)) == mine and cnt() == at, f'{at} then {cnt()}')
        vis(pg, 'a.back').click(); pg.wait_for_timeout(1500)
        k = int(at.split(' of ')[0]) - 1
        listed = pg.evaluate(f"[...document.querySelectorAll('.entry-link')[{k}].querySelectorAll('g.art')].map(g => g.dataset.id).sort()")
        check(f'{W} the list shows the wall as you left it', listed == mine)
        pg.locator('.entry-link').nth(k).click(); pg.wait_for_timeout(1500)
        check(f'{W} opening it again finds your swap', sorted(arts(pg)) == mine)
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
