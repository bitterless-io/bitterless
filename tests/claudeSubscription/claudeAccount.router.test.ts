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
  ClaudeAllAccountsExhaustedError,
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

const requestBody = () => ({
  model: 'claude-sonnet',
  stream: true,
  input: 'Say hello.',
  prompt_cache_key: 'thread-a'
});

const request = () => parseClaudeResponsesRequest(requestBody());

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

// The CLI rewrites .claude.json in its CLAUDE_CONFIG_DIR on every run, so two
// children sharing a directory corrupt it. See
// docs/issues/claude-subscription-concurrent-requests-share-one-config-dir.md.
test('one account serves every concurrent turn, with no ceiling', async () => {
  // This asserted one turn per account until 2026-08-31, because the CLI rewrites
  // `.claude.json` on every run and two children in one directory corrupted it. Each
  // request now runs in its own scratch config directory while credentials still
  // resolve from the account's real slot, so the reason is gone.
  //
  // Owner decision: one account is active at a time and carries everything, with no
  // cap. Concentrating on one is what makes the quota rule legible — one account's
  // weekly usage is drawn down and watched, rather than every account drifting toward
  // the threshold together.
  const source = new FakeClaudeAccountSource(['account-a']);
  let inFlight = 0;
  let peakInFlight = 0;
  const release = createDeferred<void>();
  const executor = new FunctionExecutor(async () => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    if (executor.calls <= 5) await release.promise;
    inFlight -= 1;
    return {
      decision: { action: 'final', text: 'ok' },
      rawUsage: { usage: { input_tokens: 1, output_tokens: 1 } }
    };
  });
  const runtime = new ClaudeResponsesRuntime(new ClaudeAccountRouter(source), executor);

  const pending = Array.from({ length: 5 }, () => runtime.execute(request()));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inFlight, 5, 'all five turns run on the one account');

  release.resolve();
  await Promise.all(pending);
  assert.equal(peakInFlight, 5, 'nothing queued behind anything else');
});

test('two accounts still serve two requests in parallel', async () => {
  const source = new FakeClaudeAccountSource(['account-a', 'account-b']);
  let inFlight = 0;
  let peakInFlight = 0;
  const release = createDeferred<void>();
  const executor = new FunctionExecutor(async () => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await release.promise;
    inFlight -= 1;
    return {
      decision: { action: 'final', text: 'ok' },
      rawUsage: { usage: { input_tokens: 1, output_tokens: 1 } }
    };
  });
  const runtime = new ClaudeResponsesRuntime(new ClaudeAccountRouter(source), executor);

  // Distinct cache keys: a shared key would bind both requests to one account and
  // measure stickiness rather than parallelism.
  const both = Promise.all([
    runtime.execute(
      parseClaudeResponsesRequest({ ...requestBody(), prompt_cache_key: 'thread-a' })
    ),
    runtime.execute(parseClaudeResponsesRequest({ ...requestBody(), prompt_cache_key: 'thread-b' }))
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  release.resolve();
  await both;
  assert.equal(peakInFlight, 2, 'serialising is per account, not across the pool');
});

// This replaces a test that asserted the runtime retried at most once. That was
// the defect written down as intent: with three accounts it stopped after two, so
// an idle third account with full quota was never reached. See
// docs/issues/claude-subscription-failover-stops-after-two-accounts.md.
test('runtime tries every eligible account before failing', async () => {
  const source = new FakeClaudeAccountSource(['account-a', 'account-b', 'account-c']);
  const executor = new FunctionExecutor(async () => {
    throw new ClaudeUsageLimitError('limited');
  });
  const runtime = new ClaudeResponsesRuntime(new ClaudeAccountRouter(source), executor);
  // Not `ClaudeUsageLimitError`: one account hitting its limit is handled by switching
  // and the caller never sees it. Once the pool is spent there is nothing to switch to,
  // and reporting the last account's own limit read as the ordinary, self-resolving
  // case. The exhausted error names how many accounts are out and when the first
  // resets, which is the only thing the owner can act on.
  await assert.rejects(runtime.execute(request()), (error: unknown) => {
    assert.ok(error instanceof ClaudeAllAccountsExhaustedError);
    assert.match(error.message, /All 3 Claude subscription accounts are out of quota/u);
    return true;
  });
  assert.equal(executor.calls, 3, 'every account is attempted once');
  assert.equal(source.cooldownMarks.length, 3);
  assert.deepEqual(
    [...new Set(source.cooldownMarks.map((mark) => mark.accountId))].sort(),
    ['account-a', 'account-b', 'account-c'],
    'each account is attempted exactly once, not one of them repeatedly'
  );
});

test('runtime reaches a healthy account behind two exhausted ones', async () => {
  const source = new FakeClaudeAccountSource(['account-a', 'account-b', 'account-c']);
  const executor = new FunctionExecutor(async () => {
    if (executor.calls < 3) throw new ClaudeUsageLimitError('limited');
    return {
      decision: { action: 'final', text: 'third account answered' },
      rawUsage: { usage: { input_tokens: 1, output_tokens: 1 } }
    };
  });
  const runtime = new ClaudeResponsesRuntime(new ClaudeAccountRouter(source), executor);
  const response = await runtime.execute(request());
  const message = response.output[0];
  assert.equal(message.type, 'message');
  assert.equal(
    message.type === 'message' ? message.content[0]?.text : undefined,
    'third account answered'
  );
  assert.equal(executor.calls, 3);
  assert.equal(source.cooldownMarks.length, 2, 'only the two exhausted accounts are cooled');
});

test('a non-routing failure does not consume a second account', async () => {
  const source = new FakeClaudeAccountSource(['account-a', 'account-b', 'account-c']);
  const executor = new FunctionExecutor(async () => {
    throw new ClaudeDecisionError('malformed decision');
  });
  const runtime = new ClaudeResponsesRuntime(new ClaudeAccountRouter(source), executor);
  await assert.rejects(runtime.execute(request()), ClaudeDecisionError);
  assert.equal(executor.calls, 1, 'a broken request must not be retried elsewhere');
  assert.equal(source.cooldownMarks.length, 0);
});
