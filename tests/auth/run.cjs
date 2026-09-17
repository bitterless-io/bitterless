/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const environment = { ...process.env };
environment.PLAYWRIGHT_NO_COPY_PROMPT = '1';
delete environment.DEBUG;
delete environment.PWDEBUG;
delete environment.PLAYWRIGHT_HTML_REPORT;
const result = spawnSync(
  process.execPath,
  [
    require.resolve('@playwright/test/cli'),
    'test',
    '-c',
    resolve(__dirname, 'playwright.config.ts')
  ],
  {
    cwd: resolve(__dirname, '../..'),
    env: environment,
    stdio: 'inherit'
  }
);
if (result.error) console.error('[auth-e2e] runner failed to start');
process.exitCode = result.status ?? 1;
