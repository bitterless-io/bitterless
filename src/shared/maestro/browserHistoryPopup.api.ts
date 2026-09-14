import type { BrowserHistoryEntry } from './browserHistory.api';
import type { ViewRect } from './coach.api';

export const BROWSER_HISTORY_STATE_EVENT = 'coach/history-state';
export const BROWSER_HISTORY_FOCUS_EVENT = 'coach/history-focus-address';

export interface BrowserHistoryPopupSnapshot {
  revision: number;
  sessionId: string | null;
  dismissedSessionId?: string;
  query: string;
  entries: BrowserHistoryEntry[];
  selectedIndex: number;
  loading: boolean;
  error: boolean;
}

export interface BrowserHistoryPopupRequest {
  sessionId: string;
  requestId: number;
  tabId: string;
  query: string;
  anchor: ViewRect;
}

export interface BrowserHistoryPopupApi {
  show(params: BrowserHistoryPopupRequest): Promise<void>;
  hide(params: { sessionId: string }): Promise<void>;
  addressBlur(params: { sessionId: string }): Promise<void>;
  snapshot(): Promise<BrowserHistoryPopupSnapshot>;
  mounted(params: { token: string }): Promise<void>;
  action(params: {
    sessionId: string;
    action: 'previous' | 'next' | 'accept' | 'remove' | 'retry' | 'close' | 'focus';
    url?: string;
  }): Promise<void>;
}
