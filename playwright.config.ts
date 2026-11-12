import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // The Scryfall client spaces searches 500 ms apart: pricing a full 100-card deck takes ~3 s, Find suggestions ~10 s.
  expect: { timeout: 15_000 },
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}/swapsmith/`,
    trace: 'on-first-retry',
    // Keep fixtures in charge: a service worker would sit between page.route and the network.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/swapsmith/`,
    reuseExistingServer: !process.env.CI,
  },
});
