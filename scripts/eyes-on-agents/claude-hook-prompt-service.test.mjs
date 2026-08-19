import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-prompt-service-'));
const CODEX_ID = '11111111-1111-4111-8111-111111111111';
const CLAUDE_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';

const outfile = join(buildRoot, 'service.mjs');
await build({
  entryPoints: [join(projectRoot, 'src/main/eyesOnAgents/eyesOnAgents.service.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});
const { EyesOnAgentsService } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

const tick = async () => await new Promise((resolvePromise) => setImmediate(resolvePromise));
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const prompt = (preview) => ({
  state: preview === null ? 'unavailable' : 'available',
  preview,
  turnId: null,
  observedAt: preview === null ? null : new Date(900).toISOString(),
  checkedAt: null,
  truncated: false
});

const thread = (provider, lastUserPrompt) => ({
  sessionKey: `${provider}:${provider === 'codex' ? CODEX_ID : CLAUDE_ID}`,
  provider,
  threadId: provider === 'codex' ? CODEX_ID : CLAUDE_ID,
  desktopSessionId: provider === 'claude' ? `local_${CLAUDE_ID}` : null,
  transcriptPath: provider === 'claude' ? `/tmp/${CLAUDE_ID}.jsonl` : null,
  domainId: null,
  title: `${provider} task`,
  cwd: '/tmp/project',
  projectRootPath: '/tmp/project',
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
  isUnread: false,
  isFocused: false,
  archiveState: 'active',
  lastUserPrompt
});

const bridgeStatus = () => ({
  state: 'observing',
  setupAction: 'none',
  configured: true,
  enabled: true,
  listening: true,
  listeningSince: null,
  firstReceiptAt: null,
  lastReceiptAt: null,
  lastInspectedAt: null,
  observationProof: 'receipt',
  restartRequired: false,
  error: null
});

const delivery = (params) => ({
  schemaVersion: 1,
  deliveryId: params.deliveryId,
  installationId: INSTALLATION_ID,
  event: {
    schemaVersion: 2,
    eventId: params.deliveryId,
    occurredAt: params.occurredAt,
    payload: {
      hookEventName: 'UserPromptSubmit',
      sessionId: CLAUDE_ID,
      transcriptPath: `/tmp/${CLAUDE_ID}.jsonl`,
      cwd: '/tmp/project',
      ...(params.preview === undefined ? {} : {
        userPromptPreview: params.preview,
        userPromptTruncated: false
      })
    }
  }
});

const createHarness = (options = {}) => {
  const calls = [];
  const promptWrites = [];
  const promptClears = [];
  let claudePromptEnabled = options.claudePromptEnabled === true;
  const storedPrompt = prompt('stored question');
  const repository = {
    getSnapshot: async () => ({
      domains: [{ id: 1, domainKey: 'uncategorized', title: 'All', sortIndex: 0, isSystem: true }],
      threads: [thread('codex', storedPrompt), thread('claude', storedPrompt)]
    }),
    upsertClaudeInventory: async () => ({ changed: false }),
    applyRuntimeEventDelivery: async ({ hookLastUserPrompt }) => {
      calls.push('runtime-write');
      promptWrites.push(hookLastUserPrompt);
      if (options.runtimeWriteGate) await options.runtimeWriteGate;
      return {
        duplicate: false,
        created: false,
        titleMissing: false,
        completionAlert: null
      };
    },
    clearLastUserPrompts: async ({ providers }) => {
      calls.push(`prompt-clear:${providers.join('+')}`);
      promptClears.push([...providers]);
      return { changed: true };
    },
    getRuntimeReceiptSummary: async () => ({
      firstReceivedAt: null,
      lastReceivedAt: null
    }),
    expireClaudeAgentStates: async () => ({ changed: false }),
    invalidateAppServerStatuses: async () => undefined,
    invalidateCodexHookStatuses: async () => undefined
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
    lastUserPromptPreference: {
      isEnabled: () => false,
      enable: () => false,
      disable: () => false
    },
    claudeLastUserPromptPreference: {
      isEnabled: () => claudePromptEnabled,
      enable: () => {
        if (claudePromptEnabled) return false;
        claudePromptEnabled = true;
        return true;
      },
      disable: () => {
        if (!claudePromptEnabled) return false;
        claudePromptEnabled = false;
        return true;
      }
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
        state: 'not_installed', reviewReason: null, error: null, listening: false,
        listeningSince: null, lastEventAt: null, installedHookKeys: [],
        missingHookKeys: [], unexpectedHookKeys: [], disabledHookKeys: [],
        hookInspectionError: null
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
    openExternal: async () => undefined,
    writeClipboardText: () => undefined,
    validateClaudeTranscript: (path) => path,
    claudeObservation: {
      start: async () => calls.push('observation-start'),
      stop: async () => undefined,
      refresh: async () => ({ changed: false }),
      getDirectoryStatus: () => ({
        mode: 'automatic', configuredDirectory: null, effectiveDirectory: '/tmp/.claude',
        projectsDirectory: '/tmp/.claude/projects', desktopDirectoryCount: 0,
        state: 'watching', watching: true, lastScanAt: null,
        lastSuccessfulScanAt: null, nextRetryAt: null, error: null
      })
    },
    claudeBridge: {
      getStatus: bridgeStatus,
      hasInstallationIntent: () => true,
      acceptsInstallation: (value) => value === INSTALLATION_ID,
      revokeObservationProof: () => undefined,
      install: async () => bridgeStatus(),
      refresh: async () => bridgeStatus(),
      remove: async () => bridgeStatus()
    },
    claudeHookListener: {
      start: async () => calls.push('listener-start'),
      stop: async () => undefined,
      replayOutbox: async () => undefined,
      clearOutbox: async () => undefined
    },
    now: () => 1_000
  });
  return { service, calls, promptWrites, promptClears };
};

const initialize = async (harness) => {
  await harness.service.initialize();
  await waitFor(async () => (
    (await harness.service.getSnapshot()).claudeProvider.enabled === true &&
    harness.calls.includes('listener-start')
  ), 'Claude provider activation');
};

test('Claude consent gates V2 preview, metadata-only pending, and provider redaction', async () => {
  const harness = createHarness({ claudePromptEnabled: true });
  await initialize(harness);
  const snapshot = await harness.service.getSnapshot();
  assert.equal(snapshot.lastUserPromptCaptureEnabled, false);
  assert.equal(snapshot.claudeLastUserPromptCaptureEnabled, true);
  assert.equal(snapshot.threads.find(({ provider }) => provider === 'codex').lastUserPrompt.state,
    'unavailable');
  assert.equal(snapshot.threads.find(({ provider }) => provider === 'claude').lastUserPrompt.preview,
    'stored question');

  await harness.service.commitClaudeHookDelivery(delivery({
    deliveryId: '44444444-4444-4444-8444-444444444444',
    occurredAt: 1_000,
    preview: 'live Claude question'
  }));
  assert.deepEqual(harness.promptWrites.at(-1), {
    preview: 'live Claude question', truncated: false
  });
  await harness.service.commitClaudeHookDelivery(delivery({
    deliveryId: '55555555-5555-4555-8555-555555555555',
    occurredAt: 1_001
  }));
  assert.deepEqual(harness.promptWrites.at(-1), { preview: null, truncated: false });
});

test('disabled Claude capture persists lifecycle without a prompt candidate', async () => {
  const harness = createHarness();
  await initialize(harness);
  await harness.service.commitClaudeHookDelivery(delivery({
    deliveryId: '77777777-7777-4777-8777-777777777777',
    occurredAt: 1_000,
    preview: 'must stay in memory only'
  }));
  assert.equal(harness.calls.filter((value) => value === 'runtime-write').length, 1);
  assert.equal(harness.promptWrites.at(-1), undefined);
});

test('Claude disable joins admitted content write before Claude-only clear', async () => {
  let releaseWrite;
  const runtimeWriteGate = new Promise((resolvePromise) => { releaseWrite = resolvePromise; });
  const harness = createHarness({ claudePromptEnabled: true, runtimeWriteGate });
  await initialize(harness);
  const commit = harness.service.commitClaudeHookDelivery(delivery({
    deliveryId: '66666666-6666-4666-8666-666666666666',
    occurredAt: 1_000,
    preview: 'race question'
  }));
  await waitFor(() => harness.calls.includes('runtime-write'), 'Claude prompt write');
  const disable = harness.service.setClaudeLastUserPromptCaptureEnabled({ enabled: false });
  await tick();
  assert.deepEqual(harness.promptClears, []);
  releaseWrite();
  await Promise.all([commit, disable]);
  assert.deepEqual(harness.promptClears, [['claude']]);
  assert.equal((await harness.service.getSnapshot()).claudeLastUserPromptCaptureEnabled, false);
});

test.after(() => rmSync(buildRoot, { recursive: true, force: true }));
