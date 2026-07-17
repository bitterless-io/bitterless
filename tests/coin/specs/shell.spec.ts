import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../../maestro/fixtures/bitterlessApp.fixture';

const projectRoot = resolve(__dirname, '..', '..', '..');
const screenshotRoot = join(projectRoot, 'out', 'playwright', 'coin', 'screenshots');
const coinPagePattern = /\/coin\/index\.html(?:$|[?#])/;

const openButton = (page: Page) =>
  page.locator('[data-mini-app-id="coin"]').getByRole('button', { name: /Open|打开/ });

const coinTab = (page: Page, name: string) =>
  page.locator('.arco-tabs-tab').filter({ hasText: name });

const waitForCoinPage = async (app: ElectronApplication): Promise<Page> => {
  const existing = app.windows().find((page) => coinPagePattern.test(page.url()));
  if (existing) return existing;
  return await app.waitForEvent('window', {
    predicate: (page) => coinPagePattern.test(page.url()),
    timeout: 30_000,
  });
};

const setCoinWindowBounds = async (
  app: ElectronApplication,
  bounds: { x?: number; y?: number; width: number; height: number },
): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, nextBounds) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      /\/coin\/index\.html(?:$|[?#])/.test(candidate.webContents.getURL()),
    );
    if (!window) throw new Error('Coin window is unavailable');
    window.setBounds({ ...window.getBounds(), ...nextBounds });
  }, bounds);
};

const coinWindowSnapshot = async (app: ElectronApplication) =>
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter((window) =>
      /\/coin\/index\.html(?:$|[?#])/.test(window.webContents.getURL()),
    );
    const window = windows[0];
    return {
      count: windows.length,
      id: window?.id || 0,
      bounds: window?.getBounds() || null,
      minSize: window?.getMinimumSize() || null,
      childViews: window?.contentView.children.length || 0,
      url: window?.webContents.getURL() || '',
    };
  });

const expectStableLayout = async (page: Page): Promise<void> => {
  const layout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect();
      if (!bounds) throw new Error(`Missing layout element: ${selector}`);
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rootOverflow: {
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      },
      header: rect('.coin-window-header'),
      workspace: rect('.coin-app__workspace'),
      analysis: rect('.coin-analysis-pane'),
      navigation: rect('.coin-analysis-tabs > .arco-tabs-nav'),
      footer: rect('.coin-status-bar'),
    };
  });

  expect(layout.rootOverflow.x).toBeLessThanOrEqual(1);
  expect(layout.rootOverflow.y).toBeLessThanOrEqual(1);
  expect(layout.header.height).toBe(40);
  expect(layout.footer.height).toBe(28);
  expect(layout.workspace.top).toBe(layout.header.bottom);
  expect(layout.workspace.bottom).toBe(layout.footer.top);
  expect(layout.navigation.height).toBe(38);
  expect(layout.analysis.left).toBeLessThanOrEqual(1);
  expect(layout.analysis.right).toBeGreaterThanOrEqual(layout.viewport.width - 1);
  expect(layout.analysis.width).toBeGreaterThanOrEqual(layout.viewport.width - 1);
};

