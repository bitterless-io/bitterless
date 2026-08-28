/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { DatabaseSync } from 'node:sqlite';

import { normalizeSearchText } from '../../../src/preload/onlypreview/search/core/normalization.mjs';
import { sortOnlyPreviewTreeEntries } from '../../../src/preload/onlypreview/search/core/watch-reconciler.mjs';
import { SECTION_RESULT_CAP } from './planContract.mjs';

export const METADATA_SCHEMA_VERSION = 1;

/**
 * A name query is answered by collecting every match and then ordering it the way the shipped engine
 * orders its tree, because SQL cannot express that order (segment-wise natural collation with a
 * directory ahead of its own descendants). Ordering after collection is what makes a capped page the
 * same page plan A returns. The ceiling only exists so a pathological query cannot allocate without
 * bound, and when it is hit the caller is told.
 */
const NAME_MATCH_CEILING = 20_000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (
    relative_path TEXT PRIMARY KEY,
    dir_path TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS files_dir ON files(dir_path, relative_path);
  CREATE INDEX IF NOT EXISTS files_media ON files(media_type, relative_path);
  CREATE TABLE IF NOT EXISTS dirs (
    relative_path TEXT PRIMARY KEY,
    parent_relative_path TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`;

const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -32768;
  PRAGMA mmap_size = 268435456;
`;

/**
 * Directory scope as an ordered key range. '/' is 0x2f, so appending 0x30 ('0') is the smallest
 * string strictly greater than every path under `dir/` - the same trick the shipped engine uses,
 * kept here so scoped queries stay index-driven instead of falling back to LIKE.
 */
export const scopeRange = (relativePath) => [`${relativePath}/`, `${relativePath}0`];

const scopeClause = (column, scope) =>
  scope?.kind === 'directory' && scope.relativePath
    ? { sql: ` AND ${column} >= ? AND ${column} < ?`, params: scopeRange(scope.relativePath) }
    : { sql: '', params: [] };

/**
 * The metadata tier shared by every plan that separates "what files exist" from "what is inside
 * them". Keeping one implementation means Files results are identical across those plans, so a
 * benchmark difference can only come from the content tier.
 */
export const createMetadataStore = ({ databasePath, readOnly = false }) => {
  const database = new DatabaseSync(databasePath, { readOnly });
  if (!readOnly) {
    database.exec(PRAGMAS);
    database.exec(SCHEMA);
  } else {
    database.exec('PRAGMA mmap_size = 268435456;');
  }

  const statements = {
    insertFile: readOnly
      ? undefined
      : database.prepare(`
          INSERT INTO files(relative_path, dir_path, name, normalized_name, media_type, size, modified_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(relative_path) DO UPDATE SET
            dir_path = excluded.dir_path, name = excluded.name,
            normalized_name = excluded.normalized_name, media_type = excluded.media_type,
            size = excluded.size, modified_ms = excluded.modified_ms
        `),
    deleteFile: readOnly
      ? undefined
      : database.prepare('DELETE FROM files WHERE relative_path = ?'),
    insertDir: readOnly
      ? undefined
      : database.prepare(`
          INSERT INTO dirs(relative_path, parent_relative_path, name, normalized_name)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(relative_path) DO UPDATE SET
            parent_relative_path = excluded.parent_relative_path, name = excluded.name,
            normalized_name = excluded.normalized_name
        `),
    deleteDir: readOnly ? undefined : database.prepare('DELETE FROM dirs WHERE relative_path = ?'),
    setMeta: readOnly
      ? undefined
      : database.prepare(
          'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ),
    getMeta: database.prepare('SELECT value FROM meta WHERE key = ?'),
    allDirs: database.prepare('SELECT relative_path FROM dirs ORDER BY relative_path'),
    countFiles: database.prepare('SELECT count(*) AS total FROM files'),
    countDirs: database.prepare('SELECT count(*) AS total FROM dirs'),
    fileByPath: database.prepare('SELECT * FROM files WHERE relative_path = ?')
  };

  const transaction = (run) => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      database.exec('COMMIT');
      return value;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    database,
    transaction,

    replaceAll: ({ files, dirs }) =>
      transaction(() => {
        database.exec('DELETE FROM files; DELETE FROM dirs;');
        for (const dir of dirs) {
          statements.insertDir.run(
            dir.relativePath,
            dir.parentRelativePath,
            dir.name,
            normalizeSearchText(dir.name)
          );
        }
        for (const file of files) {
          statements.insertFile.run(
            file.relativePath,
            file.parentRelativePath,
            file.name,
            normalizeSearchText(file.name),
            file.mediaType,
            file.size,
            file.modifiedMs
          );
        }
      }),

    upsertFiles: (files) => {
      for (const file of files) {
        statements.insertFile.run(
          file.relativePath,
          file.parentRelativePath,
          file.name,
          normalizeSearchText(file.name),
          file.mediaType,
          file.size,
          file.modifiedMs
        );
      }
    },

    upsertDirs: (dirs) => {
      for (const dir of dirs) {
        statements.insertDir.run(
          dir.relativePath,
          dir.parentRelativePath,
          dir.name,
          normalizeSearchText(dir.name)
        );
      }
    },

    deleteFiles: (relativePaths) => {
      for (const relativePath of relativePaths) statements.deleteFile.run(relativePath);
    },

    deleteDirs: (relativePaths) => {
      for (const relativePath of relativePaths) statements.deleteDir.run(relativePath);
    },

    /** Every indexed file, or every file under a directory scope, ordered by path. */
    listFiles: ({ scope, mediaType } = {}) => {
      const clause = scopeClause('relative_path', scope);
      const media = mediaType ? ' AND media_type = ?' : '';
      const rows = database
        .prepare(
          `SELECT relative_path, dir_path, name, media_type, size, modified_ms
           FROM files WHERE 1 = 1${clause.sql}${media} ORDER BY relative_path`
        )
        .all(...clause.params, ...(mediaType ? [mediaType] : []));
      return rows.map((row) => ({
        relativePath: row.relative_path,
        parentRelativePath: row.dir_path,
        name: row.name,
        mediaType: row.media_type,
        size: Number(row.size),
        modifiedMs: Number(row.modified_ms)
      }));
    },

    /**
     * Name search straight out of SQLite: the normalized name is stored, so a query never
     * re-normalises the whole corpus, and a directory scope becomes an index range instead of a
     * full in-memory scan. Directories are returned first, matching the shipped ordering.
     */
    searchNames: ({ query, scope, maxResults: requestedResults }) => {
      const maxResults = Math.min(SECTION_RESULT_CAP, Math.max(0, Math.trunc(requestedResults)));
      const normalized = normalizeSearchText(query);
      if (!normalized) return { dirs: [], files: [], matched: 0, ceilingReached: false };
      const pattern = `%${normalized.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      const clause = scopeClause('relative_path', scope);
      const dirRows = database
        .prepare(
          `SELECT relative_path, name FROM dirs
           WHERE normalized_name LIKE ? ESCAPE '\\'${clause.sql}
           ORDER BY relative_path LIMIT ?`
        )
        .all(pattern, ...clause.params, NAME_MATCH_CEILING);
      const fileRows = database
        .prepare(
          `SELECT relative_path, name FROM files
           WHERE normalized_name LIKE ? ESCAPE '\\'${clause.sql}
           ORDER BY relative_path LIMIT ?`
        )
        .all(pattern, ...clause.params, NAME_MATCH_CEILING);
      const ordered = sortOnlyPreviewTreeEntries([
        ...dirRows.map((row) => ({
          relativePath: row.relative_path,
          name: row.name,
          nodeKind: 'directory'
        })),
        ...fileRows.map((row) => ({
          relativePath: row.relative_path,
          name: row.name,
          nodeKind: 'file'
        }))
      ]);
      const dirs = ordered.filter((entry) => entry.nodeKind === 'directory');
      const files = ordered.filter((entry) => entry.nodeKind === 'file');
      return {
        dirs,
        files,
        matched: ordered.length,
        ceilingReached:
          dirRows.length >= NAME_MATCH_CEILING || fileRows.length >= NAME_MATCH_CEILING,
        // Plan A emits directories first, then files, each in tree order.
        ordered: [...dirs, ...files].slice(0, maxResults),
        truncated: dirs.length + files.length > maxResults
      };
    },

    directories: () => statements.allDirs.all().map((row) => row.relative_path),

    fileMetadata: (relativePath) => {
      const row = statements.fileByPath.get(relativePath);
      if (!row) return undefined;
      return {
        relativePath: row.relative_path,
        parentRelativePath: row.dir_path,
        name: row.name,
        mediaType: row.media_type,
        size: Number(row.size),
        modifiedMs: Number(row.modified_ms)
      };
    },

    getMeta: (key) => statements.getMeta.get(key)?.value,
    setMeta: (key, value) => statements.setMeta.run(key, String(value)),

    stats: () => ({
      schemaVersion: METADATA_SCHEMA_VERSION,
      files: Number(statements.countFiles.get().total),
      directories: Number(statements.countDirs.get().total)
    }),

    close: () => database.close()
  };
};
