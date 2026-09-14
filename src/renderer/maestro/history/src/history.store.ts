import { googleSearchUrl } from '@maestro-shared/browserAddress.service';
import { reactive } from 'vue';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import { BROWSER_HISTORY_STATE_EVENT, type BrowserHistoryPopupApi, type BrowserHistoryPopupSnapshot } from '@maestro-shared/browserHistoryPopup.api';

const popup = createXpcRendererEmitter<BrowserHistoryPopupApi>('BrowserHistoryPopupHandler');

class HistoryState {
  snapshot: BrowserHistoryPopupSnapshot = { revision: -1, sessionId: null, query: '', entries: [], selectedIndex: -1, loading: false, error: false };
  failedIcons = new Set<string>();
  get googleUrl(): string { return googleSearchUrl(this.snapshot.query); }
  historySelected(index: number): boolean { return this.snapshot.selectedIndex === index + (this.googleUrl ? 1 : 0); }

  async init(): Promise<void> {
    xpcRenderer.subscribe(BROWSER_HISTORY_STATE_EVENT, (payload) => this.receive(payload.params as BrowserHistoryPopupSnapshot));
    this.receive(await popup.snapshot());
  }

  receive(snapshot: BrowserHistoryPopupSnapshot): void {
    if (snapshot.revision <= this.snapshot.revision) return;
    if (snapshot.sessionId !== this.snapshot.sessionId) this.failedIcons.clear();
    this.snapshot = snapshot;
  }

  async mounted(): Promise<void> { await popup.mounted({ token: new URLSearchParams(location.search).get('historyToken') ?? '' }); }

  iconFailed(url: string): void { this.failedIcons.add(url); }

  displayUrl(url: string): string {
    try { return decodeURI(url).replace(/^https?:\/\//i, ''); }
    catch { return url.replace(/^https?:\/\//i, ''); }
  }

  async action(action: Parameters<BrowserHistoryPopupApi['action']>[0]['action'], url?: string): Promise<void> {
    const sessionId = this.snapshot.sessionId;
    if (sessionId) await popup.action({ sessionId, action, url });
  }

  keydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && event.target instanceof Element && event.target.closest('button')) return;
    const action = { ArrowDown: 'next', ArrowUp: 'previous', Enter: 'accept', Escape: 'close' }[event.key];
    if (action) {
      event.preventDefault();
      void this.action(action as Parameters<BrowserHistoryPopupApi['action']>[0]['action']);
    } else if (event.key === 'Tab') {
      void this.action('close');
    }
  }
}

export const historyStore = reactive(new HistoryState());
