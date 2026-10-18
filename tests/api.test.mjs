import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bundle, deferred, idA, job, json, summary } from './support.mjs';

const { createApiClient, mapJob } = await import(await bundle('src/api.ts', 'api'));

test('session initialization is deduplicated and reused; cookies and CSRF stay in requests', async () => {
  const gate = deferred(), calls = [];
  const client = createApiClient(async (url, options) => { calls.push([url, options]); return gate.promise; });
  const first = client.initialize(), second = client.initialize();
  assert.equal(first, second); assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/ui/session'); assert.equal(calls[0][1].credentials, 'include');
  gate.resolve(json({ csrf_token: 'csrf-test' })); await first; await client.initialize();
  assert.equal(calls.length, 1);
});

test('upload uses exactly one file, CSRF and no explicit multipart header; concurrent submit is blocked', async () => {
  const gate = deferred(), calls = [];
  const client = createApiClient(async (url, options) => { calls.push([url, options]);
    return url.endsWith('/session') ? json({ csrf_token: 'csrf-test' }) : gate.promise; });
  const file = new File(['synthetic'], 'example.MOV', { type: 'application/octet-stream' });
  const pending = client.upload(file);
  await assert.rejects(client.upload(file), { code: 'UPLOAD_IN_PROGRESS' });
  await new Promise(setImmediate);
  const [url, options] = calls[1];
  assert.equal(url, '/api/ui/analyze'); assert.equal(options.headers['X-CSRF-Token'], 'csrf-test');
  assert.equal(options.credentials, 'include'); assert.equal(options.headers['Content-Type'], undefined);
  assert.deepEqual([...options.body.keys()], ['file']); assert.equal(options.body.get('file').name, 'example.MOV');
  gate.resolve(json({ job_id: idA }, 202)); assert.equal(await pending, idA);
});

test('ambiguous upload failure is never automatically retried', async () => {
  let uploads = 0;
  const client = createApiClient(async url => {
    if (url.endsWith('/session')) return json({ csrf_token: 'test' });
    uploads++; throw new TypeError('Network failure');
  });
  await assert.rejects(client.upload(new File(['a'], 'a.mov')), { code: 'NETWORK_ERROR' });
  assert.equal(uploads, 1);
});

for (const code of ['UNAUTHORIZED', 'CSRF_REJECTED']) test(`${code} clears in-memory token; next manual action recovers once`, async () => {
  let sessions = 0, uploads = 0;
  const client = createApiClient(async url => {
    if (url.endsWith('/session')) { sessions++; return json({ csrf_token: `token-${sessions}` }); }
    uploads++; return uploads === 1 ? json({ error: { code } }, 403) : json({ job_id: idA }, 202);
  });
  const file = new File(['a'], 'a.mov');
  await assert.rejects(client.upload(file), { code }); assert.equal(uploads, 1);
  assert.equal(await client.upload(file), idA); assert.equal(sessions, 2);
});

for (const [response, code] of [
  [() => new Response('bad gateway', { status: 502 }), 'SERVER_UNAVAILABLE'],
  [() => new Response(null, { status: 204 }), 'INVALID_RESPONSE'],
  [() => json({}), 'INVALID_RESPONSE'],
  [() => json({ error: { code: 'UPLOAD_TOO_LARGE' } }, 413), 'UPLOAD_TOO_LARGE'],
]) test(`handles response failure ${code}`, async () => {
  const client = createApiClient(async url => url.endsWith('/session') ? json({ csrf_token: 'test' }) : response());
  await assert.rejects(client.upload(new File(['a'], 'a.mov')), { code });
});

test('essential contract validation rejects intermediate, inconsistent and unsafe media results', () => {
  for (const mutate of [
    data => { data.result = { status: 'done', events: [] }; },
    data => { data.result.decision.complete = false; },
    data => { data.result.decision.is_demo = false; },
    data => { data.result.evidence = []; },
    data => { data.result.evidence[0][0].url = 'https://example.com/image'; },
    data => { data.result.evidence[0][0].timestamp_sec = Number.NaN; },
    data => { data.result.decision.violations = []; },
  ]) { const value = job(); mutate(value); assert.throws(() => mapJob(value), { code: 'INVALID_RESPONSE' }); }
});

test('maps both verdicts, multiple events, zero timestamps, actual evidence offsets and regulatory metadata', () => {
  const value = job(); value.result.decision.violations[0].regulatory_references = [{ title: 'Supplied by owner', reference: 'original text' }];
  const mapped = mapJob(value);
  assert.equal(mapped.result.violations.length, 2); assert.equal(mapped.result.violations[0].timestamp, 0);
  assert.equal(mapped.result.violations[1].timestamp, 0.55); assert.equal(mapped.result.violations[1].evidence[0].timestamp, 0.6);
  assert.equal(mapped.result.violations[1].evidence[0].offset, 0.05);
  assert.deepEqual(mapped.result.violations[0].regulatoryReferences, value.result.decision.violations[0].regulatory_references);
  assert.deepEqual(mapJob(job(idA, 'done', 'no_violation')).result.violations, []);
  assert.equal(mapJob(job(idA, 'failed')).errorCode, 'PIPELINE_FAILED');
});

test('history pagination and canceled requests use the actual contract', async () => {
  const calls = [];
  const client = createApiClient(async (url, options) => { calls.push(url);
    return url.endsWith('/session') ? json({ csrf_token: 'test' }) : json({ items: [summary(job())], total: 21, limit: 20, offset: 20 }); });
  const page = await client.history(20); assert.equal(page.items[0].id, idA); assert.equal(page.offset, 20);
  assert.equal(calls[1], '/api/ui/jobs?limit=20&offset=20');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.job(idA, controller.signal), { name: 'AbortError' }); assert.equal(calls.length, 2);
});

test('frontend sources contain no jury client, old demo fixture or browser result storage', async () => {
  for (const path of ['src/api.ts', 'src/App.tsx', 'src/history.ts', 'src/components/ResultsView.tsx', 'src/components/VideoUpload.tsx']) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /X-API-Key|VITE_.*KEY|\/api\/v1|demo-frame\.svg|indexedDB\.open|saveAnalysis|demoEvents/);
  }
});
