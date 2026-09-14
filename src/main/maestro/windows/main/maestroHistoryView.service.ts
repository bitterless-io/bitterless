import { WebContentsView, webContents } from 'electron';
import type { BrowserWindow } from 'electron';
import { is } from '@electron-toolkit/utils';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import { googleSearchUrl } from '@maestro-shared/browserAddress.service';
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot';
import type { BrowserHistoryApi } from '@maestro-shared/browserHistory.api';
import {
  BROWSER_HISTORY_FOCUS_EVENT,
  BROWSER_HISTORY_STATE_EVENT,
  type BrowserHistoryPopupApi,
  type BrowserHistoryPopupRequest,
  type BrowserHistoryPopupSnapshot,
} from '@maestro-shared/browserHistoryPopup.api';

const history = createXpcMainEmitter<BrowserHistoryApi>('BrowserHistoryDao');

interface HistoryViewHost {
  browserWindow: BrowserWindow | null;
  activeTabId: string | null;
  navigateHistory(url: string): Promise<void>;
}

/** One bounded native surface, above the page and chat; the address field keeps keyboard focus. */
export class MaestroHistoryViewService {
  private view: WebContentsView | null = null;
  private ready = false;
  private attached = false;
  private epoch = 0;
  private lastRequestId = 0;
  private rendererToken = '';
  private unbindWindow: Array<() => void> = [];
  private request: BrowserHistoryPopupRequest | null = null;
  private state: BrowserHistoryPopupSnapshot = {
    revision: 0, sessionId: null, query: '', entries: [], selectedIndex: -1, loading: false, error: false,
  };
  private closedSessions = new Set<string>();
  private boundWindow: BrowserWindow | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: HistoryViewHost) {}

  snapshot(): BrowserHistoryPopupSnapshot {
    return { ...this.state, entries: this.state.entries.map((entry) => ({ ...entry })) };
  }

  async show(params: BrowserHistoryPopupRequest): Promise<void> {
    const win = this.host.browserWindow;
    if (!win || win.isDestroyed() || !win.isFocused() || params.tabId !== this.host.activeTabId) return;
    if (!params.sessionId || this.closedSessions.has(params.sessionId) || params.requestId <= this.lastRequestId) return;
    this.lastRequestId = params.requestId;
    if (![params.anchor.x, params.anchor.y, params.anchor.width, params.anchor.height].every(Number.isFinite)) return;
    if (this.request?.sessionId === params.sessionId && params.requestId <= this.request.requestId) return;
    this.bindWindow(win);
    const previous = this.request;
    this.request = { ...params, query: String(params.query), anchor: { ...params.anchor } };
    if (previous?.sessionId === params.sessionId && previous.query === this.request.query) {
      this.present();
      return;
    }
    const epoch = ++this.epoch;
    this.state = { ...this.state, sessionId: params.sessionId, dismissedSessionId: undefined, query: this.request.query, entries: [], selectedIndex: -1, loading: true, error: false };
    this.publish();
    this.present();
    try {
      const entries = await history.search({ query: this.request.query });
      if (epoch !== this.epoch || !this.request) return;
      this.state.entries = entries;
      this.state.loading = false;
    } catch {
      if (epoch !== this.epoch || !this.request) return;
      this.state.loading = false;
      this.state.error = true;
    }
    this.publish();
    this.present();
  }

  hide(sessionId?: string): void {
    if (sessionId) this.closedSessions.add(sessionId);
    if (sessionId && this.request && this.request.sessionId !== sessionId) return;
    if (this.request) this.closedSessions.add(this.request.sessionId);
    // Keep dismissal tombstones bounded while retaining recent in-flight request identities.
    if (this.closedSessions.size > 128) this.closedSessions.delete(this.closedSessions.values().next().value!);
    const dismissedSessionId = this.request?.sessionId ?? sessionId;
    this.epoch += 1;
    this.request = null;
    this.state = { ...this.state, sessionId: null, dismissedSessionId, entries: [], selectedIndex: -1, loading: false, error: false };
    this.detach();
    this.publish();
  }

  addressBlur(sessionId: string): void {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      if (this.request?.sessionId !== sessionId) return;
      // Native focus moves before a popup click reaches its renderer. Retain that click target.
      if (this.view && webContents.getFocusedWebContents() === this.view.webContents) return;
      this.hide(sessionId);
    }, 0);
  }

  mounted(token: string): void {
    if (token !== this.rendererToken || !this.view || this.view.webContents.isDestroyed()) return;
    this.ready = true;
    this.present();
  }

  async action(params: Parameters<BrowserHistoryPopupApi['action']>[0]): Promise<void> {
    const request = this.request;
    if (!request || params.sessionId !== request.sessionId || request.tabId !== this.host.activeTabId) return;
    if (params.action === 'focus') { this.focusAddress(); return; }
    if (params.action === 'close') {
      this.hide(request.sessionId);
      this.focusAddress();
      return;
    }
    if (params.action === 'next' || params.action === 'previous') {
      const count = this.state.entries.length + (googleSearchUrl(request.query) ? 1 : 0);
      if (count) this.state.selectedIndex = params.action === 'next'
        ? (this.state.selectedIndex + 1) % count
        : (this.state.selectedIndex < 0 ? count - 1 : (this.state.selectedIndex - 1 + count) % count);
      this.publish();
      return;
    }
    const google = googleSearchUrl(request.query);
    const entry = params.url ? this.state.entries.find((item) => item.url === params.url) : this.state.entries[this.state.selectedIndex - (google ? 1 : 0)];
    const selectedUrl = params.url ? (params.url === google ? google : entry?.url) : (google && this.state.selectedIndex === 0 ? google : entry?.url);
    if (params.action === 'accept') {
      if (!selectedUrl) return;
      this.hide(request.sessionId);
      await this.host.navigateHistory(selectedUrl);
      return;
    }
    if (params.action === 'remove' && entry) {
      const epoch = ++this.epoch;
      try {
        await history.remove({ url: entry.url });
        if (epoch !== this.epoch || !this.request) return;
        const entries = await history.search({ query: request.query });
        if (epoch !== this.epoch || !this.request) return;
        this.state.entries = entries;
        this.state.selectedIndex = Math.min(this.state.selectedIndex, this.state.entries.length - 1 + (google ? 1 : 0));
        this.state.error = false;
      } catch {
        if (epoch !== this.epoch || !this.request) return;
        this.state.error = true;
      }
      this.publish();
      this.present();
      this.focusAddress();
    }
    if (params.action === 'retry') {
      // Force a new query while retaining the address session and its dismissal guard.
      this.request = null;
      this.lastRequestId = request.requestId - 1;
      await this.show(request);
      this.focusAddress();
    }
  }

  reset(keepSessionGuards = false): void {
    this.hide();
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = null;
    const view = this.view;
    this.view = null;
    this.ready = false;
    for (const unbind of this.unbindWindow.splice(0)) unbind();
    this.boundWindow = null;
    this.rendererToken = '';
    if (!keepSessionGuards) { this.lastRequestId = 0; this.closedSessions.clear(); }
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
  }

  private focusAddress(): void {
    const win = this.host.browserWindow;
    if (!win || win.isDestroyed() || !win.isFocused()) return;
    win.webContents.focus();
    xpcMain.broadcast(BROWSER_HISTORY_FOCUS_EVENT, {});
  }

  private bindWindow(win: BrowserWindow): void {
    if (this.boundWindow === win) return;
    this.boundWindow = win;
    const blur = (): void => this.hide();
    const resize = (): void => this.present();
    const reset = (): void => this.reset();
    const navigate = (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean): void => { if (isMainFrame) this.hide(); };
    win.on('blur', blur);
    win.on('resize', resize);
    win.once('closed', reset);
    win.webContents.on('render-process-gone', reset);
    win.webContents.on('did-start-navigation', navigate);
    this.unbindWindow.push(() => {
      win.removeListener('blur', blur); win.removeListener('resize', resize); win.removeListener('closed', reset);
      win.webContents.removeListener('render-process-gone', reset); win.webContents.removeListener('did-start-navigation', navigate);
    });
  }

  private ensureView(): WebContentsView | null {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const win = this.host.browserWindow;
    if (!win || win.isDestroyed()) return null;
    const view = new WebContentsView({ webPreferences: {
      preload: join(__dirname, '../preload/maestroHistory.js'),
      sandbox: false, contextIsolation: true, nodeIntegration: false, partition: MAESTRO_PARTITION,
    } });
    this.view = view;
    this.rendererToken = randomUUID();
    this.ready = false;
    view.setBackgroundColor('#00000000');
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.on('will-redirect', (event) => event.preventDefault());
    view.webContents.on('blur', () => {
      const sessionId = this.request?.sessionId;
      if (!sessionId) return;
      setTimeout(() => {
        const focused = webContents.getFocusedWebContents();
        if (focused !== win.webContents && focused !== view.webContents) this.hide(sessionId);
      }, 0);
    });
    view.webContents.on('render-process-gone', () => this.reset(true));
    view.webContents.once('destroyed', () => { if (this.view === view) this.reset(true); });
    const load = is.dev && process.env['ELECTRON_RENDERER_URL']
      ? view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/maestro/history/index.html?historyToken=${this.rendererToken}`)
      : view.webContents.loadFile(join(__dirname, '../renderer/maestro/history/index.html'), { query: { historyToken: this.rendererToken } });
    void load.catch(() => {
      if (this.view !== view) return;
      console.warn('[maestro history] suggestion renderer unavailable');
      this.reset(true);
    });
    return view;
  }

  private present(): void {
    const request = this.request;
    const win = this.host.browserWindow;
    if (!request || !win || win.isDestroyed()) return;
    const view = this.ensureView();
    if (!view || !this.ready) return;
    const [width, height] = win.getContentSize();
    const x = Math.max(0, Math.min(Math.round(request.anchor.x - 8), width - 80));
    const y = Math.max(0, Math.min(Math.round(request.anchor.y + request.anchor.height), height));
    const popupWidth = Math.min(Math.max(240, Math.round(request.anchor.width + 16)), width - x);
    const popupHeight = Math.min(height - y, (Math.max(1, this.state.entries.length) + (googleSearchUrl(request.query) ? 1 : 0)) * 44 + 60);
    if (popupWidth <= 0 || popupHeight <= 0) { this.hide(); return; }
    view.setBounds({ x, y, width: popupWidth, height: popupHeight });
    // addChildView on an existing child reorders it; never detach/reattach to raise a fresh view.
    win.contentView.addChildView(view);
    this.attached = true;
  }

  private detach(): void {
    const win = this.host.browserWindow;
    if (this.attached && win && !win.isDestroyed() && this.view) win.contentView.removeChildView(this.view);
    this.attached = false;
  }

  private publish(): void {
    this.state.revision += 1;
    xpcMain.broadcast(BROWSER_HISTORY_STATE_EVENT, this.snapshot());
  }
}
