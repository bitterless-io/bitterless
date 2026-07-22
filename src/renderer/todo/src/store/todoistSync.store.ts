import { reactive } from 'vue';
import type {
  TodoistSyncClockCheckRequested,
  TodoistSyncClockState,
  TodoistSyncFailure,
  TodoistSyncStatus,
} from '@shared/todoistSync/todoistSync.type';
import {
  todoistSyncClockEmitter,
  todoistSyncStatusEmitter,
} from '../emitter/todoistSync.emitter';

class TodoistSyncState {
  clockState: TodoistSyncClockState | null = null;
  status: TodoistSyncStatus | null = null;
  failures: TodoistSyncFailure[] = [];
  checkingClock = false;
  private sessionGeneration = 0;
  private requestGeneration = 0;

  async initialize(): Promise<void> {
    const context = await todoistSyncClockEmitter.getContext();
    this.sessionGeneration = context.session_generation;
    this.clockState = context.clock_state;
    await Promise.all([this.checkClock(), this.refreshStatus()]);
  }

  async checkClock(requestGeneration?: number): Promise<void> {
    if (this.checkingClock) return;
    this.checkingClock = true;
    const generation = requestGeneration === undefined
      ? ++this.requestGeneration
      : Math.max(++this.requestGeneration, requestGeneration);
    try {
      const result = await todoistSyncClockEmitter.check({
        session_generation: this.sessionGeneration,
        request_generation: generation,
      });
      if (result.status !== 'stale') this.clockState = result.clock_state;
      await this.refreshStatus();
    } finally {
      this.checkingClock = false;
    }
  }

  async handleClockCheckRequested(payload: TodoistSyncClockCheckRequested): Promise<void> {
    if (payload.session_generation !== this.sessionGeneration) return;
    await this.checkClock(payload.request_generation);
  }

  async refreshStatus(): Promise<void> {
    const status = await todoistSyncStatusEmitter.getStatus();
    this.status = status;
    this.clockState = status.clock_state;
    this.failures = status.active ? await todoistSyncStatusEmitter.getFailures() : [];
  }

  async requestSync(): Promise<void> {
    await todoistSyncStatusEmitter.requestSync();
    await this.refreshStatus();
  }

  async retry(uuid: string): Promise<void> {
    await todoistSyncStatusEmitter.retryFailed({ uuid });
    await this.refreshStatus();
  }

  async discard(uuid: string): Promise<void> {
    await todoistSyncStatusEmitter.discardFailed({ uuid });
    await this.refreshStatus();
  }

  async openDateTimeSettings(): Promise<void> {
    await todoistSyncClockEmitter.openDateTimeSettings();
  }
}

export const todoistSyncStore = reactive<TodoistSyncState>(new TodoistSyncState());
