import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import moment from 'moment';
import { recordTodoEvent } from './todoEvent.dao';
import type { TodoEventActor } from './todoEvent.dao';

export type TodoSource = 'human' | 'ai';

export interface TodoRow {
  id: number;
  domain_id: number;
  title: string;
  status: number;
  important: number;
  due_at: number | null;
  repeat_type: string | null;
  repeat_interval: number;
  remind_at: number | null;
  last_remind_at: number | null;
  last_complete_at: number | null;
  week_day: number | null;
  monthly_day: number | null;
  yearly_day: number | null;
  note: string;
  source: TodoSource;
  is_deleted: number;
  created_at: number;
  updated_at: number;
}

export interface TodoInsertParams {
  domainId: number;
  title: string;
  source?: TodoSource;
  actor?: TodoEventActor;
}

export interface TodoUpdateParams {
  id: number;
  title?: string;
  due_at?: number | null;
  remind_at?: number | null;
  important?: number;
  note?: string | null;
  actor?: TodoEventActor;
}

export type TodoLookupState = 'active' | 'completed' | 'deleted' | 'missing';

export interface TodoStatusItem {
  id: number;
  state: TodoLookupState;
  exists: boolean;
  completed: boolean;
  deleted: boolean;
  title: string | null;
  domain_id: number | null;
  updated_at: number | null;
  completed_at: number | null;
  deleted_at: number | null;
  deleted_event_id: number | null;
}

export interface TodoStatusByIdsResult {
  items: TodoStatusItem[];
  summary: Record<TodoLookupState, number>;
}

interface TodoDeletedEventRow {
  todo_id: number;
  event_id: number;
  payload: string;
  created_at: number;
}

const normalizeTodoSource = (source: TodoSource | undefined): TodoSource => {
  if (source === undefined) return 'human';
  if (source === 'human' || source === 'ai') return source;
  throw new Error('source must be human or ai');
};

const normalizeTodoIds = (ids: number[]): number[] => {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 1) {
      throw new Error('ids must contain positive integers');
    }
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
};

const parseEventPayload = (payload: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return {};
};

export class TodoDao extends BaseDao {
  async create(params: TodoInsertParams): Promise<TodoRow | undefined> {
    const now = Date.now();
    const source = normalizeTodoSource(params.source);
    const result = await sqliteHelper.safeRun(
      'INSERT INTO todos (domain_id, title, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [params.domainId, params.title, source, now, now],
    );
    const todo = await sqliteHelper.safeGet<TodoRow>(
      'SELECT * FROM todos WHERE id = ?',
      [result.lastInsertRowid],
    );
    if (todo) {
      await recordTodoEvent({
        type: 'todo.created',
        todoId: todo.id,
        domainId: todo.domain_id,
        actor: params.actor,
        payload: {
          title: todo.title,
          source: todo.source,
        },
      });
    }
    return todo;
  }

  async getByDomainId(params: { domainId: number; status?: number }): Promise<TodoRow[]> {
    if (params.status !== undefined) {
      return sqliteHelper.safeAll<TodoRow>(
        'SELECT * FROM todos WHERE domain_id = ? AND status = ? ORDER BY created_at DESC',
        [params.domainId, params.status],
      );
    }
    return sqliteHelper.safeAll<TodoRow>(
      'SELECT * FROM todos WHERE domain_id = ? ORDER BY created_at DESC',
      [params.domainId],
    );
  }

  async getById(params: { id: number }): Promise<TodoRow | undefined> {
    return sqliteHelper.safeGet<TodoRow>(
      'SELECT * FROM todos WHERE id = ?',
      [params.id],
    );
  }

