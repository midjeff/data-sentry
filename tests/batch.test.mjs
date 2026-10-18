import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function moduleFromSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { runVideoQueue, runLiveVideoQueue, resultNavigationItems, shouldOpenCompletedResult } = await moduleFromSource('../src/batch.ts');
const { isSupportedVideo, MAX_VIDEO_SIZE } = await moduleFromSource('../src/videoFormats.ts');
const makeItem = (id) => ({ id, file: { name: 'same.mp4', size: 10 }, status: 'pending' });

test('single video completes with its own ID and source file', async () => {
  const item = makeItem('single');
  const updates = [];
  await runVideoQueue([item], new AbortController().signal, async (video) => ({ id: video.id, file: video.file }), (value) => updates.push(value));
  assert.deepEqual(updates.map((value) => value.status), ['processing', 'completed']);
  assert.equal(updates[1].result.file, item.file);
});

test('batch runs sequentially and continues after failure; duplicate filenames keep separate IDs', async () => {
  const items = ['a', 'b', 'c'].map(makeItem);
  const updates = [];
  let concurrent = 0;
  await runVideoQueue(items, new AbortController().signal, async (item) => {
    assert.equal(++concurrent, 1);
    await Promise.resolve();
    concurrent--;
    if (item.id === 'b') throw new Error('unreadable');
    return { id: item.id, file: item.file };
  }, (item) => updates.push(item));
  assert.deepEqual(updates.map(({ id, status }) => [id, status]), [
    ['a', 'processing'], ['a', 'completed'], ['b', 'processing'], ['b', 'failed'], ['c', 'processing'], ['c', 'completed'],
  ]);
  assert.equal(updates[5].result.file, items[2].file);
  const retried = [];
  await runVideoQueue([updates[3]], new AbortController().signal, async (item) => ({ id: item.id, file: item.file }), (item) => retried.push(item));
  assert.equal(retried.at(-1).status, 'completed');
  assert.equal(retried.at(-1).result.id, 'b');
});

test('cancel stops the next video and ignores in-flight completion', async () => {
  const controller = new AbortController();
  const updates = [];
  await runVideoQueue(['a', 'b'].map(makeItem), controller.signal, async () => { controller.abort(); return { id: 'a' }; }, (item) => updates.push(item));
  assert.deepEqual(updates.map(({ id, status }) => [id, status]), [['a', 'processing']]);
});

const { analyzeDemoVideo, DEMO_SCAN_DURATION_MS } = await moduleFromSource('../src/analysis.ts');
const demoContext = { batchId: 'batch', request: 'Check cash', scenario: 'flagged' };

test('demo scanning waits six seconds before returning the original scenario and file', async () => {
  const file = new File(['video'], 'demo.mov');
  const item = { ...makeItem('demo'), file, displayName: 'demo (1).mov' };
  const started = performance.now();
  let finished = false;
  const resultPromise = analyzeDemoVideo(item, new AbortController().signal, demoContext).then((result) => { finished = true; return result; });
  await Promise.resolve();
  assert.equal(finished, false);
  const result = await resultPromise;
  assert.ok(performance.now() - started >= DEMO_SCAN_DURATION_MS - 30);
  assert.equal(DEMO_SCAN_DURATION_MS, 6000);
  assert.equal(result.file, file);
  assert.equal(result.id, 'demo');
  assert.equal(result.scenario, 'flagged');
  assert.equal(result.request, 'Check cash');
  assert.equal(result.displayName, 'demo (1).mov');
});

test('cancelling a demo scan clears its timer and does not return a result', async () => {
  const controller = new AbortController();
  const item = { ...makeItem('cancel'), file: new File(['video'], 'cancel.mov') };
  const promise = analyzeDemoVideo(item, controller.signal, demoContext);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});

test('unreadable demo files fail independently without waiting for scanning', async () => {
  const item = { ...makeItem('bad'), file: { slice: () => ({ arrayBuffer: async () => { throw new Error('Unreadable'); } }) } };
  await assert.rejects(analyzeDemoVideo(item, new AbortController().signal, demoContext), /Unreadable/);
});

test('validation accepts supported sizes and rejects empty, oversized, or unsupported files', () => {
  for (const name of ['a.MP4', 'b.mov', 'c.avi', 'd.mkv', 'e.webm']) assert.equal(isSupportedVideo({ name, size: 1 }), true);
  assert.equal(isSupportedVideo({ name: 'a.mp4', size: MAX_VIDEO_SIZE }), true);
  for (const file of [{ name: 'a.mp4', size: 0 }, { name: 'a.mp4', size: MAX_VIDEO_SIZE + 1 }, { name: 'a.txt', size: 10 }]) assert.equal(isSupportedVideo(file), false);
});

