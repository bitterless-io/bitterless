import { browserHistoryError, browserHistoryLog } from '@maestro-shared/browserHistoryDiagnostics.service';
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
    browserHistoryLog('dao.record.begin');
    try {
      new BrowserHistoryRepository(sqliteManager.db).record(params);
    } catch (error) {
      browserHistoryLog('dao.record.failure', browserHistoryError(error));
      throw error;
    }
  }

  async updateMetadata(params: BrowserHistoryVisit): Promise<void> {
    browserHistoryLog('dao.updateMetadata.begin');
    try {
      new BrowserHistoryRepository(sqliteManager.db).updateMetadata(params);
    } catch (error) {
      browserHistoryLog('dao.updateMetadata.failure', browserHistoryError(error));
      throw error;
    }
  }

  async search(params: { query: string }): Promise<BrowserHistoryEntry[]> {
    browserHistoryLog('dao.search.begin');
    try {
      return new BrowserHistoryRepository(sqliteManager.db).search(params);
    } catch (error) {
      browserHistoryLog('dao.search.failure', browserHistoryError(error));
      throw error;
    }
  }

  async remove(params: { url: string }): Promise<void> {
    browserHistoryLog('dao.remove.begin');
    try {
      new BrowserHistoryRepository(sqliteManager.db).remove(params);
    } catch (error) {
      browserHistoryLog('dao.remove.failure', browserHistoryError(error));
      throw error;
    }
  }
}
