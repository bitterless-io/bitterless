import { XpcPreloadHandler } from 'electron-xpc/preload';
import { searchEngineDao } from '../dao/searchEngine.dao';

export class SearchEngineHandler extends XpcPreloadHandler {
  async getSearchEngine(): Promise<string> {
    return searchEngineDao.getSearchEngine();
  }

  async setSearchEngine(params: { engine: string }): Promise<void> {
    searchEngineDao.setSearchEngine(params.engine);
  }
}

export const searchEngineHandler = new SearchEngineHandler();
