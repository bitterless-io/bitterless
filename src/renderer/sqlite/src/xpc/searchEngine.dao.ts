export class SearchEngineDao {
  getSearchEngine(): string {
    const engine = localStorage.getItem('searchEngine');
    if (engine) {
      return engine;
    }
    
    const defaultEngine = 'baidu';
    localStorage.setItem('searchEngine', defaultEngine);
    return defaultEngine;
  }

  setSearchEngine(engine: string): void {
    localStorage.setItem('searchEngine', engine);
  }
}

export const searchEngineDao = new SearchEngineDao();
