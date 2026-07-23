// Runtime owner: the hidden Core SQLite preload process.
import type {
  TodoistSyncActivateParams,
  TodoistSyncActivationResult,
  TodoistSyncClockCheckParams,
  TodoistSyncClockCheckResult,
  TodoistSyncClockContext,
  TodoistSyncStatus,
} from '@shared/todoistSync/todoistSync.type';
import {
  assertTodoistSyncDatabaseIsolation,
  resolveTodoistSyncDatabasePaths,
  TodoistSyncDatabase,
} from './todoistSync.database';
import { getOrCreateTodoistSyncRuntimePassword } from './todoistSyncPassword.service';
import { TodoistSyncSnowflakeService } from './todoistSyncSnowflake.service';
import {
  TodoistSyncGenerationFenceError,
  TodoistSyncRepository,
} from './todoistSync.repository';
import { TodoistSyncClient } from './todoistSync.client';
import {
  TodoistSyncCoordinator,
  type TodoistSyncRunGeneration,
} from './todoistSync.coordinator';
import {
  TodoistSyncClockService,
  TodoistSyncClockStateStore,
} from './todoistSyncClock.service';

export interface TodoistSyncSessionCoordinator {
  start(): void;
  trigger(): void;
  getStatus(clockState: TodoistSyncStatus['clock_state']): Promise<TodoistSyncStatus>;
  dispose(): Promise<void>;
}

export interface TodoistSyncSessionRuntime {
  database: { close(): void };
  repository: TodoistSyncRepository;
  coordinator: TodoistSyncSessionCoordinator;
}

export interface TodoistSyncSessionRuntimeContext {
  sessionGeneration: number;
  captureGeneration: () => TodoistSyncRunGeneration;
  isGenerationCurrent: (generation: TodoistSyncRunGeneration) => boolean;
  isClockWrong: () => boolean;
}

export interface TodoistSyncSessionServiceOptions {
  clock?: TodoistSyncClockService;
  createRuntime?: (
    params: TodoistSyncActivateParams,
    context: TodoistSyncSessionRuntimeContext,
  ) => Promise<TodoistSyncSessionRuntime>;
}

interface ActiveTodoistSyncSession extends TodoistSyncSessionRuntime {
  identity: string;
  generation: number;
}

const assertParams = (params: TodoistSyncActivateParams): TodoistSyncActivateParams => {
  if (!params || typeof params !== 'object') throw new Error('[todoist sync] activation parameters are required');
  if (!params.coreToken?.trim()) throw new Error('[todoist sync] coreToken is required');
  if (!Number.isSafeInteger(params.customerId) || params.customerId < 1) throw new Error('[todoist sync] customerId is invalid');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(params.deviceId)) throw new Error('[todoist sync] deviceId is invalid');
  return params;
};

export class TodoistSyncSessionService {
  private active: ActiveTodoistSyncSession | null = null;
  private generation = 0;
  private transition: Promise<void> = Promise.resolve();
  private latestClockRequestGeneration = 0;
  private clock: TodoistSyncClockService | null = null;
  private readonly createRuntime: (
    params: TodoistSyncActivateParams,
    context: TodoistSyncSessionRuntimeContext,
  ) => Promise<TodoistSyncSessionRuntime>;

  constructor(options: TodoistSyncSessionServiceOptions = {}) {
    this.clock = options.clock ?? null;
    this.createRuntime = options.createRuntime ?? (async (params, context) => (
      await this.createDefaultRuntime(params, context)
    ));
  }

  activate(paramsValue: TodoistSyncActivateParams): Promise<TodoistSyncActivationResult> {
    let params: TodoistSyncActivateParams;
    try {
      params = assertParams(paramsValue);
    } catch (error) {
      return Promise.resolve({
        status: 'failed',
        error: error instanceof Error ? error.message : '[todoist sync] activation parameters are invalid',
      });
    }
    const generation = ++this.generation;
    return this.enqueue(async () => await this.activateGeneration(params, generation)).catch((error) => ({
      status: 'failed',
      error: error instanceof Error ? error.message : '[todoist sync] runtime activation failed',
    }));
  }

  deactivate(): Promise<void> {
    this.generation += 1;
    this.latestClockRequestGeneration += 1;
    return this.enqueue(async () => await this.closeActive());
  }

  async getRepositoryAsync(): Promise<TodoistSyncRepository> {
    await this.transition;
    return this.getRepository();
  }

  getRepository(): TodoistSyncRepository {
    if (!this.active) throw new Error('[todoist sync] no eligible customer session is active');
    return this.active.repository;
  }

  getClockContext(): TodoistSyncClockContext {
    return { session_generation: this.generation, clock_state: this.getClock().getState() };
  }

