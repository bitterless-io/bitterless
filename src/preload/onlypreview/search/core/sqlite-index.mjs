import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { splitContentDefinedChunks } from './chunking.mjs';
import {
  BACKGROUND_BUILD_TRANSACTION_FILES,
  MAX_RESULTS,
  SEARCH_STATE_SCHEMA_VERSION,
  SEARCH_WORK_SLICE_MS
} from './constants.mjs';
import {
  FilenameTier,
  hasHiddenDirectory,
  prepareFilenameRecord
} from './filename-tier.mjs';
import {
  createPlainTextSnippet,
  extractCjkPostingTokens,
  isIndexedShortQuery,
  normalizeSearchText,
  projectNormalizedMatchToSource
} from './normalization.mjs';
import { clampSearchResultLimit, createOnlyPreviewSearchResult } from './search-contract.mjs';
import { configureSearchDatabase, createBuildStateStore } from './sqlite-schema.mjs';
import { OnlyPreviewSqliteSnapshotStore } from './sqlite-snapshot-store.mjs';
import { SQLITE_SCOPE_SQL, createSqliteScopePlan } from './sqlite-search-scope.mjs';
import { searchOnlyPreviewIndexedContents } from './sqlite-content-search.mjs';
import { createBackgroundWorkSlicer } from './work-slicer.mjs';

export const SEARCH_ENGINE_IDENTITY =
  'onlypreview-contentless-full-v8:short-nonascii:grouped-global-search:tolerant-extension-size';

const ftsPhrase = (query) => `"${query.replaceAll('"', '""')}"`;

const candidateColumns = `
  c.id AS chunk_id, c.file_id, c.ordinal, c.core_text, c.left_context_text,
  c.right_overlap_text, c.normalized_searchable, c.normalized_core_length,
  f.relative_path, f.file_name, f.media_type
`;

const createScopedStatements = (database, sql) =>
  Object.fromEntries(
    Object.entries(SQLITE_SCOPE_SQL).map(([key, clause]) => [key, database.prepare(sql(clause))])
  );

const prepareEntry = (entry) => ({
  relativePath: entry.relativePath.replaceAll('\\', '/'),
  fileName: entry.name ?? entry.relativePath.split('/').at(-1) ?? '',
  normalizedPath: normalizeSearchText(entry.relativePath.replaceAll('\\', '/')),
  normalizedTitle: normalizeSearchText(entry.name ?? entry.relativePath.split('/').at(-1) ?? ''),
  mediaType: entry.mediaType ?? 'unknown',
  contentIndexed: entry.contentIndexed === true,
  inProject: !hasHiddenDirectory(entry.relativePath.replaceAll('\\', '/')),
  originalContent: entry.contentIndexed === true ? String(entry.originalContent ?? '') : '',
  size: Number(entry.size ?? 0),
  modifiedMs: Math.trunc(entry.modifiedMs ?? entry.modifiedAt ?? 0)
});

const chunkColumnsEqual = (row, chunk) =>
  row.content_hash === chunk.hash &&
  row.core_text === chunk.text &&
  row.left_context_text === chunk.leftContextText &&
  row.right_overlap_text === chunk.rightOverlapText &&
  row.normalized_searchable === chunk.normalizedSearchableText &&
  Number(row.normalized_core_length) === chunk.normalizedCoreLength;

export class OnlyPreviewSqliteIndex {
  constructor(databasePath) {
    this.databasePath = databasePath;
    this.database = new DatabaseSync(databasePath);
    try {
      this.schema = configureSearchDatabase(this.database);
      this.buildState = createBuildStateStore(this.database);
      this.filenameTier = new FilenameTier();
      this.prepareStatements();
      this.snapshotStore = new OnlyPreviewSqliteSnapshotStore({
        database: this.database,
        buildState: this.buildState,
        filenameTier: this.filenameTier
      });
      this.hydrateFilenameTier();
    } catch (error) {
      try {
        this.database.close();
      } catch {
        // Preserve the configuration or hydration failure that made the handle unusable.
      }
      throw error;
    }
  }