const { addUpload, hasDuplicateFilename, uniqueDisplayName } = await moduleFromSource('../src/uploads.ts');
const uploadFile = (name) => new File(['video-content'], name, { type: 'video/quicktime', lastModified: 123456 });

test('duplicate needs confirmation; cancel leaves the upload list untouched', () => {
  const file = uploadFile('X-3.mov');
  const items = addUpload([], file);
  assert.equal(hasDuplicateFilename(items, file), true);
  const cancelled = addUpload(items, file);
  assert.equal(cancelled, items);
  assert.equal(cancelled.length, 1);
});

test('confirmed duplicates get unique IDs and numbered names without changing original file metadata', () => {
  const file = uploadFile('X-3.mov');
  let items = addUpload([], file);
  for (let index = 0; index < 3; index++) items = addUpload(items, file, true);
  assert.deepEqual(items.map((item) => item.displayName), ['X-3.mov', 'X-3 (1).mov', 'X-3 (2).mov', 'X-3 (3).mov']);
  assert.equal(new Set(items.map((item) => item.id)).size, 4);
  for (const item of items) {
    assert.equal(item.file, file);
    assert.equal(item.file.name, 'X-3.mov');
    assert.equal(item.file.type, 'video/quicktime');
    assert.equal(item.file.lastModified, 123456);
  }
});

test('numbering skips occupied names and reuses a removed display name', () => {
  const file = uploadFile('X-3.mov');
  let items = addUpload([], file);
  items = addUpload(items, uploadFile('X-3 (1).mov'));
  items = addUpload(items, file, true);
  assert.equal(items[2].displayName, 'X-3 (2).mov');
  const removedId = items[1].id;
  items = items.filter((item) => item.id !== removedId);
  assert.equal(uniqueDisplayName(file.name, items), 'X-3 (1).mov');
  assert.equal(items.length, 2);
});

test('mixed multi-file selection checks each file against earlier accepted files', () => {
  const incoming = ['a.mov', 'a.mov', 'b.mov', 'a.mov', 'b.mov'].map(uploadFile);
  const decisions = [true, false, true];
  let items = [];
  let prompts = 0;
  for (const file of incoming) {
    if (hasDuplicateFilename(items, file)) {
      const confirmed = decisions[prompts++];
      items = addUpload(items, file, confirmed);
    } else items = addUpload(items, file);
  }
  assert.equal(prompts, 3);
  assert.deepEqual(items.map((item) => item.displayName), ['a.mov', 'a (1).mov', 'b.mov', 'b (1).mov']);
});

test('original-name detection survives removing the first upload, and display-name collisions also prompt', () => {
  const original = uploadFile('a.mov');
  let items = addUpload([], original);
  items = addUpload(items, original, true).slice(1);
  assert.equal(hasDuplicateFilename(items, original), true);
  assert.equal(hasDuplicateFilename(items, uploadFile('a (1).mov')), true);
  assert.equal(uniqueDisplayName('a.mov', items), 'a.mov');
});


const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('first result is published while the next job is still running; later completions preserve selection', async () => {
  const first = deferred();
  const second = deferred();
  const secondStarted = deferred();
  let selected = null;
  let autoOpen = true;
  const updates = [];
  const queue = runVideoQueue(['a', 'b'].map(makeItem), new AbortController().signal, async (item) => {
    if (item.id === 'a') await first.promise;
    else { secondStarted.resolve(); await second.promise; }
    return { id: item.id, file: item.file };
  }, (item) => {
    updates.push(item);
    if (shouldOpenCompletedResult(autoOpen, item)) { selected = item.id; autoOpen = false; }
  });
  first.resolve();
  await secondStarted.promise;
  assert.equal(selected, 'a');
  assert.deepEqual(updates.map(({ id, status }) => [id, status]), [['a', 'processing'], ['a', 'completed'], ['b', 'processing']]);
  // A user can review a different historical result without the queue redirecting them.
  selected = 'historical-result';
  second.resolve();
  await queue;
  assert.equal(selected, 'historical-result');
  assert.equal(updates.at(-1).status, 'completed');
});

test('concurrency is bounded and each job is processed exactly once', async () => {
  const gates = [deferred(), deferred(), deferred()];
  const started = [];
  const thirdStarted = deferred();
  let active = 0;
  let peak = 0;
  const queue = runVideoQueue(['a', 'b', 'c'].map(makeItem), new AbortController().signal, async (item) => {
    const index = started.length;
    started.push(item.id);
    peak = Math.max(peak, ++active);
    if (item.id === 'c') thirdStarted.resolve();
    await gates[index].promise;
    active--;
    return { id: item.id };
  }, () => {}, 2);
  assert.deepEqual(started, ['a', 'b']);
  gates[0].resolve();
  await thirdStarted.promise;
  assert.equal(peak, 2);
  gates[1].resolve(); gates[2].resolve();
  await queue;
  assert.deepEqual(started, ['a', 'b', 'c']);
});

