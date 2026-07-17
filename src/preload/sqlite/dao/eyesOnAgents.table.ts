import { BaseTable } from './base.table';

export class EyesOnAgentsTable extends BaseTable {
  readonly createSql = `
    CREATE TABLE IF NOT EXISTS eyes_on_agents_domain (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_key TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_index INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      delete_flag TEXT NOT NULL DEFAULT '0',
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (domain_key, delete_flag)
    );
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_domain_active_sort
      ON eyes_on_agents_domain (is_deleted, sort_index, created_at);

    INSERT OR IGNORE INTO eyes_on_agents_domain (
      domain_key, title, sort_index, is_system, is_deleted, delete_flag,
      deleted_at, created_at, updated_at
    ) VALUES (
      'uncategorized', 'Uncategorized', 0, 1, 0, '0', NULL,
      CAST(strftime('%s', 'now') AS INTEGER) * 1000,
      CAST(strftime('%s', 'now') AS INTEGER) * 1000
    );

    CREATE TABLE IF NOT EXISTS eyes_on_agents_thread (
      thread_id TEXT PRIMARY KEY,
      domain_id INTEGER NOT NULL,
      title TEXT,
      cwd TEXT,
      project_key TEXT,
      project_root TEXT,
      project_name TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      runtime_state TEXT NOT NULL DEFAULT 'unknown',
      active_flags_json TEXT NOT NULL DEFAULT '[]',
      active_turn_id TEXT,
      last_completed_turn_id TEXT,
      last_completed_at INTEGER,
      last_opened_turn_id TEXT,
      last_opened_at INTEGER,
      is_unread INTEGER NOT NULL DEFAULT 0,
      status_source TEXT NOT NULL DEFAULT 'discovery',
      status_observed_at INTEGER,
      last_activity_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (domain_id) REFERENCES eyes_on_agents_domain(id)
    );
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_domain_activity
      ON eyes_on_agents_thread (domain_id, last_activity_at DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_attention
      ON eyes_on_agents_thread (runtime_state, last_completed_at DESC);

    CREATE TABLE IF NOT EXISTS eyes_on_agents_thread_snapshot (
      thread_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_snapshot_inventory
      ON eyes_on_agents_thread_snapshot (is_archived, synced_at DESC);

    CREATE TABLE IF NOT EXISTS eyes_on_agents_hook_delivery_receipt (
      delivery_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      committed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_hook_delivery_receipt_committed
      ON eyes_on_agents_hook_delivery_receipt (committed_at);
  `;
}

export const eyesOnAgentsTable = new EyesOnAgentsTable();
