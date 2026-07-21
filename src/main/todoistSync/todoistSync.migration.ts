export interface TodoistSyncMigrationDatabase {
  exec(sql: string): void;
}

export interface TodoistSyncMigration {
  version: number;
  name: string;
  up(db: TodoistSyncMigrationDatabase): void;
}

const SCHEMA_V1 = `
  CREATE TABLE todoist_sync_schema (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );

  CREATE TABLE todo_sync_state (
    customer_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    sync_token TEXT NOT NULL DEFAULT '*',
    sync_phase TEXT,
    snowflake_node_id INTEGER,
    device_sequence INTEGER NOT NULL DEFAULT 0,
    interval_seconds INTEGER NOT NULL DEFAULT 30,
    bootstrap_started INTEGER NOT NULL DEFAULT 0,
    bootstrap_catchup_pending INTEGER NOT NULL DEFAULT 0,
    last_success_at INTEGER,
    last_error TEXT,
    rejected_batch_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (snowflake_node_id IS NULL OR snowflake_node_id BETWEEN 0 AND 1023),
    CHECK (interval_seconds BETWEEN 10 AND 180)
  );

  CREATE TABLE todo_domains (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    client_updated_at INTEGER NOT NULL,
    version_device_id TEXT NOT NULL DEFAULT '',
    version_client_sequence INTEGER NOT NULL DEFAULT 0,
    version_command_uuid TEXT NOT NULL DEFAULT '',
    sync_revision TEXT NOT NULL DEFAULT '0',
    deleted_flag TEXT NOT NULL DEFAULT '',
    deleted_at INTEGER,
    reconcile_pending INTEGER NOT NULL DEFAULT 0,
    CHECK (length(id) = 20),
    CHECK (archived IN (0, 1)),
    CHECK (reconcile_pending IN (0, 1))
  );

  CREATE TABLE todos (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    domain_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 0,
    important INTEGER NOT NULL DEFAULT 0,
    due_at INTEGER,
    repeat_type TEXT,
    repeat_interval INTEGER NOT NULL DEFAULT 1,
    remind_at INTEGER,
    last_remind_at INTEGER,
    last_complete_at INTEGER,
    week_day INTEGER,
    monthly_day INTEGER,
    yearly_day INTEGER,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'human',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    client_updated_at INTEGER NOT NULL,
    version_device_id TEXT NOT NULL DEFAULT '',
    version_client_sequence INTEGER NOT NULL DEFAULT 0,
    version_command_uuid TEXT NOT NULL DEFAULT '',
    sync_revision TEXT NOT NULL DEFAULT '0',
    deleted_flag TEXT NOT NULL DEFAULT '',
    deleted_at INTEGER,
    reconcile_pending INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (domain_id) REFERENCES todo_domains(id) ON DELETE RESTRICT,
    CHECK (length(id) = 20),
    CHECK (status IN (0, 1)),
    CHECK (important IN (0, 1)),
    CHECK (source IN ('human', 'ai')),
    CHECK (repeat_type IS NULL OR repeat_type IN ('daily', 'weekly', 'monthly', 'yearly')),
    CHECK (reconcile_pending IN (0, 1))
  );

  CREATE TABLE sub_todos (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    todo_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    client_updated_at INTEGER NOT NULL,
    version_device_id TEXT NOT NULL DEFAULT '',
    version_client_sequence INTEGER NOT NULL DEFAULT 0,
    version_command_uuid TEXT NOT NULL DEFAULT '',
    sync_revision TEXT NOT NULL DEFAULT '0',
    deleted_flag TEXT NOT NULL DEFAULT '',
    deleted_at INTEGER,
    reconcile_pending INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE RESTRICT,
    CHECK (length(id) = 20),
    CHECK (status IN (0, 1)),
    CHECK (reconcile_pending IN (0, 1))
  );

  CREATE TABLE todo_sync_baselines (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    sync_revision TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    reconcile_pending INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (resource_type, resource_id),
    CHECK (resource_type IN ('todo_domain', 'todo', 'sub_todo')),
    CHECK (reconcile_pending IN (0, 1))
  );

  CREATE TABLE todo_sync_outbox (
    command_order INTEGER PRIMARY KEY AUTOINCREMENT,
    command_uuid TEXT NOT NULL UNIQUE,
    command_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    parent_resource_id TEXT,
    args_json TEXT NOT NULL,
    preimage_json TEXT,
    state TEXT NOT NULL DEFAULT 'pending',
    batch_id TEXT,
    ack_revision TEXT,
    canonical_resource_type TEXT,
    canonical_resource_id TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (state IN (
      'pending', 'in_flight', 'acknowledged_waiting_resource',
      'error_waiting_resource', 'clock_rejected', 'permanent_failed',
      'blocked_by_failed_dependency', 'superseded', 'discarded'
    )),
    CHECK (resource_type IN ('todo_domain', 'todo', 'sub_todo'))
  );

  CREATE TABLE todo_events (
    id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL UNIQUE,
    type TEXT NOT NULL,
    todo_id TEXT,
    domain_id TEXT,
    actor TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX todo_domain_customer_position ON todo_domains(customer_id, position);
  CREATE INDEX todo_customer_domain_position ON todos(customer_id, domain_id, position);
  CREATE INDEX todo_customer_status ON todos(customer_id, status);
  CREATE INDEX sub_todo_customer_todo_position ON sub_todos(customer_id, todo_id, position);
  CREATE INDEX todo_sync_outbox_send ON todo_sync_outbox(state, command_order);
  CREATE INDEX todo_sync_outbox_resource ON todo_sync_outbox(resource_type, resource_id, command_order);
  CREATE INDEX todo_event_sequence ON todo_events(sequence);
`;

export const todoistSyncMigrations: readonly TodoistSyncMigration[] = [
  {
    version: 1,
    name: 'todoist-sync-v1',
    up: (db) => db.exec(SCHEMA_V1),
  },
];

export const applyTodoistSyncMigrations = (
  db: TodoistSyncMigrationDatabase,
  migrations: readonly TodoistSyncMigration[] = todoistSyncMigrations,
): void => {
  const ordered = [...migrations].sort((left, right) => left.version - right.version);
  if (ordered.length !== migrations.length || ordered.some((migration, index) => migration !== migrations[index])) {
    throw new Error('[todoist sync] migration manifest must already be ordered');
  }
  if (new Set(ordered.map((migration) => migration.version)).size !== ordered.length) {
    throw new Error('[todoist sync] migration manifest contains duplicate versions');
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    const tableExists = (db as { prepare?: (sql: string) => { get(): unknown } }).prepare?.(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='todoist_sync_schema'",
    ).get();
    const current = tableExists
      ? ((db as { prepare: (sql: string) => { get(): { version?: number } | undefined } }).prepare(
        'SELECT MAX(version) AS version FROM todoist_sync_schema',
      ).get()?.version ?? 0)
      : 0;
    for (const migration of ordered) {
      if (migration.version <= current) continue;
      migration.up(db);
      (db as { prepare: (sql: string) => { run(...values: unknown[]): unknown } }).prepare(
        'INSERT INTO todoist_sync_schema (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, Date.now());
    }
    db.exec('COMMIT;');
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // The migration that failed may have rolled back the outer transaction itself.
    }
    throw error;
  }
};
