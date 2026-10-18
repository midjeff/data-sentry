// Real React + real HTTP, mounted in jsdom. This is NOT a real-browser test.
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bundle } from './support.mjs';

const [scenario, videoPath, frontendPort = '5173'] = process.argv.slice(2);
const origin = `http://localhost:${frontendPort}`;
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: origin });
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'HTMLDialogElement', 'HTMLMediaElement', 'Event', 'MouseEvent', 'localStorage']) globalThis[key] = dom.window[key];
globalThis.matchMedia = window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
const nativeFetch = globalThis.fetch;
let cookie = '', uploads = 0, sessionCalls = 0, lastJobId;
globalThis.fetch = async (url, options = {}) => {
  assert.match(url, /^\/api\/ui\//);
  const headers = new Headers(options.headers);
  if (cookie) headers.set('Cookie', cookie); // Emulate jsdom's missing fetch cookie transport, in memory only.
  if (options.method === 'POST') headers.set('Origin', origin);
  if (url.endsWith('/session')) sessionCalls++;
  if (url.endsWith('/analyze')) uploads++;
  const response = await nativeFetch(new URL(url, origin), { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=lax/i); assert.match(setCookie, /Path=\/api\/ui/i);
    cookie = setCookie.split(';')[0];
  }
  if (url.endsWith('/analyze') && response.ok) lastJobId = (await response.clone().json()).job_id;
  return response;
};
const appUrl = await bundle('src/App.tsx', `network-app-${scenario}`);
let root;
async function mount(revision) {
  const { default: App } = await import(`${appUrl}?reload=${revision}`);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
}
async function waitFor(predicate, label, seconds = 20) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    if (predicate()) return;
  }
  throw new Error(`Timeout: ${label}; UI=${document.body.textContent}`);
}
async function click(element) { assert.ok(element); await act(async () => element.click()); }
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
try {
  await mount(1);
  if (scenario === 'offline') {
    await waitFor(() => document.querySelector('[role=alert]'), 'connection error');
    assert.match(document.body.textContent, /Нет соединения с сервером/);
    assert.equal(document.querySelector('.verdict'), null); assert.equal(uploads, 0);
  } else {
    await waitFor(() => cookie && button('Обновить историю') && !button('Обновить историю').disabled, 'session/history initialization');
    assert.equal(sessionCalls, 1);
    const file = new File([await readFile(videoPath)], 'synthetic.MOV', { type: 'application/octet-stream' });
    const input = document.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    assert.equal(uploads, 0);
    const start = button('Начать анализ'); await act(async () => { start.click(); start.click(); });
    await waitFor(() => scenario === 'failure' ? document.body.textContent.includes('Анализ завершился ошибкой') : document.querySelector('.verdict'), 'terminal server result');
    assert.equal(uploads, 1);
    if (scenario === 'failure') {
      assert.equal(document.querySelector('.verdict'), null); assert.equal(document.querySelector('video'), null);
    } else {
      assert.match(document.querySelector('.verdict').textContent, /Демонстрационный результат/);
      assert.match(document.querySelector('.verdict').textContent, scenario === 'violations' ? /Обнаружены признаки возможных нарушений/ : /Нарушение не обнаружено/);
      assert.equal(document.querySelectorAll('.event-button').length, scenario === 'violations' ? 2 : 0);
      const videoUrl = document.querySelector('video').getAttribute('src');
      const videoResponse = await nativeFetch(new URL(videoUrl, origin), { headers: { Cookie: cookie, Range: 'bytes=0-15' } });
      assert.equal(videoResponse.status, 206); assert.equal((await videoResponse.arrayBuffer()).byteLength, 16);
      let evidenceUrl;
      if (scenario === 'violations') {
        await click(document.querySelector('.evidence-thumbnail'));
        assert.equal(document.querySelector('dialog').open, true);
        evidenceUrl = document.querySelector('dialog img').getAttribute('src');
        const response = await nativeFetch(new URL(evidenceUrl, origin), { headers: { Cookie: cookie } });
        const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(response.status, 200);
        assert.deepEqual([...bytes.slice(0, 3)], [255, 216, 255]);
      }
      // Fresh app module and in-memory CSRF, same cookie: the backend preserves identity/history.
      const beforeReload = cookie;
      await act(async () => root.unmount());
      await mount(2);
      await waitFor(() => document.querySelector('.history-open'), 'history after reload');
      assert.equal(cookie, beforeReload); assert.equal(sessionCalls, 2);
      await click(document.querySelector('.history-open'));
      await waitFor(() => document.querySelector('.verdict'), 'saved detail');
      assert.match(document.querySelector('.verdict').textContent, /Демонстрационный результат/);
      const other = await nativeFetch(`${origin}/api/ui/session`, { method: 'POST', headers: { Origin: origin } });
      const otherCookie = other.headers.get('set-cookie').split(';')[0];
      const otherHistory = await nativeFetch(`${origin}/api/ui/jobs?limit=20&offset=0`, { headers: { Cookie: otherCookie } });
      assert.equal((await otherHistory.json()).total, 0);
      for (const url of [`/api/ui/jobs/${lastJobId}`, videoUrl, ...(evidenceUrl ? [evidenceUrl] : [])]) {
        const response = await nativeFetch(new URL(url, origin), { headers: { Cookie: otherCookie } });
        assert.equal(response.status, 404); await response.arrayBuffer();
      }
      const rejected = await nativeFetch(`${origin}/api/ui/session`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
      assert.equal(rejected.status, 403); // Proxy preserved the supplied Origin.
    }
  }
  console.log(`PASS real HTTP + jsdom: ${scenario}`);
} finally {
  if (root) await act(async () => root.unmount());
  dom.window.close(); globalThis.fetch = nativeFetch;
}
