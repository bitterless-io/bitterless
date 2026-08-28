import { dirname } from 'node:path';

import { mediaTypeToPreviewHint } from './classification.mjs';

const filenameRecordFromRow = (row) => ({
  id: Number(row.id),
  relativePath: row.relative_path,
  fileName: row.file_name,
  normalizedPath: row.normalized_path,
  normalizedTitle: row.normalized_title,
  mediaType: row.media_type,
  contentIndexed: row.content_indexed === 1,
  inProject: row.in_project === 1,
  size: Number(row.size),
  modifiedMs: Number(row.modified_ms)
});

const filenameRecordToTreeEntry = (record) => {
  const parent = dirname(record.relativePath).replaceAll('\\', '/');
  return {
    relativePath: record.relativePath,
    parentRelativePath: parent === '.' ? '' : parent,
    name: record.fileName,
    nodeKind: 'file',
    size: record.size,
    modifiedAt: record.modifiedMs,
    previewHint: mediaTypeToPreviewHint(record.mediaType),
    mediaType: record.mediaType,
    isText: record.mediaType === 'text'
  };
};

const runTreeEntry = (statement, entry) =>
  statement.run(
    entry.relativePath,
    entry.parentRelativePath,
    entry.name,
    entry.nodeKind,
    entry.size,
    entry.modifiedAt,
    entry.previewHint,
    entry.mediaType,
    entry.isText ? 1 : 0
  );

export class OnlyPreviewSqliteSnapshotStore {
  constructor({ database, buildState, filenameTier }) {
    this.database = database;
    this.buildState = buildState;
    this.filenameTier = filenameTier;
    this.selectAllFiles = database.prepare(`
      SELECT id, relative_path, file_name, normalized_path, normalized_title,
             media_type, content_indexed, in_project, size, modified_ms
      FROM files ORDER BY relative_path
    `);
    this.selectFileByPath = database.prepare('SELECT * FROM files WHERE relative_path = ?');
    this.selectIndexMeta = database.prepare('SELECT value FROM index_meta WHERE key = ?');
    this.upsertIndexMeta = database.prepare(`
      INSERT INTO index_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    this.selectSearchTree = database.prepare(`
      SELECT relative_path, parent_relative_path, name, node_kind, size, modified_ms,
             preview_hint, media_type, is_text
      FROM search_tree ORDER BY relative_path
    `);
    this.insertSearchTree = database.prepare(`
      INSERT INTO search_tree(relative_path, parent_relative_path, name, node_kind, size,
        modified_ms, preview_hint, media_type, is_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.upsertSearchTree = database.prepare(`
      INSERT INTO search_tree(relative_path, parent_relative_path, name, node_kind, size,
        modified_ms, preview_hint, media_type, is_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        parent_relative_path = excluded.parent_relative_path, name = excluded.name,
        node_kind = excluded.node_kind, size = excluded.size, modified_ms = excluded.modified_ms,
        preview_hint = excluded.preview_hint, media_type = excluded.media_type,
        is_text = excluded.is_text
    `);
    this.deleteSearchTreePath = database.prepare(`
      DELETE FROM search_tree
      WHERE relative_path = ? OR (relative_path >= ? AND relative_path < ?)
    `);
  }

  hydrateFilenameTier() {
    this.filenameTier.replace([...this.selectAllFiles.iterate()].map(filenameRecordFromRow));
  }

  applyFilenameTierMutations({ upsertPaths, deletePaths }) {
    const upserts = [];
    for (const relativePath of new Set(upsertPaths)) {
      const row = this.selectFileByPath.get(relativePath);
      if (!row) throw new TypeError('Indexed filename mutation is missing');
      upserts.push(filenameRecordFromRow(row));
    }
    this.filenameTier.applyBatch({ upserts, deletePaths: [...new Set(deletePaths)] });
  }

  readTreeSnapshot() {
    const buildState = this.buildState.read();
    const treeState = this.selectIndexMeta.get('tree_state')?.value ?? 'missing';
    const treeBuildId = this.selectIndexMeta.get('tree_build_id')?.value ?? '';
    const maxDepthMarker = this.selectIndexMeta.get('tree_max_depth_reached')?.value;
    const treeMetadataReady =
      buildState.state === 'ready' &&
      Boolean(buildState.buildId) &&
      treeState === 'ready' &&
      treeBuildId === buildState.buildId &&
      (maxDepthMarker === '0' || maxDepthMarker === '1');
    const entries = this.filenameTier
      .visible()
      .filter(({ inProject }) => inProject)
      .map(filenameRecordToTreeEntry);
    if (treeMetadataReady) {
      for (const row of this.selectSearchTree.iterate()) {
        entries.push({
          relativePath: row.relative_path,
          parentRelativePath: row.parent_relative_path,
          name: row.name,
          nodeKind: row.node_kind,
          size: Number(row.size),
          modifiedAt: Number(row.modified_ms),
          previewHint: row.preview_hint,
          mediaType: row.media_type,
          isText: row.is_text === 1
        });
      }
    }
    return {
      entries,
      maxDepthReached: treeMetadataReady && maxDepthMarker === '1',
      treeMetadataReady,
      buildId: buildState.buildId
    };
  }

  invalidateTreeSnapshot() {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.upsertIndexMeta.run('tree_state', 'invalid');
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  assertReadyBuild() {
    const buildState = this.buildState.read();
    if (buildState.state !== 'ready' || !buildState.buildId) {
      throw new TypeError('Search tree requires a ready content build');
    }
    return buildState;
  }

  commitTreeMetadata(buildId, maxDepthReached) {
    this.upsertIndexMeta.run('tree_build_id', buildId);
    this.upsertIndexMeta.run('tree_max_depth_reached', maxDepthReached ? '1' : '0');
    this.upsertIndexMeta.run('tree_state', 'ready');
  }

  replaceTreeSnapshot(entries, maxDepthReached) {
    const buildState = this.assertReadyBuild();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM search_tree').run();
      for (const entry of entries) {
        if (entry.nodeKind === 'file') continue;
        if (entry.nodeKind !== 'directory' && entry.nodeKind !== 'symlink') {
          throw new TypeError('Invalid persisted Search tree node');
        }
        runTreeEntry(this.insertSearchTree, entry);
      }
      this.commitTreeMetadata(buildState.buildId, maxDepthReached);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { buildId: buildState.buildId, treeMetadataReady: true };
  }

  applyTreeSnapshotMutations({ upserts, removedPaths, maxDepthReached }) {
    const buildState = this.assertReadyBuild();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const relativePath of removedPaths) {
        const prefix = `${relativePath}/`;
        this.deleteSearchTreePath.run(relativePath, prefix, `${relativePath}0`);
      }
      for (const entry of upserts) {
        if (entry.nodeKind !== 'directory' && entry.nodeKind !== 'symlink') {
          throw new TypeError('Invalid persisted Search tree node');
        }
        runTreeEntry(this.upsertSearchTree, entry);
      }
      this.commitTreeMetadata(buildState.buildId, maxDepthReached);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { buildId: buildState.buildId, treeMetadataReady: true };
  }
}
