import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../../maestro/fixtures/bitterlessApp.fixture';
import {
  GMGN_CLI_FIXTURE_ADDRESSES,
  GMGN_CLI_FIXTURE_BSC_BATCH,
  GMGN_CLI_FIXTURE_DESKTOP_PATH,
} from '../fixtures/gmgnCli.fixture';

const projectRoot = resolve(__dirname, '..', '..', '..');
const screenshotRoot = join(projectRoot, 'out', 'playwright', 'coin', 'screenshots');

test.use({ coinGmgnFixture: true });

const sendHomeXpc = async (page: Page, method: string, params?: unknown): Promise<unknown> =>
  await page.evaluate(
    async ({ handleName, handleParams }) =>
      await (
        window as unknown as {
          xpcRenderer: { send: (name: string, value?: unknown) => Promise<unknown> };
        }
      ).xpcRenderer.send(handleName, handleParams),
    { handleName: method, handleParams: params },
  );

const trenchLeaf = (id: string, url: string) => ({
  id,
  type: 'leaf',
  url,
  contentMode: 'miniapp',
  miniAppId: 'trench',
});

interface NativeTrenchView {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
}

const nativeTrenchViews = async (app: ElectronApplication): Promise<NativeTrenchView[]> =>
  await app.evaluate((electron) => {
    const omni = electron.BaseWindow.getAllWindows().find((window) =>
      window.contentView.children.some((view) => {
        const content = view as unknown as { webContents?: Electron.WebContents };
        return Boolean(content.webContents && /\/omni\/omniWindow\/index\.html(?:$|[?#])/.test(
          content.webContents.getURL(),
        ));
      }),
    );
    if (!omni) return [];
    return omni.contentView.children.flatMap((view) => {
      const content = view as unknown as {
        webContents?: Electron.WebContents;
        getBounds: () => Electron.Rectangle;
      };
      if (!content.webContents || !/\/coin\/index\.html(?:$|[?#])/.test(
        content.webContents.getURL(),
      )) return [];
      return [{ id: content.webContents.id, bounds: content.getBounds() }];
    }).sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
  });

const executeInView = async <T>(
  app: ElectronApplication,
  id: number,
  expression: string,
): Promise<T> => await app.evaluate(async (electron, payload) => {
  const contents = electron.webContents.fromId(payload.id);
  if (!contents || contents.isDestroyed()) throw new Error('Trench view is unavailable');
  return await contents.executeJavaScript(payload.expression, true) as T;
}, { id, expression });

const clickInView = async (
  app: ElectronApplication,
  id: number,
  selector: string,
): Promise<void> => {
  await executeInView(app, id, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error('Trench control is unavailable');
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.click();
  })()`);
};

const waitForViews = async (
  app: ElectronApplication,
  count: number,
): Promise<NativeTrenchView[]> => {
  await expect.poll(async () => (await nativeTrenchViews(app)).length).toBe(count);
  const views = await nativeTrenchViews(app);
  for (const view of views) {
    await expect.poll(async () => await executeInView(app, view.id, `({
      host: window.trenchHost?.host,
      ready: Boolean(document.querySelector('[name="trench__index"]')),
    })`)).toEqual({ host: 'omni', ready: true });
  }
  return views;
};

const setOmniContentSize = async (
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<void> => {
  await app.evaluate((electron, size) => {
    const omni = electron.BaseWindow.getAllWindows().find((window) =>
      window.contentView.children.some((view) => {
        const content = view as unknown as { webContents?: Electron.WebContents };
        return Boolean(content.webContents && /\/omni\/omniWindow\/index\.html(?:$|[?#])/.test(
          content.webContents.getURL(),
        ));
      }),
    );
    if (!omni) throw new Error('Omni window is unavailable');
    omni.setContentSize(size.width, size.height);
  }, { width, height });
};

const expectWorkspaceAt = async (
  app: ElectronApplication,
  view: NativeTrenchView,
  width: number,
  height: number,
): Promise<void> => {
  await expect.poll(async () => await executeInView(app, view.id, `(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    targets: document.querySelectorAll('[name="trench__index__target-row"]').length,
    wallets: document.querySelectorAll('[name="trench__index__wallet-row"]').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    addVisible: Boolean(document.querySelector('[name="trench__index__add-ca"]')?.getClientRects().length),
    reanalyzeVisible: Boolean(document.querySelector('[name="trench__index__reanalyze"]')?.getClientRects().length),
  }))()`)).toEqual({
    width,
    height,
    targets: 1,
    wallets: 1,
    overflowX: 0,
    overflowY: 0,
    addVisible: true,
    reanalyzeVisible: true,
  });
};

const expectRejectedAvatarAt = async (
  app: ElectronApplication,
  view: NativeTrenchView,
): Promise<void> => {
  await expect.poll(async () => await executeInView(app, view.id, `(() => {
    const avatar = document.querySelector('[name="trench__index__wallet-avatar"]');
    const image = document.querySelector('[name="trench__index__wallet-avatar-image"]');
    const fallback = avatar?.querySelector('.trench-index__avatar-fallback');
    const bounds = avatar?.getBoundingClientRect();
    const fallbackStyle = fallback ? getComputedStyle(fallback) : null;
    return {
      avatarExists: Boolean(avatar),
      imageExists: Boolean(image),
      fallbackText: fallback?.textContent || '',
      fallbackVisible: Boolean(
        fallback &&
        fallbackStyle?.display !== 'none' &&
        fallbackStyle?.visibility !== 'hidden' &&
        fallback.getClientRects().length
      ),
      width: bounds?.width || 0,
      height: bounds?.height || 0,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    };
  })()`)).toEqual({
    avatarExists: true,
    imageExists: false,
    fallbackText: 'F',
    fallbackVisible: true,
    width: 28,
    height: 28,
    overflowX: 0,
    overflowY: 0,
  });
};

const expectSettingsAt = async (
  app: ElectronApplication,
  view: NativeTrenchView,
): Promise<void> => {
  await clickInView(app, view.id, '[name="trench__header__gmgn-settings"]');
  await expect.poll(async () => await executeInView(app, view.id, `(() => {
    const modal = document.querySelector('[name="trench__gmgn-settings"]');
    const input = document.querySelector('#trench-gmgn-api-key');
    const close = document.querySelector('[name="trench__gmgn-settings__close"]');
    return {
      visible: Boolean(modal?.getClientRects().length),
      inputExists: Boolean(input),
      closeExists: Boolean(close),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    };
  })()`)).toEqual({
    visible: true,
    inputExists: true,
    closeExists: true,
    overflowX: 0,
    overflowY: 0,
  });
  await executeInView(app, view.id, `(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    document.querySelector('.trench-gmgn-settings-modal .arco-modal-body')?.scrollTo(0, 0);
  })()`);
};

const captureView = async (
  app: ElectronApplication,
  id: number,
  filename: string,
): Promise<void> => {
  const png = await app.evaluate(async (electron, webContentsId) => {
    const contents = electron.webContents.fromId(webContentsId);
    if (!contents || contents.isDestroyed()) throw new Error('Trench view is unavailable');
    return (await contents.capturePage()).toPNG().toString('base64');
  }, id);
  writeFileSync(join(screenshotRoot, filename), Buffer.from(png, 'base64'));
};

const trenchIoRuntimeId = async (app: ElectronApplication): Promise<number | null> =>
  await app.evaluate((electron) => electron.BrowserWindow.getAllWindows().find((candidate) =>
    /\/trench-io\/index\.html(?:$|[?#])/.test(candidate.webContents.getURL()),
  )?.webContents.id ?? null);

test('renders the persisted INDEX workspace in standalone and Omni host geometries', async ({
  bitterless,
}) => {
  const { app, hostPage, mockOrigin, mockRequests, gmgnCliCalls, userDataDir } = bitterless;
  mkdirSync(screenshotRoot, { recursive: true });

  await expect.poll(
    async () => await hostPage.locator('#app').evaluate((element) => element.childElementCount),
  ).toBeGreaterThan(0);
  await hostPage.evaluate(() => localStorage.setItem(
    'bitterless-desktop-token',
    'bitterless-e2e-token',
  ));
  const hostUrl = hostPage.url().split('#')[0];
  await hostPage.goto(`${hostUrl}#/mini-app`);
  const openButton = hostPage.locator('[data-mini-app-id="coin"]')
    .getByRole('button', { name: /Open|打开/ });
  await expect(openButton).toBeVisible();
  await openButton.click();
  const trenchPage = await bitterless.waitForRenderer('coin');
  const avatarRequestCount = (): number => mockRequests
    .filter((request) => request === 'GET /auth/me').length;
  await app.evaluate((electron) => {
    const window = electron.BrowserWindow.getAllWindows().find((candidate) =>
      /\/coin\/index\.html(?:$|[?#])/.test(candidate.webContents.getURL()),
    );
    if (!window) throw new Error('Standalone Trench window is unavailable');
    window.setContentSize(1360, 860);
  });
  await expect.poll(async () => await trenchPage.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))).toEqual({ width: 1360, height: 860 });

  expect(await app.evaluate(() => process.env.PATH)).toBe(GMGN_CLI_FIXTURE_DESKTOP_PATH);

  const gmgnBridgeStatus = await trenchPage.evaluate(async () => {
    try {
      return {
        status: await (
          window as unknown as {
            coin: { resources: { detectGmgn: () => Promise<unknown> } };
          }
        ).coin.resources.detectGmgn(),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  expect(gmgnBridgeStatus).toMatchObject({
    status: {
      installed: true,
      apiKeyConfigured: true,
      privateKeyDetected: false,
    },
  });
  expect(gmgnCliCalls().some(({ args }) => args.length === 1 && args[0] === '--version')).toBe(true);

  await trenchPage.locator('[name="trench__header__gmgn-settings"]').click();
  await expect(trenchPage.locator('[name="trench__gmgn-settings"]')).toBeVisible();
  await expect(trenchPage.locator('#trench-gmgn-api-key')).toHaveValue('');
  await trenchPage.locator('[name="trench__gmgn-settings__verify-existing"]').click();
  await expect(trenchPage.locator('[name="trench__gmgn-settings__feedback"]'))
    .toContainText('GMGN read-only access verified.');
  await expect(trenchPage.locator('[name="trench__gmgn-settings__verify-existing"]')).toBeEnabled();
  await trenchPage.screenshot({
    path: join(screenshotRoot, 'trench-gmgn-settings-standalone-1360x860.png'),
  });
  await trenchPage.locator('[name="trench__gmgn-settings__close"]').click();
  await expect(trenchPage.locator('[name="trench__gmgn-settings"]')).toHaveCount(0);

  await trenchPage.locator('[name="trench__index__add-ca"]').click();
  const callsBeforeWrongChain = gmgnCliCalls().length;
  await trenchPage.locator('[name="trench__index__ca-input"]').fill(
    GMGN_CLI_FIXTURE_ADDRESSES.bsc,
  );
  await expect(trenchPage.locator('.trench-index__dialog-warning')).toContainText(
    '1 BSC chain CA(s) ignored.',
  );
  await trenchPage.locator('.arco-modal-footer .arco-btn-primary').click();
  await expect(trenchPage.locator('.trench-index__dialog-error')).toContainText(
    'No valid SOL CA remains for this tab.',
  );
  expect(gmgnCliCalls().length).toBe(callsBeforeWrongChain);

  await trenchPage.locator('[name="trench__index__ca-input"]').fill(
    `${GMGN_CLI_FIXTURE_ADDRESSES.bsc}\n${GMGN_CLI_FIXTURE_ADDRESSES.solana}`,
  );
  await expect(trenchPage.locator('.trench-index__dialog-warning')).toContainText(
    '1 BSC chain CA(s) ignored.',
  );
  await trenchPage.locator('.arco-modal-footer .arco-btn-primary').click();
  await expect(trenchPage.locator('[name="trench__index__target-row"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(trenchPage.locator('[name="trench__index__wallet-row"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(trenchPage.locator('[name="trench__index__target-row"]', {
    hasText: 'SOLE2E',
  })).toHaveCount(1);
  await expect(trenchPage.locator('[name="trench__index__wallet-row"]')).toContainText(
    'Fixture Sol Alpha',
  );
  await expect(trenchPage.locator('.trench-index__rank')).toHaveText('#01');
  await expect(trenchPage.locator('[name="trench__index__wallet-avatar"]')).toHaveCount(0);

  const callsBeforeTabSwitch = gmgnCliCalls().length;
  await trenchPage.getByRole('tab', { name: 'BSC' }).click();
  expect(gmgnCliCalls().length).toBe(callsBeforeTabSwitch);
  await expect(trenchPage.locator('[name="trench__index__target-row"]')).toHaveCount(0);
  await trenchPage.locator('[name="trench__index__add-ca"]').click();
  const callsBeforeWrongSolana = gmgnCliCalls().length;
  await trenchPage.locator('[name="trench__index__ca-input"]').fill(GMGN_CLI_FIXTURE_ADDRESSES.solana);
  await expect(trenchPage.locator('.trench-index__dialog-warning')).toContainText(
    '1 Solana chain CA(s) ignored.',
  );
  await trenchPage.locator('.arco-modal-footer .arco-btn-primary').click();
  await expect(trenchPage.locator('.trench-index__dialog-error')).toContainText(
    'No valid BSC CA remains for this tab.',
  );
  expect(gmgnCliCalls().length).toBe(callsBeforeWrongSolana);
  const avatarRequestsBeforeBsc = avatarRequestCount();
  await trenchPage.locator('[name="trench__index__ca-input"]').fill(GMGN_CLI_FIXTURE_ADDRESSES.bsc);
  await trenchPage.locator('.arco-modal-footer .arco-btn-primary').click();
  await expect(trenchPage.locator('[name="trench__index__target-row"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(trenchPage.locator('[name="trench__index__target-row"]')).toContainText('BSCE2E');
  await expect(trenchPage.locator('[name="trench__index__wallet-row"]')).toContainText('Fixture Alpha');
  await expect(trenchPage.locator('.trench-index__rank')).toHaveText('#01');
  const avatar = trenchPage.locator('[name="trench__index__wallet-avatar"]');
  await expect(avatar).toHaveText('F');
  await expect(avatar).toHaveCSS('width', '28px');
  await expect(avatar).toHaveCSS('height', '28px');
  await expect(trenchPage.locator('[name="trench__index__wallet-avatar-image"]')).toHaveCount(0);
  expect(avatarRequestCount()).toBe(avatarRequestsBeforeBsc + 1);
  const callsBeforeReturnTab = gmgnCliCalls().length;
  await trenchPage.getByRole('tab', { name: 'SOL' }).click();
  await expect(trenchPage.locator('[name="trench__index__wallet-row"]')).toContainText('Fixture Sol Alpha');
  await expect(trenchPage.locator('.trench-index__rank')).toHaveText('#01');
  expect(gmgnCliCalls().length).toBe(callsBeforeReturnTab);
  await trenchPage.getByRole('tab', { name: 'BSC' }).click();
  await expect(trenchPage.locator('[name="trench__index__reanalyze"]')).toBeEnabled();
  await expect.poll(() => gmgnCliCalls().filter(({ args }) =>
    args[0] === 'token' && args[1] === 'traders').length).toBe(3);
  const traderCalls = gmgnCliCalls().filter(({ args }) =>
    args[0] === 'token' && args[1] === 'traders');
  expect(traderCalls.every(({ args }) =>
    args.includes('--order-by') && args[args.indexOf('--order-by') + 1] === 'profit' &&
    args.includes('--direction') && args[args.indexOf('--direction') + 1] === 'desc' &&
    args.includes('--limit') && args[args.indexOf('--limit') + 1] === '100')).toBe(true);

  const originalTrenchIoId = await trenchIoRuntimeId(app);
  expect(originalTrenchIoId).not.toBeNull();
  await app.evaluate((electron, webContentsId) => {
    const runtimeWindow = electron.BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.id === webContentsId,
    );
    if (!runtimeWindow || runtimeWindow.isDestroyed()) {
      throw new Error('trench-io runtime is unavailable');
    }
    runtimeWindow.destroy();
  }, originalTrenchIoId as number);
  await expect.poll(async () => await trenchIoRuntimeId(app), { timeout: 30_000 })
    .not.toBe(originalTrenchIoId);
  await expect.poll(async () => await trenchIoRuntimeId(app), { timeout: 30_000 })
    .not.toBeNull();
  await expect.poll(async () => await trenchPage.evaluate(async () => {
    try {
      const result = await (
        window as unknown as {
          xpcRenderer: { send: (name: string) => Promise<{ ok?: unknown }> };
        }
      ).xpcRenderer.send('TrenchHandler/getIndexWorkspace');
      return result.ok === true;
    } catch {
      return false;
    }
  }), { timeout: 30_000 }).toBe(true);
  await expect(trenchPage.locator('[name="trench__index__reanalyze"]')).toBeEnabled({
    timeout: 30_000,
  });
  await trenchPage.locator('[name="trench__index__reanalyze"]').click();
  await expect.poll(() => gmgnCliCalls().filter(({ args }) =>
    args[0] === 'token' && args[1] === 'traders').length, { timeout: 30_000 }).toBe(5);
  await expect(trenchPage.locator('[name="trench__index__target-row"]')).toHaveCount(1);
  await expect(trenchPage.locator('[name="trench__index__wallet-row"]')).toHaveCount(1);
  expect(avatarRequestCount()).toBe(avatarRequestsBeforeBsc + 1);
  await trenchPage.screenshot({
    path: join(screenshotRoot, 'trench-index-standalone-1360x860.png'),
  });

  const preservedBrowserUrl = `${mockOrigin}/ai-crms`;
  const singleTree = trenchLeaf('trench-index-primary', preservedBrowserUrl);
  await sendHomeXpc(hostPage, 'SettingDao/upsert', {
    key: 'omni_layout',
    value: { tree: singleTree },
  });
  await sendHomeXpc(hostPage, 'OmniWindowHandler/openOmniWindow');
  let [view] = await waitForViews(app, 1);
  await setOmniContentSize(app, 800, 600);
  [view] = await waitForViews(app, 1);
  await expectWorkspaceAt(app, view, 800, 568);
  await captureView(app, view.id, 'trench-index-omni-800x568.png');
  const avatarRequestsBeforeOmniBsc = avatarRequestCount();
  await clickInView(app, view.id, '#trench-index-tab-bsc');
  await expect.poll(avatarRequestCount).toBe(avatarRequestsBeforeOmniBsc + 1);
  await expectRejectedAvatarAt(app, view);
  await clickInView(app, view.id, '#trench-index-tab-solana');
  await clickInView(app, view.id, '#trench-index-tab-bsc');
  await expectRejectedAvatarAt(app, view);
  expect(avatarRequestCount()).toBe(avatarRequestsBeforeOmniBsc + 1);
  await captureView(app, view.id, 'trench-index-omni-bsc-avatar-fallback-800x568.png');

  const horizontalTree = {
    id: 'trench-index-horizontal',
    type: 'split',
    direction: 'h',
    sizes: [50, 50],
    children: [
      trenchLeaf('trench-index-primary', preservedBrowserUrl),
      trenchLeaf('trench-index-secondary', preservedBrowserUrl),
    ],
  };
  await sendHomeXpc(hostPage, 'OmniWindowHandler/commitLayout', { tree: horizontalTree });
  const horizontalViews = await waitForViews(app, 2);
  for (const horizontalView of horizontalViews) {
    await expectWorkspaceAt(app, horizontalView, 398, 568);
    await expectSettingsAt(app, horizontalView);
    await clickInView(app, horizontalView.id, '[name="trench__gmgn-settings__close"]');
  }
  await expectSettingsAt(app, horizontalViews[0]);
  await captureView(app, horizontalViews[0].id, 'trench-gmgn-settings-omni-398x568.png');
  await clickInView(app, horizontalViews[0].id, '[name="trench__gmgn-settings__close"]');

  const verticalTree = { ...horizontalTree, id: 'trench-index-vertical', direction: 'v' };
  await sendHomeXpc(hostPage, 'OmniWindowHandler/commitLayout', { tree: verticalTree });
  const verticalViews = await waitForViews(app, 2);
  for (const verticalView of verticalViews) {
    await expectWorkspaceAt(app, verticalView, 800, 282);
    await expectSettingsAt(app, verticalView);
    await clickInView(app, verticalView.id, '[name="trench__gmgn-settings__close"]');
  }
  [view] = verticalViews;
  await expectSettingsAt(app, view);
  await captureView(app, view.id, 'trench-gmgn-settings-omni-800x282.png');
  await clickInView(app, view.id, '[name="trench__gmgn-settings__close"]');

  const fourCaText = GMGN_CLI_FIXTURE_BSC_BATCH.join('\n');
  const credentialPath = join(dirname(userDataDir), 'home', '.config', 'gmgn', '.env');
  rmSync(credentialPath, { force: true });
  await trenchPage.getByRole('tab', { name: 'BSC' }).click();
  await trenchPage.locator('[name="trench__index__add-ca"]').click();
  await trenchPage.locator('[name="trench__index__ca-input"]').fill(fourCaText);
  await trenchPage.locator('.arco-modal-footer .arco-btn-primary').click();
  await expect(trenchPage.locator('.trench-index__dialog-error')).toContainText(
    'GMGN is unavailable.',
  );
  await trenchPage.locator('[name="trench__index__dialog-configure-gmgn"]').click();
  await expect(trenchPage.locator('[name="trench__gmgn-settings"]')).toBeVisible();
  await expect(trenchPage.locator('#trench-gmgn-api-key')).toHaveValue('');
  await trenchPage.locator('#trench-gmgn-api-key').fill('gmgn_e2e_replacement_read_only_12345');
  await trenchPage.locator('[name="trench__gmgn-settings__save-verify"]').click();
  await expect(trenchPage.locator('[name="trench__gmgn-settings__feedback"]'))
    .toContainText('GMGN read-only access verified.');
  await expect(trenchPage.locator('#trench-gmgn-api-key')).toHaveValue('');
  await trenchPage.locator('[name="trench__gmgn-settings__close"]').click();
  await expect(trenchPage.locator('[name="trench__index__ca-input"]')).toHaveValue(fourCaText);
  await trenchPage.locator('.arco-modal-footer .arco-btn-primary').click();
  await expect(trenchPage.locator('[name="trench__index__target-row"]')).toHaveCount(5, {
    timeout: 30_000,
  });
  await expect(trenchPage.locator('[name="trench__index__reanalyze"]')).toBeEnabled({
    timeout: 60_000,
  });
  await trenchPage.screenshot({
    path: join(screenshotRoot, 'trench-gmgn-recovery-four-ca.png'),
  });

  expect(bitterless.unexpectedMockRequests).toEqual([]);
  expect(bitterless.deniedNetworkRequests()).toEqual([]);
  expect(bitterless.rendererErrors).toEqual([]);
});
