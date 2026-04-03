import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';

export interface SubTodoRow {
  id: number;
  todo_id: number;
  title: string;
  status: number;
  is_deleted: number;
  created_at: number;
  updated_at: number;
}

class SubTodoDao extends BaseDao {
  async create(params: { todoId: number; title: string }): Promise<SubTodoRow | undefined> {
    const now = Date.now();
    const result = await sqliteHelper.safeRun(
      'INSERT INTO sub_todos (todo_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [params.todoId, params.title, now, now],
    );
    return sqliteHelper.safeGet<SubTodoRow>(
      'SELECT * FROM sub_todos WHERE id = ?',
      [result.lastInsertRowid],
    );
  }

  async getByTodoId(params: { todoId: number }): Promise<SubTodoRow[]> {
    return sqliteHelper.safeAll<SubTodoRow>(
      'SELECT * FROM sub_todos WHERE todo_id = ? ORDER BY created_at ASC',
      [params.todoId],
    );
  }

  async getById(params: { id: number }): Promise<SubTodoRow | undefined> {
    return sqliteHelper.safeGet<SubTodoRow>(
      'SELECT * FROM sub_todos WHERE id = ?',
      [params.id],
    );
  }

  async updateTitle(params: { id: number; title: string }): Promise<void> {
    await sqliteHelper.safeRun(
      'UPDATE sub_todos SET title = ?, updated_at = ? WHERE id = ?',
      [params.title, Date.now(), params.id],
    );
  }

  async toggleStatus(params: { id: number }): Promise<SubTodoRow | undefined> {
    const row = await this.getById({ id: params.id });
    if (!row) return undefined;
    const newStatus = row.status === 1 ? 0 : 1;
    await sqliteHelper.safeRun(
      'UPDATE sub_todos SET status = ?, updated_at = ? WHERE id = ?',
      [newStatus, Date.now(), params.id],
    );
    return this.getById({ id: params.id });
  }

  async getCountByTodoId(params: { todoId: number }): Promise<{ total: number; done: number }> {
    const row = await sqliteHelper.safeGet<{ total: number; done: number }>(
      'SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) as done FROM sub_todos WHERE todo_id = ?',
      [params.todoId],
    );
    return { total: row?.total ?? 0, done: row?.done ?? 0 };
  }

  async getCountsByTodoIds(params: { todoIds: number[] }): Promise<Record<number, { total: number; done: number }>> {
    if (params.todoIds.length === 0) return {};
    const placeholders = params.todoIds.map(() => '?').join(',');
    const rows = await sqliteHelper.safeAll<{ todo_id: number; total: number; done: number }>(
      `SELECT todo_id, COUNT(*) as total, COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END), 0) as done FROM sub_todos WHERE todo_id IN (${placeholders}) GROUP BY todo_id`,
      params.todoIds,
    );
    const result: Record<number, { total: number; done: number }> = {};
    for (const row of rows) {
      result[row.todo_id] = { total: row.total, done: row.done };
    }
    return result;
  }

  async hardDelete(params: { id: number }): Promise<void> {
    await sqliteHelper.safeRun(
      'DELETE FROM sub_todos WHERE id = ?',
      [params.id],
    );
  }
}

export const subTodoDao = new SubTodoDao();
