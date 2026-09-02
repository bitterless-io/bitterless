import type Database from 'better-sqlite3-multiple-ciphers';

type MigrationDatabase = Pick<Database.Database, 'exec' | 'prepare' | 'transaction'>;

interface TableColumnInfo {
  name: string;
}

const hasColumn = (
  db: MigrationDatabase,
  tableName: string,
  columnName: string
): boolean => {
  if (!tableExists(db, tableName)) return false;
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[];
  return columns.some((column) => column.name === columnName);
};

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

export const ensureEyesOnAgentsCompletionAlertSchema = (db: MigrationDatabase): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eyes_on_agents_completion_alert_receipt (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (thread_id, turn_id)
    );
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_completion_alert_receipt_claimed
      ON eyes_on_agents_completion_alert_receipt (claimed_at);
  `);
};

export const migrateEyesOnAgentsCompletionAlertSchema = (db: MigrationDatabase): void => {
  ensureEyesOnAgentsCompletionAlertSchema(db);
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  const columns = db.prepare('PRAGMA table_info(eyes_on_agents_thread)').all() as TableColumnInfo[];
  if (!columns.some((column) => column.name === 'last_completed_turn_id')) return;
  const hasCompletedAt = columns.some((column) => column.name === 'last_completed_at');
  const completedAt = hasCompletedAt
    ? 'COALESCE(last_completed_at, 0)'
    : '0';
  const claimedAt = columns.some((column) => column.name === 'updated_at')
    ? hasCompletedAt
      ? 'COALESCE(last_completed_at, updated_at, 0)'
      : 'COALESCE(updated_at, 0)'
    : completedAt;
  const receiptProviderAware = hasColumn(
    db,
    'eyes_on_agents_completion_alert_receipt',
    'session_key'
  );
  const threadProviderAware = hasColumn(db, 'eyes_on_agents_thread', 'session_key');
  db.exec(receiptProviderAware ? `
    INSERT OR IGNORE INTO eyes_on_agents_completion_alert_receipt (
      session_key, provider, thread_id, turn_id, completed_at, claimed_at
    )
    SELECT ${threadProviderAware ? 'session_key' : "'codex:' || lower(thread_id)"},
      ${threadProviderAware ? 'provider' : "'codex'"},
      thread_id, last_completed_turn_id, ${completedAt}, ${claimedAt}
    FROM eyes_on_agents_thread
    WHERE last_completed_turn_id IS NOT NULL;
  ` : `
    INSERT OR IGNORE INTO eyes_on_agents_completion_alert_receipt (
      thread_id, turn_id, completed_at, claimed_at
    )
    SELECT thread_id, last_completed_turn_id, ${completedAt}, ${claimedAt}
    FROM eyes_on_agents_thread
    WHERE last_completed_turn_id IS NOT NULL;
  `);
};

export const ensureEyesOnAgentsLastUserPromptSchema = (db: MigrationDatabase): void => {
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'last_user_prompt_preview', 'TEXT');
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'last_user_prompt_turn_id', 'TEXT');
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'last_user_prompt_at', 'INTEGER');
  addColumnIfMissing(
    db,
    'eyes_on_agents_thread',
    'last_user_prompt_truncated',
    'INTEGER NOT NULL DEFAULT 0'
  );
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'last_user_prompt_source', 'TEXT');
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'last_user_prompt_checked_at', 'INTEGER');
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
    const providerAware = hasColumn(db, 'eyes_on_agents_thread', 'session_key');
    db.prepare(providerAware
      ? `INSERT OR IGNORE INTO eyes_on_agents_thread (
        session_key, provider, thread_id, domain_id, title, cwd,
        archive_state, runtime_state, active_flags_json,
        active_turn_id, last_completed_turn_id, last_completed_at,
        last_opened_turn_id, last_opened_at, status_source, status_observed_at,
        last_activity_at, created_at, updated_at
      )
      SELECT
        'codex:' || lower(external_session_id),
        'codex',
        lower(external_session_id),
        (SELECT id FROM eyes_on_agents_domain
          WHERE domain_key = 'uncategorized' AND is_deleted = 0 AND delete_flag = '0'
          ORDER BY id ASC LIMIT 1),
        ${titleExpression}, cwd, 'active', 'unknown', '[]',
        NULL, NULL, NULL, NULL, NULL, 'discovery', NULL,
        updated_at, created_at, updated_at
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
      : `INSERT OR IGNORE INTO eyes_on_agents_thread (
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

const PROVIDER_SCHEMA_SQL = `
  CREATE TABLE eyes_on_agents_thread__provider_new (
    session_key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    desktop_session_id TEXT,
    domain_id INTEGER NOT NULL,
    title TEXT,
    cwd TEXT,
    project_key TEXT,
    project_root TEXT,
    project_name TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    archive_state TEXT NOT NULL DEFAULT 'active',
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
    last_user_prompt_preview TEXT,
    last_user_prompt_turn_id TEXT,
    last_user_prompt_at INTEGER,
    last_user_prompt_truncated INTEGER NOT NULL DEFAULT 0,
    last_user_prompt_source TEXT,
    last_user_prompt_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (domain_id) REFERENCES eyes_on_agents_domain(id),
    UNIQUE (provider, thread_id)
  );
  CREATE TABLE eyes_on_agents_thread_snapshot__provider_new (
    session_key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    is_archived INTEGER NOT NULL DEFAULT 0,
    synced_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (provider, thread_id)
  );
  CREATE TABLE eyes_on_agents_hook_delivery_receipt__provider_new (
    delivery_id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    provider TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    committed_at INTEGER NOT NULL
  );
  CREATE TABLE eyes_on_agents_completion_alert_receipt__provider_new (
    session_key TEXT NOT NULL,
    provider TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    claimed_at INTEGER NOT NULL,
    PRIMARY KEY (session_key, turn_id)
  );
