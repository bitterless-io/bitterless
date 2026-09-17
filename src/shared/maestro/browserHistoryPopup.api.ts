import type { BrowserHistoryEntry } from './browserHistory.api';
import type { ViewRect } from './coach.api';

export const BROWSER_HISTORY_STATE_EVENT = 'coach/history-state';
export const BROWSER_HISTORY_ACTION_EVENT = 'coach/history-action';
export const BROWSER_HISTORY_CLOSED_EVENT = 'coach/history-closed';

export interface BrowserHistoryPopupSnapshot {
  session: number;
  revision: number;
  tabId: string;
  anchor: ViewRect;
  query: string;
  entries: BrowserHistoryEntry[];
  selectedIndex: number;
  loading: boolean;
  error: boolean;
}

export interface BrowserHistoryPopupAction {
  session: number;
  revision: number;
  action: 'previous' | 'next' | 'accept' | 'remove' | 'retry' | 'close';
  url?: string;
}

export interface BrowserHistoryPopupApi {
  update(params: BrowserHistoryPopupSnapshot): Promise<boolean>;
  hide(params: { session: number }): Promise<void>;
  blur(): Promise<void>;
  snapshot(): Promise<BrowserHistoryPopupSnapshot | null>;
  action(params: BrowserHistoryPopupAction): Promise<void>;
}
