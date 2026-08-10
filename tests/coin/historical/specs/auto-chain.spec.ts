import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../../maestro/fixtures/bitterlessApp.fixture';
import {
  GMGN_CLI_FIXTURE_ADDRESSES,
  type GmgnCliFixtureCall,
} from '../fixtures/gmgnCli.fixture';

const projectRoot = resolve(__dirname, '..', '..', '..');
const screenshotRoot = join(projectRoot, 'out', 'playwright', 'coin', 'screenshots');

test.use({ coinGmgnFixture: true });

const setCoinWindowBounds = async (
  app: ElectronApplication,
  width: number,
  height: number,
): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, bounds) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      /\/coin\/index\.html(?:$|[?#])/.test(candidate.webContents.getURL()),
    );
    if (!window) throw new Error('Coin window is unavailable.');
    window.setBounds({ ...window.getBounds(), ...bounds });
  }, { width, height });
};

const coinWindowSize = async (app: ElectronApplication): Promise<[number, number]> =>
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      /\/coin\/index\.html(?:$|[?#])/.test(candidate.webContents.getURL()),
    );
    if (!window) throw new Error('Coin window is unavailable.');
    const bounds = window.getBounds();
    return [bounds.width, bounds.height];
  });

const flagValue = (call: GmgnCliFixtureCall, flag: string): string => {
  const index = call.args.indexOf(flag);
  return index >= 0 ? call.args[index + 1] ?? '' : '';
};

const readCalls = (calls: GmgnCliFixtureCall[]): GmgnCliFixtureCall[] =>
  calls.filter(({ args }) => args[0] === 'token' || args[0] === 'market');

const assertSingleChainFlow = async (options: {
  app: ElectronApplication;
  page: Page;
  callsBefore: number;
  getCalls: () => GmgnCliFixtureCall[];
  address: string;
  expectedProbeChains: string[];
  expectedChain: string;
  expectedChainLabel: string;
  expectedName: string;
}): Promise<void> => {
  const {
    app,
    page,
    callsBefore,
    getCalls,
    address,
    expectedProbeChains,
    expectedChain,
    expectedChainLabel,
    expectedName,
  } = options;
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), address);
  const paste = page.locator('[name="trench__commandBar__pasteAnalyze"]');
  await paste.click();

  const input = page.locator('[name="trench__commandBar__contract"] input');
  const detection = page.locator('[name="trench__commandBar__detection"]');
  const asset = page.locator('[name="coin__meme__asset"]');
  await expect(input).toHaveValue(address);
  await expect(detection).toContainText(expectedChainLabel, { timeout: 30_000 });
  await expect(asset).toContainText(expectedName, { timeout: 30_000 });
  await expect(asset).toContainText(address);
  await expect(asset.locator('.coin-section-kicker')).toHaveText(
    expectedChain === 'sol' ? 'SOLANA' : expectedChain.toUpperCase(),
  );
  await expect(paste).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('[name="trench__commandBar__error"]')).toHaveCount(0);

  const calls = readCalls(getCalls().slice(callsBefore));
  const identityCalls = calls.filter(({ args }) => args[0] === 'token' && args[1] === 'info');
  expect(identityCalls.map((call) => flagValue(call, '--chain'))).toEqual(expectedProbeChains);
  const holderCalls = calls.filter(({ args }) => args[0] === 'token' && args[1] === 'holders');
  expect(holderCalls.map((call) => flagValue(call, '--chain'))).toEqual([expectedChain]);
  const analysisCalls = calls.filter(({ args }) => !(args[0] === 'token' && args[1] === 'info'));
  expect(analysisCalls.length).toBeGreaterThan(0);
  expect(analysisCalls.every((call) => flagValue(call, '--chain') === expectedChain)).toBe(true);
};

