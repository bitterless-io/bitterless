import type {
  ClaudeAccountId,
  ClaudeSubscriptionAccountUsage,
  ClaudeSubscriptionRoutingHealth
} from '@shared/claudeSubscription/claudeSubscription.contract';
import { CLAUDE_SUBSCRIPTION_LOW_QUOTA_PERCENT } from '@shared/claudeSubscription/claudeSubscription.contract';
import type {
  ClaudeAccountExecutionContext,
  ClaudeAccountRoutingRecord,
  ClaudeAccountSource
} from './claudeAccount.repository';
import { ClaudeNoEligibleAccountError } from './claudeSubscription.errors';

export interface ClaudeAccountLease {
  readonly accountId: ClaudeAccountId;
  readonly context: ClaudeAccountExecutionContext;
  release(): void;
}

export interface ClaudeAccountMaintenance {
  readonly accountId: ClaudeAccountId;
  release(): void;
}

export interface ClaudeAccountRouterOptions {
  now?: () => number;
  defaultCooldownMs?: number;
  onStateChanged?: () => void;
}

const DEFAULT_COOLDOWN_MS = 60_000;

export class ClaudeAccountRouter {
  readonly #source: ClaudeAccountSource;
  readonly #now: () => number;
  readonly #defaultCooldownMs: number;
  readonly #onStateChanged: () => void;
  readonly #active = new Map<ClaudeAccountId, number>();
  readonly #rateLimits = new Map<ClaudeAccountId, ClaudeSubscriptionAccountUsage>();
  readonly #maintenance = new Map<ClaudeAccountId, number>();
  readonly #sticky = new Map<string, ClaudeAccountId>();
  readonly #cooldowns = new Map<ClaudeAccountId, number>();
  readonly #cooldownExpiryTimers = new Map<
    ClaudeAccountId,
    { deadline: number; timer: NodeJS.Timeout }
  >();
  readonly #needsLogin = new Set<ClaudeAccountId>();
  // Woken when any account's active count reaches zero, so a request queued behind
  // a fully busy pool can re-run selection instead of polling.
  #releaseWaiters: Array<() => void> = [];
  #roundRobinCursor = 0;

  constructor(source: ClaudeAccountSource, options: ClaudeAccountRouterOptions = {}) {
    this.#source = source;
    this.#now = options.now ?? Date.now;
    this.#defaultCooldownMs = options.defaultCooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.#onStateChanged = options.onStateChanged ?? (() => undefined);
  }

