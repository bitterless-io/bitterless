import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../../maestro/fixtures/bitterlessApp.fixture';

const projectRoot = resolve(__dirname, '..', '..', '..');
const screenshotRoot = join(projectRoot, 'out', 'playwright', 'coin', 'screenshots');
const CA_A = `0x${'c'.repeat(40)}`;
const CA_B = `0x${'d'.repeat(40)}`;
const CA_C = `0x${'e'.repeat(40)}`;
const CA_D = `0x${'f'.repeat(40)}`;
const INDEX_WALLET = `0x${'1'.repeat(40)}`;

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

const makeAnalysis = (analysisId: string, contractAddress: string, generatedAt: string) => ({
  schema: 'bl-trench-ca-analysis-v1',
  analysisId,
  contractAddress,
  generatedAt,
  source: {
    kind: 'agent',
    agent: 'trench-omni-e2e',
    skill: 'bitterless-trench',
    providers: ['fixture-provider']
  },
  chains: [
    {
      chain: 'bsc',
      token: { name: 'Omni Fixture', symbol: analysisId === 'omni-analysis-a' ? 'OMNA' : 'OMNB' },
      topProfitWallets: [
        {
          address: INDEX_WALLET,
          rank: 1,
          profitUsd: 418.25,
          winRate: 0.72,
          evidence: { source: 'fixture' }
        }
      ],
      result: { host: 'omni', analysisId }
    }
  ]
});

const sendHomeXpc = async (page: Page, method: string, params?: unknown): Promise<unknown> =>
  await page.evaluate(
    async ({ handleName, handleParams }) =>
      await (
        window as unknown as {
          xpcRenderer: { send: (name: string, value?: unknown) => Promise<unknown> };
        }
      ).xpcRenderer.send(handleName, handleParams),
    {
      handleName: method,
      handleParams: params
    }
  );

const trenchLeaf = (id: string, url: string) => ({
  id,
  type: 'leaf',
  url,
  contentMode: 'miniapp',
  miniAppId: 'trench'
});

interface NativeTrenchView {
  id: number;
  url: string;
  bounds: { x: number; y: number; width: number; height: number };
  preferences: Record<string, unknown> | null;
}

