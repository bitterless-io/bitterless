import { BrowserWindow } from 'electron';
import { windowStateService, type WindowStateController } from '@main/windows/windowState.service';
import { ZellijSurface } from './zellijSurface';
import { closeZellijTerminal, getZellijRuntime, stopZellijRuntime } from './zellijRuntime.service';
import { ZELLIJ_CHROME_BACKGROUND, type ZellijSnapshot } from '@shared/zellij/zellij.type';
import type { ZellijTerminalRect } from './zellijTerminalView';
import type { MaestroCompositeTabHostApi } from '@maestro-shared/compositeTab.api';

export { isZellijNavigationAllowed } from './zellijTerminalView';

/**
 * The surface id the standalone fallback window uses.
 *
 * Fixed rather than minted, and that is the point: the window is the path taken when Maestro is not
 * open (tray, first run), so there is nobody to mint an identity for it and nowhere to persist one.
 * Reopening the window therefore returns to the same session, which is the only sensible reading of
 * "the terminal I opened from the tray".
 */
const STANDALONE_SURFACE_ID = 'window';

interface ZellijSurfaceEntry {
  surface: ZellijSurface;
  /** The Maestro tab carrying it, or null while it lives in the standalone window. */
  tabHost: MaestroCompositeTabHostApi | null;
}

/**
 * Owns the live Zellij surfaces and decides where each one lives: a standalone window, or a Maestro
 * tab. Several tabs can be open at once, each on its OWN Zellij session (Ral 2026-09-11:
 * 「我期望 zellij 可以存在于多个 tab」).
 *
 * Identity is the whole design. A surface is keyed by the id Maestro minted for its tab and
 * persisted with it, so a new tab is a new session by construction and a restored tab returns to
 * its own — see `docs/features/zellij-multi-tab.md`. The surface MOVES rather than being rebuilt
 * (the same shape Trench uses in `coinWindow.manager.ts`), so docking keeps the running shell and
 * its scrollback.
 */
class ZellijWindowService {
  private readonly surfaces = new Map<string, ZellijSurfaceEntry>();
  private readonly creating = new Map<string, Promise<ZellijSurface>>();
  private readonly loadingSurfaces = new Map<string, ZellijSurface>();
  private window: BrowserWindow | null = null;
  private stateController: WindowStateController | null = null;
  private generation = 0;
  private readonly closedTabs = new WeakSet<MaestroCompositeTabHostApi>();

  /** Where the standalone surface currently lives — the renderer shows a different dock affordance. */
  get hostKind(): 'none' | 'standalone' | 'tab' {
    const entry = this.surfaces.get(STANDALONE_SURFACE_ID);
    if (!entry) return 'none';
    return entry.tabHost ? 'tab' : 'standalone';
  }

  private async ensureSurface(surfaceId: string): Promise<ZellijSurface> {
    const existing = this.surfaces.get(surfaceId);
    if (existing) return existing.surface;
    const pending = this.creating.get(surfaceId);
    if (pending) return pending;
    const generation = this.generation;
    // Start the SHARED server now, in parallel with this surface's own chrome page load, instead of
    // after it.
    //
    // `surface.load()` is a bounded Chromium navigation, and nothing could reach
    // `prepareZellijTerminal` until it resolved — so on the first boot after an update, when every
    // renderer in the app is starved at once (2026-09-17: the web server was spawned 106s after
    // startup, against 4.2s on an ordinary boot), the server had not even been asked to start by
    // the time the user was looking at a blank tab. Kicking it here means it is already listening
    // when the chrome finally mounts, so the terminal paints as soon as its page exists.
    //
    // Idempotent and fire-and-forget: `ZellijProcessService.initialize()` memoizes its in-flight
    // promise and returns immediately once ready, so N surfaces still cause exactly one server
    // start, and a failure here is re-reported through the normal prepare path.
    void getZellijRuntime()
      .initialize()
      .catch(() => undefined);
    const created = (async () => {
      const surface = new ZellijSurface(surfaceId);
      this.loadingSurfaces.set(surfaceId, surface);
      try {
        await surface.load();
        if (generation !== this.generation) throw new Error('operation-failed');
        if (this.loadingSurfaces.get(surfaceId) !== surface)
          throw new Error('[zellij] Maestro tab is no longer available');
      } catch (error) {
        surface.dispose();
        throw error;
      }
      this.surfaces.set(surfaceId, { surface, tabHost: null });
      return surface;
    })().finally(() => {
      this.creating.delete(surfaceId);
      this.loadingSurfaces.delete(surfaceId);
    });
    this.creating.set(surfaceId, created);
    return created;
  }