  async lease(
    cacheKey?: string,
    excludedAccountIds: ReadonlySet<ClaudeAccountId> = new Set()
  ): Promise<ClaudeAccountLease> {
    const excluded = new Set(excludedAccountIds);

    while (true) {
      const accounts = await this.#source.listRoutingAccounts();
      if (this.#adoptSourceInvalidations(accounts)) this.#notifyStateChanged();
      const eligible = accounts.filter(
        (account) => !excluded.has(account.id) && this.#isEligible(account)
      );
      if (eligible.length === 0) throw new ClaudeNoEligibleAccountError();

      // One CLI child per config directory. The CLI rewrites `.claude.json` on
      // every run, so two children sharing a directory race on it — observed
      // 2026-08-26 truncating a 50KB config to a fresh-install stub. Busy accounts
      // are therefore not merely deprioritised, they are not selectable.
      const idle = eligible.filter((account) => this.activeRequests(account.id) === 0);
      if (idle.length === 0) {
        // Every eligible account is serving a request. Wait for one to finish and
        // re-run selection from scratch, so eligibility, maintenance, cooldown and
        // context validity are re-evaluated rather than carried across the wait.
        await this.#waitForRelease();
        continue;
      }

      // Quota-aware selection runs before stickiness: an account under the low-quota
      // threshold is skipped even when a thread is bound to it, because staying on it
      // only buys one or two more turns before the same switch happens mid-answer.
      const healthy = this.#withQuotaHeadroom(idle);
      const stickyId = cacheKey ? this.#sticky.get(cacheKey) : undefined;
      // A busy sticky account loses its binding for this request: prompt-cache
      // locality is an optimisation, and serialisation is correctness. The binding
      // survives, so the next request on this key returns to it once free.
      const stickyAccount = stickyId
        ? healthy.find((account) => account.id === stickyId)
        : undefined;
      const selected = stickyAccount ?? this.#selectByQuota(healthy);

      try {
        const context = await this.#source.getExecutionContext(selected.id);
        const latestAccounts = await this.#source.listRoutingAccounts();
        const latest = latestAccounts.find((account) => account.id === selected.id);

        if (excluded.has(selected.id) || !latest || !this.#isEligible(latest)) {
          excluded.add(selected.id);
          continue;
        }

        if (!this.#isValidContext(context)) {
          excluded.add(selected.id);
          try {
            await this.markNeedsLogin(selected.id);
          } catch {
            // In-memory invalidation is already effective for this process.
          }
          continue;
        }

        // There is intentionally no await between this eligibility check and the
        // active-count increment. A maintenance acquisition is synchronous, so it
        // cannot enter the check-to-grant gap.
        if (this.#isUnderMaintenance(selected.id)) {
          excluded.add(selected.id);
          continue;
        }
        // Idleness is re-checked here, not only at selection: the awaits above are
        // exactly the window in which a concurrent lease could have taken this
        // account after it was filtered as idle. Waiting rather than excluding,
        // because the account is healthy — it is merely busy.
        if (this.activeRequests(selected.id) > 0) {
          await this.#waitForRelease();
          continue;
        }
        this.#active.set(selected.id, this.activeRequests(selected.id) + 1);
        if (cacheKey) this.#sticky.set(cacheKey, selected.id);
        this.#notifyStateChanged();

        let released = false;
        return {
          accountId: selected.id,
          context,
          release: () => {
            if (released) return;
            released = true;
            this.#decrementActive(selected.id);
          }
        };
      } catch (error) {
        this.#removeStickyBindings(selected.id);
        throw error;
      }
    }
  }

  /**
   * Records Anthropic's own rate-limit state for an account. Emitted on every request,
   * not just a rejected one, so it is the only continuous signal available — the panel
   * would otherwise have nothing to show until an account was already exhausted.
   * Process-local: it describes a live observation, not stored account metadata.
   */
  observeRateLimit(accountId: ClaudeAccountId, usage: ClaudeSubscriptionAccountUsage): void {
    this.#rateLimits.set(accountId, usage);
  }

  rateLimit(accountId: ClaudeAccountId): ClaudeSubscriptionAccountUsage | undefined {
    return this.#rateLimits.get(accountId);
  }

  activeRequests(accountId: ClaudeAccountId): number {
    return this.#active.get(accountId) ?? 0;
  }

  tryAcquireMaintenance(accountId: ClaudeAccountId): ClaudeAccountMaintenance | null {
    if (this.activeRequests(accountId) > 0 || this.#isUnderMaintenance(accountId)) return null;

    this.#maintenance.set(accountId, 1);
    this.#removeStickyBindings(accountId);
    let released = false;
    return {
      accountId,
      release: () => {
        if (released) return;
        released = true;
        this.#maintenance.delete(accountId);
      }
    };
  }

  async markCooldown(accountId: ClaudeAccountId, cooldownUntil?: number): Promise<void> {
    const now = this.#now();
    const requested = Number.isFinite(cooldownUntil)
      ? cooldownUntil!
      : now + this.#defaultCooldownMs;
    const until = Math.max(requested, now + 1);
    this.#cooldowns.set(accountId, until);
    this.#scheduleCooldownExpiry(accountId, until);
    this.#removeStickyBindings(accountId);
    await this.#source.markCooldown?.(accountId, until);
    this.#notifyStateChanged();
  }

  async markNeedsLogin(accountId: ClaudeAccountId): Promise<void> {
    this.#needsLogin.add(accountId);
    this.#clearCooldownExpiry(accountId);
    this.#removeStickyBindings(accountId);
    await this.#source.markNeedsLogin?.(accountId);
    this.#notifyStateChanged();
  }

  markReady(accountId: ClaudeAccountId): void {
    this.#needsLogin.delete(accountId);
    this.#cooldowns.delete(accountId);
    this.#clearCooldownExpiry(accountId);
    this.#removeStickyBindings(accountId);
    this.#notifyStateChanged();
  }

  async health(): Promise<ClaudeSubscriptionRoutingHealth> {
    const accounts = await this.#source.listRoutingAccounts();
    if (this.#adoptSourceInvalidations(accounts)) this.#notifyStateChanged();
    const now = this.#now();
    let enabled = 0;
    let eligible = 0;
    let busy = 0;
    let cooling = 0;
    let needsLogin = 0;
    let activeRequests = 0;

    for (const account of accounts) {
      const active = this.activeRequests(account.id);
      activeRequests += active;
      if (account.enabled) enabled += 1;
      if (active > 0) busy += 1;
      if (this.#accountNeedsLogin(account)) needsLogin += 1;
      if (this.#cooldownUntil(account) > now) cooling += 1;
      if (this.#isEligible(account)) eligible += 1;
    }

    return {
      total: accounts.length,
      enabled,
      eligible,
      busy,
      cooling,
      needsLogin,
      activeRequests
    };
  }

  /**
   * Weekly quota left, as a percentage. Unknown reads as full: an account that has not
   * been probed yet must not be treated as exhausted, or a cold start would route
   * everything to whichever account happened to be measured first.
   */
  #remainingPercent(accountId: ClaudeAccountId): number {
    const used = this.#rateLimits.get(accountId)?.weekUsedPercent;
    return typeof used === 'number' ? Math.max(0, 100 - used) : 100;
  }

  /**
   * Accounts with quota to spare. Falls back to the whole set when none qualify:
   * refusing at the threshold would strand the remaining few percent the owner paid
   * for, so the pool runs on fumes rather than stopping early.
   */
  #withQuotaHeadroom(
    accounts: readonly ClaudeAccountRoutingRecord[]
  ): readonly ClaudeAccountRoutingRecord[] {
    const healthy = accounts.filter(
      (account) => this.#remainingPercent(account.id) >= CLAUDE_SUBSCRIPTION_LOW_QUOTA_PERCENT
    );
    return healthy.length > 0 ? healthy : accounts;
  }

  /**
   * Picks the account with the most weekly quota left, breaking ties by the previous
   * least-active round-robin so an untouched pool still spreads load.
   */
  #selectByQuota(
    accounts: readonly ClaudeAccountRoutingRecord[]
  ): ClaudeAccountRoutingRecord {
    const best = Math.max(...accounts.map((account) => this.#remainingPercent(account.id)));
    const tied = accounts.filter((account) => this.#remainingPercent(account.id) === best);
    return this.#selectLeastActive(tied);
  }

  #selectLeastActive(accounts: readonly ClaudeAccountRoutingRecord[]): ClaudeAccountRoutingRecord {
    const minimum = Math.min(...accounts.map((account) => this.activeRequests(account.id)));
    const tied = accounts.filter((account) => this.activeRequests(account.id) === minimum);
    const selected = tied[this.#roundRobinCursor % tied.length];
    this.#roundRobinCursor = (this.#roundRobinCursor + 1) % Number.MAX_SAFE_INTEGER;
    if (!selected) throw new ClaudeNoEligibleAccountError();
    return selected;
  }

  #isEligible(account: ClaudeAccountRoutingRecord): boolean {
    return (
      account.enabled &&
      account.hasAccountContext &&
      !this.#isUnderMaintenance(account.id) &&
      !this.#accountNeedsLogin(account) &&
      this.#cooldownUntil(account) <= this.#now()
    );
  }

  #accountNeedsLogin(account: ClaudeAccountRoutingRecord): boolean {
    return account.needsLogin || this.#needsLogin.has(account.id);
  }

  #cooldownUntil(account: ClaudeAccountRoutingRecord): number {
    const local = this.#cooldowns.get(account.id) ?? 0;
    const source = account.cooldownUntil ?? 0;
    if (local > 0 && local <= this.#now()) this.#cooldowns.delete(account.id);
    const until = Math.max(local, source);
    if (until > this.#now()) this.#scheduleCooldownExpiry(account.id, until);
    else this.#clearCooldownExpiry(account.id);
    return until;
  }

  #isValidContext(
    context: ClaudeAccountExecutionContext | null
  ): context is ClaudeAccountExecutionContext {
    return Boolean(
      context?.configDirectory.trim() &&
      context.secureStorageConfigDirectory.trim() &&
      context.anthropicConfigDirectory.trim()
    );
  }

  #maintenanceCount(accountId: ClaudeAccountId): number {
    return this.#maintenance.get(accountId) ?? 0;
  }

  #isUnderMaintenance(accountId: ClaudeAccountId): boolean {
    return this.#maintenanceCount(accountId) > 0;
  }

  #waitForRelease(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#releaseWaiters.push(resolve);
    });
  }

  /**
   * Wakes every waiter rather than one: each re-runs the full selection, and which
   * of them should proceed depends on eligibility that may have changed while they
   * waited. Handing the slot to a single pre-chosen waiter would decide that on
   * stale state.
   */
  #notifyReleased(): void {
    if (this.#releaseWaiters.length === 0) return;
    const waiters = this.#releaseWaiters;
    this.#releaseWaiters = [];
    for (const resolve of waiters) resolve();
  }

  #decrementActive(accountId: ClaudeAccountId): void {
    const remaining = Math.max(0, this.activeRequests(accountId) - 1);
    if (remaining === 0) {
      this.#active.delete(accountId);
      this.#notifyReleased();
    } else this.#active.set(accountId, remaining);
    this.#notifyStateChanged();
  }

  #adoptSourceInvalidations(accounts: readonly ClaudeAccountRoutingRecord[]): boolean {
    let changed = false;
    for (const account of accounts) {
      if ((account.needsLogin || !account.hasAccountContext) && !this.#needsLogin.has(account.id)) {
        this.#needsLogin.add(account.id);
        this.#clearCooldownExpiry(account.id);
        this.#removeStickyBindings(account.id);
        changed = true;
      }
    }
    return changed;
  }

  #notifyStateChanged(): void {
    try {
      this.#onStateChanged();
    } catch {
      // State observers cannot break routing or leak an acquired lease.
    }
  }

  #scheduleCooldownExpiry(accountId: ClaudeAccountId, deadline: number): void {
    const existing = this.#cooldownExpiryTimers.get(accountId);
    if (existing?.deadline === deadline) return;
    if (existing) clearTimeout(existing.timer);

    const remaining = Math.max(1, deadline - this.#now());
    const timer = setTimeout(
      () => {
        const current = this.#cooldownExpiryTimers.get(accountId);
        if (!current || current.timer !== timer) return;
        this.#cooldownExpiryTimers.delete(accountId);
        if (deadline > this.#now()) {
          this.#scheduleCooldownExpiry(accountId, deadline);
          return;
        }
        const local = this.#cooldowns.get(accountId) ?? 0;
        if (local > 0 && local <= this.#now()) this.#cooldowns.delete(accountId);
        this.#notifyStateChanged();
      },
      Math.min(remaining, 2_147_483_647)
    );
    timer.unref?.();
    this.#cooldownExpiryTimers.set(accountId, { deadline, timer });
  }

  #clearCooldownExpiry(accountId: ClaudeAccountId): void {
    const existing = this.#cooldownExpiryTimers.get(accountId);
    if (!existing) return;
    clearTimeout(existing.timer);
    this.#cooldownExpiryTimers.delete(accountId);
  }

  #removeStickyBindings(accountId: ClaudeAccountId): void {
    for (const [cacheKey, stickyAccountId] of this.#sticky) {
      if (stickyAccountId === accountId) this.#sticky.delete(cacheKey);
    }
  }
}
