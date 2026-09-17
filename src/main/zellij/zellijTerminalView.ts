import { WebContentsView } from 'electron';
import type { View } from 'electron';
import { autoOpenZellijDevTools, bindZellijDevTools } from './zellijDevTools.helper';
import { bindZellijKeyBridge } from './zellijKeyBridge';
import { bindZellijPageKeyPatch } from './zellijPageKeyPatch';
import { setTerminalKeyboardOwner } from '@maestro-main/common/shortcutsHelper/shortcuts.helper';
import {
  getZellijRuntime,
  prepareZellijTerminal,
  focusZellijTerminal,
  blurZellijTerminal,
  copyZellijNativeSelection,
  subscribeZellijState,
  subscribeZellijTerminalFailure,
  zellijOrigin,
  zellijTerminalSession
} from './zellijRuntime.service';
import type { ZellijSnapshot } from '@shared/zellij/zellij.type';
import { zellijErrorCode } from './zellijProcess.service';

export interface ZellijTerminalHost {
  /** Identifies THIS surface. Its Zellij session name is derived from it, so it must be stable for
   *  the life of the surface and distinct from every other live surface. */
  surfaceId: string;
  /** Where the view is parented. A BrowserWindow passes its `contentView`; an embedded surface passes its own container. */
  container: View;
  /** Host-space rect for the terminal, recomputed by the host whenever its own layout changes. */
  bounds(): { x: number; y: number; width: number; height: number };
  /** False while the host is hidden (background tab, collapsed cell) so the view is not drawn. */
  visible?(): boolean;
  destroyed(): boolean;
  opened(): boolean;
  changed(snapshot: ZellijSnapshot): void;
}

export interface ZellijTerminalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * ONE Zellij terminal surface: one WebContentsView, its navigation fence, its layout and its
 * teardown — and nothing else.
 *
 * This is the unit that has to multiply. Everything it needs from the outside arrives through
 * `ZellijTerminalHost`, so the same class serves a standalone window, a tab, or an Omni cell; the
 * host decides where it lives and how big it is. The shared pieces (the server process, the token,
 * the config file) deliberately stay singletons in
 * `zellijRuntime.service.ts` — N surfaces are N HTTP clients of ONE server.
 *
 * Extracted from ZellijWindowService, which held `window` / `terminal` / `contentBounds` as scalars
 * and short-circuited on `if (this.terminal) return` — so a second surface was not merely unsafe,
 * it was unrepresentable.
 */
export class ZellijTerminalView {
  private view: WebContentsView | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeFailure: (() => void) | null = null;
  private disposed = false;
  private pending: Promise<ZellijSnapshot> | null = null;
  private generation = 0;
  private state: Pick<ZellijSnapshot, 'status' | 'error'> = { status: 'idle', error: null };

  constructor(private readonly host: ZellijTerminalHost) {
    this.unsubscribe = subscribeZellijState((snapshot) => this.applyState(snapshot));
    this.unsubscribeFailure = subscribeZellijTerminalFailure((surfaceId) => {
      if (surfaceId !== this.host.surfaceId || this.disposed) return;
      this.generation += 1;
      this.pending = null;
      this.detach();
      this.state = { status: 'error', error: 'operation-failed' };
      this.publish();
    });
  }

  /** Attach against the current runtime state; safe to call repeatedly (host show/activate). */
  sync(): void {
    if (this.disposed) return;
    void this.initialize();
  }

  snapshot(): ZellijSnapshot {
    return { ...getZellijRuntime().snapshot(), ...this.state };
  }

