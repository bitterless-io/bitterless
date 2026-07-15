import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import type { DomainMcpDaoApi } from '@shared/mcp/todoMcpDao.type';

export interface DomainRow {
  id: number;
  title: string;
  description: string;
  is_deleted: number;
  archived: number;
  created_at: number;
  updated_at: number;
}

export type RestoreDomainResult =
  | 'restored'
  | 'already_active'
  | 'limit_reached'
  | 'not_found';

export class DomainDao extends BaseDao implements DomainMcpDaoApi {
  async create(params: { title?: string; description?: string }): Promise<DomainRow | undefined> {
    const now = Date.now();
    const result = await sqliteHelper.safeRun(
      `INSERT INTO domain (title, description, created_at, updated_at)
       SELECT ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*)
         FROM domain
         WHERE is_deleted = 0 AND archived = 0
       ) < 17`,
      [params.title ?? 'Untitled', params.description ?? '', now, now],
    );
    if (result.changes === 0) return undefined;
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

  async updateDescription(params: { id: number; description: string }): Promise<void> {
    await sqliteHelper.safeRun(
      'UPDATE domain SET description = ?, updated_at = ? WHERE id = ?',
      [params.description, Date.now(), params.id],
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

  async restore(params: { id: number }): Promise<RestoreDomainResult> {
    const result = await sqliteHelper.safeRun(
      `UPDATE domain
       SET archived = 0, updated_at = ?
       WHERE id = ?
         AND is_deleted = 0
         AND archived = 1
         AND (
           SELECT COUNT(*)
           FROM domain
           WHERE is_deleted = 0 AND archived = 0
         ) < 17`,
      [Date.now(), params.id],
    );
    if (result.changes > 0) return 'restored';

    const domain = await this.getById(params);
    if (!domain || domain.is_deleted === 1) return 'not_found';
    if (domain.archived === 0) return 'already_active';
    return 'limit_reached';
  }
}

export const domainDao = new DomainDao();
