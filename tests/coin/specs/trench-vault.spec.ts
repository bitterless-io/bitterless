import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../../maestro/fixtures/bitterlessApp.fixture';
import type { McpIntegrationInfo } from '../../../src/shared/mcp/mcpBridge.type';

const projectRoot = resolve(__dirname, '..', '..', '..');
const screenshotRoot = join(projectRoot, 'out', 'playwright', 'coin', 'screenshots');
const coinPagePattern = /\/coin\/index\.html(?:$|[?#])/;
const CA_A = `0x${'a'.repeat(40)}`;
const CA_B = `0x${'b'.repeat(40)}`;
const INDEX_WALLET = `0x${'1'.repeat(40)}`;
const NEGATIVE_WALLET = `0x${'2'.repeat(40)}`;

const bridgePath = (userDataDir: string): string => {
  if (process.platform === 'win32') {
    const suffix = createHash('sha1').update(userDataDir).digest('hex').slice(0, 12);
    return `\\\\.\\pipe\\bitterless-mcp-${suffix}`;
  }
  return join(userDataDir, 'mcp', 'bridge.sock');
};

const callLocalRpc = async <T>(
  userDataDir: string,
  method: string,
  params: unknown
): Promise<T> => {
  const endpoint = bridgePath(userDataDir);
  const deadline = Date.now() + 15_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      return await new Promise<T>((resolveCall, rejectCall) => {
        const socket = createConnection(endpoint);
        let buffer = '';
        const timer = setTimeout(() => {
          socket.destroy();
          rejectCall(new Error(`Timed out waiting for ${method}`));
        }, 5_000);
        socket.setEncoding('utf8');
        socket.once('connect', () => {
          socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`);
        });
        socket.on('data', (chunk) => {
          buffer += chunk;
          const newline = buffer.indexOf('\n');
          if (newline < 0) return;
          clearTimeout(timer);
          socket.end();
          const response = JSON.parse(buffer.slice(0, newline)) as {
            result?: T;
            error?: { message: string };
          };
          if (response.error) rejectCall(new Error(response.error.message));
          else resolveCall(response.result as T);
        });
        socket.once('error', (error) => {
          clearTimeout(timer);
          rejectCall(error);
        });
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 75));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`MCP bridge unavailable for ${method}`);
};

const waitForCoinPage = async (app: ElectronApplication): Promise<Page> => {
  const existing = app.windows().find((page) => coinPagePattern.test(page.url()));
  if (existing) return existing;
  return await app.waitForEvent('window', {
    predicate: (page) => coinPagePattern.test(page.url()),
    timeout: 30_000
  });
};

const setCoinWindowBounds = async (
  app: ElectronApplication,
  bounds: { width: number; height: number }
): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, nextBounds) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      /\/coin\/index\.html(?:$|[?#])/.test(candidate.webContents.getURL())
    );
    if (!window) throw new Error('Trench window is unavailable');
    window.setBounds({ ...window.getBounds(), ...nextBounds });
  }, bounds);
};

const windowSnapshot = async (app: ElectronApplication) =>
  await app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter((window) =>
      /\/coin\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
    );
    return {
      count: windows.length,
      bounds: windows[0]?.getBounds() ?? null,
      minSize: windows[0]?.getMinimumSize() ?? null,
      childViews: windows[0]?.contentView.children.length ?? 0
    };
  });

const expectBoundedLayout = async (page: Page): Promise<void> => {
  const layout = await page.evaluate(() => {
    const root = document.querySelector('[name="trench__app"]')?.getBoundingClientRect();
    const list = document.querySelector('[name="trench__records"]')?.getBoundingClientRect();
    const detail = document.querySelector('[name="trench__detail"]')?.getBoundingClientRect();
    return {
      rootOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rootOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      root: root ? { width: root.width, height: root.height } : null,
      list: list ? { left: list.left, right: list.right, width: list.width } : null,
      detail: detail ? { left: detail.left, right: detail.right, width: detail.width } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });
  expect(layout.rootOverflowX).toBeLessThanOrEqual(1);
  expect(layout.rootOverflowY).toBeLessThanOrEqual(1);
  expect(layout.root).toEqual(layout.viewport);
  expect(layout.list?.left).toBeGreaterThanOrEqual(0);
  expect(layout.detail?.right).toBeLessThanOrEqual(layout.viewport.width + 1);
  expect((layout.list?.width ?? 0) + (layout.detail?.width ?? 0)).toBeLessThanOrEqual(
    layout.viewport.width + 1
  );
};

const makeAnalysis = (params: {
  analysisId: string;
  contractAddress: string;
  generatedAt: string;
  includeEvidenceWallets?: boolean;
  largeEvidence?: boolean;
}) => ({
  schema: 'bl-trench-ca-analysis-v1',
  analysisId: params.analysisId,
  contractAddress: params.contractAddress,
  generatedAt: params.generatedAt,
  source: {
    kind: 'agent',
    agent: 'trench-e2e',
    skill: 'bitterless-trench',
    providers: ['fixture-provider']
  },
  chains: [
    {
      chain: 'bsc',
      token: { name: 'Forensic Fixture', symbol: params.contractAddress === CA_A ? 'EVA' : 'EVB' },
      topProfitWallets: params.includeEvidenceWallets
        ? [
            {
              address: INDEX_WALLET,
              rank: 1,
              profitUsd: 418.25,
              winRate: 0.72,
              evidence: { source: 'fixture' }
            }
          ]
        : [],
      ...(params.includeEvidenceWallets
        ? {
            indexWalletExposure: [
              { address: INDEX_WALLET, holding: true, balance: '12.5', valueUsd: 88 }
            ],
            negativeWalletExposure: [{ address: NEGATIVE_WALLET, holding: null }]
          }
        : {}),
      result: {
        verdict: 'external-evidence-only',
        nested: { exact: true },
        ...(params.largeEvidence
          ? {
              evidenceBlocks: [
                `one:${'e'.repeat(50 * 1024)}`,
                `two:${'v'.repeat(50 * 1024)}`,
                `three:${'a'.repeat(50 * 1024)}`
              ]
            }
          : {})
      }
    },
    {
      chain: 'robinhood',
      token: { name: 'Forensic Fixture', symbol: params.contractAddress === CA_A ? 'EVA' : 'EVB' },
      topProfitWallets: [],
      result: { verdict: 'recorded', chain: 'robinhood' }
    }
  ]
});

test('renders the secure read-only Trench vault with exact live local evidence', async ({
  bitterless
}) => {
  const { app, hostPage, userDataDir } = bitterless;
  const now = Date.now();
  const negativePut = await callLocalRpc<{ tagDocument: string }>(
    userDataDir,
    'trench.negative_wallet.put',
    {
      requestId: 'e2e-negative-tag',
      chain: 'bsc',
      address: NEGATIVE_WALLET,
      explanation: 'Human supplied wallet warning.\nSecond line remains intact.'
    }
  );
  const holdingsPut = await callLocalRpc<{ document: string }>(
    userDataDir,
    'trench.negative_wallet_holdings.put',
    {
      record: {
        schema: 'bl-trench-negative-wallet-holdings-v1',
        analysisId: 'e2e-negative-holdings',
        chain: 'bsc',
        address: NEGATIVE_WALLET,
        generatedAt: new Date(now - 10_000).toISOString(),
        holdings: [{ contractAddress: CA_A, symbol: 'EVA', balance: '4.25', valueUsd: 21.5 }],
        result: { source: 'external-agent' }
      }
    }
  );
  const analysisPut = await callLocalRpc<{ document: string }>(userDataDir, 'trench.analysis.put', {
    record: makeAnalysis({
      analysisId: 'e2e-analysis-a',
      contractAddress: CA_A,
      generatedAt: new Date(now - 5_000).toISOString(),
      includeEvidenceWallets: true
    })
  });
  const analysesDirectory = join(userDataDir, 'trench', 'analyses');
  const invalidAnalysisPath = join(analysesDirectory, 'invalid-e2e.json');
  const parkedInvalidAnalysisPath = join(userDataDir, 'trench', 'invalid-e2e.json.parked');
  mkdirSync(analysesDirectory, { recursive: true });
  writeFileSync(invalidAnalysisPath, '{"schema":"broken"}\n', { mode: 0o600 });

  await expect
    .poll(
      async () => await hostPage.locator('#app').evaluate((element) => element.childElementCount)
    )
    .toBeGreaterThan(0);
  await hostPage.evaluate(() =>
    localStorage.setItem('bitterless-desktop-token', 'bitterless-e2e-token')
  );
  const hostUrl = hostPage.url().split('#')[0];
  await hostPage.goto(`${hostUrl}#/mini-app`);
  const openButton = hostPage
    .locator('[data-mini-app-id="coin"]')
    .getByRole('button', { name: /Open|打开/ });
  await openButton.click();
  const trenchPage = await waitForCoinPage(app);
  await trenchPage.waitForLoadState('domcontentloaded');
  await expect
    .poll(() =>
      bitterless.mainOutput
        .join('')
        .includes('[todoist sync] using injected isolated runtime password')
    )
    .toBe(true);
  const credentialRuntime = await app.evaluate(({ app: electronApp }) => ({
    e2e: process.env.BITTERLESS_E2E ?? null,
    packaged: electronApp.isPackaged,
    mockKeychain:
      process.platform === 'darwin' ? electronApp.commandLine.hasSwitch('use-mock-keychain') : null
  }));
  expect(credentialRuntime).toEqual({
    e2e: '1',
    packaged: false,
    mockKeychain: process.platform === 'darwin' ? true : null
  });
  const credentialDiagnostics = bitterless.mainOutput
    .join('')
    .split(/\r?\n/)
    .filter((line) => /sqlitePassword|coach sqlite|todoist sync|safeStorage tripwire/i.test(line));
  console.log('[trench-e2e credential diagnostics]', credentialRuntime, credentialDiagnostics);
  expect(credentialDiagnostics).toContainEqual(
    expect.stringContaining('[todoist sync] using injected isolated runtime password')
  );
  expect(credentialDiagnostics.some((line) => line.includes('safeStorage tripwire'))).toBe(false);
  const todoistStatus = await hostPage.evaluate(
    async () =>
      await (
        window as unknown as {
          xpcRenderer: { send: (handleName: string, params?: unknown) => Promise<unknown> };
        }
      ).xpcRenderer.send('TodoistSyncStatusHandler/getStatus')
  );
  console.log('[trench-e2e Todoist status]', todoistStatus);
  expect(todoistStatus).toMatchObject({ active: true });
  await expect
    .poll(() => bitterless.mockRequests.filter((request) => request === 'POST /todo/sync').length)
    .toBeGreaterThan(0);
  const todoistDatabase = join(userDataDir, 'db', 'todoist-sync-v1', 'customer-9001.db');
  const todoistProtectedKey = join(userDataDir, 'db', 'todoist-sync-v1', 'customer-9001.key.bin');
  await expect.poll(() => existsSync(todoistDatabase)).toBe(true);
  expect(existsSync(todoistProtectedKey)).toBe(false);
  expect(
    bitterless.rendererErrors.some((error) =>
      error.includes('[AuthStore] Failed to activate Todo sync')
    )
  ).toBe(false);
  const bootstrapDiagnostic = await trenchPage.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bootstrap: document.documentElement.dataset.trenchBootstrap ?? null,
    rootText: document.querySelector('#app')?.textContent ?? null,
    scriptSources: [...document.scripts].map((script) => script.src || '[inline]')
  }));
  if (!(await trenchPage.locator('[name="trench__app"]').count())) {
    throw new Error(
      `Trench renderer did not mount: ${JSON.stringify({
        bootstrapDiagnostic,
        rendererErrors: bitterless.rendererErrors
      })}`
    );
  }
  await expect(trenchPage.locator('[name="trench__app"]')).toBeVisible();
  await expect(trenchPage.locator('[name="trench__records__row"]')).toHaveCount(1);
  await expect(trenchPage.locator('[name="trench__records__issue"]')).toHaveCount(1);

  const security = await trenchPage.evaluate(() => ({
    requireType: typeof (globalThis as { require?: unknown }).require,
    processType: typeof (globalThis as { process?: unknown }).process,
    coinType: typeof (window as unknown as { coin?: unknown }).coin,
    host: window.trenchHost,
    hostKeys: Object.keys(window.trenchHost).sort(),
    hostFunctionCount: Object.values(window.trenchHost).filter(
      (value) => typeof value === 'function'
    ).length,
    xpcType: typeof (window as unknown as { xpcRenderer?: unknown }).xpcRenderer,
    embeddedContent: document.querySelectorAll('iframe, webview').length
  }));
  expect(security).toEqual({
    requireType: 'undefined',
    processType: 'undefined',
    coinType: 'undefined',
    host: {
      host: 'standalone',
      platform:
        process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'other'
    },
    hostKeys: ['host', 'platform'],
    hostFunctionCount: 0,
    xpcType: 'object',
    embeddedContent: 0
  });
  await expect(trenchPage.getByRole('button', { name: /analy[sz]e/i })).toHaveCount(0);
  await expect(
    trenchPage.locator('textarea, [name*="command" i], [name*="decision" i], [name*="signal" i]')
  ).toHaveCount(0);

  const snapshot = await windowSnapshot(app);
  expect(snapshot.count).toBe(1);
  expect(snapshot.bounds).toMatchObject({ width: 1360, height: 860 });
  expect(snapshot.minSize).toEqual([800, 600]);
  expect(snapshot.childViews).toBe(0);
  await expectBoundedLayout(trenchPage);
  const caDetail = trenchPage.locator('[name="trench__detail__analysis"]');
  await expect(caDetail).toBeVisible();
  await expect(caDetail.locator('[name="trench__detail__chain"]')).toHaveCount(2);
  await expect(caDetail.locator('[name="trench__detail__chain"][data-chain="bsc"]')).toContainText(
    'EVA'
  );
  const bscDetail = caDetail.locator('[name="trench__detail__chain"][data-chain="bsc"]');
  await expect(caDetail.locator('[name="trench__detail__analysis-result"]').first()).toContainText(
    'external-evidence-only'
  );
  await expect(caDetail.locator('[name="trench__detail__top-wallet"]')).toContainText(INDEX_WALLET);
  await expect(bscDetail.locator('[name="trench__detail__index-exposure"]')).toContainText('12.5');
  await expect(bscDetail.locator('[name="trench__detail__negative-exposure"]')).toContainText(
    NEGATIVE_WALLET
  );
  await expect(
    trenchPage.locator('[name="trench__detail__json"], [name="trench__detail"] pre')
  ).toHaveCount(0);
  await trenchPage.locator('[name="trench__detail__copy-analysis"]').click();
  await expect(trenchPage.locator('[name="trench__detail__copy-status-analysis"]')).toHaveText(
    /Copied|已复制/
  );
  await expect
    .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(analysisPut.document);

  const search = trenchPage.locator('[name="trench__records__search"]');
  await search.fill('nothing-can-match');
  await expect(trenchPage.locator('[name="trench__records__no-match"]')).toBeVisible();
  await search.fill('');
  await expect(trenchPage.locator('[name="trench__records__row"]')).toHaveCount(1);

  await trenchPage.locator('[name="trench__module__index-wallets"]').click();
  await expect(trenchPage.locator('[name="trench__records__row"]')).toHaveCount(1);
  await expect(trenchPage.locator('[name="trench__detail__index-source"]')).toHaveCount(1);
  await trenchPage.locator('[name="trench__detail__index-source-open"]').click();
  await expect(trenchPage.locator('[name="trench__detail__back"]')).toBeVisible();
  await expect(trenchPage.locator('[name="trench__detail__analysis"]')).toContainText(
    'external-evidence-only'
  );
  await expect(trenchPage.locator('[name="trench__detail__json"]')).toHaveCount(0);
  await trenchPage.locator('[name="trench__detail__back"]').click();
  await expect(trenchPage.locator('[name="trench__detail__index-source"]')).toHaveCount(1);

  await trenchPage.locator('[name="trench__module__negative-wallets"]').click();
  await expect(trenchPage.locator('[name="trench__detail__negative-explanation"]')).toContainText(
    'Second line remains intact.'
  );
  await expect(trenchPage.locator('[name="trench__detail__holdings-empty"]')).toHaveCount(0);
  await expect(trenchPage.locator('[name="trench__detail__negative-tag"]')).toContainText(
    'e2e-negative-tag'
  );
  await expect(trenchPage.locator('[name="trench__detail__holding"]')).toContainText('EVA');
  await expect(trenchPage.locator('[name="trench__detail__holding"]')).toContainText('4.25');
  await expect(trenchPage.locator('[name="trench__detail__holdings-result"]')).toContainText(
    'external-agent'
  );
  await expect(
    trenchPage.locator('[name="trench__detail__json"], [name="trench__detail"] pre')
  ).toHaveCount(0);
  await trenchPage.locator('[name="trench__detail__copy-tag"]').click();
  await expect(trenchPage.locator('[name="trench__detail__copy-status-tag"]')).toHaveText(
    /Copied|已复制/
  );
  await expect
    .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(negativePut.tagDocument);
  await trenchPage.locator('[name="trench__detail__copy-holdings"]').click();
  await expect(trenchPage.locator('[name="trench__detail__copy-status-holdings"]')).toHaveText(
    /Copied|已复制/
  );
  await expect
    .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(holdingsPut.document);

  await trenchPage.locator('[name="trench__module__ca"]').click();
  await expect(
    trenchPage.locator('[name="trench__records__row"][aria-current="true"]')
  ).toContainText(CA_A);
  renameSync(invalidAnalysisPath, parkedInvalidAnalysisPath);
  let analysisPutB: { document: string };
  try {
    analysisPutB = await callLocalRpc<{ document: string }>(userDataDir, 'trench.analysis.put', {
      record: makeAnalysis({
        analysisId: 'e2e-analysis-b',
        contractAddress: CA_B,
        generatedAt: new Date(now).toISOString(),
        includeEvidenceWallets: true,
        largeEvidence: true
      })
    });
  } finally {
    renameSync(parkedInvalidAnalysisPath, invalidAnalysisPath);
  }
  await expect(trenchPage.locator('[name="trench__records__row"]')).toHaveCount(2);
  await expect(
    trenchPage.locator('[name="trench__records__row"][aria-current="true"]')
  ).toContainText(CA_A);
  await expect(trenchPage.locator('[name="trench__detail__analysis"]')).toContainText(
    'external-evidence-only'
  );

  const caBRow = trenchPage.locator('[name="trench__records__row"]').filter({ hasText: CA_B });
  await caBRow.click();
  const largeDetail = trenchPage.locator('[name="trench__detail__analysis"]');
  await expect(trenchPage.locator('[name="trench__detail"]')).toContainText('e2e-analysis-b');
  expect(analysisPutB.document.length).toBeGreaterThan(128 * 1024);
  const evidenceBlocks = largeDetail.locator(
    '[name="trench__detail__structured-value"][data-path="chains.bsc.result.evidenceBlocks"]'
  );
  await evidenceBlocks.locator('summary').click();
  await expect(evidenceBlocks.getByRole('button', { name: /Show full text|展开全文/ })).toHaveCount(
    3
  );
  expect((await largeDetail.textContent())?.length ?? Number.MAX_SAFE_INTEGER).toBeLessThan(12_000);
  await trenchPage.locator('[name="trench__detail__copy-analysis"]').click();
  await expect
    .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(analysisPutB.document);

  await trenchPage.locator('[name="trench__module__index-wallets"]').click();
  await expect(trenchPage.locator('[name="trench__detail__index-source"]')).toHaveCount(2);
  const caBSource = trenchPage
    .locator('[name="trench__detail__index-source"]')
    .filter({ hasText: CA_B });
  const caBSourceButton = caBSource.locator('[name="trench__detail__index-source-open"]');
  const caBSourceIdentity = await caBSourceButton.getAttribute('data-source-identity');
  expect(caBSourceIdentity).toBeTruthy();
  await caBSourceButton.click();
  await expect(trenchPage.locator('[name="trench__detail"]')).toContainText('e2e-analysis-b');
  await expect(trenchPage.locator('[name="trench__detail__analysis"]')).toContainText('EVB');
  await expect(trenchPage.locator('[name="trench__detail__json"]')).toHaveCount(0);
  await trenchPage.locator('[name="trench__detail__back"]').click();
  await expect
    .poll(
      async () =>
        await trenchPage.evaluate(
          () => document.activeElement?.getAttribute('data-source-identity') ?? null
        )
    )
    .toBe(caBSourceIdentity);

  mkdirSync(screenshotRoot, { recursive: true });
  await trenchPage.locator('[name="trench__module__ca"]').click();
  await trenchPage.locator('[name="trench__records__row"]').filter({ hasText: CA_B }).click();
  await expect(trenchPage.locator('[name="trench__detail__analysis"]')).toContainText('EVB');
  await trenchPage.screenshot({ path: join(screenshotRoot, 'trench-structured-1360x860.png') });

  const guideInfo = await trenchPage.evaluate(
    async () => await (
      window as unknown as {
        xpcRenderer: { send: (handleName: string) => Promise<unknown> };
      }
    ).xpcRenderer.send('McpHandler/getTrenchIntegrationInfo')
  ) as McpIntegrationInfo;
  expect(guideInfo.serverName).toMatch(/^bitterless-/);
  expect(guideInfo.serverName).not.toBe('bitterless');
  expect(guideInfo.skillVersionCode).toMatch(/^\d{12}$/);
  const rowsBeforeGuide = await trenchPage.locator('[name="trench__records__row"]').count();
  await expect(trenchPage.locator('[name="trench__header__agent-guide"]')).toBeVisible();
  await trenchPage.locator('[name="trench__header__agent-guide"]').click();
  const guide = trenchPage.locator('[name="trench__agent-guide"]');
  await expect(guide).toBeVisible();
  await expect(trenchPage.locator('.trench-agent-guide-modal')).toHaveCSS('opacity', '1');
  await expect(guide.locator('[name="trench__agent-guide__test-warning"]')).toContainText(
    guideInfo.serverName
  );
  await expect(guide.locator('[name="trench__agent-guide__helper"]')).toContainText(
    guideInfo.commandPath
  );
  await expect(guide.locator('[name="trench__agent-guide__config"]')).toContainText(
    guideInfo.configJson
  );
  await expect(guide.locator('[name="trench__agent-guide__skill"]')).toContainText(
    guideInfo.skillPath
  );
  await expect(guide.locator('[name="trench__agent-guide__restart"]')).toContainText(
    '13 trench.*'
  );
  for (const [kind, expectedText] of [
    ['complete', guideInfo.instruction],
    ['helper', guideInfo.commandPath],
    ['config', guideInfo.configJson],
    ['skill', guideInfo.skillPath]
  ] as const) {
    await guide.locator(`[name="trench__agent-guide__copy-${kind}"]`).click();
    await expect
      .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(expectedText);
    await expect(
      guide.locator(`[name="trench__agent-guide__copy-status-${kind}"]`)
    ).toHaveText(/Copied|已复制/);
  }
  await trenchPage.screenshot({ path: join(screenshotRoot, 'trench-agent-guide-1360x860.png') });
  expect((await windowSnapshot(app)).count).toBe(1);
  expect((await windowSnapshot(app)).childViews).toBe(0);
  await trenchPage.locator('.trench-agent-guide-modal .arco-modal-close-btn').click();
  await expect(guide).toHaveCount(0);
  await expect(trenchPage.locator('[name="trench__records__row"]')).toHaveCount(rowsBeforeGuide);

  await setCoinWindowBounds(app, { width: 800, height: 600 });
  await expect.poll(async () => await trenchPage.evaluate(() => window.innerWidth)).toBe(800);
  await expectBoundedLayout(trenchPage);
  await trenchPage.locator('[name="trench__module__negative-wallets"]').click();
  await expect(trenchPage.locator('[name="trench__detail__holding"]')).toContainText('EVA');
  await trenchPage.screenshot({ path: join(screenshotRoot, 'trench-structured-800x600.png') });
  await trenchPage.locator('[name="trench__header__agent-guide"]').click();
  await expect(guide).toBeVisible();
  await expect(trenchPage.locator('.trench-agent-guide-modal')).toHaveCSS('opacity', '1');
  await expect(guide.locator('[name="trench__agent-guide__restart"]')).toBeVisible();
  await expectBoundedLayout(trenchPage);
  await trenchPage.screenshot({ path: join(screenshotRoot, 'trench-agent-guide-800x600.png') });
  await trenchPage.locator('.trench-agent-guide-modal .arco-modal-close-btn').click();

  await hostPage.bringToFront();
  await openButton.click();
  await openButton.click();
  expect((await windowSnapshot(app)).count).toBe(1);
  const closePromise = trenchPage.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      /\/coin\/index\.html(?:$|[?#])/.test(candidate.webContents.getURL())
    );
    window?.close();
  });
  await closePromise;
  await openButton.click();
  const reopened = await waitForCoinPage(app);
  await expect(reopened.locator('[name="trench__app"]')).toBeVisible();
  expect((await windowSnapshot(app)).bounds).toMatchObject({ width: 800, height: 600 });

  expect(bitterless.unexpectedMockRequests).toEqual([]);
  expect(bitterless.deniedNetworkRequests()).toEqual([]);
  expect(bitterless.mainOutput.join('')).not.toContain('safeStorage tripwire');
  expect(bitterless.rendererErrors).toEqual([]);
});
