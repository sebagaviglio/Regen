#!/usr/bin/env python3
"""Verificación visual de la web (HTML estático, sin compilar): sirve el sitio tal
como está (el cambio) y como está en una rama base (por defecto origin/main), abre
las mismas páginas en los dos con la red externa cortada y los Workers simulados,
congela las animaciones, saca capturas y las compara píxel a píxel.

Uso (desde la raíz del repo):
    python3 .claude/skills/verify/verify.py                 # cambio vs origin/main
    python3 .claude/skills/verify/verify.py --base HEAD~1   # contra otro commit
    python3 .claude/skills/verify/verify.py --solo          # solo el cambio, sin comparar

Las pantallas, los datos simulados y la clave de sesión están en verify.json, al lado.
Deja capturas, diferencias e informe en --out (por defecto: una carpeta temporal) y
termina con una tabla por página. Requiere Python con playwright y Pillow.
"""
import argparse, asyncio, base64, functools, http.server, json, os, shutil, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CFG = json.load(open(os.path.join(HERE, 'verify.json'), encoding='utf-8'))
ENV = {**os.environ, 'VITE_SUPABASE_URL': 'https://ejemplo.supabase.co', 'VITE_SUPABASE_ANON_KEY': 'clave-ficticia'}
FROZEN_AT_MS = 1_793_000_000_000  # reloj fijo (nov 2026) para que fechas y "hace X" no cambien entre corridas


def sh(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, env=ENV, shell=True, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'Falló «{cmd}» en {cwd}:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}')
    return r.stdout


def build(src, out):
    # Sitio estático: se sirve tal cual (sin la carpeta de pruebas).
    shutil.copytree(src, out, ignore=shutil.ignore_patterns('.git', 'test', 'node_modules', '.claude'))


def checkout_base(ref, dest):
    sh(f'git archive "{ref}" | tar -x -C "{dest}"', ROOT)


def serve(dist):
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def send_head(self):
            return super().send_head()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=dist))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{srv.server_port}'


def session_json():
    b64 = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
    exp = FROZEN_AT_MS // 1000 + 10 * 365 * 86400
    jwt = b64({'alg': 'HS256'}) + '.' + b64({'sub': 'u1', 'exp': exp, 'role': 'authenticated', 'aud': 'authenticated'}) + '.firma'
    user = {'id': 'u1', 'aud': 'authenticated', 'role': 'authenticated', 'email': CFG.get('email', 'prueba@regen.ar'),
            'app_metadata': {}, 'user_metadata': {}, 'created_at': '2026-01-01T00:00:00Z'}
    return json.dumps({'access_token': jwt, 'refresh_token': 'r', 'expires_at': exp, 'expires_in': 3600, 'token_type': 'bearer', 'user': user})


PNG_1PX = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==')
FREEZE_JS = '''() => {
  document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = 1000; } catch (e) {} });
  document.querySelectorAll('svg').forEach((s) => { s.pauseAnimations?.(); s.setCurrentTime?.(1); });
  document.querySelectorAll('video').forEach((v) => { v.pause(); try { v.currentTime = 0; } catch (e) {} });
  document.querySelectorAll('canvas').forEach((c) => { c.style.visibility = 'hidden'; }); // lo que se dibuja solo se compara aparte
}'''


