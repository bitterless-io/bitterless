import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { buildBitterlessE2ELaunchArgs } from '../e2e/electronLaunchArgs';
import { AUTH_E2E_PRODUCTION_ORIGIN } from '../../src/shared/auth/authE2E.contract';
import { assertProductionAuthBuild, authLaunchEnvironment } from './authRuntime';

const root = resolve(__dirname, '../..');
const waitForPage = async (app: ElectronApplication, path: string): Promise<Page> => {
  await expect
    .poll(() => app.windows().some((page) => page.url().includes(path)), { timeout: 60_000 })
    .toBe(true);
  return app.windows().find((page) => page.url().includes(path))!;
};
const send = async <T>(page: Page, channel: string, params?: unknown): Promise<T> =>
  page.evaluate(
    ({ channel, params }) =>
      (
        globalThis as unknown as {
          xpcRenderer: { send(channel: string, params?: unknown): Promise<T> };
        }
      ).xpcRenderer.send(channel, params),
    { channel, params }
  );

// eslint-disable-next-line no-empty-pattern -- This Electron test creates no browser fixture.
test('production login and logout retain the anonymous browser and Control renderer', async ({}, testInfo) => {
  const email = process.env.AUTH_E2E_EMAIL;
  const password = process.env.AUTH_E2E_PASSWORD;
  if (!email || !password)
    throw new Error('AUTH_E2E_EMAIL and AUTH_E2E_PASSWORD are required in the runner environment.');
  assertProductionAuthBuild(root);
  const tempRoot = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'bl-auth-e2e-')
  );
  const homeDir = join(tempRoot, 'home');
  const userDataDir = join(tempRoot, 'user-data');
  mkdirSync(homeDir);
  mkdirSync(userDataDir);
  let app: ElectronApplication | undefined;
  let stage = 'launch';
  try {
    app = await electron.launch({
      args: buildBitterlessE2ELaunchArgs({ platform: process.platform, applicationPath: root }),
      env: authLaunchEnvironment(homeDir, userDataDir),
      timeout: 60_000
    });
    const isolation = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      credentialsLeaked: Boolean(process.env.AUTH_E2E_EMAIL || process.env.AUTH_E2E_PASSWORD)
    }));
    stage = 'target-validation';
    expect(isolation).toEqual({ packaged: false, userData: userDataDir, credentialsLeaked: false });
    const authority = await waitForPage(app, '/renderer/home/index.html');
    const environment = await authority.evaluate(
      () =>
        (
          globalThis as unknown as {
            homeEnv: { authOnlyE2E?: { coreOrigin: string; mode: string; env: string } };
          }
        ).homeEnv.authOnlyE2E
    );
    // Check the actual compiled Home preload profile and endpoint BEFORE credentials enter a field.
    expect(environment).toEqual({
      coreOrigin: AUTH_E2E_PRODUCTION_ORIGIN,
      mode: 'debug',
      env: 'prod'
    });
    const control = await waitForPage(app, '/maestro/control/index.html');
    stage = 'anonymous-browser';
    await send(control, 'CoachXpcHandler/newTab');
    const tabs = await send<Array<{ id: string; kind: string }>>(
      control,
      'CoachXpcHandler/getTabs'
    );
    const browserIds = tabs.filter((tab) => tab.kind === 'browser').map((tab) => tab.id);
    expect(browserIds.length).toBeGreaterThan(0);
    await send(control, 'CoachXpcHandler/requestLogin');
    await expect(control.locator('[name="login"]')).toBeVisible();
    await control.locator('[name="control-auth__close"]').click();
    await send(control, 'CoachXpcHandler/requestLogin');
    await expect(control.locator('input[autocomplete="email"]')).toBeVisible();
    stage = 'login';
    const loginResponse = authority
      .waitForResponse(
        (response) =>
          response.url() === `${AUTH_E2E_PRODUCTION_ORIGIN}/auth/login` &&
          response.request().method() === 'POST'
      )
      .then(
        (response) => response.ok(),
        () => false
      );
    await control.locator('input[autocomplete="email"]').fill(email);
    await control.locator('input[autocomplete="current-password"]').fill(password);
    await control.locator('input[autocomplete="current-password"]').press('Enter');
    expect(await loginResponse).toBe(true);
    stage = 'authenticated-control';
    await expect(control.locator('[name="login"]')).toHaveCount(0);
    await expect(control.locator('.control-app')).toBeVisible();
    expect(
      (await send<{ phase: string }>(control, 'HomeShellBridgeHandler/getAuthSnapshot')).phase
    ).toBe('ready');
    // Use the same addressed logout transaction as AccountSetting, without opening any business app.
    stage = 'logout';
    const logoutResponse = authority
      .waitForResponse(
        (response) =>
          response.url() === `${AUTH_E2E_PRODUCTION_ORIGIN}/auth/logout` &&
          response.request().method() === 'POST'
      )
      .then(
        (response) => response.ok(),
        () => false
      );
    await send(control, 'ApplicationAuthHandler/invalidate');
    await send(control, 'HomeShellBridgeHandler/prepareLogout');
    await send(control, 'AuthHandler/deactivateSession');
    expect(await logoutResponse).toBe(true);
    stage = 'anonymous-after-logout';
    await expect(control.locator('[name="login"]')).toBeVisible();
    expect(
      (await send<{ phase: string }>(control, 'HomeShellBridgeHandler/getAuthSnapshot')).phase
    ).toBe('signed-out');
    const after = await send<Array<{ id: string }>>(control, 'CoachXpcHandler/getTabs');
    expect(browserIds.every((id) => after.some((tab) => tab.id === id))).toBe(true);
    expect(control.isClosed()).toBe(false);
    await control.locator('[name="control-auth__close"]').click();
    await send(control, 'CoachXpcHandler/requestLogin');
    await expect(control.locator('[name="login"]')).toBeVisible();
    await send(control, 'CoachXpcHandler/newTab');
  } catch {
    // Re-throw a fixed failure stage: never turn failure into success, never expose fill arguments.
    throw new Error(`[auth-e2e-stage:${stage}]`);
  } finally {
    // No diagnostics, traces, DOM snapshots, storage state or subprocess logs are retained.
    await app?.close().catch(() => undefined);
    testInfo.attachments.splice(0);
    if (basename(tempRoot).startsWith('bl-auth-e2e-'))
      rmSync(tempRoot, { recursive: true, force: true });
    rmSync(testInfo.outputDir, { recursive: true, force: true });
  }
});