test('only completed results are navigable and user navigation disables automatic opening', () => {
  for (const status of ['pending', 'processing', 'failed']) assert.equal(shouldOpenCompletedResult(true, { ...makeItem('a'), status }), false);
  const ready = { ...makeItem('a'), status: 'completed', result: { id: 'a' } };
  assert.equal(shouldOpenCompletedResult(true, ready), true);
  assert.equal(shouldOpenCompletedResult(false, ready), false);
});

test('invalid concurrency is rejected', async () => {
  await assert.rejects(runVideoQueue([], new AbortController().signal, async () => ({}), () => {}, 0));
});


const { groupHistory } = await moduleFromSource('../src/history.ts');
const historyEntry = (id, batchId, createdAt) => ({ id, batchId, createdAt, file: { name: 'same.mov' }, request: '', scenario: 'flagged' });

test('history keeps batch members adjacent despite interleaved completion times', () => {
  const records = [historyEntry('a1', 'A', 1), historyEntry('b1', 'B', 2), historyEntry('a2', 'A', 3), historyEntry('c1', 'C', 4)];
  const groups = groupHistory(records);
  assert.deepEqual(groups.map((group) => group.records.map((record) => record.id)), [['c1'], ['a2', 'a1'], ['b1']]);
  assert.deepEqual(records.map((record) => record.id), ['a1', 'b1', 'a2', 'c1']);
});

test('legacy history never groups by filename or timestamp; saved batch IDs survive structured cloning', () => {
  const records = [historyEntry('old1', undefined, 1), historyEntry('old2', undefined, 1), historyEntry('a1', 'A', 2), historyEntry('a2', 'A', 3)];
  const restored = structuredClone(records);
  assert.deepEqual(groupHistory(restored), groupHistory(records));
  assert.deepEqual(groupHistory(restored).map((group) => group.records.length), [2, 1, 1]);
});

test('deleting a member leaves its batch mates intact and removes grouping for a singleton', () => {
  const records = [historyEntry('a1', 'A', 1), historyEntry('a2', 'A', 2), historyEntry('b1', 'B', 3)];
  const groups = groupHistory(records.filter((record) => record.id !== 'a2'));
  assert.deepEqual(groups.map((group) => group.records.map((record) => record.id)), [['b1'], ['a1']]);
  assert.equal(groups.some((group) => group.records.length > 1), false);
});

const { historyViolationStatus, readHistoryPreferences, saveHistoryPreferences } = await moduleFromSource('../src/historyDisplay.ts');

test('history icons use each saved demo outcome, including different results within one batch', () => {
  const flagged = { ...historyEntry('a', 'batch', 1), status: 'completed', scenario: 'flagged' };
  const clear = { ...historyEntry('b', 'batch', 2), status: 'completed', scenario: 'clear' };
  assert.equal(historyViolationStatus(flagged), 'flagged');
  assert.equal(historyViolationStatus(clear), 'clear');
  assert.equal(historyViolationStatus({ scenario: 'flagged' }), 'flagged');
});

test('incomplete, failed, and unavailable results never show success icons', () => {
  for (const status of ['pending', 'processing', 'failed']) {
    for (const scenario of ['clear', 'flagged']) assert.equal(historyViolationStatus({ status, scenario }), undefined);
  }
  assert.equal(historyViolationStatus({}), undefined);
  assert.equal(historyViolationStatus({ status: 'completed', scenario: 'unknown' }), undefined);
});

test('display preferences default on and persist independently across reads', () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.deepEqual(readHistoryPreferences(storage), { showStatusIcons: true, showBatchGrouping: true });
  saveHistoryPreferences(storage, { showStatusIcons: false, showBatchGrouping: true });
  assert.deepEqual(readHistoryPreferences(storage), { showStatusIcons: false, showBatchGrouping: true });
  saveHistoryPreferences(storage, { showStatusIcons: true, showBatchGrouping: false });
  assert.deepEqual(readHistoryPreferences(storage), { showStatusIcons: true, showBatchGrouping: false });
  assert.equal(data.size, 2);
});

test('unavailable browser storage does not prevent display settings from working', () => {
  const storage = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Full'); } };
  assert.deepEqual(readHistoryPreferences(storage), { showStatusIcons: true, showBatchGrouping: true });
  assert.doesNotThrow(() => saveHistoryPreferences(storage, { showStatusIcons: false, showBatchGrouping: false }));
});


const { recoverQueueItems } = await moduleFromSource('../src/queueStorage.ts');

