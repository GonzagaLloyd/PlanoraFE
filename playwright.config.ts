import { defineConfig } from '@playwright/test';

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // Locally, use the installed Edge/Chrome; CI installs Playwright's Chromium.
    channel: CI ? undefined : (process.env.PW_CHANNEL ?? 'msedge'),
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    {
      command: 'npm run start -w @planora/mock-api',
      url: 'http://localhost:8787/',
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev -w @planora/playground',
      url: 'http://localhost:5173/',
      reuseExistingServer: true,
    },
  ],
});
