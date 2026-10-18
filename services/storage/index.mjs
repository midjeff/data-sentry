import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { issueSignedToken, presignUrl } from '@vercel/blob';

export function createApp({ env = process.env,
  issue = issueSignedToken, sign = presignUrl } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const expected = Buffer.from(`Bearer ${env.INTERNAL_SERVICE_TOKEN ?? ''}`);
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (!env.INTERNAL_SERVICE_TOKEN || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.sendStatus(401);
    }
    next();
  });
  app.use(express.json({ limit: '4kb' }));
  app.post('/upload-token', (_req, res) => {
    // Keep the approved service boundary, but never issue cloud upload authority
    // before the competition's data-locality requirements have been resolved.
    res.status(503).json({ error: 'CLOUD_UPLOAD_NOT_APPROVED' });
  });
  app.post('/read-url', async (req, res) => {
    const { pathname } = req.body;
    if (!/^jobs\/[a-f0-9]{32}\/(input\.(mov|mp4|avi|mkv|webm)|attempts\/[a-f0-9]{32}\/evidence\/[a-f0-9]{32}\.jpg)$/.test(pathname ?? '')) {
      return res.sendStatus(400);
    }
    const validUntil = Date.now() + 5 * 60 * 1000;
    const delegation = await issue({ pathname, operations: ['get'], validUntil });
    const { presignedUrl } = await sign(delegation, { operation: 'get', pathname, access: 'private', validUntil });
    res.json({ url: presignedUrl });
  });
  app.use((_error, _req, res, _next) => res.status(503).json({ error: 'STORAGE_UNAVAILABLE' }));
  return app;
}

export default createApp();
