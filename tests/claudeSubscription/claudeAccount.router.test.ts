import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeAccountRouter } from '../../src/main/claudeSubscription/claudeAccount.router';
import type { ClaudeAccountExecutionContext } from '../../src/main/claudeSubscription/claudeAccount.repository';
import type {
  ClaudeExecutionRequest,
  ClaudeExecutionResult,
  ClaudeExecutor
} from '../../src/main/claudeSubscription/claudeCli.executor';
import {
  ClaudeAuthenticationError,
  ClaudeDecisionError,
  ClaudeNoEligibleAccountError,
  ClaudeRequestAbortedError,
  ClaudeUsageLimitError
} from '../../src/main/claudeSubscription/claudeSubscription.errors';
import { ClaudeResponsesRuntime } from '../../src/main/claudeSubscription/claudeResponses.server';
import { parseClaudeResponsesRequest } from '../../src/main/claudeSubscription/claudeResponses.translator';
import { FakeClaudeAccountSource } from './claudeSubscriptionTest.helper';

class FunctionExecutor implements ClaudeExecutor {
  calls = 0;

  constructor(
    private readonly implementation: (
      request: ClaudeExecutionRequest,
      options?: { signal?: AbortSignal }
    ) => Promise<ClaudeExecutionResult>
  ) {}

  execute(
    request: ClaudeExecutionRequest,
    options?: { signal?: AbortSignal }
  ): Promise<ClaudeExecutionResult> {
    this.calls += 1;
    return this.implementation(request, options);
  }
}

const request = () =>
  parseClaudeResponsesRequest({
    model: 'claude-sonnet',
    stream: true,
    input: 'Say hello.',
    prompt_cache_key: 'thread-a'
  });

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

class DeferredContextSource extends FakeClaudeAccountSource {
  readonly contextRequested = createDeferred<void>();
  readonly deferredContext = createDeferred<ClaudeAccountExecutionContext | null>();
  #didDefer = false;

  override async getExecutionContext(
    accountId: string
  ): Promise<ClaudeAccountExecutionContext | null> {
    if (accountId === 'account-a' && !this.#didDefer) {
      this.#didDefer = true;
      this.contextRequested.resolve();
      return await this.deferredContext.promise;
    }
    return await super.getExecutionContext(accountId);
  }
}

test('routes least-active ties round-robin and keeps cache keys sticky', async () => {
  const source = new FakeClaudeAccountSource();
  const router = new ClaudeAccountRouter(source, { now: () => 1_000 });

  const first = await router.lease('sticky-a');
  const second = await router.lease('other-key');
  assert.equal(first.accountId, 'account-a');
  assert.equal(second.accountId, 'account-b');
  assert.equal(router.activeRequests('account-a'), 1);
  assert.equal(router.activeRequests('account-b'), 1);

  first.release();
  second.release();
  second.release();
  const sticky = await router.lease('sticky-a');
  assert.equal(sticky.accountId, 'account-a');
  sticky.release();
  assert.equal(router.activeRequests('account-a'), 0);
});

test('skips a missing account context and invalidates its sticky bindings', async () => {
  const source = new FakeClaudeAccountSource();
  source.contexts.delete('account-a');
  const router = new ClaudeAccountRouter(source);

  const lease = await router.lease('cache');
  assert.equal(lease.accountId, 'account-b');
  lease.release();
  assert.deepEqual(source.loginMarks, ['account-a']);
  assert.equal(router.activeRequests('account-a'), 0);
});

test('maintenance acquired first excludes the account from routing', async () => {
  const source = new FakeClaudeAccountSource(['account-a']);
  const router = new ClaudeAccountRouter(source);
  const maintenance = router.tryAcquireMaintenance('account-a');

  assert.ok(maintenance);
  assert.equal((await router.health()).eligible, 0);
  await assert.rejects(router.lease(), ClaudeNoEligibleAccountError);

  maintenance.release();
  const lease = await router.lease();
  assert.equal(lease.accountId, 'account-a');
  lease.release();
});

test('an active lease prevents maintenance until the lease is released', async () => {
  const source = new FakeClaudeAccountSource(['account-a']);
  const router = new ClaudeAccountRouter(source);
  const lease = await router.lease();

  assert.equal(router.tryAcquireMaintenance('account-a'), null);
  lease.release();

  const maintenance = router.tryAcquireMaintenance('account-a');
  assert.ok(maintenance);
  maintenance.release();
});

test('maintenance started while context resolution is pending prevents a late lease grant', async () => {
  const source = new DeferredContextSource();
  const router = new ClaudeAccountRouter(source);
  const pendingLease = router.lease('cache-key');
  await source.contextRequested.promise;

  const maintenance = router.tryAcquireMaintenance('account-a');
  assert.ok(maintenance);
  source.deferredContext.resolve(source.contexts.get('account-a') ?? null);

  const lease = await pendingLease;
  assert.equal(lease.accountId, 'account-b');
  assert.equal(router.activeRequests('account-a'), 0);
  lease.release();
  maintenance.release();
});

