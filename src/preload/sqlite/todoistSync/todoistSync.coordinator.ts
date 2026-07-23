// Runtime owner: the hidden Core SQLite preload process.
import {
  TODOIST_SYNC_INTERVAL_MAX_SECONDS,
  TODOIST_SYNC_INTERVAL_MIN_SECONDS,
} from '@shared/todoistSync/todoistSync.contract';
import type {
  TodoistSyncClockCheckRequested,
  TodoistSyncCommand,
  TodoistSyncResponse,
  TodoistSyncStatus,
} from '@shared/todoistSync/todoistSync.type';
import { TodoistSyncHttpError } from './todoistSync.client';
import {
  TodoistSyncGenerationFenceError,
  type TodoistSyncOutboxBatch,
} from './todoistSync.repository';

export interface TodoistSyncRunGeneration {
  session_generation: number;
  clock_generation: number;
}

export interface TodoistSyncCoordinatorRepository {
  setMutationCommittedListener(listener: (() => void) | null): void;
  getSyncState(): Promise<{
    sync_token: string;
    snowflake_node_id: number | null;
    interval_seconds: number;
    bootstrap_catchup_pending: number;
  }>;
  getDiagnostics(): Promise<{
    pending: number;
    failed: number;
    last_success_at: number | null;
    last_error: string | null;
  }>;
  hasClockRejectedBatch(): Promise<boolean>;
  takePendingBatch(): Promise<TodoistSyncOutboxBatch | null>;
  applySyncResponse(
    response: TodoistSyncResponse,
    batch: TodoistSyncOutboxBatch | null,
    isCommitAllowed?: () => boolean,
  ): Promise<void>;
  hasPendingCommands(): Promise<boolean>;
  markClockRejected(batch: TodoistSyncOutboxBatch, isCommitAllowed?: () => boolean): Promise<void>;
  releaseTransientBatch(batchId: string): Promise<void>;
  resetSyncTokenForBootstrap(isCommitAllowed?: () => boolean): Promise<void>;
  recordSyncError(message: string, isCommitAllowed?: () => boolean): Promise<void>;
}

export interface TodoistSyncCoordinatorClient {
  sync(syncToken: string, commands: TodoistSyncCommand[]): Promise<TodoistSyncResponse>;
  dispose(): void;
}

export interface TodoistSyncScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface TodoistSyncCoordinatorOptions {
  repository: TodoistSyncCoordinatorRepository;
  client: TodoistSyncCoordinatorClient;
  sessionGeneration: number;
  captureGeneration: () => TodoistSyncRunGeneration;
  isGenerationCurrent: (generation: TodoistSyncRunGeneration) => boolean;
  isClockWrong: () => boolean;
  onClockCheckRequested?: (payload: TodoistSyncClockCheckRequested) => void;
  onStatusUpdated?: () => void;
  scheduler?: TodoistSyncScheduler;
}

type TodoistSyncRunOutcome = 'schedule' | 'stale' | 'paused';

const defaultScheduler: TodoistSyncScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

export class TodoistSyncCoordinator {
  private readonly repository: TodoistSyncCoordinatorRepository;
  private readonly client: TodoistSyncCoordinatorClient;
  private readonly sessionGeneration: number;
  private readonly captureGeneration: () => TodoistSyncRunGeneration;
  private readonly isGenerationCurrent: (generation: TodoistSyncRunGeneration) => boolean;
  private readonly isClockWrong: () => boolean;
  private readonly onClockCheckRequested: (payload: TodoistSyncClockCheckRequested) => void;
  private readonly onStatusUpdated: () => void;
  private readonly scheduler: TodoistSyncScheduler;
  private timer: unknown | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  private disposed = false;
  private requestGeneration = 0;
  private invalidTokenRecoveryUsed = false;
  private transientFailures = 0;
  private syncing = false;

  constructor(options: TodoistSyncCoordinatorOptions) {
    this.repository = options.repository;
    this.client = options.client;
    this.sessionGeneration = options.sessionGeneration;
    this.captureGeneration = options.captureGeneration;
    this.isGenerationCurrent = options.isGenerationCurrent;
    this.isClockWrong = options.isClockWrong;
    this.onClockCheckRequested = options.onClockCheckRequested ?? ((payload) => {
      xpcMain.broadcast('todoist-sync/clock-check-requested', payload);
    });
    this.onStatusUpdated = options.onStatusUpdated ?? (() => {
      xpcMain.broadcast('todoist-sync/status_updated');
    });
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.repository.setMutationCommittedListener(() => this.trigger());
  }

  start(): void {
    this.trigger();
  }

  trigger(): void {
    if (this.disposed || this.isClockWrong()) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    if (this.timer) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    const running = this.runCycle();
    this.running = running;
    const settle = (): void => {
      if (this.running !== running) return;
      this.running = null;
      if (this.disposed) return;
      if (this.rerun) {
        this.rerun = false;
        this.trigger();
      }
    };
    void running.then(settle, settle);
  }