async def shoot(base_url, outdir):
    from playwright.async_api import async_playwright
    os.makedirs(outdir, exist_ok=True)
    report = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for screen in CFG['screens']:
            for vw, vh in CFG.get('viewports', [[390, 844], [1280, 900]]):
                ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, device_scale_factor=1, reduced_motion=screen.get('reducedMotion', 'no-preference'))
                if screen.get('logged'):
                    await ctx.add_init_script(f"localStorage.setItem({json.dumps(CFG['storageKey'])}, {json.dumps(session_json())});")
                for k, v in (screen.get('localStorage') or {}).items():
                    await ctx.add_init_script(f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)});")
                page = await ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                fixtures = {**CFG['fixtures'], **(screen.get('fixtures') or {})}

                async def route(r, *_ignored, fixtures=fixtures):
                    url = r.request.url
                    if CFG['workerHost'] in url:
                        path = url.split(CFG['workerHost'], 1)[1].split('?')[0]
                        if path.startswith('/interview/file'):
                            return await r.fulfill(status=200, content_type='image/png', headers={'access-control-allow-origin': '*'}, body=PNG_1PX)
                        body = fixtures.get(path, {})
                        return await r.fulfill(status=200, content_type='application/json',
                                               headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}, body=json.dumps(body))
                    if url.startswith(base_url):
                        return await r.continue_()
                    return await r.abort()  # sin red externa (fuentes, Supabase, analytics)
                await page.route('**/*', route)
                await page.clock.install(time=FROZEN_AT_MS / 1000)
                if CFG.get('pauseClock'):
                    # El tiempo solo avanza con run_for: las animaciones hechas con JS quedan iguales en cada corrida.
                    await page.clock.pause_at((FROZEN_AT_MS + 1000) / 1000)
                await page.goto(base_url + screen['path'])
                if CFG.get('pauseClock'):
                    await page.clock.run_for(1500)
                ok = True
                try:
                    await page.wait_for_selector(screen['ready'], timeout=8000)
                except Exception:
                    ok = False
                for step in screen.get('click', []):
                    try:
                        await page.click(step, timeout=4000)
                        await page.clock.run_for(250)
                    except Exception:
                        errors.append(f'no pude hacer clic en {step}')
                if screen.get('scroll', True):
                    height = await page.evaluate('document.documentElement.scrollHeight')
                    for y in range(0, height, 400):
                        await page.evaluate(f'window.scrollTo(0, {y})')
                        await page.clock.run_for(60)
                    await page.clock.run_for(2000)
                    await page.evaluate('window.scrollTo(0, 0)')
                await page.clock.run_for(400)
                await page.evaluate(FREEZE_JS)
                name = f"{screen['name']}-{vw}"
                await page.screenshot(path=os.path.join(outdir, name + '.png'), full_page=True)
                report[name] = {'listo': ok, 'errores': errors}
                await ctx.close()
        await browser.close()
    return report


def compare(a_dir, b_dir, out):
    from PIL import Image, ImageChops
    rows = []
    for f in sorted(os.listdir(b_dir)):
        if not f.endswith('.png'):
            continue
        a_path, b_path = os.path.join(a_dir, f), os.path.join(b_dir, f)
        if not os.path.exists(a_path):
            rows.append((f[:-4], 'nueva (no existe en la base)'))
            continue
        a, b = Image.open(a_path).convert('RGB'), Image.open(b_path).convert('RGB')
        if a.size != b.size:
            rows.append((f[:-4], f'cambió el alto: {a.size[1]}px → {b.size[1]}px'))
            continue
        d = ImageChops.difference(a, b)
        box = d.getbbox()
        if not box:
            rows.append((f[:-4], 'idéntica'))
            continue
        crop = [max(px) for px in d.crop(box).getdata()]
        d.point(lambda v: min(255, v * 6)).save(os.path.join(out, 'diff-' + f))
        rows.append((f[:-4], f'difiere en x{box[0]}–{box[2]}, y{box[1]}–{box[3]}: máx {max(crop)}/255, {sum(v > 8 for v in crop)} píxeles visibles'))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='origin/main')
    ap.add_argument('--out', default=None)
    ap.add_argument('--solo', action='store_true', help='solo capturas del cambio, sin comparar')
    args = ap.parse_args()
    out = args.out or tempfile.mkdtemp(prefix='verify-')
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='verify-build-')
    try:
        print('· Sirviendo el cambio…')
        build(ROOT, os.path.join(work, 'dist-cambio'))
        report = {'cambio': asyncio.run(shoot(serve(os.path.join(work, 'dist-cambio')), os.path.join(out, 'cambio')))}
        rows = []
        if not args.solo:
            print(f'· Sirviendo la base ({args.base})…')
            base_src = os.path.join(work, 'base')
            os.makedirs(base_src)
            checkout_base(args.base, base_src)
            build(base_src, os.path.join(work, 'dist-base'))
            report['base'] = asyncio.run(shoot(serve(os.path.join(work, 'dist-base')), os.path.join(out, 'base')))
            rows = compare(os.path.join(out, 'base'), os.path.join(out, 'cambio'), out)
        json.dump({'informe': report, 'comparacion': rows}, open(os.path.join(out, 'informe.json'), 'w'), ensure_ascii=False, indent=1)
        print(f'\nCapturas e informe en: {out}\n')
        for name, r in report['cambio'].items():
            flag = '' if r['listo'] else '  ⚠ no apareció la pantalla esperada'
            errs = f"  ⚠ errores: {r['errores']}" if r['errores'] else ''
            cmp = dict(rows).get(name, '')
            print(f'  {name:28} {cmp}{flag}{errs}')
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