  async getStatusByIds(params: { ids: number[] }): Promise<TodoStatusByIdsResult> {
    const ids = normalizeTodoIds(params.ids);
    const summary: Record<TodoLookupState, number> = {
      active: 0,
      completed: 0,
      deleted: 0,
      missing: 0,
    };
    if (ids.length === 0) return { items: [], summary };

    const placeholders = ids.map(() => '?').join(',');
    const rows = await sqliteHelper.safeAll<TodoRow>(
      `SELECT * FROM todos WHERE id IN (${placeholders})`,
      ids,
    );
    const rowMap = new Map<number, TodoRow>();
    for (const row of rows) {
      rowMap.set(row.id, row);
    }

    const deletedRows = await sqliteHelper.safeAll<TodoDeletedEventRow>(
      `SELECT todo_id, id as event_id, payload, created_at FROM todo_events WHERE type = 'todo.deleted' AND todo_id IN (${placeholders}) ORDER BY id DESC`,
      ids,
    );
    const deletedMap = new Map<number, TodoDeletedEventRow>();
    for (const row of deletedRows) {
      if (!deletedMap.has(row.todo_id)) {
        deletedMap.set(row.todo_id, row);
      }
    }

    const items = ids.map((id) => {
      const todo = rowMap.get(id);
      if (todo) {
        const state: TodoLookupState = todo.status === 1 ? 'completed' : 'active';
        summary[state] += 1;
        return {
          id,
          state,
          exists: true,
          completed: todo.status === 1,
          deleted: false,
          title: todo.title,
          domain_id: todo.domain_id,
          updated_at: todo.updated_at,
          completed_at: todo.last_complete_at,
          deleted_at: null,
          deleted_event_id: null,
        };
      }

      const deletedEvent = deletedMap.get(id);
      if (deletedEvent) {
        const payload = parseEventPayload(deletedEvent.payload);
        summary.deleted += 1;
        return {
          id,
          state: 'deleted' as const,
          exists: false,
          completed: false,
          deleted: true,
          title: typeof payload.title === 'string' ? payload.title : null,
          domain_id: null,
          updated_at: null,
          completed_at: null,
          deleted_at: deletedEvent.created_at,
          deleted_event_id: deletedEvent.event_id,
        };
      }

      summary.missing += 1;
      return {
        id,
        state: 'missing' as const,
        exists: false,
        completed: false,
        deleted: false,
        title: null,
        domain_id: null,
        updated_at: null,
        completed_at: null,
        deleted_at: null,
        deleted_event_id: null,
      };
    });

    return { items, summary };
  }

