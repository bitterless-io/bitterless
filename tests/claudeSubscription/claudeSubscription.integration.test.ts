import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { ClaudeAccountRepository } from '../../src/main/claudeSubscription/claudeAccount.repository';
import { ClaudeAccountRouter } from '../../src/main/claudeSubscription/claudeAccount.router';
import { ClaudeCliExecutor } from '../../src/main/claudeSubscription/claudeCli.executor';
import {
  ClaudeResponsesRuntime,
  ClaudeResponsesServer
} from '../../src/main/claudeSubscription/claudeResponses.server';
import { fakeClaudeScript, parseClaudeSse } from './claudeSubscriptionTest.helper';

const accountIds = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002'
] as const;

const createRepository = async (rootDirectory: string, accountCount: number) => {
  let idIndex = 0;
  const repository = new ClaudeAccountRepository({
    rootDirectory,
    isolatedCredentialStorageAvailable: true,
    createId: () => accountIds[idIndex++] ?? accountIds[0]
  });
  await repository.initialize();
  for (let index = 0; index < accountCount; index += 1) {
    const identity = await repository.createIdentity();
    await repository.saveAccount(identity, `Integration account ${index + 1}`, {
      email: `account-${index + 1}@example.com`,
      subscriptionType: 'max'
    });
  }
  return repository;
};

const responsesRequest = (): Record<string, unknown> => ({
  model: 'claude-sonnet',
  stream: true,
  input: 'Reply through the offline integration fixture.'
});

const waitForFile = async (filePath: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}.`);
};

const bounded = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> =>
  await Promise.race([
    promise,
    delay(timeoutMs, undefined, { ref: false }).then(() => {
      throw new Error(`${label} exceeded ${timeoutMs}ms.`);
    })
  ]);

test('real offline core fails over after the first account auth-status timeout', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'bitterless-claude-integration-'));
  const repository = await createRepository(rootDirectory, 2);
  const router = new ClaudeAccountRouter(repository);
  const executor = new ClaudeCliExecutor({
    claudeExecutable: process.execPath,
    commandPrefixArguments: [fakeClaudeScript, 'preflight-hang-first'],
    authStatusTimeoutMs: 250,
    timeoutMs: 2_000
  });
  const runtime = new ClaudeResponsesRuntime(router, executor);
  const server = new ClaudeResponsesServer(router, runtime, { port: 0 });

  try {
    const address = await server.listen();
    const startedAt = Date.now();
    const response = await bounded(
      fetch(`http://${address.host}:${address.port}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(responsesRequest())
      }),
      3_000,
      'Auth failover response'
    );

    assert.equal(response.status, 200);
    const events = parseClaudeSse(await response.text());
    const completed = events.find((event) => event.event === 'response.completed')?.data as {
      response: {
        output: Array<{ content?: Array<{ text?: string }> }>;
      };
    };
    assert.equal(completed.response.output[0]?.content?.[0]?.text, 'hello from fake Claude');
    assert.equal(events.at(-1)?.data, '[DONE]');
    assert.ok(Date.now() - startedAt < 3_000);

    const routing = await repository.listRoutingAccounts();
    assert.equal(routing.find((account) => account.id === accountIds[0])?.needsLogin, true);
    assert.equal(routing.find((account) => account.id === accountIds[1])?.needsLogin, false);
    assert.deepEqual(await router.health(), {
      total: 2,
      enabled: 2,
      eligible: 1,
      busy: 0,
      cooling: 0,
      needsLogin: 1,
      activeRequests: 0
    });
  } finally {
    await server.close();
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('server close boundedly terminates a real executor prompt child', async () => {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'bitterless-claude-close-integration-')
  );
  const markerPath = path.join(rootDirectory, 'prompt-started.marker');
  const repository = await createRepository(rootDirectory, 1);
  const router = new ClaudeAccountRouter(repository);
  const executor = new ClaudeCliExecutor({
    claudeExecutable: process.execPath,
    commandPrefixArguments: [fakeClaudeScript, 'prompt-hang-marker', markerPath],
    authStatusTimeoutMs: 1_000,
    timeoutMs: 10_000
  });
  const runtime = new ClaudeResponsesRuntime(router, executor);
  const server = new ClaudeResponsesServer(router, runtime, { port: 0 });

  try {
    const address = await server.listen();
    const requestSettlement = fetch(`http://${address.host}:${address.port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(responsesRequest())
    }).then(
      async (response) => ({
        kind: 'response' as const,
        status: response.status,
        body: await response.text()
      }),
      (error: unknown) => ({ kind: 'error' as const, error })
    );

    await bounded(waitForFile(markerPath, 2_000), 2_500, 'Prompt child startup');
    assert.equal(router.activeRequests(accountIds[0]), 1);

    const closeStartedAt = Date.now();
    await bounded(server.close(), 2_500, 'Server close');
    assert.ok(Date.now() - closeStartedAt < 2_500);

    const settlement = await bounded(requestSettlement, 1_000, 'Aborted HTTP request');
    assert.equal(settlement.kind, 'error');
    assert.equal(router.activeRequests(accountIds[0]), 0);
    assert.deepEqual(await router.health(), {
      total: 1,
      enabled: 1,
      eligible: 1,
      busy: 0,
      cooling: 0,
      needsLogin: 0,
      activeRequests: 0
    });
  } finally {
    await server.close();
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