  initialize(): Promise<ZellijSnapshot> {
    if (
      this.disposed ||
      !this.host.opened() ||
      this.host.destroyed() ||
      this.state.status === 'ready'
    )
      return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    const generation = this.generation;
    this.state = { status: 'starting', error: null };
    this.publish();
    const pending = (async () => {
      try {
        const target = await prepareZellijTerminal(this.host.surfaceId);
        if (this.disposed || this.host.destroyed() || generation !== this.generation)
          return this.snapshot();
        await this.attach(target);
        if (this.disposed || this.host.destroyed() || generation !== this.generation)
          return this.snapshot();
        this.state = { status: 'ready', error: null };
        this.layout();
      } catch (error) {
        if (this.disposed || generation !== this.generation) return this.snapshot();
        this.detach();
        this.state = { status: 'error', error: zellijErrorCode(error) };
        // The code alone is unusable for diagnosis: `operation-failed` is `zellijErrorCode`'s
        // fallback for ANY unrecognised error, and it is also the literal string `assertActive`
        // throws when a preparation is merely superseded by a runtime restart. Those two are
        // opposite situations and used to log identically (see zellij-terminal-no-error-trace.md).
        console.error(`[zellij] surface preparation failed reason=${this.state.error}`, error);
      }
      this.publish();
      return this.snapshot();
    })().finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  layout(): void {
    if (this.disposed || !this.view || this.host.destroyed()) return;
    const rect = this.host.bounds();
    this.view.setBounds({
      x: rect.x,
      y: rect.y,
      width: Math.max(0, rect.width),
      height: Math.max(0, rect.height)
    });
    // Only hosts that can be hidden (a background tab, a collapsed cell) declare visibility. A
    // window host never did, and calling setVisible unconditionally would be a behaviour change
    // smuggled into a refactor.
    this.view.setVisible(this.state.status === 'ready' && (this.host.visible?.() ?? true));
  }

  focus(): void {
    if (
      this.state.status === 'ready' &&
      (this.host.visible?.() ?? true) &&
      this.view &&
      !this.view.webContents.isDestroyed()
    ) {
      this.view.webContents.focus();
    }
  }

  /** True once a terminal view exists — the host uses it to decide what to focus. */
  attached(): boolean {
    return this.view !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.pending = null;
    blurZellijTerminal(this.host.surfaceId);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeFailure?.();
    this.unsubscribeFailure = null;
    this.detach();
  }

  private applyState(snapshot: ZellijSnapshot): void {
    if (this.disposed) return;
    if (snapshot.status !== 'ready') {
      this.detach();
      this.state = { status: snapshot.status, error: snapshot.error };
      this.publish();
      return;
    }
    if (!this.view && !this.host.destroyed() && !this.pending) void this.initialize();
  }

  private async attach(target: string): Promise<void> {
    const terminalSession = zellijTerminalSession();
    terminalSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    );
    terminalSession.setPermissionCheckHandler(() => false);
    const view = new WebContentsView({
      webPreferences: {
        session: terminalSession,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    this.view = view;
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const guard = (event: Electron.Event, url: string): void => {
      if (!isZellijNavigationAllowed(url)) event.preventDefault();
    };
    view.webContents.on('will-navigate', guard);
    view.webContents.on('will-redirect', guard);
    view.webContents.on('will-frame-navigate', (event) => guard(event, event.url));
    // The terminal owns the keyboard, so menu accelerators must not fire while it is focused —
    // which is also why DevTools here can only be bound through before-input-event.
    view.webContents.setIgnoreMenuShortcuts(true);
    // Cmd+W closes a PANE here, not the tab — see shortcuts.helper.
    setTerminalKeyboardOwner(view.webContents);
    bindZellijKeyBridge(view.webContents, {
      nativeSelection: (sendMarker, signal) =>
        copyZellijNativeSelection(this.host.surfaceId, { sendMarker, signal })
    });
    bindZellijPageKeyPatch(view.webContents);
    bindZellijDevTools(view.webContents);
    // In debug the surface controls already auto-open theirs (`zellijSurface.ts`), but `window.term`
    // — the handle every terminal-side investigation needs — lives HERE, in the view loaded from the
    // Zellij origin. Without this, `yarn dev` opens a Console where `window.term` is undefined and
    // the shortcut is the only way in.
    autoOpenZellijDevTools(view.webContents);
    view.webContents.on('focus', () => {
      if (this.state.status === 'ready' && (this.host.visible?.() ?? true))
        focusZellijTerminal(this.host.surfaceId);
    });
    view.webContents.on('blur', () => blurZellijTerminal(this.host.surfaceId));
    this.host.container.addChildView(view);
    this.layout();
    await view.webContents.loadURL(target);
  }

  private publish(): void {
    if (!this.disposed && !this.host.destroyed()) this.host.changed(this.snapshot());
  }

  private detach(): void {
    const view = this.view;
    this.view = null;
    if (!view) return;
    if (!this.host.destroyed()) this.host.container.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}

export const isZellijNavigationAllowed = (url: string): boolean => {
  try {
    return new URL(url).origin === zellijOrigin();
  } catch {
    return false;
  }
};
