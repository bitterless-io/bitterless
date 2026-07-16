import type Database from 'better-sqlite3-multiple-ciphers';

type MigrationDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'transaction'>;

interface TableColumnInfo {
  name: string;
}

const tableExists = (db: MigrationDatabase, tableName: string): boolean => {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  );
};

export const ensureEyesOnAgentsLegacyImport = (db: MigrationDatabase): void => {
  const importLegacy = db.transaction(() => {
    const now = Date.now();
    db.prepare(
      `INSERT OR IGNORE INTO eyes_on_agents_domain (
        domain_key, title, sort_index, is_system, is_deleted, delete_flag,
        deleted_at, created_at, updated_at
      ) VALUES ('uncategorized', 'Uncategorized', 0, 1, 0, '0', NULL, ?, ?)`
    ).run(now, now);

    if (!tableExists(db, 'coding_agent_session')) return;
    const columns = db.prepare('PRAGMA table_info(coding_agent_session)').all() as TableColumnInfo[];
    const titleExpression = columns.some((column) => column.name === 'provider_title')
      ? 'COALESCE(title, provider_title)'
      : 'title';
    db.prepare(
      `INSERT OR IGNORE INTO eyes_on_agents_thread (
        thread_id, domain_id, title, cwd, runtime_state, active_flags_json,
        active_turn_id, last_completed_turn_id, last_completed_at,
        last_opened_turn_id, last_opened_at, status_source, status_observed_at,
        last_activity_at, created_at, updated_at
      )
      SELECT
        lower(external_session_id),
        (SELECT id FROM eyes_on_agents_domain
          WHERE domain_key = 'uncategorized' AND is_deleted = 0 AND delete_flag = '0'
          ORDER BY id ASC LIMIT 1),
        ${titleExpression},
        cwd,
        'unknown',
        '[]',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'discovery',
        NULL,
        updated_at,
        created_at,
        updated_at
      FROM coding_agent_session
      WHERE provider = 'codex'
        AND is_deleted = 0
        AND length(external_session_id) = 36
        AND substr(external_session_id, 9, 1) = '-'
        AND substr(external_session_id, 14, 1) = '-'
        AND substr(external_session_id, 19, 1) = '-'
        AND substr(external_session_id, 24, 1) = '-'
        AND lower(substr(external_session_id, 15, 1)) GLOB '[1-8]'
        AND lower(substr(external_session_id, 20, 1)) GLOB '[89ab]'
        AND length(replace(external_session_id, '-', '')) = 32
        AND external_session_id NOT GLOB '*[^0-9A-Fa-f-]*'`
    ).run();
  });

  importLegacy();
};
