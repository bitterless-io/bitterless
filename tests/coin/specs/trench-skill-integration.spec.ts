import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '../../maestro/fixtures/bitterlessApp.fixture';
import { getMcpBridgeEndpoint } from '../../../src/shared/mcp/mcpBridge.shared';
import type {
  TrenchCaAnalysisV1,
  TrenchNegativeWalletDetail,
  TrenchNegativeWalletHoldingsV1
} from '../../../src/shared/trench/trench.type';

const projectRoot = resolve(__dirname, '..', '..', '..');
const helperPath = join(projectRoot, 'out', 'main', 'mcpHelper.js');
const appMainPath = join(projectRoot, 'out', 'main', 'app.main.js');
const coinRendererPath = join(projectRoot, 'out', 'renderer', 'coin', 'index.html');
const CA = `0x${'7'.repeat(40)}`;
const INDEX_WALLET = `0x${'8'.repeat(40)}`;
const NEGATIVE_WALLET = `0x${'9'.repeat(40)}`;
const NEGATIVE_EXPLANATION = [
  'Owner-authorized synthetic E2E classification.',
  'No provider or real-wallet claim.'
].join('\n');
const TRENCH_TOOL_NAMES = [
  'trench.analysis.put',
  'trench.analysis.list',
  'trench.analysis.get',
  'trench.analysis.archive',
  'trench.index_wallet.list',
  'trench.index_wallet.get',
  'trench.negative_wallet.put',
  'trench.negative_wallet.list',
  'trench.negative_wallet.get',
  'trench.negative_wallet_holdings.put',
  'trench.negative_wallet_holdings.get',
  'trench.negative_wallet.archive',
  'trench.person.import'
] as const;

interface McpResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code?: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface HelperExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

const wait = async (milliseconds: number): Promise<void> =>
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const helperEnvironment = (userDataDir: string): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  const allowedKeys = new Set([
    'PATH',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT'
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value != null && (allowedKeys.has(key) || key.startsWith('LC_'))) {
      environment[key] = value;
    }
  }
  const isolatedHome = join(dirname(userDataDir), 'home');
  return {
    ...environment,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    APPDATA: join(isolatedHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(isolatedHome, 'AppData', 'Local'),
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production'
  };
};

class BuiltMcpClient {
  readonly child: ChildProcessWithoutNullStreams;
  readonly environment: NodeJS.ProcessEnv;
  stderr = '';
  private stdoutBuffer = '';
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private exitStatus: HelperExit | null = null;

