import { defineConfig } from '@playwright/test';

// Isolated frontend fixtures only: no backend, database or provider is started.
export default defineConfig({
  testDir: './sec001', outputDir: './test-results/sec001', workers: 1,
  timeout: 30000, reporter: [['list']],
  use: {
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'pnpm --filter landlord-h5 exec vite --host 127.0.0.1 --port 5183 --strictPort', url: 'http://127.0.0.1:5183', reuseExistingServer: false },
    { command: 'pnpm --filter tenant-h5 exec vite --host 127.0.0.1 --port 5184 --strictPort', url: 'http://127.0.0.1:5184/tenant/', reuseExistingServer: false },
  ],
});
