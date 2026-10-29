// Pruebas de la portada (index.html) en un navegador real (Chromium + Playwright).
// No forman parte del sitio: Vercel las ignora (.vercelignore).
//
// Correr:  cd test && npm install && npx playwright install chromium && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
test.after(async () => {
  await browser.close();
  server.close();
});

async function open({ width = 390, height = 844, reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, reducedMotion });
  const page = await ctx.newPage();
  // Sin red externa (Google Fonts): la página tiene que funcionar igual.
  await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  return { ctx, page, metrics };
}
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// ── Animaciones del hero ─────────────────────────────────────────────────
test('hero quieto en pantalla: las animaciones no recalculan el layout de la página', async () => {
  const { ctx, page, metrics } = await open();
  await page.waitForTimeout(500);
  const m0 = await metrics();
  await page.waitForTimeout(1500);
  const m1 = await metrics();
  await ctx.close();
  // Antes: el punto del indicador de scroll animaba `top` → un layout por cuadro (~90 en 1,5 s).
  assert.ok(m1.LayoutCount - m0.LayoutCount <= 2, `layouts en reposo: ${m1.LayoutCount - m0.LayoutCount}`);
});

test('indicador de scroll: el punto baja 38px y se desvanece, como siempre', async () => {
  const { ctx, page } = await open();
  const kf = await page.evaluate(() => {
    const a = document.getAnimations().find((x) => x.animationName === 'cueDrop');
    return { frames: a.effect.getKeyframes().map(({ offset, opacity, top, transform }) => ({ offset, opacity, top, transform })), duration: a.effect.getTiming().duration, iterations: a.effect.getTiming().iterations };
  });
  await ctx.close();
  assert.equal(kf.duration, 2800);
  assert.equal(kf.iterations, Infinity);
  assert.deepEqual(kf.frames.map((f) => f.offset), [0, 0.2, 0.8, 1]);
  assert.deepEqual(kf.frames.map((f) => f.opacity ?? null), ['0', '1', '1', '0']);
  assert.ok(kf.frames.every((f) => f.top === undefined), 'no anima `top`');
  assert.equal(kf.frames[0].transform, 'translateY(0px)');
  assert.equal(kf.frames.at(-1).transform, 'translateY(38px)');
});

test('hero fuera de pantalla: sus animaciones se pausan; al volver, siguen', async () => {
  const { ctx, page } = await open();
  const heroAnims = () =>
    page.evaluate(() =>
      document.getAnimations()
        .filter((a) => a.effect.target.closest?.('.hero') || a.effect.target === document.querySelector('.scroll-cue'))
        .map((a) => a.playState)
    );
  assert.ok((await heroAnims()).length >= 6);
  assert.ok((await heroAnims()).every((s) => s === 'running'));
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.hero').offsetHeight + 400));
  await page.waitForTimeout(300);
  assert.ok((await heroAnims()).every((s) => s === 'paused'), 'pausadas fuera de pantalla');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  assert.ok((await heroAnims()).every((s) => s === 'running'), 'vuelven a correr');
  await ctx.close();
});

// ── Foto con parallax ────────────────────────────────────────────────────
// La fórmula de siempre: ±45px según cuánto recorrió la sección la pantalla.
const expectedOffset = ({ top, height, vh }) => ((vh - top) / (vh + height) - 0.5) * 90;

test('foto: el parallax sigue la misma fórmula al scrollear', async () => {
  const { ctx, page } = await open();
  const pbTop = await page.evaluate(() => document.querySelector('.photobreak').getBoundingClientRect().top + scrollY);
  for (const delta of [-600, -300, 0, 200]) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, pbTop + delta));
    await frame(page);
    const s = await page.evaluate(() => {
      const r = document.querySelector('.photobreak').getBoundingClientRect();
      const m = document.getElementById('pbInner').style.transform.match(/translateY\(([-\d.e]+)px\)/);
      return { top: r.top, height: r.height, vh: innerHeight, applied: m && Number(m[1]) };
    });
    assert.ok(s.applied !== null, `aplica el transform (delta ${delta})`);
    assert.ok(Math.abs(s.applied - expectedOffset(s)) < 0.01, `delta ${delta}: ${s.applied} vs ${expectedOffset(s)}`);
  }
  await ctx.close();
});