const nativeTrenchViews = async (app: ElectronApplication): Promise<NativeTrenchView[]> =>
  await app.evaluate((electron) => {
    const omni = electron.BaseWindow.getAllWindows().find((window) =>
      window.contentView.children.some((view) => {
        const content = view as unknown as { webContents?: Electron.WebContents };
        return (
          content.webContents &&
          /\/omni\/omniWindow\/index\.html(?:$|[?#])/.test(content.webContents.getURL())
        );
      })
    );
    if (!omni) return [];
    return omni.contentView.children
      .flatMap((view) => {
        const content = view as unknown as {
          webContents?: Electron.WebContents & {
            getLastWebPreferences?: () => Record<string, unknown>;
          };
          getBounds: () => Electron.Rectangle;
        };
        if (
          !content.webContents ||
          !/\/coin\/index\.html(?:$|[?#])/.test(content.webContents.getURL())
        )
          return [];
        return [
          {
            id: content.webContents.id,
            url: content.webContents.getURL(),
            bounds: content.getBounds(),
            preferences: content.webContents.getLastWebPreferences?.() ?? null
          }
        ];
      })
      .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
  });

const executeInTrenchView = async <T>(
  app: ElectronApplication,
  id: number,
  expression: string
): Promise<T> =>
  await app.evaluate(
    async (electron, payload) => {
      const contents = electron.webContents.fromId(payload.id);
      if (!contents || contents.isDestroyed()) {
        throw new Error(`Trench WebContents ${payload.id} is unavailable`);
      }
      return (await contents.executeJavaScript(payload.expression, true)) as T;
    },
    { id, expression }
  );

const waitForNativeTrenchViews = async (
  app: ElectronApplication,
  count: number
): Promise<NativeTrenchView[]> => {
  await expect.poll(async () => (await nativeTrenchViews(app)).length).toBe(count);
  const views = await nativeTrenchViews(app);
  for (const view of views) {
    await expect
      .poll(
        async () =>
          await executeInTrenchView(
            app,
            view.id,
            `(() => ({
      host: window.trenchHost && window.trenchHost.host,
      app: Boolean(document.querySelector('[name="trench__app"]'))
    }))()`
          )
      )
      .toEqual({ host: 'omni', app: true });
  }
  return views;
};

const clickInTrenchView = async (
  app: ElectronApplication,
  id: number,
  selector: string
): Promise<void> => {
  const clicked = await executeInTrenchView<boolean>(
    app,
    id,
    `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!(target instanceof HTMLElement)) return false;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    target.click();
    return true;
  })()`
  );
  expect(clicked).toBe(true);
};

const rowCount = async (app: ElectronApplication, id: number): Promise<number> =>
  await executeInTrenchView(
    app,
    id,
    `document.querySelectorAll('[name="trench__records__row"]').length`
  );

const waitForRowCount = async (
  app: ElectronApplication,
  ids: number[],
  count: number
): Promise<void> => {
  for (const id of ids) {
    await expect.poll(async () => await rowCount(app, id)).toBe(count);
  }
};

const captureTrenchView = async (
  app: ElectronApplication,
  id: number,
  filename: string
): Promise<void> => {
  const png = await app.evaluate(async (electron, webContentsId) => {
    const contents = electron.webContents.fromId(webContentsId);
    if (!contents || contents.isDestroyed()) throw new Error('Trench WebContents is unavailable');
    return (await contents.capturePage()).toPNG().toString('base64');
  }, id);
  writeFileSync(join(screenshotRoot, filename), Buffer.from(png, 'base64'));
};

const nativeStandaloneTrenchViews = async (
  app: ElectronApplication
): Promise<
  Array<{
    id: number;
    url: string;
  }>
> =>
  await app.evaluate((electron) =>
    electron.BrowserWindow.getAllWindows()
      .filter((window) => /\/coin\/index\.html(?:$|[?#])/.test(window.webContents.getURL()))
      .map((window) => ({ id: window.webContents.id, url: window.webContents.getURL() }))
  );

const waitForStandaloneTrenchView = async (
  app: ElectronApplication
): Promise<{
  id: number;
  url: string;
}> => {
  await expect
    .poll(async () => (await nativeStandaloneTrenchViews(app)).length, { timeout: 30_000 })
    .toBe(1);
  const [view] = await nativeStandaloneTrenchViews(app);
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          view.id,
          `({
    host: window.trenchHost && window.trenchHost.host,
    app: Boolean(document.querySelector('[name="trench__app"]'))
  })`
        ),
      { timeout: 30_000 }
    )
    .toEqual({ host: 'standalone', app: true });
  return view;
};

const setOmniContentSize = async (
  app: ElectronApplication,
  width: number,
  height: number
): Promise<void> => {
  await app.evaluate(
    (electron, size) => {
      const omni = electron.BaseWindow.getAllWindows().find((window) =>
        window.contentView.children.some((view) => {
          const content = view as unknown as { webContents?: Electron.WebContents };
          return (
            content.webContents &&
            /\/omni\/omniWindow\/index\.html(?:$|[?#])/.test(content.webContents.getURL())
          );
        })
      );
      if (!omni) throw new Error('Omni BaseWindow is unavailable');
      omni.setContentSize(size.width, size.height);
    },
    { width, height }
  );
};

const expectViewport = async (
  app: ElectronApplication,
  id: number,
  width: number,
  height: number
): Promise<void> => {
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          id,
          `({
    width: window.innerWidth,
    height: window.innerHeight
  })`
        )
    )
    .toEqual({ width, height });
  const layout = await executeInTrenchView<{
    root: { width: number; height: number } | null;
    viewport: { width: number; height: number };
    overflowX: number;
    overflowY: number;
    moduleVisible: boolean;
  }>(
    app,
    id,
    `(() => {
    const root = document.querySelector('[name="trench__app"]');
    return {
      root: root ? { width: root.offsetWidth, height: root.offsetHeight } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      moduleVisible: Boolean(document.querySelector('[name="trench__module__ca"]')?.getClientRects().length),
    };
  })()`
  );
  expect(layout.root).toEqual(layout.viewport);
  expect(layout.overflowX).toBeLessThanOrEqual(1);
  expect(layout.overflowY).toBeLessThanOrEqual(1);
  expect(layout.moduleVisible).toBe(true);
};

const expectAgentGuideReachable = async (
  app: ElectronApplication,
  id: number,
  screenshotName: string
): Promise<void> => {
  const before = await executeInTrenchView<{
    triggerVisible: boolean;
    triggerInsideViewport: boolean;
    triggerFocusable: boolean;
    rowCount: number;
  }>(app, id, `(() => {
    const trigger = document.querySelector('[name="trench__header__agent-guide"]');
    if (trigger instanceof HTMLElement) trigger.focus();
    const rect = trigger?.getBoundingClientRect();
    return {
      triggerVisible: Boolean(trigger?.getClientRects().length),
      triggerInsideViewport: Boolean(rect && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0),
      triggerFocusable: trigger instanceof HTMLElement && trigger.tabIndex >= 0 && document.activeElement === trigger,
      rowCount: document.querySelectorAll('[name="trench__records__row"]').length,
    };
  })()`);
  expect(before.triggerVisible).toBe(true);
  expect(before.triggerInsideViewport).toBe(true);
  expect(before.triggerFocusable).toBe(true);
  await clickInTrenchView(app, id, '[name="trench__header__agent-guide"]');

  await expect.poll(async () => await executeInTrenchView(app, id, `(() => ({
    ready: Boolean(document.querySelector('[name="trench__agent-guide__copy-complete"]')),
    warning: document.querySelector('[name="trench__agent-guide__test-warning"]')?.textContent || '',
  }))()`)).toMatchObject({
    ready: true,
    warning: expect.stringMatching(/bitterless-/),
  });
  await expect.poll(async () => await executeInTrenchView(app, id, `(() => {
    const modal = document.querySelector('.trench-agent-guide-modal');
    return modal ? getComputedStyle(modal).opacity : '';
  })()`)).toBe('1');
  await expect.poll(async () => await executeInTrenchView(app, id,
    `document.querySelector('.trench-agent-guide-modal .arco-modal-close-btn')?.tabIndex ?? -2`
  )).toBe(0);

  const layout = await executeInTrenchView<{
    closeVisible: boolean;
    closeFocusable: boolean;
    bodyScrollable: boolean;
    copyCount: number;
    actionReachable: boolean[];
    actionFocusable: boolean[];
    restartReachable: boolean;
    overflowX: number;
    overflowY: number;
    rowCount: number;
  }>(app, id, `(() => {
    const body = document.querySelector('.trench-agent-guide-modal .arco-modal-body');
    const close = document.querySelector('.trench-agent-guide-modal .arco-modal-close-btn');
    const actions = ['complete', 'helper', 'config', 'skill']
      .map((kind) => document.querySelector('[name="trench__agent-guide__copy-' + kind + '"]'))
      .filter((action) => action instanceof Element);
    const actionFocusable = [];
    const actionReachable = actions.map((action) => {
      action.scrollIntoView({ block: 'nearest' });
      if (action instanceof HTMLElement) action.focus();
      const rect = action.getBoundingClientRect();
      actionFocusable.push(
        action instanceof HTMLElement && action.tabIndex >= 0 && document.activeElement === action
      );
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    if (close instanceof HTMLElement) close.focus();
    const closeFocusable = close instanceof HTMLElement
      && close.tabIndex >= 0
      && document.activeElement === close;
    const restart = document.querySelector('[name="trench__agent-guide__restart"]');
    restart?.scrollIntoView({ block: 'start' });
    const restartRect = restart?.getBoundingClientRect();
    return {
      closeVisible: Boolean(close?.getClientRects().length),
      closeFocusable,
      bodyScrollable: body instanceof HTMLElement && body.scrollHeight > body.clientHeight,
      copyCount: actions.length,
      actionReachable,
      actionFocusable,
      restartReachable: Boolean(restartRect && restartRect.top >= 0 && restartRect.top < window.innerHeight),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      rowCount: document.querySelectorAll('[name="trench__records__row"]').length,
    };
  })()`);
  expect(layout.closeVisible).toBe(true);
  expect(layout.closeFocusable).toBe(true);
  expect(layout.bodyScrollable).toBe(true);
  expect(layout.copyCount).toBe(4);
  expect(layout.actionReachable).toEqual([true, true, true, true]);
  expect(layout.actionFocusable).toEqual([true, true, true, true]);
  expect(layout.restartReachable).toBe(true);
  expect(layout.overflowX).toBeLessThanOrEqual(1);
  expect(layout.overflowY).toBeLessThanOrEqual(1);
  expect(layout.rowCount).toBe(before.rowCount);
  await captureTrenchView(app, id, screenshotName);
  await clickInTrenchView(app, id, '.trench-agent-guide-modal .arco-modal-close-btn');
  await expect.poll(async () => await executeInTrenchView(app, id,
    `Boolean(document.querySelector('[name="trench__agent-guide"]')?.getClientRects().length)`
  )).toBe(false);
  await expect.poll(async () => await executeInTrenchView(app, id,
    `document.activeElement?.getAttribute('name') ?? null`
  )).toBe('trench__header__agent-guide');
};

const probeNavigationFence = async (
  app: ElectronApplication,
  id: number
): Promise<{
  originalUrl: string;
  finalUrl: string;
  popupIsNull: boolean;
  willNavigateCount: number;
  externalUrls: string[];
  webContentsCountBefore: number;
  webContentsCountAfter: number;
}> =>
  await app.evaluate(async (electron, webContentsId) => {
    const contents = electron.webContents.fromId(webContentsId);
    if (!contents || contents.isDestroyed()) throw new Error('Trench WebContents is unavailable');
    const originalUrl = contents.getURL();
    const externalUrls: string[] = [];
    let willNavigateCount = 0;
    const onWillNavigate = (): void => {
      willNavigateCount += 1;
    };
    const originalOpenExternal = electron.shell.openExternal;
    electron.shell.openExternal = async (url: string): Promise<void> => {
      externalUrls.push(url);
    };
    contents.on('will-navigate', onWillNavigate);
    const webContentsCountBefore = electron.webContents.getAllWebContents().length;
    try {
      const renderer = (await contents.executeJavaScript(
        `(() => {
      const popupIsNull = window.open('https://blocked.invalid/omni-popup', '_blank') === null;
      window.location.assign('https://blocked.invalid/omni-navigation');
      return { popupIsNull };
    })()`,
        true
      )) as { popupIsNull: boolean };
      await new Promise((resolveWait) => setTimeout(resolveWait, 750));
      return {
        originalUrl,
        finalUrl: contents.getURL(),
        popupIsNull: renderer.popupIsNull,
        willNavigateCount,
        externalUrls,
        webContentsCountBefore,
        webContentsCountAfter: electron.webContents.getAllWebContents().length
      };
    } finally {
      contents.removeListener('will-navigate', onWillNavigate);
      electron.shell.openExternal = originalOpenExternal;
    }
  }, id);

test('embeds live sandboxed Trench cells and coordinates standalone updates', async ({
  bitterless
}) => {
  const { app, hostPage, userDataDir, mockOrigin } = bitterless;
  const now = Date.now();
  const preservedBrowserUrl = `${mockOrigin}/ai-crms`;
  await callLocalRpc(userDataDir, 'trench.analysis.put', {
    record: makeAnalysis('omni-analysis-a', CA_A, new Date(now - 2_000).toISOString())
  });

  const initialTree = trenchLeaf('trench-primary', preservedBrowserUrl);
  await sendHomeXpc(hostPage, 'SettingDao/upsert', {
    key: 'omni_layout',
    value: { tree: initialTree }
  });
  await sendHomeXpc(hostPage, 'OmniWindowHandler/openOmniWindow');
  let [primaryView] = await waitForNativeTrenchViews(app, 1);
  await setOmniContentSize(app, 800, 600);
  [primaryView] = await waitForNativeTrenchViews(app, 1);
  await expectViewport(app, primaryView.id, 800, 568);
  await waitForRowCount(app, [primaryView.id], 1);
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          primaryView.id,
          `(() => ({
    analysis: Boolean(document.querySelector('[name="trench__detail__analysis"]')),
    chain: document.querySelector('[name="trench__detail__chain"][data-chain="bsc"]')?.textContent || '',
    result: document.querySelector('[name="trench__detail__analysis-result"]')?.textContent || '',
    copyVisible: Boolean(document.querySelector('[name="trench__detail__copy-analysis"]')?.getClientRects().length),
    rawJsonCount: document.querySelectorAll('[name="trench__detail__json"], [name="trench__detail"] pre').length,
  }))()`
        )
    )
    .toMatchObject({
      analysis: true,
      chain: expect.stringContaining('OMNA'),
      result: expect.stringContaining('omni-analysis-a'),
      copyVisible: true,
      rawJsonCount: 0
    });

  const nativeSnapshot = await app.evaluate((electron) => {
    const omni = electron.BaseWindow.getAllWindows().find((window) =>
      window.contentView.children.some((view) => {
        const content = view as unknown as { webContents?: Electron.WebContents };
        return (
          content.webContents &&
          /\/omni\/omniWindow\/index\.html(?:$|[?#])/.test(content.webContents.getURL())
        );
      })
    );
    if (!omni) throw new Error('Omni BaseWindow is unavailable');
    const targetLabel = process.env.BITTERLESS_E2E_DISPLAY_LABEL ?? null;
    return {
      targetLabel,
      displayLabel: electron.screen.getDisplayMatching(omni.getBounds()).label,
      bounds: omni.getBounds(),
      e2e: process.env.BITTERLESS_E2E ?? null,
      mockKeychain:
        process.platform === 'darwin'
          ? electron.app.commandLine.hasSwitch('use-mock-keychain')
          : null,
      standaloneTrenchWindows: electron.BrowserWindow.getAllWindows().filter((window) =>
        /\/coin\/index\.html(?:$|[?#])/.test(window.webContents.getURL())
      ).length
    };
  });
  if (nativeSnapshot.targetLabel) {
    expect(nativeSnapshot.displayLabel).toBe(nativeSnapshot.targetLabel);
  }
  expect(nativeSnapshot.e2e).toBe('1');
  expect(nativeSnapshot.mockKeychain).toBe(process.platform === 'darwin' ? true : null);
  expect(nativeSnapshot.standaloneTrenchWindows).toBe(0);
  expect(primaryView.preferences).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    allowRunningInsecureContent: false
  });

  const rendererSecurity = await executeInTrenchView<{
    host: { host: string; platform: string };
    requireType: string;
    processType: string;
  }>(
    app,
    primaryView.id,
    `({
    host: window.trenchHost,
    requireType: typeof globalThis.require,
    processType: typeof globalThis.process
  })`
  );
  expect(rendererSecurity).toEqual({
    host: {
      host: 'omni',
      platform:
        process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'other'
    },
    requireType: 'undefined',
    processType: 'undefined'
  });
  const fence = await probeNavigationFence(app, primaryView.id);
  expect(fence.finalUrl).toBe(fence.originalUrl);
  expect(fence.popupIsNull).toBe(true);
  expect(fence.willNavigateCount).toBeGreaterThanOrEqual(1);
  expect(fence.externalUrls).toEqual(
    expect.arrayContaining([
      'https://blocked.invalid/omni-popup',
      'https://blocked.invalid/omni-navigation'
    ])
  );
  expect(fence.webContentsCountAfter).toBe(fence.webContentsCountBefore);

  mkdirSync(screenshotRoot, { recursive: true });
  await expectAgentGuideReachable(
    app,
    primaryView.id,
    'trench-agent-guide-omni-800x568.png'
  );
  await captureTrenchView(app, primaryView.id, 'trench-structured-omni-800x568.png');

  const horizontalTree = {
    id: 'trench-horizontal',
    type: 'split',
    direction: 'h',
    sizes: [50, 50],
    children: [
      trenchLeaf('trench-primary', preservedBrowserUrl),
      trenchLeaf('trench-secondary', preservedBrowserUrl)
    ]
  };
  await sendHomeXpc(hostPage, 'OmniWindowHandler/commitLayout', { tree: horizontalTree });
  const committedHorizontalLayout = await sendHomeXpc(hostPage, 'OmniWindowHandler/loadLayout');
  expect(committedHorizontalLayout).toEqual({ tree: horizontalTree });
  const horizontalViews = await waitForNativeTrenchViews(app, 2);
  for (const view of horizontalViews) await expectViewport(app, view.id, 398, 568);
  const secondaryView = horizontalViews.find((view) => view.id !== primaryView.id);
  expect(secondaryView).toBeTruthy();
  await waitForRowCount(app, [secondaryView!.id], 1);
  await clickInTrenchView(app, secondaryView!.id, '[name="trench__records__row"]');
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          secondaryView!.id,
          `Boolean(document.querySelector('[name="trench__detail__back"]')?.getClientRects().length)`
        )
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          secondaryView!.id,
          `(() => ({
    analysis: Boolean(document.querySelector('[name="trench__detail__analysis"]')),
    rawJsonCount: document.querySelectorAll('[name="trench__detail__json"], [name="trench__detail"] pre').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))()`
        )
    )
    .toEqual({ analysis: true, rawJsonCount: 0, overflowX: 0 });
  await expectAgentGuideReachable(
    app,
    secondaryView!.id,
    'trench-agent-guide-omni-398x568.png'
  );
  await captureTrenchView(app, secondaryView!.id, 'trench-structured-omni-398x568.png');

  await callLocalRpc(userDataDir, 'trench.analysis.put', {
    record: makeAnalysis('omni-analysis-b', CA_B, new Date(now).toISOString())
  });
  await waitForRowCount(
    app,
    horizontalViews.map((view) => view.id),
    2
  );

  const browserTree = {
    ...horizontalTree,
    id: 'trench-browser-roundtrip',
    children: [
      {
        ...trenchLeaf('trench-primary', preservedBrowserUrl),
        contentMode: 'browser'
      },
      trenchLeaf('trench-secondary', preservedBrowserUrl)
    ]
  };
  await sendHomeXpc(hostPage, 'OmniWindowHandler/commitLayout', { tree: browserTree });
  const [secondaryDuringBrowser] = await waitForNativeTrenchViews(app, 1);
  expect(await sendHomeXpc(hostPage, 'OmniWindowHandler/loadLayout')).toEqual({
    tree: browserTree
  });
  await expect
    .poll(
      async () =>
        await app.evaluate(async (electron, expectedUrl) => {
          for (const contents of electron.webContents.getAllWebContents()) {
            if (contents.getURL() !== expectedUrl || contents.isDestroyed()) continue;
            return await contents.executeJavaScript(
              `document.querySelector('#ai-crms-e2e')?.textContent || null`
            );
          }
          return null;
        }, preservedBrowserUrl)
    )
    .toBe('AI-CRMS local E2E mock');
  await expect
    .poll(
      async () =>
        await app.evaluate((electron, id) => {
          const contents = electron.webContents.fromId(id);
          return !contents || contents.isDestroyed();
        }, primaryView.id)
    )
    .toBe(true);

  const remountedTree = {
    ...horizontalTree,
    id: 'trench-remounted'
  };
  await sendHomeXpc(hostPage, 'OmniWindowHandler/commitLayout', { tree: remountedTree });
  const remountedViews = await waitForNativeTrenchViews(app, 2);
  expect(await sendHomeXpc(hostPage, 'OmniWindowHandler/loadLayout')).toEqual({
    tree: remountedTree
  });
  const remountedPrimary = remountedViews.find((view) => view.id !== secondaryDuringBrowser.id);
  expect(remountedPrimary).toBeTruthy();
  expect(remountedPrimary!.id).not.toBe(primaryView.id);
  await waitForRowCount(
    app,
    remountedViews.map((view) => view.id),
    2
  );
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          remountedPrimary!.id,
          `document.querySelector('[name="trench__records__row"][aria-current="true"]')?.textContent || ''`
        )
    )
    .toContain(CA_B);

  const verticalTree = {
    ...remountedTree,
    id: 'trench-vertical',
    direction: 'v'
  };
  await sendHomeXpc(hostPage, 'OmniWindowHandler/commitLayout', { tree: verticalTree });
  const verticalViews = await waitForNativeTrenchViews(app, 2);
  for (const view of verticalViews) await expectViewport(app, view.id, 800, 282);
  const shortView =
    verticalViews.find((view) => view.id === remountedPrimary!.id) ?? verticalViews[0];
  await clickInTrenchView(app, shortView.id, '[name="trench__records__row"]');
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          shortView.id,
          `document.querySelector('[name="trench__detail"]')?.textContent || ''`
        )
    )
    .toContain(CA_B);
  await expectAgentGuideReachable(
    app,
    shortView.id,
    'trench-agent-guide-omni-800x282.png'
  );
  await clickInTrenchView(app, shortView.id, '[name="trench__module__index-wallets"]');
  await waitForRowCount(app, [shortView.id], 1);
  await clickInTrenchView(app, shortView.id, '[name="trench__records__row"]');
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          shortView.id,
          `document.querySelectorAll('[name="trench__detail__index-source-open"]').length`
        )
    )
    .toBeGreaterThan(0);
  await clickInTrenchView(app, shortView.id, '[name="trench__detail__index-source-open"]');
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          shortView.id,
          `Boolean(document.querySelector('[name="trench__detail__back"]')?.getClientRects().length)`
        )
    )
    .toBe(true);
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          shortView.id,
          `(() => ({
    analysis: Boolean(document.querySelector('[name="trench__detail__analysis"]')),
    result: document.querySelector('[name="trench__detail__analysis-result"]')?.textContent || '',
    detailScrollable: (() => {
      const detail = document.querySelector('[name="trench__detail__analysis"]');
      return detail instanceof HTMLElement && detail.scrollHeight >= detail.clientHeight;
    })(),
    rawJsonCount: document.querySelectorAll('[name="trench__detail__json"], [name="trench__detail"] pre').length,
  }))()`
        )
    )
    .toMatchObject({
      analysis: true,
      result: expect.stringContaining('omni-analysis'),
      detailScrollable: true,
      rawJsonCount: 0
    });
  await captureTrenchView(app, shortView.id, 'trench-structured-omni-800x282-source.png');
  await clickInTrenchView(app, shortView.id, '[name="trench__detail__back"]');
  await expect
    .poll(
      async () =>
        await executeInTrenchView(
          app,
          shortView.id,
          `document.querySelectorAll('[name="trench__detail__index-source-open"]').length`
        )
    )
    .toBeGreaterThan(0);
  await captureTrenchView(app, shortView.id, 'trench-structured-omni-800x282.png');
  for (const view of verticalViews) {
    await clickInTrenchView(app, view.id, '[name="trench__module__ca"]');
  }
  await waitForRowCount(
    app,
    verticalViews.map((view) => view.id),
    2
  );

  await hostPage.evaluate(() =>
    localStorage.setItem('bitterless-desktop-token', 'bitterless-e2e-token')
  );
  const hostUrl = hostPage.url().split('#')[0];
  await hostPage.goto(`${hostUrl}#/mini-app`);
  await expect
    .poll(
      async () => await hostPage.locator('#app').evaluate((element) => element.childElementCount)
    )
    .toBeGreaterThan(0);
  await sendHomeXpc(hostPage, 'CoinWindowHandler/openCoinWindow');
  const standaloneView = await waitForStandaloneTrenchView(app);
  await waitForRowCount(app, [standaloneView.id], 2);
  await callLocalRpc(userDataDir, 'trench.analysis.put', {
    record: makeAnalysis('omni-analysis-c', CA_C, new Date(now + 2_000).toISOString())
  });
  await waitForRowCount(
    app,
    verticalViews.map((view) => view.id),
    3
  );
  await waitForRowCount(app, [standaloneView.id], 3);

  const secondaryId = secondaryDuringBrowser.id;
  await sendHomeXpc(hostPage, 'OmniWindowHandler/commitLayout', {
    tree: trenchLeaf('trench-primary', preservedBrowserUrl)
  });
  const [remainingView] = await waitForNativeTrenchViews(app, 1);
  expect(remainingView.id).toBe(remountedPrimary!.id);
  await expect
    .poll(
      async () =>
        await app.evaluate((electron, id) => {
          const contents = electron.webContents.fromId(id);
          return !contents || contents.isDestroyed();
        }, secondaryId)
    )
    .toBe(true);
  await callLocalRpc(userDataDir, 'trench.analysis.put', {
    record: makeAnalysis('omni-analysis-d', CA_D, new Date(now + 4_000).toISOString())
  });
  await waitForRowCount(app, [remainingView.id], 4);
  await waitForRowCount(app, [standaloneView.id], 4);

  expect(bitterless.mainOutput.join('')).not.toContain('safeStorage tripwire');
  expect(bitterless.unexpectedMockRequests).toEqual([]);
  expect(bitterless.deniedNetworkRequests()).toEqual([]);
  expect(bitterless.rendererErrors).toEqual([]);
});
