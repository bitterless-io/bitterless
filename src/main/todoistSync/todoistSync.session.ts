import { app } from 'electron';
import type {
  TodoistSyncActivateParams,
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
import { TodoistSyncRepository } from './todoistSync.repository';
import { TodoistSyncClient } from './todoistSync.client';
import { TodoistSyncCoordinator } from './todoistSync.coordinator';
import {
  TodoistSyncClockService,
  TodoistSyncClockStateStore,
} from './todoistSyncClock.service';

interface ActiveTodoistSyncSession {
  identity: string;
  generation: number;
  database: TodoistSyncDatabase;
  repository: TodoistSyncRepository;
  coordinator: TodoistSyncCoordinator;
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

  activate(paramsValue: TodoistSyncActivateParams): Promise<void> {
    const params = assertParams(paramsValue);
    const generation = ++this.generation;
    return this.enqueue(async () => await this.activateGeneration(params, generation));
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
    const result = await this.getClock().check(() => (
      sessionGeneration === this.generation && requestGeneration === this.latestClockRequestGeneration
    ));
    if (result.status === 'healthy' && this.active?.generation === sessionGeneration) {
      const recovered = await this.active.repository.recoverClockRejected(result.clock_state.trusted_time_ms);
      if (recovered) this.active.coordinator.trigger();
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

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.transition.catch(() => undefined).then(operation);
    this.transition = result.catch(() => undefined);
    return result;
  }

  private async activateGeneration(params: TodoistSyncActivateParams, generation: number): Promise<void> {
    const identity = `${params.customerId}:${params.deviceId}`;
    if (this.active?.identity === identity && this.active.generation === generation) return;
    await this.closeActive();
    if (generation !== this.generation) return;
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
        sessionGeneration: generation,
        isClockWrong: () => this.getClock().isWrong(),
      });
      if (generation !== this.generation) {
        await coordinator.dispose();
        database.close();
        return;
      }
      this.active = { identity, generation, database, repository, coordinator };
      coordinator.start();
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