  /** Standalone window. Kept as the fallback for when Maestro is not open. */
  async open(): Promise<void> {
    const surface = await this.ensureSurface(STANDALONE_SURFACE_ID);
    const entry = this.surfaces.get(STANDALONE_SURFACE_ID);
    if (entry?.tabHost) {
      entry.tabHost.activate();
      surface.sync();
      return;
    }
    if (!this.window || this.window.isDestroyed()) this.createWindow(surface);
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    this.stateController?.show();
    window.show();
    window.focus();
    surface.setVisible(true);
    surface.sync();
    surface.focus(window);
  }

  /**
   * Dock into a Maestro tab. The tab's own `instanceId` is the surface id, which is what makes each
   * tab a separate terminal instead of N views onto one pane tree.
   */
  async openOnTab(host: MaestroCompositeTabHostApi): Promise<void> {
    const surfaceId = host.instanceId || STANDALONE_SURFACE_ID;
    const surface = await this.ensureSurface(surfaceId);
    const window = host.window();
    if (this.closedTabs.has(host) || !host.isOpen() || !window || window.isDestroyed()) {
      if (!this.surfaces.get(surfaceId)?.tabHost) {
        this.surfaces.delete(surfaceId);
        surface.dispose();
      }
      throw new Error('[zellij] Maestro tab is no longer available');
    }
    const entry = this.surfaces.get(surfaceId);
    if (!entry) throw new Error('[zellij] the surface went away while its tab was opening');
    if (entry.tabHost === host) {
      this.refreshTab(host);
      return;
    }
    this.detachFromCurrentHost(entry);
    host.attach(surface.container);
    entry.tabHost = host;
    // Tear the standalone carrier down only when the surface that lived in it is the one moving —
    // another surface's tab must not close somebody else's window.
    if (surfaceId === STANDALONE_SURFACE_ID) {
      const oldWindow = this.window;
      this.stateController?.flushAndDispose();
      this.stateController = null;
      this.window = null;
      if (oldWindow && !oldWindow.isDestroyed()) oldWindow.destroy();
    }
    surface.setVisible(true);
    this.refreshTab(host);
    surface.sync();
  }

  setTabActive(host: MaestroCompositeTabHostApi, active: boolean): void {
    const entry = this.entryForHost(host);
    if (!entry) return;
    entry.surface.setVisible(active);
    if (active) {
      this.refreshTab(host);
      entry.surface.sync();
      entry.surface.focus(host.window() ?? undefined);
    }
  }

  refreshTab(host: MaestroCompositeTabHostApi): void {
    const entry = this.entryForHost(host);
    if (!entry) return;
    const rect = host.contentRect();
    if (!rect) return;
    entry.surface.setHostRect(rect);
  }

  /** The tab went away. The surface goes with it — this is a close, not a move. */
  closeTab(host: MaestroCompositeTabHostApi): void {
    this.closedTabs.add(host);
    const surfaceId = host.instanceId || STANDALONE_SURFACE_ID;
    this.loadingSurfaces.get(surfaceId)?.dispose();
    this.loadingSurfaces.delete(surfaceId);
    void closeZellijTerminal(host.instanceId || STANDALONE_SURFACE_ID).catch(() => {
      console.error('[zellij] failed to close the tab session');
    });
    for (const [surfaceId, entry] of this.surfaces) {
      if (entry.tabHost !== host) continue;
      this.surfaces.delete(surfaceId);
      host.detach(entry.surface.container);
      entry.surface.dispose();
      return;
    }
  }

  minimize(): void {
    this.window?.minimize();
  }

  toggleMaximize(): void {
    if (this.window?.isMaximized()) this.window.unmaximize();
    else this.window?.maximize();
  }

