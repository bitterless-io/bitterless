import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-legacy-terminal-build-'));
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const LEGACY_ITERM_SESSION_ID = 'w0t0p0:2EAAC309-9A33-4F6B-A579-E813C968DCF2';

const load = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const contract = await load('contract', 'src/shared/eyesOnAgents/claudeHookBridge.contract');
const helper = await load('helper', 'src/main/eyesOnAgents/claudeHookBridge.helper');

const rawInput = (hookEventName = 'SessionStart') => ({
  hook_event_name: hookEventName,
  session_id: SESSION_ID,
  transcript_path: `/tmp/${SESSION_ID}.jsonl`,
  cwd: '/tmp/project',
});

test('new SessionStart events never capture terminal identity from the process environment', () => {
  for (const createEvent of [contract.createClaudeHookEventV3, contract.createClaudeHookEventV4]) {
    const event = createEvent({
      rawInput: rawInput(),
      eventId: EVENT_ID,
      occurredAt: 100,
      captureUserPrompt: false,
      environment: {
        TERM_PROGRAM: 'iTerm.app',
        ITERM_SESSION_ID: LEGACY_ITERM_SESSION_ID,
      },
    });
    assert.equal(Object.hasOwn(event.payload, 'terminalApp'), false);
    assert.equal(Object.hasOwn(event.payload, 'terminalSessionId'), false);
    assert.deepEqual(contract.parseClaudeHookEvent(event), event);
  }
});

test('V4 keeps CLAUDE_CONFIG_DIR attribution without terminal identity', () => {
  const event = contract.createClaudeHookEventV4({
    rawInput: rawInput(),
    eventId: EVENT_ID,
    occurredAt: 100,
    captureUserPrompt: false,
    environment: {
      TERM_PROGRAM: 'iTerm.app',
      ITERM_SESSION_ID: LEGACY_ITERM_SESSION_ID,
      CLAUDE_CONFIG_DIR: '/tmp/claude-env',
    },
  });
  assert.equal(event.schemaVersion, 4);
  assert.equal(event.payload.claudeConfigDir, '/tmp/claude-env');
  assert.equal(Object.hasOwn(event.payload, 'terminalApp'), false);
  assert.equal(Object.hasOwn(event.payload, 'terminalSessionId'), false);
});

test('legacy V3 terminal fields still parse and survive metadata-only round trips', () => {
  const legacyEvent = {
    schemaVersion: 3,
    eventId: EVENT_ID,
    occurredAt: 100,
    payload: {
      hookEventName: 'SessionStart',
      sessionId: SESSION_ID,
      transcriptPath: `/tmp/${SESSION_ID}.jsonl`,
      cwd: '/tmp/project',
      terminalApp: 'iterm2',
      terminalSessionId: LEGACY_ITERM_SESSION_ID,
    },
  };
  assert.deepEqual(contract.parseClaudeHookEvent(legacyEvent), legacyEvent);

  const metadataOnly = contract.toMetadataOnlyClaudeHookEvent(legacyEvent);
  assert.equal(metadataOnly.payload.terminalApp, 'iterm2');
  assert.equal(metadataOnly.payload.terminalSessionId, LEGACY_ITERM_SESSION_ID);

  const delivery = {
    schemaVersion: 1,
    deliveryId: EVENT_ID,
    installationId: INSTALLATION_ID,
    event: legacyEvent,
  };
  const metadataOnlyDelivery = contract.toMetadataOnlyClaudeHookDelivery(delivery);
  const reparsed = contract.parseClaudeHookMetadataOnlyDelivery(
    JSON.parse(JSON.stringify(metadataOnlyDelivery)),
  );
  assert.equal(reparsed.event.payload.terminalSessionId, LEGACY_ITERM_SESSION_ID);
});

test('legacy terminal fields remain invalid outside a V3/V4 SessionStart', () => {
  const terminalFields = {
    terminalApp: 'iterm2',
    terminalSessionId: LEGACY_ITERM_SESSION_ID,
  };
  assert.throws(() => contract.parseClaudeHookEvent({
    schemaVersion: 2,
    eventId: EVENT_ID,
    occurredAt: 100,
    payload: {
      hookEventName: 'SessionStart',
      sessionId: SESSION_ID,
      transcriptPath: null,
      cwd: null,
      ...terminalFields,
    },
  }), /cannot carry terminal identity fields/);
  assert.throws(() => contract.parseClaudeHookEvent({
    schemaVersion: 3,
    eventId: EVENT_ID,
    occurredAt: 100,
    payload: {
      hookEventName: 'Stop',
      sessionId: SESSION_ID,
      transcriptPath: null,
      cwd: null,
      ...terminalFields,
    },
  }), /only allowed for SessionStart/);
});

test('the real helper subprocess emits no terminal identity', async () => {
  const originalEnvironment = { ...process.env };
  try {
    Object.assign(process.env, {
      TERM_PROGRAM: 'iTerm.app',
      ITERM_SESSION_ID: LEGACY_ITERM_SESSION_ID,
    });
    const sent = [];
    await helper.runClaudeHookHelper([], Readable.from(JSON.stringify(rawInput())), {
      parseArgs: () => ({
        endpoint: { transport: 'unix', path: '/tmp/unused.sock' },
        installationId: INSTALLATION_ID,
        outboxPath: '/tmp/unused-outbox',
      }),
      send: async (_args, delivery) => { sent.push(delivery); return true; },
      persist: () => true,
      now: () => 200,
      idFactory: () => EVENT_ID,
    });
    assert.equal(sent[0].event.schemaVersion, 4);
    assert.equal(Object.hasOwn(sent[0].event.payload, 'terminalApp'), false);
    assert.equal(Object.hasOwn(sent[0].event.payload, 'terminalSessionId'), false);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
  }
});

test.after(() => rmSync(buildRoot, { recursive: true, force: true }));
