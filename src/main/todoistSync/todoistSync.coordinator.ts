import { xpcMain } from 'electron-xpc/main';
import type {
  TodoistSyncClockCheckRequested,
  TodoistSyncStatus,
} from '@shared/todoistSync/todoistSync.type';
import { TodoistSyncClient, TodoistSyncHttpError } from './todoistSync.client';
import type { TodoistSyncOutboxBatch, TodoistSyncRepository } from './todoistSync.repository';

export interface TodoistSyncCoordinatorOptions {
  repository: TodoistSyncRepository;
  client: TodoistSyncClient;
  sessionGeneration: number;
  isClockWrong: () => boolean;
  onClockCheckRequested?: (payload: TodoistSyncClockCheckRequested) => void;
}

export class TodoistSyncCoordinator {
  private readonly repository: TodoistSyncRepository;
  private readonly client: TodoistSyncClient;
  private readonly sessionGeneration: number;
  private readonly isClockWrong: () => boolean;
  private readonly onClockCheckRequested: (payload: TodoistSyncClockCheckRequested) => void;
  private timer: NodeJS.Timeout | null = null;
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
    this.isClockWrong = options.isClockWrong;
    this.onClockCheckRequested = options.onClockCheckRequested ?? ((payload) => {
      xpcMain.broadcast('todoist-sync/clock-check-requested', payload);
    });
    this.repository.setMutationCommittedListener(() => this.trigger());
  }

  start(): void {
    this.trigger();
  }

  trigger(): void {
    if (this.disposed) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = this.runLoop().finally(() => {
      this.running = null;
      if (this.disposed) return;
      if (this.rerun) {
        this.rerun = false;
        this.trigger();
      } else {
        void this.scheduleRegular();
      }
    });
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.client.dispose();
    await this.running?.catch(() => undefined);
  }

  private async runLoop(): Promise<void> {
    if (this.isClockWrong() || this.disposed) return;
    this.syncing = true;
    xpcMain.broadcast('todoist-sync/status_updated');
    let batch: TodoistSyncOutboxBatch | null = null;
    try {
      let continuation = true;
      let pages = 0;
      while (continuation && !this.disposed && !this.isClockWrong()) {
        pages += 1;
        if (pages > 10_000) throw new Error('[todoist sync] refusing an unbounded pagination loop');
        const pullOnly = await this.repository.hasClockRejectedBatch();
        batch = pullOnly ? null : await this.repository.takePendingBatch();
        const state = await this.repository.getSyncState();
        const response = await this.client.sync(state.sync_token, batch?.commands ?? []);
        if (this.disposed) return;
        await this.repository.applySyncResponse(response, batch);
        batch = null;
        this.transientFailures = 0;
        this.invalidTokenRecoveryUsed = false;
        const nextState = await this.repository.getSyncState();
        continuation = response.has_more || nextState.bootstrap_catchup_pending === 1 || (!pullOnly && await this.repository.hasPendingCommands());
      }
    } catch (error) {
      if (this.disposed || (error as Error).name === 'AbortError') return;
      if (error instanceof TodoistSyncHttpError && error.envelope.code === 'CLOCK_SKEW' && batch) {
        await this.repository.markClockRejected(batch);
        batch = null;
        const payload = {
          session_generation: this.sessionGeneration,
          request_generation: ++this.requestGeneration,
        };
        this.onClockCheckRequested(payload);
        return;
      }
      if (batch) await this.repository.releaseTransientBatch(batch.id);
      if (error instanceof TodoistSyncHttpError && error.envelope.code === 'SYNC_TOKEN_INVALID' && !this.invalidTokenRecoveryUsed) {
        this.invalidTokenRecoveryUsed = true;
        await this.repository.resetSyncTokenForBootstrap();
        this.rerun = true;
        return;
      }
      this.transientFailures += 1;
      await this.repository.recordSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      this.syncing = false;
      xpcMain.broadcast('todoist-sync/status_updated');
    }
  }

  private async scheduleRegular(): Promise<void> {
    if (this.disposed) return;
    const state = await this.repository.getSyncState();
    const baseMs = Math.max(10, Math.min(180, state.interval_seconds)) * 1000;
    const failureMs = Math.min(180_000, baseMs * Math.max(1, 2 ** Math.min(5, this.transientFailures)));
    this.timer = setTimeout(() => this.trigger(), failureMs);
  }
}
