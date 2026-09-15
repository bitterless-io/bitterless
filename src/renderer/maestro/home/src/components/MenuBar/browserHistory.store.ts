import { googleSearchUrl } from '@maestro-shared/browserAddress.service';
import { nextTick, reactive } from 'vue';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import {
  BROWSER_HISTORY_FOCUS_EVENT,
  BROWSER_HISTORY_STATE_EVENT,
  type BrowserHistoryPopupApi,
  type BrowserHistoryPopupSnapshot,
} from '@maestro-shared/browserHistoryPopup.api';
import type { BrowserHistoryEntry } from '@maestro-shared/browserHistory.api';

const popup = createXpcRendererEmitter<BrowserHistoryPopupApi>('BrowserHistoryPopupHandler');

class BrowserHistoryState {
  open = false;
  entries: BrowserHistoryEntry[] = [];
  selectedIndex = -1;
  loading = false;
  error = false;
  composing = false;
  get candidateUrls(): string[] {
    const google = googleSearchUrl(this.query);
    return [...(google ? [google] : []), ...this.entries.map((entry) => entry.url)];
  }
  private input: HTMLInputElement | null = null;
  private activeTabId = '';
  private sessionId = '';
  private requestId = 0;
  private query = '';
  private revision = -1;
  private focusSuppressed = false;
  private subscribed = false;
  private disposeListeners: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;

  bind(input: HTMLInputElement | null): void {
    this.dispose();
    this.input = input;
    if (!input) return;
    if (!this.subscribed) {
      this.subscribed = true;
      xpcRenderer.subscribe(BROWSER_HISTORY_STATE_EVENT, (payload) => this.receive(payload.params as BrowserHistoryPopupSnapshot));
      xpcRenderer.subscribe(BROWSER_HISTORY_FOCUS_EVENT, () => void this.focusInput());
    }
    const outside = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && (target === this.input || target.closest('[name="browser-history-toggle"]'))) return;
      this.hide();
    };
    const resize = (): void => { if (this.open) void this.publish(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', resize);
    this.disposeListeners.push(() => document.removeEventListener('pointerdown', outside, true), () => window.removeEventListener('resize', resize));
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(input);
  }

  dispose(): void {
    this.hide();
    for (const dispose of this.disposeListeners.splice(0)) dispose();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.input = null;
  }

  setActiveTab(id: string): void {
    if (id !== this.activeTabId) this.hide();
    this.activeTabId = id;
  }

  focus(): void {
    if (this.focusSuppressed || !this.input || this.input.disabled) return;
    this.inputChanged();
  }

  inputChanged(): void {
    const query = this.input?.value ?? '';
    if (!query.trim()) { this.hide(); return; }
    if (this.composing) return;
    this.show(query);
  }

  compositionStart(): void {
    this.composing = true;
    this.selectedIndex = -1;
    this.entries = [];
  }

  compositionEnd(): void {
    this.composing = false;
    this.inputChanged();
  }

  toggle(): void {
    if (this.open) { this.hide(); return; }
    void this.focusInput();
    this.show('');
  }

  blur(): void {
    if (this.open) void popup.addressBlur({ sessionId: this.sessionId }).catch(() => this.hide());
  }

  private show(query: string): void {
    if (!this.input || !this.activeTabId) return;
    if (!this.open) this.sessionId = crypto.randomUUID();
    if (!this.open || query !== this.query) {
      this.entries = [];
      this.selectedIndex = -1;
      this.loading = true;
    }
    this.open = true;
    this.query = query;
    this.error = false;
    void this.publish();
  }

  private async publish(): Promise<void> {
    if (!this.open || !this.input) return;
    const sessionId = this.sessionId;
    const requestId = ++this.requestId;
    const rect = this.input.getBoundingClientRect();
    try {
      await popup.show({ sessionId, requestId, tabId: this.activeTabId, query: this.query, anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    } catch {
      if (sessionId !== this.sessionId || requestId !== this.requestId || !this.open) return;
      this.hide();
      this.error = true;
    }
  }

  hide(): void {
    const sessionId = this.sessionId;
    this.open = false;
    this.entries = [];
    this.selectedIndex = -1;
    this.loading = false;
    this.sessionId = '';
    if (sessionId) void popup.hide({ sessionId }).catch(() => undefined);
  }

  receive(snapshot: BrowserHistoryPopupSnapshot): void {
    if (snapshot.revision <= this.revision) return;
    this.revision = snapshot.revision;
    if (!this.open) return;
    if (snapshot.sessionId === null && snapshot.dismissedSessionId === this.sessionId) {
      // A native dismissal closes the currently displayed interaction, including pending reads.
      this.hide();
      return;
    }
    if (snapshot.sessionId !== this.sessionId || snapshot.query !== this.query) return;
    this.entries = snapshot.entries;
    this.selectedIndex = snapshot.selectedIndex;
    this.loading = snapshot.loading;
    this.error = snapshot.error;
  }

  async focusInput(): Promise<void> {
    this.focusSuppressed = true;
    await nextTick();
    this.input?.focus();
    this.focusSuppressed = false;
  }

  /** Returns true only for keys handled by suggestions; plain Enter retains the old navigation. */
  keydown(event: KeyboardEvent): boolean {
    if (this.composing || event.isComposing || event.keyCode === 229) return true;
    if (event.key === 'Escape' || event.key === 'Tab') {
      const wasOpen = this.open;
      this.hide();
      if (wasOpen && event.key === 'Escape') event.preventDefault();
      return event.key === 'Escape';
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!this.open) this.inputChanged();
      if (!this.open) return false;
      event.preventDefault();
      const action = event.key === 'ArrowDown' ? 'next' : 'previous';
      const count = this.candidateUrls.length;
      if (count) this.selectedIndex = action === 'next' ? (this.selectedIndex + 1) % count : (this.selectedIndex < 0 ? count - 1 : (this.selectedIndex - 1 + count) % count);
      void popup.action({ sessionId: this.sessionId, action }).catch(() => this.hide());
      return true;
    }
    if (event.key === 'Enter' && this.open && this.candidateUrls[this.selectedIndex]) {
      event.preventDefault();
      const sessionId = this.sessionId;
      const url = this.candidateUrls[this.selectedIndex];
      // Main must accept the row before hide invalidates its session.
      void popup.action({ sessionId, action: 'accept', url }).catch(() => this.hide());
      return true;
    }
    return false;
  }
}

export const browserHistoryStore = reactive(new BrowserHistoryState());
