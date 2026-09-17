import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: __dirname,
  testMatch: 'loginLogout.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  preserveOutput: 'never',
  timeout: 180_000,
  expect: { timeout: 25_000 },
  outputDir: resolve(__dirname, '../../out/playwright/auth-only'),
  reporter: [[resolve(__dirname, 'redactedReporter.ts')]],
  use: { trace: 'off', video: 'off', screenshot: 'off' }
});