test('cancelled pending jobs remain visible and skipped, restored ID is processed once', async () => {
  let items = [{ ...makeItem('a'), status: 'cancelled' }, makeItem('b')];
  const processed = [];
  const update = (item) => { items = items.map((entry) => entry.id === item.id ? item : entry); };
  const process = async (item) => { processed.push(item.id); return { id: item.id, file: item.file }; };
  await runLiveVideoQueue(() => items, new AbortController().signal, process, update, () => {});
  assert.equal(items[0].status, 'cancelled');
  assert.deepEqual(processed, ['b']);
  // Repeated Restore is ignored as soon as the job has returned to pending.
  const restore = () => { if (items[0].status === 'cancelled') update({ ...items[0], status: 'pending' }); };
  restore(); restore();
  await runLiveVideoQueue(() => items, new AbortController().signal, process, update, () => {});
  assert.deepEqual(processed, ['b', 'a']);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'a');
});

test('cancelling active job aborts only its scan and continues the next job', async () => {
  let items = ['a', 'b'].map(makeItem);
  const started = deferred();
  let active;
  const completed = [];
  const queue = runLiveVideoQueue(() => items, new AbortController().signal, async (item, signal) => {
    if (item.id === 'a') {
      started.resolve();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
    return { id: item.id };
  }, (item) => { items = items.map((entry) => entry.id === item.id ? item : entry); if (item.result) completed.push(item.id); }, (job) => { active = job; });
  await started.promise;
  items = items.map((item) => item.id === 'a' ? { ...item, status: 'cancelled' } : item);
  active.controller.abort();
  await queue;
  assert.deepEqual(completed, ['b']);
  assert.equal(items[0].status, 'cancelled');
  assert.equal(items[1].status, 'completed');
});

test('deleting a cancelled queue entry leaves batch mates and saved history intact', () => {
  const history = [historyEntry('a', 'batch', 1)];
  const items = [{ ...makeItem('a'), status: 'cancelled' }, makeItem('b')];
  const remaining = items.filter((item) => item.id !== 'a');
  assert.deepEqual(remaining.map((item) => item.id), ['b']);
  assert.equal(history[0].id, 'a');
});

test('refresh recovery preserves stored files and cancellation; missing files require reselection', () => {
  const file = new File(['video'], 'original.mov');
  const items = recoverQueueItems([
    { ...makeItem('a'), batchId: 'batch', file, status: 'cancelled' },
    { ...makeItem('b'), file, status: 'processing' },
    { ...makeItem('c'), file: undefined, originalFilename: 'missing.mov', status: 'cancelled' },
  ]);
  assert.equal(items[0].file, file);
  assert.equal(items[0].batchId, 'batch');
  assert.equal(items[0].needsFile, false);
  assert.equal(items[1].status, 'cancelled');
  assert.equal(items[2].needsFile, true);
  assert.equal(items[2].file.name, 'missing.mov');
});


test('cancelled history records never receive a success or violation icon', () => {
  assert.equal(historyViolationStatus({ status: 'cancelled', scenario: 'flagged' }), undefined);
  assert.equal(historyViolationStatus({ status: 'cancelled', scenario: 'clear' }), undefined);
});

test('result navigation preserves cancelled batch videos and excludes unrelated batches', () => {
  const items = [
    { ...makeItem('done'), batchId: 'A', status: 'completed' },
    { ...makeItem('cancelled'), batchId: 'A', status: 'cancelled' },
    { ...makeItem('waiting'), batchId: 'A', status: 'pending' },
    { ...makeItem('other'), batchId: 'B', status: 'completed' },
  ];
  assert.deepEqual(resultNavigationItems(items, 'A').map((item) => item.id), ['done', 'cancelled', 'waiting']);
  assert.deepEqual(resultNavigationItems(items, 'B').map((item) => item.id), ['other']);
  assert.deepEqual(resultNavigationItems(items, undefined, 'done').map((item) => item.id), ['done']);
  const restored = items.map((item) => item.id === 'cancelled' ? { ...item, status: 'pending' } : item);
  assert.deepEqual(resultNavigationItems(restored, 'A').map((item) => item.id), ['done', 'cancelled', 'waiting']);
});

test('cancelled history preserves batch identity and grouping after storage cloning', () => {
  const records = [
    { ...historyEntry('complete', 'A', 1), status: 'completed' },
    { ...historyEntry('cancel', 'A', 2), status: 'cancelled' },
  ];
  const restored = structuredClone(records);
  assert.deepEqual(groupHistory(restored).map((group) => group.records.map((record) => record.id)), [['cancel', 'complete']]);
  assert.equal(restored[1].status, 'cancelled');
  assert.equal(restored[1].createdAt, 2);
  assert.equal(groupHistory(restored.filter((record) => record.id !== 'cancel'))[0].records.length, 1);
});
