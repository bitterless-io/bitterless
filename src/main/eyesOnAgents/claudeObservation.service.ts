import type {
  EyesOnAgentsClaudeDeletionReconciliation,
  EyesOnAgentsClaudeDirectoryState,
  EyesOnAgentsClaudeDirectoryStatus,
  EyesOnAgentsClaudeEnvironment,
  EyesOnAgentsClaudeEnvironmentStatus,
  EyesOnAgentsClaudeInventoryThread,
  EyesOnAgentsRepositoryApi,
  EyesOnAgentsRepositoryMutationResult
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { projectMetadataFromResolution, resolveEyesOnAgentsProject } from './projectResolver.service';
import {
  discoverClaudeDesktopInventory,
  scanClaudeDesktopCandidates,
  scanClaudeDesktopTombstones
} from './claudeDesktopInventory.adapter';
import {
  discoverClaudeTranscriptCandidates,
  mergeClaudeInventory,
  scanClaudeTranscriptCandidates
} from './claudeTranscriptInventory.adapter';
import {
  requireCanonicalClaudeTranscript,
  type ClaudeDirectoryResolution,
  type ClaudeObservationRoots
} from './claudePath.resolver';
import type {
  ClaudeDirectoryConfigService,
  ClaudeDirectoryHydration
} from './claudeDirectoryConfig.service';
import { ClaudeAgentsAdapter } from './claudeAgents.adapter';

const PAGE_SIZE = 40;
const POLL_HOT_SIZE = 20;
const MAX_FULL_PAGES = 500;
const MAX_FULL_CANDIDATES = MAX_FULL_PAGES * PAGE_SIZE;
export const CLAUDE_DIRECTORY_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000] as const;

export const isClaudeInventoryScanComplete = (candidateCount: number): boolean => {
  return candidateCount <= MAX_FULL_CANDIDATES;
};

interface InventoryScanResult {
  rows: EyesOnAgentsClaudeInventoryThread[];
  complete: boolean;
}

interface DesktopInventoryScanResult extends InventoryScanResult {
  deletion: EyesOnAgentsClaudeDeletionReconciliation;
}

type RetryTimer = ReturnType<typeof setTimeout>;

type ClaudeEnvironmentWatcher = {
  start(): Promise<void>;
  stop(): Promise<void>;
  updateRoots(roots: ClaudeObservationRoots): Promise<void>;
  isRunning?(): boolean;
};

// One environment's independent watcher lifecycle state (task 085). Every field here used to be a
// single service-wide field (appliedConfig/generation/status/retryTimer/... on
// ClaudeObservationService itself); this is that same set of fields, now owned per environment id
// so one environment's failure/retry/generation fencing never touches another's.
interface ClaudeEnvironmentObservationState {
  config: EyesOnAgentsClaudeEnvironment;
  generation: number;
  started: boolean;
  resolution: ClaudeDirectoryResolution | null;
  capabilityClearPending: boolean;
  retryTimer: RetryTimer | null;
  retryAttempt: number;
  status: EyesOnAgentsClaudeEnvironmentStatus;
  watcher: ClaudeEnvironmentWatcher;
  lifecycleTail: Promise<void>;
  refreshPromise: Promise<EyesOnAgentsRepositoryMutationResult> | null;
  refreshRequestedMode: 'full' | 'poll' | null;
  desktopColdOffset: number;
  transcriptColdOffset: number;
}

const iso = (value: number): string => new Date(value).toISOString();
const boundedError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown Claude directory error');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
};

export class ClaudeObservationService {
  // Keyed by EyesOnAgentsClaudeEnvironment.id. Always exactly one entry per currently-known
  // configured environment (enabled or disabled); entries persist across stop() (status flips to
  // 'stopped', config/resolution stay visible) and are only removed when reconcileEnvironments()
  // observes the environment id is genuinely gone from the persisted list.
  private readonly environments = new Map<string, ClaudeEnvironmentObservationState>();
  private desiredStarted = false;
  private started = false;
  private serviceLifecycleTail: Promise<void> = Promise.resolve();
  // Set only when the persisted directory configuration itself failed to hydrate (malformed value,
  // or a thrown getStored/hydrate error) — i.e. we don't yet know any environment identities at
  // all. Mirrors the pre-085 singleton's single fixed error/retrying status object.
  private invalidHydrationStatus: EyesOnAgentsClaudeEnvironmentStatus | null = null;
  private hydrationRetryTimer: RetryTimer | null = null;
  private hydrationRetryAttempt = 0;

  constructor(private readonly dependencies: {
    repository: Pick<
      EyesOnAgentsRepositoryApi,
      'upsertClaudeInventory' | 'reconcileClaudeAgentStates' | 'clearClaudeTranscriptCapabilities'
    >;
    directoryConfig?: Pick<
      ClaudeDirectoryConfigService,
      'hydrate' | 'listEnvironments' | 'chooseCustomDirectory' | 'useAutomatic'
    >;
    resolveDirectory?: (config: EyesOnAgentsClaudeEnvironment) => ClaudeDirectoryResolution;
    resolveRoots?: () => ClaudeObservationRoots;
    agents: ClaudeAgentsAdapter;
    createWatcher: (environment: EyesOnAgentsClaudeEnvironment) => ClaudeEnvironmentWatcher;
    broadcastChanged?: () => void;
    now?: () => number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
    logger?: Pick<Console, 'info'>;
  }) {}

  getDirectoryStatus(): EyesOnAgentsClaudeDirectoryStatus {
    if (this.invalidHydrationStatus) return [{ ...this.invalidHydrationStatus }];
    return [...this.environments.values()].map((state) => ({ ...state.status }));
  }

