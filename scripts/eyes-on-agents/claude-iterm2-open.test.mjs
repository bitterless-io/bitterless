import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-iterm2-open-'));
const CODEX_ID = '019f653a-2ef7-7031-8f6b-c770bacffbb2';
const CLAUDE_DESKTOP_ONLY_ID = '11111111-1111-4111-8111-111111111111';
const CLAUDE_ITERM2_ONLY_ID = '22222222-2222-4222-8222-222222222222';
const CLAUDE_BOTH_ID = '33333333-3333-4333-8333-333333333333';
const CLAUDE_NEITHER_ID = '44444444-4444-4444-8444-444444444444';
const ITERM2_SESSION_ID = 'w0t0p0:2eaac309-9a33-4f6b-a579-e813c968dcf2';
const ITERM2_SESSION_ID_BOTH = 'w1t0p0:3eaac309-9a33-4f6b-a579-e813c968dcf3';

const loadTypeScriptModule = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json')
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const [contractModule, serviceModule] = await Promise.all([
  loadTypeScriptModule('contract', 'src/shared/eyesOnAgents/eyesOnAgents.contract.ts'),
  loadTypeScriptModule('service', 'src/main/eyesOnAgents/eyesOnAgents.service.ts')
]);
const { buildEyesOnAgentsIterm2DeepLink } = contractModule;
const { EyesOnAgentsService } = serviceModule;

const tick = async () => await new Promise((resolvePromise) => setImmediate(resolvePromise));
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const thread = ({ provider, threadId, desktopSessionId = null, iterm2SessionId = null }) => ({
  sessionKey: `${provider}:${threadId}`,
  provider,
  threadId,
  desktopSessionId,
  iterm2SessionId,
  transcriptPath: provider === 'claude' ? `/tmp/${threadId}.jsonl` : null,
  domainId: 1,
  title: `${provider} task`,
  cwd: '/tmp/project',
  projectKey: '/tmp/project',
  projectRoot: '/tmp/project',
  projectName: 'project',
  runtimeState: 'idle',
  activeFlags: [],
  activeTurnId: null,
  lastCompletedTurnId: null,
  lastCompletedAt: null,
  lastOpenedTurnId: null,
  lastOpenedAt: null,
  statusSource: 'discovery',
  statusObservedAt: null,
  statusFreshUntil: null,
  lastActivityAt: null,
  isUnread: true,
  isFocused: true,
  archiveState: 'active',
  lastUserPrompt: {
    state: 'unavailable', preview: null, turnId: null, observedAt: null,
    checkedAt: null, truncated: false
  }
});

const createHarness = () => {
  const calls = [];
  const persisted = {
    domains: [{ id: 1, domainKey: 'uncategorized', title: 'All', sortIndex: 0, isSystem: true }],
    threads: [
      thread({ provider: 'codex', threadId: CODEX_ID }),
      thread({
        provider: 'claude', threadId: CLAUDE_DESKTOP_ONLY_ID,
        desktopSessionId: `local_${CLAUDE_DESKTOP_ONLY_ID}`
      }),
      thread({
        provider: 'claude', threadId: CLAUDE_ITERM2_ONLY_ID,
        iterm2SessionId: ITERM2_SESSION_ID
      }),
      thread({
        provider: 'claude', threadId: CLAUDE_BOTH_ID,
        desktopSessionId: `local_${CLAUDE_BOTH_ID}`, iterm2SessionId: ITERM2_SESSION_ID_BOTH
      }),
      thread({ provider: 'claude', threadId: CLAUDE_NEITHER_ID })
    ]
  };
  const repository = {
    getSnapshot: async () => persisted,
    getThreadRefreshCandidate: async (params) => {
      calls.push(`sync-status:${params.threadId}`);
      return null;
    },
    markOpened: async ({ sessionKey }) => calls.push(`opened:${sessionKey}`),
    expireClaudeAgentStates: async () => ({ changed: false }),
    getClaudeOpenTarget: async ({ sessionKey }) => {
      const found = persisted.threads.find((item) => item.sessionKey === sessionKey);
      if (!found || found.provider !== 'claude') return null;
      return {
        sessionKey,
        desktopSessionId: found.desktopSessionId,
        iterm2SessionId: found.iterm2SessionId,
        transcriptPath: found.transcriptPath,
        runtimeState: found.runtimeState
      };
    }
  };
  const service = new EyesOnAgentsService({
    repository,
    settings: { get: async () => false, upsert: async () => undefined },
    appServer: {
      getStatus: (autoConnectEnabled) => ({
        state: 'disconnected', lastSyncedAt: null, error: null, autoConnectEnabled
      }),
      isConnected: () => false
    },
    claudeProviderPreference: {
      hydrate: async () => ({
        state: 'valid',
        preference: { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 }
      }),
      getStatus: () => ({ enabled: true, hookAdmissionAfter: 500, error: null }),
      setEnabled: async (enabled, hookAdmissionAfter) => ({
        schemaVersion: 1, enabled, hookAdmissionAfter
      })
    },
    desktopBridge: {
      getStatus: () => ({
        state: 'not_installed', reviewReason: null, listening: false, listeningSince: null,
        lastEventAt: null, lastInspectedAt: null, error: null
      }),
      hasInstallationIntent: () => false,
      hasExactInstallation: () => false,
      refreshInstalledArtifacts: () => undefined,
      getDisabledExactHookKeys: () => [],
      install: () => undefined,
      remove: () => undefined,
      updateHookInspection: () => undefined,
      setHookInspectionError: () => undefined,
      setOperationalError: () => undefined
    },
    bridgeListener: {
      start: async () => undefined,
      stop: async () => undefined,
      recoverOutboxCoverageGap: async () => undefined,
      replayOutbox: async () => undefined
    },
    openExternal: async (url) => calls.push(`open:${url}`),
    writeClipboardText: () => undefined,
    claudeObservation: {
      start: async () => calls.push('observation-start'),
      stop: async () => calls.push('observation-stop'),
      refresh: async () => ({ changed: false })
    },
    broadcastChanged: () => calls.push('broadcast'),
    now: () => 1_000
  });
  return { service, calls };
};

