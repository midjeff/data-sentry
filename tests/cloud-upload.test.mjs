import test from 'node:test';
import assert from 'node:assert/strict';
import { bundle, json, idA } from './support.mjs';

const { createApiClient } = await import(await bundle('src/api.ts', 'cloud-api'));

test('cloud uploads send bytes directly to Blob and finalize with cookies and CSRF', async () => {
  const calls = [], uploads = [];
  const pathname = `jobs/${idA}/input.mp4`;
  const client = createApiClient(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/session')) return json({ csrf_token: 'csrf', upload_transport: 'blob' });
    if (url === '/api/ui/uploads') return json({ job_id: idA, pathname, token: 'scoped-token' });
    assert.equal(url, `/api/ui/uploads/${idA}/complete`);
    assert.equal(uploads.length, 1);
    return json({ job_id: idA }, 202);
  }, async (...args) => uploads.push(args));
  const file = new File(['video bytes'], 'A.MP4');
  assert.equal(await client.upload(file), idA);
  assert.deepEqual(uploads[0].slice(0, 3), [pathname, file, 'scoped-token']);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    filename: 'A.MP4', size: file.size, display_name: 'A.MP4', analysis_request: '', batch_id: null,
  });
  for (const call of calls.slice(1)) {
    assert.equal(call.options.credentials, 'include');
    assert.equal(call.options.headers['X-CSRF-Token'], 'csrf');
    assert.ok(!JSON.stringify(call.options).includes('scoped-token'));
  }
});

test('disabled pipeline never sends file bytes and failed direct upload is not retried or finalized', async () => {
  let sends = 0, posts = 0;
  const file = new File(['video'], 'a.mp4');
  const disabled = createApiClient(async url => url.endsWith('/session')
    ? json({ csrf_token: 'csrf', upload_transport: 'blob' })
    : json({ error: { code: 'PIPELINE_DISABLED' } }, 503), async () => { sends++; });
  await assert.rejects(disabled.upload(file), /PIPELINE_DISABLED/);
  assert.equal(sends, 0);
  const client = createApiClient(async url => {
    if (url.endsWith('/session')) return json({ csrf_token: 'csrf', upload_transport: 'blob' });
    posts++;
    return json({ job_id: idA, pathname: `jobs/${idA}/input.mp4`, token: 'scoped' });
  }, async () => { sends++; throw new Error('lost upload response'); });
  await assert.rejects(client.upload(file), /lost upload response/);
  assert.equal(sends, 1);
  assert.equal(posts, 1);
});