test('foto: lejos de la foto, scrollear no mide la página en cada evento', async () => {
  const { ctx, page, metrics } = await open();
  await page.waitForTimeout(300);
  const m0 = await metrics();
  for (let y = 0; y < 1200; y += 40) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.evaluate(() => document.body.offsetHeight); // fuerza a que se procese el scroll
  }
  const m1 = await metrics();
  await ctx.close();
  assert.ok(m1.LayoutCount - m0.LayoutCount <= 40, `layouts: ${m1.LayoutCount - m0.LayoutCount}`);
});

test('foto: con «reducir movimiento» no hay parallax ni zoom', async () => {
  const { ctx, page } = await open({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => document.getElementById('pbInner').classList.contains('pb-visible')), true);
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.photobreak').offsetTop - 300));
  await frame(page);
  assert.equal(await page.evaluate(() => document.getElementById('pbInner').style.transform), '');
  await ctx.close();
});

test('foto: en el celular baja una versión del tamaño de la pantalla, no la de 1792px (y en WebP)', async () => {
  const { ctx, page } = await open({ width: 390 });
  await page.evaluate(() => window.scrollTo(0, document.querySelector('.photobreak').offsetTop - 200));
  await page.waitForFunction(() => document.querySelector('.photobreak__img').complete);
  const src = await page.evaluate(() => document.querySelector('.photobreak__img').currentSrc);
  await ctx.close();
  assert.match(src, /cuerpo-movimiento-1200\.webp$/);
});

// ── Fuentes ──────────────────────────────────────────────────────────────
// Variantes que la página usa pero que el navegador dibuja con otra que sí se pide.
const DRAWN_WITH = {
  'DM Sans|700|normal': 'DM Sans|600|normal', // negritas dentro del texto
  'Bodoni Moda|300|normal': 'Bodoni Moda|400|normal', // invitación: Bodoni 300 nunca se pidió
};

function loadedFaces(href) {
  const loaded = new Set();
  for (const fam of new URL(href).searchParams.getAll('family')) {
    const [name, spec] = fam.split(':');
    const [axes, values] = spec.split('@');
    const keys = axes.split(',');
    for (const tuple of values.split(';')) {
      const v = Object.fromEntries(tuple.split(',').map((x, i) => [keys[i], x]));
      loaded.add(`${name.replace(/\+/g, ' ')}|${v.wght}|${v.ital === '1' ? 'italic' : 'normal'}`);
    }
  }
  return loaded;
}

for (const path of ['/', '/invitacion.html']) {
  test(`fuentes (${path}): todo texto, también el oculto, usa una variante que se pide a Google Fonts`, async () => {
    const used = new Set();
    let href;
    for (const width of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
      await page.goto(`${BASE}${path}`);
      // Estados que no se ven al cargar: menú abierto y mensajes del formulario.
      await page.evaluate(() => {
        document.getElementById('nav')?.classList.add('is-open');
        document.querySelectorAll('#formOk,#formErr').forEach((e) => e.classList.add('is-shown'));
      });
      const res = await page.evaluate(() => ({
        href: document.querySelector('link[href*="fonts.googleapis.com/css2"]').href,
        used: [...document.querySelectorAll('body *')]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
          .map((el) => {
            const cs = getComputedStyle(el);
            return `${cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()}|${cs.fontWeight}|${cs.fontStyle}`;
          }),
      }));
      href = res.href;
      res.used.forEach((u) => used.add(u));
      await ctx.close();
    }
    const loaded = loadedFaces(href);
    const missing = [...used]
      .filter((u) => /^(Bodoni Moda|Cormorant|DM Sans)\|/.test(u))
      .filter((u) => !loaded.has(u) && !loaded.has(DRAWN_WITH[u]));
    assert.deepEqual(missing, []);
  });
}
