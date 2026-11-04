// Pruebas de la voz para inversores (inversores/index.html) en un navegador real.
// No hay red: el Worker y OpenAI se simulan con page.route, y la conexión WebRTC con
// un RTCPeerConnection falso cuyo canal de datos maneja la prueba (window.__emit).
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
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const WORKER = 'https://regen-agente.sebagaviglio.workers.dev';
const browser = await chromium.launch();
test.after(async () => {
  await browser.close();
  server.close();
});

// RTCPeerConnection y micrófono falsos. El canal de datos guarda lo que la página
// manda (window.__sent) y la prueba le inyecta eventos del servidor (window.__emit).
const FAKE_RTC = () => {
  window.__sent = [];
  class FakeDC extends EventTarget {
    constructor() { super(); this.readyState = 'connecting'; }
    send(s) { window.__sent.push(JSON.parse(s)); }
    close() { this.readyState = 'closed'; }
  }
  class FakePC {
    constructor() { this.connectionState = 'new'; window.__pc = this; }
    addTrack() {}
    createDataChannel() { this.dc = new FakeDC(); window.__dc = this.dc; return this.dc; }
    async createOffer() { return { type: 'offer', sdp: 'v=0 oferta-falsa' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {
      this.connectionState = 'connected';
      setTimeout(() => { this.dc.readyState = 'open'; this.dc.dispatchEvent(new Event('open')); }, 0);
    }
    close() { this.connectionState = 'closed'; }
  }
  window.RTCPeerConnection = FakePC;
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    return dest.stream;
  };
  window.__emit = (ev) => window.__dc.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(ev) }));
};

async function open({ sessionStatus = 200, sessionBody } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const calls = { session: [], event: [], end: [], sdp: [] };
  await page.addInitScript(FAKE_RTC);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(BASE)) return route.continue();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (url === `${WORKER}/investor/session`) {
      calls.session.push(req.postDataJSON());
      return route.fulfill({ status: sessionStatus, headers: cors, body: JSON.stringify(sessionBody ?? { callId: 'call-1', clientSecret: 'ek_test', model: 'gpt-realtime', maxSeconds: 900 }) });
    }
    if (url === `${WORKER}/investor/event`) {
      calls.event.push(req.postDataJSON());
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, message: 'Contacto guardado.' }) });
    }
    if (url === `${WORKER}/investor/end`) {
      calls.end.push(req.postDataJSON());
      return route.fulfill({ status: 200, headers: cors, body: '{"ok":true}' });
    }
    if (url === 'https://api.openai.com/v1/realtime/calls') {
      calls.sdp.push({ auth: req.headers().authorization, body: req.postData() });
      return route.fulfill({ status: 201, headers: { 'Content-Type': 'application/sdp', 'Access-Control-Allow-Origin': '*' }, body: 'v=0 respuesta-falsa' });
    }
    return route.abort(); // sin red externa (Google Fonts incluido)
  });
  await page.goto(`${BASE}/inversores/`, { waitUntil: 'load' });
  return { page, ctx, calls };
}

const sent = (page) => page.evaluate(() => window.__sent);
const emit = (page, ev) => page.evaluate((e) => window.__emit(e), ev);

const fillContact = async (page) => {
  await page.fill('#email', 'ana@lab.com.ar');
  await page.fill('#phone', '+54 9 351 555 1234');
};

test('sin perfil, email, celular y aviso no se puede empezar', async () => {
  const { page, ctx } = await open();
  assert.equal(await page.isDisabled('#start'), true);
  await page.click('[data-profile="socio"]');
  await page.check('#consent');
  assert.equal(await page.isDisabled('#start'), true, 'falta el contacto');
  await page.fill('#email', 'ana arroba lab');
  await page.fill('#phone', '+54 9 351 555 1234');
  assert.equal(await page.isDisabled('#start'), true, 'email inválido');
  await page.fill('#email', 'ana@lab.com.ar');
  await page.fill('#phone', '123');
  assert.equal(await page.isDisabled('#start'), true, 'celular inválido');
  await page.fill('#phone', '+54 9 351 555 1234');
  assert.equal(await page.isDisabled('#start'), false);
  assert.equal(await page.getAttribute('[data-profile="socio"]', 'aria-checked'), 'true');
  await page.screenshot({ path: '/tmp/inversores-inicio.png', fullPage: true });
  await ctx.close();
});

