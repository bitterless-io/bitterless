// Runtime owner: the hidden Core SQLite preload process.
import { randomUUID } from 'crypto';
import moment from 'moment';
import type {
  McpDomainRow,
  McpSubTodoRow,
  McpTodoEventActor,
  McpTodoEventItem,
  McpTodoEventListResult,
  McpTodoEventType,
  McpTodoRow,
  McpTodoSource,
  McpTodoStatusByIdsResult,
  RestoreDomainResult,
  TodoEntityId,
} from '@shared/mcp/todoMcpDao.type';
import type {
  TodoistSyncCommand,
  TodoistSyncCommandType,
  TodoistSyncDomainResource,
  TodoistSyncOutboxState,
  TodoistSyncResourceType,
  TodoistSyncResponse,
  TodoistSyncSubTodoResource,
  TodoistSyncTodoResource,
} from '@shared/todoistSync/todoistSync.type';
import { TODOIST_SYNC_MAX_FUTURE_MS } from '@shared/todoistSync/todoistSync.contract';
import type {
  TodoDataUpdatedEvent,
  TodoMutationContext,
} from '@shared/todoistSync/todoDataUpdate.shared';
import type {
  TodoistSyncRepositoryDatabase,
  TodoistSyncSqlExecutor,
} from './todoistSync.database';
import {
  assertTodoistSyncEntityId,
  TODOIST_SYNC_SNOWFLAKE_NODE_MISMATCH,
  TodoistSyncSnowflakeService,
} from './todoistSyncSnowflake.service';

