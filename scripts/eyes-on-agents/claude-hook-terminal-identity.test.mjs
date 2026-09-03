import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-terminal-identity-build-'));
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const VALID_ITERM_SESSION_ID = 'w0t0p0:2EAAC309-9A33-4F6B-A579-E813C968DCF2';

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

const rawInput = (hookEventName = 'SessionStart') => ({
  hook_event_name: hookEventName,
  session_id: SESSION_ID,
  transcript_path: `/tmp/${SESSION_ID}.jsonl`,
  cwd: '/tmp/project'
});

const iterm2Environment = { TERM_PROGRAM: 'iTerm.app', ITERM_SESSION_ID: VALID_ITERM_SESSION_ID };

test('SessionStart inside iTerm2 captures the validated terminal identity as V3', () => {
  const event = contract.createClaudeHookEventV3({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: iterm2Environment
  });
  assert.equal(event.schemaVersion, 3);
  assert.equal(event.payload.terminalApp, 'iterm2');
  assert.equal(event.payload.terminalSessionId, VALID_ITERM_SESSION_ID);
  const parsed = contract.parseClaudeHookEvent(event);
  assert.deepEqual(parsed, event);
});

test('SessionStart outside iTerm2 (TERM_PROGRAM unset or different) produces the field-absent shape', () => {
  for (const environment of [{}, { TERM_PROGRAM: 'Apple_Terminal', ITERM_SESSION_ID: VALID_ITERM_SESSION_ID }]) {
    const event = contract.createClaudeHookEventV3({
      rawInput: rawInput('SessionStart'),
      eventId: EVENT_ID,
      occurredAt: 100,
      captureUserPrompt: false,
      environment
    });
    assert.equal(event.schemaVersion, 3);
    assert.equal(Object.hasOwn(event.payload, 'terminalApp'), false);
    assert.equal(Object.hasOwn(event.payload, 'terminalSessionId'), false);
    contract.parseClaudeHookEvent(event);
  }
});

test('SessionStart with a malformed ITERM_SESSION_ID produces the field-absent shape without throwing', () => {
  for (const malformed of ['not-a-session-id', 'w0t0p0:short', '', undefined]) {
    const event = contract.createClaudeHookEventV3({
      rawInput: rawInput('SessionStart'),
      eventId: EVENT_ID,
      occurredAt: 100,
      captureUserPrompt: false,
      environment: { TERM_PROGRAM: 'iTerm.app', ITERM_SESSION_ID: malformed }
    });
    assert.equal(event.schemaVersion, 3);
    assert.equal(Object.hasOwn(event.payload, 'terminalApp'), false);
    assert.equal(Object.hasOwn(event.payload, 'terminalSessionId'), false);
  }
});

test('every non-SessionStart event never carries terminal fields, even with ITERM_SESSION_ID present', () => {
  for (const hookEventName of ['UserPromptSubmit', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd']) {
    const event = contract.createClaudeHookEventV3({
      rawInput: rawInput(hookEventName),
      eventId: EVENT_ID,
      occurredAt: 100,
      captureUserPrompt: false,
      environment: iterm2Environment
    });
    assert.equal(event.schemaVersion, 2, `${hookEventName} must stay on the unchanged V2 wire shape`);
    assert.equal(Object.hasOwn(event.payload, 'terminalApp'), false);
    assert.equal(Object.hasOwn(event.payload, 'terminalSessionId'), false);
  }
});

test('a schemaVersion 3 event carrying terminal fields on a non-SessionStart hookEventName is rejected', () => {
  const sessionStart = contract.createClaudeHookEventV3({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: iterm2Environment
  });
  assert.throws(() => contract.parseClaudeHookEvent({
    ...sessionStart,
    payload: { ...sessionStart.payload, hookEventName: 'Stop' }
  }), /only allowed for SessionStart/);
});

test('a schemaVersion 2 event is rejected if it is made to carry terminal fields', () => {
  assert.throws(() => contract.parseClaudeHookEvent({
    schemaVersion: 2,
    eventId: EVENT_ID,
    occurredAt: 100,
    payload: {
      hookEventName: 'SessionStart',
      sessionId: SESSION_ID,
      transcriptPath: null,
      cwd: null,
      terminalApp: 'iterm2',
      terminalSessionId: VALID_ITERM_SESSION_ID
    }
  }), /cannot carry terminal identity fields/);
});

test('terminalApp/terminalSessionId are carried through metadata-only conversion unstripped', () => {
  const sessionStart = contract.createClaudeHookEventV3({
    rawInput: rawInput('SessionStart'),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: iterm2Environment
  });
  const metadataOnly = contract.toMetadataOnlyClaudeHookEvent(sessionStart);
  assert.equal(metadataOnly.payload.terminalApp, 'iterm2');
  assert.equal(metadataOnly.payload.terminalSessionId, VALID_ITERM_SESSION_ID);

  const delivery = {
    schemaVersion: 1,
    deliveryId: EVENT_ID,
    installationId: INSTALLATION_ID,
    event: sessionStart
  };
  const metadataOnlyDelivery = contract.toMetadataOnlyClaudeHookDelivery(delivery);
  assert.equal(metadataOnlyDelivery.event.payload.terminalApp, 'iterm2');
  assert.equal(metadataOnlyDelivery.event.payload.terminalSessionId, VALID_ITERM_SESSION_ID);
  // Round trip through the offline-outbox parser must also preserve the content-free identity.
  const reparsed = contract.parseClaudeHookMetadataOnlyDelivery(JSON.parse(JSON.stringify(metadataOnlyDelivery)));
  assert.equal(reparsed.event.payload.terminalApp, 'iterm2');
  assert.equal(reparsed.event.payload.terminalSessionId, VALID_ITERM_SESSION_ID);
});

test('V1 and V2 fixtures still parse unchanged alongside the new V3 schema', () => {
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
  assert.equal(v2.payload.userPromptPreview, 'hello');
  assert.deepEqual(contract.parseClaudeHookEvent(v2), v2);
});

test('the real helper subprocess only emits terminal identity for a SessionStart event inside iTerm2', async () => {
  const originalEnvironment = { ...process.env };
  try {
    Object.assign(process.env, iterm2Environment);
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
    // Task 087 wired the real helper subprocess to createClaudeHookEventV4, so a genuine
    // SessionStart now legitimately reports schemaVersion 4 (still carrying the unchanged terminal
    // identity capture below) — see docs/plan/tasks/eyes-on-agents-claude-multi-env-hook-attribution-087.md.
    assert.equal(sent[0].event.schemaVersion, 4);
    assert.equal(sent[0].event.payload.terminalApp, 'iterm2');
    assert.equal(sent[0].event.payload.terminalSessionId, VALID_ITERM_SESSION_ID);

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
    assert.equal(Object.hasOwn(promptSent[0].event.payload, 'terminalApp'), false);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});

test.after(() => rmSync(buildRoot, { recursive: true, force: true }));
