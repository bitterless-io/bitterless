import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-provider-snapshot-race-'));
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

const uuid = (index) => (
  `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
);
const thread = (provider, index) => ({
  sessionKey: `${provider}:${uuid(index)}`,
  provider,
  threadId: uuid(index),
  desktopSessionId: provider === 'claude' ? `local_${uuid(index)}` : null,
  transcriptPath: null,
  canPreviewTranscript: false,
  domainId: 1,
  title: `${provider} task`,
  cwd: null,
  projectKey: null,
  projectRoot: null,
  projectName: null,
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
  lastUserPrompt: {
    state: 'unavailable', preview: null, turnId: null, observedAt: null,
    checkedAt: null, truncated: false
  }
});
const stoppedBridge = () => ({
  state: 'not_installed', reviewReason: null, listening: false,
  listeningSince: null, lastEventAt: null, lastInspectedAt: null, error: null
});

test('a slow enabled snapshot is rebuilt after a concurrent persisted disable', async () => {
  let preference = { schemaVersion: 1, enabled: true, hookAdmissionAfter: 500 };
  let blockReceipts = false;
  let releaseReceipt;
  let markReceiptEntered;
  const receiptEntered = new Promise((resolvePromise) => { markReceiptEntered = resolvePromise; });
  const receiptGate = new Promise((resolvePromise) => { releaseReceipt = resolvePromise; });
  const persisted = {
    domains: [{ id: 1, domainKey: 'uncategorized', title: 'All', sortIndex: 0, isSystem: true }],
    threads: [thread('codex', 1), thread('claude', 2)]
  };
  const repository = {
    getSnapshot: async () => persisted,
    getRuntimeReceiptSummary: async () => {
      if (blockReceipts) {
        markReceiptEntered();
        await receiptGate;
      }
      return { firstReceivedAt: null, lastReceivedAt: null };
    },
    expireClaudeAgentStates: async () => ({ changed: false }),
    invalidateAppServerStatuses: async () => undefined,
    invalidateCodexHookStatuses: async () => undefined,
    markAllRead: async () => ({ changed: false })
  };
  const desktopBridge = {
    getStatus: stoppedBridge,
    hasInstallationIntent: () => false,
    hasExactInstallation: () => false,
    refreshInstalledArtifacts: stoppedBridge,
    getDisabledExactHookKeys: () => [],
    install: stoppedBridge,
    remove: stoppedBridge,
    updateHookInspection: () => undefined,
    setHookInspectionError: () => undefined,
    setOperationalError: () => undefined
  };
  const service = new EyesOnAgentsService({
    repository,
    settings: { get: async () => false, upsert: async () => undefined },
    appServer: {
      getStatus: (autoConnectEnabled) => ({
        state: 'disconnected', lastSyncedAt: null, error: null, autoConnectEnabled
      }),
      isConnected: () => false,
      connect: async () => undefined,
      disconnect: async () => undefined,
      listThreads: async () => [],
      listArchivedThreads: async () => []
    },
    claudeProviderPreference: {
      hydrate: async () => ({ state: 'valid', preference: { ...preference } }),
      getStatus: () => ({ ...preference, error: null }),
      setEnabled: async (enabled, hookAdmissionAfter) => {
        preference = { schemaVersion: 1, enabled, hookAdmissionAfter };
        return { ...preference };
      }
    },
    desktopBridge,
    bridgeListener: {
      start: async () => undefined,
      stop: async () => undefined,
      recoverOutboxCoverageGap: async () => undefined,
      replayOutbox: async () => undefined
    },
    claudeObservation: {
      start: async () => undefined,
      stop: async () => undefined,
      refresh: async () => ({ changed: false })
    },
    claudeHookListener: {
      start: async () => undefined,
      stop: async () => undefined,
      replayOutbox: async () => undefined,
      clearOutbox: async () => undefined
    },
    openExternal: async () => undefined,
    now: () => 1_000
  });
  await service.initialize();
  let ready;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    ready = await service.getSnapshot();
    if (ready.threads.some(({ provider }) => provider === 'claude')) break;
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
  }
  assert.equal(ready.threads.some(({ provider }) => provider === 'claude'), true);
  blockReceipts = true;
  const slowSnapshot = service.getSnapshot();
  await receiptEntered;
  const disabled = await service.setClaudeProviderEnabled({ enabled: false });
  assert.equal(disabled.claudeProvider.enabled, false);
  assert.deepEqual(disabled.threads.map(({ provider }) => provider), ['codex']);
  releaseReceipt();
  const rebuilt = await slowSnapshot;
  assert.equal(rebuilt.claudeProvider.enabled, false);
  assert.equal(rebuilt.claudeProvider.revision, disabled.claudeProvider.revision);
  assert.deepEqual(rebuilt.threads.map(({ provider }) => provider), ['codex']);
  await service.shutdown();
});

test.after(() => rmSync(buildRoot, { recursive: true, force: true }));
