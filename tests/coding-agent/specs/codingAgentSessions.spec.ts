import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, type CodingAgentE2ESession } from '../fixtures/codingAgentApp.fixture';

interface CodingAgentSessionRecord {
  id: string;
  provider: 'codex' | 'claude';
  surface: string;
  externalSessionId: string;
  runtimeJobId: string | null;
  title: string | null;
  cwd: string | null;
  state: string;
  lastTurnState: string;
  providerState: string | null;
  statusSource: string;
  statusObservedAt: number | null;
  isProcessAlive: boolean | null;
}

interface CodingAgentIntegrationStatus {
  provider: 'codex' | 'claude';
  configuration: string;
  bridgeListening: boolean;
  lastEventAt: number | null;
}

interface RefreshResult {
  providers: Array<'codex' | 'claude'>;
  discoveredCount: number;
  importedCount: number;
  issues: Array<{ provider: string; code: string; message: string }>;
}

interface HookHandler {
  type: string;
  command: string;
  args?: string[];
  timeout?: number;
}

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

const TOKEN = 'bitterless-coding-agent-e2e-token';
const CODEX_SESSION_ID = '10000000-0000-4000-8000-000000000001';
const CLAUDE_LIVE_SESSION_ID = '20000000-0000-4000-8000-000000000002';
const CLAUDE_BACKGROUND_SESSION_ID = '30000000-0000-4000-8000-000000000003';
const HOOK_SESSION_ID = '40000000-0000-4000-8000-000000000004';
const DOWNTIME_SESSION_ID = '50000000-0000-4000-8000-000000000005';
const PRIVACY_SENTINEL = 'E2E_PRIVATE_PROMPT_TRANSCRIPT_TOOL_OUTPUT_SENTINEL';

const hostBaseUrl = (page: Page): string => page.url().split('#')[0];

const openCodingAgents = async (
  bitterless: CodingAgentE2ESession,
  options: { verifyUnauthenticatedRedirect?: boolean } = {}
): Promise<Page> => {
  const page = bitterless.hostPage;
  await expect
    .poll(async () => await page.locator('#app').evaluate((element) => element.childElementCount))
    .toBeGreaterThan(0);
  const baseUrl = hostBaseUrl(page);
  if (options.verifyUnauthenticatedRedirect) {
    await page.goto(`${baseUrl}#/coding-agents`);
    await expect(page).toHaveURL(/#\/login(?:\?|$)/);
  }
  await page.evaluate((token) => localStorage.setItem('bitterless-desktop-token', token), TOKEN);
  await page.goto(`${baseUrl}#/coding-agents`);
  await page
    .locator('[name="codingAgentSessions__page"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(async () => {
      throw new Error(
        `Coding Agents route did not render at ${page.url()}. Renderer diagnostics:\n${
          bitterless.rendererErrors.join('\n') || '(none)'
        }\nBody:\n${(await page.locator('body').innerText()).slice(0, 2_000)}`
      );
    });
  await page
    .getByRole('heading', { name: /Coding Agents|编程智能体/ })
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(async () => {
      throw new Error(
        `Coding Agents page shell rendered without its heading at ${page.url()}. Renderer diagnostics:\n${
          bitterless.rendererErrors.join('\n') || '(none)'
        }\nMain output:\n${bitterless.mainOutput.slice(-80).join('')}\nDOM:\n${(
          await page.locator('body').innerHTML()
        ).slice(0, 8_000)}`
      );
    });
  return page;
};

const listSessions = async (
  bitterless: CodingAgentE2ESession
): Promise<CodingAgentSessionRecord[]> => {
  return await bitterless.request<CodingAgentSessionRecord[]>('list', { includeUnknown: true });
};

const sessionRow = (page: Page, externalSessionId: string) =>
  page
    .locator('article[name="codingAgentSessions__sessionRow"]')
    .filter({ hasText: externalSessionId });

const assertFocusedDiagnostics = (bitterless: CodingAgentE2ESession): void => {
  expect(bitterless.rendererErrors).toEqual([]);
  const criticalMainOutput = bitterless.mainOutput
    .join('')
    .split('\n')
    .filter((line) =>
      /Coding-agent status bridge disabled|UnhandledPromiseRejection|uncaught exception|fatal error/i.test(
        line
      )
    );
  expect(criticalMainOutput).toEqual([]);
  expect(bitterless.unexpectedMockRequests).toEqual([]);
  expect(bitterless.deniedNetworkRequests()).toEqual([]);
};

