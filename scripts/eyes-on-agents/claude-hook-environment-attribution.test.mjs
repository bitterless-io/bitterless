import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-environment-attribution-build-'));
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const VALID_ITERM_SESSION_ID = 'w0t0p0:2EAAC309-9A33-4F6B-A579-E813C968DCF2';
const VALID_CLAUDE_CONFIG_DIR = '/tmp/claude-environments/claude2';

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

const contract = await load('contract', 'src/shared/eyesOnAgents/claudeHookBridge.contract');
const helper = await load('helper', 'src/main/eyesOnAgents/claudeHookBridge.helper');
const serviceModule = await load('service', 'src/main/eyesOnAgents/eyesOnAgents.service');
const { EyesOnAgentsService } = serviceModule;

const rawInput = (hookEventName = 'SessionStart') => ({
  hook_event_name: hookEventName,
  session_id: SESSION_ID,
  transcript_path: `/tmp/${SESSION_ID}.jsonl`,
  cwd: '/tmp/project'
});

const environmentAttribution = { CLAUDE_CONFIG_DIR: VALID_CLAUDE_CONFIG_DIR };

test('SessionStart with a valid CLAUDE_CONFIG_DIR captures the environment attribution as V4', () => {
  const event = contract.createClaudeHookEventV4({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: environmentAttribution
  });
  assert.equal(event.schemaVersion, 4);
  assert.equal(event.payload.claudeConfigDir, VALID_CLAUDE_CONFIG_DIR);
  const parsed = contract.parseClaudeHookEvent(event);
  assert.deepEqual(parsed, event);
});

test('SessionStart with an empty/unset/relative CLAUDE_CONFIG_DIR produces the field-absent shape', () => {
  for (const environment of [{}, { CLAUDE_CONFIG_DIR: '' }, { CLAUDE_CONFIG_DIR: 'relative/claude2' }]) {
    const event = contract.createClaudeHookEventV4({
      rawInput: rawInput('SessionStart'),
      eventId: EVENT_ID,
      occurredAt: 100,
      captureUserPrompt: false,
      environment
    });
    assert.equal(event.schemaVersion, 4);
    assert.equal(Object.hasOwn(event.payload, 'claudeConfigDir'), false);
    contract.parseClaudeHookEvent(event);
  }
});