  async getStatus(clockState: TodoistSyncStatus['clock_state']): Promise<TodoistSyncStatus> {
    const diagnostics = await this.repository.getDiagnostics();
    return {
      active: !this.disposed,
      syncing: this.syncing,
      pull_only: await this.repository.hasClockRejectedBatch(),
      pending_count: diagnostics.pending,
      failed_count: diagnostics.failed,
      last_success_at: diagnostics.last_success_at,
      last_error: diagnostics.last_error,
      clock_state: clockState,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.repository.setMutationCommittedListener(null);
    if (this.timer) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    this.client.dispose();
    await this.running?.catch(() => undefined);
  }

  private async runCycle(): Promise<void> {
    const outcome = await this.runLoop();
    if (outcome === 'schedule' && !this.disposed && !this.rerun && !this.isClockWrong()) {
      await this.scheduleRegular();
    }
  }

  private async runLoop(): Promise<TodoistSyncRunOutcome> {
    if (this.isClockWrong() || this.disposed) return 'paused';
    this.syncing = true;
    this.onStatusUpdated();
    let batch: TodoistSyncOutboxBatch | null = null;
    let generation: TodoistSyncRunGeneration | null = null;
    try {
      let continuation = true;
      let pages = 0;
      while (continuation && !this.disposed && !this.isClockWrong()) {
        pages += 1;
        if (pages > 10_000) throw new Error('[todoist sync] refusing an unbounded pagination loop');
        const pullOnly = await this.repository.hasClockRejectedBatch();
        batch = pullOnly ? null : await this.repository.takePendingBatch();
        const state = await this.repository.getSyncState();
        generation = this.captureGeneration();
        if (!this.canCommit(generation)) {
          await this.releaseBatch(batch);
          batch = null;
          return 'stale';
        }
        const response = await this.client.sync(state.sync_token, batch?.commands ?? []);
        if (!this.canCommit(generation)) {
          await this.releaseBatch(batch);
          batch = null;
          return 'stale';
        }
        await this.repository.applySyncResponse(response, batch, () => this.canCommit(generation!));
        batch = null;
        this.transientFailures = 0;
        this.invalidTokenRecoveryUsed = false;
        const nextState = await this.repository.getSyncState();
        continuation = response.has_more || nextState.bootstrap_catchup_pending === 1 ||
          (!pullOnly && await this.repository.hasPendingCommands());
      }
      return this.isClockWrong() ? 'paused' : 'schedule';
    } catch (error) {
      if (error instanceof TodoistSyncGenerationFenceError || (generation && !this.canCommit(generation))) {
        await this.releaseBatch(batch);
        batch = null;
        return 'stale';
      }
      if (this.disposed || (error as Error).name === 'AbortError') {
        await this.releaseBatch(batch);
        batch = null;
        return 'stale';
      }
      if (error instanceof TodoistSyncHttpError && error.envelope.code === 'CLOCK_SKEW' && batch) {
        try {
          await this.repository.markClockRejected(batch, () => this.canCommit(generation!));
        } catch (markError) {
          if (markError instanceof TodoistSyncGenerationFenceError) {
            await this.releaseBatch(batch);
            batch = null;
            return 'stale';
          }
          throw markError;
        }
        batch = null;
        const payload = {
          session_generation: this.sessionGeneration,
          request_generation: ++this.requestGeneration,
        };
        this.onClockCheckRequested(payload);
        this.rerun = true;
        return 'paused';
      }
      await this.releaseBatch(batch);
      batch = null;
      if (error instanceof TodoistSyncHttpError && error.envelope.code === 'SYNC_TOKEN_INVALID' && !this.invalidTokenRecoveryUsed) {
        try {
          await this.repository.resetSyncTokenForBootstrap(() => this.canCommit(generation!));
        } catch (resetError) {
          if (resetError instanceof TodoistSyncGenerationFenceError) return 'stale';
          throw resetError;
        }
        this.invalidTokenRecoveryUsed = true;
        this.rerun = true;
        return 'paused';
      }
      this.transientFailures += 1;
      const recordGeneration = generation;
      try {
        await this.repository.recordSyncError(
          error instanceof Error ? error.message : String(error),
          recordGeneration ? () => this.canCommit(recordGeneration) : undefined,
        );
      } catch (recordError) {
        if (recordError instanceof TodoistSyncGenerationFenceError) return 'stale';
        throw recordError;
      }
      return 'schedule';
    } finally {
      this.syncing = false;
      this.onStatusUpdated();
    }
  }

  private canCommit(generation: TodoistSyncRunGeneration): boolean {
    return !this.disposed && !this.isClockWrong() && this.isGenerationCurrent(generation);
  }

  private async releaseBatch(batch: TodoistSyncOutboxBatch | null): Promise<void> {
    if (batch) await this.repository.releaseTransientBatch(batch.id);
  }

  private async scheduleRegular(): Promise<void> {
    if (this.disposed || this.isClockWrong()) return;
    const state = await this.repository.getSyncState();
    if (this.disposed || this.isClockWrong() || this.rerun) return;
    const baseSeconds = Math.max(
      TODOIST_SYNC_INTERVAL_MIN_SECONDS,
      Math.min(TODOIST_SYNC_INTERVAL_MAX_SECONDS, state.interval_seconds),
    );
    const baseMs = baseSeconds * 1000;
    const failureMs = Math.min(
      TODOIST_SYNC_INTERVAL_MAX_SECONDS * 1000,
      baseMs * Math.max(1, 2 ** Math.min(5, this.transientFailures)),
    );
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.trigger();
    }, failureMs);
  }
}