  close(): void {
    const entry = this.surfaces.get(STANDALONE_SURFACE_ID);
    if (entry?.tabHost) {
      entry.tabHost.close();
      return;
    }
    this.window?.close();
  }

  /**
   * Place one surface's terminal in the hole its own chrome measured.
   *
   * Addressed by id because the renderers are interchangeable: with several surfaces live, an
   * id-less call would let whichever chrome measured last lay out every other terminal. An unknown
   * id is dropped rather than falling back to "some surface" — mis-laying-out a stranger's terminal
   * is worse than doing nothing.
   */
  setContentBounds(surfaceId: string, input: ZellijTerminalRect): void {
    this.surfaces.get(surfaceId)?.surface.setContentBounds(input);
  }

  snapshot(surfaceId: string): ZellijSnapshot {
    return this.surfaces.get(surfaceId)?.surface.snapshot() ?? getZellijRuntime().snapshot();
  }

  async initializeSurface(surfaceId: string): Promise<ZellijSnapshot> {
    const creating = this.creating.get(surfaceId);
    if (creating) await creating;
    const entry = this.surfaces.get(surfaceId);
    if (!entry) throw new Error('operation-failed');
    return entry.surface.initialize();
  }

  async destroy(): Promise<void> {
    this.generation += 1;
    for (const surface of this.loadingSurfaces.values()) surface.dispose();
    this.loadingSurfaces.clear();
    await Promise.all([...this.creating.values()].map((pending) => pending.catch(() => undefined)));
    // Capture the focused pane before disposing its view or stopping the owned server.
    await stopZellijRuntime();
    for (const [surfaceId, entry] of this.surfaces) {
      this.surfaces.delete(surfaceId);
      entry.tabHost?.detach(entry.surface.container);
      entry.surface.dispose();
    }
    this.stateController?.flushAndDispose();
    this.window?.destroy();
    this.window = null;
    this.stateController = null;
    // Only app quit and logout reach here. Closing a SURFACE must never stop the shared server.
  }

  private entryForHost(host: MaestroCompositeTabHostApi): ZellijSurfaceEntry | null {
    for (const entry of this.surfaces.values()) if (entry.tabHost === host) return entry;
    return null;
  }

  private detachFromCurrentHost(entry: ZellijSurfaceEntry): void {
    if (entry.tabHost) {
      entry.tabHost.detach(entry.surface.container);
      entry.tabHost = null;
      return;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.contentView.removeChildView(entry.surface.container);
    }
  }

  private createWindow(surface: ZellijSurface): void {
    const bounds = windowStateService.resolve('zellij');
    const created = new BrowserWindow({
      width: bounds?.bounds.width ?? 1120,
      height: bounds?.bounds.height ?? 760,
      ...(bounds ? { x: bounds.bounds.x, y: bounds.bounds.y } : {}),
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: 'Zellij',
      // chrome 与终端都是暗的,窗口默认的白底会在打开时闪一帧(zellij-terminal-chrome.md #3)。
      backgroundColor: ZELLIJ_CHROME_BACKGROUND,
      autoHideMenuBar: true
    });
    this.window = created;
    this.stateController = windowStateService.register('zellij', created);
    created.contentView.addChildView(surface.container);
    const applyBounds = (): void => {
      const [width, height] = created.getContentSize();
      surface.setHostRect({ x: 0, y: 0, width, height });
    };
    applyBounds();
    created.on('resize', applyBounds);
    created.once('closed', () => {
      if (this.window !== created) return;
      this.window = null;
      this.stateController = null;
      const entry = this.surfaces.get(STANDALONE_SURFACE_ID);
      // Only the surface that was actually in this window goes with it; a docked one has already
      // moved out and cleared its slot here.
      if (!entry || entry.tabHost) return;
      this.surfaces.delete(STANDALONE_SURFACE_ID);
      entry.surface.dispose();
      void closeZellijTerminal(STANDALONE_SURFACE_ID).catch(() => {
        console.error('[zellij] failed to close the window session');
      });
    });
  }
}

export const zellijWindowService = new ZellijWindowService();
