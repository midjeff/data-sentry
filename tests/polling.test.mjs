import test from 'node:test';
import assert from 'node:assert/strict';
import { bundle, deferred, idA, idB, job } from './support.mjs';
const { watchJob } = await import(await bundle('src/polling.ts', 'polling'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('polls sequentially and stops after a terminal result', async () => {
  let count = 0, concurrent = 0, peak = 0;
  const updates = [];
  const stop = watchJob(idA, value => updates.push(value), assert.fail, async () => {
    count++; peak = Math.max(peak, ++concurrent); await sleep(10); concurrent--;
    return { id: idA, status: count === 1 ? 'processing' : 'done' };
  }, 5);
  await sleep(70); stop();
  assert.equal(count, 2); assert.equal(peak, 1); assert.deepEqual(updates.map(value => value.status), ['processing', 'done']);
});

test('selection cleanup ignores late responses even when transport does not honor abort', async () => {
  const old = deferred(), updates = [];
  const stopA = watchJob(idA, value => updates.push(value.id), assert.fail, () => old.promise, 5);
  stopA();
  const stopB = watchJob(idB, value => updates.push(value.id), assert.fail, async () => ({ id: idB, status: 'done' }), 5);
  await sleep(5); old.resolve({ id: idA, status: 'done' }); await sleep(10); stopB();
  assert.deepEqual(updates, [idB]);
});

test('transient connection errors preserve last status and poll again without inventing failure', async () => {
  let calls = 0; const updates = [], errors = [];
  const stop = watchJob(idA, value => updates.push(value.status), value => errors.push(value), async () => {
    calls++; if (calls === 2) throw new TypeError('network');
    return { status: calls > 2 ? 'done' : 'processing' };
  }, 5);
  await sleep(50); stop();
  assert.deepEqual(updates, ['processing', 'done']); assert.deepEqual(errors, ['NETWORK_ERROR']);
});
