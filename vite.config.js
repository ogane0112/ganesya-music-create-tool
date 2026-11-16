import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    // 手元では、保存用APIとMCPを `npm run dev:worker`(wrangler dev)に回す
    proxy: Object.fromEntries(['/api', '/mcp', '/sounds', '/oauth', '/.well-known'].map((p) => [p, 'http://localhost:8787'])),
  },
  test: {
    include: ['test/**/*.test.js'],
  },
});
