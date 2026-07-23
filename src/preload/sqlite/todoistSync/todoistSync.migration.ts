// Runtime owner: the hidden Core SQLite preload process.
export interface TodoistSyncMigrationDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
    run(...values: unknown[]): unknown;
  };
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

export const TODOIST_SYNC_SCHEMA_V1_TABLE_COLUMNS = {
  todoist_sync_schema: ['version', 'name', 'applied_at'],
  todo_sync_state: [
    'customer_id', 'device_id', 'sync_token', 'sync_phase', 'snowflake_node_id',
    'device_sequence', 'interval_seconds', 'bootstrap_started', 'bootstrap_catchup_pending',
    'last_success_at', 'last_error', 'rejected_batch_id', 'created_at', 'updated_at',
  ],
  todo_domains: [
    'id', 'customer_id', 'title', 'description', 'archived', 'position', 'created_at',
    'client_updated_at', 'version_device_id', 'version_client_sequence',
    'version_command_uuid', 'sync_revision', 'deleted_flag', 'deleted_at', 'reconcile_pending',
  ],
  todos: [
    'id', 'customer_id', 'domain_id', 'title', 'status', 'important', 'due_at', 'repeat_type',
    'repeat_interval', 'remind_at', 'last_remind_at', 'last_complete_at', 'week_day',
    'monthly_day', 'yearly_day', 'note', 'source', 'position', 'created_at',
    'client_updated_at', 'version_device_id', 'version_client_sequence',
    'version_command_uuid', 'sync_revision', 'deleted_flag', 'deleted_at', 'reconcile_pending',
  ],
  sub_todos: [
    'id', 'customer_id', 'todo_id', 'title', 'status', 'position', 'created_at',
    'client_updated_at', 'version_device_id', 'version_client_sequence',
    'version_command_uuid', 'sync_revision', 'deleted_flag', 'deleted_at', 'reconcile_pending',
  ],
  todo_sync_baselines: [
    'resource_type', 'resource_id', 'sync_revision', 'payload_json', 'reconcile_pending',
    'updated_at',
  ],
  todo_sync_outbox: [
    'command_order', 'command_uuid', 'command_type', 'resource_type', 'resource_id',
    'parent_resource_id', 'args_json', 'preimage_json', 'state', 'batch_id', 'ack_revision',
    'canonical_resource_type', 'canonical_resource_id', 'error_code', 'error_message',
    'created_at', 'updated_at',
  ],
  todo_events: ['id', 'sequence', 'type', 'todo_id', 'domain_id', 'actor', 'payload', 'created_at'],
} as const;

export const TODOIST_SYNC_SCHEMA_V1_INDEXES = [
  'todo_domain_customer_position',
  'todo_customer_domain_position',
  'todo_customer_status',
  'sub_todo_customer_todo_position',
  'todo_sync_outbox_send',
  'todo_sync_outbox_resource',
  'todo_event_sequence',
] as const;

export const TODOIST_SYNC_SCHEMA_V2_TABLE_COLUMNS = {
  ...TODOIST_SYNC_SCHEMA_V1_TABLE_COLUMNS,
  todo_sync_baselines: [
    ...TODOIST_SYNC_SCHEMA_V1_TABLE_COLUMNS.todo_sync_baselines,
    'parent_resource_id',
  ],
} as const;

export const TODOIST_SYNC_SCHEMA_V2_INDEXES = [
  ...TODOIST_SYNC_SCHEMA_V1_INDEXES,
  'todo_sync_baseline_parent',
] as const;

interface TodoistSyncSchemaColumn {
  name: unknown;
  type: unknown;
  notnull: unknown;
}

interface TodoistSyncSchemaIndex {
  name: unknown;
}

interface TodoistSyncIndexColumn {
  name: unknown;
}

interface TodoistSyncForeignKey {
  table: unknown;
  from: unknown;
  to: unknown;
}

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const assertTodoistSyncSchema = (
  db: TodoistSyncMigrationDatabase,
  version: 1 | 2,
  expectedTables: Record<string, readonly string[]>,
  expectedIndexes: readonly string[],
): void => {
  for (const [table, expectedColumns] of Object.entries(expectedTables)) {
    const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as TodoistSyncSchemaColumn[];
    const actualColumns = rows.map((row) => row.name);
    const expectedColumnOrders = version === 2 && table === 'todo_sync_baselines'
      ? [
          expectedColumns,
          [
            'resource_type',
            'resource_id',
            'parent_resource_id',
            'sync_revision',
            'payload_json',
            'reconcile_pending',
            'updated_at',
          ],
        ]
      : [expectedColumns];
    const hasExpectedOrder = expectedColumnOrders.some((order) => (
      actualColumns.length === order.length &&
      order.every((column, index) => actualColumns[index] === column)
    ));
    if (!hasExpectedOrder) {
      throw new Error(`[todoist sync] schema-v${version} table ${table} does not match its column contract`);
    }
  }

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as TodoistSyncSchemaIndex[];
  const indexNames = new Set(indexes.map((row) => row.name));
  for (const index of expectedIndexes) {
    if (!indexNames.has(index)) throw new Error(`[todoist sync] schema-v${version} index ${index} is missing`);
  }

  const todoForeignKeys = db.prepare('PRAGMA foreign_key_list(todos)').all() as TodoistSyncForeignKey[];
  const subTodoForeignKeys = db.prepare('PRAGMA foreign_key_list(sub_todos)').all() as TodoistSyncForeignKey[];
  const hasTodoDomainKey = todoForeignKeys.some((row) => (
    row.table === 'todo_domains' && row.from === 'domain_id' && row.to === 'id'
  ));
  const hasSubTodoKey = subTodoForeignKeys.some((row) => (
    row.table === 'todos' && row.from === 'todo_id' && row.to === 'id'
  ));
  if (!hasTodoDomainKey || !hasSubTodoKey) {
    throw new Error(`[todoist sync] schema-v${version} foreign-key contract is incomplete`);
  }
};

