import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-prompt-build-'));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-prompt-'));
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';

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

const contract = await load('contract', 'src/shared/eyesOnAgents/claudeHookBridge.contract.ts');
const helper = await load('helper', 'src/main/eyesOnAgents/claudeHookBridge.helper.ts');
const outbox = await load('outbox', 'src/main/eyesOnAgents/claudeHookOutbox.service.ts');
const bridge = await load('bridge', 'src/main/eyesOnAgents/claudeHookBridge.server.ts');
const preference = await load(
  'preference',
  'src/main/eyesOnAgents/lastUserPromptPreference.service.ts'
);

const rawInput = (hookEventName = 'UserPromptSubmit', prompt = '  最新问题 🌏  ') => ({
  hook_event_name: hookEventName,
  session_id: SESSION_ID,
  transcript_path: `/tmp/${SESSION_ID}.jsonl`,
  cwd: '/tmp/project',
  prompt
});

test('Claude Hook V2 allowlists only a bounded UserPromptSubmit preview', () => {
  const legacy = contract.createClaudeHookEvent({
    rawInput: rawInput(), eventId: EVENT_ID, occurredAt: 100
  });
  assert.equal(contract.parseClaudeHookEvent(legacy).schemaVersion, 1);
  assert.equal(JSON.stringify(legacy).includes('最新问题'), false);

  const event = contract.createClaudeHookEventV2({
    rawInput: rawInput(), eventId: EVENT_ID, occurredAt: 100, captureUserPrompt: true
  });
  assert.equal(event.payload.userPromptPreview, '最新问题 🌏');
  assert.equal(event.payload.userPromptTruncated, false);

  const exactBoundary = `${'a'.repeat(contract.CLAUDE_HOOK_USER_PROMPT_MAX_BYTES - 4)}🌏`;
  const bounded = contract.boundClaudeHookUserPrompt(`${exactBoundary}b`);
  assert.equal(Buffer.byteLength(bounded.userPromptPreview), contract.CLAUDE_HOOK_USER_PROMPT_MAX_BYTES);
  assert.equal(bounded.userPromptTruncated, true);
  assert.equal(bounded.userPromptPreview.endsWith('🌏'), true);

  for (const invalid of ['', '   ', 'secret\0tail', '\ud800']) {
    assert.equal(contract.boundClaudeHookUserPrompt(invalid), null);
  }
  const stop = contract.createClaudeHookEventV2({
    rawInput: rawInput('Stop', 'assistant output'),
    eventId: EVENT_ID,
    occurredAt: 101,
    captureUserPrompt: true
  });
  assert.equal(Object.hasOwn(stop.payload, 'userPromptPreview'), false);
  assert.throws(() => contract.parseClaudeHookEvent({
    ...stop,
    payload: { ...stop.payload, userPromptPreview: 'forbidden', userPromptTruncated: false }
  }), /only allowed for UserPromptSubmit/);
});

test('Claude helper checks its sibling marker and strips prompt before every offline write', async () => {
  const outboxPath = join(
    fixtureRoot,
    'eyes-on-agents',
    'claude-hook-outbox',
    INSTALLATION_ID
  );
  mkdirSync(outboxPath, { recursive: true });
  writeFileSync(join(fixtureRoot, 'eyes-on-agents', 'claude-last-user-prompt.enabled'), '');
  const sent = [];
  const persisted = [];
  await helper.runClaudeHookHelper([], Readable.from(JSON.stringify(rawInput())), {
    parseArgs: () => ({
      endpoint: { transport: 'unix', path: '/tmp/unused.sock' },
      installationId: INSTALLATION_ID,
      outboxPath
    }),
    send: async (_args, delivery) => {
      sent.push(delivery);
      return false;
    },
    persist: ({ delivery }) => {
      persisted.push(delivery);
      return true;
    },
    now: () => 200,
    idFactory: () => EVENT_ID
  });
  assert.equal(sent[0].event.payload.userPromptPreview, '最新问题 🌏');
  assert.equal(JSON.stringify(persisted).includes('最新问题'), false);
  assert.equal(persisted[0].event.schemaVersion, 2);
  assert.equal(persisted[0].event.payload.hookEventName, 'UserPromptSubmit');

  const durablePath = join(fixtureRoot, 'durable-outbox');
  assert.equal(outbox.persistClaudeHookOutboxDelivery({
    outboxPath: durablePath,
    delivery: sent[0]
  }), true);
  const [name] = readdirSync(join(durablePath, 'pending'));
  const durableContent = readFileSync(join(durablePath, 'pending', name), 'utf8');
  assert.equal(durableContent.includes('最新问题'), false);
  assert.equal(
    contract.parseClaudeHookMetadataOnlyDelivery(JSON.parse(durableContent)).event.schemaVersion,
    2
  );
});

test('escape-heavy 8192-byte preview crosses the larger live frame but stays out of offline files', async () => {
  const prompt = '\u0001'.repeat(contract.CLAUDE_HOOK_USER_PROMPT_MAX_BYTES);
  const event = contract.createClaudeHookEventV2({
    rawInput: rawInput('UserPromptSubmit', prompt),
    eventId: EVENT_ID,
    occurredAt: 300,
    captureUserPrompt: true
  });
  const delivery = {
    schemaVersion: 1,
    deliveryId: EVENT_ID,
    installationId: INSTALLATION_ID,
    event
  };
  const liveBytes = Buffer.byteLength(`${JSON.stringify(delivery)}\n`);
  assert(liveBytes > contract.CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES);
  assert(liveBytes <= contract.CLAUDE_HOOK_LIVE_MAX_FRAME_BYTES);

  const socketPath = join(fixtureRoot, 'escape-heavy.sock');
  const server = new bridge.ClaudeHookBridgeServer();
  let receivedPreview = null;
  await server.start({
    endpoint: { transport: 'unix', path: socketPath },
    installationId: INSTALLATION_ID,
    outboxPath: join(fixtureRoot, 'escape-server-outbox'),
    consume: async (received) => {
      receivedPreview = received.event.payload.userPromptPreview;
      return { duplicate: false };
    }
  });
  assert.equal(
    await outbox.sendClaudeHookDelivery({ transport: 'unix', path: socketPath }, delivery),
    true
  );
  assert.equal(receivedPreview, prompt);
  await server.stop();

  const durablePath = join(fixtureRoot, 'escape-durable-outbox');
  assert.equal(outbox.persistClaudeHookOutboxDelivery({
    outboxPath: durablePath,
    delivery
  }), true);
  const [name] = readdirSync(join(durablePath, 'pending'));
  const durableContent = readFileSync(join(durablePath, 'pending', name), 'utf8');
  assert(Buffer.byteLength(durableContent) <= contract.CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES);
  assert.equal(durableContent.includes('userPromptPreview'), false);
  contract.parseClaudeHookMetadataOnlyDelivery(JSON.parse(durableContent));
});

test('Claude and Codex prompt markers remain separate and default off', () => {
  const userDataPath = join(fixtureRoot, 'preference');
  const codex = new preference.LastUserPromptPreferenceService(userDataPath);
  const claude = new preference.LastUserPromptPreferenceService(userDataPath, 'claude');
  assert.equal(codex.isEnabled(), false);
  assert.equal(claude.isEnabled(), false);
  assert.equal(claude.enable(), true);
  assert.equal(codex.isEnabled(), false);
  assert.equal(claude.isEnabled(), true);
  assert.equal(claude.disable(), true);
});

test.after(() => {
  rmSync(buildRoot, { recursive: true, force: true });
  rmSync(fixtureRoot, { recursive: true, force: true });
});
