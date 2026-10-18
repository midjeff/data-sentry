// Test-only port overrides. The checked-in development configuration remains unchanged.
import { createServer } from 'vite';
const [frontendPort, apiPort] = process.argv.slice(2).map(Number);
if (![frontendPort, apiPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Error('Invalid test port');
const server = await createServer({ server: { port: frontendPort,
  proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } } } });
await server.listen();
