import { XpcPreloadHandler } from 'electron-xpc/preload';
import type {
  BrowserHistoryApi,
  BrowserHistoryEntry,
  BrowserHistoryVisit
} from '@maestro-shared/browserHistory.api';
import { BrowserHistoryRepository } from './browserHistory.repository';
import { sqliteManager } from './sqliteManager';

export class BrowserHistoryDao extends XpcPreloadHandler implements BrowserHistoryApi {
  async record(params: BrowserHistoryVisit): Promise<void> {
    new BrowserHistoryRepository(sqliteManager.db).record(params);
  }

  async updateMetadata(params: BrowserHistoryVisit): Promise<void> {
    new BrowserHistoryRepository(sqliteManager.db).updateMetadata(params);
  }

  async search(params: { query: string }): Promise<BrowserHistoryEntry[]> {
    return new BrowserHistoryRepository(sqliteManager.db).search(params);
  }

  async remove(params: { url: string }): Promise<void> {
    new BrowserHistoryRepository(sqliteManager.db).remove(params);
  }
}
