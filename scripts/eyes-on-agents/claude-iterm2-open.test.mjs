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
const ITERM2_SESSION_UUID = '2eaac309-9a33-4f6b-a579-e813c968dcf2';
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

const [contractModule, serviceModule, revealModule, logModule] = await Promise.all([
  loadTypeScriptModule('contract', 'src/shared/eyesOnAgents/eyesOnAgents.contract.ts'),
  loadTypeScriptModule('service', 'src/main/eyesOnAgents/eyesOnAgents.service.ts'),
  loadTypeScriptModule('reveal', 'src/main/eyesOnAgents/iterm2Reveal.helper.ts'),
  loadTypeScriptModule('log', 'src/main/eyesOnAgents/claudeIterm2Log.helper.ts')
]);
const { extractEyesOnAgentsIterm2SessionUuid } = contractModule;
const { EyesOnAgentsService } = serviceModule;
const {
  ITERM2_REVEAL_SCRIPT,
  buildIterm2RevealArgs,
  interpretIterm2RevealOutput,
  isIterm2AutomationDenied,
  summarizeIterm2RevealFailure
} = revealModule;
const { logClaudeIterm2Reveal } = logModule;

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

const createHarness = (options = {}) => {
  const calls = [];
  const reveal = options.reveal ?? (async () => 'revealed');
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
    ...(options.withoutReveal === true ? {} : {
      revealIterm2Session: async (sessionUuid) => {
        calls.push(`reveal:${sessionUuid}`);
        return await reveal(sessionUuid);
      }
    }),
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

// Task 094: the stored value stays the full ITERM_SESSION_ID; only its UUID half is a real iTerm2
// session id, so the extraction is what the whole repair turns on.
test('the stored ITERM_SESSION_ID yields its bare UUID and nothing else does', () => {
  assert.equal(extractEyesOnAgentsIterm2SessionUuid(ITERM2_SESSION_ID), ITERM2_SESSION_UUID);
  assert.equal(
    extractEyesOnAgentsIterm2SessionUuid('w12t3p4:2EAAC309-9A33-4F6B-A579-E813C968DCF2'),
    ITERM2_SESSION_UUID,
    'any window/tab/pane prefix is stripped and the UUID is canonicalized lower-case'
  );
  assert.equal(
    extractEyesOnAgentsIterm2SessionUuid(ITERM2_SESSION_UUID),
    null,
    'a bare UUID is not a stored ITERM_SESSION_ID and must not be mistaken for one'
  );
  for (const invalid of [
    null,
    undefined,
    42,
    '',
    'w0t0p0:not-a-uuid-at-all-not-a-uuid-at-all',
    `w0t0p0:${ITERM2_SESSION_UUID} `,
    `wxtypz:${ITERM2_SESSION_UUID}`
  ]) {
    assert.equal(
      extractEyesOnAgentsIterm2SessionUuid(invalid),
      null,
      `must not derive a UUID from ${JSON.stringify(invalid)}`
    );
  }
});

// The defect that made this action inert twice over: iTerm2 has no working reveal URL, and the
// value it was handed was the prefixed ITERM_SESSION_ID rather than a session id at all.
test('no iTerm2 URL builder survives and the reveal script never carries the id', () => {
  assert.equal(
    contractModule.buildEyesOnAgentsIterm2DeepLink,
    undefined,
    'iterm2:///reveal is not a real iTerm2 capability; its builder must not exist'
  );
  const args = buildIterm2RevealArgs(ITERM2_SESSION_UUID);
  assert.deepEqual(args, ['-e', ITERM2_REVEAL_SCRIPT, ITERM2_SESSION_UUID]);
  assert.equal(
    ITERM2_REVEAL_SCRIPT.includes(ITERM2_SESSION_UUID),
    false,
    'the session id must reach osascript as argv, never interpolated into the script text'
  );
  assert.match(ITERM2_REVEAL_SCRIPT, /on run argv/);
  assert.match(ITERM2_REVEAL_SCRIPT, /set targetId to item 1 of argv/);
  assert.match(ITERM2_REVEAL_SCRIPT, /is running/,
    'a bare tell would launch iTerm2; nothing may be raised when there is no match');
  assert.match(ITERM2_REVEAL_SCRIPT, /select w[\s\S]*select t[\s\S]*select s/);
  assert.throws(
    () => buildIterm2RevealArgs(ITERM2_SESSION_ID),
    /iTerm2 session UUID must be a UUID/,
    'the prefixed ITERM_SESSION_ID is re-rejected at the process boundary'
  );
  assert.throws(() => buildIterm2RevealArgs('"; do shell script "id'), /must be a UUID/);
});

test('the reveal outcome is read from the script token and -1743 is read as denied', () => {
  assert.equal(interpretIterm2RevealOutput('bitterless-iterm2-reveal:revealed\n'), 'revealed');
  assert.equal(interpretIterm2RevealOutput('bitterless-iterm2-reveal:not_found\n'), 'not_found');
  assert.throws(() => interpretIterm2RevealOutput('anything else'), /unrecognized reveal result/);
  const denied = Object.assign(new Error('Command failed: osascript -e ...'), {
    stderr: 'execution error: Not authorized to send Apple events to iTerm2. (-1743)\n'
  });
  assert.equal(isIterm2AutomationDenied(denied), true);
  assert.equal(isIterm2AutomationDenied(new Error('errAEEventNotPermitted')), true);
  assert.equal(
    isIterm2AutomationDenied(Object.assign(new Error('nope'), { stderr: 'error (-1728)\n' })),
    false,
    'a missing object is not a permission failure'
  );
  // execFile echoes the whole command (script + UUID) into its message, so matching the message
  // would misread any failure whose UUID happens to contain `-1743` as a permission denial.
  assert.equal(
    isIterm2AutomationDenied(Object.assign(
      new Error('Command failed: osascript -e on run argv deadbeef-1743-4ead-8ead-deadbeefdead'),
      { stderr: 'execution error: iTerm got an error (-1728)\n' }
    )),
    false,
    'a UUID containing -1743 must never be read as a denied Apple Event'
  );
  assert.equal(
    isIterm2AutomationDenied(new Error(
      'Command failed: osascript -e on run argv deadbeef-1743-4ead-8ead-deadbeefdead'
    )),
    false,
    'the command echo is collapsed before matching, even with no stderr at all'
  );
  const summary = summarizeIterm2RevealFailure(Object.assign(new Error('Command failed: x'), {
    stderr: 'execution error: iTerm got an error: some detail (-1728)\nsecond line\n'
  }));
  assert.equal(summary, 'iTerm2 could not be scripted: execution error: iTerm got an error: '
    + 'some detail (-1728)');
  assert.equal(
    summary.includes('Command failed'),
    false,
    'the failure summary must never echo the command line back'
  );
  const timedOut = Object.assign(new Error('Command failed: osascript -e on run argv'), {
    stderr: '',
    killed: true
  });
  assert.equal(
    summarizeIterm2RevealFailure(timedOut),
    'iTerm2 could not be scripted: osascript timed out'
  );
  assert.equal(
    summarizeIterm2RevealFailure(new Error('spawn osascript ENOENT')),
    'iTerm2 could not be scripted: spawn osascript ENOENT'
  );
});

test('openThreadInIterm2 reveals the pane by UUID, marks opened, and notifies', async () => {
  const harness = createHarness();
  await initializeAndWaitEnabled(harness);
  harness.calls.length = 0;
  const sessionKey = `claude:${CLAUDE_ITERM2_ONLY_ID}`;
  const result = await harness.service.openThreadInIterm2({ sessionKey });
  assert.deepEqual(Object.keys(result), ['snapshot'],
    'there is no URL to return: the transport is AppleScript, not a deep link');
  assert.deepEqual(harness.calls, [
    `reveal:${ITERM2_SESSION_UUID}`,
    `opened:${sessionKey}`,
    'broadcast'
  ]);
  assert.equal(
    harness.calls.some((call) => call.startsWith('open:')),
    false,
    'openThreadInIterm2 must never open a URL through the shell'
  );
  assert.equal(
    harness.calls.some((call) => call.startsWith('sync-status:')),
    false,
    'openThreadInIterm2 must never run the Codex-only status sync'
  );
});

test('a session that is gone reports not_found and never marks the thread opened', async () => {
  const harness = createHarness({ reveal: async () => 'not_found' });
  await initializeAndWaitEnabled(harness);
  harness.calls.length = 0;
  await assert.rejects(
    () => harness.service.openThreadInIterm2({ sessionKey: `claude:${CLAUDE_ITERM2_ONLY_ID}` }),
    /no longer open/
  );
  assert.deepEqual(harness.calls, [`reveal:${ITERM2_SESSION_UUID}`],
    'a pane that is gone must not mark the thread opened or broadcast success');
});

test('a denied Apple Event is a distinct, actionable failure and never marks opened', async () => {
  const harness = createHarness({ reveal: async () => 'denied' });
  await initializeAndWaitEnabled(harness);
  harness.calls.length = 0;
  await assert.rejects(
    () => harness.service.openThreadInIterm2({ sessionKey: `claude:${CLAUDE_ITERM2_ONLY_ID}` }),
    /Privacy & Security > Automation/
  );
  assert.deepEqual(harness.calls, [`reveal:${ITERM2_SESSION_UUID}`]);
});

test('an osascript failure propagates and never marks the thread opened', async () => {
  const failure = new Error('iTerm2 could not be scripted: execution error (-1728)');
  const harness = createHarness({
    reveal: async () => {
      throw failure;
    }
  });
  await initializeAndWaitEnabled(harness);
  harness.calls.length = 0;
  await assert.rejects(
    () => harness.service.openThreadInIterm2({ sessionKey: `claude:${CLAUDE_ITERM2_ONLY_ID}` }),
    (error) => error === failure
  );
  assert.deepEqual(harness.calls, [`reveal:${ITERM2_SESSION_UUID}`]);
});

test('a runtime with no reveal transport fails loudly instead of reporting success', async () => {
  const harness = createHarness({ withoutReveal: true });
  await initializeAndWaitEnabled(harness);
  harness.calls.length = 0;
  await assert.rejects(
    () => harness.service.openThreadInIterm2({ sessionKey: `claude:${CLAUDE_ITERM2_ONLY_ID}` }),
    /not available in this runtime/
  );
  assert.deepEqual(harness.calls, []);
});

// The attempt was invisible in main.log, which is why a completely inert action survived a review
// and a test suite. The log line is part of the contract now.
test('every reveal attempt and outcome is logged by session id, never by path', () => {
  const info = [];
  const errors = [];
  const logger = { info: (line) => info.push(line), error: (line) => errors.push(line) };
  const sessionKey = `claude:${CLAUDE_ITERM2_ONLY_ID}`;
  for (const stage of ['attempt', 'revealed', 'not_found']) {
    logClaudeIterm2Reveal({ stage, sessionKey, sessionUuid: ITERM2_SESSION_UUID, logger });
  }
  assert.deepEqual(info, [
    `[claude-iterm2] action=reveal stage=attempt id=${sessionKey} session=${ITERM2_SESSION_UUID}`,
    `[claude-iterm2] action=reveal stage=revealed id=${sessionKey} session=${ITERM2_SESSION_UUID}`,
    `[claude-iterm2] action=reveal stage=not_found id=${sessionKey} session=${ITERM2_SESSION_UUID}`
  ]);
  logClaudeIterm2Reveal({
    stage: 'denied',
    sessionKey,
    sessionUuid: ITERM2_SESSION_UUID,
    error: new Error('Not authorized to send Apple events to iTerm2. (-1743)'),
    logger
  });
  logClaudeIterm2Reveal({
    stage: 'failed',
    sessionKey,
    sessionUuid: null,
    error: new Error(`x${'y'.repeat(600)}`),
    logger
  });
  assert.equal(errors.length, 2, 'denied and failed are logged at error level');
  assert.equal(
    errors[0],
    `[claude-iterm2] action=reveal stage=denied id=${sessionKey} `
    + `session=${ITERM2_SESSION_UUID} error=Not authorized to send Apple events to iTerm2. (-1743)`
  );
  assert.match(errors[1], / session=none error=xy{299}$/,
    'a missing UUID reads as none and the error text is length-bounded');
  for (const line of [...info, ...errors]) {
    assert.equal(line.includes('/'), false, `a log line must never carry a path: ${line}`);
  }
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
