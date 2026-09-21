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
  /**
   * 被点中的是**哪一类行**。`accept` 的两类行(Google 候选 / 历史记录)走不同的打开路径
   * (history-row-opens-background-tab.md #3.1 / #3.3),而**光凭 URL 分不开它们**:
   * 搜过一次 `cats`,结果页就被记进 browser_history;下次再输 `cats`,
   * `candidateUrls = [googleUrl, ...entries]` 里两项是同一个字符串。
   *
   * 鼠标点行时由弹窗填(它知道自己渲染的是哪一行);键盘回车没有这个字段,由 home 侧按
   * `selectedIndex` 推。Cowork 侧靠 `type: 'choose' | 'search'` 天然带着这个身份。
   */
  row?: 'google' | 'history';
}

export interface BrowserHistoryPopupApi {
  update(params: BrowserHistoryPopupSnapshot): Promise<boolean>;
  hide(params: { session: number }): Promise<void>;
  blur(): Promise<void>;
  snapshot(): Promise<BrowserHistoryPopupSnapshot | null>;
  action(params: BrowserHistoryPopupAction): Promise<void>;
}
