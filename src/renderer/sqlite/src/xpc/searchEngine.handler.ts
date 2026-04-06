import { XpcRendererHandler } from 'electron-xpc/renderer';
import { searchEngineDao } from './searchEngine.dao';

export class SearchEngineHandler extends XpcRendererHandler {
  async getSearchEngine(): Promise<string> {
    return searchEngineDao.getSearchEngine();
  }

  async setSearchEngine(params: { engine: string }): Promise<void> {
    searchEngineDao.setSearchEngine(params.engine);
  }
}

export const searchEngineHandler = new SearchEngineHandler();