`;

const validLegacyUuidSql = (column: string): string => `
  length(${column}) = 36
  AND substr(${column}, 9, 1) = '-'
  AND substr(${column}, 14, 1) = '-'
  AND substr(${column}, 19, 1) = '-'
  AND substr(${column}, 24, 1) = '-'
  AND lower(substr(${column}, 15, 1)) GLOB '[1-8]'
  AND lower(substr(${column}, 20, 1)) GLOB '[89ab]'
  AND length(replace(${column}, '-', '')) = 32
  AND ${column} NOT GLOB '*[^0-9A-Fa-f-]*'`;

export const migrateEyesOnAgentsProviderIdentitySchema = (db: MigrationDatabase): void => {
  const migrate = db.transaction(() => {
    if (!tableExists(db, 'eyes_on_agents_thread')) return;
    const alreadyProviderAware = hasColumn(db, 'eyes_on_agents_thread', 'session_key');
    if (!alreadyProviderAware) {
      db.exec(`
        DROP TABLE IF EXISTS eyes_on_agents_thread__provider_new;
        DROP TABLE IF EXISTS eyes_on_agents_thread_snapshot__provider_new;
        DROP TABLE IF EXISTS eyes_on_agents_hook_delivery_receipt__provider_new;
        DROP TABLE IF EXISTS eyes_on_agents_completion_alert_receipt__provider_new;
        ${PROVIDER_SCHEMA_SQL}
        INSERT INTO eyes_on_agents_thread__provider_new (
          session_key, provider, thread_id, desktop_session_id, domain_id, title, cwd,
          project_key, project_root, project_name, is_archived, archive_state,
          runtime_state, active_flags_json, active_turn_id, last_completed_turn_id,
          last_completed_at, last_opened_turn_id, last_opened_at, is_unread,
          status_source, status_observed_at, last_activity_at, last_user_prompt_preview,
          last_user_prompt_turn_id, last_user_prompt_at, last_user_prompt_truncated,
          last_user_prompt_source, last_user_prompt_checked_at, created_at, updated_at
        )
        SELECT
          'codex:' || lower(thread_id), 'codex', lower(thread_id), NULL, domain_id, title, cwd,
          project_key, project_root, project_name, is_archived,
          CASE WHEN is_archived = 1 THEN 'archived' ELSE 'active' END,
          runtime_state, active_flags_json, active_turn_id, last_completed_turn_id,
          last_completed_at, last_opened_turn_id, last_opened_at, is_unread,
          status_source, status_observed_at, last_activity_at, last_user_prompt_preview,
          last_user_prompt_turn_id, last_user_prompt_at, last_user_prompt_truncated,
          last_user_prompt_source, last_user_prompt_checked_at, created_at, updated_at
        FROM eyes_on_agents_thread;
      `);
      if (tableExists(db, 'eyes_on_agents_thread_snapshot')) {
        db.exec(`
          INSERT INTO eyes_on_agents_thread_snapshot__provider_new (
            session_key, provider, thread_id, payload_json, is_archived, synced_at,
            created_at, updated_at
          )
          SELECT 'codex:' || lower(thread_id), 'codex', lower(thread_id), payload_json,
            is_archived, synced_at, created_at, updated_at
          FROM eyes_on_agents_thread_snapshot;
        `);
      }
      if (tableExists(db, 'eyes_on_agents_hook_delivery_receipt')) {
        db.exec(`
          INSERT INTO eyes_on_agents_hook_delivery_receipt__provider_new (
            delivery_id, session_key, provider, thread_id, observed_at, committed_at
          )
          SELECT delivery_id, 'codex:' || lower(thread_id), 'codex', lower(thread_id),
            observed_at, committed_at
          FROM eyes_on_agents_hook_delivery_receipt;
        `);
      }
      if (tableExists(db, 'eyes_on_agents_completion_alert_receipt')) {
        db.exec(`
          INSERT INTO eyes_on_agents_completion_alert_receipt__provider_new (
            session_key, provider, thread_id, turn_id, completed_at, claimed_at
          )
          SELECT 'codex:' || lower(thread_id), 'codex', lower(thread_id), turn_id,
            completed_at, claimed_at
          FROM eyes_on_agents_completion_alert_receipt;
        `);
      }
      db.exec(`
        DROP TABLE eyes_on_agents_thread;
        DROP TABLE IF EXISTS eyes_on_agents_thread_snapshot;
        DROP TABLE IF EXISTS eyes_on_agents_hook_delivery_receipt;
        DROP TABLE IF EXISTS eyes_on_agents_completion_alert_receipt;
        ALTER TABLE eyes_on_agents_thread__provider_new RENAME TO eyes_on_agents_thread;
        ALTER TABLE eyes_on_agents_thread_snapshot__provider_new RENAME TO eyes_on_agents_thread_snapshot;
        ALTER TABLE eyes_on_agents_hook_delivery_receipt__provider_new RENAME TO eyes_on_agents_hook_delivery_receipt;
        ALTER TABLE eyes_on_agents_completion_alert_receipt__provider_new RENAME TO eyes_on_agents_completion_alert_receipt;
      `);
    }

    if (tableExists(db, 'coding_agent_session')) {
      const columns = db.prepare('PRAGMA table_info(coding_agent_session)').all() as TableColumnInfo[];
      const titleExpression = columns.some((column) => column.name === 'provider_title')
        ? 'COALESCE(title, provider_title)'
        : 'title';
      const statusObservedAtExpression = columns.some(
        (column) => column.name === 'status_observed_at'
      ) ? 'status_observed_at' : 'NULL';
      db.exec(`
        INSERT OR IGNORE INTO eyes_on_agents_thread (
          session_key, provider, thread_id, domain_id, title, cwd, archive_state,
          runtime_state, active_flags_json, status_source, status_observed_at,
          last_activity_at, created_at, updated_at
        )
        SELECT
          'claude:' || lower(external_session_id), 'claude', lower(external_session_id),
          (SELECT id FROM eyes_on_agents_domain
            WHERE domain_key = 'uncategorized' AND is_deleted = 0 AND delete_flag = '0'
            ORDER BY id ASC LIMIT 1),
          ${titleExpression}, cwd, 'unknown', 'unknown', '[]', 'discovery',
          ${statusObservedAtExpression}, updated_at, created_at, updated_at
        FROM coding_agent_session
        WHERE provider = 'claude' AND is_deleted = 0
          AND ${validLegacyUuidSql('external_session_id')};
      `);
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_domain_activity
        ON eyes_on_agents_thread (domain_id, last_activity_at DESC, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_attention
        ON eyes_on_agents_thread (runtime_state, last_completed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_domain_project
        ON eyes_on_agents_thread (domain_id, project_key);
      CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_archive_activity
        ON eyes_on_agents_thread (archive_state, domain_id, last_activity_at DESC, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_snapshot_inventory
        ON eyes_on_agents_thread_snapshot (is_archived, synced_at DESC);
      CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_hook_delivery_receipt_committed
        ON eyes_on_agents_hook_delivery_receipt (committed_at);
      CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_completion_alert_receipt_claimed
        ON eyes_on_agents_completion_alert_receipt (claimed_at);
    `);
  });
  migrate();
};

