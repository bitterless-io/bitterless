import { SEARCH_SCHEMA_VERSION, SEARCH_STATE_SCHEMA_VERSION } from './constants.mjs';

const CONTENT_SCHEMA_OBJECTS = [
  'files',
  'files_project_path',
  'chunks',
  'chunk_fts',
  'cjk_postings',
  'index_meta',
];
const REQUIRED_SCHEMA_OBJECTS = [...CONTENT_SCHEMA_OBJECTS, 'search_tree'];
const SEARCH_TREE_COLUMNS = Object.freeze([
  ['relative_path', 'TEXT', 1, 1],
  ['parent_relative_path', 'TEXT', 1, 0],
  ['name', 'TEXT', 1, 0],
  ['node_kind', 'TEXT', 1, 0],
  ['size', 'INTEGER', 1, 0],
  ['modified_ms', 'INTEGER', 1, 0],
  ['preview_hint', 'TEXT', 1, 0],
  ['media_type', 'TEXT', 1, 0],
  ['is_text', 'INTEGER', 1, 0]
]);

const CREATE_SEARCH_TREE_SQL = `
  CREATE TABLE IF NOT EXISTS search_tree (
    relative_path TEXT PRIMARY KEY,
    parent_relative_path TEXT NOT NULL,
    name TEXT NOT NULL,
    node_kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER NOT NULL,
    preview_hint TEXT NOT NULL,
    media_type TEXT NOT NULL,
    is_text INTEGER NOT NULL
  ) WITHOUT ROWID;
`;

const CREATE_SCHEMA_SQL = `
  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    normalized_path TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    media_type TEXT NOT NULL,
    content_indexed INTEGER NOT NULL,
    in_project INTEGER NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER NOT NULL
  );
  CREATE INDEX files_project_path ON files(in_project, relative_path);
  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    core_text TEXT NOT NULL,
    left_context_text TEXT NOT NULL,
    right_overlap_text TEXT NOT NULL,
    normalized_searchable TEXT NOT NULL,
    normalized_core_length INTEGER NOT NULL
  );
  CREATE INDEX chunks_file_ordinal ON chunks(file_id, ordinal);
  CREATE VIRTUAL TABLE chunk_fts USING fts5(
    searchable,
    content = '',
    contentless_delete = 1,
    tokenize = 'trigram'
  );
  CREATE TABLE cjk_postings (
    token TEXT NOT NULL,
    chunk_id INTEGER NOT NULL,
    PRIMARY KEY (token, chunk_id)
  ) WITHOUT ROWID;
  CREATE INDEX cjk_postings_chunk_id ON cjk_postings(chunk_id);
  CREATE TABLE index_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
  ${CREATE_SEARCH_TREE_SQL}
`;

const readSchemaTables = (database) => {
  const placeholders = REQUIRED_SCHEMA_OBJECTS.map(() => '?').join(', ');
  const rows = database.prepare(
    `SELECT name, sql FROM sqlite_master WHERE name IN (${placeholders})`,
  ).all(...REQUIRED_SCHEMA_OBJECTS);
  return new Map(rows.map((row) => [row.name, row.sql ?? '']));
};

const hasUsableSearchTreeSchema = (database, tables) => {
  const sql = tables.get('search_tree') ?? '';
  if (!/without\s+rowid/iu.test(sql)) return false;
  const columns = database.prepare("PRAGMA table_info('search_tree')").all();
  return (
    columns.length === SEARCH_TREE_COLUMNS.length &&
    columns.every((column, index) => {
      const expected = SEARCH_TREE_COLUMNS[index];
      return (
        column.name === expected[0] &&
        String(column.type).toUpperCase() === expected[1] &&
        Number(column.notnull) === expected[2] &&
        Number(column.pk) === expected[3] &&
        column.dflt_value === null
      );
    })
  );
};

export const configureSearchDatabase = (database) => {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = FILE;
    PRAGMA cache_size = -32768;
    PRAGMA mmap_size = 268435456;
  `);
  const previousVersion = Number(database.prepare('PRAGMA user_version').get().user_version);
  const tables = readSchemaTables(database);
  const ftsSql = tables.get('chunk_fts') ?? '';
  const contentSchemaValid = CONTENT_SCHEMA_OBJECTS.every((name) => tables.has(name)) &&
    /content\s*=\s*''/iu.test(ftsSql) && /contentless_delete\s*=\s*1/iu.test(ftsSql);
  const current =
    previousVersion === SEARCH_SCHEMA_VERSION &&
    contentSchemaValid &&
    hasUsableSearchTreeSchema(database, tables);
  const additiveUpgrade = previousVersion === 7 && contentSchemaValid;
  if (additiveUpgrade) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        DROP TABLE IF EXISTS search_tree;
        ${CREATE_SEARCH_TREE_SQL}
        DELETE FROM index_meta WHERE key LIKE 'tree_%';
        PRAGMA user_version = ${SEARCH_SCHEMA_VERSION};
        COMMIT;
      `);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  if (!current && !additiveUpgrade) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(`
        DROP TABLE IF EXISTS chunk_fts;
        DROP TABLE IF EXISTS cjk_postings;
        DROP TABLE IF EXISTS chunks;
        DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS index_meta;
        DROP TABLE IF EXISTS search_tree;
        ${CREATE_SCHEMA_SQL}
        PRAGMA user_version = ${SEARCH_SCHEMA_VERSION};
        COMMIT;
      `);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    previousVersion,
    schemaVersion: SEARCH_SCHEMA_VERSION,
    rebuilt: !current && !additiveUpgrade
  };
};

export const createBuildStateStore = (database) => {
  const select = database.prepare('SELECT value FROM index_meta WHERE key = ?');
  const upsert = database.prepare(`
    INSERT INTO index_meta(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const get = (key) => select.get(key)?.value;
  const setMany = (values) => {
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const [key, value] of Object.entries(values)) upsert.run(key, String(value));
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
  const read = () => ({
    stateSchemaVersion: Number(get('state_schema_version') ?? 0),
    state: get('state') ?? 'missing',
    workspaceHash: get('workspace_hash') ?? '',
    configHash: get('config_hash') ?? '',
    engineHash: get('engine_hash') ?? '',
    buildId: get('build_id') ?? '',
  });
  const start = ({ state, workspaceHash, configHash, engineHash, buildId }) => setMany({
    state_schema_version: SEARCH_STATE_SCHEMA_VERSION,
    state,
    workspace_hash: workspaceHash,
    config_hash: configHash,
    engine_hash: engineHash,
    build_id: buildId,
  });
  const markReady = ({ workspaceHash, configHash, engineHash, buildId }) => setMany({
    state_schema_version: SEARCH_STATE_SCHEMA_VERSION,
    state: 'ready',
    workspace_hash: workspaceHash,
    config_hash: configHash,
    engine_hash: engineHash,
    build_id: buildId,
  });
  const isReusable = ({ workspaceHash, configHash, engineHash }) => {
    const state = read();
    return state.stateSchemaVersion === SEARCH_STATE_SCHEMA_VERSION &&
      state.state === 'ready' && state.workspaceHash === workspaceHash &&
      state.configHash === configHash && state.engineHash === engineHash && Boolean(state.buildId);
  };
  return { read, start, markReady, isReusable };
};
