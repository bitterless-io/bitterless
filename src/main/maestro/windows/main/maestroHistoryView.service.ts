import { WebContentsView, webContents } from 'electron';
import type { BrowserWindow, WebContents } from 'electron';
import { is } from '@electron-toolkit/utils';
import { join } from 'path';
import { xpcMain } from 'electron-xpc/main';
import { googleSearchUrl } from '@maestro-shared/browserAddress.service';
import { browserHistoryError, browserHistoryLog } from '@maestro-shared/browserHistoryDiagnostics.service';
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot';
import {
  BROWSER_HISTORY_ACTION_EVENT, BROWSER_HISTORY_CLOSED_EVENT, BROWSER_HISTORY_STATE_EVENT,
  type BrowserHistoryPopupAction, type BrowserHistoryPopupSnapshot,
} from '@maestro-shared/browserHistoryPopup.api';

interface HistoryViewHost {
  browserWindow: BrowserWindow | null;
  activeTabId: string | null;
}

/** Home owns queries and selection; this Cowork-style surface only presents complete snapshots. */
export class MaestroHistoryViewService {
  private view: WebContentsView | null = null;
  private viewContents: WebContents | null = null;
  private win: BrowserWindow | null = null;
  private state: BrowserHistoryPopupSnapshot | null = null;
  private blockedThrough = 0;
  private ready = false;
  private unavailable = false;
  private attached = false;
  private cleanup: Array<() => void> = [];
  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: HistoryViewHost) {}

  create(win: BrowserWindow): void {
    this.win = win;
    this.unavailable = false;
    this.ready = false;
    const view = new WebContentsView({ webPreferences: {
      preload: join(__dirname, '../preload/maestroHistory.js'),
      sandbox: false, contextIsolation: true, nodeIntegration: false, partition: MAESTRO_PARTITION,
    } });
    const contents = view.webContents;
    this.view = view;
    this.viewContents = contents;
    browserHistoryLog('native.created');
    view.setBackgroundColor('#00000000');
    view.setVisible(false);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-redirect', (event) => event.preventDefault());
    contents.on('preload-error', (_event, _path, error) => browserHistoryLog('native.preload.failure', browserHistoryError(error)));
    contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => browserHistoryLog('native.load.failure', { errorCode, isMainFrame }));
    contents.on('render-process-gone', (_event, details) => {
      if (this.view !== view) return;
      browserHistoryLog('native.process.gone', { reason: ['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure'].includes(details?.reason) ? details.reason : 'unknown', exitCode: details?.exitCode });
      this.ready = false; this.unavailable = true; this.hide(undefined, 'popup-process-gone');
    });
    contents.once('destroyed', () => {
      if (this.view !== view) return;
      browserHistoryLog('native.destroyed');
      this.ready = false; this.unavailable = true; this.hide(undefined, 'popup-destroyed');
    });
    const homeContents = win.webContents;
    contents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && !input.isComposing && ['Escape', 'Tab'].includes(input.key)) {
        event.preventDefault();
        this.hide(undefined, 'popup-key');
        if (!win.isDestroyed()) homeContents.focus();
      }
    });
    contents.on('blur', () => this.blur());
    const blur = (): void => this.hide(undefined, 'window-blur');
    const resize = (): void => this.present();
    const navigation = (_event: unknown, _url: string, inPlace: boolean, isMainFrame: boolean): void => {
      if (isMainFrame) { browserHistoryLog('home.navigation', { inPlace }); this.hide(undefined, 'home-navigation'); }
    };
    const gone = (): void => this.hide(undefined, 'home-process-gone');
    const closed = (): void => this.reset();
    win.on('blur', blur); win.on('resize', resize); win.once('closed', closed);
    homeContents.on('did-start-navigation', navigation); homeContents.on('render-process-gone', gone);
    this.cleanup.push(() => {
      win.removeListener('blur', blur); win.removeListener('resize', resize); win.removeListener('closed', closed);
      if (!homeContents.isDestroyed()) {
        homeContents.removeListener('did-start-navigation', navigation); homeContents.removeListener('render-process-gone', gone);
      }
    });
    browserHistoryLog('native.load.begin', { development: Boolean(is.dev && process.env['ELECTRON_RENDERER_URL']) });
    const load = is.dev && process.env['ELECTRON_RENDERER_URL']
      ? contents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/maestro/history/index.html`)
      : contents.loadFile(join(__dirname, '../renderer/maestro/history/index.html'));
    void load.then(() => {
      if (this.view !== view) return;
      this.ready = true;
      browserHistoryLog('native.load.success');
      this.present();
    }).catch((error) => {
      if (this.view !== view) return;
      browserHistoryLog('native.load.rejected', browserHistoryError(error));
      this.unavailable = true;
      this.hide(undefined, 'load-failure');
    });
  }

  update(state: BrowserHistoryPopupSnapshot): boolean {
    const win = this.win;
    const reason = !win ? 'no-window' : win.isDestroyed() ? 'window-destroyed'
      : !win.isFocused() ? 'window-unfocused' : state.tabId !== this.host.activeTabId ? 'tab-mismatch'
      : state.session <= this.blockedThrough ? 'closed-session'
      : this.state && (state.session < this.state.session || (state.session === this.state.session && state.revision <= this.state.revision)) ? 'stale-revision'
      : ![state.anchor.x, state.anchor.y, state.anchor.width, state.anchor.height].every(Number.isFinite) ? 'invalid-anchor' : '';
    if (reason) { browserHistoryLog('main.update.rejected', { reason, revision: state.revision }); return false; }
    // Preserve BL's fresh-session recovery after a popup crash/load failure. The blocked session
    // stays rejected, and callbacks from the replaced view cannot mark this new view ready.
    if (this.unavailable || !this.viewContents || this.viewContents.isDestroyed()) {
      browserHistoryLog('native.recreate');
      this.reset();
      this.create(win!);
    }
    this.state = { ...state, anchor: { ...state.anchor }, entries: state.entries.slice(0, 8).map((entry) => ({ ...entry })) };
    browserHistoryLog('main.update.accepted', { revision: state.revision, resultCount: this.state.entries.length, loading: state.loading, error: state.error, ready: this.ready });
    this.publish(); this.present();
    return true;
  }

  snapshot(): BrowserHistoryPopupSnapshot | null {
    return this.state ? { ...this.state, anchor: { ...this.state.anchor }, entries: this.state.entries.map((entry) => ({ ...entry })) } : null;
  }

  hide(session = this.state?.session || 0, reason = 'caller'): void {
    browserHistoryLog('main.hide', { reason, active: Boolean(this.state), olderSession: Boolean(this.state && session < this.state.session) });
    this.blockedThrough = Math.max(this.blockedThrough, session);
    if (this.state && session < this.state.session) return;
    const closed = this.state?.session || session;
    this.state = null;
    this.detach(); this.publish();
    xpcMain.broadcast(BROWSER_HISTORY_CLOSED_EVENT, { session: closed });
  }

  /**
   * 原生焦点交回宿主页。由渲染层在**它自己处理完这次动作之后**调用。
   *
   * 为什么不由 main 在 `action()` 里顺手做:那会赶在 Home 处理这次点击之前把焦点挪走,地址栏的
   * `@focus` 会把下拉重新弹开(`action()` 里那句「Home accepts the identity before restoring focus」
   * 说的就是它)。渲染层知道自己什么时候做完,而且它在 `focusSuppressed` 之内调用,重开那一路被压住。
   */
  focusHost(): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.focus();
  }

  blur(): void {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(() => {
      this.blurTimer = null;
      if (!this.state) return;
      const focused = webContents.getFocusedWebContents();
      if (focused === this.viewContents || (this.win && !this.win.isDestroyed() && focused === this.win.webContents)) return;
      this.hide(undefined, 'address-blur');
    }, 0);
  }

  action(action: BrowserHistoryPopupAction): void {
    const state = this.state;
    if (!state || state.session !== action.session || state.revision !== action.revision || state.tabId !== this.host.activeTabId) return;
    if (action.action === 'remove' && !state.entries.some((entry) => entry.url === action.url)) return;
    if (action.action === 'accept' && action.url && action.url !== googleSearchUrl(state.query) && !state.entries.some((entry) => entry.url === action.url)) return;
    if (action.action === 'close') {
      if (this.win && !this.win.isDestroyed()) this.win.webContents.focus();
      this.hide(undefined, 'close-action');
      return;
    }
    // Home accepts the identity before restoring focus; otherwise focus can supersede this click.
    xpcMain.broadcast(BROWSER_HISTORY_ACTION_EVENT, action);
  }

  reset(): void {
    this.hide(undefined, 'reset');
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = null;
    for (const dispose of this.cleanup.splice(0)) {
      try { dispose(); } catch (error) { browserHistoryLog('native.cleanup.failure', browserHistoryError(error)); }
    }
    const contents = this.viewContents;
    this.viewContents = null; this.view = null; this.win = null; this.ready = false;
    if (contents && !contents.isDestroyed()) {
      try { contents.close(); } catch (error) { browserHistoryLog('native.close.failure', browserHistoryError(error)); }
    }
  }

  private publish(): void { xpcMain.broadcast(BROWSER_HISTORY_STATE_EVENT, {}); }

  private present(): void {
    const { win, view, state } = this;
    const reason = !win || win.isDestroyed() ? 'no-window' : !view || !this.viewContents || this.viewContents.isDestroyed() ? 'no-view'
      : !state ? 'no-state' : !this.ready ? 'not-loaded' : '';
    if (reason) { browserHistoryLog('native.present.blocked', { reason }); return; }
    const [width, height] = win!.getContentSize();
    const x = Math.max(0, Math.min(Math.round(state!.anchor.x - 8), width - 80));
    const y = Math.max(0, Math.min(Math.round(state!.anchor.y + state!.anchor.height), height));
    const popupWidth = Math.min(Math.max(240, Math.round(state!.anchor.width + 16)), width - x);
    const popupHeight = Math.min(height - y, (Math.max(1, state!.entries.length) + (googleSearchUrl(state!.query) ? 1 : 0)) * 44 + 60);
    if (popupWidth <= 0 || popupHeight <= 0) { this.hide(undefined, 'empty-bounds'); return; }
    try {
      view!.setBounds({ x, y, width: popupWidth, height: popupHeight });
      win!.contentView.addChildView(view!);
      this.attached = true;
      view!.setVisible(true);
      browserHistoryLog('native.attached', { revision: state!.revision, width: popupWidth, height: popupHeight });
    } catch (error) {
      browserHistoryLog('native.attach.failure', browserHistoryError(error));
      throw error;
    }
  }

  private detach(): void {
    if (this.win && !this.win.isDestroyed() && this.view) {
      this.view.setVisible(false);
      if (this.attached) this.win.contentView.removeChildView(this.view);
    }
    this.attached = false;
  }
}