export const ensureEyesOnAgentsClaudeInventorySchema = (db: MigrationDatabase): void => {
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'transcript_path', 'TEXT');
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'status_fresh_until', 'INTEGER');
  addColumnIfMissing(
    db,
    'eyes_on_agents_thread',
    'desktop_identity_ambiguous',
    'INTEGER NOT NULL DEFAULT 0'
  );
  addColumnIfMissing(
    db,
    'eyes_on_agents_thread',
    'transcript_identity_ambiguous',
    'INTEGER NOT NULL DEFAULT 0'
  );
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_provider_activity
      ON eyes_on_agents_thread (provider, archive_state, last_activity_at DESC, updated_at DESC);
  `);
};

export const ensureEyesOnAgentsClaudeTranscriptActivitySchema = (
  db: MigrationDatabase
): void => {
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'transcript_activity_at', 'INTEGER');
};

export const ensureEyesOnAgentsClaudeDeletionSchema = (db: MigrationDatabase): void => {
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  addColumnIfMissing(
    db,
    'eyes_on_agents_thread',
    'is_deleted',
    'INTEGER NOT NULL DEFAULT 0'
  );
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'deleted_at', 'INTEGER');
  if (tableExists(db, 'eyes_on_agents_hook_delivery_receipt')) {
    addColumnIfMissing(
      db,
      'eyes_on_agents_hook_delivery_receipt',
      'is_observation_eligible',
      'INTEGER NOT NULL DEFAULT 1'
    );
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_thread_provider_deleted
      ON eyes_on_agents_thread (provider, is_deleted, last_activity_at DESC);
    CREATE TABLE IF NOT EXISTS eyes_on_agents_claude_deletion_tombstone (
      source_key TEXT NOT NULL,
      identity_id TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      cleared_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source_key, identity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_eyes_on_agents_claude_deletion_active_identity
      ON eyes_on_agents_claude_deletion_tombstone (is_active, identity_id, deleted_at DESC);
  `);
};

export const ensureEyesOnAgentsIterm2SessionSchema = (db: MigrationDatabase): void => {
  if (!tableExists(db, 'eyes_on_agents_thread')) return;
  addColumnIfMissing(db, 'eyes_on_agents_thread', 'iterm2_session_id', 'TEXT');
};
