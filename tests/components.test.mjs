import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bundle, deferred, idA, idB, job, json, summary } from './support.mjs';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const appUrl = await bundle('src/App.tsx', 'app');
let dom, root, iteration = 0, calls, timerQueue;
const nativeFetch = globalThis.fetch, nativeTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function flush() { await act(async () => { await new Promise(setImmediate); }); }
async function setup(handler) {
  dom = new JSDOM('<html data-theme="light"><body><div id="root"></div></body></html>', { url: 'http://localhost:5173/' });
  for (const key of ['window', 'document', 'Node', 'HTMLElement', 'HTMLDialogElement', 'HTMLMediaElement', 'Event', 'MouseEvent', 'File', 'FormData', 'localStorage']) globalThis[key] = dom.window[key];
  globalThis.matchMedia = window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  timerQueue = new Map(); let timer = 0;
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms === 2000) { const id = 'poll-' + ++timer; timerQueue.set(id, fn); return id; }
    return nativeTimeout(fn, ms, ...args);
  };
  globalThis.clearTimeout = id => { if (typeof id === 'string') timerQueue.delete(id); else nativeClearTimeout(id); };
  calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options });
    if (url === '/api/ui/session') return json({ csrf_token: 'dom-csrf' });
    return handler(url, options);
  };
  const { default: App } = await import(`${appUrl}?case=${++iteration}`);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
  await flush();
}
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = undefined; }
  dom?.window.close(); globalThis.fetch = nativeFetch;
  globalThis.setTimeout = nativeTimeout; globalThis.clearTimeout = nativeClearTimeout;
});
const history = (values, offset = 0, total = values.length) => json({ items: values.map(summary), total, offset, limit: 20 });
const button = text => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text);
async function click(element) { assert.ok(element, 'button exists'); await act(async () => element.click()); await flush(); }
async function choose(name, contents = 'synthetic') {
  const input = document.querySelector('input[type=file]'); assert.ok(input);
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([contents], name, { type: 'application/octet-stream' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function poll() { const [id, fn] = timerQueue.entries().next().value; timerQueue.delete(id); await act(async () => fn()); await flush(); }

test('Strict Mode initializes one session, selection does not upload, double click creates one job', async () => {
  const gate = deferred(); let submitted = false;
  await setup((url, options) => {
    if (url.includes('/jobs?')) return history(submitted ? [job(idA, 'processing')] : []);
    if (url.endsWith('/analyze')) { submitted = true; assert.deepEqual([...options.body.keys()], ['file']); assert.equal(options.headers['X-CSRF-Token'], 'dom-csrf'); return gate.promise; }
    return json(job(idA, 'processing'));
  });
  assert.equal(calls.filter(call => call.url.endsWith('/session')).length, 1);
  await choose('example.MOV');
  assert.equal(calls.filter(call => call.url.endsWith('/analyze')).length, 0);
  const start = button('Начать анализ'); await act(async () => { start.click(); start.click(); });
  await flush(); assert.equal(calls.filter(call => call.url.endsWith('/analyze')).length, 1);
  assert.match(document.body.textContent, /Загрузка и проверка видео/);
  gate.resolve(json({ job_id: idA }, 202)); await flush();
  assert.match(document.body.textContent, /В очереди/); assert.equal(document.querySelector('.verdict'), null);
});

for (const verdict of ['violation', 'no_violation']) test(`processing -> ${verdict}; backend results, demo and protected media are rendered`, async () => {
  let count = 0;
  await setup(url => url.includes('/jobs?') ? history([job(idA, 'processing')]) : json(job(idA, ++count === 1 ? 'processing' : 'done', verdict)));
  await click(document.querySelector('.history-open')); assert.equal(document.querySelector('.verdict'), null);
  await poll();
  assert.match(document.querySelector('.verdict').textContent, verdict === 'violation' ? /Обнаружены признаки возможных нарушений/ : /Нарушение не обнаружено/);
  assert.match(document.querySelector('.verdict').textContent, /Демонстрационный результат/);
  assert.equal(document.querySelector('video').getAttribute('src'), `/api/ui/jobs/${idA}/video`);
  assert.ok(document.querySelector('.video-column')); assert.ok(document.querySelector('.events-panel'));
  assert.equal(document.querySelectorAll('.event-button').length, verdict === 'violation' ? 2 : 0);
  assert.equal(document.querySelector('.regulation'), null); assert.equal(timerQueue.size, 0);
});

test('multiple events preserve zero/fractional seeks and evidence timestamps; dialog and unavailable media states work', async () => {
  await setup(url => url.includes('/jobs?') ? history([job()]) : json(job()));
  await click(document.querySelector('.history-open'));
  const player = document.querySelector('video'); player.currentTime = 1;
  await click(document.querySelectorAll('.event-button')[0]); assert.equal(player.currentTime, 1);
  await act(async () => player.dispatchEvent(new Event('loadedmetadata'))); assert.equal(player.currentTime, 0);
  await click(document.querySelectorAll('.event-button')[1]); assert.equal(player.currentTime, 0.55);
  assert.match(document.querySelector('.violation-details').textContent, /Server description 2/);
  assert.match(document.querySelector('.evidence-time').textContent, /0.6/);
  await click(document.querySelector('.evidence-thumbnail')); assert.equal(document.querySelector('dialog').open, true);
  assert.equal(document.querySelector('dialog img').getAttribute('src'), document.querySelector('.evidence-thumbnail img').getAttribute('src'));
  await click(document.querySelector('[aria-label="Закрыть просмотр"]')); assert.equal(document.querySelector('dialog').open, false);
  await act(async () => document.querySelector('.evidence-thumbnail img').dispatchEvent(new Event('error')));
  assert.match(document.querySelector('.evidence-gallery').textContent, /Кадр недоступен/);
  await act(async () => player.dispatchEvent(new Event('error'))); assert.ok(document.querySelector('.playback-error'));
});

test('failed jobs never render successful verdicts or previous evidence', async () => {
  await setup(url => url.includes('/jobs?') ? history([job(), job(idB, 'failed')]) : json(url.includes(idB) ? job(idB, 'failed') : job()));
  await click(document.querySelectorAll('.history-open')[0]); assert.ok(document.querySelector('.verdict'));
  await click(document.querySelectorAll('.history-open')[1]);
  assert.match(document.body.textContent, /Анализ завершился ошибкой/);
  assert.equal(document.querySelector('.verdict'), null); assert.equal(document.querySelector('.evidence-thumbnail'), null);
});

test('backend unavailable and ambiguous upload show honest errors without a fallback or automatic retry', async () => {
  await setup(url => { if (url.includes('/jobs?')) return history([]); throw new TypeError('offline'); });
  await choose('example.mp4'); await click(button('Начать анализ'));
  assert.match(document.body.textContent, /Нет соединения с сервером/);
  assert.match(document.body.textContent, /Сервер мог принять загрузку/);
  assert.equal(document.querySelector('.verdict'), null);
  assert.equal(calls.filter(call => call.url.endsWith('/analyze')).length, 1);
});

test('late response from previous selection cannot replace the newly selected job', async () => {
  const old = deferred();
  await setup(url => url.includes('/jobs?') ? history([job(), job(idB, 'done', 'no_violation')]) : url.includes(idA) ? old.promise : json(job(idB, 'done', 'no_violation')));
  await click(document.querySelectorAll('.history-open')[0]);
  await click(document.querySelectorAll('.history-open')[1]);
  old.resolve(json(job())); await flush();
  assert.match(document.querySelector('.verdict').textContent, /Нарушение не обнаружено/);
  assert.equal(document.querySelector('video').getAttribute('src'), `/api/ui/jobs/${idB}/video`);
});

test('saved results load from server history with demo label after a fresh component mount', async () => {
  const handler = url => url.includes('/jobs?') ? history([job()]) : json(job());
  await setup(handler); await click(document.querySelector('.history-open'));
  await act(async () => root.unmount()); root = undefined; dom.window.close();
  await setup(handler); assert.equal(document.querySelector('.verdict'), null);
  assert.match(document.querySelector('.history-open').textContent, /Демонстрационный результат/);
  await click(document.querySelector('.history-open')); assert.match(document.querySelector('.verdict').textContent, /Демонстрационный результат/);
  assert.equal(localStorage.length, 0);
});

test('history pagination, all file extensions, language switching and theme preference are retained', async () => {
  await setup(url => url.includes('offset=20') ? history([job(idB)], 20, 21) : history([job()], 0, 21));
  await click(button('Далее')); assert.equal(document.querySelector('.history-open').title, 'b.MOV');
  await click(button('Назад')); assert.equal(document.querySelector('.history-open').title, 'a.MOV');
  for (const extension of ['MOV', 'MP4', 'AVI', 'MKV', 'WEBM']) { await choose(`synthetic.${extension}`); assert.equal(button('Начать анализ').disabled, false); }
  await choose('bad.txt'); assert.match(document.querySelector('[role=alert]').textContent, /Выберите один/);
  await click(document.querySelector('[aria-label="Включить тёмную тему"]'));
  assert.equal(localStorage.getItem('data-sentry-theme'), 'dark');
  for (const [label, lang] of [['ҚАЗ', 'kk'], ['ENG', 'en'], ['РУС', 'ru']]) {
    await click(document.querySelector('.language-trigger')); await click(button(label)); assert.equal(document.documentElement.lang, lang);
  }
  assert.equal(document.querySelector('textarea'), null); assert.equal(document.querySelector('.history-delete'), null);
});

test('server-side validation errors are localized and do not create a result', async () => {
  await setup(url => url.includes('/jobs?') ? history([]) : json({ error: { code: 'UPLOAD_TOO_LARGE' } }, 413));
  await choose('valid.mov'); await click(button('Начать анализ'));
  assert.match(document.body.textContent, /Файл превышает лимит загрузки/); assert.equal(document.querySelector('.verdict'), null);
});

test('drag and drop accepts one supported file and rejects empty or multiple files without submitting', async () => {
  await setup(() => history([]));
  async function drop(files) {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    await act(async () => document.querySelector('.dropzone').dispatchEvent(event));
  }
  await drop([new File([], 'empty.mov')]);
  assert.match(document.querySelector('[role=alert]').textContent, /Выберите один/);
  await drop([new File(['one'], 'a.mov'), new File(['two'], 'b.mov')]);
  assert.equal(button('Начать анализ').disabled, true);
  await drop([new File(['valid'], 'video.WEBM', { type: '' })]);
  assert.equal(button('Начать анализ').disabled, false);
  assert.equal(document.querySelector('[role=alert]'), null);
  assert.equal(calls.filter(call => call.url.endsWith('/analyze')).length, 0);
});
