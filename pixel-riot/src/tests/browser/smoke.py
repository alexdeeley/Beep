#!/usr/bin/env python3
"""Automated browser smoke test (headless Chromium via Playwright).

Runs the real app over HTTP and drives it with REAL input events:
mouse taps/drags, and multi-finger touch through the Chrome DevTools Protocol
(Input.dispatchTouchEvent -> Pointer Events). Checks for page/console errors,
gesture recognition, audio start on gesture, every settings panel, renderer
switching, resolution/orientation changes, presets, composition round-trip and
persistence across reload. Writes screenshots to src/tests/browser/out/.

Usage:  python3 src/tests/browser/smoke.py            (starts its own server)
        BASE_URL=http://localhost:8080 python3 ...    (use a running server)
Requires: pip install playwright && playwright install chromium

This is NOT a substitute for a real iPhone/iPad: see TESTING.md for the manual checklist.
"""
import asyncio, json, os, socket, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / 'out'
OUT.mkdir(exist_ok=True)
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

async def touch(cdp, kind, points):
    await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i, 'radiusX': 4, 'radiusY': 4, 'force': 0.5} for i, (x, y) in points]})

async def main():
    server = None
    base = os.environ.get('BASE_URL')
    if not base:
        port = free_port()
        server = subprocess.Popen(['node', str(ROOT / 'serve.mjs'), str(port)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f'http://127.0.0.1:{port}'
        time.sleep(0.8)
    url = base + '/?nosw'
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
            page = await ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
            page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
            page.on('dialog', lambda d: asyncio.ensure_future(d.accept('SMOKE PRESET')))
            await page.goto(url)
            await page.wait_for_function('window.pixelRiot && window.pixelRiot.services.clock.frame > 10', timeout=8000)
            ev = lambda js: page.evaluate(js)

            d = json.loads(await ev('JSON.stringify(pixelRiot.diagnostics())'))
            bad = [x for x in d['plugins'] if x['status'] != 'active']
            check('boot: all plugins active', not bad, ', '.join(f"{x['id']}={x['status']}" for x in bad))
            lit = await ev("""(() => { const c = document.getElementById('stage'); const g = document.createElement('canvas'); g.width = 60; g.height = 120;
                const x = g.getContext('2d'); x.drawImage(c, 0, 0, 60, 120); const d = x.getImageData(0, 0, 60, 120).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 60) n++; return n; })()""")
            check('first frame is not blank', lit > 50, f'{lit} lit samples')

            cdp = await ctx.new_cdp_session(page)
            # --- single touch tap, then audio should be running
            await touch(cdp, 'touchStart', [(0, (120, 300))]); await page.wait_for_timeout(50); await touch(cdp, 'touchEnd', [])
            await page.wait_for_timeout(300)
            check('audio starts from a user gesture', (await ev('pixelRiot.services.audio.state')) == 'running')
            # --- touch swipe
            await touch(cdp, 'touchStart', [(0, (40, 600))])
            for k in range(1, 16):
                await touch(cdp, 'touchMove', [(0, (40 + k * 20, 600 - k * 10))]); await page.wait_for_timeout(8)
            await touch(cdp, 'touchEnd', [])
            # --- long press
            await touch(cdp, 'touchStart', [(0, (200, 420))]); await page.wait_for_timeout(1300)
            lvl = await ev("Math.max(0, ...pixelRiot.services.effects.instances.filter(i => i.effectId === 'charge-field').map(i => i.state.level))")
            await touch(cdp, 'touchEnd', [])
            check('long press charges energy', lvl > 0.2, f'level {lvl:.2f}')
            # --- five-finger multitouch, then two-finger spread + rotate
            pts = [(i, (60 + i * 60, 500)) for i in range(5)]
            await touch(cdp, 'touchStart', pts); await page.wait_for_timeout(60)
            active = await ev('pixelRiot.services.pointers.activeCount()')
            await touch(cdp, 'touchEnd', [])
            check('five simultaneous pointers tracked', active == 5, f'{active}')
            await touch(cdp, 'touchStart', [(0, (180, 400)), (1, (210, 400))])
            for k in range(1, 20):
                a = k * 0.05
                await touch(cdp, 'touchMove', [(0, (195 - 5 * k * 1.0, 400 - 3 * k)), (1, (195 + 5 * k * 1.0, 400 + 3 * k))]); await page.wait_for_timeout(16)
            await touch(cdp, 'touchEnd', [])
            await page.wait_for_timeout(200)
            g = json.loads(await ev('JSON.stringify(pixelRiot.diagnostics().gestures)'))
            for t in ['press', 'tap', 'drag', 'swipe', 'hold:start', 'hold:release', 'multi:start', 'pinch', 'rotate', 'spread', 'multi:count']:
                check(f'gesture recognized from real touch input: {t}', g.get(t, 0) > 0, str(g.get(t, 0)))
            await page.screenshot(path=str(OUT / 'after-touch.png'))

            # --- mouse input
            await page.mouse.click(300, 250); await page.wait_for_timeout(80); await page.mouse.click(301, 250)
            g2 = json.loads(await ev('JSON.stringify(pixelRiot.diagnostics().gestures)'))
            check('mouse double tap recognized', g2.get('doubletap', 0) > g.get('doubletap', 0))
            check('sounds were scheduled', (await ev('pixelRiot.services.audio.played')) > 3)

            # --- UI: quick bar + every settings panel
            for label in ['PALETTE', 'PATTERN', 'EFFECT']:
                await page.locator('.pr-bottom .pr-btn', has_text=label).first.click()
            await page.locator('.pr-bottom .pr-btn', has_text='RANDOM').click()
            await page.locator('.pr-top-btns .pr-btn', has_text='MENU').click()
            panels = page.locator('details.pr-panel')
            n = await panels.count()
            for i in range(n):
                det = panels.nth(i)
                if not await det.evaluate('d => d.open'): await det.locator('summary').click()
            await page.wait_for_timeout(300)
            panel_errors = await page.locator('.pr-err', has_text='PANEL ERROR').count()
            check(f'all {n} settings panels render', n >= 12 and panel_errors == 0, f'{n} panels, {panel_errors} errors')
            await page.screenshot(path=str(OUT / 'settings-sheet.png'))
            # click a few real controls inside the sheet
            await page.locator('.pr-panel button', has_text='REDUCED FLASHING').first.click()
            check('reduced flashing toggle works', await ev("pixelRiot.services.settings.get('a11y.reducedFlash')") is True)
            await page.locator('.pr-panel button', has_text='DOT MATRIX').first.click(); await page.wait_for_timeout(300)
            check('renderer switch (dot matrix)', (await ev('pixelRiot.rendererId')) == 'ex.dot-matrix')
            await page.screenshot(path=str(OUT / 'dot-matrix.png'))
            await page.locator('.pr-panel button', has_text='CANVAS 2D').first.click()
            await page.locator('.pr-panel button', has_text='SAVE CURRENT').first.click(); await page.wait_for_timeout(200)
            check('save preset via UI', 'SMOKE PRESET' in await ev("JSON.stringify(pixelRiot.services.presets.list())"))
            await page.locator('.pr-sheet-head .pr-btn', has_text='CLOSE').click()

            # --- every preset + resolution + orientation
            ids = await ev('pixelRiot.services.presets.list().map(p => p.id)')
            for pid in ids:
                await ev(f"pixelRiot.services.presets.load('{pid}')"); await page.mouse.click(150, 400); await page.wait_for_timeout(120)
            check(f'all {len(ids)} presets load', len(ids) >= 15)
            for res in ['coarse', 'standard', 'detailed', 'dense', 'adaptive']:
                await ev(f"pixelRiot.services.settings.set('grid.resolution', '{res}')"); await page.wait_for_timeout(150)
            await ev("pixelRiot.services.settings.set('grid.resolution', 'dense')"); await page.wait_for_timeout(400)
            fps_dense = await ev('pixelRiot.services.perf.stats().fps')
            await page.set_viewport_size({'width': 844, 'height': 390}); await page.wait_for_timeout(500)
            dims = await ev('[pixelRiot.services.grid.cols, pixelRiot.services.grid.rows]')
            check('orientation change re-lays the grid', dims[0] > dims[1], str(dims))
            await page.screenshot(path=str(OUT / 'landscape-dense.png'))
            await ev("pixelRiot.services.settings.set('grid.resolution', 'adaptive')")
            await page.set_viewport_size({'width': 390, 'height': 844}); await page.wait_for_timeout(300)

            # --- composition round trip + persistence across reload
            await ev("pixelRiot.services.presets.load('neon-cathedral')")
            await page.mouse.move(60, 600); await page.mouse.down()
            for k in range(25): await page.mouse.move(60 + k * 10, 600 - k * 12); await page.wait_for_timeout(10)
            await page.mouse.up(); await page.wait_for_timeout(1800)
            ink = await ev('pixelRiot.services.grid.ink.reduce((a, b) => a + b, 0)')
            comp = await ev('pixelRiot.exportComposition()')
            await ev('pixelRiot.clearArtwork()')
            r = json.loads(await ev(f'JSON.stringify(pixelRiot.importComposition({json.dumps(comp)}))'))
            check('composition export/import round trip', r.get('ok') and ink > 0.5, f'ink {ink:.2f}')
            await page.wait_for_timeout(300)
            await page.reload(); await page.wait_for_function('window.pixelRiot && window.pixelRiot.services.clock.frame > 5')
            cur = await ev('pixelRiot.services.presets.current.id')
            ink2 = await ev('pixelRiot.services.grid.ink.reduce((a, b) => a + b, 0)')
            check('instrument + artwork persist across reload', cur == 'neon-cathedral' and ink2 > 0.2, f'{cur} ink {ink2:.2f}')
            check('reduced-flash setting persisted', await ev("pixelRiot.services.settings.get('a11y.reducedFlash')") is True)

            # --- sustained stress: autoplay + random taps for a few seconds
            await ev("pixelRiot.services.settings.set('ext.ex.autoplay.enabled', true)")
            for i in range(60):
                await page.mouse.click(30 + (i * 37) % 330, 120 + (i * 53) % 600); await page.wait_for_timeout(30)
            await page.wait_for_timeout(1500)
            st = json.loads(await ev('JSON.stringify(pixelRiot.services.perf.stats())'))
            check('limits hold under stress', st['effects'] <= 160 and st['particles'] <= 2400 and st['voices'] <= 24, json.dumps({k: st[k] for k in ('fps', 'effects', 'particles', 'voices', 'quality')}))
            await ev("pixelRiot.services.settings.set('ext.ex.autoplay.enabled', false)")
            await page.screenshot(path=str(OUT / 'stress.png'))
            check('no page or console errors', not errors, ' | '.join(errors[:5]))
            print(f'INFO headless fps (software rendering, not representative): dense={fps_dense}, stress={st["fps"]}')
            await browser.close()
    finally:
        if server: server.terminate()
    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)

asyncio.run(main())