test('every non-SessionStart event never carries claudeConfigDir, even with CLAUDE_CONFIG_DIR present', () => {
  for (const hookEventName of ['UserPromptSubmit', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd']) {
    const event = contract.createClaudeHookEventV4({
      rawInput: rawInput(hookEventName),
      eventId: EVENT_ID,
      occurredAt: 100,
      captureUserPrompt: false,
      environment: environmentAttribution
    });
    assert.equal(event.schemaVersion, 2, `${hookEventName} must stay on the unchanged V2 wire shape`);
    assert.equal(Object.hasOwn(event.payload, 'claudeConfigDir'), false);
    assert.equal(Object.hasOwn(event.payload, 'terminalApp'), false);
  }
});

test('SessionStart captures terminal identity and environment attribution independently of each other', () => {
  const both = contract.createClaudeHookEventV4({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: {
      TERM_PROGRAM: 'iTerm.app',
      ITERM_SESSION_ID: VALID_ITERM_SESSION_ID,
      CLAUDE_CONFIG_DIR: VALID_CLAUDE_CONFIG_DIR
    }
  });
  assert.equal(both.schemaVersion, 4);
  assert.equal(both.payload.terminalApp, 'iterm2');
  assert.equal(both.payload.terminalSessionId, VALID_ITERM_SESSION_ID);
  assert.equal(both.payload.claudeConfigDir, VALID_CLAUDE_CONFIG_DIR);
  assert.deepEqual(contract.parseClaudeHookEvent(both), both);

  const iterm2Only = contract.createClaudeHookEventV4({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: { TERM_PROGRAM: 'iTerm.app', ITERM_SESSION_ID: VALID_ITERM_SESSION_ID }
  });
  assert.equal(iterm2Only.payload.terminalApp, 'iterm2');
  assert.equal(Object.hasOwn(iterm2Only.payload, 'claudeConfigDir'), false);

  const configDirOnly = contract.createClaudeHookEventV4({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: environmentAttribution
  });
  assert.equal(Object.hasOwn(configDirOnly.payload, 'terminalApp'), false);
  assert.equal(configDirOnly.payload.claudeConfigDir, VALID_CLAUDE_CONFIG_DIR);
});

test('a schemaVersion 4 event carrying claudeConfigDir on a non-SessionStart hookEventName is rejected', () => {
  const sessionStart = contract.createClaudeHookEventV4({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: environmentAttribution
  });
  assert.throws(() => contract.parseClaudeHookEvent({
    ...sessionStart,
    payload: { ...sessionStart.payload, hookEventName: 'Stop' }
  }), /only allowed for SessionStart/);
});

test('schemaVersion 2 and 3 events are rejected if made to carry claudeConfigDir', () => {
  for (const schemaVersion of [2, 3]) {
    assert.throws(() => contract.parseClaudeHookEvent({
      schemaVersion,
      eventId: EVENT_ID,
      occurredAt: 100,
      payload: {
        hookEventName: 'SessionStart',
        sessionId: SESSION_ID,
        transcriptPath: null,
        cwd: null,
        claudeConfigDir: VALID_CLAUDE_CONFIG_DIR
      }
    }), /cannot carry claudeConfigDir/);
  }
});

test('claudeConfigDir is carried through metadata-only conversion unstripped, alongside terminal identity', () => {
  const sessionStart = contract.createClaudeHookEventV4({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: {
      TERM_PROGRAM: 'iTerm.app',
      ITERM_SESSION_ID: VALID_ITERM_SESSION_ID,
      CLAUDE_CONFIG_DIR: VALID_CLAUDE_CONFIG_DIR
    }
  });
  const metadataOnly = contract.toMetadataOnlyClaudeHookEvent(sessionStart);
  assert.equal(metadataOnly.payload.claudeConfigDir, VALID_CLAUDE_CONFIG_DIR);
  assert.equal(metadataOnly.payload.terminalApp, 'iterm2');

  const delivery = {
    schemaVersion: 1,
    deliveryId: EVENT_ID,
    installationId: INSTALLATION_ID,
    event: sessionStart
  };
  const metadataOnlyDelivery = contract.toMetadataOnlyClaudeHookDelivery(delivery);
  assert.equal(metadataOnlyDelivery.event.payload.claudeConfigDir, VALID_CLAUDE_CONFIG_DIR);
  // Round trip through the offline-outbox parser must also preserve the content-free identifiers.
  const reparsed = contract.parseClaudeHookMetadataOnlyDelivery(JSON.parse(JSON.stringify(metadataOnlyDelivery)));
  assert.equal(reparsed.event.payload.claudeConfigDir, VALID_CLAUDE_CONFIG_DIR);
  assert.equal(reparsed.event.payload.terminalApp, 'iterm2');
});

test('V1, V2, and V3 fixtures still parse unchanged alongside the new V4 schema', () => {
  const v1 = contract.createClaudeHookEvent({
    rawInput: rawInput('SessionStart'), eventId: EVENT_ID, occurredAt: 100
  });
  assert.equal(v1.schemaVersion, 1);
  assert.deepEqual(contract.parseClaudeHookEvent(v1), v1);

  const v2 = contract.createClaudeHookEventV2({
    rawInput: { ...rawInput('UserPromptSubmit'), prompt: 'hello' },
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: true
  });
  assert.equal(v2.schemaVersion, 2);
  assert.deepEqual(contract.parseClaudeHookEvent(v2), v2);

  const v3 = contract.createClaudeHookEventV3({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: { TERM_PROGRAM: 'iTerm.app', ITERM_SESSION_ID: VALID_ITERM_SESSION_ID }
  });
  assert.equal(v3.schemaVersion, 3);
  assert.deepEqual(contract.parseClaudeHookEvent(v3), v3);
});

test('the real helper subprocess only emits environment attribution for a genuine SessionStart event', async () => {
  const originalEnvironment = { ...process.env };
  try {
    Object.assign(process.env, environmentAttribution);
    const sent = [];
    await helper.runClaudeHookHelper([], Readable.from(JSON.stringify(rawInput('SessionStart'))), {
      parseArgs: () => ({
        endpoint: { transport: 'unix', path: '/tmp/unused.sock' },
        installationId: INSTALLATION_ID,
        outboxPath: '/tmp/unused-outbox'
      }),
      send: async (_args, delivery) => { sent.push(delivery); return true; },
      persist: () => true,
      now: () => 200,
      idFactory: () => EVENT_ID
    });
    assert.equal(sent[0].event.schemaVersion, 4);
    assert.equal(sent[0].event.payload.claudeConfigDir, VALID_CLAUDE_CONFIG_DIR);

    const promptSent = [];
    await helper.runClaudeHookHelper([], Readable.from(JSON.stringify(rawInput('UserPromptSubmit'))), {
      parseArgs: () => ({
        endpoint: { transport: 'unix', path: '/tmp/unused.sock' },
        installationId: INSTALLATION_ID,
        outboxPath: '/tmp/unused-outbox'
      }),
      send: async (_args, delivery) => { promptSent.push(delivery); return true; },
      persist: () => true,
      now: () => 201,
      idFactory: () => EVENT_ID
    });
    assert.equal(promptSent[0].event.schemaVersion, 2,
      'non-SessionStart events must remain on the unchanged V2 wire shape');
    assert.equal(Object.hasOwn(promptSent[0].event.payload, 'claudeConfigDir'), false);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});

// --- Service/DAO wiring: commitClaudeHookDelivery persists claudeConfigDir and never logs it ---

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
    schemaVersion: 4,
    eventId: params.deliveryId,
    occurredAt: params.occurredAt,
    payload: {
      hookEventName: 'SessionStart',
      sessionId: SESSION_ID,
      transcriptPath: `/tmp/${SESSION_ID}.jsonl`,
      cwd: '/tmp/project',
      ...(params.claudeConfigDir === undefined ? {} : { claudeConfigDir: params.claudeConfigDir })
    }
  }
});