const runHookHandler = async (
  handler: HookHandler,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  timeoutMs = 5_000
): Promise<ProcessResult> => {
  const startedAt = Date.now();
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(handler.command, handler.args ?? [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Hook helper did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt
      });
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
};

const findOwnedClaudeHandler = (settings: Record<string, unknown>): HookHandler => {
  const hooks = settings.hooks as Record<string, Array<{ hooks: HookHandler[] }>>;
  const handler = hooks.UserPromptSubmit?.flatMap((group) => group.hooks).find(
    (candidate) =>
      candidate.type === 'command' &&
      candidate.args?.includes('--coding-agent-hook-helper') &&
      candidate.args?.includes('--coding-agent-provider')
  );
  if (!handler) throw new Error('Installed Claude hook helper was not found');
  return handler;
};

const integrationRow = (page: Page, provider: 'Codex' | 'Claude') =>
  page.locator('section[name="codingAgentSessions__integrationRow"]').filter({ hasText: provider });

test.describe('Coding-agent sessions Electron integration', () => {
  test('authenticates, persists through real SQLite, intercepts the exact Codex URL, and re-registers after soft removal', async ({
    bitterless
  }) => {
    const paths = await bitterless.app.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      home: app.getPath('home')
    }));
    expect(paths).toEqual({ userData: bitterless.userDataDir, home: bitterless.homeDir });
    expect(bitterless.userDataDir.startsWith(bitterless.tempRoot)).toBe(true);
    expect(bitterless.homeDir.startsWith(bitterless.tempRoot)).toBe(true);

    let page = await openCodingAgents(bitterless, { verifyUnauthenticatedRedirect: true });
    const codingAgentMenuItem = page.locator('.home-menu__items .home-menu-item').last();
    await expect(codingAgentMenuItem).toBeVisible();
    await expect(codingAgentMenuItem).toHaveClass(/home-menu-item--active/);

    await page
      .getByRole('button', { name: /Add session|添加会话/ })
      .first()
      .click();
    const dialog = page.locator('form[name="codingAgentSessions__dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx').fill(CODEX_SESSION_ID);
    await dialog.getByPlaceholder(/Optional display title|可选显示标题/).fill('Exact Codex task');
    await dialog.getByRole('button', { name: /^(Add|添加)$/ }).click();

    let row = sessionRow(page, CODEX_SESSION_ID);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Exact Codex task');
    let rows = await listSessions(bitterless);
    expect(rows).toHaveLength(1);
    const initialRecord = rows[0];
    expect(initialRecord).toMatchObject({
      provider: 'codex',
      surface: 'codex-desktop',
      externalSessionId: CODEX_SESSION_ID,
      title: 'Exact Codex task',
      state: 'unknown',
      statusSource: 'manual'
    });

    await page.reload();
    await expect(sessionRow(page, CODEX_SESSION_ID)).toBeVisible();

    await bitterless.installOpenExternalProbe();
    row = sessionRow(page, CODEX_SESSION_ID);
    await row.getByRole('button', { name: /^(Open|打开)$/ }).click();
    await expect
      .poll(() => bitterless.openedExternalUrls())
      .toEqual([`codex://threads/${CODEX_SESSION_ID}`]);

    await bitterless.installOpenExternalProbe('E2E missing Codex URL handler');
    await row.getByRole('button', { name: /^(Open|打开)$/ }).click();
    await expect(row.locator('[name="codingAgentSessions__sessionNotice"]')).toContainText(
      /Codex URL handler is unavailable|Codex URL 处理程序不可用/
    );
    expect(await bitterless.openedExternalUrls()).toEqual([`codex://threads/${CODEX_SESSION_ID}`]);
    await bitterless.restoreOpenExternal();

    expect(await bitterless.request<boolean>('remove', { id: initialRecord.id })).toBe(true);
    await expect(sessionRow(page, CODEX_SESSION_ID)).toHaveCount(0);
    const recreated = await bitterless.request<CodingAgentSessionRecord>('register', {
      provider: 'codex',
      surface: 'codex-desktop',
      externalSessionId: CODEX_SESSION_ID,
      title: 'Re-created after removal'
    });
    expect(recreated.id).not.toBe(initialRecord.id);
    await expect(sessionRow(page, CODEX_SESSION_ID)).toContainText('Re-created after removal');

    const databasePath = join(bitterless.userDataDir, 'db', 'main.db');
    expect(existsSync(databasePath)).toBe(true);
    expect(statSync(databasePath).size).toBeGreaterThan(0);

    await bitterless.restart();
    page = await openCodingAgents(bitterless);
    await expect(sessionRow(page, CODEX_SESSION_ID)).toContainText('Re-created after removal');
    rows = await listSessions(bitterless);
    expect(rows.find((record) => record.externalSessionId === CODEX_SESSION_ID)?.id).toBe(
      recreated.id
    );
    expect(rows.some((record) => record.id === initialRecord.id)).toBe(false);
    assertFocusedDiagnostics(bitterless);
  });

  test('uses fake installed providers for foreground/background states, terminal interception, Codex metadata, and refresh failure', async ({
    bitterless
  }) => {
    bitterless.setProviderState({
      claude: {
        entries: [
          {
            kind: 'interactive',
            sessionId: CLAUDE_LIVE_SESSION_ID,
            name: 'Live foreground CLI',
            cwd: bitterless.projectDir,
            pid: 4242,
            startedAt: Date.now()
          },
          {
            kind: 'background',
            id: 'job-123',
            sessionId: CLAUDE_BACKGROUND_SESSION_ID,
            name: 'Background approval',
            cwd: bitterless.projectDir,
            pid: 4243,
            startedAt: Date.now(),
            state: 'blocked',
            waitingFor: 'permission prompt'
          }
        ]
      },
      codex: {
        entries: [
          {
            id: CODEX_SESSION_ID,
            name: 'Stored Codex metadata',
            cwd: bitterless.projectDir,
            status: { type: 'active', activeFlags: ['waitingOnApproval'] }
          }
        ]
      }
    });
    const page = await openCodingAgents(bitterless);

    await expect(sessionRow(page, CLAUDE_LIVE_SESSION_ID)).toBeVisible();
    await expect(sessionRow(page, CLAUDE_BACKGROUND_SESSION_ID)).toBeVisible();
    let rows = await listSessions(bitterless);
    const live = rows.find((record) => record.externalSessionId === CLAUDE_LIVE_SESSION_ID);
    const background = rows.find(
      (record) => record.externalSessionId === CLAUDE_BACKGROUND_SESSION_ID
    );
    expect(live).toMatchObject({
      surface: 'claude-code-cli',
      isProcessAlive: true,
      state: 'unknown'
    });
    expect(background).toMatchObject({
      surface: 'claude-code-background',
      runtimeJobId: 'job-123',
      state: 'waiting_approval',
      lastTurnState: 'in_progress',
      statusSource: 'claude-agents-cli'
    });
    await expect(
      sessionRow(page, CLAUDE_LIVE_SESSION_ID).getByRole('button', {
        name: /Already open|已在运行/
      })
    ).toBeDisabled();

    await bitterless.installOpenPathProbe();
    const attachResult = await bitterless.request<Record<string, unknown>>('open', {
      id: background?.id
    });
    expect(attachResult).toEqual({ kind: 'opened-terminal', action: 'attach' });
    expect(Object.keys(attachResult).sort()).toEqual(['action', 'kind']);
    const attachPaths = await bitterless.openedPaths();
    expect(attachPaths).toHaveLength(1);
    expect(attachPaths[0].startsWith(join(bitterless.userDataDir, 'coding-agent', 'launch'))).toBe(
      true
    );
    const attachScript = readFileSync(attachPaths[0], 'utf8');
    expect(attachScript).toContain('attach');
    expect(attachScript).toContain('job-123');
    expect(attachScript).toContain(bitterless.projectDir);
    const visibleText = await page.locator('[name="codingAgentSessions__page"]').innerText();
    expect(visibleText).not.toContain(attachPaths[0]);
    expect(visibleText).not.toContain('job-123');
    expect(visibleText).not.toContain('["attach"');
    await bitterless.restoreOpenPath();

    await page
      .getByRole('button', { name: /^(Refresh|刷新)$/ })
      .first()
      .click();
    await expect(sessionRow(page, CODEX_SESSION_ID)).toBeVisible();
    rows = await listSessions(bitterless);
    expect(rows.find((record) => record.externalSessionId === CODEX_SESSION_ID)).toMatchObject({
      provider: 'codex',
      state: 'unknown',
      statusSource: 'none',
      providerState: 'active:waitingOnApproval'
    });

    bitterless.setProviderState({
      claude: { mode: 'invalid-json' },
      codex: { entries: [] }
    });
    const failedRefresh = await bitterless.request<RefreshResult>('refresh', {
      provider: 'claude'
    });
    expect(failedRefresh.issues.map((issue) => issue.code)).toContain('invalid-output');
    rows = await listSessions(bitterless);
    expect(
      rows.find((record) => record.externalSessionId === CLAUDE_LIVE_SESSION_ID)?.isProcessAlive
    ).toBeNull();
    expect(
      rows.find((record) => record.externalSessionId === CLAUDE_BACKGROUND_SESSION_ID)
    ).toBeDefined();

    bitterless.setProviderState({ claude: { entries: [] }, codex: { entries: [] } });
    const emptyRefresh = await bitterless.request<RefreshResult>('refresh', {
      provider: 'claude'
    });
    expect(emptyRefresh.issues).toEqual([]);
    rows = await listSessions(bitterless);
    const inactive = rows.find((record) => record.externalSessionId === CLAUDE_LIVE_SESSION_ID);
    expect(inactive?.isProcessAlive).toBe(false);

    await bitterless.installOpenPathProbe();
    const resumeResult = await bitterless.request<Record<string, unknown>>('open', {
      id: inactive?.id
    });
    expect(resumeResult).toEqual({ kind: 'opened-terminal', action: 'resume' });
    expect(Object.keys(resumeResult).sort()).toEqual(['action', 'kind']);
    const resumePaths = await bitterless.openedPaths();
    expect(resumePaths).toHaveLength(1);
    const resumeScript = readFileSync(resumePaths[0], 'utf8');
    expect(resumeScript).toContain('--resume');
    expect(resumeScript).toContain(CLAUDE_LIVE_SESSION_ID);
    expect(resumeScript).toContain(bitterless.projectDir);
    await bitterless.restoreOpenPath();
    assertFocusedDiagnostics(bitterless);
  });

  test('installs isolated hooks and exercises helper socket to real DAO/UI without private payload leakage', async ({
    bitterless
  }) => {
    const page = await openCodingAgents(bitterless);
    const codexSettingsPath = join(bitterless.homeDir, '.codex', 'hooks.json');
    const claudeSettingsPath = join(bitterless.homeDir, '.claude', 'settings.json');
    mkdirSync(join(bitterless.homeDir, '.codex'), { recursive: true });
    mkdirSync(join(bitterless.homeDir, '.claude'), { recursive: true });
    writeFileSync(
      codexSettingsPath,
      `${JSON.stringify(
        {
          keep: 'codex-unrelated',
          hooks: {
            Stop: [
              {
                matcher: 'external-only',
                hooks: [{ type: 'command', command: 'external-codex-hook', timeout: 9 }]
              }
            ]
          }
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    writeFileSync(
      claudeSettingsPath,
      `${JSON.stringify(
        {
          keep: 'claude-unrelated',
          hooks: {
            Notification: [
              {
                matcher: 'external-only',
                hooks: [{ type: 'command', command: 'external-claude-hook', timeout: 9 }]
              }
            ]
          }
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    await page.getByRole('button', { name: /Integrations|集成/ }).click();
    const codexIntegration = integrationRow(page, 'Codex');
    const claudeIntegration = integrationRow(page, 'Claude');
    await expect(codexIntegration).toContainText(/Not installed|未安装/);
    await expect(claudeIntegration).toContainText(/Not installed|未安装/);
    await codexIntegration.getByRole('button', { name: /^(Install|安装)$/ }).click();
    await claudeIntegration.getByRole('button', { name: /^(Install|安装)$/ }).click();
    await expect(codexIntegration).toContainText(/Configured|已配置/);
    await expect(claudeIntegration).toContainText(/Configured|已配置/);

    const codexSettings = JSON.parse(readFileSync(codexSettingsPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const claudeSettings = JSON.parse(readFileSync(claudeSettingsPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(codexSettings.keep).toBe('codex-unrelated');
    expect(claudeSettings.keep).toBe('claude-unrelated');
    expect(JSON.stringify(codexSettings)).toContain('external-codex-hook');
    expect(JSON.stringify(claudeSettings)).toContain('external-claude-hook');
    const claudeHandler = findOwnedClaudeHandler(claudeSettings);

    const ingress = await runHookHandler(
      claudeHandler,
      {
        session_id: HOOK_SESSION_ID,
        cwd: bitterless.projectDir,
        hook_event_name: 'UserPromptSubmit',
        prompt: PRIVACY_SENTINEL,
        transcript_path: `/private/${PRIVACY_SENTINEL}.jsonl`,
        tool_input: { secret: PRIVACY_SENTINEL },
        last_assistant_message: PRIVACY_SENTINEL
      },
      bitterless.launchEnv
    );
    expect(ingress).toMatchObject({ code: 0, signal: null, stdout: '' });

    await expect(sessionRow(page, HOOK_SESSION_ID)).toBeVisible();
    await expect(sessionRow(page, HOOK_SESSION_ID)).toContainText(/Working|工作中/);
    let rows = await listSessions(bitterless);
    const hooked = rows.find((record) => record.externalSessionId === HOOK_SESSION_ID);
    expect(hooked).toMatchObject({
      provider: 'claude',
      surface: 'claude-code-cli',
      state: 'working',
      lastTurnState: 'in_progress',
      statusSource: 'claude-hook',
      providerState: 'hook:UserPromptSubmit'
    });
    expect(JSON.stringify(rows)).not.toContain(PRIVACY_SENTINEL);
    expect(await page.locator('body').innerText()).not.toContain(PRIVACY_SENTINEL);
    const bridgeStatus = await bitterless.request<CodingAgentIntegrationStatus>(
      'getIntegrationStatus',
      { provider: 'claude' }
    );
    expect(bridgeStatus).toMatchObject({
      provider: 'claude',
      configuration: 'configured',
      bridgeListening: true
    });
    expect(bridgeStatus.lastEventAt).not.toBeNull();

    await bitterless.stop();
    const downtime = await runHookHandler(
      claudeHandler,
      {
        session_id: DOWNTIME_SESSION_ID,
        cwd: bitterless.projectDir,
        hook_event_name: 'UserPromptSubmit',
        prompt: PRIVACY_SENTINEL
      },
      bitterless.launchEnv,
      3_000
    );
    expect(downtime).toMatchObject({ code: 0, signal: null, stdout: '' });
    expect(downtime.elapsedMs).toBeLessThan(2_000);

    await bitterless.restart();
    const restartedPage = await openCodingAgents(bitterless);
    rows = await listSessions(bitterless);
    const restartedHook = rows.find((record) => record.externalSessionId === HOOK_SESSION_ID);
    expect(restartedHook).toMatchObject({
      state: 'unknown',
      lastTurnState: 'in_progress',
      statusSource: 'claude-hook'
    });
    expect(rows.some((record) => record.externalSessionId === DOWNTIME_SESSION_ID)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain(PRIVACY_SENTINEL);
    await expect(sessionRow(restartedPage, HOOK_SESSION_ID)).toBeVisible();
    await expect(sessionRow(restartedPage, DOWNTIME_SESSION_ID)).toHaveCount(0);

    await restartedPage.getByRole('button', { name: /Integrations|集成/ }).click();
    const restartedCodexIntegration = integrationRow(restartedPage, 'Codex');
    const restartedClaudeIntegration = integrationRow(restartedPage, 'Claude');
    await expect(restartedCodexIntegration).toContainText(/Configured|已配置/);
    await expect(restartedClaudeIntegration).toContainText(/Configured|已配置/);
    await restartedCodexIntegration.getByRole('button', { name: /^(Remove|移除)$/ }).click();
    await restartedClaudeIntegration.getByRole('button', { name: /^(Remove|移除)$/ }).click();
    await expect(restartedCodexIntegration).toContainText(/Not installed|未安装/);
    await expect(restartedClaudeIntegration).toContainText(/Not installed|未安装/);

    const removedCodexSettings = JSON.parse(readFileSync(codexSettingsPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const removedClaudeSettings = JSON.parse(readFileSync(claudeSettingsPath, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(removedCodexSettings.keep).toBe('codex-unrelated');
    expect(removedClaudeSettings.keep).toBe('claude-unrelated');
    expect(JSON.stringify(removedCodexSettings)).toContain('external-codex-hook');
    expect(JSON.stringify(removedClaudeSettings)).toContain('external-claude-hook');
    expect(JSON.stringify(removedCodexSettings)).not.toContain('bitterless-codex-session-hook');
    expect(JSON.stringify(removedClaudeSettings)).not.toContain('--coding-agent-hook-helper');
    assertFocusedDiagnostics(bitterless);
  });
});
