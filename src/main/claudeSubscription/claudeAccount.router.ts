import type {
  ClaudeAccountId,
  ClaudeSubscriptionRoutingHealth
} from '@shared/claudeSubscription/claudeSubscription.contract';
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
  readonly #maintenance = new Map<ClaudeAccountId, number>();
  readonly #sticky = new Map<string, ClaudeAccountId>();
  readonly #cooldowns = new Map<ClaudeAccountId, number>();
  readonly #cooldownExpiryTimers = new Map<
    ClaudeAccountId,
    { deadline: number; timer: NodeJS.Timeout }
  >();
  readonly #needsLogin = new Set<ClaudeAccountId>();
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

      const stickyId = cacheKey ? this.#sticky.get(cacheKey) : undefined;
      const stickyAccount = stickyId
        ? eligible.find((account) => account.id === stickyId)
        : undefined;
      const selected = stickyAccount ?? this.#selectLeastActive(eligible);

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

  #decrementActive(accountId: ClaudeAccountId): void {
    const remaining = Math.max(0, this.activeRequests(accountId) - 1);
    if (remaining === 0) this.#active.delete(accountId);
    else this.#active.set(accountId, remaining);
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
    const timer = setTimeout(() => {
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
    }, Math.min(remaining, 2_147_483_647));
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
