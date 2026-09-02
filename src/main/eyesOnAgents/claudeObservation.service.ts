import type {
  EyesOnAgentsClaudeDeletionReconciliation,
  EyesOnAgentsClaudeDirectoryStatus,
  EyesOnAgentsClaudeEnvironment,
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

const iso = (value: number): string => new Date(value).toISOString();
const boundedError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown Claude directory error');
  return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
};

const stoppedStatus = (): EyesOnAgentsClaudeDirectoryStatus => ({
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
});

// The Claude directory config service now stores a list of named environments (task 084); this
// service still watches only environments[0] (the default) until task 085 fans out to the full
// list, so it keeps comparing that one environment's mode/configDirectory.
const sameConfig = (
  left: EyesOnAgentsClaudeEnvironment | null,
  right: EyesOnAgentsClaudeEnvironment
): boolean => left !== null && left.mode === right.mode &&
  left.configDirectory === right.configDirectory;

export class ClaudeObservationService {
  private refreshPromise: Promise<EyesOnAgentsRepositoryMutationResult> | null = null;
  private refreshRequestedMode: 'full' | 'poll' | null = null;
  private desktopColdOffset = POLL_HOT_SIZE;
  private transcriptColdOffset = POLL_HOT_SIZE;
  private started = false;
  private desiredStarted = false;
  private generation = 0;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private appliedConfig: EyesOnAgentsClaudeEnvironment | null = null;
  private appliedResolution: ClaudeDirectoryResolution | null = null;
  private capabilityClearPending = false;
  private retryTimer: RetryTimer | null = null;
  private retryAttempt = 0;
  private status: EyesOnAgentsClaudeDirectoryStatus = stoppedStatus();

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
    watcher: {
      start(): Promise<void>;
      stop(): Promise<void>;
      updateRoots(roots: ClaudeObservationRoots): Promise<void>;
      isRunning?(): boolean;
    };
    broadcastChanged?: () => void;
    now?: () => number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
  }) {}

  getDirectoryStatus(): EyesOnAgentsClaudeDirectoryStatus {
    return { ...this.status };
  }

  requireCanonicalTranscript(transcriptPath: string, expectedThreadId: string): string {
    const projectsRoot = this.appliedResolution?.roots.projectsRoot;
    if (!projectsRoot) throw new Error('Claude projects root is unavailable');
    return requireCanonicalClaudeTranscript({ transcriptPath, projectsRoot, expectedThreadId });
  }

  async start(): Promise<void> {
    this.desiredStarted = true;
    await this.runLifecycle(async () => {
      if (!this.desiredStarted || this.started) return;
      this.started = true;
      const generation = ++this.generation;
      this.appliedConfig = null;
      this.appliedResolution = null;
      this.capabilityClearPending = true;
      this.setStatus({
        mode: 'automatic',
        configuredDirectory: null,
        effectiveDirectory: null,
        projectsDirectory: null,
        desktopDirectoryCount: 0,
        state: 'starting',
        watching: false,
        lastScanAt: null,
        lastSuccessfulScanAt: null,
        nextRetryAt: null,
        error: null
      });
      await this.hydrateAndRecover(generation);
    });
  }

  async stop(): Promise<void> {
    this.desiredStarted = false;
    const shouldStop = this.started || this.status.state !== 'stopped';
    this.started = false;
    this.generation += 1;
    this.cancelRetry();
    this.refreshRequestedMode = null;
    await this.runLifecycle(async () => {
      if (!shouldStop && this.status.state === 'stopped') return;
      this.started = false;
      let stopError: unknown = null;
      try {
        await this.settleRefreshAndStopWatcher(false);
      } catch (error) {
        stopError = error;
      }
      this.setStatus({
        ...this.status,
        state: 'stopped',
        watching: false,
        nextRetryAt: null,
        ...(stopError === null ? {} : { error: boundedError(stopError) })
      });
      if (stopError !== null) throw stopError;
    });
  }

  // These two methods still act on the sole default environment (environments[0]) — the
  // multi-environment CRUD surface added by task 084 is consumed per-environment starting with
  // task 085's watcher fan-out, not here. When the config service has no currently-known
  // environment (never hydrated, or a malformed saved value), no id is available yet; an empty
  // id is passed through and the config service's own recovery branch resets to a fresh default
  // environment, exactly like the pre-084 single-directory recovery contract.
  async changeDirectory(): Promise<void> {
    await this.runLifecycle(async () => {
      const next = await this.requireDirectoryConfig().chooseCustomDirectory({
        id: this.resolveDefaultEnvironmentId()
      });
      if (next === null) return;
      await this.applyPersistedConfig(next);
    });
  }

  async useAutomaticDirectory(): Promise<void> {
    await this.runLifecycle(async () => {
      const next = await this.requireDirectoryConfig().useAutomatic({
        id: this.resolveDefaultEnvironmentId()
      });
      await this.applyPersistedConfig(next);
    });
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

  async retryDirectory(): Promise<void> {
    await this.runLifecycle(async () => {
      if (!this.started) return;
      this.cancelRetry();
      this.retryAttempt = 0;
      const generation = this.generation;
      this.setStatus({ ...this.status, state: 'retrying', nextRetryAt: null });
      if (this.appliedConfig === null) await this.hydrateAndRecover(generation);
      else await this.recover('full', generation);
    });
  }

  async handleWatcherFailure(error: Error): Promise<void> {
    const generation = this.generation;
    await this.runLifecycle(async () => {
      if (!this.isCurrent(generation) || this.appliedConfig === null || this.isWatcherRunning()) return;
      this.setStatus({
        ...this.status,
        state: 'retrying',
        watching: false,
        error: boundedError(error)
      });
      this.scheduleRetry(generation);
    });
  }

  async invalidate(): Promise<void> {
    if (!this.started || this.appliedConfig === null) return;
    await this.refresh('poll');
  }

  async refresh(mode: 'full' | 'poll'): Promise<EyesOnAgentsRepositoryMutationResult> {
    if (!this.started) {
      if (!this.desiredStarted) return { changed: false };
      await this.start();
      return { changed: false };
    }
    if (this.appliedConfig === null || this.capabilityClearPending) return { changed: false };
    if (this.refreshPromise) {
      if (mode === 'full' || this.refreshRequestedMode === null) this.refreshRequestedMode = mode;
      return await this.refreshPromise;
    }
    const generation = this.generation;
    const operation = (async (): Promise<EyesOnAgentsRepositoryMutationResult> => {
      let nextMode = mode;
      let result: EyesOnAgentsRepositoryMutationResult = { changed: false };
      do {
        this.refreshRequestedMode = null;
        const current = await this.performRefresh(nextMode, generation);
        result = { changed: result.changed || current.changed };
        nextMode = this.refreshRequestedMode ?? 'poll';
      } while (this.refreshRequestedMode !== null && this.isCurrent(generation));
      return result;
    })();
    this.refreshPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.refreshPromise === operation) this.refreshPromise = null;
    }
  }

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

  private async hydrateAndRecover(generation: number): Promise<void> {
    try {
      const hydration = await this.hydrateDirectoryConfig();
      if (!this.isCurrent(generation)) return;
      if (hydration.state === 'invalid') {
        this.appliedConfig = null;
        this.appliedResolution = null;
        this.cancelRetry();
        this.setStatus({
          mode: 'automatic',
          configuredDirectory: null,
          effectiveDirectory: null,
          projectsDirectory: null,
          desktopDirectoryCount: 0,
          state: 'error',
          watching: false,
          lastScanAt: null,
          lastSuccessfulScanAt: null,
          nextRetryAt: null,
          error: boundedError(hydration.error)
        });
        return;
      }
      // This service still watches only the sole default environment (environments[0]); the
      // config service guarantees the list is never empty.
      this.appliedConfig = hydration.config.environments[0];
      this.capabilityClearPending = true;
      this.retryAttempt = 0;
      await this.recover('full', generation);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.appliedConfig = null;
      this.appliedResolution = null;
      this.setStatus({
        mode: 'automatic',
        configuredDirectory: null,
        effectiveDirectory: null,
        projectsDirectory: null,
        desktopDirectoryCount: 0,
        state: 'retrying',
        watching: false,
        lastScanAt: null,
        lastSuccessfulScanAt: null,
        nextRetryAt: null,
        error: boundedError(error)
      });
      this.scheduleRetry(generation);
    }
  }

  private async applyPersistedConfig(config: EyesOnAgentsClaudeEnvironment): Promise<void> {
    const nextResolution = this.resolve(config);
    if (sameConfig(this.appliedConfig, config)) return;
    if (this.appliedResolution?.effectiveDirectory === nextResolution.effectiveDirectory) {
      this.cancelRetry();
      this.retryAttempt = 0;
      this.appliedConfig = config;
      this.appliedResolution = nextResolution;
      this.updateResolvedStatus(config, nextResolution);
      if (this.started) await this.recover('full', this.generation);
      return;
    }
    const wasStarted = this.started;
    const generation = ++this.generation;
    this.cancelRetry();
    this.refreshRequestedMode = null;
    this.appliedConfig = config;
    this.appliedResolution = nextResolution;
    this.capabilityClearPending = true;
    this.retryAttempt = 0;
    this.desktopColdOffset = POLL_HOT_SIZE;
    this.transcriptColdOffset = POLL_HOT_SIZE;
    this.setStatus({
      mode: config.mode,
      configuredDirectory: config.mode === 'custom' ? config.configDirectory : null,
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
      await this.settleRefreshAndStopWatcher(true);
    } catch (error) {
      replacementError = error;
    }
    if (wasStarted && this.started && this.generation === generation) {
      if (replacementError === null) await this.recover('full', generation);
      else {
        this.setStatus({
          ...this.status,
          state: 'retrying',
          watching: false,
          error: boundedError(replacementError)
        });
        this.scheduleRetry(generation);
      }
    } else if (!wasStarted && !this.started && this.generation === generation) {
      this.setStatus({
        ...this.status,
        state: 'stopped',
        watching: false,
        nextRetryAt: null,
        ...(replacementError === null ? {} : { error: boundedError(replacementError) })
      });
    }
  }

  private async recover(mode: 'full' | 'poll', generation: number): Promise<void> {
    if (!this.isCurrent(generation) || this.appliedConfig === null) return;
    const resolution = this.resolve(this.appliedConfig);
    this.appliedResolution = resolution;
    this.updateResolvedStatus(this.appliedConfig, resolution, this.retryAttempt > 0 ? 'retrying' : 'starting');
    try {
      if (this.capabilityClearPending) {
        const cleared = await this.dependencies.repository.clearClaudeTranscriptCapabilities();
        if (!this.isCurrent(generation)) return;
        this.capabilityClearPending = false;
        if (cleared.changed) this.dependencies.broadcastChanged?.();
      }
      await this.refresh(mode);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      const watching = this.isWatcherRunning();
      this.setStatus({
        ...this.status,
        state: watching ? 'degraded' : 'retrying',
        watching,
        error: boundedError(error)
      });
      this.scheduleRetry(generation);
    }
  }

  private async performRefresh(
    mode: 'full' | 'poll',
    generation: number
  ): Promise<EyesOnAgentsRepositoryMutationResult> {
    if (!this.isCurrent(generation) || this.appliedConfig === null) return { changed: false };
    const observedAt = (this.dependencies.now ?? Date.now)();
    const resolution = this.resolve(this.appliedConfig);
    this.appliedResolution = resolution;
    this.updateResolvedStatus(this.appliedConfig, resolution);
    this.setStatus({ ...this.status, lastScanAt: iso(observedAt) });
    const roots = resolution.roots;
    let watcherError: unknown = null;
    try {
      await this.dependencies.watcher.updateRoots(roots);
      if (!this.isCurrent(generation)) return { changed: false };
      if (roots.desktopRoots.length > 0 || roots.projectsRoot !== null) {
        await this.dependencies.watcher.start();
      } else {
        await this.dependencies.watcher.stop();
      }
    } catch (error) {
      watcherError = error;
      await this.dependencies.watcher.stop().catch(() => undefined);
    }
    if (!this.isCurrent(generation)) return { changed: false };
    const [desktopResult, transcriptResult, agentsResult] = await Promise.allSettled([
      mode === 'full'
        ? this.scanAllDesktop(roots, observedAt)
        : this.scanPollDesktop(roots, observedAt),
      mode === 'full'
        ? this.scanAllTranscripts(roots, observedAt)
        : this.scanPollTranscripts(roots, observedAt),
      this.dependencies.agents.poll(observedAt)
    ]);
    if (!this.isCurrent(generation)) return { changed: false };
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
    if (!this.isCurrent(generation)) return { changed: false };
    if (agentsResult.status === 'fulfilled' && agentsResult.value !== null) {
      const result = await this.dependencies.repository.reconcileClaudeAgentStates(agentsResult.value);
      changed = changed || result.changed;
    }
    if (!this.isCurrent(generation)) return { changed: false };
    const watching = this.isWatcherRunning();
    const desktopScanHealthy = desktopResult.status === 'fulfilled';
    const transcriptScanHealthy = !resolution.projectsDirectoryAvailable ||
      transcriptResult.status === 'fulfilled';
    const healthy = resolution.configDirectoryAvailable &&
      resolution.projectsDirectoryAvailable && desktopScanHealthy &&
      transcriptScanHealthy && watching && watcherError === null;
    if (desktopResult.status === 'fulfilled' || transcriptResult.status === 'fulfilled') {
      this.setStatus({ ...this.status, lastSuccessfulScanAt: iso(observedAt) });
    }
    if (healthy) {
      this.cancelRetry();
      this.retryAttempt = 0;
      this.setStatus({
        ...this.status,
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
      const nextState: EyesOnAgentsClaudeDirectoryStatus['state'] =
        watching && roots.desktopRoots.length > 0
          ? 'degraded'
          : resolution.configDirectoryAvailable && !resolution.projectsDirectoryAvailable
            ? 'waiting'
            : 'retrying';
      this.setStatus({
        ...this.status,
        state: nextState,
        watching,
        error: nextState === 'waiting' ? null : missingMessage
      });
      this.scheduleRetry(generation);
    }
    if (changed) this.dependencies.broadcastChanged?.();
    return { changed };
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

  private updateResolvedStatus(
    config: EyesOnAgentsClaudeEnvironment,
    resolution: ClaudeDirectoryResolution,
    state?: EyesOnAgentsClaudeDirectoryStatus['state']
  ): void {
    this.setStatus({
      ...this.status,
      mode: config.mode,
      configuredDirectory: config.mode === 'custom' ? config.configDirectory : null,
      effectiveDirectory: resolution.effectiveDirectory || null,
      projectsDirectory: resolution.projectsDirectory || null,
      desktopDirectoryCount: resolution.roots.desktopRoots.length,
      ...(state === undefined ? {} : { state })
    });
  }

  private scheduleRetry(generation: number): void {
    if (!this.isCurrent(generation) || this.retryTimer !== null) return;
    const delay = CLAUDE_DIRECTORY_RETRY_DELAYS_MS[
      Math.min(this.retryAttempt, CLAUDE_DIRECTORY_RETRY_DELAYS_MS.length - 1)
    ];
    this.retryAttempt += 1;
    const nextRetryAt = (this.dependencies.now ?? Date.now)() + delay;
    const setTimer = this.dependencies.setTimer ?? setTimeout;
    this.retryTimer = setTimer(() => {
      this.retryTimer = null;
      if (!this.isCurrent(generation)) return;
      this.setStatus({ ...this.status, state: 'retrying', nextRetryAt: null });
      void this.runLifecycle(async () => {
        if (!this.isCurrent(generation)) return;
        if (this.appliedConfig === null) await this.hydrateAndRecover(generation);
        else await this.recover('full', generation);
      });
    }, delay);
    this.retryTimer.unref?.();
    this.setStatus({ ...this.status, nextRetryAt: iso(nextRetryAt) });
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return;
    (this.dependencies.clearTimer ?? clearTimeout)(this.retryTimer);
    this.retryTimer = null;
  }

  private async settleRefreshAndStopWatcher(stopBeforeJoin: boolean): Promise<void> {
    try {
      if (stopBeforeJoin) {
        await this.dependencies.watcher.stop().catch(() => undefined);
      }
      const inFlightRefresh = this.refreshPromise;
      if (inFlightRefresh) await inFlightRefresh.catch(() => undefined);
    } finally {
      await this.dependencies.watcher.stop();
    }
  }

  private isWatcherRunning(): boolean {
    return this.dependencies.watcher.isRunning?.() ?? true;
  }

  private setStatus(status: EyesOnAgentsClaudeDirectoryStatus): void {
    if (JSON.stringify(this.status) === JSON.stringify(status)) return;
    this.status = status;
    this.dependencies.broadcastChanged?.();
  }

  private runLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private withProject(thread: EyesOnAgentsClaudeInventoryThread): EyesOnAgentsClaudeInventoryThread {
    const project = projectMetadataFromResolution(resolveEyesOnAgentsProject(thread.cwd));
    return { ...thread, ...(project === undefined ? {} : { project }) };
  }

  private isCurrent(generation: number): boolean {
    return this.started && this.generation === generation;
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
      this.desktopColdOffset,
      this.desktopColdOffset + PAGE_SIZE - POLL_HOT_SIZE
    );
    const [hot, cold] = await Promise.all([
      scanClaudeDesktopCandidates(hotCandidates, observedAt),
      scanClaudeDesktopCandidates(coldCandidates, observedAt)
    ]);
    this.desktopColdOffset = coldCandidates.length < PAGE_SIZE - POLL_HOT_SIZE
      ? POLL_HOT_SIZE
      : this.desktopColdOffset + PAGE_SIZE - POLL_HOT_SIZE;
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
    roots: ClaudeObservationRoots,
    observedAt: number
  ): Promise<InventoryScanResult> {
    const candidates = await discoverClaudeTranscriptCandidates(roots.projectsRoot);
    const hotCandidates = candidates.slice(0, POLL_HOT_SIZE);
    const coldCandidates = candidates.slice(
      this.transcriptColdOffset,
      this.transcriptColdOffset + PAGE_SIZE - POLL_HOT_SIZE
    );
    const [hot, cold] = await Promise.all([
      scanClaudeTranscriptCandidates(roots.projectsRoot, hotCandidates, observedAt),
      scanClaudeTranscriptCandidates(roots.projectsRoot, coldCandidates, observedAt)
    ]);
    this.transcriptColdOffset = coldCandidates.length < PAGE_SIZE - POLL_HOT_SIZE
      ? POLL_HOT_SIZE
      : this.transcriptColdOffset + PAGE_SIZE - POLL_HOT_SIZE;
    return { rows: [...hot, ...cold], complete: false };
  }
}
