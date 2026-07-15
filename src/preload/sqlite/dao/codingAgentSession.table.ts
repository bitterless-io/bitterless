import { BaseTable } from './base.table';

export class CodingAgentSessionTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS coding_agent_session (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      surface TEXT NOT NULL,
      external_session_id TEXT NOT NULL,
      runtime_job_id TEXT,
      title TEXT,
      provider_title TEXT,
      custom_title INTEGER NOT NULL DEFAULT 0,
      cwd TEXT,
      state TEXT NOT NULL DEFAULT 'unknown',
      last_turn_state TEXT NOT NULL DEFAULT 'unknown',
      provider_state TEXT,
      status_source TEXT NOT NULL DEFAULT 'none',
      status_observed_at INTEGER,
      status_fresh_until INTEGER,
      is_process_alive INTEGER,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      delete_flag TEXT NOT NULL DEFAULT '0',
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (provider, surface, external_session_id, delete_flag)
    );
    CREATE INDEX IF NOT EXISTS idx_coding_agent_session_active_updated
      ON coding_agent_session (is_deleted, updated_at DESC);
  `;
}

export const codingAgentSessionTable = new CodingAgentSessionTable();