  constructor(params: { executablePath: string; bridgePath: string; userDataDir: string }) {
    this.environment = helperEnvironment(params.userDataDir);
    this.child = spawn(
      params.executablePath,
      [helperPath, '--mcp-bridge-path', params.bridgePath],
      {
        cwd: projectRoot,
        env: this.environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    );
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.once('error', (error) => this.rejectAll(error));
    this.child.once('exit', (code, signal) => {
      this.exitStatus = { code, signal };
      if (this.pending.size) {
        this.rejectAll(
          new Error(`MCP helper exited before responding: ${String(code)}/${String(signal)}`)
        );
      }
    });
  }

  async initialize(): Promise<{ serverInfo: { name: string; version: string } }> {
    const initialized = await this.request<{ serverInfo: { name: string; version: string } }>(
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'trench-skill-integration-e2e', version: '0.1.0' }
      }
    );
    this.notify('notifications/initialized', {});
    return initialized;
  }

  async listTools(): Promise<{
    tools: Array<{ name: string; inputSchema: Record<string, unknown> }>;
  }> {
    return await this.request('tools/list', {});
  }

  async callTool<T>(name: string, argumentsValue: unknown): Promise<T> {
    const result = await this.request<{ structuredContent: T }>('tools/call', {
      name,
      arguments: argumentsValue
    });
    return result.structuredContent;
  }

  async close(): Promise<HelperExit> {
    if (!this.child.stdin.destroyed) this.child.stdin.end();
    let status = await this.waitForExit(1_500);
    if (!status) {
      this.child.kill('SIGTERM');
      status = await this.waitForExit(1_000);
    }
    if (!status) {
      this.child.kill('SIGKILL');
      status = await this.waitForExit(1_000);
      throw new Error(`MCP helper required SIGKILL: ${JSON.stringify(status)}`);
    }
    if (status.code !== 0 || status.signal !== null) {
      throw new Error(`MCP helper exited abnormally: ${JSON.stringify(status)}`);
    }
    return status;
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    return await new Promise<T>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for ${method}`));
      }, 15_000);
      this.pending.set(id, {
        resolve: (value) => resolveRequest(value as T),
        reject: rejectRequest,
        timer
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private notify(method: string, params: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > 8 * 1024 * 1024) {
      this.rejectAll(new Error('MCP helper stdout exceeded the one-message byte limit'));
      return;
    }
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        let response: McpResponse;
        try {
          response = JSON.parse(line) as McpResponse;
        } catch (error) {
          this.rejectAll(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (response.id !== undefined) {
          const pending = this.pending.get(response.id);
          if (!pending) {
            this.rejectAll(new Error(`Unexpected MCP response id: ${response.id}`));
            return;
          }
          this.pending.delete(response.id);
          clearTimeout(pending.timer);
          if (response.error) {
            pending.reject(Object.assign(new Error(response.error.message), response.error));
          } else {
            pending.resolve(response.result);
          }
        }
      }
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async waitForExit(timeoutMs: number): Promise<HelperExit | null> {
    if (this.exitStatus) return this.exitStatus;
    return await Promise.race([
      new Promise<HelperExit>((resolveExit) => {
        this.child.once('exit', (code, signal) => resolveExit({ code, signal }));
      }),
      wait(timeoutMs).then(() => null)
    ]);
  }
}

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

interface HostSnapshot {
  host: 'standalone' | 'omni';
  id: number;
  timeOrigin: number;
  rowCount: number;
}

const executeInHost = async <T>(
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

const trenchHosts = async (app: ElectronApplication): Promise<HostSnapshot[]> =>
  await app.evaluate(async (electron) => {
    const standalone = electron.BrowserWindow.getAllWindows()
      .map((window) => window.webContents)
      .find((contents) => /\/coin\/index\.html(?:$|[?#])/.test(contents.getURL()));
    const omniWindow = electron.BaseWindow.getAllWindows().find((window) =>
      window.contentView.children.some((view) => {
        const content = view as unknown as { webContents?: Electron.WebContents };
        return (
          content.webContents &&
          /\/omni\/omniWindow\/index\.html(?:$|[?#])/.test(content.webContents.getURL())
        );
      })
    );
    const omni = omniWindow?.contentView.children.flatMap((view) => {
      const content = view as unknown as { webContents?: Electron.WebContents };
      return content.webContents &&
        /\/coin\/index\.html(?:$|[?#])/.test(content.webContents.getURL())
        ? [content.webContents]
        : [];
    })[0];
    const candidates = [standalone, omni].filter((contents): contents is Electron.WebContents =>
      Boolean(contents && !contents.isDestroyed())
    );
    return await Promise.all(
      candidates.map(
        async (contents) =>
          (await contents.executeJavaScript(
            `({
      host: window.trenchHost.host,
      id: ${contents.id},
      timeOrigin: performance.timeOrigin,
      rowCount: document.querySelectorAll('[name="trench__records__row"]').length
    })`,
            true
          )) as HostSnapshot
      )
    );
  });

const waitForTrenchHosts = async (app: ElectronApplication): Promise<HostSnapshot[]> => {
  await expect
    .poll(async () => (await trenchHosts(app)).map((host) => host.host).sort())
    .toEqual(['omni', 'standalone']);
  return await trenchHosts(app);
};

const waitForRows = async (
  app: ElectronApplication,
  hosts: HostSnapshot[],
  count: number
): Promise<void> => {
  for (const host of hosts) {
    await expect
      .poll(
        async () =>
          await executeInHost<number>(
            app,
            host.id,
            `document.querySelectorAll('[name="trench__records__row"]').length`
          )
      )
      .toBe(count);
  }
};

const clickModule = async (
  app: ElectronApplication,
  host: HostSnapshot,
  name: string
): Promise<void> => {
  const clicked = await executeInHost<boolean>(
    app,
    host.id,
    `(() => {
    const target = document.querySelector('[name=${JSON.stringify(name)}]');
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  })()`
  );
  expect(clicked).toBe(true);
};

const assertExactFile = (path: string, document: string, expectedHash: string): void => {
  const bytes = readFileSync(path);
  const expectedBytes = Buffer.from(document, 'utf8');
  expect(bytes.equals(expectedBytes)).toBe(true);
  expect(bytes.byteLength).toBe(Buffer.byteLength(document, 'utf8'));
  expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(expectedHash);
};

const addressKey = (address: string): string =>
  createHash('sha256').update(address.toLowerCase(), 'utf8').digest('hex');

const assertFreshBuild = (): void => {
  const helperSourcePaths = [
    'src/main/mcp/mcpHelper.main.ts',
    'src/main/mcp/mcpStdio.helper.ts',
    'src/shared/mcp/mcpBridge.shared.ts',
    'src/shared/trench/trenchMcp.schema.ts'
  ];
  const appSourcePaths = [
    'src/main/app.main.ts',
    'src/main/mcp/mcpBridge.server.ts',
    'src/main/trench/trench.runtime.ts',
    'src/main/trench/trenchRepository.service.ts',
    'src/shared/trench/trench.validation.ts'
  ];
  const rendererSourcePaths = [
    'src/renderer/coin/src/components/TrenchRecordDetail/TrenchRecordDetail.vue',
    'src/renderer/coin/src/components/TrenchAnalysisDetail/TrenchAnalysisDetail.vue',
    'src/renderer/coin/src/components/TrenchDocumentAction/TrenchDocumentAction.vue',
    'src/renderer/coin/src/components/TrenchIndexWalletDetail/TrenchIndexWalletDetail.vue',
    'src/renderer/coin/src/components/TrenchNegativeWalletDetail/TrenchNegativeWalletDetail.vue',
    'src/renderer/coin/src/components/TrenchStructuredValue/TrenchStructuredValue.vue'
  ];
  const newest = (paths: string[]): number =>
    Math.max(...paths.map((path) => statSync(join(projectRoot, path)).mtimeMs));
  expect(existsSync(helperPath)).toBe(true);
  expect(existsSync(appMainPath)).toBe(true);
  expect(existsSync(coinRendererPath)).toBe(true);
  expect(statSync(helperPath).mtimeMs).toBeGreaterThanOrEqual(newest(helperSourcePaths));
  expect(statSync(appMainPath).mtimeMs).toBeGreaterThanOrEqual(newest(appSourcePaths));
  expect(statSync(coinRendererPath).mtimeMs).toBeGreaterThanOrEqual(newest(rendererSourcePaths));
  const helperSource = readFileSync(helperPath, 'utf8');
  const chunkRelativePath = helperSource.match(
    /require\("(\.\/chunks\/mcpStdio\.helper-[^"]+\.js)"\)/
  )?.[1];
  expect(chunkRelativePath).toBeTruthy();
  const helperChunk = resolve(dirname(helperPath), chunkRelativePath!);
  expect(existsSync(helperChunk)).toBe(true);
  expect(statSync(helperChunk).mtimeMs).toBeGreaterThanOrEqual(newest(helperSourcePaths));
};

test('built MCP helper persists exact synthetic evidence into already-open Trench hosts', async ({
  bitterless
}) => {
  const { app, hostPage, mockOrigin, userDataDir } = bitterless;
  assertFreshBuild();

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
  await hostPage
    .locator('[data-mini-app-id="coin"]')
    .getByRole('button', { name: /Open|打开/ })
    .click();
  await expect
    .poll(async () => (await trenchHosts(app)).some((host) => host.host === 'standalone'), {
      timeout: 30_000
    })
    .toBe(true);

  const omniTree = {
    id: 'trench-skill-integration',
    type: 'leaf',
    url: `${mockOrigin}/ai-crms`,
    contentMode: 'miniapp',
    miniAppId: 'trench'
  };
  await sendHomeXpc(hostPage, 'SettingDao/upsert', {
    key: 'omni_layout',
    value: { tree: omniTree }
  });
  await sendHomeXpc(hostPage, 'OmniWindowHandler/openOmniWindow');
  const openedHosts = await waitForTrenchHosts(app);
  await waitForRows(app, openedHosts, 0);
  const originalRuntime = new Map(
    openedHosts.map((host) => [
      host.host,
      {
        id: host.id,
        timeOrigin: host.timeOrigin
      }
    ])
  );

  const placement = await app.evaluate((electron) => {
    const targetLabel = process.env.BITTERLESS_E2E_DISPLAY_LABEL ?? null;
    const windows = electron.BaseWindow.getAllWindows()
      .filter((window) => window.isVisible())
      .map((window) => ({
        label: electron.screen.getDisplayMatching(window.getBounds()).label
      }));
    return {
      targetLabel,
      windows,
      mockKeychain:
        process.platform === 'darwin'
          ? electron.app.commandLine.hasSwitch('use-mock-keychain')
          : null
    };
  });
  if (placement.targetLabel) {
    expect(placement.windows.length).toBeGreaterThanOrEqual(3);
    expect(placement.windows.every((window) => window.label === placement.targetLabel)).toBe(true);
  }
  expect(placement.mockKeychain).toBe(process.platform === 'darwin' ? true : null);

  const sentinelKey = 'BITTERLESS_TRENCH_E2E_PARENT_SECRET';
  const sentinel = 'must-not-reach-built-helper';
  const previousSentinel = process.env[sentinelKey];
  process.env[sentinelKey] = sentinel;
  const bridgePath = getMcpBridgeEndpoint(userDataDir).path;
  const client = (() => {
    try {
      const executablePath = app.process().spawnfile;
      if (!executablePath) throw new Error('Electron executable path is unavailable');
      const builtClient = new BuiltMcpClient({
        executablePath,
        bridgePath,
        userDataDir
      });
      return builtClient;
    } finally {
      if (previousSentinel === undefined) delete process.env[sentinelKey];
      else process.env[sentinelKey] = previousSentinel;
    }
  })();

  try {
    expect(client.environment[sentinelKey]).toBeUndefined();
    const initialized = await client.initialize();
    expect(initialized.serverInfo).toEqual({ name: 'bitterless', version: '0.2.0' });
    const listed = await client.listTools();
    const trenchTools = listed.tools.filter((tool) => tool.name.startsWith('trench.'));
    expect(trenchTools.map((tool) => tool.name)).toEqual(TRENCH_TOOL_NAMES);
    for (const tool of trenchTools) {
      expect(tool.inputSchema).toMatchObject({ additionalProperties: false });
    }

    const now = Date.now();
    const analysisRecord: TrenchCaAnalysisV1 = {
      schema: 'bl-trench-ca-analysis-v1',
      analysisId: 'trench-skill-integration-analysis',
      contractAddress: CA,
      generatedAt: new Date(now - 20_000).toISOString(),
      source: {
        kind: 'agent',
        agent: 'trench-skill-integration-e2e',
        skill: 'bitterless-trench',
        providers: []
      },
      chains: [
        {
          chain: 'bsc',
          token: { name: 'Synthetic Integration Token', symbol: 'SIT' },
          topProfitWallets: [
            {
              address: INDEX_WALLET,
              rank: 1,
              profitUsd: 12.5,
              winRate: 0.5,
              evidence: { source: 'synthetic-fixture' }
            }
          ],
          result: { status: 'synthetic', providerAccess: 'not-used' }
        }
      ]
    };
    type AnalysisResult = {
      record: TrenchCaAnalysisV1;
      document: string;
      contentHash: string;
      changed?: boolean;
    };
    const analysisPut = await client.callTool<AnalysisResult>('trench.analysis.put', {
      record: analysisRecord
    });
    const analysisGet = await client.callTool<AnalysisResult>('trench.analysis.get', {
      contractAddress: CA
    });
    expect(analysisPut.changed).toBe(true);
    expect(analysisGet.record).toEqual(analysisPut.record);
    expect(analysisGet.contentHash).toBe(analysisPut.contentHash);
    expect(analysisGet.document).toBe(analysisPut.document);
    assertExactFile(
      join(userDataDir, 'trench', 'analyses', `${addressKey(CA)}.json`),
      analysisGet.document,
      analysisGet.contentHash
    );
    await waitForRows(app, openedHosts, 1);
    for (const host of openedHosts) {
      await expect
        .poll(
          async () =>
            await executeInHost(
              app,
              host.id,
              `(() => ({
        analysis: Boolean(document.querySelector('[name="trench__detail__analysis"]')),
        chain: document.querySelector('[name="trench__detail__chain"][data-chain="bsc"]')?.textContent || '',
        result: document.querySelector('[name="trench__detail__analysis-result"]')?.textContent || '',
        topWallet: document.querySelector('[name="trench__detail__top-wallet"]')?.textContent || '',
        rawJsonCount: document.querySelectorAll('[name="trench__detail__json"], [name="trench__detail"] pre').length
      }))()`
            )
        )
        .toMatchObject({
          analysis: true,
          chain: expect.stringContaining('SIT'),
          result: expect.stringContaining('synthetic'),
          topWallet: expect.stringContaining(INDEX_WALLET.toLowerCase()),
          rawJsonCount: 0
        });
    }
    await executeInHost(
      app,
      openedHosts[0].id,
      `document.querySelector('[name="trench__detail__copy-analysis"]')?.click()`
    );
    await expect
      .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(analysisGet.document);

    type NegativeResult = TrenchNegativeWalletDetail & { changed?: boolean };
    const negativePut = await client.callTool<NegativeResult>('trench.negative_wallet.put', {
      requestId: 'trench-skill-integration-negative',
      chain: 'bsc',
      address: NEGATIVE_WALLET,
      explanation: NEGATIVE_EXPLANATION
    });
    const negativeBeforeHoldings = await client.callTool<NegativeResult>(
      'trench.negative_wallet.get',
      { chain: 'bsc', address: NEGATIVE_WALLET }
    );
    expect(negativePut.changed).toBe(true);
    expect(negativeBeforeHoldings.tag).toMatchObject({
      tagId: 'trench-skill-integration-negative',
      chain: 'bsc',
      address: NEGATIVE_WALLET.toLowerCase(),
      explanation: NEGATIVE_EXPLANATION
    });
    expect(negativeBeforeHoldings.tagContentHash).toBe(negativePut.tagContentHash);
    expect(negativeBeforeHoldings.tagDocument).toBe(negativePut.tagDocument);
    assertExactFile(
      join(
        userDataDir,
        'trench',
        'negative-wallets',
        'bsc',
        addressKey(NEGATIVE_WALLET),
        'tag.json'
      ),
      negativeBeforeHoldings.tagDocument,
      negativeBeforeHoldings.tagContentHash
    );

    const holdingsRecord: TrenchNegativeWalletHoldingsV1 = {
      schema: 'bl-trench-negative-wallet-holdings-v1',
      analysisId: 'trench-skill-integration-holdings',
      chain: 'bsc',
      address: NEGATIVE_WALLET,
      generatedAt: new Date(now - 10_000).toISOString(),
      holdings: [
        {
          contractAddress: CA,
          symbol: 'SIT',
          balance: '2.5',
          valueUsd: 25,
          evidence: { source: 'synthetic-fixture' }
        }
      ],
      result: { status: 'synthetic', providerAccess: 'not-used' }
    };
    type HoldingsResult = {
      record: TrenchNegativeWalletHoldingsV1;
      document: string;
      contentHash: string;
      compositeContentHash?: string;
      changed?: boolean;
    };
    const holdingsPut = await client.callTool<HoldingsResult>(
      'trench.negative_wallet_holdings.put',
      { record: holdingsRecord }
    );
    const holdingsGet = await client.callTool<HoldingsResult>(
      'trench.negative_wallet_holdings.get',
      { chain: 'bsc', address: NEGATIVE_WALLET }
    );
    const negativeGet = await client.callTool<NegativeResult>('trench.negative_wallet.get', {
      chain: 'bsc',
      address: NEGATIVE_WALLET
    });
    expect(holdingsPut.changed).toBe(true);
    expect(holdingsGet.record).toEqual(holdingsPut.record);
    expect(holdingsGet.contentHash).toBe(holdingsPut.contentHash);
    expect(holdingsGet.document).toBe(holdingsPut.document);
    expect(negativeGet.tag).toEqual(negativeBeforeHoldings.tag);
    expect(negativeGet.tagContentHash).toBe(negativeBeforeHoldings.tagContentHash);
    expect(negativeGet.holdingsContentHash).toBe(holdingsGet.contentHash);
    expect(negativeGet.holdingsDocument).toBe(holdingsGet.document);
    const compositeContentHash = `sha256:${createHash('sha256')
      .update(
        `tag=${negativeGet.tagContentHash}\nholdings=${negativeGet.holdingsContentHash}\n`,
        'utf8'
      )
      .digest('hex')}`;
    expect(holdingsPut.compositeContentHash).toBe(compositeContentHash);
    expect(negativeGet.contentHash).toBe(compositeContentHash);
    assertExactFile(
      join(
        userDataDir,
        'trench',
        'negative-wallets',
        'bsc',
        addressKey(NEGATIVE_WALLET),
        'holdings.json'
      ),
      holdingsGet.document,
      holdingsGet.contentHash
    );

    for (const host of openedHosts) {
      await clickModule(app, host, 'trench__module__negative-wallets');
    }
    await waitForRows(app, openedHosts, 1);
    for (const host of openedHosts) {
      await expect
        .poll(
          async () =>
            await executeInHost(
              app,
              host.id,
              `(() => ({
        explanation: document.querySelector('[name="trench__detail__negative-explanation"] p')?.textContent || '',
        tag: document.querySelector('[name="trench__detail__negative-tag"]')?.textContent || '',
        holding: document.querySelector('[name="trench__detail__holding"]')?.textContent || '',
        result: document.querySelector('[name="trench__detail__holdings-result"]')?.textContent || '',
        rawJsonCount: document.querySelectorAll('[name="trench__detail__json"], [name="trench__detail"] pre').length
      }))()`
            )
        )
        .toMatchObject({
          explanation: NEGATIVE_EXPLANATION,
          tag: expect.stringContaining('trench-skill-integration-negative'),
          holding: expect.stringContaining('SIT'),
          result: expect.stringContaining('synthetic'),
          rawJsonCount: 0
        });
    }
    await executeInHost(
      app,
      openedHosts[0].id,
      `document.querySelector('[name="trench__detail__copy-tag"]')?.click()`
    );
    await expect
      .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(negativeGet.tagDocument);
    await executeInHost(
      app,
      openedHosts[0].id,
      `document.querySelector('[name="trench__detail__copy-holdings"]')?.click()`
    );
    await expect
      .poll(async () => await app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(negativeGet.holdingsDocument);

    const finalHosts = await waitForTrenchHosts(app);
    for (const host of finalHosts) {
      expect({ id: host.id, timeOrigin: host.timeOrigin }).toEqual(originalRuntime.get(host.host));
    }
    expect(bitterless.mainOutput.join('')).not.toContain('safeStorage tripwire');
    expect(bitterless.deniedNetworkRequests()).toEqual([]);
    expect(bitterless.unexpectedMockRequests).toEqual([]);
    expect(bitterless.rendererErrors).toEqual([]);
  } finally {
    await client.close();
  }
  expect(client.stderr).not.toContain(sentinel);
  expect(client.stderr.trim()).toBe(`[bitterless-mcp] stdio server started (${bridgePath})`);
});
