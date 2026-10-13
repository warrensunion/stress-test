import { defineConfig } from 'vitest/config';

// Config for one-off report scripts (not part of `npm test`).
export default defineConfig({ test: { include: ['scripts/**/*.test.ts'], testTimeout: 600_000 } });
