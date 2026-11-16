import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true },
  test: {
    include: ['test/**/*.test.js'],
  },
});
