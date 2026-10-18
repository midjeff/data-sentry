import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost', port: 5173, strictPort: true,
    // Standalone npm run dev only. vercel dev owns public service routing;
    // runtime service bindings must never be consumed by this build/dev config.
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
    fs: {
      strict: true,
      // Retain default restrictions and exclude the private backend tree from file serving.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/backend/**', '**/services/**', '**/.qa/**', '**/*.sqlite3*'],
    },
  },
});
