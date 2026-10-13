import { defineConfig, devices } from '@playwright/test';

const PORT = 5287;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 1000 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false, // never attach to some other app on this port
    timeout: 120_000,
  },
});
