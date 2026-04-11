import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import moment from 'moment';

export interface TodoRow {
  id: number;
  domain_id: number;
  title: string;
  status: number;
  important: number;
  due_at: number | null;
  repeat_type: string | null;
  remind_at: number | null;
  last_remind_at: number | null;
  last_complete_at: number | null;
  week_day: number | null;
  monthly_day: number | null;
  yearly_day: number | null;
  note: string;
  is_deleted: number;
  created_at: number;
  updated_at: number;
}

export interface TodoInsertParams {
  domainId: number;
  title: string;
}

export interface TodoUpdateParams {
  id: number;
  title?: string;
  due_at?: number | null;
  remind_at?: number | null;
  important?: number;
  note?: string | null;
}

class TodoDao extends BaseDao {
  async create(params: TodoInsertParams): Promise<TodoRow | undefined> {
    const now = Date.now();
    const result = await sqliteHelper.safeRun(
      'INSERT INTO todos (domain_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [params.domainId, params.title, now, now],
    );
    return sqliteHelper.safeGet<TodoRow>(
      'SELECT * FROM todos WHERE id = ?',
      [result.lastInsertRowid],
    );
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

  async update(params: TodoUpdateParams): Promise<TodoRow | undefined> {
    const fields: string[] = [];
    const values: any[] = [];

    if (params.title !== undefined) {
      fields.push('title = ?');
      values.push(params.title);
    }
    if (params.due_at !== undefined) {
      fields.push('due_at = ?');
      values.push(params.due_at);

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
    }
    if (params.important !== undefined) {
      fields.push('important = ?');
      values.push(params.important);
    }
    if (params.note !== undefined) {
      fields.push('note = ?');
      values.push(params.note);
    }

    if (fields.length === 0) return this.getById({ id: params.id });

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(params.id);

    await sqliteHelper.safeRun(
      `UPDATE todos SET ${fields.join(', ')} WHERE id = ?`,
      values,
    );
    return this.getById({ id: params.id });
  }

  async updateRepeatType(params: { id: number; repeatType: string | null }): Promise<TodoRow | undefined> {
    const todo = await this.getById({ id: params.id });
    if (!todo) return undefined;

    const now = Date.now();
    const updates: string[] = ['repeat_type = ?', 'updated_at = ?'];
    const values: any[] = [params.repeatType, now];

    if (params.repeatType && !todo.repeat_type) {
      // Activating repeat — set due_at to today 00:00 if not set
      let dueAt = todo.due_at;
      if (!dueAt) {
        dueAt = moment().startOf('day').valueOf();
        updates.push('due_at = ?');
        values.push(dueAt);
      }

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
      // Clearing repeat — reset helper fields
      updates.push('week_day = NULL', 'monthly_day = NULL', 'yearly_day = NULL');
    }

    values.push(params.id);
    await sqliteHelper.safeRun(
      `UPDATE todos SET ${updates.join(', ')} WHERE id = ?`,
      values,
    );
    return this.getById({ id: params.id });
  }

  async completeTodo(params: { id: number }): Promise<TodoRow | undefined> {
    const todo = await this.getById({ id: params.id });
    if (!todo) return undefined;

    const now = Date.now();
    const updates: string[] = ['status = 1', 'last_complete_at = ?', 'updated_at = ?'];
    const values: any[] = [now, now];

    if (todo.repeat_type && todo.due_at) {
      const nextDue = this.computeNextDueAfterComplete(todo.due_at, {
        repeatType: todo.repeat_type,
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
    return this.getById({ id: params.id });
  }

  async uncompleteTodo(params: { id: number }): Promise<TodoRow | undefined> {
    await sqliteHelper.safeRun(
      'UPDATE todos SET status = 0, updated_at = ? WHERE id = ?',
      [Date.now(), params.id],
    );
    return this.getById({ id: params.id });
  }

  async toggleImportant(params: { id: number }): Promise<TodoRow | undefined> {
    const todo = await this.getById({ id: params.id });
    if (!todo) return undefined;
    const newVal = todo.important === 1 ? 0 : 1;
    await sqliteHelper.safeRun(
      'UPDATE todos SET important = ?, updated_at = ? WHERE id = ?',
      [newVal, Date.now(), params.id],
    );
    return this.getById({ id: params.id });
  }

  async hardDelete(params: { id: number }): Promise<void> {
    await sqliteHelper.safeRun(
      'DELETE FROM sub_todos WHERE todo_id = ?',
      [params.id],
    );
    await sqliteHelper.safeRun(
      'DELETE FROM todos WHERE id = ?',
      [params.id],
    );
  }

  async moveToDomain(params: { id: number; domainId: number }): Promise<void> {
    await sqliteHelper.safeRun(
      'UPDATE todos SET domain_id = ?, updated_at = ? WHERE id = ?',
      [params.domainId, Date.now(), params.id],
    );
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

  async skipToCurrent(params: { id: number }): Promise<TodoRow | undefined> {
    const todo = await this.getById({ id: params.id });
    if (!todo || !todo.repeat_type || !todo.due_at) return todo;

    const today = moment().startOf('day');
    const dueDate = moment(todo.due_at).startOf('day');

    // Only skip if due_at is before today
    if (dueDate.isSameOrAfter(today)) return todo;

    const nearestDue = this.computeNearestFutureDue(todo.due_at, {
      repeatType: todo.repeat_type,
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
    return this.getById({ id: params.id });
  }

  private computeNextDueAfterComplete(
    dueAt: number,
    options: {
      repeatType: string;
      weekDay: number | null;
      monthlyDay: number | null;
      yearlyDay: number | null;
    },
  ): number {
    const { repeatType, weekDay, monthlyDay, yearlyDay } = options;
    const originalDay = moment(dueAt).startOf('day');

    if (repeatType === 'daily') {
      return moment(originalDay).add(1, 'day').startOf('day').valueOf();
    }

    if (repeatType === 'weekly') {
      return moment(originalDay).add(7, 'days').startOf('day').valueOf();
    }

    if (repeatType === 'monthly') {
      const targetDay = monthlyDay ?? moment(dueAt).date();
      const candidate = moment(originalDay).add(1, 'month').startOf('month');
      return candidate.date(Math.min(targetDay, candidate.daysInMonth())).startOf('day').valueOf();
    }

    if (repeatType === 'yearly') {
      const originalMoment = moment(dueAt);
      const targetMonth = originalMoment.month();
      const targetDay = yearlyDay ?? originalMoment.date();
      const candidate = moment(originalDay).add(1, 'year').month(targetMonth).startOf('month');
      return candidate.date(Math.min(targetDay, candidate.daysInMonth())).startOf('day').valueOf();
    }

    return moment(originalDay).add(1, 'day').startOf('day').valueOf();
  }

  private computeNearestFutureDue(
    dueAt: number,
    options: {
      repeatType: string;
      weekDay: number | null;
      monthlyDay: number | null;
      yearlyDay: number | null;
    },
  ): number {
    const today = moment().startOf('day');
    const { repeatType, weekDay, monthlyDay, yearlyDay } = options;

    if (repeatType === 'daily') {
      return today.valueOf();
    }

    if (repeatType === 'weekly') {
      const targetDay = weekDay ?? moment(dueAt).isoWeekday();
      const todayDay = today.isoWeekday();
      let daysUntil = targetDay - todayDay;
      if (daysUntil < 0) daysUntil += 7;
      return moment(today).add(daysUntil, 'days').startOf('day').valueOf();
    }

    if (repeatType === 'monthly') {
      const targetDay = monthlyDay ?? moment(dueAt).date();
      let candidate = moment(today).startOf('month');
      const maxDay = candidate.daysInMonth();
      const clampedDay = Math.min(targetDay, maxDay);
      candidate = candidate.date(clampedDay);
      if (candidate.isBefore(today)) {
        candidate = moment(today).add(1, 'month').startOf('month');
        const nextMaxDay = candidate.daysInMonth();
        candidate = candidate.date(Math.min(targetDay, nextMaxDay));
      }
      return candidate.startOf('day').valueOf();
    }

    if (repeatType === 'yearly') {
      const originalMoment = moment(dueAt);
      const targetMonth = originalMoment.month();
      const targetDay = yearlyDay ?? originalMoment.date();
      let candidate = moment(today).month(targetMonth).startOf('month');
      const maxDay = candidate.daysInMonth();
      candidate = candidate.date(Math.min(targetDay, maxDay));
      if (candidate.isBefore(today)) {
        candidate = moment(today).add(1, 'year').month(targetMonth).startOf('month');
        const nextMaxDay = candidate.daysInMonth();
        candidate = candidate.date(Math.min(targetDay, nextMaxDay));
      }
      return candidate.startOf('day').valueOf();
    }

    return today.valueOf();
  }

  // --- Repeat date computation ---

  private computeNextDate(
    currentDate: number,
    baseTime: number,
    options: {
      repeatType: string;
      weekDay: number | null;
      monthlyDay: number | null;
      yearlyDay: number | null;
    },
  ): number {
    const base = moment(baseTime);
    const { repeatType, weekDay, monthlyDay, yearlyDay } = options;

    if (repeatType === 'daily') {
      return moment(base).add(1, 'day').startOf('day').valueOf();
    }

    if (repeatType === 'weekly') {
      const targetDay = weekDay ?? moment(currentDate).isoWeekday();
      let next = moment(base).startOf('day');
      // Move to next occurrence of targetDay
      const currentDay = next.isoWeekday();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      next = next.add(daysUntil, 'days');
      return next.startOf('day').valueOf();
    }

    if (repeatType === 'monthly') {
      const targetDay = monthlyDay ?? moment(currentDate).date();
      let next = moment(base).add(1, 'month').startOf('month');
      const maxDay = next.daysInMonth();
      const clampedDay = Math.min(targetDay, maxDay);
      next = next.date(clampedDay);
      return next.startOf('day').valueOf();
    }

    if (repeatType === 'yearly') {
      const originalMoment = moment(currentDate);
      const targetMonth = originalMoment.month(); // 0-indexed
      const targetDay = yearlyDay ?? originalMoment.date();
      let next = moment(base).add(1, 'year').month(targetMonth).startOf('month');
      const maxDay = next.daysInMonth();
      const clampedDay = Math.min(targetDay, maxDay);
      next = next.date(clampedDay);
      return next.startOf('day').valueOf();
    }

    // Fallback
    return moment(base).add(1, 'day').startOf('day').valueOf();
  }
}

export const todoDao = new TodoDao();
