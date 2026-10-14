import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the app from /stress-test/; local dev and preview stay at /.
  base: process.env.GITHUB_PAGES ? '/stress-test/' : '/',
  plugins: [react()],
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