  async checkClock(params: TodoistSyncClockCheckParams): Promise<TodoistSyncClockCheckResult> {
    if (params.session_generation !== this.generation || !Number.isSafeInteger(params.request_generation)) {
      return { status: 'stale', clock_state: this.getClock().getState() };
    }
    if (params.request_generation <= this.latestClockRequestGeneration) {
      return { status: 'stale', clock_state: this.getClock().getState() };
    }
    this.latestClockRequestGeneration = params.request_generation;
    const sessionGeneration = this.generation;
    const requestGeneration = params.request_generation;
    const clock = this.getClock();
    const result = await clock.check(() => (
      sessionGeneration === this.generation && requestGeneration === this.latestClockRequestGeneration
    ));
    const clockGeneration = clock.getGeneration();
    const isCurrent = (): boolean => (
      sessionGeneration === this.generation &&
      requestGeneration === this.latestClockRequestGeneration &&
      clockGeneration === clock.getGeneration()
    );
    if (!isCurrent()) return { status: 'stale', clock_state: clock.getState() };
    if (result.status === 'healthy' && this.active?.generation === sessionGeneration) {
      try {
        await this.active.repository.recoverClockRejected(
          result.clock_state.trusted_time_ms,
          Date.now(),
          isCurrent,
        );
        if (!isCurrent()) return { status: 'stale', clock_state: clock.getState() };
        this.active.coordinator.trigger();
      } catch (error) {
        if (error instanceof TodoistSyncGenerationFenceError) {
          return { status: 'stale', clock_state: clock.getState() };
        }
        throw error;
      }
    }
    return result;
  }

  async getStatus(): Promise<TodoistSyncStatus> {
    if (!this.active) {
      return { active: false, syncing: false, pull_only: false, pending_count: 0, failed_count: 0, last_success_at: null, last_error: null, clock_state: this.getClock().getState() };
    }
    return await this.active.coordinator.getStatus(this.getClock().getState());
  }

  requestSync(): void {
    this.active?.coordinator.trigger();
  }

  getGeneration(): number {
    return this.generation;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transition.catch(() => undefined).then(operation);
    this.transition = result.then(() => undefined, () => undefined);
    return result;
  }

  private async activateGeneration(
    params: TodoistSyncActivateParams,
    generation: number,
  ): Promise<TodoistSyncActivationResult> {
    const identity = `${params.customerId}:${params.deviceId}`;
    await this.closeActive();
    if (generation !== this.generation) {
      return { status: 'failed', error: '[todoist sync] activation was superseded' };
    }
    const context: TodoistSyncSessionRuntimeContext = {
      sessionGeneration: generation,
      captureGeneration: () => ({
        session_generation: this.generation,
        clock_generation: this.getClock().getGeneration(),
      }),
      isGenerationCurrent: (value) => (
        value.session_generation === this.generation &&
        value.clock_generation === this.getClock().getGeneration()
      ),
      isClockWrong: () => this.getClock().isWrong(),
    };
    const runtime = await this.createRuntime(params, context);
    if (generation !== this.generation) {
      await runtime.coordinator.dispose();
      runtime.database.close();
      return { status: 'failed', error: '[todoist sync] activation was superseded' };
    }
    this.active = { identity, generation, ...runtime };
    runtime.coordinator.start();
    return {
      status: 'active',
      customerId: params.customerId,
      deviceId: params.deviceId,
      sessionGeneration: generation,
    };
  }

  private async createDefaultRuntime(
    params: TodoistSyncActivateParams,
    context: TodoistSyncSessionRuntimeContext,
  ): Promise<TodoistSyncSessionRuntime> {
    const paths = resolveTodoistSyncDatabasePaths(app.getPath('userData'), params.customerId);
    assertTodoistSyncDatabaseIsolation(paths, app.getPath('userData'));
    const password = getOrCreateTodoistSyncRuntimePassword(paths);
    const database = new TodoistSyncDatabase(paths.databasePath, password);
    try {
      const state = database.raw.prepare('SELECT snowflake_node_id FROM todo_sync_state WHERE customer_id=?').get(String(params.customerId)) as { snowflake_node_id: number | null } | undefined;
      const ids = new TodoistSyncSnowflakeService(state?.snowflake_node_id ?? null);
      const repository = new TodoistSyncRepository(database, String(params.customerId), params.deviceId, ids);
      await repository.initialize();
      const client = new TodoistSyncClient({ coreToken: params.coreToken });
      const coordinator = new TodoistSyncCoordinator({
        repository,
        client,
        sessionGeneration: context.sessionGeneration,
        captureGeneration: context.captureGeneration,
        isGenerationCurrent: context.isGenerationCurrent,
        isClockWrong: context.isClockWrong,
      });
      return { database, repository, coordinator };
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private async closeActive(): Promise<void> {
    const active = this.active;
    this.active = null;
    if (!active) return;
    await active.coordinator.dispose();
    active.database.close();
  }

  private getClock(): TodoistSyncClockService {
    if (!this.clock) this.clock = new TodoistSyncClockService(new TodoistSyncClockStateStore(app.getPath('userData')));
    return this.clock;
  }
}

export const todoistSyncSession = new TodoistSyncSessionService();
