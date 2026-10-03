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
        # How many: set, one more, one fewer; stepping back brings the same wall back.
        start = sorted(arts(pg))
        vis(pg, '#sheet [data-count]:not([data-count=any])').click(); pg.wait_for_timeout(2500)
        n0 = int(pg.locator('#sheet .step-n').inner_text())
        plus = vis(pg, '#sheet [aria-label="More pieces"]')
        if plus and plus.is_enabled():
            plus.click(); pg.wait_for_timeout(3000)
            check(f'{W} one more piece', len(arts(pg)) == n0 + 1, f'{n0} then {len(arts(pg))}')
            pg.screenshot(path=f'{OUT}/count-up-{W}.png')
            vis(pg, '#sheet [aria-label="Fewer pieces"]').click(); pg.wait_for_timeout(2500)
            check(f'{W} stepping back brings the same wall back', sorted(arts(pg)) == start, f'{len(start)} vs {len(arts(pg))}')
        vis(pg, '#sheet [data-count=any]').click(); pg.wait_for_timeout(2500)
        # Kind, then Undo.
        vis(pg, '#sheet [data-style=structured]').click(); pg.wait_for_timeout(3000)
        check(f'{W} kind set to Structured', vis(pg, '#sheet [data-style=structured][aria-pressed=true]') is not None)
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(300)
        u = vis(pg, '[data-act=undo]'); check(f'{W} undo after a change in Adjust', u is not None)
        if u:
            u.click(); pg.wait_for_timeout(2500)
            vis(pg, '[data-act=change]').click(); pg.wait_for_timeout(600)
            check(f'{W} undo puts Any back', vis(pg, '#sheet [data-style=""][aria-pressed=true]') is not None)
        # New art in the open frames: the frames stay, every new piece changes; Undo brings them back.
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(300)
        box0 = box(); a0 = arts(pg)
        vis(pg, '[data-act=change]').click(); pg.wait_for_timeout(600)
        na = vis(pg, '#sheet [data-act=new-art]'); check(f'{W} New art in the open frames is there', na is not None)
        if na:
            na.click(); pg.wait_for_timeout(2500)
            spots = lambda b: sorted(x.split('@')[1] for x in b)
            check(f'{W} new art keeps the frames', spots(box()) == spots(box0))
            fresh0 = [i for i in a0 if i not in ('blue', 'pink')]
            check(f'{W} new art changes every new piece', all(i not in arts(pg) for i in fresh0), f'{len(fresh0)} new')
            u = vis(pg, '[data-act=undo]'); check(f'{W} undo after new art', u is not None)
            if u: u.click(); pg.wait_for_timeout(1500); check(f'{W} undo brings the art back', sorted(arts(pg)) == sorted(a0))
        vis(pg, '[data-act=change]').click(); pg.wait_for_timeout(600)
        # Free art only.
        vis(pg, '#sheet [data-art=photos]').click(); pg.wait_for_timeout(3000)
        ids = [i for i in arts(pg) if i not in ('blue', 'pink')]
        check(f'{W} Free art shows only free photos', ids and all(not i.startswith(('des-', 'hos-')) for i in ids), ','.join(ids[:3]))
        vis(pg, '#sheet [data-art=prints]').click(); pg.wait_for_timeout(2500)
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(400)
        # Save adds a copy; Your walls shows it; editing after doesn't change it; saving again adds another.
        pg.evaluate("localStorage.removeItem('walldrobe.walls.v1')"); pg.evaluate('window.scrollTo(0, 0)')
        vis(pg, '[data-act=save]').click(); pg.wait_for_timeout(800)
        check(f'{W} Save says Saved', vis(pg, '.wall-acts [data-act=save]').inner_text().strip() == 'Saved')
        check(f'{W} Your walls 1 in the bar', (vis(pg, '.walls-link') or pg.locator('body')).inner_text().strip() == 'Your walls 1')
        saved1 = sorted(arts(pg))
        opens = pg.locator('button.piece-open'); opens.nth(0).click(); pg.wait_for_timeout(900)
        vis(pg, '#sheet [data-choice]').click(); pg.wait_for_timeout(1500); vis(pg, '.sheet-x').click(); pg.wait_for_timeout(300)
        check(f'{W} after a change Save is back', vis(pg, '.wall-acts [data-act=save]').inner_text().strip() == 'Save')
        vis(pg, '[data-act=save]').click(); pg.wait_for_timeout(800)
        saved2 = sorted(arts(pg))
        vis(pg, '.walls-link').click(); pg.wait_for_timeout(1500)
        check(f'{W} Your walls lists both', pg.locator('.wall-card').count() == 2)
        pg.screenshot(path=f'{OUT}/walls-{W}.png', full_page=True)
        check(f'{W} Your walls no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= W)
        # Compare: two saved walls go straight to the compare view, each with what only it has.
        vis(pg, '[data-act=compare]').click(); pg.wait_for_timeout(1500)
        check(f'{W} compare shows two walls', '#/compare/' in pg.url and pg.locator('.cmp').count() == 2)
        check(f'{W} compare shows what only each has', pg.locator('.only-strip .tn').count() == 2, str(pg.locator('.only-strip .tn').count()))
        check(f'{W} compare no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= W)
        pg.screenshot(path=f'{OUT}/compare-{W}.png', full_page=True)
        pg.go_back(); pg.wait_for_timeout(1200)
        # A saved wall's sheet: open, rename, delete one level down.
        pg.locator('.wall-card').first.click(); pg.wait_for_timeout(700)
        check(f'{W} a saved wall opens its sheet', vis(pg, '#sheet [data-open]') is not None and vis(pg, '#sheet [data-rename]') is not None)
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(300)
        stored = pg.evaluate("JSON.parse(localStorage.getItem('walldrobe.walls.v1')).map(w => w.chosen.layout.pieces.map(p => p.ref.id).sort())")
        check(f'{W} the first save is unchanged by the edit', saved1 in stored and saved2 in stored and saved1 != saved2)
        pg.go_back(); pg.wait_for_timeout(1500)
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
