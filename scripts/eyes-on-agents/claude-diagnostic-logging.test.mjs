import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-diagnostic-logging-'));
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const ITERM_SESSION_ID = 'w0t1p1:2EAAC309-9A33-4F6B-A579-E813C968DCF2';
const CLAUDE_CONFIG_DIR = '/tmp/claude-environments/claude2';
const TRANSCRIPT_PATH = `/tmp/${SESSION_ID}.jsonl`;
const CWD = '/tmp/project';
const HELD_IDS = [
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-000000000004',
  'a0000000-0000-4000-8000-000000000005',
  'a0000000-0000-4000-8000-000000000006',
  'a0000000-0000-4000-8000-000000000007'
];
const VISIBLE_ID = 'b0000000-0000-4000-8000-000000000001';

const load = async (name, entry) => {
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

const [serviceModule, hookLogModule, visibilityLogModule] = await Promise.all([
  load('service', 'src/main/eyesOnAgents/eyesOnAgents.service.ts'),
  load('hookLog', 'src/main/eyesOnAgents/claudeHookLog.helper.ts'),
  load('visibilityLog', 'src/main/eyesOnAgents/claudeVisibilityLog.helper.ts')
]);
const { EyesOnAgentsService } = serviceModule;
const { buildClaudeHookLogLine } = hookLogModule;
const {
  CLAUDE_VISIBILITY_GATE_LOG_ID_LIMIT,
  buildClaudeVisibilityGateLogLine
} = visibilityLogModule;

const tick = async () => await new Promise((resolvePromise) => setImmediate(resolvePromise));
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const persistedThread = ({ threadId, desktopSessionId = null, iterm2SessionId = null }) => ({
  sessionKey: `claude:${threadId}`,
  provider: 'claude',
  threadId,
  desktopSessionId,
  iterm2SessionId,
  claudeConfigDir: null,
  transcriptPath: null,
  domainId: 1,
  title: 'claude task',
  cwd: CWD,
  projectKey: CWD,
  projectRoot: CWD,
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
  lastUserPrompt: {
    state: 'unavailable', preview: null, turnId: null, observedAt: null,
    checkedAt: null, truncated: false
  }
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

const createHarness = (options = {}) => {
  const calls = [];
  const threads = options.threads ?? [];
  const repository = {
    getSnapshot: async () => ({
      domains: [{ id: 1, domainKey: 'uncategorized', title: 'All', sortIndex: 0, isSystem: true }],
      threads
    }),
    upsertClaudeInventory: async () => ({ changed: true }),
    applyRuntimeEventDelivery: async () => ({
      duplicate: false, created: false, titleMissing: false, completionAlert: null
    }),
    clearLastUserPrompts: async () => ({ changed: false }),
    getRuntimeReceiptSummary: async () => ({ firstReceivedAt: null, lastReceivedAt: null }),
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
    lastUserPromptPreference: { isEnabled: () => false, enable: () => false, disable: () => false },
    claudeLastUserPromptPreference: {
      isEnabled: () => false, enable: () => false, disable: () => false
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
    validateClaudeTranscript: options.validateClaudeTranscript ?? ((path) => path),
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
  return { service, calls };
};

const captureConsoleInfo = () => {
  const original = console.info;
  const lines = [];
  console.info = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.info = original; } };
};

const initialize = async (harness) => {
  await harness.service.initialize();
  await waitFor(async () => (
    (await harness.service.getSnapshot()).claudeProvider.enabled === true &&
    harness.calls.includes('listener-start')
  ), 'Claude provider activation');
};

const delivery = ({ deliveryId, hookEventName, occurredAt, terminal = false, configDir = false }) => {
  const carriesSessionStartFields = hookEventName === 'SessionStart' && (terminal || configDir);
  return {
    schemaVersion: 1,
    deliveryId,
    installationId: INSTALLATION_ID,
    event: {
      schemaVersion: carriesSessionStartFields ? 4 : 2,
      eventId: deliveryId,
      occurredAt,
      payload: {
        hookEventName,
        sessionId: SESSION_ID,
        transcriptPath: TRANSCRIPT_PATH,
        cwd: CWD,
        ...(terminal
          ? { terminalApp: 'iterm2', terminalSessionId: ITERM_SESSION_ID }
          : {}),
        ...(configDir ? { claudeConfigDir: CLAUDE_CONFIG_DIR } : {})
      }
    }
  };
};

const deliveryId = (index) => `5${index}555555-5555-4555-8555-555555555555`;

test('every hook event logs its session, schemaVersion, terminal identity and attribution', async () => {
  const harness = createHarness();
  const capture = captureConsoleInfo();
  let lines = [];
  try {
    await initialize(harness);
    const events = [
      'SessionStart',
      'UserPromptSubmit',
      'PermissionRequest',
      'Stop',
      'StopFailure',
      'SessionEnd'
    ];
    for (const [index, hookEventName] of events.entries()) {
      await harness.service.commitClaudeHookDelivery(delivery({
        deliveryId: deliveryId(index),
        hookEventName,
        occurredAt: 1_000 + index
      }));
    }
    lines = capture.lines.filter((line) => line.startsWith('[claude-hook]'));
  } finally {
    capture.restore();
  }
  assert.deepEqual(lines, [
    'SessionStart',
    'UserPromptSubmit',
    'PermissionRequest',
    'Stop',
    'StopFailure',
    'SessionEnd'
  ].map((hookEventName) => (
    `[claude-hook] event=${hookEventName} session=${SESSION_ID} schemaVersion=2 `
    + 'terminalIdentity=false terminalApp=none terminalSession=none '
    + 'environmentAttribution=false transcript=true'
  )), 'each hook event must be traceable to its session, not just SessionStart');
});

test('a SessionStart carrying terminal identity and attribution logs both, never a path', async () => {
  const harness = createHarness();
  const capture = captureConsoleInfo();
  let lines = [];
  try {
    await initialize(harness);
    await harness.service.commitClaudeHookDelivery(delivery({
      deliveryId: deliveryId(6),
      hookEventName: 'SessionStart',
      occurredAt: 1_100,
      terminal: true,
      configDir: true
    }));
    lines = capture.lines.filter((line) => line.startsWith('[claude-hook]'));
  } finally {
    capture.restore();
  }
  assert.deepEqual(lines, [
    `[claude-hook] event=SessionStart session=${SESSION_ID} schemaVersion=4 `
    + `terminalIdentity=true terminalApp=iterm2 terminalSession=${ITERM_SESSION_ID} `
    + 'environmentAttribution=true transcript=true'
  ]);
  assert.equal(lines[0].includes(CLAUDE_CONFIG_DIR), false);
  assert.equal(lines[0].includes(TRANSCRIPT_PATH), false);
  assert.equal(lines[0].includes(CWD), false);
  // The same rule the [claude-iterm2] helper is held to: an identifier may be logged, a path never.
  for (const line of lines) {
    assert.equal(line.includes('/'), false, `a log line must never carry a path: ${line}`);
  }
});

test('a rejected transcript path still leaves the delivery logged', async () => {
  const harness = createHarness({
    validateClaudeTranscript: () => { throw new Error('transcript identity mismatch'); }
  });
  const capture = captureConsoleInfo();
  let lines = [];
  try {
    await initialize(harness);
    await harness.service.commitClaudeHookDelivery(delivery({
      deliveryId: deliveryId(7),
      hookEventName: 'SessionStart',
      occurredAt: 1_200
    }));
    lines = capture.lines.filter((line) => line.startsWith('[claude-hook]'));
  } finally {
    capture.restore();
  }
  assert.equal(lines.length, 1, 'the log must not sit inside the transcript-validation branch');
  assert.match(lines[0], /transcript=true/);
});

test('the hook log line shape is stable and path-free for every field combination', () => {
  assert.equal(
    buildClaudeHookLogLine({
      hookEventName: 'SessionEnd',
      sessionId: SESSION_ID,
      schemaVersion: 1,
      terminalApp: null,
      terminalSessionId: null,
      environmentAttribution: false,
      transcript: false
    }),
    `[claude-hook] event=SessionEnd session=${SESSION_ID} schemaVersion=1 `
    + 'terminalIdentity=false terminalApp=none terminalSession=none '
    + 'environmentAttribution=false transcript=false'
  );
  const line = buildClaudeHookLogLine({
    hookEventName: 'SessionStart',
    sessionId: SESSION_ID,
    schemaVersion: 4,
    terminalApp: 'iterm2',
    terminalSessionId: ITERM_SESSION_ID,
    environmentAttribution: true,
    transcript: true
  });
  assert.equal(line.includes('/'), false, `a log line must never carry a path: ${line}`);
});

test('threads held back by the visibility gate are logged once, bounded, with the full count', async () => {
  const harness = createHarness({
    threads: [
      persistedThread({ threadId: VISIBLE_ID, desktopSessionId: `local_${VISIBLE_ID}` }),
      ...HELD_IDS.map((threadId) => persistedThread({ threadId }))
    ]
  });
  const capture = captureConsoleInfo();
  let lines = [];
  let visible = [];
  try {
    await initialize(harness);
    await harness.service.getSnapshot();
    await harness.service.getSnapshot();
    visible = (await harness.service.getSnapshot()).threads.map(({ threadId }) => threadId);
    lines = capture.lines.filter((line) => line.startsWith('[claude-visibility]'));
  } finally {
    capture.restore();
  }
  assert.deepEqual(visible, [VISIBLE_ID], 'the gate itself must keep behaving exactly as before');
  assert.equal(lines.length, 1, 'a steady-state hold must be logged once, not once per snapshot');
  assert.equal(
    lines[0],
    '[claude-visibility] gate=terminal_identity_missing '
    + `held=${HELD_IDS.length} named=${CLAUDE_VISIBILITY_GATE_LOG_ID_LIMIT} `
    + `ids=${HELD_IDS.slice(0, CLAUDE_VISIBILITY_GATE_LOG_ID_LIMIT)
        .map((threadId) => `claude:${threadId}`).join(',')}`
  );
  assert.equal(lines[0].includes('/'), false, 'a log line must never carry a path');
});

test('a thread that gains an identity stops being reported as held', async () => {
  const held = persistedThread({ threadId: HELD_IDS[0] });
  const harness = createHarness({ threads: [held] });
  const capture = captureConsoleInfo();
  let lines = [];
  try {
    await initialize(harness);
    await harness.service.getSnapshot();
    held.iterm2SessionId = ITERM_SESSION_ID;
    await harness.service.getSnapshot();
    lines = capture.lines.filter((line) => line.startsWith('[claude-visibility]'));
  } finally {
    capture.restore();
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`held=1 named=1 ids=claude:${HELD_IDS[0]}$`));
});

test('an empty hold builds no line at all', () => {
  assert.equal(buildClaudeVisibilityGateLogLine([]), null);
});

test.after(() => rmSync(buildRoot, { recursive: true, force: true }));