test('pastes one CA and resolves Solana, BSC, Robinhood, and an EVM dual match', async ({
  bitterless,
}) => {
  const {
    app,
    hostPage,
    rendererErrors,
    unexpectedMockRequests,
    gmgnCliCalls,
    userDataDir,
  } = bitterless;
  await expect.poll(async () =>
    await hostPage.locator('#app').evaluate((element) => element.childElementCount),
  ).toBeGreaterThan(0);
  await hostPage.evaluate(() => {
    localStorage.setItem('bitterless-desktop-token', 'bitterless-e2e-token');
  });
  const hostUrl = hostPage.url().split('#')[0];
  await hostPage.goto(`${hostUrl}#/mini-app`);
  await expect.poll(() =>
    bitterless.mockRequests.filter((request) => request === 'GET /auth/me').length,
  ).toBeGreaterThan(0);
  await expect.poll(() => app.windows().some((page) =>
    /\/sqlite\/index\.html(?:$|[?#])/.test(page.url()),
  )).toBe(true);
  await hostPage.waitForTimeout(500);
  await hostPage
    .locator('[data-mini-app-id="coin"]')
    .getByRole('button', { name: /Open|打开/ })
    .click();

  const coinPage = await bitterless.waitForRenderer('coin');
  await coinPage.bringToFront();
  await expect(coinPage.locator('[name="trench__workspace"]')).toBeVisible();
  const chainSelector = coinPage.locator('[name="trench__commandBar__chain"]');
  const addressInput = coinPage.locator('[name="trench__commandBar__contract"] input');

  mkdirSync(screenshotRoot, { recursive: true });
  await expect.poll(() => coinWindowSize(app)).toEqual([1360, 860]);
  await expect(chainSelector).toHaveCount(0);
  await expect(addressInput).toBeVisible();
  await coinPage.screenshot({
    path: join(screenshotRoot, 'trench-auto-chain-1360x860.png'),
    animations: 'disabled',
  });

  await setCoinWindowBounds(app, 800, 600);
  await expect.poll(() => coinWindowSize(app)).toEqual([800, 600]);
  await expect(chainSelector).toHaveCount(0);
  await expect(addressInput).toBeVisible();
  await coinPage.screenshot({
    path: join(screenshotRoot, 'trench-auto-chain-800x600.png'),
    animations: 'disabled',
  });
  await setCoinWindowBounds(app, 1360, 860);
  await expect.poll(() => coinWindowSize(app)).toEqual([1360, 860]);

  const previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    let callsBefore = gmgnCliCalls().length;
    await assertSingleChainFlow({
      app,
      page: coinPage,
      callsBefore,
      getCalls: gmgnCliCalls,
      address: GMGN_CLI_FIXTURE_ADDRESSES.solana,
      expectedProbeChains: ['sol'],
      expectedChain: 'sol',
      expectedChainLabel: 'Solana',
      expectedName: 'Solana Fixture',
    });

    callsBefore = gmgnCliCalls().length;
    await assertSingleChainFlow({
      app,
      page: coinPage,
      callsBefore,
      getCalls: gmgnCliCalls,
      address: GMGN_CLI_FIXTURE_ADDRESSES.bsc,
      expectedProbeChains: ['bsc', 'robinhood'],
      expectedChain: 'bsc',
      expectedChainLabel: 'BSC',
      expectedName: 'BSC Fixture',
    });

    callsBefore = gmgnCliCalls().length;
    await assertSingleChainFlow({
      app,
      page: coinPage,
      callsBefore,
      getCalls: gmgnCliCalls,
      address: GMGN_CLI_FIXTURE_ADDRESSES.robinhood,
      expectedProbeChains: ['bsc', 'robinhood'],
      expectedChain: 'robinhood',
      expectedChainLabel: 'Robinhood',
      expectedName: 'Robinhood Fixture',
    });

    callsBefore = gmgnCliCalls().length;
    await app.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      GMGN_CLI_FIXTURE_ADDRESSES.dual,
    );
    const paste = coinPage.locator('[name="trench__commandBar__pasteAnalyze"]');
    await paste.click();
    const detection = coinPage.locator('[name="trench__commandBar__detection"]');
    await expect(detection).toContainText('BSC', { timeout: 30_000 });
    await expect(detection).toContainText('Robinhood');
    const asset = coinPage.locator('[name="coin__meme__asset"]');
    await expect(asset).toContainText(GMGN_CLI_FIXTURE_ADDRESSES.dual, { timeout: 30_000 });
    await expect(asset.locator('.coin-section-kicker')).toHaveText('BSC');
    await expect(paste).toBeEnabled({ timeout: 30_000 });
    const dualCalls = readCalls(gmgnCliCalls().slice(callsBefore));
    expect(dualCalls
      .filter(({ args }) => args[0] === 'token' && args[1] === 'info')
      .map((call) => flagValue(call, '--chain'))).toEqual(['bsc', 'robinhood']);
    expect(dualCalls
      .filter(({ args }) => args[0] === 'token' && args[1] === 'holders')
      .map((call) => flagValue(call, '--chain'))).toEqual(['bsc', 'robinhood']);

    await coinPage.locator('[name="trench__commandBar__history"]').click();
    const dualHistoryRows = coinPage.locator('[name="coin__history__row"]', {
      hasText: GMGN_CLI_FIXTURE_ADDRESSES.dual,
    });
    await expect(dualHistoryRows).toHaveCount(2);
    await expect(dualHistoryRows.filter({ hasText: 'bsc' })).toHaveCount(1);
    await expect(dualHistoryRows.filter({ hasText: 'robinhood' })).toHaveCount(1);
    const statePath = join(userDataDir, 'coin', 'coin-state.json');
    await expect.poll(() => {
      try {
        const snapshot = JSON.parse(readFileSync(statePath, 'utf8')) as {
          data?: { analyses?: Array<{ asset?: string; chain?: string }> };
        };
        return snapshot.data?.analyses
          ?.filter(({ asset }) => asset === GMGN_CLI_FIXTURE_ADDRESSES.dual)
          .map(({ chain }) => chain)
          .sort() ?? [];
      } catch {
        return [];
      }
    }).toEqual(['bsc', 'robinhood']);
  } finally {
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), previousClipboard);
  }

  const coinRendererErrors = rendererErrors.filter((error) => error.includes('/renderer/coin/'));
  const unrelatedRendererErrors = rendererErrors.filter((error) => !error.includes('/renderer/coin/'));
  if (unrelatedRendererErrors.length > 0) {
    await test.info().attach('unrelated-renderer-errors', {
      body: Buffer.from(unrelatedRendererErrors.join('\n\n'), 'utf8'),
      contentType: 'text/plain',
    });
  }
  expect(coinRendererErrors).toEqual([]);
  expect(unexpectedMockRequests).toEqual([]);
});