test('lease rechecks the latest source eligibility after resolving context', async () => {
  const source = new DeferredContextSource();
  const router = new ClaudeAccountRouter(source);
  const pendingLease = router.lease();
  await source.contextRequested.promise;

  source.accounts[0]!.enabled = false;
  source.deferredContext.resolve(source.contexts.get('account-a') ?? null);

  const lease = await pendingLease;
  assert.equal(lease.accountId, 'account-b');
  assert.equal(router.activeRequests('account-a'), 0);
  lease.release();
});

test('maintenance is exclusive, clears sticky routes, and stays health-ineligible', async () => {
  const source = new FakeClaudeAccountSource();
  const router = new ClaudeAccountRouter(source);
  const initial = await router.lease('cache-key');
  assert.equal(initial.accountId, 'account-a');
  initial.release();

  const first = router.tryAcquireMaintenance('account-a');
  const second = router.tryAcquireMaintenance('account-a');
  assert.ok(first);
  assert.equal(second, null);
  assert.equal((await router.health()).eligible, 1);

  first.release();
  first.release();
  assert.equal((await router.health()).eligible, 2);
  const afterRelease = router.tryAcquireMaintenance('account-a');
  assert.ok(afterRelease);
  afterRelease.release();

  const afterMaintenance = await router.lease('cache-key');
  assert.equal(afterMaintenance.accountId, 'account-b');
  afterMaintenance.release();
});

test('cooldown and auth state remove sticky routes until explicitly ready', async () => {
  let now = 1_000;
  const source = new FakeClaudeAccountSource();
  const router = new ClaudeAccountRouter(source, { now: () => now });

  const first = await router.lease('cache-key');
  assert.equal(first.accountId, 'account-a');
  first.release();
  await router.markCooldown('account-a', 2_000);
  const rerouted = await router.lease('cache-key');
  assert.equal(rerouted.accountId, 'account-b');
  rerouted.release();

  await router.markNeedsLogin('account-b');
  assert.equal((await router.health()).eligible, 0);
  await assert.rejects(router.lease('new-key'), ClaudeNoEligibleAccountError);

  now = 2_001;
  assert.equal((await router.health()).eligible, 1);
  source.accounts[1]!.needsLogin = false;
  router.markReady('account-b');
  assert.equal((await router.health()).eligible, 2);
});

test('runtime retries once after an explicit subscription usage limit', async () => {
  const source = new FakeClaudeAccountSource();
  const router = new ClaudeAccountRouter(source, { now: () => 1_000 });
  const executor = new FunctionExecutor(async (execution) => {
    if (execution.context.configDirectory.includes('account-a')) {
      throw new ClaudeUsageLimitError('limit', 9_000);
    }
    return {
      decision: { action: 'final', text: 'second account' },
      rawUsage: { usage: { input_tokens: 1, output_tokens: 2 } }
    };
  });
  const runtime = new ClaudeResponsesRuntime(router, executor);

  const response = await runtime.execute(request());
  assert.equal(executor.calls, 2);
  assert.equal(response.output[0].type, 'message');
  assert.deepEqual(source.cooldownMarks, [{ accountId: 'account-a', cooldownUntil: 9_000 }]);
  assert.equal(router.activeRequests('account-a'), 0);
  assert.equal(router.activeRequests('account-b'), 0);
});

test('runtime retries once after rejected authentication', async () => {
  const source = new FakeClaudeAccountSource();
  const executor = new FunctionExecutor(async (execution) => {
    if (execution.context.configDirectory.includes('account-a')) {
      throw new ClaudeAuthenticationError();
    }
    return { decision: { action: 'final', text: 'authenticated' }, rawUsage: {} };
  });
  const runtime = new ClaudeResponsesRuntime(new ClaudeAccountRouter(source), executor);

  await runtime.execute(request());
  assert.equal(executor.calls, 2);
  assert.deepEqual(source.loginMarks, ['account-a']);
});

test('runtime never retries malformed, cancelled, timeout-like, or generic failures', async () => {
  const errors = [
    new ClaudeDecisionError('malformed'),
    new ClaudeRequestAbortedError(),
    new Error('unknown execution failure')
  ];
  for (const expected of errors) {
    const source = new FakeClaudeAccountSource();
    const executor = new FunctionExecutor(async () => {
      throw expected;
    });
    const router = new ClaudeAccountRouter(source);
    const runtime = new ClaudeResponsesRuntime(router, executor);
    await assert.rejects(runtime.execute(request()), expected.constructor as typeof Error);
    assert.equal(executor.calls, 1);
    assert.equal(router.activeRequests('account-a'), 0);
    assert.equal(source.cooldownMarks.length, 0);
    assert.equal(source.loginMarks.length, 0);
  }
});

test('runtime performs at most one retry even when more accounts exist', async () => {
  const source = new FakeClaudeAccountSource(['account-a', 'account-b', 'account-c']);
  const executor = new FunctionExecutor(async () => {
    throw new ClaudeUsageLimitError('limited');
  });
  const runtime = new ClaudeResponsesRuntime(new ClaudeAccountRouter(source), executor);
  await assert.rejects(runtime.execute(request()), ClaudeUsageLimitError);
  assert.equal(executor.calls, 2);
  assert.equal(source.cooldownMarks.length, 2);
});