test('llamada completa: saludo, subtítulos, herramienta, pregunta escrita y cierre', async () => {
  const { page, ctx, calls } = await open();
  await page.click('[data-profile="especialista"]');
  await fillContact(page);
  await page.check('#consent');
  await page.click('#start');
  await page.waitForSelector('#end', { state: 'visible' });

  // Pidió la sesión con el perfil y la versión del aviso que espera el Worker.
  assert.deepEqual(calls.session[0], { profile: 'especialista', consent: true, consentVersion: 'inv-2026-11-04b', email: 'ana@lab.com.ar', phone: '+54 9 351 555 1234' });
  // El SDP va a OpenAI con la clave efímera, no con una clave propia.
  assert.equal(calls.sdp[0].auth, 'Bearer ek_test');
  assert.equal(calls.sdp[0].body, 'v=0 oferta-falsa');
  // Abrió el canal y pidió el saludo. Nunca manda session.update (las instrucciones son del servidor).
  let out = await sent(page);
  assert.deepEqual(out[0], { type: 'response.create' });
  assert.ok(!out.some((e) => e.type === 'session.update'));

  // El asistente habla: los subtítulos se arman con los deltas.
  await emit(page, { type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Hola, soy la voz ' });
  await emit(page, { type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'de REGEN.' });
  await emit(page, { type: 'response.output_audio_transcript.done', item_id: 'a1', transcript: 'Hola, soy la voz de REGEN.' });
  await emit(page, { type: 'response.done', response: { output: [{ type: 'message' }] } });
  await emit(page, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Quiero dejar mi contacto.' });
  assert.match(await page.textContent('#captions'), /Hola, soy la voz de REGEN\.[\s\S]*Quiero dejar mi contacto\./);

  // El modelo llama a save_contact: la página lo persiste en el Worker y pide UNA respuesta.
  const before = (await sent(page)).length;
  const args = JSON.stringify({ name: 'Ana Pérez', email: 'ana@lab.com.ar', interest: 'arquitectura' });
  await emit(page, { type: 'response.function_call_arguments.done', call_id: 'c1', name: 'save_contact', arguments: args });
  await emit(page, { type: 'response.done', response: { output: [{ type: 'function_call', call_id: 'c1', name: 'save_contact', arguments: args }] } });
  await page.waitForFunction((n) => window.__sent.length >= n + 2, before);
  assert.deepEqual(calls.event[0], { callId: 'call-1', tool: 'save_contact', args: JSON.parse(args) });
  out = (await sent(page)).slice(before);
  assert.equal(out[0].type, 'conversation.item.create');
  assert.equal(out[0].item.type, 'function_call_output');
  assert.equal(out[0].item.call_id, 'c1');
  assert.equal(out.filter((e) => e.type === 'response.create').length, 1);
  await page.waitForSelector('text=Contacto guardado para la dirección');

  // Pregunta escrita.
  await page.fill('#typed-input', '¿Cómo es el harness de evals?');
  await page.click('#typed button');
  out = await sent(page);
  const typed = out.find((e) => e.type === 'conversation.item.create' && e.item.type === 'message');
  assert.equal(typed.item.content[0].text, '¿Cómo es el harness de evals?');
  await page.screenshot({ path: '/tmp/inversores-llamada.png', fullPage: true });

  // Cierre: manda la transcripción y muestra lo que quedó guardado.
  await page.click('#end');
  await page.waitForSelector('#done', { state: 'visible' });
  const end = calls.end[0];
  assert.equal(end.callId, 'call-1');
  assert.equal(end.reason, 'usuario');
  assert.deepEqual(end.transcript.map((t) => t.role), ['assistant', 'user', 'user']);
  assert.match(await page.textContent('#done'), /recibe un resumen/);
  await page.screenshot({ path: '/tmp/inversores-fin.png', fullPage: true });
  await ctx.close();
});

test('si el Worker rechaza la llamada se muestra su mensaje y se puede reintentar', async () => {
  const { page, ctx, calls } = await open({ sessionStatus: 429, sessionBody: { error: 'Hiciste varias llamadas seguidas.', code: 'IP_LIMIT' } });
  await page.click('[data-profile="inversor"]');
  await fillContact(page);
  await page.check('#consent');
  await page.click('#start');
  await page.waitForSelector('#status.err');
  assert.match(await page.textContent('#status'), /varias llamadas seguidas/);
  assert.equal(await page.isDisabled('#start'), false);
  assert.equal(calls.sdp.length, 0);
  assert.equal(calls.end.length, 0);
  await ctx.close();
});

test('el botón para empezar se ve sin scrollear en laptop y celular', async () => {
  for (const [width, height] of [[1280, 720], [1440, 900], [390, 844], [360, 740]]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
    await page.goto(`${BASE}/inversores/`, { waitUntil: 'load' });
    const bottom = await page.evaluate(() => document.querySelector('#start').getBoundingClientRect().bottom);
    assert.ok(bottom <= height, `${width}x${height}: el botón termina en ${Math.round(bottom)}px`);
    await ctx.close();
  }
});

test('durante la llamada la conversación ocupa la pantalla y no se pierde el control', async () => {
  const { page, ctx } = await open();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-profile="inversor"]');
  await fillContact(page);
  await page.check('#consent');
  await page.click('#start');
  await page.waitForSelector('#end', { state: 'visible' });
  for (let i = 0; i < 14; i++) {
    await emit(page, { type: 'response.output_audio_transcript.done', item_id: `a${i}`, transcript: `Respuesta número ${i} de REGEN, con un texto bastante largo para llenar la pantalla del celular.` });
    await emit(page, { type: 'conversation.item.input_audio_transcription.completed', item_id: `u${i}`, transcript: `Pregunta ${i}` });
  }
  const m = await page.evaluate(() => {
    const t = document.querySelector('#captions');
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { page: document.documentElement.scrollHeight, vh: innerHeight, atEnd: t.scrollHeight - t.scrollTop - t.clientHeight < 5, end: r('#end').bottom, input: r('#typed-input').bottom };
  });
  assert.ok(m.page <= m.vh + 1, 'la página no scrollea: scrollea solo la conversación');
  assert.ok(m.atEnd, 'sigue el último mensaje');
  assert.ok(m.end <= m.vh && m.input <= m.vh, 'colgar y escribir siempre visibles');
  // Si sube a releer, no lo arrastra hacia abajo y aparece "Ir al final".
  await page.evaluate(() => { const t = document.querySelector('#captions'); t.scrollTop = 0; t.dispatchEvent(new Event('scroll')); });
  await emit(page, { type: 'response.output_audio_transcript.delta', item_id: 'z', delta: 'Nuevo texto' });
  assert.equal(await page.evaluate(() => document.querySelector('#captions').scrollTop), 0);
  assert.ok(await page.isVisible('#jump'));
  await page.screenshot({ path: '/tmp/prop-llamada-celular.png' });
  await ctx.close();
});

test('en el celular entra sin desbordar', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await page.goto(`${BASE}/inversores/`, { waitUntil: 'load' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `desborda ${overflow}px`);
  await page.screenshot({ path: '/tmp/inversores-celular.png', fullPage: true });
  await ctx.close();
});