  async update(params: TodoUpdateParams): Promise<TodoRow | undefined> {
    const fields: string[] = [];
    const values: any[] = [];
    const changedFields: string[] = [];

    if (params.title !== undefined) {
      fields.push('title = ?');
      values.push(params.title);
      changedFields.push('title');
    }
    if (params.due_at !== undefined) {
      fields.push('due_at = ?');
      values.push(params.due_at);
      changedFields.push('due_at');

      if (params.due_at !== null) {
        const todo = await this.getById({ id: params.id });
        if (todo?.repeat_type) {
          const dueMoment = moment(params.due_at);
          if (todo.repeat_type === 'weekly') {
            fields.push('week_day = ?');
            values.push(dueMoment.isoWeekday());
          } else if (todo.repeat_type === 'monthly') {
            fields.push('monthly_day = ?');
            values.push(dueMoment.date());
          } else if (todo.repeat_type === 'yearly') {
            fields.push('yearly_day = ?');
            values.push(dueMoment.date());
          }
        }
      }
    }
    if (params.remind_at !== undefined) {
      fields.push('remind_at = ?');
      values.push(params.remind_at);
      changedFields.push('remind_at');
    }
    if (params.important !== undefined) {
      fields.push('important = ?');
      values.push(params.important);
      changedFields.push('important');
    }
    if (params.note !== undefined) {
      fields.push('note = ?');
      values.push(params.note);
      changedFields.push('note');
    }

    if (fields.length === 0) return this.getById({ id: params.id });

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(params.id);

    await sqliteHelper.safeRun(
      `UPDATE todos SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    const todo = await this.getById({ id: params.id });
    if (todo) {
      await recordTodoEvent({
        type: 'todo.updated',
        todoId: todo.id,
        domainId: todo.domain_id,
        actor: params.actor,
        payload: { changedFields },
      });
    }
    return todo;
  }

  async updateRepeatType(params: { id: number; repeatType: string | null; actor?: TodoEventActor }): Promise<TodoRow | undefined> {
    const todo = await this.getById({ id: params.id });
    if (!todo) return undefined;

    const now = Date.now();
    const updates: string[] = ['repeat_type = ?', 'updated_at = ?'];
    const values: any[] = [params.repeatType, now];

    if (params.repeatType && !todo.repeat_type) {
      // Activating repeat — set due_at to today 00:00 if not set, reset interval to 1
      let dueAt = todo.due_at;
      if (!dueAt) {
        dueAt = moment().startOf('day').valueOf();
        updates.push('due_at = ?');
        values.push(dueAt);
      }

      updates.push('repeat_interval = ?');
      values.push(1);

      const dueMoment = moment(dueAt);

      if (params.repeatType === 'weekly') {
        const weekDay = dueMoment.isoWeekday(); // 1=Mon, 7=Sun
        updates.push('week_day = ?');
        values.push(weekDay);
      } else if (params.repeatType === 'monthly') {
        updates.push('monthly_day = ?');
        values.push(dueMoment.date());
      } else if (params.repeatType === 'yearly') {
        updates.push('yearly_day = ?');
        values.push(dueMoment.date());
      }
    }

    if (!params.repeatType) {
      // Clearing repeat — reset helper fields and interval
      updates.push('week_day = NULL', 'monthly_day = NULL', 'yearly_day = NULL', 'repeat_interval = 1');
    }

    values.push(params.id);
    await sqliteHelper.safeRun(
      `UPDATE todos SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    const result = await this.getById({ id: params.id });
    if (result) {
      await recordTodoEvent({
        type: 'todo.updated',
        todoId: result.id,
        domainId: result.domain_id,
        actor: params.actor,
        payload: { changedFields: ['repeat_type'] },
      });
    }
    return result;
  }

  async updateRepeatInterval(params: { id: number; interval: number; actor?: TodoEventActor }): Promise<TodoRow | undefined> {
    const interval = Math.max(1, Math.min(999, Math.floor(params.interval)));
    await sqliteHelper.safeRun(
      'UPDATE todos SET repeat_interval = ?, updated_at = ? WHERE id = ?',
      [interval, Date.now(), params.id],
    );
    const result = await this.getById({ id: params.id });
    if (result) {
      await recordTodoEvent({
        type: 'todo.updated',
        todoId: result.id,
        domainId: result.domain_id,
        actor: params.actor,
        payload: { changedFields: ['repeat_interval'] },
      });
    }
    return result;
  }

  async completeTodo(params: { id: number; actor?: TodoEventActor }): Promise<TodoRow | undefined> {
    const todo = await this.getById({ id: params.id });
    if (!todo) return undefined;

    const now = Date.now();
    const updates: string[] = ['status = 1', 'last_complete_at = ?', 'updated_at = ?'];
    const values: any[] = [now, now];

    if (todo.repeat_type && todo.due_at) {
      const nextDue = this.computeNextDueAfterComplete(todo.due_at, {
        repeatType: todo.repeat_type,
        repeatInterval: todo.repeat_interval ?? 1,
        weekDay: todo.week_day,
        monthlyDay: todo.monthly_day,
        yearlyDay: todo.yearly_day,
      });
      updates.push('due_at = ?', 'status = 0');
      values.push(nextDue);

      // Also advance remind_at if set
      if (todo.remind_at) {
        const remindOffset = todo.remind_at - todo.due_at;
        updates.push('remind_at = ?', 'last_remind_at = ?');
        values.push(nextDue + remindOffset, todo.remind_at);
      }
    }

    values.push(params.id);
    await sqliteHelper.safeRun(
      `UPDATE todos SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    const result = await this.getById({ id: params.id });
    if (result) {
      await recordTodoEvent({
        type: 'todo.completed',
        todoId: result.id,
        domainId: result.domain_id,
        actor: params.actor,
        payload: {
          title: result.title,
          status: result.status,
          repeatType: todo.repeat_type,
        },
      });
    }
    return result;
  }

  async uncompleteTodo(params: { id: number; actor?: TodoEventActor }): Promise<TodoRow | undefined> {
    await sqliteHelper.safeRun(
      'UPDATE todos SET status = 0, updated_at = ? WHERE id = ?',
      [Date.now(), params.id],
    );
    const todo = await this.getById({ id: params.id });
    if (todo) {
      await recordTodoEvent({
        type: 'todo.uncompleted',
        todoId: todo.id,
        domainId: todo.domain_id,
        actor: params.actor,
        payload: { title: todo.title },
      });
    }
    return todo;
  }

  async toggleImportant(params: { id: number; actor?: TodoEventActor }): Promise<TodoRow | undefined> {
    const todo = await this.getById({ id: params.id });
    if (!todo) return undefined;
    const newVal = todo.important === 1 ? 0 : 1;
    await sqliteHelper.safeRun(
      'UPDATE todos SET important = ?, updated_at = ? WHERE id = ?',
      [newVal, Date.now(), params.id],
    );
    const result = await this.getById({ id: params.id });
    if (result) {
      await recordTodoEvent({
        type: newVal === 1 ? 'todo.starred' : 'todo.unstarred',
        todoId: result.id,
        domainId: result.domain_id,
        actor: params.actor,
        payload: { title: result.title, important: result.important },
      });
    }
    return result;
  }

  async hardDelete(params: { id: number; actor?: TodoEventActor }): Promise<void> {
    const todo = await this.getById({ id: params.id });
    await sqliteHelper.safeRun(
      'DELETE FROM sub_todos WHERE todo_id = ?',
      [params.id],
    );
    await sqliteHelper.safeRun(
      'DELETE FROM todos WHERE id = ?',
      [params.id],
    );
    if (todo) {
      await recordTodoEvent({
        type: 'todo.deleted',
        todoId: todo.id,
        domainId: todo.domain_id,
        actor: params.actor,
        payload: { title: todo.title },
      });
    }
  }

  async moveToDomain(params: { id: number; domainId: number; actor?: TodoEventActor }): Promise<void> {
    const before = await this.getById({ id: params.id });
    await sqliteHelper.safeRun(
      'UPDATE todos SET domain_id = ?, updated_at = ? WHERE id = ?',
      [params.domainId, Date.now(), params.id],
    );
    const todo = await this.getById({ id: params.id });
    if (todo) {
      await recordTodoEvent({
        type: 'todo.moved',
        todoId: todo.id,
        domainId: todo.domain_id,
        actor: params.actor,
        payload: {
          title: todo.title,
          fromDomainId: before?.domain_id ?? null,
          toDomainId: todo.domain_id,
        },
      });
    }
  }

  // --- Sort helpers ---

  async getSortOrder(params: { key: string }): Promise<number[]> {
    const row = await sqliteHelper.safeGet<{ value: string }>(
      'SELECT value FROM sort WHERE key = ?',
      [params.key],
    );
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }

  async setSortOrder(params: { key: string; order: number[] }): Promise<void> {
    const jsonValue = JSON.stringify(params.order);
    await sqliteHelper.safeRun(
      'INSERT INTO sort (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
      [params.key, jsonValue, jsonValue],
    );
  }

  async skipToCurrent(params: { id: number; actor?: TodoEventActor }): Promise<TodoRow | undefined> {
    const todo = await this.getById({ id: params.id });
    if (!todo || !todo.repeat_type || !todo.due_at) return todo;

    const today = moment().startOf('day');
    const dueDate = moment(todo.due_at).startOf('day');

    // Only skip if due_at is before today
    if (dueDate.isSameOrAfter(today)) return todo;

    const nearestDue = this.computeNearestFutureDue(todo.due_at, {
      repeatType: todo.repeat_type,
      repeatInterval: todo.repeat_interval ?? 1,
      weekDay: todo.week_day,
      monthlyDay: todo.monthly_day,
      yearlyDay: todo.yearly_day,
    });

    const now = Date.now();
    const updates: string[] = ['due_at = ?', 'updated_at = ?'];
    const values: any[] = [nearestDue, now];

    // Also advance remind_at if set
    if (todo.remind_at) {
      const remindOffset = todo.remind_at - todo.due_at;
      updates.push('remind_at = ?', 'last_remind_at = ?');
      values.push(nearestDue + remindOffset, todo.remind_at);
    }

    values.push(params.id);
    await sqliteHelper.safeRun(
      `UPDATE todos SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    const result = await this.getById({ id: params.id });
    if (result) {
      await recordTodoEvent({
        type: 'todo.updated',
        todoId: result.id,
        domainId: result.domain_id,
        actor: params.actor,
        payload: { changedFields: ['due_at'] },
      });
    }
    return result;
  }

  private computeNextDueAfterComplete(
    dueAt: number,
    options: {
      repeatType: string;
      repeatInterval: number;
      weekDay: number | null;
      monthlyDay: number | null;
      yearlyDay: number | null;
    },
  ): number {
    const { repeatType, repeatInterval, weekDay, monthlyDay, yearlyDay } = options;
    const interval = Math.max(1, repeatInterval);
    const originalDay = moment(dueAt).startOf('day');

    if (repeatType === 'daily') {
      return moment(originalDay).add(interval, 'day').startOf('day').valueOf();
    }

    if (repeatType === 'weekly') {
      return moment(originalDay).add(interval * 7, 'days').startOf('day').valueOf();
    }

    if (repeatType === 'monthly') {
      const targetDay = monthlyDay ?? moment(dueAt).date();
      const candidate = moment(originalDay).add(interval, 'month').startOf('month');
      return candidate.date(Math.min(targetDay, candidate.daysInMonth())).startOf('day').valueOf();
    }

    if (repeatType === 'yearly') {
      const originalMoment = moment(dueAt);
      const targetMonth = originalMoment.month();
      const targetDay = yearlyDay ?? originalMoment.date();
      const candidate = moment(originalDay).add(interval, 'year').month(targetMonth).startOf('month');
      return candidate.date(Math.min(targetDay, candidate.daysInMonth())).startOf('day').valueOf();
    }

    return moment(originalDay).add(interval, 'day').startOf('day').valueOf();
  }

  private computeNearestFutureDue(
    dueAt: number,
    options: {
      repeatType: string;
      repeatInterval: number;
      weekDay: number | null;
      monthlyDay: number | null;
      yearlyDay: number | null;
    },
  ): number {
    const today = moment().startOf('day');
    const { repeatType, repeatInterval, weekDay, monthlyDay, yearlyDay } = options;
    const interval = Math.max(1, repeatInterval);

    if (repeatType === 'daily') {
      // Walk forward from dueAt in steps of interval until >= today
      let candidate = moment(dueAt).startOf('day');
      while (candidate.isBefore(today)) {
        candidate = candidate.add(interval, 'day');
      }
      return candidate.valueOf();
    }

    if (repeatType === 'weekly') {
      let candidate = moment(dueAt).startOf('day');
      while (candidate.isBefore(today)) {
        candidate = candidate.add(interval * 7, 'days');
      }
      return candidate.valueOf();
    }

    if (repeatType === 'monthly') {
      const targetDay = monthlyDay ?? moment(dueAt).date();
      let candidate = moment(dueAt).startOf('day');
      while (candidate.isBefore(today)) {
        candidate = candidate.add(interval, 'month').startOf('month');
        const maxDay = candidate.daysInMonth();
        candidate = candidate.date(Math.min(targetDay, maxDay)).startOf('day');
      }
      return candidate.valueOf();
    }

    if (repeatType === 'yearly') {
      const originalMoment = moment(dueAt);
      const targetMonth = originalMoment.month();
      const targetDay = yearlyDay ?? originalMoment.date();
      let candidate = moment(dueAt).startOf('day');
      while (candidate.isBefore(today)) {
        candidate = candidate.add(interval, 'year').month(targetMonth).startOf('month');
        const maxDay = candidate.daysInMonth();
        candidate = candidate.date(Math.min(targetDay, maxDay)).startOf('day');
      }
      return candidate.valueOf();
    }

    return today.valueOf();
  }

  // --- Repeat date computation ---

  private computeNextDate(
    currentDate: number,
    baseTime: number,
    options: {
      repeatType: string;
      repeatInterval: number;
      weekDay: number | null;
      monthlyDay: number | null;
      yearlyDay: number | null;
    },
  ): number {
    const base = moment(baseTime);
    const { repeatType, repeatInterval, weekDay, monthlyDay, yearlyDay } = options;
    const interval = Math.max(1, repeatInterval);

    if (repeatType === 'daily') {
      return moment(base).add(interval, 'day').startOf('day').valueOf();
    }

    if (repeatType === 'weekly') {
      const targetDay = weekDay ?? moment(currentDate).isoWeekday();
      let next = moment(base).startOf('day');
      const currentDay = next.isoWeekday();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += interval * 7;
      next = next.add(daysUntil, 'days');
      return next.startOf('day').valueOf();
    }

    if (repeatType === 'monthly') {
      const targetDay = monthlyDay ?? moment(currentDate).date();
      let next = moment(base).add(interval, 'month').startOf('month');
      const maxDay = next.daysInMonth();
      const clampedDay = Math.min(targetDay, maxDay);
      next = next.date(clampedDay);
      return next.startOf('day').valueOf();
    }

    if (repeatType === 'yearly') {
      const originalMoment = moment(currentDate);
      const targetMonth = originalMoment.month(); // 0-indexed
      const targetDay = yearlyDay ?? originalMoment.date();
      let next = moment(base).add(interval, 'year').month(targetMonth).startOf('month');
      const maxDay = next.daysInMonth();
      const clampedDay = Math.min(targetDay, maxDay);
      next = next.date(clampedDay);
      return next.startOf('day').valueOf();
    }

    // Fallback
    return moment(base).add(interval, 'day').startOf('day').valueOf();
  }
}

export const todoDao = new TodoDao();