  // Tries every currently-configured environment's projects root, since a transcript may belong
  // to any of them; this generalizes the pre-085 single-root behavior (which had only one root to
  // try) without changing its per-root validation logic at all.
  requireCanonicalTranscript(transcriptPath: string, expectedThreadId: string): string {
    const roots = [...this.environments.values()]
      .map((state) => state.resolution?.roots.projectsRoot ?? null)
      .filter((root): root is string => root !== null);
    if (roots.length === 0) throw new Error('Claude projects root is unavailable');
    let lastError: unknown = null;
    for (const projectsRoot of roots) {
      try {
        return requireCanonicalClaudeTranscript({ transcriptPath, projectsRoot, expectedThreadId });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Claude transcript path is invalid');
  }

  async start(): Promise<void> {
    this.desiredStarted = true;
    await this.runServiceLifecycle(async () => {
      if (!this.desiredStarted || this.started) return;
      this.started = true;
      // Wipe every already-known environment's status to a blank "starting" slate immediately —
      // mirrors the pre-085 singleton's start(), which reset its one status object before
      // awaiting hydration so a slow re-hydrate never shows stale directory info from a previous
      // run instead of "unknown, in progress."
      for (const state of this.environments.values()) {
        state.resolution = null;
        this.setEnvironmentStatus(state, { ...this.stoppedEnvironmentStatus(state.config), state: 'starting' });
      }
      await this.hydrateAndReconcile();
    });
  }

  async stop(): Promise<void> {
    this.desiredStarted = false;
    this.started = false;
    this.cancelHydrationRetry();
    // Immediate, synchronous fencing (before the service queue even runs) mirrors the pre-085
    // stop() contract: refresh()/refreshEnvironment() intentionally bypass the lifecycle queue, so
    // the generation bump and retry cancellation must be visible to them right away, not only once
    // this stop's queued work is reached.
    for (const state of this.environments.values()) {
      state.generation += 1;
      this.cancelEnvironmentRetry(state);
      state.refreshRequestedMode = null;
    }
    await this.runServiceLifecycle(async () => {
      if (this.invalidHydrationStatus) {
        this.invalidHydrationStatus = {
          ...this.invalidHydrationStatus,
          state: 'stopped',
          watching: false,
          nextRetryAt: null
        };
      }
      const entries = [...this.environments.values()];
      const stopErrors = await Promise.all(entries.map((state) => (
        this.runEnvironmentLifecycle(state, () => this.stopEnvironmentBodyAfterFence(state))
      )));
      const firstError = stopErrors.find((error) => error !== null) ?? null;
      if (firstError !== null) throw firstError;
    });
  }

  // These two act on the sole default environment (environments[0]) — the per-id CRUD surface
  // (add/rename/remove/setEnabled/chooseCustomDirectory/useAutomatic on ClaudeDirectoryConfigService)
  // is exposed environment-scoped through applyEnvironments(); wiring the renderer to it directly
  // is task 088. When the config service has no currently-known environment (never hydrated, or a
  // malformed saved value), no id is available yet; an empty id is passed through and the config
  // service's own recovery branch resets to a fresh default environment, exactly like the pre-084
  // single-directory recovery contract.
  async changeDirectory(): Promise<void> {
    await this.runServiceLifecycle(async () => {
      const next = await this.requireDirectoryConfig().chooseCustomDirectory({
        id: this.resolveDefaultEnvironmentId()
      });
      if (next === null) return;
      await this.reconcileFromDirectoryConfig();
    });
  }

  async useAutomaticDirectory(): Promise<void> {
    await this.runServiceLifecycle(async () => {
      await this.requireDirectoryConfig().useAutomatic({ id: this.resolveDefaultEnvironmentId() });
      await this.reconcileFromDirectoryConfig();
    });
  }

  async retryDirectory(): Promise<void> {
    await this.runServiceLifecycle(async () => {
      if (!this.desiredStarted) return;
      if (this.invalidHydrationStatus !== null) {
        await this.hydrateAndReconcile();
        return;
      }
      await this.retryEnvironmentEntry(this.resolveDefaultEnvironmentId());
    });
  }

  // Re-reads the full environment list from ClaudeDirectoryConfigService and reconciles the
  // watcher map against it: starts a fresh environment's supervisor, stops/removes one no longer
  // present, restarts one whose root changed, and flips one whose enabled flag changed. Called by
  // changeDirectory()/useAutomaticDirectory() above, and intended to be called by every CRUD
  // mutation on ClaudeDirectoryConfigService (add/rename/remove/setEnabled/chooseCustomDirectory/
  // useAutomatic) so "enabling/adding an environment starts its own supervisor; disabling/removing
  // stops and joins only that environment's supervisor" holds for the full CRUD surface, not just
  // the legacy default-environment actions.
  async applyEnvironments(): Promise<void> {
    await this.runServiceLifecycle(async () => {
      await this.reconcileFromDirectoryConfig();
    });
  }

  async invalidate(environmentId: string): Promise<void> {
    const state = this.environments.get(environmentId);
    if (!state || !state.started) return;
    await this.refreshEnvironment(state, 'poll');
  }

  async handleWatcherFailure(environmentId: string, error: Error): Promise<void> {
    const state = this.environments.get(environmentId);
    if (!state) return;
    const generation = state.generation;
    await this.runEnvironmentLifecycle(state, async () => {
      if (!this.isEnvironmentCurrent(state, generation) || this.isEnvironmentWatcherRunning(state)) return;
      this.logEnvironmentLifecycle(state, 'fatal', `error="${boundedError(error)}"`);
      this.setEnvironmentStatus(state, {
        ...state.status,
        state: 'retrying',
        watching: false,
        error: boundedError(error)
      });
      this.scheduleEnvironmentRetry(state, generation);
    });
  }

  // Refreshes every environment in parallel; each environment's own generation fencing and
  // refreshPromise dedupe (inside refreshEnvironment) keep them independent.
  async refresh(mode: 'full' | 'poll'): Promise<EyesOnAgentsRepositoryMutationResult> {
    if (!this.started) {
      if (!this.desiredStarted) return { changed: false };
      await this.start();
      return { changed: false };
    }
    const entries = [...this.environments.values()];
    const results = await Promise.all(entries.map((state) => this.refreshEnvironment(state, mode)));
    return { changed: results.some((result) => result.changed) };
  }

  // ---- Whole-service hydration (populates/repopulates the environment map) ----

  private async hydrateDirectoryConfig(): Promise<ClaudeDirectoryHydration> {
    if (this.dependencies.directoryConfig) return await this.dependencies.directoryConfig.hydrate();
    return {
      state: 'valid',
      config: {
        schemaVersion: 2,
        environments: [{
          id: 'automatic',
          label: 'Default',
          mode: 'automatic',
          configDirectory: null,
          enabled: true
        }]
      }
    };
  }

  private invalidHydrationStatusFields(): Omit<EyesOnAgentsClaudeEnvironmentStatus, 'state' | 'error' | 'nextRetryAt'> {
    return {
      id: '',
      label: '',
      enabled: true,
      mode: 'automatic',
      configuredDirectory: null,
      effectiveDirectory: null,
      projectsDirectory: null,
      desktopDirectoryCount: 0,
      watching: false,
      lastScanAt: null,
      lastSuccessfulScanAt: null
    };
  }

  // Must only be called from within runServiceLifecycle (start(), retryDirectory(), or the
  // hydration retry timer's own fire callback) — it mutates the environment map and hydration
  // sentinel directly, relying on the service queue for serialization.
  private async hydrateAndReconcile(): Promise<void> {
    try {
      const hydration = await this.hydrateDirectoryConfig();
      if (!this.desiredStarted) return;
      if (hydration.state === 'invalid') {
        await this.teardownAllEnvironments();
        this.cancelHydrationRetry();
        this.hydrationRetryAttempt = 0;
        this.invalidHydrationStatus = {
          ...this.invalidHydrationStatusFields(),
          state: 'error',
          nextRetryAt: null,
          error: boundedError(hydration.error)
        };
        this.dependencies.broadcastChanged?.();
        return;
      }
      this.invalidHydrationStatus = null;
      this.hydrationRetryAttempt = 0;
      await this.reconcileEnvironments(hydration.config.environments);
    } catch (error) {
      if (!this.desiredStarted) return;
      this.invalidHydrationStatus = {
        ...this.invalidHydrationStatusFields(),
        state: 'retrying',
        nextRetryAt: null,
        error: boundedError(error)
      };
      this.dependencies.broadcastChanged?.();
      this.scheduleHydrationRetry();
    }
  }

  private async reconcileFromDirectoryConfig(): Promise<void> {
    if (!this.dependencies.directoryConfig) return;
    const list = this.dependencies.directoryConfig.listEnvironments();
    // An empty list only ever means "not yet hydrated / hydration invalid" (the config service
    // never persists zero environments) — nothing authoritative to reconcile the map against yet.
    if (list.length === 0) return;
    this.invalidHydrationStatus = null;
    this.cancelHydrationRetry();
    await this.reconcileEnvironments(list);
  }

  // Diffs the map against the authoritative list: tears down removed ids, updates existing ones
  // in place, and starts (if desired/enabled) newly-added ones. Every per-environment operation
  // runs through that environment's own lifecycle queue in parallel, so one environment's slow or
  // failing (re)start never delays or affects another's.
  private async reconcileEnvironments(list: readonly EyesOnAgentsClaudeEnvironment[]): Promise<void> {
    const nextIds = new Set(list.map((environment) => environment.id));
    const tasks: Array<Promise<void>> = [];
    for (const [id, state] of this.environments) {
      if (nextIds.has(id)) continue;
      this.environments.delete(id);
      tasks.push(this.teardownEnvironment(state));
    }
    for (const environment of list) {
      const existing = this.environments.get(environment.id);
      if (existing) {
        tasks.push(this.runEnvironmentLifecycle(existing, () => (
          this.applyEnvironmentConfigBody(existing, environment)
        )));
      } else {
        const created = this.createEnvironmentState(environment);
        this.environments.set(environment.id, created);
        tasks.push(this.runEnvironmentLifecycle(created, () => this.startEnvironmentBody(created)));
      }
    }
    await Promise.all(tasks);
  }

  private async teardownAllEnvironments(): Promise<void> {
    const entries = [...this.environments.values()];
    this.environments.clear();
    await Promise.all(entries.map((state) => this.teardownEnvironment(state)));
  }

  private async teardownEnvironment(state: ClaudeEnvironmentObservationState): Promise<void> {
    try {
      await this.runEnvironmentLifecycle(state, () => this.stopEnvironmentBody(state));
    } catch {
      // Removal always completes; a stop-time error was already recorded on the (now-discarded)
      // status object above.
    }
  }

  private scheduleHydrationRetry(): void {
    if (!this.desiredStarted || this.hydrationRetryTimer !== null) return;
    const delay = CLAUDE_DIRECTORY_RETRY_DELAYS_MS[
      Math.min(this.hydrationRetryAttempt, CLAUDE_DIRECTORY_RETRY_DELAYS_MS.length - 1)
    ];
    this.hydrationRetryAttempt += 1;
    const nextRetryAt = (this.dependencies.now ?? Date.now)() + delay;
    const setTimer = this.dependencies.setTimer ?? setTimeout;
    this.hydrationRetryTimer = setTimer(() => {
      this.hydrationRetryTimer = null;
      if (!this.desiredStarted) return;
      void this.runServiceLifecycle(async () => {
        if (!this.desiredStarted) return;
        await this.hydrateAndReconcile();
      });
    }, delay);
    this.hydrationRetryTimer.unref?.();
    if (this.invalidHydrationStatus) {
      this.invalidHydrationStatus = { ...this.invalidHydrationStatus, nextRetryAt: iso(nextRetryAt) };
    }
  }

  private cancelHydrationRetry(): void {
    if (this.hydrationRetryTimer === null) return;
    (this.dependencies.clearTimer ?? clearTimeout)(this.hydrationRetryTimer);
    this.hydrationRetryTimer = null;
  }

  private requireDirectoryConfig(): NonNullable<typeof this.dependencies.directoryConfig> {
    if (!this.dependencies.directoryConfig) {
      throw new Error('Claude directory configuration is unavailable');
    }
    return this.dependencies.directoryConfig;
  }

  private resolveDefaultEnvironmentId(): string {
    return this.requireDirectoryConfig().listEnvironments()[0]?.id ?? '';
  }

  // ---- Per-environment lifecycle (each of these assumes it is already running inside that
  // environment's own runEnvironmentLifecycle queue, except where noted) ----

  private createEnvironmentState(environment: EyesOnAgentsClaudeEnvironment): ClaudeEnvironmentObservationState {
    return {
      config: environment,
      generation: 0,
      started: false,
      resolution: null,
      capabilityClearPending: false,
      retryTimer: null,
      retryAttempt: 0,
      status: this.stoppedEnvironmentStatus(environment),
      watcher: this.dependencies.createWatcher(environment),
      lifecycleTail: Promise.resolve(),
      refreshPromise: null,
      refreshRequestedMode: null,
      desktopColdOffset: POLL_HOT_SIZE,
      transcriptColdOffset: POLL_HOT_SIZE
    };
  }

  private stoppedEnvironmentStatus(environment: EyesOnAgentsClaudeEnvironment): EyesOnAgentsClaudeEnvironmentStatus {
    return {
      id: environment.id,
      label: environment.label,
      enabled: environment.enabled,
      mode: 'automatic',
      configuredDirectory: null,
      effectiveDirectory: null,
      projectsDirectory: null,
      desktopDirectoryCount: 0,
      state: 'stopped',
      watching: false,
      lastScanAt: null,
      lastSuccessfulScanAt: null,
      nextRetryAt: null,
      error: null
    };
  }

  // Entry point for a brand-new environment (from reconcileEnvironments) or one flipping from
  // disabled to enabled (from applyEnvironmentConfigBody) — both already hold this environment's
  // lifecycle lock when calling this.
  private async startEnvironmentBody(state: ClaudeEnvironmentObservationState): Promise<void> {
    if (!this.desiredStarted || !state.config.enabled || state.started) return;
    state.started = true;
    const generation = ++state.generation;
    state.capabilityClearPending = true;
    state.retryAttempt = 0;
    this.setEnvironmentStatus(state, { ...this.stoppedEnvironmentStatus(state.config), state: 'starting' });
    this.logEnvironmentLifecycle(state, 'start');
    await this.recoverEnvironment(state, 'full', generation);
  }

  // Fences (generation bump + retry cancel) then stops. Used where the caller has NOT already
  // fenced this environment (a single environment being disabled or removed) — the whole-service
  // stop() pre-fences every environment itself and calls stopEnvironmentBodyAfterFence directly.
  private async stopEnvironmentBody(state: ClaudeEnvironmentObservationState): Promise<unknown> {
    state.generation += 1;
    this.cancelEnvironmentRetry(state);
    state.refreshRequestedMode = null;
    return await this.stopEnvironmentBodyAfterFence(state);
  }

  private async stopEnvironmentBodyAfterFence(state: ClaudeEnvironmentObservationState): Promise<unknown> {
    state.started = false;
    let stopError: unknown = null;
    try {
      await this.settleEnvironmentWatcher(state, false);
    } catch (error) {
      stopError = error;
    }
    this.setEnvironmentStatus(state, {
      ...state.status,
      state: 'stopped',
      watching: false,
      nextRetryAt: null,
      ...(stopError === null ? {} : { error: boundedError(stopError) })
    });
    return stopError;
  }

  // Applies a reconciled environment's new config (rename/mode/directory/enabled) onto its
  // existing state entry. Mirrors the pre-085 single-instance applyPersistedConfig: a label-only
  // change just refreshes status fields; a root change that resolves to the same effective
  // directory avoids a watcher restart; a genuine root change bumps generation and restarts.
  private async applyEnvironmentConfigBody(
    state: ClaudeEnvironmentObservationState,
    next: EyesOnAgentsClaudeEnvironment
  ): Promise<void> {
    const previous = state.config;
    const rootChanged = previous.mode !== next.mode || previous.configDirectory !== next.configDirectory;
    state.config = next;
    this.setEnvironmentStatus(state, { ...state.status, id: next.id, label: next.label, enabled: next.enabled });

    // Whether this environment should end up running once this call settles — false while the
    // whole service is stopped or this one environment is disabled. Resolution/status below are
    // still recomputed even when this is false, mirroring the pre-085 single-instance contract
    // that a directory action always publishes the freshly resolved root even while stopped.
    const shouldRun = next.enabled && this.desiredStarted;

    if (!rootChanged) {
      if (!shouldRun) {
        if (state.started) await this.stopEnvironmentBody(state);
        return;
      }
      if (!state.started) await this.startEnvironmentBody(state);
      return;
    }

    const nextResolution = this.resolve(next);
    if (!shouldRun) {
      if (state.started) await this.stopEnvironmentBody(state);
      state.resolution = nextResolution;
      this.updateEnvironmentResolvedStatus(state, nextResolution, 'stopped');
      return;
    }

    if (state.resolution?.effectiveDirectory === nextResolution.effectiveDirectory) {
      this.cancelEnvironmentRetry(state);
      state.retryAttempt = 0;
      state.resolution = nextResolution;
      this.updateEnvironmentResolvedStatus(state, nextResolution);
      if (state.started) await this.recoverEnvironment(state, 'full', state.generation);
      else await this.startEnvironmentBody(state);
      return;
    }

    if (!state.started) {
      // Root changed while not yet running (freshly enabled, or the service wasn't started yet):
      // there is no watcher generation to tear down first — adopt the resolution and start fresh.
      state.resolution = nextResolution;
      this.updateEnvironmentResolvedStatus(state, nextResolution, 'stopped');
      await this.startEnvironmentBody(state);
      return;
    }
    await this.restartEnvironmentForRootChangeBody(state, nextResolution);
  }

  private async restartEnvironmentForRootChangeBody(
    state: ClaudeEnvironmentObservationState,
    nextResolution: ClaudeDirectoryResolution
  ): Promise<void> {
    const wasStarted = state.started;
    const generation = ++state.generation;
    this.cancelEnvironmentRetry(state);
    state.refreshRequestedMode = null;
    state.capabilityClearPending = true;
    state.retryAttempt = 0;
    state.desktopColdOffset = POLL_HOT_SIZE;
    state.transcriptColdOffset = POLL_HOT_SIZE;
    state.resolution = nextResolution;
    this.setEnvironmentStatus(state, {
      id: state.config.id,
      label: state.config.label,
      enabled: state.config.enabled,
      mode: state.config.mode,
      configuredDirectory: state.config.mode === 'custom' ? state.config.configDirectory : null,
      effectiveDirectory: nextResolution.effectiveDirectory || null,
      projectsDirectory: nextResolution.projectsDirectory || null,
      desktopDirectoryCount: nextResolution.roots.desktopRoots.length,
      state: wasStarted ? 'starting' : 'stopped',
      watching: false,
      lastScanAt: null,
      lastSuccessfulScanAt: null,
      nextRetryAt: null,
      error: null
    });
    let replacementError: unknown = null;
    try {
      await this.settleEnvironmentWatcher(state, true);
    } catch (error) {
      replacementError = error;
    }
    if (wasStarted && state.started && state.generation === generation) {
      if (replacementError === null) {
        this.logEnvironmentLifecycle(state, 'start');
        await this.recoverEnvironment(state, 'full', generation);
      } else {
        this.setEnvironmentStatus(state, {
          ...state.status,
          state: 'retrying',
          watching: false,
          error: boundedError(replacementError)
        });
        this.scheduleEnvironmentRetry(state, generation);
      }
    } else if (!wasStarted && !state.started && state.generation === generation) {
      this.setEnvironmentStatus(state, {
        ...state.status,
        state: 'stopped',
        watching: false,
        nextRetryAt: null,
        ...(replacementError === null ? {} : { error: boundedError(replacementError) })
      });
    }
  }

  private async retryEnvironmentEntry(id: string): Promise<void> {
    const state = this.environments.get(id);
    if (!state) return;
    await this.runEnvironmentLifecycle(state, async () => {
      if (!state.started) return;
      this.cancelEnvironmentRetry(state);
      state.retryAttempt = 0;
      const generation = state.generation;
      this.setEnvironmentStatus(state, { ...state.status, state: 'retrying', nextRetryAt: null });
      await this.recoverEnvironment(state, 'full', generation);
    });
  }

  // Always called from an already-locked context (startEnvironmentBody, applyEnvironmentConfigBody,
  // restartEnvironmentForRootChangeBody, retryEnvironmentEntry, or a retry timer's own fire callback).
  private async recoverEnvironment(
    state: ClaudeEnvironmentObservationState,
    mode: 'full' | 'poll',
    generation: number
  ): Promise<void> {
    if (!this.isEnvironmentCurrent(state, generation)) return;
    const resolution = this.resolve(state.config);
    state.resolution = resolution;
    this.updateEnvironmentResolvedStatus(state, resolution, state.retryAttempt > 0 ? 'retrying' : 'starting');
    try {
      if (state.capabilityClearPending) {
        const cleared = await this.dependencies.repository.clearClaudeTranscriptCapabilities();
        if (!this.isEnvironmentCurrent(state, generation)) return;
        state.capabilityClearPending = false;
        if (cleared.changed) this.dependencies.broadcastChanged?.();
      }
      await this.refreshEnvironment(state, mode);
    } catch (error) {
      if (!this.isEnvironmentCurrent(state, generation)) return;
      const watching = this.isEnvironmentWatcherRunning(state);
      this.setEnvironmentStatus(state, {
        ...state.status,
        state: watching ? 'degraded' : 'retrying',
        watching,
        error: boundedError(error)
      });
      this.scheduleEnvironmentRetry(state, generation);
    }
  }

  // Intentionally NOT routed through runEnvironmentLifecycle — mirrors the pre-085 refresh(), which
  // bypassed the lifecycle queue entirely and relied on its own refreshPromise dedupe plus
  // generation fencing (isEnvironmentCurrent) for safety against concurrent lifecycle operations.
  private async refreshEnvironment(
    state: ClaudeEnvironmentObservationState,
    mode: 'full' | 'poll'
  ): Promise<EyesOnAgentsRepositoryMutationResult> {
    // Unlike the pre-085 singleton's refresh() (which lazily called the SERVICE-level start() the
    // first time anything called refresh()), starting one environment is always driven by
    // reconcileEnvironments()/applyEnvironmentConfigBody() — a stopped/disabled/not-yet-reconciled
    // environment is simply not refreshed, never eagerly (re)started here with possibly-stale config.
    if (!state.started || state.capabilityClearPending) return { changed: false };
    if (state.refreshPromise) {
      if (mode === 'full' || state.refreshRequestedMode === null) state.refreshRequestedMode = mode;
      return await state.refreshPromise;
    }
    const generation = state.generation;
    const operation = (async (): Promise<EyesOnAgentsRepositoryMutationResult> => {
      let nextMode = mode;
      let result: EyesOnAgentsRepositoryMutationResult = { changed: false };
      do {
        state.refreshRequestedMode = null;
        const current = await this.performEnvironmentRefresh(state, nextMode, generation);
        result = { changed: result.changed || current.changed };
        nextMode = state.refreshRequestedMode ?? 'poll';
      } while (state.refreshRequestedMode !== null && this.isEnvironmentCurrent(state, generation));
      return result;
    })();
    state.refreshPromise = operation;
    try {
      return await operation;
    } finally {
      if (state.refreshPromise === operation) state.refreshPromise = null;
    }
  }

  private resolve(config: EyesOnAgentsClaudeEnvironment): ClaudeDirectoryResolution {
    if (this.dependencies.resolveDirectory) return this.dependencies.resolveDirectory(config);
    const roots = this.dependencies.resolveRoots?.() ?? { desktopRoots: [], projectsRoot: null };
    return {
      roots,
      effectiveDirectory: '',
      projectsDirectory: '',
      configDirectoryAvailable: true,
      projectsDirectoryAvailable: roots.projectsRoot !== null
    };
  }

  private updateEnvironmentResolvedStatus(
    state: ClaudeEnvironmentObservationState,
    resolution: ClaudeDirectoryResolution,
    overrideState?: EyesOnAgentsClaudeDirectoryState
  ): void {
    this.setEnvironmentStatus(state, {
      ...state.status,
      mode: state.config.mode,
      configuredDirectory: state.config.mode === 'custom' ? state.config.configDirectory : null,
      effectiveDirectory: resolution.effectiveDirectory || null,
      projectsDirectory: resolution.projectsDirectory || null,
      desktopDirectoryCount: resolution.roots.desktopRoots.length,
      ...(overrideState === undefined ? {} : { state: overrideState })
    });
  }

  private scheduleEnvironmentRetry(state: ClaudeEnvironmentObservationState, generation: number): void {
    if (!this.isEnvironmentCurrent(state, generation) || state.retryTimer !== null) return;
    const delay = CLAUDE_DIRECTORY_RETRY_DELAYS_MS[
      Math.min(state.retryAttempt, CLAUDE_DIRECTORY_RETRY_DELAYS_MS.length - 1)
    ];
    state.retryAttempt += 1;
    const nextRetryAt = (this.dependencies.now ?? Date.now)() + delay;
    const setTimer = this.dependencies.setTimer ?? setTimeout;
    this.logEnvironmentLifecycle(state, 'retry', `attempt=${state.retryAttempt} delayMs=${delay}`);
    state.retryTimer = setTimer(() => {
      state.retryTimer = null;
      if (!this.isEnvironmentCurrent(state, generation)) return;
      this.setEnvironmentStatus(state, { ...state.status, state: 'retrying', nextRetryAt: null });
      void this.runEnvironmentLifecycle(state, async () => {
        if (!this.isEnvironmentCurrent(state, generation)) return;
        await this.recoverEnvironment(state, 'full', generation);
      });
    }, delay);
    state.retryTimer.unref?.();
    this.setEnvironmentStatus(state, { ...state.status, nextRetryAt: iso(nextRetryAt) });
  }

  private cancelEnvironmentRetry(state: ClaudeEnvironmentObservationState): void {
    if (state.retryTimer === null) return;
    (this.dependencies.clearTimer ?? clearTimeout)(state.retryTimer);
    state.retryTimer = null;
  }

  private async settleEnvironmentWatcher(
    state: ClaudeEnvironmentObservationState,
    stopBeforeJoin: boolean
  ): Promise<void> {
    try {
      if (stopBeforeJoin) {
        await state.watcher.stop().catch(() => undefined);
      }
      const inFlightRefresh = state.refreshPromise;
      if (inFlightRefresh) await inFlightRefresh.catch(() => undefined);
    } finally {
      await state.watcher.stop();
    }
  }

  private isEnvironmentWatcherRunning(state: ClaudeEnvironmentObservationState): boolean {
    return state.watcher.isRunning?.() ?? true;
  }

  private setEnvironmentStatus(
    state: ClaudeEnvironmentObservationState,
    status: EyesOnAgentsClaudeEnvironmentStatus
  ): void {
    if (JSON.stringify(state.status) === JSON.stringify(status)) return;
    state.status = status;
    this.dependencies.broadcastChanged?.();
  }

  private runServiceLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serviceLifecycleTail.then(operation, operation);
    this.serviceLifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private runEnvironmentLifecycle<T>(
    state: ClaudeEnvironmentObservationState,
    operation: () => Promise<T>
  ): Promise<T> {
    const result = state.lifecycleTail.then(operation, operation);
    state.lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private withProject(thread: EyesOnAgentsClaudeInventoryThread): EyesOnAgentsClaudeInventoryThread {
    const project = projectMetadataFromResolution(resolveEyesOnAgentsProject(thread.cwd));
    return { ...thread, ...(project === undefined ? {} : { project }) };
  }

  private isEnvironmentCurrent(state: ClaudeEnvironmentObservationState, generation: number): boolean {
    return state.started && state.generation === generation;
  }

  // Never logs configDirectory or any other path — id/label only, matching the [claude-environment]
  // logging convention this subsystem already uses (claudeDirectoryConfig.service.ts).
  private logEnvironmentLifecycle(
    state: ClaudeEnvironmentObservationState,
    action: 'start' | 'retry' | 'fatal',
    detail?: string
  ): void {
    const logger = this.dependencies.logger ?? console;
    const suffix = detail === undefined ? '' : ` ${detail}`;
    logger.info(
      `[claude-watcher] action=${action} id=${state.config.id} label="${state.config.label}"${suffix}`
    );
  }

  private async performEnvironmentRefresh(
    state: ClaudeEnvironmentObservationState,
    mode: 'full' | 'poll',
    generation: number
  ): Promise<EyesOnAgentsRepositoryMutationResult> {
    if (!this.isEnvironmentCurrent(state, generation)) return { changed: false };
    const observedAt = (this.dependencies.now ?? Date.now)();
    const resolution = this.resolve(state.config);
    state.resolution = resolution;
    this.updateEnvironmentResolvedStatus(state, resolution);
    this.setEnvironmentStatus(state, { ...state.status, lastScanAt: iso(observedAt) });
    const roots = resolution.roots;
    let watcherError: unknown = null;
    try {
      await state.watcher.updateRoots(roots);
      if (!this.isEnvironmentCurrent(state, generation)) return { changed: false };
      if (roots.desktopRoots.length > 0 || roots.projectsRoot !== null) {
        await state.watcher.start();
      } else {
        await state.watcher.stop();
      }
    } catch (error) {
      watcherError = error;
      await state.watcher.stop().catch(() => undefined);
    }
    if (!this.isEnvironmentCurrent(state, generation)) return { changed: false };
    const [desktopResult, transcriptResult, agentsResult] = await Promise.allSettled([
      mode === 'full'
        ? this.scanAllDesktop(roots, observedAt)
        : this.scanPollDesktop(state, roots, observedAt),
      mode === 'full'
        ? this.scanAllTranscripts(roots, observedAt)
        : this.scanPollTranscripts(state, roots, observedAt),
      this.dependencies.agents.poll(observedAt)
    ]);
    if (!this.isEnvironmentCurrent(state, generation)) return { changed: false };
    let changed = false;
    if (desktopResult.status === 'fulfilled' || transcriptResult.status === 'fulfilled') {
      const merged = mergeClaudeInventory(
        desktopResult.status === 'fulfilled' ? desktopResult.value.rows : [],
        transcriptResult.status === 'fulfilled' ? transcriptResult.value.rows : []
      ).map((thread) => this.withProject({
        ...thread,
        desktopEvidenceComplete: desktopResult.status === 'fulfilled' &&
          desktopResult.value.complete &&
          (thread.desktopSessionId !== null || thread.clearDesktopSessionId === true),
        transcriptEvidenceComplete: transcriptResult.status === 'fulfilled' &&
          transcriptResult.value.complete &&
          (thread.transcriptPath !== null || thread.clearTranscriptPath === true)
      }));
      const result = await this.dependencies.repository.upsertClaudeInventory({
        threads: merged,
        ...(desktopResult.status === 'fulfilled'
          ? { deletion: desktopResult.value.deletion }
          : {})
      });
      changed = changed || result.changed;
    }
    if (!this.isEnvironmentCurrent(state, generation)) return { changed: false };
    if (agentsResult.status === 'fulfilled' && agentsResult.value !== null) {
      const result = await this.dependencies.repository.reconcileClaudeAgentStates(agentsResult.value);
      changed = changed || result.changed;
    }
    if (!this.isEnvironmentCurrent(state, generation)) return { changed: false };
    const watching = this.isEnvironmentWatcherRunning(state);
    const desktopScanHealthy = desktopResult.status === 'fulfilled';
    const transcriptScanHealthy = !resolution.projectsDirectoryAvailable ||
      transcriptResult.status === 'fulfilled';
    const healthy = resolution.configDirectoryAvailable &&
      resolution.projectsDirectoryAvailable && desktopScanHealthy &&
      transcriptScanHealthy && watching && watcherError === null;
    if (desktopResult.status === 'fulfilled' || transcriptResult.status === 'fulfilled') {
      this.setEnvironmentStatus(state, { ...state.status, lastSuccessfulScanAt: iso(observedAt) });
    }
    if (healthy) {
      this.cancelEnvironmentRetry(state);
      state.retryAttempt = 0;
      this.setEnvironmentStatus(state, {
        ...state.status,
        state: 'watching',
        watching: true,
        nextRetryAt: null,
        error: null
      });
    } else {
      const missingMessage = !resolution.configDirectoryAvailable
        ? 'Claude config directory is unavailable or unsafe'
        : !resolution.projectsDirectoryAvailable
          ? 'Claude projects directory has not been created yet'
          : watcherError !== null
            ? boundedError(watcherError)
            : desktopResult.status === 'rejected'
              ? boundedError(desktopResult.reason)
            : transcriptResult.status === 'rejected'
              ? boundedError(transcriptResult.reason)
              : 'Claude directory watcher is not running';
      const nextState: EyesOnAgentsClaudeDirectoryState =
        watching && roots.desktopRoots.length > 0
          ? 'degraded'
          : resolution.configDirectoryAvailable && !resolution.projectsDirectoryAvailable
            ? 'waiting'
            : 'retrying';
      this.setEnvironmentStatus(state, {
        ...state.status,
        state: nextState,
        watching,
        error: nextState === 'waiting' ? null : missingMessage
      });
      this.scheduleEnvironmentRetry(state, generation);
    }
    if (changed) this.dependencies.broadcastChanged?.();
    return { changed };
  }

  private async scanAllDesktop(
    roots: ClaudeObservationRoots,
    observedAt: number
  ): Promise<DesktopInventoryScanResult> {
    const rows: EyesOnAgentsClaudeInventoryThread[] = [];
    const discovery = await discoverClaudeDesktopInventory(roots.desktopRoots);
    const candidates = discovery.candidates;
    const withinLimit = isClaudeInventoryScanComplete(
      candidates.length + discovery.tombstones.length
    );
    const safeForDeletion = discovery.complete && withinLimit;
    for (let page = 0; page < MAX_FULL_PAGES && page * PAGE_SIZE < candidates.length; page += 1) {
      rows.push(...await scanClaudeDesktopCandidates(
        candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), observedAt
      ));
    }
    return {
      rows,
      complete: safeForDeletion,
      deletion: {
        tombstones: safeForDeletion
          ? scanClaudeDesktopTombstones(discovery.tombstones, observedAt)
          : [],
        healthyScopeKeys: safeForDeletion ? discovery.healthyScopeKeys : [],
        completeSnapshot: safeForDeletion,
        observedAt
      }
    };
  }

  private async scanAllTranscripts(
    roots: ClaudeObservationRoots,
    observedAt: number
  ): Promise<InventoryScanResult> {
    const rows: EyesOnAgentsClaudeInventoryThread[] = [];
    const candidates = await discoverClaudeTranscriptCandidates(roots.projectsRoot);
    for (let page = 0; page < MAX_FULL_PAGES && page * PAGE_SIZE < candidates.length; page += 1) {
      rows.push(...await scanClaudeTranscriptCandidates(
        roots.projectsRoot,
        candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
        observedAt
      ));
    }
    return { rows, complete: isClaudeInventoryScanComplete(candidates.length) };
  }

  private async scanPollDesktop(
    state: ClaudeEnvironmentObservationState,
    roots: ClaudeObservationRoots,
    observedAt: number
  ): Promise<DesktopInventoryScanResult> {
    const discovery = await discoverClaudeDesktopInventory(roots.desktopRoots);
    const candidates = discovery.candidates;
    const safeForDeletion = discovery.complete && isClaudeInventoryScanComplete(
      candidates.length + discovery.tombstones.length
    );
    const hotCandidates = candidates.slice(0, POLL_HOT_SIZE);
    const coldCandidates = candidates.slice(
      state.desktopColdOffset,
      state.desktopColdOffset + PAGE_SIZE - POLL_HOT_SIZE
    );
    const [hot, cold] = await Promise.all([
      scanClaudeDesktopCandidates(hotCandidates, observedAt),
      scanClaudeDesktopCandidates(coldCandidates, observedAt)
    ]);
    state.desktopColdOffset = coldCandidates.length < PAGE_SIZE - POLL_HOT_SIZE
      ? POLL_HOT_SIZE
      : state.desktopColdOffset + PAGE_SIZE - POLL_HOT_SIZE;
    return {
      rows: [...hot, ...cold],
      complete: false,
      deletion: {
        tombstones: safeForDeletion
          ? scanClaudeDesktopTombstones(discovery.tombstones, observedAt)
          : [],
        healthyScopeKeys: safeForDeletion ? discovery.healthyScopeKeys : [],
        completeSnapshot: false,
        observedAt
      }
    };
  }

  private async scanPollTranscripts(
    state: ClaudeEnvironmentObservationState,
    roots: ClaudeObservationRoots,
    observedAt: number
  ): Promise<InventoryScanResult> {
    const candidates = await discoverClaudeTranscriptCandidates(roots.projectsRoot);
    const hotCandidates = candidates.slice(0, POLL_HOT_SIZE);
    const coldCandidates = candidates.slice(
      state.transcriptColdOffset,
      state.transcriptColdOffset + PAGE_SIZE - POLL_HOT_SIZE
    );
    const [hot, cold] = await Promise.all([
      scanClaudeTranscriptCandidates(roots.projectsRoot, hotCandidates, observedAt),
      scanClaudeTranscriptCandidates(roots.projectsRoot, coldCandidates, observedAt)
    ]);
    state.transcriptColdOffset = coldCandidates.length < PAGE_SIZE - POLL_HOT_SIZE
      ? POLL_HOT_SIZE
      : state.transcriptColdOffset + PAGE_SIZE - POLL_HOT_SIZE;
    return { rows: [...hot, ...cold], complete: false };
  }
}
