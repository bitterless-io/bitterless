import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';

const projectRoot = resolve(__dirname, '..', '..');
const outputRoot = join(projectRoot, 'out', 'playwright', 'coding-agent');

export default defineConfig({
  testDir: join(__dirname, 'specs'),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  outputDir: join(outputRoot, 'test-results'),
  reporter: [['list'], ['html', { outputFolder: join(outputRoot, 'html-report'), open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off'
  },
  projects: [{ name: 'electron' }]
});