const initializeAndWaitEnabled = async (harness) => {
  await harness.service.initialize();
  await waitFor(async () => {
    const snapshot = await harness.service.getSnapshot();
    return snapshot.claudeProvider.enabled === true && harness.calls.includes('observation-start');
  }, 'Claude provider enable hydration');
};

test('a CLI-only row with only iterm2SessionId set is included in the Claude projection', async () => {
  const harness = createHarness();
  await initializeAndWaitEnabled(harness);
  const snapshot = await harness.service.getSnapshot();
  const claudeSessionKeys = snapshot.threads
    .filter((item) => item.provider === 'claude')
    .map((item) => item.sessionKey)
    .sort();
  assert.deepEqual(claudeSessionKeys, [
    `claude:${CLAUDE_BOTH_ID}`,
    `claude:${CLAUDE_DESKTOP_ONLY_ID}`,
    `claude:${CLAUDE_ITERM2_ONLY_ID}`
  ].sort(), 'a row with neither identity must stay excluded exactly as today');
  const iterm2Only = snapshot.threads.find(
    (item) => item.sessionKey === `claude:${CLAUDE_ITERM2_ONLY_ID}`
  );
  assert.equal(iterm2Only.desktopSessionId, null);
  assert.equal(iterm2Only.iterm2SessionId, ITERM2_SESSION_ID);
  const both = snapshot.threads.find((item) => item.sessionKey === `claude:${CLAUDE_BOTH_ID}`);
  assert.equal(both.desktopSessionId, `local_${CLAUDE_BOTH_ID}`);
  assert.equal(both.iterm2SessionId, ITERM2_SESSION_ID_BOTH,
    'a row with both identities must include both on the returned row');
});

test('openThreadInIterm2 builds the reveal URL, opens it, marks opened, and notifies', async () => {
  const harness = createHarness();
  await initializeAndWaitEnabled(harness);
  harness.calls.length = 0;
  const sessionKey = `claude:${CLAUDE_ITERM2_ONLY_ID}`;
  const expectedUrl = buildEyesOnAgentsIterm2DeepLink(ITERM2_SESSION_ID);
  const result = await harness.service.openThreadInIterm2({ sessionKey });
  assert.equal(result.url, expectedUrl);
  assert.equal(expectedUrl, `iterm2:///reveal?sessionid=${encodeURIComponent(ITERM2_SESSION_ID)}`);
  assert.deepEqual(harness.calls, [`open:${expectedUrl}`, `opened:${sessionKey}`, 'broadcast']);
  assert.equal(
    harness.calls.some((call) => call.startsWith('open:claude://')),
    false,
    'openThreadInIterm2 must never invoke the Claude Desktop deep-link route'
  );
  assert.equal(
    harness.calls.some((call) => call.startsWith('sync-status:')),
    false,
    'openThreadInIterm2 must never run the Codex-only status sync'
  );
});

test('openThreadInIterm2 rejects a codex provider row', async () => {
  const harness = createHarness();
  await initializeAndWaitEnabled(harness);
  harness.calls.length = 0;
  await assert.rejects(
    () => harness.service.openThreadInIterm2({ sessionKey: `codex:${CODEX_ID}` }),
    /Thread was not found/
  );
  assert.deepEqual(harness.calls, [], 'a rejected codex row must never call openExternal or markOpened');
});

test('openThreadInIterm2 rejects a claude row with iterm2SessionId === null', async () => {
  const harness = createHarness();
  await initializeAndWaitEnabled(harness);
  harness.calls.length = 0;
  await assert.rejects(
    () => harness.service.openThreadInIterm2({ sessionKey: `claude:${CLAUDE_DESKTOP_ONLY_ID}` }),
    /not matched to an iTerm2 session/
  );
  await assert.rejects(
    () => harness.service.openThreadInIterm2({ sessionKey: `claude:${CLAUDE_NEITHER_ID}` }),
    /not matched to an iTerm2 session/
  );
  assert.deepEqual(harness.calls, [],
    'a rejected claude row without an iTerm2 identity must never call openExternal or markOpened');
});