test('delivers a secure singleton Coin shell at both supported sizes', async ({ bitterless }) => {
  const { app, hostPage } = bitterless;
  const hostUrl = hostPage.url().split('#')[0];
  await expect.poll(async () =>
    await hostPage.locator('#app').evaluate((element) => element.childElementCount),
  ).toBeGreaterThan(0);
  await hostPage.evaluate(() => {
    localStorage.setItem('bitterless-desktop-token', 'bitterless-e2e-token');
  });
  await hostPage.goto(`${hostUrl}#/mini-app`);

  const card = hostPage.locator('[data-mini-app-id="coin"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Coin');
  await openButton(hostPage).click();

  const coinPage = await waitForCoinPage(app);
  await coinPage.waitForLoadState('domcontentloaded');
  await expect(coinPage.locator('.coin-app')).toBeVisible();
  const firstWindow = await coinWindowSnapshot(app);
  expect(firstWindow.count).toBe(1);
  expect(firstWindow.bounds).toMatchObject({ width: 1360, height: 860 });
  expect(firstWindow.minSize).toEqual([800, 600]);
  expect(firstWindow.childViews).toBe(0);
  expect(firstWindow.url).toMatch(coinPagePattern);

  const bridgeShape = await coinPage.evaluate(() => ({
    requireType: typeof (globalThis as { require?: unknown }).require,
    processType: typeof (globalThis as { process?: unknown }).process,
    bridgeKeys: Object.keys(window.coin).sort(),
    codexKeys: Object.keys(window.coin.codex).sort(),
    dataKeys: Object.keys(window.coin.data).sort(),
    languageKeys: Object.keys(window.coin.language).sort(),
    resourceKeys: Object.keys(window.coin.resources).sort(),
    shellKeys: Object.keys(window.coin.shell).sort(),
    stateKeys: Object.keys(window.coin.state).sort(),
    strategyKeys: Object.keys(window.coin.strategy).sort(),
    windowKeys: Object.keys(window.coin.window).sort(),
    hasXpc: 'xpcRenderer' in globalThis,
    iframeCount: document.querySelectorAll('iframe, webview').length,
  }));
  expect(bridgeShape).toEqual({
    requireType: 'undefined',
    processType: 'undefined',
    bridgeKeys: ['codex', 'data', 'language', 'platform', 'resources', 'shell', 'state', 'strategy', 'window'],
    codexKeys: ['connect', 'disconnect', 'getStatus', 'onDeviceCode'],
    dataKeys: [
      'analyzeMeme',
      'cancel',
      'getSources',
      'monitor',
      'onDiscoverEvent',
      'onMonitorEvent',
      'parseScreener',
      'refreshMonitor',
      'screen',
      'startDiscover',
      'stopDiscover',
    ],
    languageKeys: ['getCurrent', 'onChanged'],
    resourceKeys: [
      'cancelGmgnVerify',
      'detectGmgn',
      'getStatus',
      'openGmgnOfficialLink',
      'saveGmgnApiKey',
      'saveService',
      'verifyGmgn',
    ],
    shellKeys: ['getStatus'],
    stateKeys: ['load', 'recover', 'save'],
    strategyKeys: ['evaluate'],
    windowKeys: ['close', 'minimize', 'toggleMaximize'],
    hasXpc: false,
    iframeCount: 0,
  });

  await hostPage.bringToFront();
  await hostPage.goto(`${hostUrl}#/setting`);
  await hostPage.getByText(/General|通用/, { exact: true }).click();
  await hostPage.locator('.general-setting__body label').filter({ hasText: 'English' }).click();
  await expect.poll(() => coinPage.evaluate(() => document.documentElement.lang)).toBe('en');
  await expect(coinTab(coinPage, 'Monitor')).toBeVisible();

  for (const tab of ['Monitor', 'Screener', 'Meme', 'Strategy', 'History']) {
    await expect(coinTab(coinPage, tab)).toBeVisible();
  }
  const resourcesNav = coinPage.getByRole('button', { name: 'Resources', exact: true });
  await expect(resourcesNav).toBeVisible();
  await coinTab(coinPage, 'Meme').click();
  const activeTabPanel = coinPage.locator(
    '.coin-analysis-tabs .arco-tabs-content-item-active .arco-tabs-pane',
  );
  await expect(activeTabPanel.getByText('Local GMGN CLI · read-only', { exact: true })).toBeVisible();
  await expect(activeTabPanel.getByText(/Local mode requires the read-only GMGN CLI and a configured personal API key/)).toBeVisible();
  await activeTabPanel.locator('.arco-radio-button').filter({ hasText: 'Analyze' }).click();
  await expect(activeTabPanel.getByText('Contract address')).toBeVisible();
  await expect(activeTabPanel.getByRole('button', { name: 'Analyze', exact: true })).toBeDisabled();

  await coinTab(coinPage, 'Screener').click();
  await expect(activeTabPanel.getByPlaceholder('Describe the market conditions to screen')).toBeEditable();
  await activeTabPanel.locator('.arco-radio-button').filter({ hasText: 'Sample' }).click();
  await expect(activeTabPanel.getByText(/Sample mode is explicit test data/)).toBeVisible();

  await coinTab(coinPage, 'Strategy').click();
  await expect(activeTabPanel.getByRole('button', { name: 'Evaluate', exact: true })).toBeEnabled();
  await expect(activeTabPanel.getByText(/No order or signed transaction is created/)).toHaveCount(0);

  await coinTab(coinPage, 'History').click();
  await expect(activeTabPanel.getByText('No stored analyses', { exact: true })).toBeVisible();
  await coinTab(coinPage, 'Monitor').click();
  await expect(activeTabPanel.getByPlaceholder('BTCUSDT, ETHUSDT')).toBeEditable();
  await expect(activeTabPanel.getByRole('button', { name: 'Load', exact: true })).toBeEnabled();
  await expect(coinPage.getByText('Shell ready')).toBeVisible();

  const forbiddenSurface = await coinPage.evaluate(() => ({
    chat: document.querySelectorAll(
      '.coin-codex-pane, .coin-app__codex, [name*="chat" i], [class*="chat" i]',
    ).length,
    composer: document.querySelectorAll('textarea, [name*="composer" i], [class*="composer" i]')
      .length,
    divider: document.querySelectorAll('.coin-split-divider, [name*="split" i], [role="separator"]')
      .length,
  }));
  expect(forbiddenSurface).toEqual({ chat: 0, composer: 0, divider: 0 });

  const aiStatusButton = coinPage.locator('[name="coin__windowHeader__ai"]');
  await expect(aiStatusButton).toContainText('AI sign-in required');
  await aiStatusButton.click();
  await expect(coinPage.locator('[name="coin__resourcesPage"]')).toBeVisible();
  await expect(coinPage.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
  for (const section of ['AI analysis', 'Local data tool', 'Services']) {
    await expect(coinPage.getByRole('heading', { name: section, exact: true })).toBeVisible();
  }
  await expect(coinPage.getByText('yarn global add gmgn-cli', { exact: true })).toBeVisible();
  await expect(coinPage.getByText(/Alchemy/)).toHaveCount(0);
  await expect(coinPage.getByText('Monitor API', { exact: true })).toBeVisible();
  await expect(coinPage.getByRole('button', { name: 'Connect in browser' })).toBeEnabled();
  await expect(resourcesNav).toHaveAttribute('aria-pressed', 'true');
  await expect(aiStatusButton).toHaveAttribute('aria-pressed', 'true');

  mkdirSync(screenshotRoot, { recursive: true });
  await expectStableLayout(coinPage);
  await coinPage.screenshot({
    path: join(screenshotRoot, 'coin-resources-missing-1360x860.png'),
    animations: 'disabled',
  });

  const gmgnKeyRow = coinPage.locator('[name="coin__resources__gmgnKey"]');
  await gmgnKeyRow.getByRole('button', { name: 'Configure', exact: true }).click();
  const gmgnKeyInput = coinPage.getByLabel('GMGN_API_KEY');
  await gmgnKeyInput.fill('gmgn_e2e_transient_not_saved_12345');
  await coinPage.keyboard.press('Escape');
  await expect(gmgnKeyInput).toHaveCount(0);
  await gmgnKeyRow.getByRole('button', { name: 'Configure', exact: true }).click();
  await expect(coinPage.getByLabel('GMGN_API_KEY')).toHaveValue('');
  const gmgnFixtureKey = 'gmgn_e2e_fixture_api_key_12345';
  await coinPage.getByLabel('GMGN_API_KEY').fill(gmgnFixtureKey);
  await coinPage.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(coinPage.getByRole('dialog')).toHaveCount(0);
  await expect(gmgnKeyRow).toContainText('Configured');
  const gmgnCredentialPath = join(
    dirname(bitterless.userDataDir),
    'home',
    '.config',
    'gmgn',
    '.env',
  );
  await expect.poll(() => readFileSync(gmgnCredentialPath, 'utf8')).toBe(
    `GMGN_API_KEY=${gmgnFixtureKey}\n`,
  );
  if (process.platform !== 'win32') {
    expect(statSync(dirname(gmgnCredentialPath)).mode & 0o777).toBe(0o700);
    expect(statSync(gmgnCredentialPath).mode & 0o777).toBe(0o600);
  }

  const serviceSecret = 'service-e2e-secret-path';
  const monitorRow = coinPage.locator('[name="coin__resources__serviceRow"]').filter({
    hasText: 'Monitor API',
  });
  await monitorRow.getByRole('button', { name: 'Configure', exact: true }).click();
  const serviceDialog = coinPage.getByRole('dialog');
  await serviceDialog
    .getByLabel('HTTP base URL')
    .fill(`${bitterless.mockOrigin}/${serviceSecret}`);
  await serviceDialog
    .getByLabel('WebSocket base URL')
    .fill(`${bitterless.mockOrigin.replace('http:', 'ws:')}/${serviceSecret}`);
  await serviceDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(serviceDialog).toHaveCount(0);
  await expect(monitorRow).toContainText(new URL(bitterless.mockOrigin).host);
  await expect(monitorRow).not.toContainText(serviceSecret);

  const rendererResourceStatus = await coinPage.evaluate(async () =>
    JSON.stringify(await window.coin.resources.getStatus()),
  );
  expect(rendererResourceStatus).not.toContain(gmgnFixtureKey);
  expect(rendererResourceStatus).not.toContain(serviceSecret);
  await coinPage.screenshot({
    path: join(screenshotRoot, 'coin-resources-configured-1360x860.png'),
    animations: 'disabled',
  });

  await coinTab(coinPage, 'Monitor').click();
  await expect(coinPage.locator('[name="coin__resourcesPage"]')).toHaveCount(0);

  await coinPage.locator('[name="coin__windowHeader__sources"]').click();
  const drawer = coinPage.locator('.arco-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Monitor HTTP', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Monitor WebSocket', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Deterministic strategy v1', { exact: true })).toBeVisible();
  await expect(drawer.getByText(/Alchemy/)).toHaveCount(0);
  await expect(drawer.getByText('Yes', { exact: true })).toBeVisible();
  const readDrawerPlacement = () => coinPage.evaluate(() => {
    const drawer = document.querySelector('.arco-drawer')!.getBoundingClientRect();
    const analysis = document.querySelector('.coin-analysis-pane')!.getBoundingClientRect();
    return {
      drawerLeft: drawer.left,
      drawerRight: drawer.right,
      analysisLeft: analysis.left,
      analysisRight: analysis.right,
    };
  });
  await expect.poll(async () => {
    const placement = await readDrawerPlacement();
    return placement.drawerRight - placement.analysisRight;
  }).toBeLessThanOrEqual(1);
  const drawerPlacement = await readDrawerPlacement();
  expect(drawerPlacement.drawerLeft).toBeGreaterThanOrEqual(drawerPlacement.analysisLeft - 1);
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();

  await expectStableLayout(coinPage);
  await coinPage.screenshot({
    path: join(screenshotRoot, 'coin-1360x860.png'),
    animations: 'disabled',
  });
  await resourcesNav.click();
  await expectStableLayout(coinPage);
  await coinPage.screenshot({
    path: join(screenshotRoot, 'coin-resources-1360x860.png'),
    animations: 'disabled',
  });
  await coinTab(coinPage, 'Monitor').click();

  await setCoinWindowBounds(app, { width: 800, height: 600 });
  await expect.poll(() => coinPage.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width: 800, height: 600 });
  await expectStableLayout(coinPage);
  await coinPage.screenshot({
    path: join(screenshotRoot, 'coin-800x600.png'),
    animations: 'disabled',
  });
  await aiStatusButton.click();
  await expectStableLayout(coinPage);
  await coinPage.screenshot({
    path: join(screenshotRoot, 'coin-resources-800x600.png'),
    animations: 'disabled',
  });

  const screenWorkArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  const persistedBounds = {
    x: screenWorkArea.x + 36,
    y: screenWorkArea.y + 32,
    width: 1180,
    height: 720,
  };
  await setCoinWindowBounds(app, persistedBounds);
  await coinPage.waitForTimeout(350);
  await coinPage.getByRole('button', { name: 'Close Coin' }).click();
  await expect.poll(async () => (await coinWindowSnapshot(app)).count).toBe(0);

  const windowStatePath = join(bitterless.userDataDir, 'coin', 'window-state.json');
  await expect.poll(() => JSON.parse(readFileSync(windowStatePath, 'utf8')).bounds)
    .toEqual(persistedBounds);

  await hostPage.bringToFront();
  await hostPage.goto(`${hostUrl}#/mini-app`);
  await openButton(hostPage).click();
  const reopenedPage = await waitForCoinPage(app);
  await expect.poll(async () => (await coinWindowSnapshot(app)).bounds).toMatchObject(persistedBounds);
  await expect.poll(() => reopenedPage.evaluate(() => document.documentElement.lang)).toBe('en');

  const reopenedWindow = await coinWindowSnapshot(app);
  expect(reopenedWindow.count).toBe(1);
  expect(reopenedWindow.id).not.toBe(firstWindow.id);
  await app.evaluate(({ BrowserWindow }, id) => {
    const target = BrowserWindow.getAllWindows().find((window) => window.id === id);
    if (!target) throw new Error('Coin window is unavailable before repeat Open');
    const probe = globalThis as typeof globalThis & { __coinFocusCalls?: number[] };
    probe.__coinFocusCalls = [];
    const originalFocus = target.focus.bind(target);
    target.focus = () => {
      probe.__coinFocusCalls?.push(target.id);
      originalFocus();
    };
  }, reopenedWindow.id);

  await hostPage.bringToFront();
  await openButton(hostPage).click();
  await expect.poll(async () => {
    const snapshot = await coinWindowSnapshot(app);
    return { count: snapshot.count, id: snapshot.id };
  }).toEqual({ count: 1, id: reopenedWindow.id });
  await expect.poll(async () =>
    await app.evaluate((_electron, id) => {
      const probe = globalThis as typeof globalThis & { __coinFocusCalls?: number[] };
      return probe.__coinFocusCalls?.filter((windowId) => windowId === id).length || 0;
    }, reopenedWindow.id),
  ).toBeGreaterThan(0);

  await hostPage.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      xpcRenderer: { send(channel: string, params?: unknown): Promise<unknown> };
    }).xpcRenderer;
    await api.send('AuthHandler/invalidateSession', {
      status: 401,
      reason: 'E2E auth invalidation',
      source: 'coin-e2e',
    });
  });
  await expect.poll(async () => (await coinWindowSnapshot(app)).count).toBe(0);
  await expect.poll(() => reopenedPage.isClosed()).toBe(true);

  expect(bitterless.rendererErrors).toEqual([]);
  expect(bitterless.unexpectedMockRequests).toEqual([]);
});
