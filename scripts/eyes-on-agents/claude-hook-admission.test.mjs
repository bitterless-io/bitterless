import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-admission-'));
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-hook-admission-build-'));
const uuid = (index) => (
  `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
);

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

const [contract, outbox, bridge] = await Promise.all([
  load('contract', 'src/shared/eyesOnAgents/claudeHookBridge.contract.ts'),
  load('outbox', 'src/main/eyesOnAgents/claudeHookOutbox.service.ts'),
  load('bridge', 'src/main/eyesOnAgents/claudeHookBridge.server.ts')
]);
const installationId = uuid(1);
const delivery = (index, occurredAt) => {
  const event = contract.createClaudeHookEvent({
    rawInput: {
      hook_event_name: 'UserPromptSubmit',
      session_id: uuid(100 + index),
      transcript_path: `/tmp/${uuid(100 + index)}.jsonl`,
      cwd: '/tmp/project'
    },
    eventId: uuid(1_000 + index),
    occurredAt
  });
  return { schemaVersion: 1, deliveryId: event.eventId, installationId, event };
};

test('deferred admission replays durable backlog before opening live intake', async () => {
  const socketPath = join(fixtureRoot, 'ordered.sock');
  const outboxPath = join(fixtureRoot, 'ordered-outbox');
  assert.equal(outbox.persistClaudeHookOutboxDelivery({
    outboxPath,
    delivery: delivery(1, 10)
  }), true);
  const consumed = [];
  const origins = [];
  const server = new bridge.ClaudeHookBridgeServer();
  await server.start({
    endpoint: { transport: 'unix', path: socketPath },
    installationId,
    outboxPath,
    deferReplay: true,
    canArm: () => true,
    consume: async (value) => {
      consumed.push(value.event.occurredAt);
      return { duplicate: false };
    },
    onCommitted: ({ origin }) => origins.push(origin)
  });
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(2, 20)
  ), false, 'an unarmed listener must not ACK a live frame');
  assert.deepEqual(consumed, []);
  await server.replayOutbox();
  assert.deepEqual(consumed, [10, 20]);
  assert.deepEqual(origins, ['outbox_replay', 'outbox_replay']);
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(3, 30)
  ), true);
  assert.deepEqual(consumed, [10, 20, 30]);
  await server.stop();
});

test('coverage revocation precedes replay and permanently keeps that listener unarmed', async () => {
  const socketPath = join(fixtureRoot, 'gap.sock');
  const outboxPath = join(fixtureRoot, 'gap-outbox');
  outbox.inspectClaudeHookOutbox(outboxPath);
  writeFileSync(join(outboxPath, 'coverage-gap.json'), `${JSON.stringify({
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 40,
    lastDetectedAt: 40,
    occurrences: 1
  })}\n`);
  let intake = true;
  const order = [];
  const server = new bridge.ClaudeHookBridgeServer();
  await server.start({
    endpoint: { transport: 'unix', path: socketPath },
    installationId,
    outboxPath,
    deferReplay: true,
    canArm: () => intake,
    consume: async () => {
      if (!intake) throw new Error('intake revoked');
      order.push('consume');
      return { duplicate: false };
    },
    onCoverageGap: async () => {
      intake = false;
      order.push('gap');
    }
  });
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(4, 50)
  ), false);
  await server.replayOutbox();
  assert.deepEqual(order, ['gap']);
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(5, 60)
  ), false, 'a listener with a persistent coverage gap must never arm live intake');
  await server.replayOutbox();
  assert.deepEqual(order, ['gap']);
  await server.stop();
});

test('an ignored pre-cutoff gap does not block valid post-cutoff live admission', async () => {
  const socketPath = join(fixtureRoot, 'old-gap.sock');
  const outboxPath = join(fixtureRoot, 'old-gap-outbox');
  assert.equal(outbox.persistClaudeHookOutboxDelivery({
    outboxPath,
    delivery: delivery(7, 80)
  }), true);
  writeFileSync(join(outboxPath, 'coverage-gap.json'), `${JSON.stringify({
    schemaVersion: 1,
    reasons: ['storage_unavailable'],
    firstDetectedAt: 70,
    lastDetectedAt: 70,
    occurrences: 1
  })}\n`);
  const order = [];
  const server = new bridge.ClaudeHookBridgeServer();
  await server.start({
    endpoint: { transport: 'unix', path: socketPath },
    installationId,
    outboxPath,
    deferReplay: true,
    canArm: () => true,
    consume: async (value) => {
      order.push(`consume:${value.event.occurredAt}`);
      return { duplicate: value.event.occurredAt <= 80 };
    },
    onCoverageGap: async () => { order.push('ignored-gap'); }
  });
  await server.replayOutbox();
  assert.deepEqual(order, ['ignored-gap', 'consume:80']);
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(8, 90)
  ), true);
  assert.deepEqual(order, ['ignored-gap', 'consume:80', 'consume:90']);
  await server.stop();
});

test('an unavailable deferred outbox only rejects the socket and cannot crash the listener', async () => {
  const socketPath = join(fixtureRoot, 'blocked.sock');
  const outboxPath = join(fixtureRoot, 'blocked-outbox');
  writeFileSync(outboxPath, 'not-a-directory');
  const server = new bridge.ClaudeHookBridgeServer();
  await server.start({
    endpoint: { transport: 'unix', path: socketPath },
    installationId,
    outboxPath,
    deferReplay: true,
    canArm: () => false,
    consume: async () => { throw new Error('must not consume'); }
  });
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(6, 70)
  ), false);
  assert.equal(server.isListening(), true);
  await server.stop();
});

test('a failed durable replay keeps live admission closed and leaves the backlog recoverable', async (t) => {
  const socketPath = join(fixtureRoot, 'fail.sock');
  const outboxPath = join(fixtureRoot, 'fail-outbox');
  assert.equal(outbox.persistClaudeHookOutboxDelivery({
    outboxPath,
    delivery: delivery(9, 100)
  }), true);
  const consumed = [];
  const server = new bridge.ClaudeHookBridgeServer();
  t.after(async () => await server.stop());
  await server.start({
    endpoint: { transport: 'unix', path: socketPath },
    installationId,
    outboxPath,
    deferReplay: true,
    canArm: () => true,
    consume: async (value) => {
      consumed.push(value.event.occurredAt);
      throw new Error('SQLite unavailable');
    }
  });
  await assert.rejects(
    server.replayOutbox(),
    /could not commit the existing backlog/
  );
  assert.deepEqual(consumed, [100]);
  assert.equal(outbox.inspectClaudeHookOutbox(outboxPath).pendingCount, 1);
  assert.equal(await outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(10, 110)
  ), false, 'live delivery cannot be ACKed after replay failure');
  assert.equal(consumed.includes(110), false);
});

test('stopping joins an admitted commit without sending a late live acknowledgement', async () => {
  const socketPath = join(fixtureRoot, 'join.sock');
  const outboxPath = join(fixtureRoot, 'join-outbox');
  let releaseCommit;
  let markCommitEntered;
  const commitGate = new Promise((resolvePromise) => { releaseCommit = resolvePromise; });
  const commitEntered = new Promise((resolvePromise) => { markCommitEntered = resolvePromise; });
  const consumed = [];
  const server = new bridge.ClaudeHookBridgeServer();
  await server.start({
    endpoint: { transport: 'unix', path: socketPath },
    installationId,
    outboxPath,
    consume: async (value) => {
      consumed.push(value.event.occurredAt);
      markCommitEntered();
      await commitGate;
      return { duplicate: false };
    }
  });
  const acknowledged = outbox.sendClaudeHookDelivery(
    { transport: 'unix', path: socketPath }, delivery(11, 120)
  );
  await commitEntered;
  const stopped = server.stop();
  releaseCommit();
  await stopped;
  assert.equal(await acknowledged, false);
  assert.deepEqual(consumed, [120]);
});

test.after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
});