interface OutboxRow {
  command_order: number;
  command_uuid: string;
  command_type: TodoistSyncCommandType;
  resource_type: TodoistSyncResourceType;
  resource_id: string;
  parent_resource_id: string | null;
  args_json: string;
  preimage_json: string | null;
  state: TodoistSyncOutboxState;
  batch_id: string | null;
  ack_revision: string | null;
  canonical_resource_type: TodoistSyncResourceType | null;
  canonical_resource_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

interface BaselineRow {
  resource_type: TodoistSyncResourceType;
  resource_id: string;
  parent_resource_id: string | null;
  sync_revision: string;
  payload_json: string;
  reconcile_pending: number;
}

interface EventRow {
  sequence: number;
  type: McpTodoEventType;
  todo_id: TodoEntityId | null;
  domain_id: TodoEntityId | null;
  actor: McpTodoEventActor;
  payload: string;
  created_at: number;
}

type MaterializeResult = 'materialized' | 'removed' | 'deferred';

export interface TodoistSyncOutboxBatch {
  id: string;
  commands: TodoistSyncCommand[];
}

export const TODOIST_SYNC_CORE_CLOCK_DISAGREEMENT =
  '[todoist sync] Core CLOCK_SKEW disagrees with the healthy trusted-time sample';

export class TodoistSyncGenerationFenceError extends Error {
  constructor() {
    super('[todoist sync] response generation is stale');
    this.name = 'TodoistSyncGenerationFenceError';
  }
}

const ACTIVE_OVERLAY_STATES: readonly TodoistSyncOutboxState[] = [
  'pending',
  'in_flight',
  'acknowledged_waiting_resource',
  'error_waiting_resource',
  'clock_rejected',
];
const REPEAT_TYPES = new Set(['daily', 'weekly', 'monthly', 'yearly']);
const EVENT_TYPES = new Set<McpTodoEventType>([
  'todo.created', 'todo.updated', 'todo.completed', 'todo.uncompleted',
  'todo.deleted', 'todo.moved', 'todo.starred', 'todo.unstarred',
]);
const TODO_EVENT_FIELDS = [
  'domain_id', 'title', 'status', 'important', 'due_at', 'repeat_type', 'repeat_interval',
  'remind_at', 'last_remind_at', 'last_complete_at', 'week_day', 'monthly_day', 'yearly_day',
  'note', 'source', 'position',
] as const;

const assertText = (value: unknown, label: string, maxLength = 100_000): string => {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${label} must be a string no longer than ${maxLength} characters`);
  }
  return value;
};
const assertInteger = (value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
};
const assertFlag = (value: unknown, label: string): 0 | 1 => {
  if (value !== 0 && value !== 1) throw new Error(`${label} must be 0 or 1`);
  return value;
};
const assertLiveFlag = (value: unknown, label: string): 0 => {
  if (value !== 0) throw new Error(`${label} must be 0`);
  return 0;
};
const assertActor = (value: McpTodoEventActor | undefined): McpTodoEventActor => {
  if (value === undefined) return 'human';
  if (value === 'human' || value === 'ai' || value === 'system') return value;
  throw new Error('actor must be human, ai, or system');
};
const assertSource = (value: McpTodoSource | undefined): McpTodoSource => {
  if (value === undefined) return 'human';
  if (value === 'human' || value === 'ai') return value;
  throw new Error('source must be human or ai');
};
const parseJson = <T>(value: string, label: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`[todoist sync] ${label} is invalid JSON`);
  }
};
const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const revisionCompare = (left: string, right: string): number => {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a > b ? 1 : -1;
};
const uniqueIds = (ids: TodoEntityId[], label: string): TodoEntityId[] => {
  const seen = new Set<string>();
  const result: TodoEntityId[] = [];
  for (const value of ids) {
    const id = assertTodoistSyncEntityId(value, label);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
};

export class TodoistSyncRepository {
  private mutationCommitted: (() => void) | null = null;

  constructor(
    private readonly db: TodoistSyncRepositoryDatabase,
    private readonly customerId: string,
    private readonly deviceId: string,
    private readonly ids: TodoistSyncSnowflakeService,
  ) {
    if (!/^[1-9]\d*$/.test(customerId)) throw new Error('[todoist sync] repository customerId is invalid');
    if (!deviceId || deviceId.length > 64) throw new Error('[todoist sync] repository deviceId is invalid');
  }

  setMutationCommittedListener(listener: (() => void) | null): void {
    this.mutationCommitted = listener;
  }

  async initialize(): Promise<void> {
    const now = Date.now();
    let identityChanged = false;
    let previousNodeId: number | null = null;
    await this.db.writeTransaction(async (tx) => {
      const state = await tx.getOptional<{
        device_id: string;
        snowflake_node_id: number | null;
      }>(
        'SELECT device_id,snowflake_node_id FROM todo_sync_state WHERE customer_id=?',
        [this.customerId],
      );
      if (!state) {
        await tx.execute(
          `INSERT INTO todo_sync_state (customer_id, device_id, created_at, updated_at)
           VALUES (?, ?, ?, ?)`,
          [this.customerId, this.deviceId, now, now],
        );
      } else if (state.device_id !== this.deviceId) {
        if (!await this.isDeviceBindingRecoveryClean(tx)) {
          throw new Error(TODOIST_SYNC_SNOWFLAKE_NODE_MISMATCH);
        }
        identityChanged = true;
        previousNodeId = state.snowflake_node_id;
        const result = await tx.execute(
          `UPDATE todo_sync_state SET device_id=?,sync_token='*',sync_phase=NULL,
           snowflake_node_id=NULL,device_sequence=0,bootstrap_started=0,
           bootstrap_catchup_pending=0,last_error=NULL,updated_at=?
           WHERE customer_id=? AND device_id=? AND snowflake_node_id IS ?`,
          [this.deviceId, now, this.customerId, state.device_id, state.snowflake_node_id],
        );
        if (result.changes !== 1) {
          throw new Error(TODOIST_SYNC_SNOWFLAKE_NODE_MISMATCH);
        }
      }
      await tx.execute(
        "UPDATE todo_sync_outbox SET state='pending', batch_id=NULL, updated_at=? WHERE state='in_flight'",
        [now],
      );
    }, () => {
      if (identityChanged && this.ids.getNodeId() !== previousNodeId) {
        throw new Error(TODOIST_SYNC_SNOWFLAKE_NODE_MISMATCH);
      }
    });
    if (identityChanged && previousNodeId !== null) {
      this.ids.clearNodeId(previousNodeId);
    }
  }

  async setSnowflakeNodeId(nodeId: number): Promise<void> {
    this.ids.setNodeId(nodeId);
    await this.db.execute(
      'UPDATE todo_sync_state SET snowflake_node_id=?, updated_at=? WHERE customer_id=?',
      [nodeId, Date.now(), this.customerId],
    );
  }

  async getSyncState(): Promise<{
    sync_token: string;
    snowflake_node_id: number | null;
    interval_seconds: number;
    bootstrap_catchup_pending: number;
  }> {
    return await this.db.get(
      `SELECT sync_token, snowflake_node_id, interval_seconds, bootstrap_catchup_pending
       FROM todo_sync_state WHERE customer_id=?`,
      [this.customerId],
    );
  }

  async setSyncInterval(secondsValue: number): Promise<void> {
    const seconds = assertInteger(secondsValue, 'sync interval', 10, 180);
    await this.db.execute(
      'UPDATE todo_sync_state SET interval_seconds=?, updated_at=? WHERE customer_id=?',
      [seconds, Date.now(), this.customerId],
    );
  }

  async createDomain(
    params: { title?: string; description?: string },
    context?: TodoMutationContext,
  ): Promise<McpDomainRow | undefined> {
    const title = assertText(params.title ?? 'Untitled', 'title', 512);
    const description = assertText(params.description ?? '', 'description', 10_000);
    const active = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_domains WHERE customer_id=? AND archived=0 AND deleted_flag='' AND reconcile_pending=0",
      [this.customerId],
    );
    if (active.count >= 17) return undefined;
    const id = this.ids.generate();
    const position = await this.nextPosition(this.db, 'todo_domains', "customer_id=? AND deleted_flag=''", [this.customerId]);
    await this.mutate('todo_domain', id, 'domain_add', null, { title, description, archived: 0, position }, async (tx, version) => {
      await tx.execute(
        `INSERT INTO todo_domains (
          id, customer_id, title, description, archived, position, created_at,
          client_updated_at, version_device_id, version_client_sequence,
          version_command_uuid, sync_revision, deleted_flag, deleted_at, reconcile_pending
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, '0', '', NULL, 0)`,
        [id, this.customerId, title, description, position, version.now, version.now, this.deviceId, version.sequence, version.uuid],
      );
    }, context);
    return await this.getDomainById({ id });
  }

  async getDomains(): Promise<McpDomainRow[]> {
    const rows = await this.db.getAll<McpDomainRow>(
      `SELECT id, customer_id, title, description, 0 AS is_deleted, archived, position,
              created_at, client_updated_at AS updated_at
       FROM todo_domains
       WHERE customer_id=? AND deleted_flag='' AND reconcile_pending=0
       ORDER BY position, created_at, id`,
      [this.customerId],
    );
    return rows.map((row) => this.assertDomain(row));
  }

  async getDomainById(params: { id: TodoEntityId }): Promise<McpDomainRow | undefined> {
    const id = assertTodoistSyncEntityId(params.id);
    const row = await this.db.getOptional<McpDomainRow>(
      `SELECT id, customer_id, title, description, 0 AS is_deleted, archived, position,
              created_at, client_updated_at AS updated_at
       FROM todo_domains WHERE id=? AND customer_id=? AND deleted_flag='' AND reconcile_pending=0`,
      [id, this.customerId],
    );
    return row ? this.assertDomain(row) : undefined;
  }

  async updateDomainTitle(
    params: { id: TodoEntityId; title: string },
    context?: TodoMutationContext,
  ): Promise<void> {
    await this.updateDomain(params.id, {
      fields: { title: assertText(params.title, 'title', 512) },
    }, context);
  }

  async updateDomainDescription(
    params: { id: TodoEntityId; description: string },
    context?: TodoMutationContext,
  ): Promise<void> {
    await this.updateDomain(params.id, {
      fields: { description: assertText(params.description, 'description', 10_000) },
      requireActive: true,
    }, context);
  }

  private async updateDomain(
    idValue: TodoEntityId,
    params: { fields: Record<string, unknown>; requireActive?: boolean },
    context?: TodoMutationContext,
  ): Promise<void> {
    const id = assertTodoistSyncEntityId(idValue);
    const current = await this.getProjection('todo_domain', id);
    if (!current) return;
    await this.mutate('todo_domain', id, 'domain_update', null, params.fields, async (tx, version) => {
      const assignments = Object.keys(params.fields).map((key) => `${key}=?`);
      const result = await tx.execute(
        `UPDATE todo_domains SET ${assignments.join(',')}, client_updated_at=?, version_device_id=?,
          version_client_sequence=?, version_command_uuid=? WHERE id=? AND customer_id=? AND deleted_flag=''
          ${params.requireActive ? 'AND archived=0' : ''}`,
        [...Object.values(params.fields), version.now, this.deviceId, version.sequence, version.uuid, id, this.customerId],
      );
      if (params.requireActive && result.changes !== 1) {
        throw new Error(`[todoist sync] active domain was not found: ${id}`);
      }
    }, context);
  }

  async deleteDomain(
    params: { id: TodoEntityId },
    context?: TodoMutationContext,
  ): Promise<void> {
    const id = assertTodoistSyncEntityId(params.id);
    const current = await this.getDomainById({ id });
    if (!current) return;
    await this.mutate('todo_domain', id, 'domain_delete', null, {}, async (tx, version) => {
      const tombstone = `local:${version.uuid}`;
      const todos = await tx.getAll<{ id: string; title: string }>(
        "SELECT id,title FROM todos WHERE customer_id=? AND domain_id=? AND deleted_flag=''",
        [this.customerId, id],
      );
      for (const todo of todos) {
        await this.insertEvent(tx, 'todo.deleted', assertTodoistSyncEntityId(todo.id), id, 'human', { title: todo.title });
      }
      await tx.execute(
        `UPDATE sub_todos SET deleted_flag=?, deleted_at=?, client_updated_at=?, version_device_id=?,
          version_client_sequence=?, version_command_uuid=? WHERE customer_id=? AND todo_id IN
          (SELECT id FROM todos WHERE customer_id=? AND domain_id=?) AND deleted_flag=''`,
        [tombstone, version.now, version.now, this.deviceId, version.sequence, version.uuid, this.customerId, this.customerId, id],
      );
      await tx.execute(
        `UPDATE todos SET deleted_flag=?, deleted_at=?, client_updated_at=?, version_device_id=?,
          version_client_sequence=?, version_command_uuid=? WHERE customer_id=? AND domain_id=? AND deleted_flag=''`,
        [tombstone, version.now, version.now, this.deviceId, version.sequence, version.uuid, this.customerId, id],
      );
      await tx.execute(
        `UPDATE todo_domains SET deleted_flag=?, deleted_at=?, client_updated_at=?, version_device_id=?,
          version_client_sequence=?, version_command_uuid=? WHERE customer_id=? AND id=? AND deleted_flag=''`,
        [tombstone, version.now, version.now, this.deviceId, version.sequence, version.uuid, this.customerId, id],
      );
    }, context);
  }

  async setDomainArchived(
    params: { id: TodoEntityId; archived: number },
    context?: TodoMutationContext,
  ): Promise<void> {
    await this.updateDomain(params.id, {
      fields: { archived: assertFlag(params.archived, 'archived') },
    }, context);
  }

  async restoreDomain(
    params: { id: TodoEntityId },
    context?: TodoMutationContext,
  ): Promise<RestoreDomainResult> {
    const id = assertTodoistSyncEntityId(params.id);
    const domain = await this.getProjection('todo_domain', id) as Record<string, unknown> | null;
    if (!domain || domain.deleted_flag) return 'not_found';
    if (domain.archived === 0) return 'already_active';
    const active = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_domains WHERE customer_id=? AND archived=0 AND deleted_flag='' AND reconcile_pending=0",
      [this.customerId],
    );
    if (active.count >= 17) return 'limit_reached';
    await this.updateDomain(id, { fields: { archived: 0 } }, context);
    return 'restored';
  }

  async createTodo(params: {
    domainId: TodoEntityId;
    title: string;
    source?: McpTodoSource;
    actor?: McpTodoEventActor;
  }, context?: TodoMutationContext): Promise<McpTodoRow | undefined> {
    const domainId = assertTodoistSyncEntityId(params.domainId, 'domainId');
    const domain = await this.getDomainById({ id: domainId });
    if (!domain || domain.archived === 1) throw new Error(`Active Todo domain ${domainId} was not found`);
    const title = assertText(params.title, 'title', 512);
    const source = assertSource(params.source);
    const active = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todos WHERE customer_id=? AND domain_id=? AND status=0 AND deleted_flag='' AND reconcile_pending=0",
      [this.customerId, domainId],
    );
    if (active.count >= 77) return undefined;
    const id = this.ids.generate();
    const position = await this.nextPosition(this.db, 'todos', "customer_id=? AND domain_id=? AND deleted_flag=''", [this.customerId, domainId]);
    const business = {
      domain_id: domainId,
      title,
      status: 0,
      important: 0,
      due_at: null,
      repeat_type: null,
      repeat_interval: 1,
      remind_at: null,
      last_remind_at: null,
      last_complete_at: null,
      week_day: null,
      monthly_day: null,
      yearly_day: null,
      note: '',
      source,
      position,
    };
    await this.mutate('todo', id, 'todo_add', domainId, business, async (tx, version) => {
      await tx.execute(
        `INSERT INTO todos (
          id,customer_id,domain_id,title,status,important,due_at,repeat_type,repeat_interval,
          remind_at,last_remind_at,last_complete_at,week_day,monthly_day,yearly_day,note,source,
          position,created_at,client_updated_at,version_device_id,version_client_sequence,
          version_command_uuid,sync_revision,deleted_flag,deleted_at,reconcile_pending
        ) VALUES (?,?,?,?,0,0,NULL,NULL,1,NULL,NULL,NULL,NULL,NULL,NULL,'',?,?,?, ?,?,?,?,'0','',NULL,0)`,
        [id, this.customerId, domainId, title, source, position, version.now, version.now, this.deviceId, version.sequence, version.uuid],
      );
      await this.insertEvent(tx, 'todo.created', id, domainId, assertActor(params.actor), { title, source });
    }, context);
    return await this.getTodoById({ id });
  }

  async getTodosByDomain(params: { domainId: TodoEntityId; status?: number }): Promise<McpTodoRow[]> {
    const domainId = assertTodoistSyncEntityId(params.domainId, 'domainId');
    const values: unknown[] = [domainId, this.customerId];
    let statusSql = '';
    if (params.status !== undefined) {
      statusSql = ' AND status=?';
      values.push(assertFlag(params.status, 'status'));
    }
    const rows = await this.db.getAll<McpTodoRow>(
      `${this.todoSelectSql()} WHERE domain_id=? AND customer_id=? AND deleted_flag='' AND reconcile_pending=0${statusSql}
       ORDER BY position, created_at DESC, id`,
      values,
    );
    return rows.map((row) => this.assertTodo(row));
  }

  async getTodoById(params: { id: TodoEntityId }): Promise<McpTodoRow | undefined> {
    const id = assertTodoistSyncEntityId(params.id);
    const row = await this.db.getOptional<McpTodoRow>(
      `${this.todoSelectSql()} WHERE id=? AND customer_id=? AND deleted_flag='' AND reconcile_pending=0`,
      [id, this.customerId],
    );
    return row ? this.assertTodo(row) : undefined;
  }

  async getStatusByIds(params: { ids: TodoEntityId[] }): Promise<McpTodoStatusByIdsResult> {
    const ids = uniqueIds(params.ids, 'ids');
    const summary = { active: 0, completed: 0, deleted: 0, missing: 0 };
    if (ids.length === 0) return { items: [], summary };
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.db.getAll<Record<string, unknown>>(
      `SELECT id,title,domain_id,status,last_complete_at,client_updated_at,deleted_flag,deleted_at
       FROM todos WHERE customer_id=? AND id IN (${placeholders})`,
      [this.customerId, ...ids],
    );
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const items = ids.map((id) => {
      const row = byId.get(id);
      if (!row) {
        summary.missing += 1;
        return { id, state: 'missing' as const, exists: false, completed: false, deleted: false, title: null, domain_id: null, updated_at: null, completed_at: null, deleted_at: null, deleted_event_id: null };
      }
      if (row.deleted_flag) {
        summary.deleted += 1;
        return { id, state: 'deleted' as const, exists: false, completed: false, deleted: true, title: String(row.title), domain_id: String(row.domain_id), updated_at: Number(row.client_updated_at), completed_at: null, deleted_at: Number(row.deleted_at), deleted_event_id: null };
      }
      const completed = row.status === 1;
      summary[completed ? 'completed' : 'active'] += 1;
      return { id, state: completed ? 'completed' as const : 'active' as const, exists: true, completed, deleted: false, title: String(row.title), domain_id: String(row.domain_id), updated_at: Number(row.client_updated_at), completed_at: row.last_complete_at === null ? null : Number(row.last_complete_at), deleted_at: null, deleted_event_id: null };
    });
    return { items, summary };
  }

  async updateTodo(params: {
    id: TodoEntityId;
    title?: string;
    due_at?: number | null;
    remind_at?: number | null;
    important?: number;
    note?: string | null;
    actor?: McpTodoEventActor;
  }, context?: TodoMutationContext): Promise<McpTodoRow | undefined> {
    const fields: Record<string, unknown> = {};
    if (params.title !== undefined) fields.title = assertText(params.title, 'title', 512);
    if (params.due_at !== undefined) fields.due_at = params.due_at === null ? null : assertInteger(params.due_at, 'due_at');
    if (params.remind_at !== undefined) fields.remind_at = params.remind_at === null ? null : assertInteger(params.remind_at, 'remind_at');
    if (params.important !== undefined) fields.important = assertFlag(params.important, 'important');
    if (params.note !== undefined) fields.note = params.note === null ? '' : assertText(params.note, 'note', 50_000);
    return await this.applyTodoUpdate(params.id, fields, assertActor(params.actor), 'todo.updated', context);
  }

  async updateRepeatType(
    params: { id: TodoEntityId; repeatType: string | null; actor?: McpTodoEventActor },
    context?: TodoMutationContext,
  ): Promise<McpTodoRow | undefined> {
    if (params.repeatType !== null && !REPEAT_TYPES.has(params.repeatType)) throw new Error('repeatType is invalid');
    const todo = await this.getTodoById({ id: params.id });
    if (!todo) return undefined;
    const fields: Record<string, unknown> = { repeat_type: params.repeatType };
    if (params.repeatType && !todo.repeat_type) {
      const dueAt = todo.due_at ?? moment().startOf('day').valueOf();
      if (todo.due_at === null) fields.due_at = dueAt;
      fields.repeat_interval = 1;
      const due = moment(dueAt);
      if (params.repeatType === 'weekly') fields.week_day = due.isoWeekday();
      if (params.repeatType === 'monthly') fields.monthly_day = due.date();
      if (params.repeatType === 'yearly') fields.yearly_day = due.date();
    }
    if (params.repeatType === null) Object.assign(fields, { week_day: null, monthly_day: null, yearly_day: null, repeat_interval: 1 });
    return await this.applyTodoUpdate(params.id, fields, assertActor(params.actor), 'todo.updated', context);
  }

  async updateRepeatInterval(
    params: { id: TodoEntityId; interval: number; actor?: McpTodoEventActor },
    context?: TodoMutationContext,
  ): Promise<McpTodoRow | undefined> {
    return await this.applyTodoUpdate(params.id, { repeat_interval: assertInteger(params.interval, 'interval', 1, 2147483647) }, assertActor(params.actor), 'todo.updated', context);
  }

  async completeTodo(
    params: { id: TodoEntityId; actor?: McpTodoEventActor },
    context?: TodoMutationContext,
  ): Promise<McpTodoRow | undefined> {
    const todo = await this.getTodoById({ id: params.id });
    if (!todo) return undefined;
    const now = Date.now();
    const fields: Record<string, unknown> = { status: 1, last_complete_at: now };
    if (todo.repeat_type && todo.due_at) {
      const nextDue = this.computeNextDue(todo);
      Object.assign(fields, { status: 0, due_at: nextDue });
      if (todo.remind_at) Object.assign(fields, { remind_at: nextDue + (todo.remind_at - todo.due_at), last_remind_at: todo.remind_at });
    }
    return await this.applyTodoUpdate(params.id, fields, assertActor(params.actor), 'todo.completed', context);
  }

  async uncompleteTodo(
    params: { id: TodoEntityId; actor?: McpTodoEventActor },
    context?: TodoMutationContext,
  ): Promise<McpTodoRow | undefined> {
    return await this.applyTodoUpdate(params.id, { status: 0 }, assertActor(params.actor), 'todo.uncompleted', context);
  }

  async toggleImportant(
    params: { id: TodoEntityId; actor?: McpTodoEventActor },
    context?: TodoMutationContext,
  ): Promise<McpTodoRow | undefined> {
    const todo = await this.getTodoById({ id: params.id });
    if (!todo) return undefined;
    const important = todo.important === 1 ? 0 : 1;
    return await this.applyTodoUpdate(params.id, { important }, assertActor(params.actor), important ? 'todo.starred' : 'todo.unstarred', context);
  }

  private async applyTodoUpdate(
    idValue: TodoEntityId,
    fields: Record<string, unknown>,
    actor: McpTodoEventActor,
    eventType: McpTodoEventType,
    context?: TodoMutationContext,
  ): Promise<McpTodoRow | undefined> {
    const id = assertTodoistSyncEntityId(idValue);
    const todo = await this.getTodoById({ id });
    if (!todo || Object.keys(fields).length === 0) return todo;
    await this.mutate('todo', id, 'todo_update', todo.domain_id, fields, async (tx, version) => {
      await tx.execute(
        `UPDATE todos SET ${Object.keys(fields).map((key) => `${key}=?`).join(',')},
          client_updated_at=?,version_device_id=?,version_client_sequence=?,version_command_uuid=?
         WHERE id=? AND customer_id=? AND deleted_flag=''`,
        [...Object.values(fields), version.now, this.deviceId, version.sequence, version.uuid, id, this.customerId],
      );
      await this.insertEvent(tx, eventType, id, todo.domain_id, actor, { title: todo.title, changedFields: Object.keys(fields) });
    }, context);
    return await this.getTodoById({ id });
  }

  async deleteTodo(
    idValue: TodoEntityId,
    options?: McpTodoEventActor | {
      actor?: McpTodoEventActor;
      context?: TodoMutationContext;
    },
  ): Promise<boolean> {
    const actorValue = typeof options === 'string' ? options : options?.actor;
    const context = typeof options === 'string' ? undefined : options?.context;
    const id = assertTodoistSyncEntityId(idValue);
    const todo = await this.getTodoById({ id });
    if (!todo) return false;
    await this.mutate('todo', id, 'todo_delete', todo.domain_id, {}, async (tx, version) => {
      const tombstone = `local:${version.uuid}`;
      await tx.execute(
        `UPDATE sub_todos SET deleted_flag=?,deleted_at=?,client_updated_at=?,version_device_id=?,
          version_client_sequence=?,version_command_uuid=? WHERE todo_id=? AND customer_id=? AND deleted_flag=''`,
        [tombstone, version.now, version.now, this.deviceId, version.sequence, version.uuid, id, this.customerId],
      );
      await tx.execute(
        `UPDATE todos SET deleted_flag=?,deleted_at=?,client_updated_at=?,version_device_id=?,
          version_client_sequence=?,version_command_uuid=? WHERE id=? AND customer_id=? AND deleted_flag=''`,
        [tombstone, version.now, version.now, this.deviceId, version.sequence, version.uuid, id, this.customerId],
      );
      await this.insertEvent(tx, 'todo.deleted', id, todo.domain_id, assertActor(actorValue), { title: todo.title });
    }, context);
    return (await this.getTodoById({ id })) === undefined;
  }

  async moveToDomain(
    params: { id: TodoEntityId; domainId: TodoEntityId; actor?: McpTodoEventActor },
    context?: TodoMutationContext,
  ): Promise<McpTodoRow | undefined> {
    const id = assertTodoistSyncEntityId(params.id);
    const domainId = assertTodoistSyncEntityId(params.domainId, 'domainId');
    const todo = await this.getTodoById({ id });
    const domain = await this.getDomainById({ id: domainId });
    if (!todo) return undefined;
    if (!domain || domain.archived) throw new Error(`Active Todo domain ${domainId} was not found`);
    const position = await this.nextPosition(this.db, 'todos', "customer_id=? AND domain_id=? AND deleted_flag=''", [this.customerId, domainId]);
    const updated = await this.applyTodoUpdate(id, { domain_id: domainId, position }, assertActor(params.actor), 'todo.moved', context);
    return updated;
  }

  async skipToCurrent(
    params: { id: TodoEntityId; actor?: McpTodoEventActor },
    context?: TodoMutationContext,
  ): Promise<McpTodoRow | undefined> {
    const todo = await this.getTodoById({ id: params.id });
    if (!todo || !todo.repeat_type || !todo.due_at || moment(todo.due_at).startOf('day').isSameOrAfter(moment().startOf('day'))) return todo;
    const nearest = this.computeNearestFutureDue(todo);
    const fields: Record<string, unknown> = { due_at: nearest };
    if (todo.remind_at) Object.assign(fields, { remind_at: nearest + (todo.remind_at - todo.due_at), last_remind_at: todo.remind_at });
    return await this.applyTodoUpdate(params.id, fields, assertActor(params.actor), 'todo.updated', context);
  }

  async createSubTodo(
    params: { todoId: TodoEntityId; title: string },
    context?: TodoMutationContext,
  ): Promise<McpSubTodoRow | undefined> {
    const todoId = assertTodoistSyncEntityId(params.todoId, 'todoId');
    if (!await this.getTodoById({ id: todoId })) throw new Error(`Todo ${todoId} was not found`);
    const title = assertText(params.title, 'title', 512);
    const id = this.ids.generate();
    const position = await this.nextPosition(this.db, 'sub_todos', "customer_id=? AND todo_id=? AND deleted_flag=''", [this.customerId, todoId]);
    await this.mutate('sub_todo', id, 'sub_todo_add', todoId, { todo_id: todoId, title, status: 0, position }, async (tx, version) => {
      await tx.execute(
        `INSERT INTO sub_todos (
          id,customer_id,todo_id,title,status,position,created_at,client_updated_at,
          version_device_id,version_client_sequence,version_command_uuid,sync_revision,
          deleted_flag,deleted_at,reconcile_pending
        ) VALUES (?,?,?,?,0,?,?,?, ?,?,?,'0','',NULL,0)`,
        [id, this.customerId, todoId, title, position, version.now, version.now, this.deviceId, version.sequence, version.uuid],
      );
    }, context);
    return await this.getSubTodoById({ id });
  }

  async getSubTodosByTodoId(params: { todoId: TodoEntityId }): Promise<McpSubTodoRow[]> {
    const todoId = assertTodoistSyncEntityId(params.todoId, 'todoId');
    const rows = await this.db.getAll<McpSubTodoRow>(
      `${this.subTodoSelectSql()} WHERE todo_id=? AND customer_id=? AND deleted_flag='' AND reconcile_pending=0
       ORDER BY position,created_at,id`,
      [todoId, this.customerId],
    );
    return rows.map((row) => this.assertSubTodo(row));
  }

  async getSubTodoById(params: { id: TodoEntityId }): Promise<McpSubTodoRow | undefined> {
    const id = assertTodoistSyncEntityId(params.id);
    const row = await this.db.getOptional<McpSubTodoRow>(
      `${this.subTodoSelectSql()} WHERE id=? AND customer_id=? AND deleted_flag='' AND reconcile_pending=0`,
      [id, this.customerId],
    );
    return row ? this.assertSubTodo(row) : undefined;
  }

  async updateSubTodoTitle(
    params: { id: TodoEntityId; title: string },
    context?: TodoMutationContext,
  ): Promise<void> {
    await this.applySubTodoUpdate(params.id, { title: assertText(params.title, 'title', 512) }, context);
  }

  async setSubTodoStatus(
    params: { id: TodoEntityId; status: 0 | 1 },
    context?: TodoMutationContext,
  ): Promise<McpSubTodoRow | undefined> {
    const id = assertTodoistSyncEntityId(params.id);
    const status = assertFlag(params.status, 'status');
    const row = await this.getSubTodoById({ id });
    if (!row) return undefined;
    if (row.status !== status) {
      await this.applySubTodoUpdate(id, { status }, context);
    }
    return await this.getSubTodoById({ id });
  }

  async toggleSubTodoStatus(
    params: { id: TodoEntityId },
    context?: TodoMutationContext,
  ): Promise<McpSubTodoRow | undefined> {
    const row = await this.getSubTodoById({ id: params.id });
    if (!row) return undefined;
    await this.applySubTodoUpdate(params.id, { status: row.status === 1 ? 0 : 1 }, context);
    return await this.getSubTodoById({ id: params.id });
  }

  private async applySubTodoUpdate(
    idValue: TodoEntityId,
    fields: Record<string, unknown>,
    context?: TodoMutationContext,
  ): Promise<void> {
    const id = assertTodoistSyncEntityId(idValue);
    const row = await this.getSubTodoById({ id });
    if (!row) return;
    await this.mutate('sub_todo', id, 'sub_todo_update', row.todo_id, fields, async (tx, version) => {
      await tx.execute(
        `UPDATE sub_todos SET ${Object.keys(fields).map((key) => `${key}=?`).join(',')},
         client_updated_at=?,version_device_id=?,version_client_sequence=?,version_command_uuid=?
         WHERE id=? AND customer_id=? AND deleted_flag=''`,
        [...Object.values(fields), version.now, this.deviceId, version.sequence, version.uuid, id, this.customerId],
      );
    }, context);
  }

  async getCountByTodoId(params: { todoId: TodoEntityId }): Promise<{ total: number; done: number }> {
    const todoId = assertTodoistSyncEntityId(params.todoId, 'todoId');
    const row = await this.db.get<{ total: number; done: number }>(
      `SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status=1 THEN 1 ELSE 0 END),0) AS done
       FROM sub_todos WHERE todo_id=? AND customer_id=? AND deleted_flag='' AND reconcile_pending=0`,
      [todoId, this.customerId],
    );
    return { total: row.total, done: row.done };
  }

  async getCountsByTodoIds(params: { todoIds: TodoEntityId[] }): Promise<Record<TodoEntityId, { total: number; done: number }>> {
    const ids = uniqueIds(params.todoIds, 'todoIds');
    if (ids.length === 0) return {};
    const rows = await this.db.getAll<{ todo_id: string; total: number; done: number }>(
      `SELECT todo_id,COUNT(*) AS total,COALESCE(SUM(CASE WHEN status=1 THEN 1 ELSE 0 END),0) AS done
       FROM sub_todos WHERE customer_id=? AND deleted_flag='' AND reconcile_pending=0
       AND todo_id IN (${ids.map(() => '?').join(',')}) GROUP BY todo_id`,
      [this.customerId, ...ids],
    );
    const result: Record<string, { total: number; done: number }> = {};
    for (const id of ids) result[id] = { total: 0, done: 0 };
    for (const row of rows) result[assertTodoistSyncEntityId(row.todo_id)] = { total: row.total, done: row.done };
    return result;
  }

  async deleteSubTodo(
    params: { id: TodoEntityId },
    context?: TodoMutationContext,
  ): Promise<void> {
    const id = assertTodoistSyncEntityId(params.id);
    const row = await this.getSubTodoById({ id });
    if (!row) return;
    await this.mutate('sub_todo', id, 'sub_todo_delete', row.todo_id, {}, async (tx, version) => {
      await tx.execute(
        `UPDATE sub_todos SET deleted_flag=?,deleted_at=?,client_updated_at=?,version_device_id=?,
         version_client_sequence=?,version_command_uuid=? WHERE id=? AND customer_id=? AND deleted_flag=''`,
        [`local:${version.uuid}`, version.now, version.now, this.deviceId, version.sequence, version.uuid, id, this.customerId],
      );
    }, context);
  }

  async getSortOrder(params: { key: string }): Promise<TodoEntityId[]> {
    const target = this.parseSortKey(params.key);
    const rows = target.type === 'domain'
      ? await this.db.getAll<{ id: string }>("SELECT id FROM todo_domains WHERE customer_id=? AND archived=0 AND deleted_flag='' AND reconcile_pending=0 ORDER BY position,created_at,id", [this.customerId])
      : await this.db.getAll<{ id: string }>(
        `SELECT id FROM ${target.type === 'todo' ? 'todos' : 'sub_todos'} WHERE customer_id=?
         AND ${target.type === 'todo' ? 'domain_id' : 'todo_id'}=? AND deleted_flag='' AND reconcile_pending=0
         ORDER BY position,created_at,id`,
        [this.customerId, target.parentId],
      );
    return rows.map((row) => assertTodoistSyncEntityId(row.id));
  }

  async setSortOrder(
    params: { key: string; order: TodoEntityId[] },
    context?: TodoMutationContext,
  ): Promise<void> {
    const target = this.parseSortKey(params.key);
    const order = uniqueIds(params.order, 'order');
    if (order.length !== params.order.length) throw new Error('order contains duplicate IDs');
    const resourceType: TodoistSyncResourceType = target.type === 'domain' ? 'todo_domain' : target.type === 'todo' ? 'todo' : 'sub_todo';
    const table = target.type === 'domain' ? 'todo_domains' : target.type === 'todo' ? 'todos' : 'sub_todos';
    await this.db.writeTransaction(async (tx) => {
      for (let index = 0; index < order.length; index += 1) {
        const id = order[index];
        const version = await this.nextVersion(tx);
        const current = await this.getProjectionWith(tx, resourceType, id);
        if (!current) throw new Error(`Cannot reorder missing Todo entity ${id}`);
        await tx.execute(
          `UPDATE ${table} SET position=?,client_updated_at=?,version_device_id=?,version_client_sequence=?,
           version_command_uuid=? WHERE id=? AND customer_id=? AND deleted_flag=''`,
          [index, version.now, this.deviceId, version.sequence, version.uuid, id, this.customerId],
        );
        await this.insertOutbox(tx, resourceType, id, target.type === 'domain' ? 'domain_update' : target.type === 'todo' ? 'todo_update' : 'sub_todo_update', target.parentId, { position: index }, current, version);
      }
    });
    this.afterMutation(context);
  }

  async listAfter(params: { afterEventId?: number; limit?: number }): Promise<McpTodoEventListResult> {
    const after = params.afterEventId === undefined ? 0 : assertInteger(params.afterEventId, 'afterEventId');
    const limit = params.limit === undefined ? 50 : assertInteger(params.limit, 'limit', 1, 100);
    const rows = await this.db.getAll<EventRow>(
      'SELECT sequence,type,todo_id,domain_id,actor,payload,created_at FROM todo_events WHERE sequence>? ORDER BY sequence LIMIT ?',
      [after, limit + 1],
    );
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map((row): McpTodoEventItem => ({
      id: row.sequence,
      type: row.type,
      todo_id: row.todo_id,
      domain_id: row.domain_id,
      actor: row.actor,
      payload: parseJson(row.payload, 'event payload'),
      created_at: row.created_at,
    }));
    return { events, latestEventId: events.at(-1)?.id ?? after, hasMore };
  }

  async takePendingBatch(limit = 100): Promise<TodoistSyncOutboxBatch | null> {
    return await this.db.writeTransaction(async (tx) => {
      const rows = await tx.getAll<OutboxRow>(
        "SELECT * FROM todo_sync_outbox WHERE state='pending' ORDER BY command_order LIMIT ?",
        [Math.max(0, Math.min(100, limit))],
      );
      if (rows.length === 0) return null;
      const id = randomUUID();
      const now = Date.now();
      for (const row of rows) {
        await tx.execute(
          "UPDATE todo_sync_outbox SET state='in_flight',batch_id=?,updated_at=? WHERE command_uuid=? AND state='pending'",
          [id, now, row.command_uuid],
        );
      }
      return {
        id,
        commands: rows.map((row) => ({ uuid: row.command_uuid, type: row.command_type, args: parseJson(row.args_json, 'outbox args') })),
      };
    });
  }

  async releaseTransientBatch(batchId: string): Promise<void> {
    await this.db.execute(
      "UPDATE todo_sync_outbox SET state='pending',batch_id=NULL,updated_at=? WHERE state='in_flight' AND batch_id=?",
      [Date.now(), batchId],
    );
  }

  async markClockRejected(
    batch: TodoistSyncOutboxBatch,
    isCommitAllowed: () => boolean = () => true,
  ): Promise<void> {
    await this.db.writeTransaction(async (tx) => {
      const state = await tx.get<{ rejected_batch_id: string | null }>('SELECT rejected_batch_id FROM todo_sync_state WHERE customer_id=?', [this.customerId]);
      if (state.rejected_batch_id && state.rejected_batch_id !== batch.id) throw new Error('[todoist sync] another clock-rejected batch is already quarantined');
      for (const command of batch.commands) {
        const result = await tx.execute(
          "UPDATE todo_sync_outbox SET state='clock_rejected',updated_at=? WHERE command_uuid=? AND state='in_flight' AND batch_id=? RETURNING command_uuid",
          [Date.now(), command.uuid, batch.id],
        );
        if ((result.rows?._array.length ?? 0) !== 1) throw new Error('[todoist sync] rejected batch membership changed');
      }
      const members = await tx.getAll<{ command_uuid: string }>(
        'SELECT command_uuid FROM todo_sync_outbox WHERE batch_id=? ORDER BY command_order',
        [batch.id],
      );
      if (
        members.length !== batch.commands.length ||
        members.some((member, index) => member.command_uuid !== batch.commands[index].uuid)
      ) {
        throw new Error('[todoist sync] rejected batch membership changed');
      }
      await tx.execute('UPDATE todo_sync_state SET rejected_batch_id=?,updated_at=? WHERE customer_id=?', [batch.id, Date.now(), this.customerId]);
    }, () => {
      if (!isCommitAllowed()) throw new TodoistSyncGenerationFenceError();
    });
  }

  async recoverClockRejected(
    trustedTimeMs: number,
    localNow = Date.now(),
    isCommitAllowed: () => boolean = () => true,
  ): Promise<boolean> {
    assertInteger(trustedTimeMs, 'trustedTimeMs');
    assertInteger(localNow, 'localNow');
    return await this.db.writeTransaction(async (tx) => {
      const state = await tx.get<{ rejected_batch_id: string | null }>('SELECT rejected_batch_id FROM todo_sync_state WHERE customer_id=?', [this.customerId]);
      if (!state.rejected_batch_id) return true;
      const rows = await tx.getAll<OutboxRow>(
        'SELECT * FROM todo_sync_outbox WHERE batch_id=? ORDER BY command_order',
        [state.rejected_batch_id],
      );
      if (rows.length === 0) throw new Error('[todoist sync] rejected batch marker has no commands');
      if (rows.some((row) => row.state !== 'clock_rejected')) {
        throw new Error('[todoist sync] rejected batch membership changed');
      }
      const future = new Set(rows.filter((row) => (
        Number(parseJson<Record<string, unknown>>(row.args_json, 'outbox args').client_updated_at) >
        trustedTimeMs + TODOIST_SYNC_MAX_FUTURE_MS
      )).map((row) => row.command_uuid));
      if (future.size === 0) {
        await tx.execute(
          'UPDATE todo_sync_state SET last_error=?,updated_at=? WHERE customer_id=?',
          [TODOIST_SYNC_CORE_CLOCK_DISAGREEMENT, localNow, this.customerId],
        );
        return false;
      }
      let terminalOrder = (await tx.get<{ command_order: number | null }>(
        'SELECT MAX(command_order) AS command_order FROM todo_sync_outbox',
      )).command_order ?? 0;
      for (const row of rows) {
        if (!future.has(row.command_uuid)) {
          await tx.execute("UPDATE todo_sync_outbox SET state='pending',batch_id=NULL,updated_at=? WHERE command_uuid=?", [localNow, row.command_uuid]);
          continue;
        }
        const version = await this.nextVersion(tx, localNow);
        const args = parseJson<Record<string, unknown>>(row.args_json, 'outbox args');
        Object.assign(args, { client_updated_at: version.now, client_sequence: version.sequence });
        terminalOrder += 1;
        await tx.execute(
          "UPDATE todo_sync_outbox SET command_order=?,state='superseded',batch_id=NULL,updated_at=? WHERE command_uuid=?",
          [terminalOrder, localNow, row.command_uuid],
        );
        await tx.execute(
          `INSERT INTO todo_sync_outbox (
            command_order,command_uuid,command_type,resource_type,resource_id,parent_resource_id,args_json,
            preimage_json,state,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`,
          [row.command_order, version.uuid, row.command_type, row.resource_type, row.resource_id, row.parent_resource_id, JSON.stringify(args), row.preimage_json, localNow, localNow],
        );
      }
      await tx.execute(
        'UPDATE todo_sync_state SET rejected_batch_id=NULL,last_error=NULL,updated_at=? WHERE customer_id=?',
        [localNow, this.customerId],
      );
      const affected = new Set(rows.map((row) => `${row.resource_type}:${row.resource_id}`));
      for (const key of affected) {
        const [type, id] = key.split(':') as [TodoistSyncResourceType, string];
        await this.materialize(tx, type, id);
      }
      return true;
    }, () => {
      if (!isCommitAllowed()) throw new TodoistSyncGenerationFenceError();
    });
  }

  async applySyncResponse(
    response: TodoistSyncResponse,
    batch: TodoistSyncOutboxBatch | null,
    isCommitAllowed: () => boolean = () => true,
  ): Promise<void> {
    const previousNodeId = this.ids.getNodeId();
    if (
      previousNodeId !== null &&
      previousNodeId !== response.snowflake_node_id &&
      await this.recoverLegacyDeviceBinding(previousNodeId, isCommitAllowed)
    ) {
      return;
    }
    this.ids.setNodeId(response.snowflake_node_id);
    let changed = false;
    const eventTodoIds = new Set(response.todos.map((todo) => todo.id));
    for (const command of batch?.commands ?? []) {
      if (command.type.startsWith('todo_')) eventTodoIds.add(command.args.id);
    }
    await this.db.writeTransaction(async (tx) => {
      const todoBefore = new Map<string, Record<string, unknown> | null>();
      for (const id of eventTodoIds) {
        todoBefore.set(id, await this.getProjectionWith(tx, 'todo', id));
      }
      const state = await tx.get<{ bootstrap_started: number }>(
        'SELECT bootstrap_started FROM todo_sync_state WHERE customer_id=?',
        [this.customerId],
      );
      if (response.full_sync && response.sync_phase === 'working_set' && state.bootstrap_started === 0) {
        await tx.execute('UPDATE todo_sync_baselines SET reconcile_pending=1');
        await tx.execute('UPDATE todo_domains SET reconcile_pending=1 WHERE sync_revision<>\'0\'');
        await tx.execute('UPDATE todos SET reconcile_pending=1 WHERE sync_revision<>\'0\'');
        await tx.execute('UPDATE sub_todos SET reconcile_pending=1 WHERE sync_revision<>\'0\'');
        await tx.execute('UPDATE todo_sync_state SET bootstrap_started=1 WHERE customer_id=?', [this.customerId]);
        changed = true;
      }

      const affected = new Set<string>();
      if (batch) {
        for (const command of batch.commands) {
          const status = response.sync_status[command.uuid.toLowerCase()];
          if (!status) throw new Error(`[todoist sync] response omitted status ${command.uuid}`);
          if (status.status === 'ok') {
            await tx.execute(
              `UPDATE todo_sync_outbox SET state='acknowledged_waiting_resource',batch_id=NULL,
               ack_revision=?,canonical_resource_type=?,canonical_resource_id=?,updated_at=?
               WHERE command_uuid=? AND state='in_flight' AND batch_id=?`,
              [status.sync_revision, status.canonical_resource.resource_type, status.canonical_resource.id, Date.now(), command.uuid, batch.id],
            );
          } else if (status.sync_revision && status.canonical_resource) {
            await tx.execute(
              `UPDATE todo_sync_outbox SET state='error_waiting_resource',batch_id=NULL,
               ack_revision=?,canonical_resource_type=?,canonical_resource_id=?,error_code=?,error_message=?,updated_at=?
               WHERE command_uuid=? AND state='in_flight' AND batch_id=?`,
              [status.sync_revision, status.canonical_resource.resource_type, status.canonical_resource.id, status.error_code, status.error, Date.now(), command.uuid, batch.id],
            );
          } else {
            await tx.execute(
              `UPDATE todo_sync_outbox SET state='permanent_failed',batch_id=NULL,error_code=?,error_message=?,updated_at=?
               WHERE command_uuid=? AND state='in_flight' AND batch_id=?`,
              [status.error_code, status.error, Date.now(), command.uuid, batch.id],
            );
            const blocked = await this.blockFailedDependencies(tx, command.uuid);
            for (const target of blocked) affected.add(`${target.type}:${target.id}`);
          }
        }
      }

      for (const resource of response.todo_domains) {
        if (await this.applyBaseline(tx, 'todo_domain', resource)) affected.add(`todo_domain:${resource.id}`);
      }
      for (const resource of response.todos) {
        if (await this.applyBaseline(tx, 'todo', resource)) affected.add(`todo:${resource.id}`);
      }
      for (const resource of response.sub_todos) {
        if (await this.applyBaseline(tx, 'sub_todo', resource)) affected.add(`sub_todo:${resource.id}`);
      }

      if (batch) {
        const batchRows = await tx.getAll<OutboxRow>(
          'SELECT * FROM todo_sync_outbox WHERE batch_id=? OR command_uuid IN (' + batch.commands.map(() => '?').join(',') + ')',
          [batch.id, ...batch.commands.map((command) => command.uuid)],
        );
        for (const row of batchRows) {
          affected.add(`${row.resource_type}:${row.resource_id}`);
        }
      }

      const rank: Record<TodoistSyncResourceType, number> = { todo_domain: 0, todo: 1, sub_todo: 2 };
      const removals: Array<[TodoistSyncResourceType, string]> = [];
      const materializations: Array<[TodoistSyncResourceType, string]> = [];
      for (const key of affected) {
        const target = key.split(':') as [TodoistSyncResourceType, string];
        (await this.hasProjectionSource(tx, ...target) ? materializations : removals).push(target);
      }
      removals.sort((left, right) => rank[right[0]] - rank[left[0]] || left[1].localeCompare(right[1]));
      materializations.sort((left, right) => rank[left[0]] - rank[right[0]] || left[1].localeCompare(right[1]));
      const queue = [...removals, ...materializations];
      const queued = new Set(queue.map(([type, id]) => `${type}:${id}`));
      for (let index = 0; index < queue.length; index += 1) {
        const [type, id] = queue[index];
        if (type === 'todo' && !todoBefore.has(id)) {
          eventTodoIds.add(id);
          todoBefore.set(id, await this.getProjectionWith(tx, type, id));
        }
        const blocked = await this.proveWaitingCommands(tx, type, id);
        blocked.sort((left, right) => rank[right.type] - rank[left.type] || left.id.localeCompare(right.id));
        for (const target of blocked) {
          const key = `${target.type}:${target.id}`;
          affected.add(key);
          if (queued.has(key)) continue;
          queued.add(key);
          queue.push([target.type, target.id]);
        }
        if (await this.materialize(tx, type, id) !== 'materialized') continue;
        const dependents = await this.pendingDependentBaselines(tx, type, id);
        for (const dependent of dependents) {
          const key = `${dependent.type}:${dependent.id}`;
          affected.add(key);
          if (queued.has(key)) continue;
          queued.add(key);
          queue.push([dependent.type, dependent.id]);
        }
      }

      for (const id of eventTodoIds) {
        const after = await this.getProjectionWith(tx, 'todo', id);
        if (await this.insertRemoteTodoEvent(tx, todoBefore.get(id) ?? null, after)) changed = true;
      }

      const catchup = response.full_sync && response.sync_phase === 'reconcile' && !response.has_more ? 1 : 0;
      await tx.execute(
        `UPDATE todo_sync_state SET sync_token=?,sync_phase=?,snowflake_node_id=?,
         bootstrap_catchup_pending=?,last_success_at=?,last_error=NULL,updated_at=? WHERE customer_id=?`,
        [response.sync_token, response.sync_phase, response.snowflake_node_id, catchup, Date.now(), Date.now(), this.customerId],
      );
      if (!response.full_sync && !response.has_more) {
        await tx.execute('UPDATE todo_sync_state SET bootstrap_catchup_pending=0 WHERE customer_id=?', [this.customerId]);
      }
      changed ||= affected.size > 0 || !!batch;
    }, () => {
      if (!isCommitAllowed()) throw new TodoistSyncGenerationFenceError();
    }).catch((error: unknown) => {
      if (previousNodeId === null) this.ids.resetUncommittedNodeId(response.snowflake_node_id);
      throw error;
    });
    if (changed) this.broadcastDataUpdated(null);
  }

  async recordSyncError(message: string, isCommitAllowed: () => boolean = () => true): Promise<void> {
    await this.db.writeTransaction(async (tx) => {
      await tx.execute('UPDATE todo_sync_state SET last_error=?,updated_at=? WHERE customer_id=?', [message.slice(0, 1000), Date.now(), this.customerId]);
    }, () => {
      if (!isCommitAllowed()) throw new TodoistSyncGenerationFenceError();
    });
  }

  async resetSyncTokenForBootstrap(isCommitAllowed: () => boolean = () => true): Promise<void> {
    await this.db.writeTransaction(async (tx) => {
      await tx.execute(
        "UPDATE todo_sync_state SET sync_token='*',sync_phase=NULL,bootstrap_started=0,bootstrap_catchup_pending=0,updated_at=? WHERE customer_id=?",
        [Date.now(), this.customerId],
      );
    }, () => {
      if (!isCommitAllowed()) throw new TodoistSyncGenerationFenceError();
    });
  }

  async hasClockRejectedBatch(): Promise<boolean> {
    const row = await this.db.get<{ rejected_batch_id: string | null }>(
      'SELECT rejected_batch_id FROM todo_sync_state WHERE customer_id=?', [this.customerId],
    );
    return row.rejected_batch_id !== null;
  }

  async hasPendingCommands(): Promise<boolean> {
    const row = await this.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_sync_outbox WHERE state='pending'",
    );
    return row.count > 0;
  }

  async getDiagnostics(): Promise<{ pending: number; failed: number; last_success_at: number | null; last_error: string | null }> {
    const counts = await this.db.get<{ pending: number; failed: number }>(
      `SELECT
        SUM(CASE WHEN state IN ('pending','in_flight','acknowledged_waiting_resource','error_waiting_resource','clock_rejected') THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN state IN ('permanent_failed','blocked_by_failed_dependency') THEN 1 ELSE 0 END) AS failed
       FROM todo_sync_outbox`,
    );
    const state = await this.db.get<{ last_success_at: number | null; last_error: string | null }>(
      'SELECT last_success_at,last_error FROM todo_sync_state WHERE customer_id=?', [this.customerId],
    );
    return { pending: counts.pending ?? 0, failed: counts.failed ?? 0, ...state };
  }

  async getFailures(): Promise<Array<{ uuid: string; command_type: TodoistSyncCommandType; error_code: string | null; error_message: string | null }>> {
    const rows = await this.db.getAll<OutboxRow>(
      "SELECT * FROM todo_sync_outbox WHERE state IN ('permanent_failed','blocked_by_failed_dependency') ORDER BY command_order",
    );
    return rows.map((row) => ({ uuid: row.command_uuid, command_type: row.command_type, error_code: row.error_code, error_message: row.error_message }));
  }

  async retryFailed(uuid: string): Promise<void> {
    await this.db.writeTransaction(async (tx) => {
      const row = await tx.getOptional<OutboxRow>(
        "SELECT * FROM todo_sync_outbox WHERE command_uuid=? AND state IN ('permanent_failed','blocked_by_failed_dependency')",
        [uuid],
      );
      if (!row) throw new Error('[todoist sync] failed command was not found');
      const args = parseJson<Record<string, unknown>>(row.args_json, 'outbox args');
      const version = await this.nextVersion(tx);
      Object.assign(args, {
        client_updated_at: version.now,
        client_sequence: version.sequence,
        base_revision: await this.getBaseRevision(tx, row.resource_type, row.resource_id),
      });
      await tx.execute("UPDATE todo_sync_outbox SET state='superseded',updated_at=? WHERE command_uuid=?", [version.now, uuid]);
      await tx.execute(
        `INSERT INTO todo_sync_outbox (
          command_uuid,command_type,resource_type,resource_id,parent_resource_id,args_json,
          preimage_json,state,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
        [version.uuid, row.command_type, row.resource_type, row.resource_id, row.parent_resource_id, JSON.stringify(args), row.preimage_json, version.now, version.now],
      );
      await this.materialize(tx, row.resource_type, row.resource_id);
    });
    this.afterMutation();
  }

  async discardFailed(uuid: string): Promise<void> {
    const row = await this.db.getOptional<OutboxRow>(
      "SELECT * FROM todo_sync_outbox WHERE command_uuid=? AND state IN ('permanent_failed','blocked_by_failed_dependency')",
      [uuid],
    );
    if (!row) throw new Error('[todoist sync] failed command was not found');
    await this.db.execute("UPDATE todo_sync_outbox SET state='discarded',updated_at=? WHERE command_uuid=?", [Date.now(), uuid]);
  }

  private async recoverLegacyDeviceBinding(
    expectedNodeId: number,
    isCommitAllowed: () => boolean,
  ): Promise<boolean> {
    const recovered = await this.db.writeTransaction(async (tx) => {
      const state = await tx.get<{
        device_id: string;
        snowflake_node_id: number | null;
      }>(
        'SELECT device_id,snowflake_node_id FROM todo_sync_state WHERE customer_id=?',
        [this.customerId],
      );
      if (
        state.device_id !== this.deviceId ||
        state.snowflake_node_id !== expectedNodeId ||
        !await this.isDeviceBindingRecoveryClean(tx)
      ) {
        return false;
      }
      const result = await tx.execute(
        `UPDATE todo_sync_state SET sync_token='*',sync_phase=NULL,snowflake_node_id=NULL,
         bootstrap_started=0,bootstrap_catchup_pending=1,last_error=NULL,updated_at=?
         WHERE customer_id=? AND device_id=? AND snowflake_node_id=?`,
        [Date.now(), this.customerId, this.deviceId, expectedNodeId],
      );
      if (result.changes !== 1) {
        throw new Error(TODOIST_SYNC_SNOWFLAKE_NODE_MISMATCH);
      }
      return true;
    }, () => {
      if (!isCommitAllowed()) throw new TodoistSyncGenerationFenceError();
      if (this.ids.getNodeId() !== expectedNodeId) {
        throw new Error(TODOIST_SYNC_SNOWFLAKE_NODE_MISMATCH);
      }
    });
    if (recovered) this.ids.clearNodeId(expectedNodeId);
    return recovered;
  }

  private async isDeviceBindingRecoveryClean(tx: TodoistSyncSqlExecutor): Promise<boolean> {
    const state = await tx.get<{ rejected_batch_id: string | null }>(
      'SELECT rejected_batch_id FROM todo_sync_state WHERE customer_id=?',
      [this.customerId],
    );
    if (state.rejected_batch_id !== null) return false;
    const outbox = await tx.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM todo_sync_outbox WHERE state NOT IN ('superseded','discarded')",
    );
    if (outbox.count > 0) return false;
    const projections = await tx.get<{ count: number }>(
      `SELECT
        (SELECT COUNT(*) FROM todo_domains WHERE customer_id=? AND sync_revision='0') +
        (SELECT COUNT(*) FROM todos WHERE customer_id=? AND sync_revision='0') +
        (SELECT COUNT(*) FROM sub_todos WHERE customer_id=? AND sync_revision='0') AS count`,
      [this.customerId, this.customerId, this.customerId],
    );
    return projections.count === 0;
  }

  private async mutate(
    resourceType: TodoistSyncResourceType,
    id: string,
    commandType: TodoistSyncCommandType,
    parentId: string | null,
    fields: Record<string, unknown>,
    operation: (tx: TodoistSyncSqlExecutor, version: { uuid: string; now: number; sequence: number }) => Promise<void>,
    context?: TodoMutationContext,
  ): Promise<void> {
    await this.db.writeTransaction(async (tx) => {
      const preimage = await this.getProjectionWith(tx, resourceType, id);
      const version = await this.nextVersion(tx);
      await operation(tx, version);
      await this.insertOutbox(tx, resourceType, id, commandType, parentId, fields, preimage, version);
    });
    this.afterMutation(context);
  }

  private async nextVersion(tx: TodoistSyncSqlExecutor, now = Date.now()): Promise<{ uuid: string; now: number; sequence: number }> {
    const row = await tx.get<{ device_sequence: number }>(
      `UPDATE todo_sync_state SET device_sequence=device_sequence+1,updated_at=? WHERE customer_id=?
       RETURNING device_sequence`,
      [now, this.customerId],
    );
    return { uuid: randomUUID(), now, sequence: row.device_sequence };
  }

  private async insertOutbox(
    tx: TodoistSyncSqlExecutor,
    resourceType: TodoistSyncResourceType,
    id: string,
    commandType: TodoistSyncCommandType,
    parentId: string | null,
    fields: Record<string, unknown>,
    preimage: Record<string, unknown> | null,
    version: { uuid: string; now: number; sequence: number },
  ): Promise<void> {
    const args = {
      id,
      ...fields,
      client_updated_at: version.now,
      client_sequence: version.sequence,
      base_revision: await this.getBaseRevision(tx, resourceType, id),
    };
    await tx.execute(
      `INSERT INTO todo_sync_outbox (
        command_uuid,command_type,resource_type,resource_id,parent_resource_id,args_json,
        preimage_json,state,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,'pending',?,?)`,
      [version.uuid, commandType, resourceType, id, parentId, JSON.stringify(args), preimage ? JSON.stringify(preimage) : null, version.now, version.now],
    );
  }

  private async getBaseRevision(tx: TodoistSyncSqlExecutor, type: TodoistSyncResourceType, id: string): Promise<string> {
    return (await tx.getOptional<{ sync_revision: string }>(
      'SELECT sync_revision FROM todo_sync_baselines WHERE resource_type=? AND resource_id=?', [type, id],
    ))?.sync_revision ?? '0';
  }

  private async applyBaseline(
    tx: TodoistSyncSqlExecutor,
    type: TodoistSyncResourceType,
    resource: TodoistSyncDomainResource | TodoistSyncTodoResource | TodoistSyncSubTodoResource,
  ): Promise<boolean> {
    const parentResourceId = type === 'todo'
      ? (resource as TodoistSyncTodoResource).domain_id
      : type === 'sub_todo' ? (resource as TodoistSyncSubTodoResource).todo_id : null;
    const stored = await tx.getOptional<BaselineRow>(
      'SELECT * FROM todo_sync_baselines WHERE resource_type=? AND resource_id=?', [type, resource.id],
    );
    if (stored) {
      const comparison = revisionCompare(resource.sync_revision, stored.sync_revision);
      if (comparison < 0) return false;
      if (comparison === 0 && canonicalize(resource) !== canonicalize(parseJson(stored.payload_json, 'baseline'))) {
        throw new Error(`[todoist sync] equal-revision payload mismatch for ${type}:${resource.id}`);
      }
      if (comparison === 0) {
        await tx.execute('UPDATE todo_sync_baselines SET reconcile_pending=0,updated_at=? WHERE resource_type=? AND resource_id=?', [Date.now(), type, resource.id]);
        return true;
      }
    }
    await tx.execute(
      `INSERT INTO todo_sync_baselines (
         resource_type,resource_id,parent_resource_id,sync_revision,payload_json,reconcile_pending,updated_at
       ) VALUES (?,?,?,?,?,0,?) ON CONFLICT(resource_type,resource_id) DO UPDATE SET
       parent_resource_id=excluded.parent_resource_id,sync_revision=excluded.sync_revision,
       payload_json=excluded.payload_json,reconcile_pending=0,updated_at=excluded.updated_at`,
      [type, resource.id, parentResourceId, resource.sync_revision, JSON.stringify(resource), Date.now()],
    );
    return true;
  }

  private async proveWaitingCommands(
    tx: TodoistSyncSqlExecutor,
    type: TodoistSyncResourceType,
    id: string,
  ): Promise<Array<{ type: TodoistSyncResourceType; id: string }>> {
    const baseline = await tx.getOptional<BaselineRow>(
      'SELECT * FROM todo_sync_baselines WHERE resource_type=? AND resource_id=?', [type, id],
    );
    if (!baseline) return [];
    const blocked: Array<{ type: TodoistSyncResourceType; id: string }> = [];
    const rows = await tx.getAll<OutboxRow>(
      `SELECT * FROM todo_sync_outbox WHERE canonical_resource_type=? AND canonical_resource_id=?
       AND state IN ('acknowledged_waiting_resource','error_waiting_resource') ORDER BY command_order`,
      [type, id],
    );
    for (const row of rows) {
      if (!row.ack_revision || revisionCompare(baseline.sync_revision, row.ack_revision) < 0) continue;
      if (row.state === 'acknowledged_waiting_resource') {
        await tx.execute('DELETE FROM todo_sync_outbox WHERE command_uuid=?', [row.command_uuid]);
      } else {
        await tx.execute("UPDATE todo_sync_outbox SET state='permanent_failed',updated_at=? WHERE command_uuid=?", [Date.now(), row.command_uuid]);
        blocked.push(...await this.blockFailedDependencies(tx, row.command_uuid));
      }
    }
    return blocked;
  }

  private async blockFailedDependencies(
    tx: TodoistSyncSqlExecutor,
    failedUuid: string,
  ): Promise<Array<{ type: TodoistSyncResourceType; id: string }>> {
    const failed = await tx.getOptional<OutboxRow>('SELECT * FROM todo_sync_outbox WHERE command_uuid=?', [failedUuid]);
    if (!failed || !failed.command_type.endsWith('_add')) return [];
    const affected: Array<{ type: TodoistSyncResourceType; id: string }> = [];
    const queue = [failed];
    const expanded = new Set<string>();
    for (let index = 0; index < queue.length; index += 1) {
      const parent = queue[index];
      if (expanded.has(parent.command_uuid)) continue;
      expanded.add(parent.command_uuid);
      const result = await tx.execute(
        `UPDATE todo_sync_outbox SET state='blocked_by_failed_dependency',error_code='FAILED_DEPENDENCY',updated_at=?
         WHERE command_order>? AND state IN ('pending','clock_rejected')
         AND (resource_id=? OR parent_resource_id=?) RETURNING *`,
        [Date.now(), parent.command_order, parent.resource_id, parent.resource_id],
      );
      const rows = (result.rows?._array ?? []) as OutboxRow[];
      for (const row of rows) {
        affected.push({ type: row.resource_type, id: row.resource_id });
        if (row.command_type.endsWith('_add')) queue.push(row);
      }
    }
    return affected;
  }

  private async hasProjectionSource(
    tx: TodoistSyncSqlExecutor,
    type: TodoistSyncResourceType,
    id: string,
  ): Promise<boolean> {
    if (await tx.getOptional<{ resource_id: string }>(
      'SELECT resource_id FROM todo_sync_baselines WHERE resource_type=? AND resource_id=?', [type, id],
    )) return true;
    return !!await tx.getOptional<{ command_uuid: string }>(
      `SELECT command_uuid FROM todo_sync_outbox WHERE resource_type=? AND resource_id=?
       AND command_type LIKE '%_add' AND state IN (${ACTIVE_OVERLAY_STATES.map(() => '?').join(',')}) LIMIT 1`,
      [type, id, ...ACTIVE_OVERLAY_STATES],
    );
  }

  private async materialize(
    tx: TodoistSyncSqlExecutor,
    type: TodoistSyncResourceType,
    id: string,
  ): Promise<MaterializeResult> {
    const baseline = await tx.getOptional<BaselineRow>(
      'SELECT * FROM todo_sync_baselines WHERE resource_type=? AND resource_id=?', [type, id],
    );
    let projection: Record<string, unknown> | null = baseline
      ? { ...parseJson<Record<string, unknown>>(baseline.payload_json, 'baseline'), reconcile_pending: baseline.reconcile_pending }
      : null;
    const overlays = await tx.getAll<OutboxRow>(
      `SELECT * FROM todo_sync_outbox WHERE resource_type=? AND resource_id=?
       AND state IN (${ACTIVE_OVERLAY_STATES.map(() => '?').join(',')}) ORDER BY command_order`,
      [type, id, ...ACTIVE_OVERLAY_STATES],
    );
    for (const overlay of overlays) {
      const args = parseJson<Record<string, unknown>>(overlay.args_json, 'outbox args');
      if (overlay.command_type.endsWith('_add')) {
        projection = {
          ...(projection ?? {}),
          ...args,
          id,
          created_at: projection?.created_at ?? args.client_updated_at,
          client_updated_at: args.client_updated_at,
          version_device_id: this.deviceId,
          version_client_sequence: args.client_sequence,
          version_command_uuid: overlay.command_uuid,
          sync_revision: projection?.sync_revision ?? '0',
          deleted_flag: '',
          deleted_at: null,
          reconcile_pending: 0,
        };
      } else if (overlay.command_type.endsWith('_update') && projection) {
        const { id: _id, client_updated_at, client_sequence, base_revision: _baseRevision, ...fields } = args;
        Object.assign(projection, fields, {
          client_updated_at,
          version_device_id: this.deviceId,
          version_client_sequence: client_sequence,
          version_command_uuid: overlay.command_uuid,
          reconcile_pending: 0,
        });
      } else if (overlay.command_type.endsWith('_delete') && projection) {
        Object.assign(projection, {
          client_updated_at: args.client_updated_at,
          version_device_id: this.deviceId,
          version_client_sequence: args.client_sequence,
          version_command_uuid: overlay.command_uuid,
          deleted_flag: `local:${overlay.command_uuid}`,
          deleted_at: args.client_updated_at,
          reconcile_pending: 0,
        });
      }
    }
    if (!projection) {
      if (type === 'todo_domain' && await tx.getOptional<{ id: string }>(
        'SELECT id FROM todos WHERE domain_id=? AND customer_id=? LIMIT 1', [id, this.customerId],
      )) return 'deferred';
      if (type === 'todo' && await tx.getOptional<{ id: string }>(
        'SELECT id FROM sub_todos WHERE todo_id=? AND customer_id=? LIMIT 1', [id, this.customerId],
      )) return 'deferred';
      await tx.execute(`DELETE FROM ${this.tableFor(type)} WHERE id=? AND customer_id=?`, [id, this.customerId]);
      return 'removed';
    }
    if (type === 'todo') {
      const parentId = assertTodoistSyncEntityId(projection.domain_id);
      const parent = await tx.getOptional<{ id: string }>(
        'SELECT id FROM todo_domains WHERE id=? AND customer_id=?', [parentId, this.customerId],
      );
      if (!parent) return 'deferred';
    } else if (type === 'sub_todo') {
      const parentId = assertTodoistSyncEntityId(projection.todo_id);
      const parent = await tx.getOptional<{ id: string }>(
        'SELECT id FROM todos WHERE id=? AND customer_id=?', [parentId, this.customerId],
      );
      if (!parent) return 'deferred';
    }
    await this.upsertProjection(tx, type, projection);
    return 'materialized';
  }

  private async pendingDependentBaselines(
    tx: TodoistSyncSqlExecutor,
    type: TodoistSyncResourceType,
    id: string,
  ): Promise<Array<{ type: TodoistSyncResourceType; id: string }>> {
    if (type === 'sub_todo') return [];
    if (type === 'todo_domain') {
      const rows = await tx.getAll<{ id: string }>(
        `SELECT baseline.resource_id AS id
         FROM todo_sync_baselines baseline
         LEFT JOIN todos projection ON projection.id=baseline.resource_id AND projection.customer_id=?
         WHERE baseline.resource_type='todo'
           AND baseline.parent_resource_id=?
           AND (projection.id IS NULL OR projection.sync_revision<>baseline.sync_revision)
         ORDER BY baseline.resource_id`,
        [this.customerId, id],
      );
      return rows.map((row) => ({ type: 'todo', id: row.id }));
    }
    const rows = await tx.getAll<{ id: string }>(
      `SELECT baseline.resource_id AS id
       FROM todo_sync_baselines baseline
       LEFT JOIN sub_todos projection ON projection.id=baseline.resource_id AND projection.customer_id=?
       WHERE baseline.resource_type='sub_todo'
         AND baseline.parent_resource_id=?
         AND (projection.id IS NULL OR projection.sync_revision<>baseline.sync_revision)
       ORDER BY baseline.resource_id`,
      [this.customerId, id],
    );
    return rows.map((row) => ({ type: 'sub_todo', id: row.id }));
  }

  private async upsertProjection(tx: TodoistSyncSqlExecutor, type: TodoistSyncResourceType, value: Record<string, unknown>): Promise<void> {
    const common = [
      value.id, this.customerId, value.created_at, value.client_updated_at,
      value.version_device_id, value.version_client_sequence, value.version_command_uuid,
      value.sync_revision, value.deleted_flag, value.deleted_at, value.reconcile_pending ?? 0,
    ];
    if (type === 'todo_domain') {
      await tx.execute(
        `INSERT INTO todo_domains (
          id,customer_id,title,description,archived,position,created_at,client_updated_at,
          version_device_id,version_client_sequence,version_command_uuid,sync_revision,deleted_flag,deleted_at,reconcile_pending
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          title=excluded.title,description=excluded.description,archived=excluded.archived,position=excluded.position,
          created_at=excluded.created_at,client_updated_at=excluded.client_updated_at,version_device_id=excluded.version_device_id,
          version_client_sequence=excluded.version_client_sequence,version_command_uuid=excluded.version_command_uuid,
          sync_revision=excluded.sync_revision,deleted_flag=excluded.deleted_flag,deleted_at=excluded.deleted_at,
          reconcile_pending=excluded.reconcile_pending`,
        [common[0], common[1], value.title, value.description, value.archived, value.position, ...common.slice(2)],
      );
      return;
    }
    if (type === 'todo') {
      await tx.execute(
        `INSERT INTO todos (
          id,customer_id,domain_id,title,status,important,due_at,repeat_type,repeat_interval,remind_at,
          last_remind_at,last_complete_at,week_day,monthly_day,yearly_day,note,source,position,created_at,
          client_updated_at,version_device_id,version_client_sequence,version_command_uuid,sync_revision,
          deleted_flag,deleted_at,reconcile_pending
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
          domain_id=excluded.domain_id,title=excluded.title,status=excluded.status,important=excluded.important,
          due_at=excluded.due_at,repeat_type=excluded.repeat_type,repeat_interval=excluded.repeat_interval,
          remind_at=excluded.remind_at,last_remind_at=excluded.last_remind_at,last_complete_at=excluded.last_complete_at,
          week_day=excluded.week_day,monthly_day=excluded.monthly_day,yearly_day=excluded.yearly_day,note=excluded.note,
          source=excluded.source,position=excluded.position,created_at=excluded.created_at,
          client_updated_at=excluded.client_updated_at,version_device_id=excluded.version_device_id,
          version_client_sequence=excluded.version_client_sequence,version_command_uuid=excluded.version_command_uuid,
          sync_revision=excluded.sync_revision,deleted_flag=excluded.deleted_flag,deleted_at=excluded.deleted_at,
          reconcile_pending=excluded.reconcile_pending`,
        [common[0], common[1], value.domain_id, value.title, value.status, value.important, value.due_at, value.repeat_type,
          value.repeat_interval, value.remind_at, value.last_remind_at, value.last_complete_at, value.week_day,
          value.monthly_day, value.yearly_day, value.note, value.source, value.position, ...common.slice(2)],
      );
      return;
    }
    await tx.execute(
      `INSERT INTO sub_todos (
        id,customer_id,todo_id,title,status,position,created_at,client_updated_at,version_device_id,
        version_client_sequence,version_command_uuid,sync_revision,deleted_flag,deleted_at,reconcile_pending
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        todo_id=excluded.todo_id,title=excluded.title,status=excluded.status,position=excluded.position,
        created_at=excluded.created_at,client_updated_at=excluded.client_updated_at,version_device_id=excluded.version_device_id,
        version_client_sequence=excluded.version_client_sequence,version_command_uuid=excluded.version_command_uuid,
        sync_revision=excluded.sync_revision,deleted_flag=excluded.deleted_flag,deleted_at=excluded.deleted_at,
        reconcile_pending=excluded.reconcile_pending`,
      [common[0], common[1], value.todo_id, value.title, value.status, value.position, ...common.slice(2)],
    );
  }

  private async getProjection(type: TodoistSyncResourceType, id: string): Promise<Record<string, unknown> | null> {
    return await this.getProjectionWith(this.db, type, id);
  }

  private async getProjectionWith(tx: TodoistSyncSqlExecutor, type: TodoistSyncResourceType, id: string): Promise<Record<string, unknown> | null> {
    return await tx.getOptional<Record<string, unknown>>(
      `SELECT * FROM ${this.tableFor(type)} WHERE id=? AND customer_id=?`, [id, this.customerId],
    ) ?? null;
  }

  private tableFor(type: TodoistSyncResourceType): 'todo_domains' | 'todos' | 'sub_todos' {
    if (type === 'todo_domain') return 'todo_domains';
    if (type === 'todo') return 'todos';
    return 'sub_todos';
  }

  private async nextPosition(
    tx: TodoistSyncSqlExecutor,
    table: 'todo_domains' | 'todos' | 'sub_todos',
    where: string,
    values: unknown[],
  ): Promise<number> {
    const row = await tx.get<{ position: number | null }>(`SELECT MAX(position) AS position FROM ${table} WHERE ${where}`, values);
    return row.position === null ? 0 : row.position + 1;
  }

  private async insertRemoteTodoEvent(
    tx: TodoistSyncSqlExecutor,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<boolean> {
    const beforeLive = before !== null && before.deleted_flag === '';
    const afterLive = after !== null && after.deleted_flag === '';
    if (!beforeLive && afterLive && after) {
      await this.insertEvent(
        tx,
        'todo.created',
        assertTodoistSyncEntityId(after.id),
        assertTodoistSyncEntityId(after.domain_id),
        'system',
        { title: assertText(after.title, 'todo.title', 512), source: assertSource(after.source as McpTodoSource) },
      );
      return true;
    }
    if (beforeLive && !afterLive && before) {
      await this.insertEvent(
        tx,
        'todo.deleted',
        assertTodoistSyncEntityId(before.id),
        assertTodoistSyncEntityId(before.domain_id),
        'system',
        { title: assertText(before.title, 'todo.title', 512) },
      );
      return true;
    }
    if (!beforeLive || !afterLive || !before || !after) return false;
    const changedFields = TODO_EVENT_FIELDS.filter((field) => before[field] !== after[field]);
    if (changedFields.length === 0) return false;
    let type: McpTodoEventType = 'todo.updated';
    if (before.status !== after.status) type = after.status === 1 ? 'todo.completed' : 'todo.uncompleted';
    else if (before.domain_id !== after.domain_id) type = 'todo.moved';
    else if (before.important !== after.important) type = after.important === 1 ? 'todo.starred' : 'todo.unstarred';
    await this.insertEvent(
      tx,
      type,
      assertTodoistSyncEntityId(after.id),
      assertTodoistSyncEntityId(before.domain_id),
      'system',
      { title: assertText(before.title, 'todo.title', 512), changedFields },
    );
    return true;
  }

  private async insertEvent(
    tx: TodoistSyncSqlExecutor,
    type: McpTodoEventType,
    todoId: TodoEntityId | null,
    domainId: TodoEntityId | null,
    actor: McpTodoEventActor,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!EVENT_TYPES.has(type)) throw new Error(`Unknown Todo event type ${type}`);
    const sequence = (await tx.get<{ sequence: number | null }>('SELECT MAX(sequence) AS sequence FROM todo_events')).sequence ?? 0;
    await tx.execute(
      'INSERT INTO todo_events (id,sequence,type,todo_id,domain_id,actor,payload,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [this.ids.generate(), sequence + 1, type, todoId, domainId, actor, JSON.stringify(payload), Date.now()],
    );
  }

  private afterMutation(context?: TodoMutationContext): void {
    this.broadcastDataUpdated(context?.originRendererId ?? null);
    this.mutationCommitted?.();
  }

  private broadcastDataUpdated(originRendererId: string | null): void {
    const event: TodoDataUpdatedEvent = { originRendererId };
    xpcMain.broadcast('todo/data_updated', event);
  }

  private todoSelectSql(): string {
    return `SELECT id,customer_id,domain_id,title,status,important,due_at,repeat_type,repeat_interval,
      remind_at,last_remind_at,last_complete_at,week_day,monthly_day,yearly_day,note,source,
      CASE WHEN deleted_flag='' THEN 0 ELSE 1 END AS is_deleted,position,created_at,
      client_updated_at AS updated_at FROM todos`;
  }

  private subTodoSelectSql(): string {
    return `SELECT id,customer_id,todo_id,title,status,CASE WHEN deleted_flag='' THEN 0 ELSE 1 END AS is_deleted,
      position,created_at,client_updated_at AS updated_at FROM sub_todos`;
  }

  private assertDomain(row: McpDomainRow): McpDomainRow {
    return { ...row, id: assertTodoistSyncEntityId(row.id), customer_id: this.assertCustomer(row.customer_id), title: assertText(row.title, 'domain.title', 512), description: assertText(row.description, 'domain.description', 10_000), is_deleted: assertLiveFlag(row.is_deleted, 'domain.is_deleted'), archived: assertFlag(row.archived, 'domain.archived'), position: assertInteger(row.position, 'domain.position', -2147483648, 2147483647), created_at: assertInteger(row.created_at, 'domain.created_at'), updated_at: assertInteger(row.updated_at, 'domain.updated_at') };
  }

  private assertTodo(row: McpTodoRow): McpTodoRow {
    return {
      ...row,
      id: assertTodoistSyncEntityId(row.id), customer_id: this.assertCustomer(row.customer_id), domain_id: assertTodoistSyncEntityId(row.domain_id),
      title: assertText(row.title, 'todo.title', 512), status: assertFlag(row.status, 'todo.status'), important: assertFlag(row.important, 'todo.important'),
      due_at: row.due_at === null ? null : assertInteger(row.due_at, 'todo.due_at'), repeat_type: row.repeat_type,
      repeat_interval: assertInteger(row.repeat_interval, 'todo.repeat_interval', 1, 2147483647),
      remind_at: row.remind_at === null ? null : assertInteger(row.remind_at, 'todo.remind_at'),
      last_remind_at: row.last_remind_at === null ? null : assertInteger(row.last_remind_at, 'todo.last_remind_at'),
      last_complete_at: row.last_complete_at === null ? null : assertInteger(row.last_complete_at, 'todo.last_complete_at'),
      week_day: row.week_day === null ? null : assertInteger(row.week_day, 'todo.week_day', 1, 7),
      monthly_day: row.monthly_day === null ? null : assertInteger(row.monthly_day, 'todo.monthly_day', 1, 31),
      yearly_day: row.yearly_day === null ? null : assertInteger(row.yearly_day, 'todo.yearly_day', 1, 31),
      note: assertText(row.note, 'todo.note', 50_000), source: assertSource(row.source), is_deleted: assertLiveFlag(row.is_deleted, 'todo.is_deleted'),
      position: assertInteger(row.position, 'todo.position', -2147483648, 2147483647), created_at: assertInteger(row.created_at, 'todo.created_at'), updated_at: assertInteger(row.updated_at, 'todo.updated_at'),
    };
  }

  private assertSubTodo(row: McpSubTodoRow): McpSubTodoRow {
    return { ...row, id: assertTodoistSyncEntityId(row.id), customer_id: this.assertCustomer(row.customer_id), todo_id: assertTodoistSyncEntityId(row.todo_id), title: assertText(row.title, 'subTodo.title', 512), status: assertFlag(row.status, 'subTodo.status'), is_deleted: assertLiveFlag(row.is_deleted, 'subTodo.is_deleted'), position: assertInteger(row.position, 'subTodo.position', -2147483648, 2147483647), created_at: assertInteger(row.created_at, 'subTodo.created_at'), updated_at: assertInteger(row.updated_at, 'subTodo.updated_at') };
  }

  private assertCustomer(value: unknown): string {
    if (value !== this.customerId) throw new Error('[todoist sync] row ownership does not match active customer');
    return this.customerId;
  }

  private parseSortKey(key: string): { type: 'domain'; parentId: null } | { type: 'todo' | 'subTodo'; parentId: string } {
    if (key === 'domain') return { type: 'domain', parentId: null };
    if (key.startsWith('todo__')) return { type: 'todo', parentId: assertTodoistSyncEntityId(key.slice(6)) };
    if (key.startsWith('subtodo__')) return { type: 'subTodo', parentId: assertTodoistSyncEntityId(key.slice(9)) };
    throw new Error(`Unknown Todo sort key ${key}`);
  }

  private computeNextDue(todo: McpTodoRow): number {
    const interval = Math.max(1, todo.repeat_interval);
    const original = moment(todo.due_at).startOf('day');
    if (todo.repeat_type === 'daily') return original.add(interval, 'day').valueOf();
    if (todo.repeat_type === 'weekly') return original.add(interval * 7, 'day').valueOf();
    if (todo.repeat_type === 'monthly') {
      const candidate = original.add(interval, 'month').startOf('month');
      return candidate.date(Math.min(todo.monthly_day ?? original.date(), candidate.daysInMonth())).valueOf();
    }
    if (todo.repeat_type === 'yearly') {
      const candidate = original.add(interval, 'year').month(original.month()).startOf('month');
      return candidate.date(Math.min(todo.yearly_day ?? original.date(), candidate.daysInMonth())).valueOf();
    }
    throw new Error('Todo has no repeat type');
  }

  private computeNearestFutureDue(todo: McpTodoRow): number {
    let candidate = moment(todo.due_at).startOf('day');
    const today = moment().startOf('day');
    while (candidate.isBefore(today)) {
      const current = { ...todo, due_at: candidate.valueOf() };
      candidate = moment(this.computeNextDue(current));
    }
    return candidate.valueOf();
  }
}
