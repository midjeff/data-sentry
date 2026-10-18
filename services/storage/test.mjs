import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './index.mjs';

test('uploads stay blocked and private read signing requires service authentication', async () => {
  const calls = [];
  const app = createApp({ env: { INTERNAL_SERVICE_TOKEN: 'test-only' },
    issue: async options => { calls.push(options); return {}; },
    sign: async (_token, options) => { calls.push(options); return { presignedUrl: 'https://blob.test/signed' }; },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, authenticated = true) => fetch(base + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-only' } : {}) },
    body: JSON.stringify(body) });
  try {
    const pathname = `jobs/${'a'.repeat(32)}/input.mp4`;
    assert.equal((await post('/upload-token', { pathname, maximumSizeInBytes: 123 }, false)).status, 401);
    const blocked = await post('/upload-token', { pathname, maximumSizeInBytes: 123 });
    assert.equal(blocked.status, 503);
    assert.deepEqual(await blocked.json(), { error: 'CLOUD_UPLOAD_NOT_APPROVED' });
    assert.equal(calls.length, 0);
    assert.equal((await post('/read-url', { pathname }, false)).status, 401);
    assert.equal((await post('/read-url', { pathname })).status, 200);
    assert.deepEqual(calls[0].operations, ['get']);
    assert.equal(calls[1].access, 'private');
    assert.equal((await post('/read-url', { pathname: 'jobs/*' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
