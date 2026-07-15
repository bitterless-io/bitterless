import { BaseDao } from './base.dao';
import { sqliteHelper } from '../sqliteHelper/sqlite.helper';
import type {
  CodingAgentSessionDaoApi,
  CodingAgentSessionDraft,
  CodingAgentSessionRecord,
  CodingAgentStatusUpdate
} from '@shared/codingAgent/codingAgentSession.type';
import {
  CodingAgentSessionStore,
  type CodingAgentSessionSqlStore
} from './codingAgentSession.store';

const sqlStore: CodingAgentSessionSqlStore = {
  get: async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> => {
    return await sqliteHelper.safeGet<T>(sql, params);
  },
  all: async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    return await sqliteHelper.safeAll<T>(sql, params);
  },
  run: async (sql: string, params: unknown[] = []): Promise<{ changes: number | bigint }> => {
    return await sqliteHelper.safeRun(sql, params);
  }
};

export class CodingAgentSessionDao extends BaseDao implements CodingAgentSessionDaoApi {
  private readonly store = new CodingAgentSessionStore(sqlStore);

  async upsert(params: CodingAgentSessionDraft): Promise<CodingAgentSessionRecord> {
    return await this.store.upsert(params);
  }

  async list(params?: { includeUnknown?: boolean }): Promise<CodingAgentSessionRecord[]> {
    return await this.store.list(params);
  }

  async getById(params: { id: string }): Promise<CodingAgentSessionRecord | undefined> {
    return await this.store.getById(params);
  }

  async rename(params: { id: string; title: string | null }): Promise<CodingAgentSessionRecord> {
    return await this.store.rename(params);
  }

  async updateStatus(params: CodingAgentStatusUpdate): Promise<CodingAgentSessionRecord> {
    return await this.store.updateStatus(params);
  }

  async softDelete(params: { id: string }): Promise<boolean> {
    return await this.store.softDelete(params);
  }
}

export const codingAgentSessionDao = new CodingAgentSessionDao();
