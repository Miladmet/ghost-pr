// Playwright config for GhostPR's own reproduction specs.
// `npm test` runs only tests/; generated and temporary specs under artifacts/ are excluded.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60000,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true
  }
});