export const assertTodoistSyncSchemaV1 = (db: TodoistSyncMigrationDatabase): void => {
  assertTodoistSyncSchema(
    db,
    1,
    TODOIST_SYNC_SCHEMA_V1_TABLE_COLUMNS,
    TODOIST_SYNC_SCHEMA_V1_INDEXES,
  );
};

export const assertTodoistSyncSchemaV2 = (db: TodoistSyncMigrationDatabase): void => {
  assertTodoistSyncSchema(
    db,
    2,
    TODOIST_SYNC_SCHEMA_V2_TABLE_COLUMNS,
    TODOIST_SYNC_SCHEMA_V2_INDEXES,
  );
  const columns = db.prepare('PRAGMA table_info(todo_sync_baselines)').all() as TodoistSyncSchemaColumn[];
  const parentColumn = columns.find((column) => column.name === 'parent_resource_id');
  if (parentColumn?.type !== 'TEXT' || parentColumn.notnull !== 0) {
    throw new Error('[todoist sync] schema-v2 baseline parent column contract is invalid');
  }
  const indexColumns = db.prepare('PRAGMA index_info(todo_sync_baseline_parent)').all() as TodoistSyncIndexColumn[];
  const actualIndexColumns = indexColumns.map((column) => column.name);
  const expectedIndexColumns = ['resource_type', 'parent_resource_id', 'resource_id'];
  if (
    actualIndexColumns.length !== expectedIndexColumns.length ||
    expectedIndexColumns.some((column, index) => actualIndexColumns[index] !== column)
  ) {
    throw new Error('[todoist sync] schema-v2 baseline parent index contract is invalid');
  }
};

const addTodoistSyncBaselineParent = (db: TodoistSyncMigrationDatabase): void => {
  const columns = db.prepare('PRAGMA table_info(todo_sync_baselines)').all() as TodoistSyncSchemaColumn[];
  if (!columns.some((column) => column.name === 'parent_resource_id')) {
    db.exec('ALTER TABLE todo_sync_baselines ADD COLUMN parent_resource_id TEXT;');
  }
  const index = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='todo_sync_baseline_parent'",
  ).get();
  if (!index) {
    db.exec(`
      CREATE INDEX todo_sync_baseline_parent
      ON todo_sync_baselines(resource_type, parent_resource_id, resource_id);
    `);
  }
  assertTodoistSyncSchemaV2(db);
};

export const todoistSyncMigrations: readonly TodoistSyncMigration[] = [
  {
    version: 1,
    name: 'todoist-sync-v1',
    up: (db) => db.exec(SCHEMA_V1),
  },
  {
    version: 2,
    name: 'todoist-sync-v2-baseline-parent',
    up: addTodoistSyncBaselineParent,
  },
];

export class TodoistSyncMigrationError extends Error {
  constructor(
    readonly version: number,
    readonly migrationName: string,
    cause: unknown,
  ) {
    super(`[todoist sync] migration ${version} (${migrationName}) failed`, { cause });
    this.name = 'TodoistSyncMigrationError';
  }
}

interface TodoistSyncLedgerRow {
  version: unknown;
  name: unknown;
}

const assertTodoistSyncMigrationManifest = (migrations: readonly TodoistSyncMigration[]): void => {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= previous) {
      throw new Error('[todoist sync] migration manifest must contain ordered positive integer versions');
    }
    if (!migration.name.trim()) throw new Error('[todoist sync] migration name is required');
    previous = migration.version;
  }
};

const getTodoistSyncLedger = (db: TodoistSyncMigrationDatabase): TodoistSyncLedgerRow[] => {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='todoist_sync_schema'",
  ).get();
  if (!table) return [];
  return db.prepare('SELECT version, name FROM todoist_sync_schema ORDER BY version').all() as TodoistSyncLedgerRow[];
};

const assertTodoistSyncLedger = (
  rows: readonly TodoistSyncLedgerRow[],
  migrations: readonly TodoistSyncMigration[],
  complete = false,
): number => {
  let previous = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!Number.isSafeInteger(row.version) || (row.version as number) <= previous) {
      throw new Error('[todoist sync] migration ledger contains an invalid or unordered version');
    }
    const expected = migrations[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name) {
      throw new Error(`[todoist sync] migration ledger contains unknown entry ${String(row.version)}`);
    }
    previous = row.version as number;
  }
  if (complete && rows.length !== migrations.length) {
    throw new Error('[todoist sync] migration ledger does not match the complete runtime manifest');
  }
  return previous;
};

export const applyTodoistSyncMigrations = (
  db: TodoistSyncMigrationDatabase,
  migrations: readonly TodoistSyncMigration[] = todoistSyncMigrations,
): void => {
  assertTodoistSyncMigrationManifest(migrations);
  const current = assertTodoistSyncLedger(getTodoistSyncLedger(db), migrations);
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.exec('BEGIN IMMEDIATE;');
    try {
      migration.up(db);
      db.prepare(
        'INSERT INTO todoist_sync_schema (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, Date.now());
      db.exec('COMMIT;');
    } catch (error) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // The failing runner may already have ended its transaction.
      }
      throw new TodoistSyncMigrationError(migration.version, migration.name, error);
    }
  }
  assertTodoistSyncLedger(getTodoistSyncLedger(db), migrations, true);
  const currentVersion = migrations.at(-1)?.version ?? 0;
  if (currentVersion === 1) {
    assertTodoistSyncSchemaV1(db);
  } else if (currentVersion >= 2) {
    assertTodoistSyncSchemaV2(db);
  }
};
