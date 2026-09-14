export interface BrowserHistoryEntry {
  url: string;
  title: string;
  favicon: string;
  visitCount: number;
  lastVisitedAt: number;
}

export interface BrowserHistoryVisit {
  url: string;
  title?: string;
  favicon?: string;
}

export interface BrowserHistoryApi {
  record(params: BrowserHistoryVisit): Promise<void>;
  updateMetadata(params: BrowserHistoryVisit): Promise<void>;
  search(params: { query: string }): Promise<BrowserHistoryEntry[]>;
  remove(params: { url: string }): Promise<void>;
}
