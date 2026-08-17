import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-provider-outbox-'));
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-claude-provider-outbox-build-'));
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

const [contract, outbox] = await Promise.all([
  load('contract', 'src/shared/eyesOnAgents/claudeHookBridge.contract.ts'),
  load('outbox', 'src/main/eyesOnAgents/claudeHookOutbox.service.ts')
]);

const installationId = uuid(1);
const delivery = (occurredAt) => {
  const event = contract.createClaudeHookEvent({
    rawInput: {
      hook_event_name: 'Stop',
      session_id: uuid(2),
      transcript_path: `/tmp/${uuid(2)}.jsonl`,
      cwd: '/tmp/project'
    },
    eventId: uuid(3),
    occurredAt
  });
  return { schemaVersion: 1, deliveryId: event.eventId, installationId, event };
};

test('owned-root cleanup removes every generation, is idempotent, and leaves Codex untouched', () => {
  const userData = join(fixtureRoot, 'owned-root');
  const root = contract.getClaudeHookOutboxPath(userData);
  const codexRoot = join(userData, 'eyes-on-agents', 'codex-hook-outbox');
  for (const generation of [uuid(10), uuid(11)]) {
    mkdirSync(join(root, generation, 'pending'), { recursive: true });
    writeFileSync(join(root, generation, 'pending', 'metadata'), generation);
  }
  mkdirSync(codexRoot, { recursive: true });
  writeFileSync(join(codexRoot, 'sentinel'), 'codex');

  outbox.clearClaudeHookOutboxRoot(root);
  assert.equal(existsSync(root), false);
  assert.equal(readFileSync(join(codexRoot, 'sentinel'), 'utf8'), 'codex');
  outbox.clearClaudeHookOutboxRoot(root);
  assert.equal(existsSync(root), false);
});

test('owned-root cleanup rejects a symlink instead of deleting its target', {
  skip: process.platform === 'win32'
}, () => {
  const userData = join(fixtureRoot, 'unsafe-root');
  const root = contract.getClaudeHookOutboxPath(userData);
  const outside = join(fixtureRoot, 'outside');
  mkdirSync(dirname(root), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'sentinel'), 'outside');
  symlinkSync(outside, root);
  assert.throws(() => outbox.clearClaudeHookOutboxRoot(root), /unsafe/);
  assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'outside');
});

test('late helper data keeps original time and is duplicate-ACK drained at the cutoff', async () => {
  const userData = join(fixtureRoot, 'late-helper');
  const root = contract.getClaudeHookOutboxPath(userData);
  const generation = contract.getClaudeHookOutboxPath(userData, installationId);
  mkdirSync(generation, { recursive: true });
  outbox.clearClaudeHookOutboxRoot(root);

  const oldDelivery = delivery(100);
  assert.equal(outbox.persistClaudeHookOutboxDelivery({
    outboxPath: generation,
    delivery: oldDelivery
  }), true, 'a helper already in flight may safely recreate its generation after atomic cleanup');
  let sideEffects = 0;
  const replayed = await outbox.replayClaudeHookOutbox({
    endpoint: { transport: 'unix', path: join(fixtureRoot, 'unused.sock') },
    outboxPath: generation,
    deliver: async (value) => {
      if (value.event.occurredAt > 200) sideEffects += 1;
      return true;
    }
  });
  assert.equal(replayed, 1);
  assert.equal(sideEffects, 0);
  assert.equal(outbox.inspectClaudeHookOutbox(generation).pendingCount, 0);

  writeFileSync(join(generation, 'coverage-gap.emergency'), '100\n');
  const inspection = outbox.inspectClaudeHookOutbox(generation);
  assert.equal(inspection.coverageGap?.firstDetectedAt, 100);
  assert.equal(inspection.coverageGap?.lastDetectedAt, 100,
    'recovery must not restamp a disabled-period emergency gap after the cutoff');
});

test.after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(buildRoot, { recursive: true, force: true });
});
