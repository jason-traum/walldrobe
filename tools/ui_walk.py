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

# Get it's controls by kind: each row's buttons count once, every print service link once.
CTL = "new Set([...document.querySelectorAll('.bar a, .bar button, .get a.btn, .get button, .get input, .prices a')].map(e => e.closest('.buy-row') ? 'row:' + (e.textContent.startsWith('Find') ? 'frame' : 'get') : e.closest('.prices') ? 'printer' : e.textContent.trim() || e.id)).size"

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
        check(f'{W} the taste test sits in the list after the second wall', pg.evaluate("(() => { const c = document.querySelector('.taste-card'); return !!c && c.previousElementSibling && [...document.querySelectorAll('.feed > li.entry')].indexOf(c.previousElementSibling) === 1; })()"))
        nw = pg.locator('.entry-link').count()
        vis(pg, '[data-act=more-walls]').click(); pg.wait_for_timeout(5000)
        check(f'{W} Show more walls adds walls at the end', pg.locator('.entry-link').count() > nw, f"{nw} then {pg.locator('.entry-link').count()}")
        pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(300)
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
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(500)
        # Make the third choice a favorite: put it up, save it, undo the swap. It should then lead the list, marked.
        opens = pg.locator('button.piece-open'); opens.nth(opens.count() - 1).click(); pg.wait_for_timeout(900)
        pg.locator('#sheet [data-choice]').nth(2).click(); pg.wait_for_timeout(1500)
        vis(pg, '#sheet [data-save]').click(); pg.wait_for_timeout(800)
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(500)
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
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(500)
        # Keep in every wall: the same wall, same place in the list, the piece marked; then Undo.
        cnt = lambda: pg.evaluate("document.querySelector('.pager .count').innerText")
        here0, a0 = cnt(), arts(pg)
        vis(pg, 'button.piece-open').click(); pg.wait_for_timeout(900)
        vis(pg, '[data-act=keep]').click(); pg.wait_for_timeout(2200)
        kc = pg.evaluate("(() => { const k = document.querySelector('.piece-kept'); return k ? getComputedStyle(k).color : 'none'; })()")
        check(f'{W} the word Kept uses the darker green', kc in ('rgb(37, 115, 63)', 'none'), kc)
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
        for _ in range(4):
            if pg.locator('button.piece-open').count(): break
            vis(pg, '.pager [aria-label="Next wall"]').click(); pg.wait_for_timeout(1000)
        opens = pg.locator('button.piece-open'); opens.nth(0).click(); pg.wait_for_timeout(900)
        vis(pg, '#sheet [data-choice]').click(); pg.wait_for_timeout(1500); vis(pg, '.sheet-x').click(); pg.wait_for_timeout(500)
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
        check(f'{W} Preferences opens', vis(pg, '#sheet') is not None)
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
        vis(pg, '#sheet [data-style=structured]').click()
        quick = pg.evaluate("(() => { const s = document.querySelector('#sheet'); const b = s && s.querySelector('[data-style=structured]'); return [!!s, b && b.getAttribute('aria-pressed'), !!document.querySelector('.wall-page, .feed-page .entry-link'), (document.querySelector('.sheet-status') || {}).textContent || ''] })()")
        check(f'{W} Adjust stays up while the walls build, the tap shows at once', quick[0] and quick[1] == 'true' and quick[2], str(quick))
        pg.wait_for_timeout(3000)
        check(f'{W} kind set to Structured', vis(pg, '#sheet [data-style=structured][aria-pressed=true]') is not None)
        check(f'{W} the sheet does not slide in again', 'stay' in (pg.locator('#sheet').get_attribute('class') or ''))
        check(f'{W} Adjust says Changed with its Undo', 'Changed.' in pg.locator('.sheet-status').inner_text() and pg.locator('.sheet-status [data-act=undo]').count() == 1)
        # Two changes in a row: two Undos put both back.
        vis(pg, '#sheet [data-fullness=full]').click(); pg.wait_for_timeout(3000)
        vis(pg, '.sheet-status [data-act=undo]').click(); pg.wait_for_timeout(2500)
        check(f'{W} the first Undo puts How full back', vis(pg, '#sheet [data-fullness=balanced][aria-pressed=true]') is not None and vis(pg, '#sheet [data-style=structured][aria-pressed=true]') is not None)
        u2 = vis(pg, '.sheet-status [data-act=undo]')
        check(f'{W} a second Undo is there for the change before', u2 is not None)
        if u2: u2.click(); pg.wait_for_timeout(2500)
        check(f'{W} the second Undo puts Kind back', vis(pg, '#sheet [data-style=""][aria-pressed=true]') is not None)
        vis(pg, '#sheet [data-style=structured]').click(); pg.wait_for_timeout(3000)
        check(f'{W} focus stays on the option you picked', pg.evaluate("document.activeElement.dataset.style") == 'structured')
        pg.evaluate("document.querySelectorAll('#sheet .seg button')[1].focus()"); pg.keyboard.press('Tab'); pg.keyboard.press('Shift+Tab')
        fr = pg.evaluate("(() => { const b = document.activeElement; return b.closest('.seg') ? getComputedStyle(b).outlineOffset : 'not a segment: ' + b.outerHTML.slice(0, 60); })()")
        check(f'{W} a focused segment draws its ring inside', fr == '-3px', fr)
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(500)
        u = vis(pg, '[data-act=undo]'); check(f'{W} undo after a change in Adjust', u is not None)
        if u:
            u.click(); pg.wait_for_timeout(2500)
            vis(pg, '[data-act=change]').click(); pg.wait_for_timeout(600)
            check(f'{W} undo puts Any back', vis(pg, '#sheet [data-style=""][aria-pressed=true]') is not None)
        # New art in the open frames: the frames stay, every new piece changes; Undo brings them back.
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(500)
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
        vis(pg, '#sheet [data-choice]').click(); pg.wait_for_timeout(1500); vis(pg, '.sheet-x').click(); pg.wait_for_timeout(500)
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
        pg.locator('.wall-card').first.locator('g.art').first.click(force=True); pg.wait_for_timeout(700)
        check(f'{W} a tap on a piece in a saved wall opens its sheet', vis(pg, '#sheet [data-open]') is not None and vis(pg, '#sheet [data-rename]') is not None)
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(500)
        stored = pg.evaluate("JSON.parse(localStorage.getItem('walldrobe.walls.v1')).map(w => w.chosen.layout.pieces.map(p => p.ref.id).sort())")
        check(f'{W} the first save is unchanged by the edit', saved1 in stored and saved2 in stored and saved1 != saved2)
        pg.go_back(); pg.wait_for_timeout(1500)
        # Favorites: a heart lands there; See it on my wall keeps it in every wall.
        for _ in range(4):
            vis(pg, '.pager [aria-label="Next wall"]').click(); pg.wait_for_timeout(1000)
            if pg.locator('.piece .heart').count(): break
        hp = pg.locator('.piece .heart').first; fav = hp.get_attribute('data-save')
        check(f'{W} the heart says Favorite, not Save', (hp.get_attribute('aria-label') or '').startswith('Favorite '), hp.get_attribute('aria-label'))
        if hp.get_attribute('aria-pressed') != 'true': hp.click(); pg.wait_for_timeout(600)
        vis(pg, '[data-act=change]').click(); pg.wait_for_timeout(600)
        vis(pg, '#sheet a[href="#/saved"]').click(); pg.wait_for_timeout(1200)
        check(f'{W} Favorites lists the heart', pg.locator(f'.saved-page [data-save="{fav}"]').count() == 1)
        pg.locator(f'.saved-page [data-save="{fav}"]').click(); pg.wait_for_timeout(600)
        check(f'{W} taking one out of Favorites has an Undo', pg.locator(f'.saved-page [data-save="{fav}"]').count() == 0 and vis(pg, '.saved-page [data-act=undo]') is not None)
        vis(pg, '.saved-page [data-act=undo]').click(); pg.wait_for_timeout(600)
        check(f'{W} Undo puts it back in Favorites', pg.locator(f'.saved-page [data-save="{fav}"]').count() == 1)
        check(f'{W} Favorites no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= W)
        pg.screenshot(path=f'{OUT}/favorites-{W}.png', full_page=True)
        others = [x for x in pg.evaluate("[...document.querySelectorAll('[data-onwall]')].map(b => b.dataset.onwall)")]
        if others:
            pg.locator(f'[data-onwall="{others[0]}"]').click(); pg.wait_for_timeout(3000)
            check(f'{W} See it on my wall puts it up, kept', '#/wall' in pg.url and pg.locator(f'#drawing g.art.is-kept[data-id="{others[0]}"]').count() == 1)
            vis(pg, '[data-act=undo]').click(); pg.wait_for_timeout(2500)
        # Frame it: one look for the set, then Get it, then Hang it.
        vis(pg, '[data-act=get]').click(); pg.wait_for_timeout(1500)
        check(f'{W} the wall goes on to Frame it', '#/frames' in pg.url, pg.url)
        news = pg.evaluate("document.querySelectorAll('#frames-wall g.art.is-new, #frames-wall g.art.is-kept').length")
        check(f'{W} new prints are drawn in their frames', news > 0 and pg.evaluate("[...document.querySelectorAll('#frames-wall g.art.is-new, #frames-wall g.art.is-kept')].every(g => g.classList.contains('is-framed') && g.querySelector('rect.frame-new'))"))
        black = pg.evaluate("getComputedStyle(document.querySelector('#frames-wall .frame-new')).fill")
        vis(pg, '[data-look=oak]').click(); pg.wait_for_timeout(500)
        check(f'{W} picking oak colors every new frame', pg.evaluate("getComputedStyle(document.querySelector('#frames-wall .frame-new')).fill") != black and pg.evaluate("document.activeElement && document.activeElement.dataset.look") == 'oak')
        check(f'{W} Frame it lists a size for every new piece', pg.locator('.frame-row').count() == news, str(pg.locator('.frame-row').count()))
        check(f'{W} Frame it has no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= W)
        pg.screenshot(path=f'{OUT}/frames-{W}.png', full_page=True)
        vis(pg, '[data-look=black]').click(); pg.wait_for_timeout(400)
        vis(pg, '[data-act=to-get]').click(); pg.wait_for_timeout(1500)
        check(f'{W} Get it opens', '#/get' in pg.url)
        pg.screenshot(path=f'{OUT}/get-{W}.png', full_page=True)
        check(f'{W} no shop prices on Get it', '$' not in pg.evaluate("[...document.querySelectorAll('.get > :not(.where)')].map(e => { const c = e.cloneNode(true); c.querySelectorAll('.wall-sum').forEach(x => x.remove()); return c.innerText; }).join(' ')"))
        rows = pg.locator('.buy-row').count()
        check(f'{W} one buy row per new piece', rows == news and rows > 0, f'{rows} rows, {news} new')
        words = pg.evaluate("[...document.querySelectorAll('.frame-words')].map(e => e.textContent)")
        check(f'{W} every row says its frame in words', len(words) == rows and all(('Frame' in w or 'framed' in w) and 'in' in w for w in words), str(words[:2]))
        import re as _re
        def _up(w):
            sizes = [tuple(map(float, m)) for m in _re.findall(r'(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)', w.replace('\u00a0', ' '))]
            return len(set((a > b) for a, b in sizes if a != b)) <= 1
        check(f'{W} print and frame are said the same way up', all(_up(w) for w in words), str(words[:2]))
        check(f'{W} every row says the frame\'s outside size', all('outside' in w for w in words), str(words[:2]))
        check(f'{W} every row has a way to get it', pg.evaluate("[...document.querySelectorAll('.buy-row')].every(r => r.querySelector('a[href^=http]'))"))
        before = pg.locator('.order-state').inner_text()
        vis(pg, '.tick').click(); pg.wait_for_timeout(500)
        check(f'{W} ticking a piece ordered counts it and keeps focus', pg.locator('.order-state').inner_text() != before and pg.evaluate("document.activeElement && document.activeElement.classList.contains('tick') && document.activeElement.getAttribute('aria-pressed') === 'true'"))
        check(f'{W} Get it thumbnails keep the art shape', pg.evaluate("[...document.querySelectorAll('.get .tn img')].every(i => getComputedStyle(i).objectFit === 'cover')"))
        sw = pg.evaluate('document.documentElement.scrollWidth'); cw = pg.evaluate('document.documentElement.clientWidth')
        check(f'{W} Get it has no sideways scroll', sw <= cw, f'{sw} > {cw}')
        small = pg.evaluate("[...document.querySelectorAll('.get a.btn, .get button.btn, .get .tick, .bar .btn')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().height).filter(h => h < 44).length")
        check(f'{W} Get it targets 44 px', small == 0, str(small))
        ctl = pg.evaluate(CTL)
        check(f'{W} Get it within its 8 controls', ctl <= 8, str(ctl))
        check(f'{W} no hanger question while buying', pg.locator('[data-hang-type]').count() == 0)
        sv = vis(pg, '.get [data-act=save]')
        if sv.is_enabled():
            sv.click(); pg.wait_for_timeout(1200)
        check(f'{W} Save on Get it reads Saved after', vis(pg, '.get [data-act=save]').text_content().strip() == 'Saved')
        # Hang it: the hangers, the nails, then it's up.
        vis(pg, 'a[href="#/hang"]').click(); pg.wait_for_timeout(1500)
        check(f'{W} Hang it opens', '#/hang' in pg.url)
        trs = pg.locator('.nails tbody tr').count(); allp = pg.evaluate("document.querySelectorAll('#guide g.art').length")
        check(f'{W} a nail row for every piece', trs == allp, f'{trs} rows, {allp} pieces')
        check(f'{W} each frame says the hanger it is assumed to have', pg.evaluate("[...document.querySelectorAll('.nails tbody tr')].every(r => /Sawtooth|Wire|D-rings/.test(r.innerText))"))
        check(f'{W} the hangers are open to check first', pg.evaluate("document.querySelector('details.hangers').open"))
        n1 = pg.locator('#guide circle.nail').count()
        first = pg.locator('[data-hang-type]').first
        fid = first.get_attribute('data-hang-type')
        first.select_option('rings'); pg.wait_for_timeout(700)
        n2 = pg.locator('#guide circle.nail').count()
        check(f'{W} setting two D-rings on a frame adds its second nail', n2 == n1 + 1 and pg.locator(f'[data-hang-in="{fid}"]').count() == 1, f'{n1} then {n2}')
        check(f'{W} the hanger choice keeps focus', pg.evaluate("document.activeElement && document.activeElement.dataset.hangType") == fid)
        pg.screenshot(path=f'{OUT}/hang-rings-{W}.png', full_page=True)
        pg.locator(f'[data-hang-type="{fid}"]').select_option('sawtooth'); pg.wait_for_timeout(600)
        check(f'{W} back to one nail', pg.locator('#guide circle.nail').count() == n1)
        check(f'{W} Hang it has no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= W)
        vis(pg, '[data-act=hung]').click(); pg.wait_for_timeout(800)
        check(f'{W} It\'s up', "It's up" in pg.locator('#done-h').inner_text() and pg.locator('#hung-photo').count() == 1)
        pg.goto(BASE + '#/wall'); pg.wait_for_timeout(1500)
        check(f'{W} the wall says it is up', 'up' in (pg.locator('.progress-line').inner_text() if pg.locator('.progress-line').count() else ''))
        check(f'{W} no errors', not errs, '; '.join(errs[:2]))
        ctx.close()

    # On a computer the open wall uses the room it has, and the taste test shows each print whole.
    for W, H in ((1440, 900), (1024, 768)):
        ctx = b.new_context(viewport={'width': W, 'height': H}, color_scheme='light')
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '#/sample/living'); pg.wait_for_timeout(3500)
        pg.locator('.entry-link').nth(0).click(); pg.wait_for_timeout(2000)
        r = pg.evaluate("(() => { const b = document.querySelector('#drawing').getBoundingClientRect(); const g = document.querySelector('[data-act=get]').getBoundingClientRect(); return [b.width, b.height, g.bottom] })()")
        check(f'{W} the open wall fills the window, wide or tall', r[0] >= W * 0.6 or r[1] >= (H - 200), f'{r[0]:.0f} x {r[1]:.0f}')
        check(f'{W} Get it is in view without scrolling', r[2] <= H, f'{r[2]:.0f} > {H}')
        pg.screenshot(path=f'{OUT}/wall-desk-{W}.png')
        pg.goto(BASE + '#/taste'); pg.wait_for_timeout(1500)
        cut = []
        for _ in range(10):
            for a, ar in pg.evaluate("[...document.querySelectorAll('.pick-art')].map(e => { const b = e.getBoundingClientRect(); return [parseFloat(e.style.getPropertyValue('--a')), b.width / b.height] })"):
                if abs(ar / a - 1) > 0.03: cut.append(f'{a} shown {ar:.2f}')
            pg.locator('.pick').first.click(); pg.wait_for_timeout(400)
        check(f'{W} taste test prints keep their shape, never cut to a box', not cut, ', '.join(cut[:3]))
        check(f'{W} no errors on a computer', not errs, '; '.join(errs[:2]))
        ctx.close()

    # Where to print: free photos get every print service, the best ones marked, and a question for your AI.
    for W in (390, 320):
        ctx = b.new_context(viewport={'width': W, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, color_scheme='light')
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE.split('/index')[0])
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '#/sample/bedroom'); pg.wait_for_timeout(3500)
        pg.locator('.entry-link').nth(0).click(); pg.wait_for_timeout(1500)
        vis(pg, '[data-act=change]').click(); pg.wait_for_timeout(600)
        vis(pg, '#sheet [data-art=photos]').click(); pg.wait_for_timeout(3000)
        vis(pg, '.sheet-x').click(); pg.wait_for_timeout(400)
        vis(pg, '[data-act=get]').click(); pg.wait_for_timeout(1500)
        # The mat choice shows for free photos, and no mat means the print fills the frame.
        check(f'{W} Frame it offers how many mats, from none to all, Some first', pg.locator('[data-mat]').count() == 5 and pg.locator('[data-mat=some]').get_attribute('aria-pressed') == 'true')
        mw = lambda: pg.evaluate("[...document.querySelectorAll('.frame-row .frame-words')].map(e => e.textContent)")
        big = [w for w in mw() if 'with a mat' in w]
        vis(pg, '[data-mat=none]').click(); pg.wait_for_timeout(500)
        check(f'{W} no mats: every print fills its frame', all('no mat' in t or 'framed' in t for t in mw()))
        vis(pg, '[data-mat=all]').click(); pg.wait_for_timeout(500)
        flips = pg.locator('[data-mat-one]')
        check(f'{W} all mats: every free photo that can take one has one', flips.count() > 0 and all(flips.nth(k).get_attribute('aria-pressed') == 'true' for k in range(flips.count())))
        fid = flips.first.get_attribute('data-mat-one'); flips.first.click(); pg.wait_for_timeout(500)
        check(f'{W} flipping one piece changes just that one', pg.locator(f'[data-mat-one="{fid}"]').get_attribute('aria-pressed') == 'false' and pg.evaluate("document.activeElement && document.activeElement.dataset.matOne") == fid)
        pg.screenshot(path=f'{OUT}/frames-mats-{W}.png', full_page=True)
        vis(pg, '[data-mat=few]').click(); pg.wait_for_timeout(500)
        few = sum(1 for k in range(pg.locator('[data-mat-one]').count()) if pg.locator('[data-mat-one]').nth(k).get_attribute('aria-pressed') == 'true')
        vis(pg, '[data-mat=most]').click(); pg.wait_for_timeout(500)
        most = sum(1 for k in range(pg.locator('[data-mat-one]').count()) if pg.locator('[data-mat-one]').nth(k).get_attribute('aria-pressed') == 'true')
        check(f'{W} more on the scale, more mats', most >= few, f'{few} then {most}')
        vis(pg, '[data-mat=some]').click(); pg.wait_for_timeout(500)
        vis(pg, '[data-act=to-get]').click(); pg.wait_for_timeout(1500)
        check(f'{W} free photos get Where to print', pg.locator('#where-h').count() == 1)
        check(f'{W} Where to print lists the services', pg.locator('.prices tbody tr').count() >= 5, str(pg.locator('.prices tbody tr').count()))
        check(f'{W} the best price is marked in each table', pg.evaluate("[...document.querySelectorAll('.prices')].every(t => [...t.querySelectorAll('tr.is-pick .pr-tag')].filter(x => x.textContent === 'Best price').length === 1)"))
        check(f'{W} every service links to its own site in a new tab', pg.evaluate("[...document.querySelectorAll('.prices tbody tr')].every(r => { const a = r.querySelector('td a'); return a && a.href.startsWith('https://') && a.target === '_blank' })"))
        tot = pg.evaluate("(() => { const th = [...document.querySelectorAll('.prices th')].pop().getBoundingClientRect(); return th.right })()")
        check(f'{W} the Total column fits on screen', tot <= W, str(tot))
        check(f'{W} Where to print has no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= W)
        pg.screenshot(path=f'{OUT}/where-{W}.png', full_page=True)
        vis(pg, '[data-act=copy-ai]').click(); pg.wait_for_timeout(600)
        check(f'{W} Copy for your AI says Copied', 'Copied' in pg.locator('.copy-status').text_content())
        check(f'{W} focus stays on Copy', pg.evaluate("document.activeElement && document.activeElement.dataset.act") == 'copy-ai')
        q = pg.evaluate('navigator.clipboard.readText()')
        check(f'{W} the copied question has the table and asks for codes', '| Service |' in q and 'discount codes' in q and '\u2014' not in q, q[:80])
        check(f'{W} the copied question has the frames too', '| Seller |' in q and 'frame' in q, q[-200:])
        check(f'{W} Where to frame lists sellers with the mats', pg.locator('#frame-h').count() == 1 and pg.locator('.where .prices').count() == 2)
        check(f'{W} the wall in two lines', pg.locator('.wall-sum').count() == 1 and 'frame' in pg.locator('.wall-sum').inner_text())
        ctl = pg.evaluate(CTL)
        check(f'{W} Get it with Where to print within its 8 controls', ctl <= 8, str(ctl))
        check(f'{W} no errors', not errs, '; '.join(errs[:2]))
        ctx.close()

    # Images that fail to load, and the second tap of a double tap.
    for W in (390,):
        ctx = b.new_context(viewport={'width': W, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, color_scheme='light')
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '#/sample/bedroom'); pg.wait_for_timeout(3500)
        pg.locator('.entry-link').nth(2).click(); pg.wait_for_timeout(1500)
        # Double tap on Keep: the second tap must not open the piece under the sheet.
        for _ in range(5):
            if pg.locator('button.piece-open').count() >= 2: break
            vis(pg, '.pager [aria-label="Next wall"]').click(); pg.wait_for_timeout(1000)
        vis(pg, 'button.piece-open').click(); pg.wait_for_timeout(900)
        k = vis(pg, '[data-act=keep]'); kb = k.bounding_box()
        pg.mouse.click(kb['x'] + kb['width'] / 2, kb['y'] + kb['height'] / 2); pg.wait_for_timeout(120)
        pg.mouse.click(kb['x'] + kb['width'] / 2, kb['y'] + kb['height'] / 2); pg.wait_for_timeout(1500)
        check(f'{W} a double tap on Keep does not open what was under the sheet', vis(pg, '#sheet') is None)
        vis(pg, '[data-act=undo]').click(); pg.wait_for_timeout(2000)
        # Back with a sheet open closes the sheet and stays on the wall.
        vis(pg, 'button.piece-open').click(); pg.wait_for_timeout(800)
        pg.go_back(); pg.wait_for_timeout(800)
        check(f'{W} Back closes the sheet and stays on the wall', vis(pg, '#sheet') is None and '#/wall' in pg.url, pg.url)
        pg.wait_for_timeout(400)
        # Not for me: gone from this wall and every wall, kept across a reload, with Undo and Show it again.
        here = pg.evaluate("document.querySelector('.pager .count').innerText")
        vis(pg, 'button.piece-open').click(); pg.wait_for_timeout(900)
        nid = vis(pg, '#sheet [data-act=not-for-me]').get_attribute('data-id')
        ctl = pg.evaluate("(() => { const s = document.querySelector('#sheet'); return new Set([...s.querySelectorAll('button, a')].filter(e => !e.closest('.choices')).map(e => e.closest('.seg') || e)).size; })()")
        check(f'{W} the piece sheet stays within 6 controls plus the choices', ctl <= 6, str(ctl))
        vis(pg, '#sheet [data-act=not-for-me]').click(); pg.wait_for_timeout(3000)
        check(f'{W} Not for me takes it off this wall, same wall', pg.locator(f'#drawing g.art[data-id="{nid}"]').count() == 0 and pg.evaluate("document.querySelector('.pager .count').innerText").split(' of ')[0] == here.split(' of ')[0], here)
        check(f'{W} Not for me has an Undo', 'Not for me.' in (vis(pg, '.undo') or pg.locator('body')).inner_text())
        vis(pg, '.bar a').first.click(); pg.wait_for_timeout(2500)
        check(f'{W} it is on no wall in the list', pg.locator(f'.entry-link g.art[data-id="{nid}"]').count() == 0)
        # The sample isn't kept over a reload, so load it again: the piece stays out.
        pg.reload(); pg.wait_for_timeout(1500); pg.goto(BASE + '#/sample/bedroom'); pg.wait_for_timeout(4000)
        check(f'{W} still on no wall after a reload', pg.locator(f'.entry-link g.art[data-id="{nid}"]').count() == 0 and pg.locator('.entry-link').count() > 2, pg.url)
        pg.goto(BASE + '#/saved'); pg.wait_for_timeout(1500)
        pg.locator('.not-for-me summary').click(); pg.wait_for_timeout(300)
        check(f'{W} Favorites lists it under Not for me', pg.locator(f'.not-for-me [data-id="{nid}"]').count() == 1)
        pg.locator(f'.not-for-me [data-id="{nid}"]').click(); pg.wait_for_timeout(600)
        check(f'{W} Show it again takes it off the list', pg.locator(f'.not-for-me [data-id="{nid}"]').count() == 0)
        check(f'{W} no errors with Not for me', not errs, '; '.join(errs[:2]))
        ctx.close()
        ctx = b.new_context(viewport={'width': W, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, color_scheme='light')
        pg = ctx.new_page()
        pg.route('**/*', lambda r: r.abort() if r.request.resource_type == 'image' and not r.request.url.startswith('data:') else r.continue_())
        pg.goto(BASE + '#/sample/bedroom'); pg.wait_for_timeout(3500)
        pg.locator('.entry-link').first.click(); pg.wait_for_timeout(3000)
        imgs = pg.evaluate("document.querySelectorAll('#drawing image').length")
        titles = pg.evaluate("[...document.querySelectorAll('#drawing g.art.is-new text.art-wait, #drawing g.art.is-kept text.art-wait')].map(t => t.getBoundingClientRect().height)")
        check(f'{W} failed prints leave their titles on the drawing, readable', imgs == 0 and titles and min(titles) >= 9, f'{imgs} images, title heights {titles[:3]}')
        miss = pg.evaluate("[...document.querySelectorAll('.get .tn, .pieces .tn, .yours .tn')].map(t => { const i = t.querySelector('img'); return i ? (i.src.startsWith('data:') ? 'loaded' : 'broken') : t.querySelector('.tn-title') ? 'title' : 'swatch'; })")
        check(f'{W} failed thumbnails show the title, not a broken image', 'broken' not in miss and len(miss) > 0, str(miss))
        pg.screenshot(path=f'{OUT}/images-failed-{W}.png', full_page=True)
        ctx.close()

    # Furniture read from a real photo comes back to its real size, from where the camera stood.
    for W in (390,):
        ctx = b.new_context(viewport={'width': W, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, color_scheme='light')
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '#/start'); pg.wait_for_timeout(2500)
        pg.set_input_files('#photo-input', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test', 'fixtures', 'living_room.png')); pg.wait_for_timeout(15000)
        vis(pg, '[data-act="corners-ok"]').click(); pg.wait_for_timeout(8000)
        if '#/size' in pg.url:
            pg.fill('input[name=ft]', '11'); pg.fill('input[name=in]', '0')
            pg.get_by_role('button', name='Show me my wall').click(); pg.wait_for_timeout(5000)
        rows = pg.evaluate("[...document.querySelectorAll('.rows .row .row-text .meta')].map(e => e.innerText)")
        import re as _re2
        fixed = [r for r in rows if 'in the photo' in r]
        check(f'{W} furniture shows its real size and the photo size', len(fixed) >= 1 and all(float(_re2.match(r'([\d.]+)', r).group(1)) < float(_re2.search(r'about ([\d.]+) in wide', r).group(1)) for r in fixed), str(rows))
        check(f'{W} the confirm screen says where you stood', 'back.' in pg.evaluate("document.body.innerText") and 'ft back' in pg.evaluate("document.body.innerText"))
        pg.screenshot(path=f'{OUT}/check-depth-{W}.png', full_page=True)
        check(f'{W} no errors on the depth pass', not errs, '; '.join(errs[:2]))
        ctx.close()

    # The photo path: corners (nudge, close-up), then the confirm screen (pick, drag, change kind, wall edge).
    PHOTO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test', 'photos', 'drawn-wall.jpg')
    for W in (390, 320):
        ctx = b.new_context(viewport={'width': W, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, color_scheme='light')
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '#/start'); pg.wait_for_timeout(2500)
        pg.set_input_files('#photo-input', PHOTO); pg.wait_for_timeout(12000)
        check(f'{W} a photo goes to the corners', '#/corners' in pg.url, pg.url)
        dot = lambda i: pg.evaluate(f"(() => {{ const c = document.querySelectorAll('#corner-svg .handle')[{i}].querySelector('.handle-dot'); return [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]; }})()")
        before = dot(0)
        vis(pg, '[data-nudge="1,0"]').click(); pg.wait_for_timeout(300)
        check(f'{W} nudge moves the picked corner', dot(0)[0] > before[0], f'{before} to {dot(0)}')
        # A finger drag on a corner shows the close-up, and hides it after.
        cdp = ctx.new_cdp_session(pg)
        bx = pg.evaluate("(() => { const r = document.querySelectorAll('#corner-svg .handle')[3].querySelector('.handle-dot').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': bx[0], 'y': bx[1]}]})
        for k in range(1, 6):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': bx[0] + k * 2, 'y': bx[1] + k * 3}]})
        pg.wait_for_timeout(200)
        shown = pg.evaluate("(() => { const l = document.querySelector('.loupe'); return !!l && getComputedStyle(l).display === 'block'; })()")
        pg.screenshot(path=f'{OUT}/corners-loupe-{W}.png')
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); pg.wait_for_timeout(400)
        check(f'{W} a finger drag shows the close-up', shown)
        check(f'{W} the close-up goes away after', pg.evaluate("(() => { const l = document.querySelector('.loupe'); return !l || getComputedStyle(l).display === 'none'; })()"))
        check(f'{W} the dragged corner is picked', pg.locator('#corner-svg .handle').nth(3).get_attribute('class').find('is-picked') >= 0 and 'Bottom left' in pg.locator('#nudge-who').text_content())
        vis(pg, '[data-act="corners-ok"]').click(); pg.wait_for_timeout(5000)
        if '#/size' in pg.url:
            pg.fill('input[name=ft]', '10'); pg.fill('input[name=in]', '0')
            pg.get_by_role('button', name='Show me my wall').click(); pg.wait_for_timeout(5000)
        check(f'{W} the confirm screen opens', '#/check' in pg.url, pg.url)
        own = pg.locator('#check-wall g.box[data-kind=own]')
        if own.count():
            oid = own.first.get_attribute('data-box')
            meta = lambda: pg.evaluate(f"(() => {{ const r = document.querySelector('[data-box=\"{oid}\"] .owned-box-mark'); return [Number(r.getAttribute('width')), Number(r.getAttribute('height')), Number(r.getAttribute('x'))]; }})()")
            sel = f'#check-wall g.box[data-box="{oid}"]'
            box = pg.locator(sel + ' .owned-box-mark').bounding_box()
            pg.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); pg.wait_for_timeout(600)
            check(f'{W} a tap picks a box, with four corners and its size', pg.locator(sel + '.is-picked .box-h').count() == 4 and pg.locator(sel + ' .box-size').count() == 1)
            check(f'{W} a picked box stops the page scrolling under a drag', pg.evaluate("getComputedStyle(document.querySelector('#check-wall svg')).touchAction") == 'none')
            pg.screenshot(path=f'{OUT}/check-picked-{W}.png')
            w0 = meta()
            h = pg.locator(sel + ' [data-hcorner="2"] .handle-dot').bounding_box()
            cx, cy = h['x'] + h['width'] / 2, h['y'] + h['height'] / 2
            pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 15, cy + 10, steps=5); pg.mouse.up(); pg.wait_for_timeout(1200)
            w1 = meta()
            check(f'{W} dragging a corner resizes the box', w1[0] > w0[0] and w1[1] > w0[1], f'{w0} to {w1}')
            row = pg.locator(f'input[data-ok="w"][data-oid="{oid}"]')
            check(f'{W} the row shows the new size', row.count() == 1 and abs(float(row.input_value()) - w1[0]) < 0.6, row.input_value() if row.count() else 'no row')
            box = pg.locator(sel + ' .owned-box-mark').bounding_box()
            mx, my = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            pg.mouse.move(mx, my); pg.mouse.down(); pg.mouse.move(mx - 20, my, steps=5); pg.mouse.up(); pg.wait_for_timeout(1200)
            check(f'{W} dragging the middle moves the box, same size', meta()[2] < w1[2] and meta()[0] == w1[0], f'{w1} to {meta()}')
        else:
            check(f'{W} the reader found a piece of yours to fix', False)
        # Mark a dresser, then say it is really a wall edge.
        vis(pg, 'a[href="#/things"]').click(); pg.wait_for_timeout(1200)
        vis(pg, '[data-add="dresser"]').click(); pg.wait_for_timeout(800)
        # A small outlet can be picked up and dragged: its touch area is at least 44 px.
        vis(pg, '[data-add="outlet"]').click(); pg.wait_for_timeout(800)
        og = pg.locator('#edit-wall .ob').last; oid2 = og.get_attribute('data-ob')
        hb = og.locator('.hit-pad').bounding_box() if og.locator('.hit-pad').count() else og.locator('.ob-box').bounding_box()
        check(f'{W} a small outlet has a 44 px touch area', hb['width'] >= 43.5 and hb['height'] >= 43.5, str(hb))
        ox0 = pg.evaluate(f"JSON.parse(localStorage.getItem('walldrobe.draft.v1')).obstacles.find(o => o.id === '{oid2}').x")
        bx = og.locator('.ob-box').bounding_box(); cx, cy = bx['x'] + bx['width'] / 2 + 12, bx['y'] + bx['height'] / 2
        pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 40, cy - 30, steps=6); pg.mouse.up(); pg.wait_for_timeout(1000)
        ox1 = pg.evaluate(f"JSON.parse(localStorage.getItem('walldrobe.draft.v1')).obstacles.find(o => o.id === '{oid2}').x")
        check(f'{W} a touch next to the outlet still drags it', ox1 > ox0 + 3, f'{ox0} to {ox1}')
        vis(pg, '.bar a').click(); pg.wait_for_timeout(1500)
        check(f'{W} back on the confirm screen with the dresser', '#/check' in pg.url and 'Dresser' in pg.evaluate('document.body.innerText'))
        fx = pg.locator('[data-fix][aria-label="Fix the Dresser"]')
        fx.first.click(); pg.wait_for_timeout(800)
        kind = pg.locator('select[data-obkind]')
        check(f'{W} Fix can say what it is', kind.count() == 1 and kind.input_value() == 'dresser')
        kind.select_option('edge'); pg.wait_for_timeout(1200)
        txt = pg.evaluate('document.body.innerText')
        check(f'{W} it becomes a wall edge, floor to ceiling', 'Wall edge' in txt and pg.evaluate("(() => { const i = document.querySelector('input[data-obk=h]'); return i && Number(i.value) >= 90; })()"))
        pg.screenshot(path=f'{OUT}/check-edge-{W}.png', full_page=True)
        sw = pg.evaluate('document.documentElement.scrollWidth')
        check(f'{W} the confirm screen has no sideways scroll', sw <= W, str(sw))
        vis(pg, '.dock a.btn').click(); pg.wait_for_timeout(9000)
        ok = pg.evaluate("""(() => {
          const svgs = [...document.querySelectorAll('.entry-link svg')];
          if (!svgs.length) return 'no walls';
          for (const s of svgs) {
            // Over a photo the corner is in the photo itself, so the edge is read from the saved wall.
            const d = JSON.parse(localStorage.getItem('walldrobe.draft.v1') || '{}');
            const e = (d.obstacles || []).find((o) => o.kind === 'edge');
            if (!e) return 'no edge saved';
            const x = e.x + e.w / 2;
            // Each piece's outer box: its biggest rect (the frame or the paper).
            const rs = [...s.querySelectorAll('g.art')].map((g) => [...g.querySelectorAll('rect')].sort((a, b) => b.getAttribute('width') * b.getAttribute('height') - a.getAttribute('width') * a.getAttribute('height'))[0]).filter(Boolean);
            if (!rs.length) return 'no art found to test';
            for (const r of rs) { const a = Number(r.getAttribute('x')), w = Number(r.getAttribute('width')); if (a < x && a + w > x) return 'art crosses the edge'; }
          }
          return 'ok';
        })()""")
        check(f'{W} no wall puts art across the edge', ok == 'ok', ok)
        # Saving a photo wall three times keeps the photo once.
        size = lambda: pg.evaluate("(() => { let n = 0, imgs = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length; if (k.startsWith('walldrobe.img.')) imgs++; } return [n, imgs, (localStorage.getItem('walldrobe.walls.v1') || '').length]; })()")
        pg.locator('.entry-link').first.click(); pg.wait_for_timeout(2000)
        before = size()
        for _ in range(3):
            sv = vis(pg, '.wall-acts [data-act=save]')
            if sv and sv.is_enabled(): sv.click(); pg.wait_for_timeout(800)
            vis(pg, '.pager [aria-label="Next wall"]').click(); pg.wait_for_timeout(1200)
        after = size()
        nwalls = pg.evaluate("JSON.parse(localStorage.getItem('walldrobe.walls.v1') || '[]').length")
        check(f'{W} three saved photo walls keep the photo once', nwalls >= 3 and after[1] <= before[1] + 1 and after[2] < 60000, f'{nwalls} walls, before {before}, after {after}')
        pg.reload(); pg.wait_for_timeout(4000)
        check(f'{W} a saved photo wall still shows its photo after a reload', pg.evaluate("(() => { const w = JSON.parse(localStorage.getItem('walldrobe.walls.v1'))[0]; return JSON.stringify(w).includes('$img'); })()") and pg.locator('svg image').count() > 0, pg.url)
        check(f'{W} no errors on the photo path', not errs, '; '.join(errs[:2]))
        ctx.close()
    b.close()

for name, ok, detail in results:
    print(('ok  ' if ok else 'FAIL'), name, detail)
print(f'{len(results) - len(fails)} of {len(results)} passed')
sys.exit(1 if fails else 0)
