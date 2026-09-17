import { browserHistoryLog } from '@maestro-shared/browserHistoryDiagnostics.service';
import type Database from 'better-sqlite3-multiple-ciphers';
import type { BrowserHistoryEntry, BrowserHistoryVisit } from '@maestro-shared/browserHistory.api';
import {
  BROWSER_HISTORY_LIMIT,
  normalizeBrowserHistoryFavicon,
  normalizeBrowserHistoryUrl,
  searchBrowserHistoryEntries
} from '@maestro-shared/browserHistory.service';

export class BrowserHistoryRepository {
  constructor(private readonly db: Database.Database) {}

  record(params: BrowserHistoryVisit): void {
    const url = normalizeBrowserHistoryUrl(params.url);
    if (!url) { browserHistoryLog('sql.record.skipped', { reason: 'non-web-url' }); return; }
    browserHistoryLog('sql.record.begin');
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO browser_history (url, title, favicon, visit_count, last_visited_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(url) DO UPDATE SET
          title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE browser_history.title END,
          favicon = CASE WHEN excluded.favicon <> '' THEN excluded.favicon ELSE browser_history.favicon END,
          visit_count = browser_history.visit_count + 1,
          last_visited_at = excluded.last_visited_at
      `).run(url, params.title?.trim().slice(0, 2048) ?? '', normalizeBrowserHistoryFavicon(params.favicon), Date.now());
      this.db.prepare(`
        DELETE FROM browser_history WHERE url IN (
          SELECT url FROM browser_history
          ORDER BY last_visited_at DESC, visit_count DESC, url ASC
          LIMIT -1 OFFSET ?
        )
      `).run(BROWSER_HISTORY_LIMIT);
    })();
    browserHistoryLog('sql.record.committed');
  }

  updateMetadata(params: BrowserHistoryVisit): void {
    const url = normalizeBrowserHistoryUrl(params.url);
    if (!url) { browserHistoryLog('sql.metadata.skipped', { reason: 'non-web-url' }); return; }
    browserHistoryLog('sql.metadata.begin');
    const title = params.title?.trim().slice(0, 2048) ?? '';
    const favicon = normalizeBrowserHistoryFavicon(params.favicon);
    const result = this.db.prepare(`
      UPDATE browser_history SET
        title = CASE WHEN ? <> '' THEN ? ELSE title END,
        favicon = CASE WHEN ? <> '' THEN ? ELSE favicon END
      WHERE url = ?
    `).run(title, title, favicon, favicon, url);
    browserHistoryLog('sql.metadata.success', { changes: Number(result.changes) });
  }

  search(params: { query: string }): BrowserHistoryEntry[] {
    browserHistoryLog('sql.search.begin');
    const rows = this.db.prepare(`
      SELECT url, title, favicon, visit_count AS visitCount, last_visited_at AS lastVisitedAt
      FROM browser_history
    `).all() as BrowserHistoryEntry[];
    browserHistoryLog('sql.search.read', { rows: rows.length });
    const matches = searchBrowserHistoryEntries(rows, params.query);
    browserHistoryLog('sql.search.result', { rows: rows.length, matches: matches.length });
    return matches;
  }

  remove(params: { url: string }): void {
    const url = normalizeBrowserHistoryUrl(params.url);
    if (!url) { browserHistoryLog('sql.remove.skipped', { reason: 'non-web-url' }); return; }
    browserHistoryLog('sql.remove.begin');
    const result = this.db.prepare('DELETE FROM browser_history WHERE url = ?').run(url);
    browserHistoryLog('sql.remove.success', { changes: Number(result.changes) });
  }
}
