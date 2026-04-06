export class SearchEngineDao {
  getSearchEngine(): string {
    const engine = localStorage.getItem('searchEngine');
    if (engine) {
      return engine;
    }
    return 'baidu';
  }

  setSearchEngine(engine: string): void {
    localStorage.setItem('searchEngine', engine);
  }
}

export const searchEngineDao = new SearchEngineDao();
