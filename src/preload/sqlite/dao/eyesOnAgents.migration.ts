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

const addColumnIfMissing = (
  db: MigrationDatabase,
  tableName: string,
  columnName: string,
  definition: string
): void => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[];
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
};

export const ensureEyesOnAgentsProjectMetadataSchema = (db: MigrationDatabase): void => {
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'project_key', 'TEXT');
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'project_root', 'TEXT');
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'project_name', 'TEXT');
  db.exec(`
    UPDATE eyes_on_agents_thread
    SET project_key = NULL, project_root = NULL, project_name = NULL
    WHERE (project_key IS NULL OR project_root IS NULL OR project_name IS NULL)
      AND NOT (project_key IS NULL AND project_root IS NULL AND project_name IS NULL);
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_domain_project
      ON eyes_on_agents_thread (domain_id, project_key);
  `);
};

export const ensureEyesOnAgentsArchiveSchema = (db: MigrationDatabase): void => {
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  addColumnIfMissing(
    db,
    'eyes_on_agents_thread',
    'is_archived',
    'INTEGER NOT NULL DEFAULT 0'
  );
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_archive_activity
      ON eyes_on_agents_thread (
        is_archived, domain_id, last_activity_at DESC, updated_at DESC
      );
  `);
};

export const ensureEyesOnAgentsSyncPersistenceSchema = (db: MigrationDatabase): void => {
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  const columns = db.prepare('PRAGMA table_info(eyes_on_agents_thread)').all() as TableColumnInfo[];
  const needsUnreadBackfill = !columns.some((column) => column.name === 'is_unread');
  if (needsUnreadBackfill) {
    db.exec('ALTER TABLE eyes_on_agents_thread ADD COLUMN is_unread INTEGER NOT NULL DEFAULT 0;');
    db.exec(`
      UPDATE eyes_on_agents_thread
      SET is_unread = CASE
        WHEN last_completed_at IS NULL THEN 0
        WHEN last_completed_turn_id IS NOT NULL AND last_opened_turn_id IS NOT NULL
          THEN CASE WHEN last_completed_turn_id <> last_opened_turn_id THEN 1 ELSE 0 END
        WHEN last_opened_at IS NULL OR last_completed_at > last_opened_at THEN 1
        ELSE 0
      END;
    `);
  }
  db.exec(`
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
  `);
};

export const ensureEyesOnAgentsHookDeliverySchema = (db: MigrationDatabase): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eyes_on_agents_hook_delivery_receipt (
      delivery_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      committed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_hook_delivery_receipt_committed
      ON eyes_on_agents_hook_delivery_receipt (committed_at);
  `);
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