  prepareStatements() {
    const database = this.database;
    database.exec(`
      CREATE TEMP TABLE IF NOT EXISTS search_target_files (
        file_id INTEGER PRIMARY KEY
      ) WITHOUT ROWID;
    `);
    this.selectFileByPath = database.prepare('SELECT * FROM files WHERE relative_path = ?');
    this.insertFile = database.prepare(`
      INSERT INTO files(relative_path, file_name, normalized_path, normalized_title,
        media_type, content_indexed, in_project, size, modified_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateFile = database.prepare(`
      UPDATE files SET file_name = ?, normalized_path = ?, normalized_title = ?,
        media_type = ?, content_indexed = ?, in_project = ?, size = ?, modified_ms = ?
      WHERE id = ?
    `);
    this.deleteFileStatement = database.prepare('DELETE FROM files WHERE id = ?');
    this.selectChunksByFile = database.prepare(`
      SELECT id, ordinal, content_hash, core_text, left_context_text,
        right_overlap_text, normalized_searchable, normalized_core_length
      FROM chunks WHERE file_id = ? ORDER BY ordinal
    `);
    this.insertChunk = database.prepare(`
      INSERT INTO chunks(file_id, ordinal, content_hash, core_text, left_context_text,
        right_overlap_text, normalized_searchable, normalized_core_length)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateChunk = database.prepare(`
      UPDATE chunks SET ordinal = ?, content_hash = ?, core_text = ?, left_context_text = ?,
        right_overlap_text = ?, normalized_searchable = ?, normalized_core_length = ?
      WHERE id = ?
    `);
    this.updateChunkOrdinal = database.prepare('UPDATE chunks SET ordinal = ? WHERE id = ?');
    this.deleteChunkStatement = database.prepare('DELETE FROM chunks WHERE id = ?');
    this.insertFts = database.prepare('INSERT INTO chunk_fts(rowid, searchable) VALUES (?, ?)');
    this.deleteFts = database.prepare('DELETE FROM chunk_fts WHERE rowid = ?');
    this.insertPosting = database.prepare(
      'INSERT OR IGNORE INTO cjk_postings(token, chunk_id) VALUES (?, ?)'
    );
    this.deletePostings = database.prepare('DELETE FROM cjk_postings WHERE chunk_id = ?');
    this.selectCoreTextByFile = database.prepare(
      'SELECT core_text FROM chunks WHERE file_id = ? ORDER BY ordinal'
    );
    this.clearTargetFiles = database.prepare('DELETE FROM search_target_files');
    this.insertTargetFile = database.prepare(
      'INSERT OR IGNORE INTO search_target_files(file_id) VALUES (?)'
    );
    this.selectContentFiles = createScopedStatements(
      database,
      (scopeClause) => `
      SELECT f.id, f.relative_path, f.file_name, f.media_type FROM files AS f
      WHERE f.content_indexed = 1 AND ${scopeClause} ORDER BY f.relative_path
    `
    );
    this.selectFtsCandidates = createScopedStatements(
      database,
      (scopeClause) => `
      SELECT ${candidateColumns} FROM chunk_fts AS x
      JOIN chunks AS c ON c.id = x.rowid JOIN files AS f ON f.id = c.file_id
      WHERE chunk_fts MATCH ? AND ${scopeClause} ORDER BY f.relative_path, c.ordinal
    `
    );
    this.selectInstrCandidates = createScopedStatements(
      database,
      (scopeClause) => `
      SELECT ${candidateColumns} FROM chunks AS c JOIN files AS f ON f.id = c.file_id
      WHERE instr(c.normalized_searchable, ?) > 0 AND ${scopeClause}
      ORDER BY f.relative_path, c.ordinal
    `
    );
    this.selectPostingCandidates = createScopedStatements(
      database,
      (scopeClause) => `
      SELECT ${candidateColumns} FROM cjk_postings AS p
      JOIN chunks AS c ON c.id = p.chunk_id JOIN files AS f ON f.id = c.file_id
      WHERE p.token = ? AND ${scopeClause} ORDER BY f.relative_path, c.ordinal
    `
    );
    this.selectTargetContentFiles = database.prepare(`
      SELECT f.id, f.relative_path, f.file_name, f.media_type
      FROM search_target_files AS t JOIN files AS f ON f.id = t.file_id
      WHERE f.content_indexed = 1 ORDER BY f.relative_path
    `);
    this.selectTargetFtsCandidates = database.prepare(`
      SELECT ${candidateColumns} FROM chunk_fts AS x
      JOIN chunks AS c ON c.id = x.rowid
      JOIN search_target_files AS t ON t.file_id = c.file_id
      JOIN files AS f ON f.id = c.file_id
      WHERE chunk_fts MATCH ? ORDER BY f.relative_path, c.ordinal
    `);
    this.selectTargetInstrCandidates = database.prepare(`
      SELECT ${candidateColumns} FROM chunks AS c
      JOIN search_target_files AS t ON t.file_id = c.file_id
      JOIN files AS f ON f.id = c.file_id
      WHERE instr(c.normalized_searchable, ?) > 0 ORDER BY f.relative_path, c.ordinal
    `);
    this.selectTargetPostingCandidates = database.prepare(`
      SELECT ${candidateColumns} FROM cjk_postings AS p
      JOIN chunks AS c ON c.id = p.chunk_id
      JOIN search_target_files AS t ON t.file_id = c.file_id
      JOIN files AS f ON f.id = c.file_id
      WHERE p.token = ? ORDER BY f.relative_path, c.ordinal
    `);
  }

  hydrateFilenameTier() {
    this.snapshotStore.hydrateFilenameTier();
  }

  applyFilenameTierMutations({ upsertPaths, deletePaths }) {
    this.snapshotStore.applyFilenameTierMutations({ upsertPaths, deletePaths });
  }

  isReusable(identity) {
    return this.buildState.isReusable(identity);
  }

  readTreeSnapshot() {
    return this.snapshotStore.readTreeSnapshot();
  }

  invalidateTreeSnapshot() {
    this.snapshotStore.invalidateTreeSnapshot();
  }

  replaceTreeSnapshot(entries, maxDepthReached) {
    return this.snapshotStore.replaceTreeSnapshot(entries, maxDepthReached);
  }

  applyTreeSnapshotMutations({ upserts, removedPaths, maxDepthReached }) {
    return this.snapshotStore.applyTreeSnapshotMutations({
      upserts,
      removedPaths,
      maxDepthReached
    });
  }

  canReconcile(identity) {
    if (this.isReusable(identity)) return true;
    const state = this.buildState.read();
    return (
      state.stateSchemaVersion === SEARCH_STATE_SCHEMA_VERSION &&
      (state.state === 'building' || state.state === 'reconciling') &&
      state.workspaceHash === identity.workspaceHash &&
      state.configHash === identity.configHash &&
      state.engineHash === identity.engineHash &&
      Boolean(state.buildId)
    );
  }

  metadataForTraversal({ relativePath, size, modifiedMs }) {
    const record = this.filenameTier.get(relativePath);
    if (!record || record.size !== size || record.modifiedMs !== modifiedMs) return undefined;
    return {
      unchanged: true,
      mediaType: record.mediaType,
      contentIndexed: record.contentIndexed
    };
  }

  clearContent() {
    this.database.exec(`
      DELETE FROM cjk_postings;
      DELETE FROM chunk_fts;
      DELETE FROM chunks;
      DELETE FROM files;
    `);
    this.filenameTier.clear();
  }

  replaceChunkIndex(chunkId, searchable) {
    this.insertFts.run(chunkId, searchable);
    for (const token of extractCjkPostingTokens(searchable)) {
      this.insertPosting.run(token, chunkId);
    }
  }

  removeChunkIndex(chunkId) {
    this.deletePostings.run(chunkId);
    this.deleteFts.run(chunkId);
  }

  insertChunkRows(fileId, chunks) {
    for (const chunk of chunks) {
      const inserted = this.insertChunk.run(
        fileId,
        chunk.ordinal,
        chunk.hash,
        chunk.text,
        chunk.leftContextText,
        chunk.rightOverlapText,
        chunk.normalizedSearchableText,
        chunk.normalizedCoreLength
      );
      this.replaceChunkIndex(Number(inserted.lastInsertRowid), chunk.normalizedSearchableText);
    }
  }

  insertPrepared(prepared, chunks = undefined) {
    const inserted = this.insertFile.run(
      prepared.relativePath,
      prepared.fileName,
      prepared.normalizedPath,
      prepared.normalizedTitle,
      prepared.mediaType,
      prepared.contentIndexed ? 1 : 0,
      prepared.inProject ? 1 : 0,
      prepared.size,
      prepared.modifiedMs
    );
    const fileId = Number(inserted.lastInsertRowid);
    const resolvedChunks =
      chunks ??
      (prepared.contentIndexed ? splitContentDefinedChunks(prepared.originalContent) : []);
    this.insertChunkRows(fileId, resolvedChunks);
    return { fileId, chunks: resolvedChunks, record: prepareFilenameRecord(prepared, fileId) };
  }

  async rebuild(entries, identity, { onBatch, workSlicer = createBackgroundWorkSlicer() } = {}) {
    const buildId = randomUUID();
    this.buildState.start({ ...identity, state: 'building', buildId });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.clearContent();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    let fileCount = 0;
    let contentFileCount = 0;
    let chunkCount = 0;
    let batch = [];
    const filenameRecords = [];
    const commitBatch = () => {
      if (batch.length === 0) return;
      const records = [];
      this.database.exec('BEGIN IMMEDIATE');
      try {
        for (const entry of batch) {
          const prepared = prepareEntry(entry);
          const result = this.insertPrepared(prepared);
          records.push(result.record);
          fileCount += 1;
          contentFileCount += prepared.contentIndexed ? 1 : 0;
          chunkCount += result.chunks.length;
        }
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
      filenameRecords.push(...records);
      onBatch?.({ fileCount, contentFileCount, chunkCount });
      batch = [];
    };
    for await (const entry of entries) {
      batch.push(entry);
      if (batch.length >= BACKGROUND_BUILD_TRANSACTION_FILES) {
        commitBatch();
        await workSlicer.checkpoint();
      }
    }
    commitBatch();
    await workSlicer.checkpoint();
    this.database.exec('PRAGMA optimize');
    this.filenameTier.replace(filenameRecords);
    this.buildState.markReady({ ...identity, buildId });
    return { fileCount, contentFileCount, chunkCount, buildId };
  }

  runMutation(operation, withinTransaction = false) {
    if (withinTransaction) return operation();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  upsert(entry, { syncFilenameTier = true, withinTransaction = false } = {}) {
    const prepared = prepareEntry(entry);
    const nextChunks = prepared.contentIndexed
      ? splitContentDefinedChunks(prepared.originalContent)
      : [];
    const existing = this.selectFileByPath.get(prepared.relativePath);
    if (!existing) {
      const inserted = this.runMutation(
        () => this.insertPrepared(prepared, nextChunks),
        withinTransaction
      );
      if (syncFilenameTier) this.filenameTier.upsert(inserted.record);
      return { insertedChunkCount: nextChunks.length, retainedChunkCount: 0 };
    }
    const fileId = Number(existing.id);
    const previous = [...this.selectChunksByFile.iterate(fileId)];
    let prefix = 0;
    while (
      prefix < previous.length &&
      prefix < nextChunks.length &&
      previous[prefix].content_hash === nextChunks[prefix].hash
    )
      prefix += 1;
    let suffix = 0;
    while (
      suffix < previous.length - prefix &&
      suffix < nextChunks.length - prefix &&
      previous.at(-1 - suffix).content_hash === nextChunks.at(-1 - suffix).hash
    )
      suffix += 1;
    const retained = new Map();
    for (let index = 0; index < prefix; index += 1) retained.set(index, previous[index]);
    for (let offset = 0; offset < suffix; offset += 1) {
      retained.set(nextChunks.length - 1 - offset, previous.at(-1 - offset));
    }
    const retainedIds = new Set([...retained.values()].map((row) => Number(row.id)));
    this.runMutation(() => {
      this.updateFile.run(
        prepared.fileName,
        prepared.normalizedPath,
        prepared.normalizedTitle,
        prepared.mediaType,
        prepared.contentIndexed ? 1 : 0,
        prepared.inProject ? 1 : 0,
        prepared.size,
        prepared.modifiedMs,
        fileId
      );
      for (const row of previous) {
        const chunkId = Number(row.id);
        if (!retainedIds.has(chunkId)) {
          this.removeChunkIndex(chunkId);
          this.deleteChunkStatement.run(chunkId);
        }
      }
      for (const [ordinal, chunk] of nextChunks.entries()) {
        const row = retained.get(ordinal);
        if (!row) {
          this.insertChunkRows(fileId, [{ ...chunk, ordinal }]);
        } else if (chunkColumnsEqual(row, chunk)) {
          this.updateChunkOrdinal.run(ordinal, row.id);
        } else {
          this.removeChunkIndex(Number(row.id));
          this.updateChunk.run(
            ordinal,
            chunk.hash,
            chunk.text,
            chunk.leftContextText,
            chunk.rightOverlapText,
            chunk.normalizedSearchableText,
            chunk.normalizedCoreLength,
            row.id
          );
          this.replaceChunkIndex(Number(row.id), chunk.normalizedSearchableText);
        }
      }
    }, withinTransaction);
    if (syncFilenameTier) {
      this.filenameTier.upsert(prepareFilenameRecord(prepared, fileId));
    }
    return {
      previousChunkCount: previous.length,
      nextChunkCount: nextChunks.length,
      retainedChunkCount: retained.size,
      insertedChunkCount: nextChunks.length - retained.size,
      deletedChunkCount: previous.length - retained.size
    };
  }

  delete(relativePath, { syncFilenameTier = true, withinTransaction = false } = {}) {
    const existing = this.selectFileByPath.get(relativePath);
    if (!existing) return false;
    const fileId = Number(existing.id);
    this.runMutation(() => {
      for (const row of this.selectChunksByFile.iterate(fileId)) {
        this.removeChunkIndex(Number(row.id));
      }
      this.database.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);
      this.deleteFileStatement.run(fileId);
    }, withinTransaction);
    if (syncFilenameTier) this.filenameTier.delete(relativePath);
    return true;
  }

  async reconcile(entries, identity, { onBatch, workSlicer = createBackgroundWorkSlicer() } = {}) {
    const buildId = randomUUID();
    this.buildState.start({ ...identity, state: 'reconciling', buildId });
    const seen = new Set();
    let changed = 0;
    let changedBatch = [];
    const commitChangedBatch = () => {
      if (changedBatch.length === 0) return;
      this.runMutation(() => {
        for (const entry of changedBatch) {
          this.upsert(entry, { syncFilenameTier: false, withinTransaction: true });
        }
      });
      changed += changedBatch.length;
      changedBatch = [];
    };
    for await (const entry of entries) {
      seen.add(entry.relativePath);
      if (!entry.unchanged) changedBatch.push(entry);
      if (changedBatch.length >= BACKGROUND_BUILD_TRANSACTION_FILES) commitChangedBatch();
      if (seen.size % 50 === 0) onBatch?.({ fileCount: seen.size, changedFileCount: changed });
      await workSlicer.checkpoint();
    }
    commitChangedBatch();
    let deleted = 0;
    let deleteBatch = [];
    const commitDeleteBatch = () => {
      if (deleteBatch.length === 0) return;
      this.runMutation(() => {
        for (const relativePath of deleteBatch) {
          this.delete(relativePath, { syncFilenameTier: false, withinTransaction: true });
        }
      });
      deleted += deleteBatch.length;
      deleteBatch = [];
    };
    for (const relativePath of [...this.filenameTier.records.keys()]) {
      if (!seen.has(relativePath)) {
        deleteBatch.push(relativePath);
        if (deleteBatch.length >= BACKGROUND_BUILD_TRANSACTION_FILES) {
          commitDeleteBatch();
          await workSlicer.checkpoint();
        }
      }
    }
    commitDeleteBatch();
    this.database.exec('PRAGMA optimize');
    this.hydrateFilenameTier();
    this.buildState.markReady({ ...identity, buildId });
    return { fileCount: seen.size, changedFileCount: changed, deletedFileCount: deleted, buildId };
  }

  setTargetFiles(fileIds) {
    this.clearTargetFiles.run();
    for (const fileId of fileIds) this.insertTargetFile.run(fileId);
  }

  metadata(relativePath) {
    return this.filenameTier.get(relativePath);
  }

  scopePlan(scope) {
    return createSqliteScopePlan(scope);
  }

  candidateIterator(normalizedQuery, scopePlan, { restricted = false } = {}) {
    const length = [...normalizedQuery].length;
    if (length > 64) return { engine: 'exact-file-fallback', rows: undefined };
    if (isIndexedShortQuery(normalizedQuery)) {
      return {
        engine: 'cjk-postings',
        rows: restricted
          ? this.selectTargetPostingCandidates.iterate(normalizedQuery)
          : this.selectPostingCandidates[scopePlan.key].iterate(
              normalizedQuery,
              ...scopePlan.params
            )
      };
    }
    if (length <= 2) {
      return {
        engine: 'sqlite-instr-prefilter',
        rows: restricted
          ? this.selectTargetInstrCandidates.iterate(normalizedQuery)
          : this.selectInstrCandidates[scopePlan.key].iterate(normalizedQuery, ...scopePlan.params)
      };
    }
    return {
      engine: 'fts5-trigram',
      rows: restricted
        ? this.selectTargetFtsCandidates.iterate(ftsPhrase(normalizedQuery))
        : this.selectFtsCandidates[scopePlan.key].iterate(
            ftsPhrase(normalizedQuery),
            ...scopePlan.params
          )
    };
  }

  contentResult(candidate, normalizedQuery) {
    const matchIndex = candidate.normalized_searchable.indexOf(normalizedQuery);
    if (matchIndex < 0 || matchIndex >= Number(candidate.normalized_core_length)) return undefined;
    const source = `${candidate.left_context_text}${candidate.core_text}${candidate.right_overlap_text}`;
    const match = projectNormalizedMatchToSource(
      source,
      normalizedQuery,
      normalizeSearchText(candidate.left_context_text).length + matchIndex
    );
    if (!match) return undefined;
    return createOnlyPreviewSearchResult({
      fileName: candidate.file_name,
      relativePath: candidate.relative_path,
      mediaType: candidate.media_type,
      contentMatch: match
    });
  }

  async hasContentMatchOutsidePaths(
    normalizedQuery,
    scopePlan,
    excludedPaths,
    { isCancelled, yieldIfDue }
  ) {
    const { engine, rows } = this.candidateIterator(normalizedQuery, scopePlan);
    if (engine === 'exact-file-fallback') {
      for (const file of this.selectContentFiles[scopePlan.key].iterate(...scopePlan.params)) {
        await yieldIfDue();
        if (isCancelled()) return { matched: false, cancelled: true };
        if (excludedPaths.has(file.relative_path)) continue;
        const source = [...this.selectCoreTextByFile.iterate(file.id)]
          .map((row) => row.core_text)
          .join('');
        if (!normalizeSearchText(source).includes(normalizedQuery)) continue;
        if (createPlainTextSnippet(source, normalizedQuery)) {
          return { matched: true, cancelled: false };
        }
      }
      return { matched: false, cancelled: false };
    }
    for (const candidate of rows) {
      await yieldIfDue();
      if (isCancelled()) return { matched: false, cancelled: true };
      if (excludedPaths.has(candidate.relative_path)) continue;
      if (this.contentResult(candidate, normalizedQuery)) {
        return { matched: true, cancelled: false };
      }
    }
    return { matched: false, cancelled: false };
  }

  async search(
    queryValue,
    { maxResults = MAX_RESULTS, isCancelled = () => false, onResult, scope } = {}
  ) {
    const normalizedQuery = normalizeSearchText(queryValue);
    const cap = clampSearchResultLimit(maxResults);
    const scopePlan = createSqliteScopePlan(scope);
    if (!normalizedQuery || cap === 0) return { results: [], truncated: false, cancelled: false };
    const selected = new Map();
    const selectedTitleRecords = new Map();
    let truncated = false;
    let titleMatchCount = 0;
    let candidatesSinceYield = 0;
    let searchSliceStartedAt = performance.now();
    const yieldIfDue = async () => {
      candidatesSinceYield += 1;
      if (
        candidatesSinceYield < 128 &&
        performance.now() - searchSliceStartedAt < SEARCH_WORK_SLICE_MS
      )
        return;
      candidatesSinceYield = 0;
      await new Promise((resolveYield) => setImmediate(resolveYield));
      searchSliceStartedAt = performance.now();
    };
    for (const record of this.filenameTier.forScope(scope)) {
      await yieldIfDue();
      if (isCancelled()) return { results: [], truncated: false, cancelled: true };
      if (!record.inProject) continue;
      if (!record.normalizedTitle.includes(normalizedQuery)) continue;
      titleMatchCount += 1;
      if (selected.size < cap) {
        const result = createOnlyPreviewSearchResult({
          fileName: record.fileName,
          relativePath: record.relativePath,
          mediaType: record.mediaType,
          contentMatch: null
        });
        selected.set(record.relativePath, result);
        selectedTitleRecords.set(record.relativePath, record);
        onResult?.(result);
      } else truncated = true;
    }
    const selectedTextTitleRecords = [...selectedTitleRecords.values()].filter(
      ({ contentIndexed }) => contentIndexed
    );
    const titleCapFull = selected.size >= cap;
    let contentPlan = 'global-content';
    if (titleCapFull && selectedTextTitleRecords.length === 0) {
      contentPlan = 'skip-title-cap-no-content';
    } else if (titleCapFull) {
      contentPlan = 'selected-text-title-files';
      this.setTargetFiles(selectedTextTitleRecords.map(({ id }) => id));
    }
    const restricted = contentPlan === 'selected-text-title-files';
    const contentMatched = new Set();
    const { engine, rows } = this.candidateIterator(normalizedQuery, scopePlan, { restricted });
    if (contentPlan === 'skip-title-cap-no-content') {
      if (titleMatchCount === cap) {
        const probe = await this.hasContentMatchOutsidePaths(
          normalizedQuery,
          scopePlan,
          new Set(selected.keys()),
          { isCancelled, yieldIfDue }
        );
        if (probe.cancelled) return { results: [], truncated: false, cancelled: true };
        truncated = probe.matched;
      }
      return {
        results: [...selected.values()],
        truncated,
        cancelled: false,
        engine,
        contentPlan,
        titleMatchCount,
        selectedTextTitleCount: 0
      };
    }
    if (engine === 'exact-file-fallback') {
      const files = restricted
        ? this.selectTargetContentFiles.iterate()
        : this.selectContentFiles[scopePlan.key].iterate(...scopePlan.params);
      for (const file of files) {
        await yieldIfDue();
        if (isCancelled()) return { results: [], truncated: false, cancelled: true };
        const source = [...this.selectCoreTextByFile.iterate(file.id)]
          .map((row) => row.core_text)
          .join('');
        if (!normalizeSearchText(source).includes(normalizedQuery)) continue;
        const contentMatch = createPlainTextSnippet(source, normalizedQuery);
        if (!contentMatch) continue;
        contentMatched.add(file.relative_path);
        const result = createOnlyPreviewSearchResult({
          fileName: file.file_name,
          relativePath: file.relative_path,
          mediaType: file.media_type,
          contentMatch
        });
        if (selected.has(result.relativePath) || selected.size < cap) {
          selected.set(result.relativePath, result);
          onResult?.(result);
        } else truncated = true;
      }
    } else {
      for (const candidate of rows) {
        await yieldIfDue();
        if (isCancelled()) return { results: [], truncated: false, cancelled: true };
        if (contentMatched.has(candidate.relative_path)) continue;
        const result = this.contentResult(candidate, normalizedQuery);
        if (!result) continue;
        contentMatched.add(result.relativePath);
        if (selected.has(result.relativePath) || selected.size < cap) {
          selected.set(result.relativePath, result);
          onResult?.(result);
        } else truncated = true;
      }
    }
    if (restricted && titleMatchCount === cap) {
      const probe = await this.hasContentMatchOutsidePaths(
        normalizedQuery,
        scopePlan,
        new Set(selectedTitleRecords.keys()),
        { isCancelled, yieldIfDue }
      );
      if (probe.cancelled) return { results: [], truncated: false, cancelled: true };
      truncated = probe.matched;
    }
    return {
      results: [...selected.values()],
      truncated,
      cancelled: false,
      engine,
      contentPlan,
      titleMatchCount,
      selectedTextTitleCount: selectedTextTitleRecords.length
    };
  }

  async searchContents(queryValue, options = {}) {
    return await searchOnlyPreviewIndexedContents(this, queryValue, options);
  }

  async diskBytes() {
    if (this.databasePath === ':memory:') return 0;
    let total = 0;
    for (const path of [
      this.databasePath,
      `${this.databasePath}-wal`,
      `${this.databasePath}-shm`
    ]) {
      try {
        total += (await stat(path)).size;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return total;
  }

  statistics() {
    return { ...this.filenameTier.statistics(), buildState: this.buildState.read() };
  }

  close() {
    this.database.close();
  }
}