const tick = async () => await new Promise((resolvePromise) => setImmediate(resolvePromise));
const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const createServiceHarness = () => {
  const calls = [];
  const upsertCalls = [];
  const repository = {
    getSnapshot: async () => ({
      domains: [{ id: 1, domainKey: 'uncategorized', title: 'All', sortIndex: 0, isSystem: true }],
      threads: []
    }),
    upsertClaudeInventory: async (params) => {
      upsertCalls.push(params);
      return { changed: true };
    },
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
  return { service, calls, upsertCalls };
};

const initialize = async (harness) => {
  await harness.service.initialize();
  await waitFor(async () => (
    (await harness.service.getSnapshot()).claudeProvider.enabled === true &&
    harness.calls.includes('listener-start')
  ), 'Claude provider activation');
};

const captureConsoleInfo = () => {
  const original = console.info;
  const lines = [];
  console.info = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.info = original; } };
};

test('commitClaudeHookDelivery persists claudeConfigDir and logs only a boolean, never the raw path', async () => {
  const harness = createServiceHarness();
  await initialize(harness);
  const capture = captureConsoleInfo();
  try {
    await harness.service.commitClaudeHookDelivery(delivery({
      deliveryId: '55555555-5555-4555-8555-555555555555',
      occurredAt: 1_000,
      claudeConfigDir: VALID_CLAUDE_CONFIG_DIR
    }));
  } finally {
    capture.restore();
  }
  assert.equal(harness.upsertCalls.length, 1);
  assert.equal(harness.upsertCalls[0].threads[0].claudeConfigDir, VALID_CLAUDE_CONFIG_DIR);
  const logged = capture.lines.join('\n');
  // Task 095 widened this line; the boolean is still the only thing said about CLAUDE_CONFIG_DIR.
  assert.match(logged, /\[claude-hook\] event=SessionStart session=/);
  assert.match(logged, /environmentAttribution=true/);
  assert.equal(logged.includes(VALID_CLAUDE_CONFIG_DIR), false);
});

test('commitClaudeHookDelivery without CLAUDE_CONFIG_DIR persists null and logs environmentAttribution=false', async () => {
  const harness = createServiceHarness();
  await initialize(harness);
  const capture = captureConsoleInfo();
  try {
    await harness.service.commitClaudeHookDelivery(delivery({
      deliveryId: '66666666-6666-4666-8666-666666666666',
      occurredAt: 1_001
    }));
  } finally {
    capture.restore();
  }
  assert.equal(harness.upsertCalls.length, 1);
  assert.equal(harness.upsertCalls[0].threads[0].claudeConfigDir, null);
  const withoutAttribution = capture.lines.join('\n');
  assert.match(withoutAttribution, /\[claude-hook\] event=SessionStart session=/);
  assert.match(withoutAttribution, /environmentAttribution=false/);
});

test.after(() => rmSync(buildRoot, { recursive: true, force: true }));
