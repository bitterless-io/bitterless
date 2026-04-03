import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';

export interface DomainRow {
  id: number;
  title: string;
  is_deleted: number;
  archived: number;
  created_at: number;
  updated_at: number;
}

class DomainDao extends BaseDao {
  async create(params: { title?: string }): Promise<DomainRow | undefined> {
    const now = Date.now();
    const result = await sqliteHelper.safeRun(
      'INSERT INTO domain (title, created_at, updated_at) VALUES (?, ?, ?)',
      [params.title ?? 'Untitled', now, now],
    );
    return sqliteHelper.safeGet<DomainRow>(
      'SELECT * FROM domain WHERE id = ?',
      [result.lastInsertRowid],
    );
  }

  async getAll(): Promise<DomainRow[]> {
    return sqliteHelper.safeAll<DomainRow>(
      'SELECT * FROM domain ORDER BY created_at ASC',
      [],
    );
  }

  async getById(params: { id: number }): Promise<DomainRow | undefined> {
    return sqliteHelper.safeGet<DomainRow>(
      'SELECT * FROM domain WHERE id = ?',
      [params.id],
    );
  }

  async updateTitle(params: { id: number; title: string }): Promise<void> {
    await sqliteHelper.safeRun(
      'UPDATE domain SET title = ?, updated_at = ? WHERE id = ?',
      [params.title, Date.now(), params.id],
    );
  }

  async hardDelete(params: { id: number }): Promise<void> {
    await sqliteHelper.safeRun(
      'DELETE FROM domain WHERE id = ?',
      [params.id],
    );
  }

  async setArchived(params: { id: number; archived: number }): Promise<void> {
    await sqliteHelper.safeRun(
      'UPDATE domain SET archived = ?, updated_at = ? WHERE id = ?',
      [params.archived, Date.now(), params.id],
    );
  }
}

export const domainDao = new DomainDao();
