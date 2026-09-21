import { googleSearchUrl } from '@maestro-shared/browserAddress.service';
import { browserHistoryError, browserHistoryLog } from '@maestro-shared/browserHistoryDiagnostics.service';
import { reactive } from 'vue';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import { BROWSER_HISTORY_STATE_EVENT, type BrowserHistoryPopupAction, type BrowserHistoryPopupApi, type BrowserHistoryPopupSnapshot } from '@maestro-shared/browserHistoryPopup.api';

const popup = createXpcRendererEmitter<BrowserHistoryPopupApi>('BrowserHistoryPopupHandler');
const emptySnapshot = (): BrowserHistoryPopupSnapshot => ({ session: 0, revision: 0, tabId: '', anchor: { x: 0, y: 0, width: 0, height: 0 }, query: '', entries: [], selectedIndex: -1, loading: false, error: false });

class HistoryState {
  snapshot = emptySnapshot();
  failedIcons = new Set<string>();
  private sequence = 0;
  get googleUrl(): string { return googleSearchUrl(this.snapshot.query); }
  historySelected(index: number): boolean { return this.snapshot.selectedIndex === index + (this.googleUrl ? 1 : 0); }

  async init(): Promise<void> {
    xpcRenderer.subscribe(BROWSER_HISTORY_STATE_EVENT, () => void this.refresh());
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    browserHistoryLog('renderer.snapshot.request', { sequence });
    try {
      const snapshot = await popup.snapshot();
      if (sequence === this.sequence) this.receive(snapshot);
    } catch (error) {
      browserHistoryLog('renderer.snapshot.failure', browserHistoryError(error));
      if (sequence === this.sequence) this.receive(null);
    }
  }

  receive(snapshot: BrowserHistoryPopupSnapshot | null): void {
    browserHistoryLog('renderer.snapshot.receive', { hasSnapshot: Boolean(snapshot), revision: snapshot?.revision, resultCount: snapshot?.entries.length });
    if (snapshot?.session !== this.snapshot.session) this.failedIcons.clear();
    this.snapshot = snapshot ?? emptySnapshot();
  }

  iconFailed(url: string): void { this.failedIcons.add(url); }
  displayUrl(url: string): string {
    try { return decodeURI(url).replace(/^https?:\/\//i, ''); }
    catch { return url.replace(/^https?:\/\//i, ''); }
  }

  async action(
    action: Parameters<BrowserHistoryPopupApi['action']>[0]['action'],
    url?: string,
    row?: BrowserHistoryPopupAction['row'],
  ): Promise<void> {
    const { session, revision } = this.snapshot;
    if (session) await popup.action({ session, revision, action, url, ...(row ? { row } : {}) });
  }

  keydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && event.target instanceof Element && event.target.closest('button')) return;
    const action = { ArrowDown: 'next', ArrowUp: 'previous', Enter: 'accept', Escape: 'close' }[event.key];
    if (action) {
      event.preventDefault(); void this.action(action as Parameters<BrowserHistoryPopupApi['action']>[0]['action']);
    } else if (event.key === 'Tab') { void this.action('close'); }
  }
}

export const historyStore = reactive(new HistoryState());
