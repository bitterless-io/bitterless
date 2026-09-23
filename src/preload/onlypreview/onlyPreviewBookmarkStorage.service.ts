import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OnlyPreviewContractError, normalizeOnlyPreviewRelativePath, parseOnlyPreviewBookmarkOrder } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewBookmarkState,
  OnlyPreviewBookmarkStorageResult,
  OnlyPreviewBookmarkStorageRequest,
  OnlyPreviewStoredBookmark
} from '@shared/onlypreview/onlyPreviewBookmarkStorage.type';

const invalid = (): never => { throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Bookmarks storage is invalid.'); };
const entriesFrom = (value: unknown): OnlyPreviewStoredBookmark[] => {
  if (!Array.isArray(value) || value.length > 1000) return invalid();
  const seen = new Set<string>();
  return value.map((item) => {
    const relativePath = normalizeOnlyPreviewRelativePath(item?.relativePath);
    if (item.nodeKind !== 'file' && item.nodeKind !== 'directory') return invalid();
    return { relativePath, nodeKind: item.nodeKind } as OnlyPreviewStoredBookmark;
  }).filter(({ relativePath }) => {
    if (seen.has(relativePath)) return false;
    seen.add(relativePath); return true;
  });
};

export class OnlyPreviewBookmarkStorageService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly userDataPath: string,
    private readonly readLegacy: (projectKey: string) => Promise<unknown>
  ) {}

  execute(request: OnlyPreviewBookmarkStorageRequest): Promise<OnlyPreviewBookmarkStorageResult> {
    const task = this.queue.then(() => this.run(request));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async run(request: OnlyPreviewBookmarkStorageRequest): Promise<OnlyPreviewBookmarkStorageResult> {
    if (!request || typeof request.rootRealPath !== 'string' || !isAbsolute(request.rootRealPath)) return invalid();
    if (!['snapshot', 'add', 'remove', 'reorder'].includes(request.action)) return invalid();
    const add = request.action === 'add' ? entriesFrom([request.entry])[0] : null;
    const remove = request.action === 'remove'
      ? normalizeOnlyPreviewRelativePath(request.relativePath) : null;
    const order = request.action === 'reorder' ? parseOnlyPreviewBookmarkOrder(request.relativePaths) : null;
    const projectKey = createHash('sha256').update(request.rootRealPath).digest('hex');
    const directory = join(this.userDataPath, 'onlypreview', 'project-state');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(join(directory, `${projectKey}.sqlite`));
    try {
      db.exec('PRAGMA busy_timeout=1000; PRAGMA synchronous=FULL;');
      db.exec('CREATE TABLE IF NOT EXISTS bookmarks (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, revision INTEGER NOT NULL, entries TEXT NOT NULL)');
      const read = (): OnlyPreviewBookmarkState | null => {
        const row = db.prepare('SELECT version, revision, entries FROM bookmarks WHERE id=1').get();
        if (!row) return null;
        if (row.version !== 1 || !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || typeof row.entries !== 'string') return invalid();
        return { revision: Number(row.revision), entries: entriesFrom(JSON.parse(row.entries)) };
      };
      let legacy: OnlyPreviewStoredBookmark[] = [];
      if (!read()) {
        const value = await this.readLegacy(projectKey) as { version?: unknown; entries?: unknown } | null;
        if (value !== null) {
          if (value?.version !== 1) return invalid();
          legacy = entriesFrom(value.entries);
        }
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        let state = read();
        if (!state) {
          state = { revision: 0, entries: legacy };
          db.prepare('INSERT INTO bookmarks VALUES (1, 1, ?, ?)').run(0, JSON.stringify(legacy));
        }
        let entries = state.entries;
        if (add && !entries.some((entry) => entry.relativePath === add.relativePath)) entries = [...entries, add];
        if (remove) entries = entries.filter((entry) => entry.relativePath !== remove);
        if (order) {
          const byPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
          if (order.length !== entries.length || order.some((path) => !byPath.has(path))) {
            throw new OnlyPreviewContractError('INVALID_INPUT', 'Bookmarks changed. Refresh and retry the reorder.');
          }
          entries = order.map((path) => byPath.get(path)!);
        }
        if (entries.length > 1000) throw new OnlyPreviewContractError('OPERATION_FAILED', 'The Project bookmark limit was reached.');
        const changed = JSON.stringify(entries) !== JSON.stringify(state.entries);
        if (changed) {
          state = { revision: state.revision + 1, entries };
          db.prepare('UPDATE bookmarks SET revision=?, entries=? WHERE id=1').run(state.revision, JSON.stringify(entries));
        }
        db.exec('COMMIT');
        return request.action === 'reorder' ? { ...state, changed } : state;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db.close();
    }
  }
}
