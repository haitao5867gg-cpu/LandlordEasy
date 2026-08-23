import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'mysql://e2e:e2e@127.0.0.1:3307/landlord_easy_e2e';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      // 不用 `nest start`：它走 webpack 增量编译,在较新的 Node 版本上会静默编译失败
      // (退出码0但不产出 dist,没有任何报错输出,详见根目录 README.md「运行核心 E2E 测试」
      // 一节的排障说明)。run.sh 会先跑一次 `nest build`(纯 tsc,稳定),这里只负责启动
      // 已经编译好的产物。
      command: 'node ../apps/server/dist/main',
      url: 'http://127.0.0.1:3000/api/v1/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        PORT: '3000',
        JWT_SECRET: 'landlord-easy-e2e-only-secret',
        JWT_EXPIRES_IN: '1h',
        WECHAT_MODE: 'mock',
        PUBLIC_REVIEW_MODE: 'false',
      },
    },
    {
      command:
        'pnpm --filter landlord-h5 exec vite --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173/login',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        'pnpm --filter tenant-h5 exec vite --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174/tenant/login',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
