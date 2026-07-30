import { app, BaseWindow, WebContentsView, screen, session, shell } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { is } from '@electron-toolkit/utils';
import { throttle } from 'es-toolkit';
import {
  OMNI_LAYOUT_RECOVERY_STATE_EVENT,
  OMNI_LAYOUT_SNAPSHOT_EVENT,
  OMNI_MINI_APP_DISPLAY_URLS,
  OMNI_MINI_APP_LOAD_STATE_EVENT,
  createDefaultOmniLayoutTree,
  parseOmniLayoutConfig,
  parseOmniPaneTree,
} from '@shared/omni/omni.types';
import {
  OMNI_BROWSER_HEADER_HEIGHT,
  OmniLayoutCommitQueue,
  flattenOmniPaneTreePixels,
  resolveOmniCellViewBounds,
} from '@shared/omni/omniLayout.service';
import type {
  OmniCellLayout,
  OmniContentMode,
  OmniLayoutConfig,
  OmniLayoutRecoveryState,
  OmniMiniAppLoadState,
  OmniMiniAppId,
  OmniPaneNode,
} from '@shared/omni/omni.types';
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';
import {
  windowStateService,
  type WindowStateController,
} from './windowState.service';

const LAYOUT_KEY = 'omni_layout';
const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'omni';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

class Semaphore {
  private _capacity: number;
  private _count: number;
  private _queue: Array<() => void> = [];
  constructor(capacity: number) { this._capacity = capacity; this._count = capacity; }
  acquire(): Promise<void> {
    if (this._count > 0) { this._count--; return Promise.resolve(); }
    return new Promise<void>((resolve) => { this._queue.push(resolve); });
  }
  release(): void {
    if (this._queue.length > 0) {
      this._queue.shift()!();
    } else {
      this._count++;
    }
  }
  /** Flush all pending waiters and reset to full capacity — call on cleanup to unblock queued loadURLs */
  drain(): void {
    const pending = this._queue.splice(0);
    for (const resolve of pending) resolve();
    this._count = this._capacity;
  }
}

const MENUBAR_HEIGHT = 32;
const OMNI_PARTITION = 'persist:omni';
const OMNI_GOOGLE_PARTITION = 'persist:omni-google';
const OMNI_BROWSER_PARTITIONS = [OMNI_PARTITION, OMNI_GOOGLE_PARTITION] as const;
const GOOGLE_PROFILE_HOSTNAMES = ['google.com', 'youtube.com', 'youtu.be'] as const;

type OmniBrowserProfile = 'default' | 'google';

const resolveOmniBrowserProfile = (url: string): OmniBrowserProfile | null => {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const isGoogleProfile = GOOGLE_PROFILE_HOSTNAMES.some(
    (candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`),
  );
  return isGoogleProfile ? 'google' : 'default';
};

const buildGoogleProfileUserAgent = (sourceUserAgent: string): string => {
  const tokens = sourceUserAgent
    .trim()
    .split(/\s+/)
    .filter((token) => !/^(?:Electron|Bitterless)\/\S+$/i.test(token));
  const chromeTokenIndex = tokens.findIndex((token) => /^Chrome\/\S+$/i.test(token));
  if (chromeTokenIndex === -1) {
    throw new Error('[OmniWindowHelper] Google profile UA is missing its Chrome product token');
  }
  tokens.splice(chromeTokenIndex, 0, `Bitterless/${app.getVersion()}`);
  return tokens.join(' ');
};

interface OmniMiniAppRuntime {
  preloadFile: string;
  rendererName: string;
}

interface OmniMiniAppRendererTarget {
  filePath: string | null;
  url: string;
}

interface ResolvedOmniMiniAppRuntime {
  preloadPath: string;
  rendererTarget: OmniMiniAppRendererTarget;
}

const OMNI_MINI_APP_RUNTIME: Record<OmniMiniAppId, OmniMiniAppRuntime> = {
  todo: { preloadFile: 'todo.js', rendererName: 'todo' },
  eyesOnAgents: { preloadFile: 'eyesOnAgents.js', rendererName: 'eyesOnAgents' },
  translator: { preloadFile: 'translator.js', rendererName: 'translator' },
  motto: { preloadFile: 'motto.js', rendererName: 'motto' },
};

const getCellDisplayUrl = (cell: Pick<
  OmniCellLayout,
  'contentMode' | 'miniAppId' | 'url'
>): string => {
  if (cell.contentMode === 'browser') return cell.url;
  return OMNI_MINI_APP_DISPLAY_URLS[cell.miniAppId];
};

const extractTreeLeaves = (node: OmniPaneNode): Array<Pick<
  OmniCellLayout,
  'id' | 'url' | 'contentMode' | 'miniAppId'
>> => {
  if (node.type === 'leaf') {
    return [{
      id: node.id,
      url: node.url!,
      contentMode: node.contentMode!,
      miniAppId: node.miniAppId!,
    }];
  }
  const results: Array<Pick<
    OmniCellLayout,
    'id' | 'url' | 'contentMode' | 'miniAppId'
  >> = [];
  for (const child of node.children || []) {
    results.push(...extractTreeLeaves(child));
  }
  return results;
};

interface CellViewPair {
  id: string;
  menubar: WebContentsView | null;
  content: WebContentsView;
  contentMode: OmniContentMode;
  miniAppId: OmniMiniAppId;
  browserProfile: OmniBrowserProfile | null;
  lastUrl: string;
}

export class OmniWindowHelper {
  baseWindow: BaseWindow | null = null;
  private menubarView: WebContentsView | null = null;
  private controlView: WebContentsView | null = null;
  private controlVisible = false;
  private cells: CellViewPair[] = [];
  private miniAppLoadFailures = new Map<string, OmniMiniAppId>();
  private recoveredFromInvalidLayout = false;
  private currentLayout: OmniCellLayout[] = [];
  private currentLayoutTree: OmniPaneNode | null = null;
  private _throttledApplyLayoutFn: (() => void) | null = null;
  private _throttledSaveLayoutToDaoFn: (() => void) | null = null;
  private readonly layoutCommitQueue = new OmniLayoutCommitQueue();
  private creationPromise: Promise<BaseWindow> | null = null;
  private _creationGeneration = 0;
  private _loadSemaphore = new Semaphore(3);
  private _abortTokens = new Set<{ abort: () => void }>();
  private windowStateController: WindowStateController | null = null;

  get isCreating(): boolean {
    return this.creationPromise !== null;
  }

  show(): void {
    const window = this.baseWindow;
    if (!window || window.isDestroyed()) return;
    if (this.windowStateController) {
      this.windowStateController.show();
    } else {
      if (window.isMinimized()) window.restore();
      window.show();
    }
    window.focus();
  }

  private throttledApplyLayout(): void {
    if (!this._throttledApplyLayoutFn) {
      this._throttledApplyLayoutFn = throttle(() => {
        this.applyLayoutInternal();
      }, 16, { trailing: true });
    }
    this._throttledApplyLayoutFn();
  }

  private throttledSaveLayoutToDao(): void {
    if (!this._throttledSaveLayoutToDaoFn) {
      this._throttledSaveLayoutToDaoFn = throttle(() => {
        this.saveLayoutToDao();
      }, 500, { trailing: true });
    }
    this._throttledSaveLayoutToDaoFn();
  }

  private isWebContentsAlive(wc: Electron.WebContents): boolean {
    return !wc.isDestroyed() && !wc.isCrashed();
  }

  private closeWebContentsView(view: WebContentsView | null): void {
    if (!view) return;
    try {
      if (this.isWebContentsAlive(view.webContents)) {
        view.webContents.close();
      }
    } catch {
      // already destroyed
    }
  }

  private cleanupAllViews(): void {
    // Abort all pending loadURL acquire() calls and flush the semaphore queue
    for (const token of this._abortTokens) token.abort();
    this._abortTokens.clear();
    this._loadSemaphore.drain();

    // Detach controlView from baseWindow before destroying (preserve singleton)
    if (this.controlView && this.baseWindow && !this.baseWindow.isDestroyed()) {
      try {
        if (this.controlVisible) {
          this.baseWindow.contentView.removeChildView(this.controlView);
        }
      } catch {
        // The control view may already be detached during window teardown.
      }
    }
    this.controlVisible = false;

    const cells = this.cells;
    this.cells = [];
    this.miniAppLoadFailures.clear();
    for (const cell of cells) {
      try {
        if (this.baseWindow && !this.baseWindow.isDestroyed()) {
          if (cell.menubar) this.baseWindow.contentView.removeChildView(cell.menubar);
          this.baseWindow.contentView.removeChildView(cell.content);
        }
        this.closeWebContentsView(cell.menubar);
        this.closeWebContentsView(cell.content);
      } catch {
        // view may already be destroyed
      }
    }
    this.closeWebContentsView(this.menubarView);
    this.menubarView = null;
    this.currentLayout = [];
    this.currentLayoutTree = null;

    if (this.baseWindow && !this.baseWindow.isDestroyed()) {
      this.windowStateController?.flushAndDispose();
      this.baseWindow.destroy();
    }
    this.baseWindow = null;
    this.windowStateController = null;

    // Clear ServiceWorkers so a stuck SW from either browser session doesn't survive into the next open
    for (const partition of OMNI_BROWSER_PARTITIONS) {
      session.fromPartition(partition)
        .clearStorageData({ storages: ['serviceworkers'] })
        .catch((err) => console.warn(`[OmniWindowHelper] Failed to clear SW for ${partition}:`, err));
    }
  }

  private async loadWindowLayout(): Promise<WindowLayout | null> {
    try {
      const layout = await settingEmitter.get<WindowLayout>({
        key: WINDOW_LAYOUT_KEY,
        sub_key: WINDOW_LAYOUT_SUB_KEY,
      });
      return layout;
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to load window layout:', err);
      return null;
    }
  }

  async create(): Promise<BaseWindow> {
    const current = this.baseWindow;
    if (current && !current.isDestroyed()) return current;
    if (this.creationPromise) return await this.creationPromise;

    this.cleanupAllViews();
    const creationGeneration = ++this._creationGeneration;
    const pending = this.createWindow(creationGeneration);
    this.creationPromise = pending;
    try {
      return await pending;
    } catch (error) {
      if (this._creationGeneration === creationGeneration) {
        this._creationGeneration += 1;
        this.cleanupAllViews();
      }
      throw error;
    } finally {
      if (this.creationPromise === pending) this.creationPromise = null;
    }
  }

  private async createWindow(creationGeneration: number): Promise<BaseWindow> {
    console.log('[OmniWindowHelper] create() called');

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const defaultWidth = Math.floor(screenWidth * 0.7);
    const defaultHeight = Math.floor(screenHeight * 0.7);

    if (!windowStateService.has('omni')) {
      const legacyLayout = await this.loadWindowLayout();
      this.assertCreationActive(creationGeneration);
      if (legacyLayout) windowStateService.importLegacy('omni', legacyLayout);
    }
    const restored = windowStateService.resolve('omni');

    const windowOptions: any = {
      width: restored?.bounds.width ?? defaultWidth,
      height: restored?.bounds.height ?? defaultHeight,
      minWidth: 800,
      minHeight: 600,
      title: 'Omni Browser',
      show: false,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 8 } }
        : { frame: false }),
    };

    if (restored) {
      windowOptions.x = restored.bounds.x;
      windowOptions.y = restored.bounds.y;
    }

    const createdWindow = new BaseWindow(windowOptions);
    this.baseWindow = createdWindow;
    const stateController = windowStateService.register('omni', createdWindow);
    this.windowStateController = stateController;
    console.log('[OmniWindowHelper] BaseWindow created');

    // Create top menubar view
    const menubarView = this.createWebContentsView('omniWindow');
    this.menubarView = menubarView;
    createdWindow.contentView.addChildView(menubarView);
    console.log('[OmniWindowHelper] menubarView added');

    // BaseWindow does not emit 'ready-to-show' (that is a BrowserWindow event).
    // Show the window once the menubar webContents finishes loading instead.
    menubarView.webContents.on('did-finish-load', () => {
      if (!this.isCreationActive(creationGeneration, createdWindow)) return;
      console.log('[OmniWindowHelper] menubar did-finish-load, showing window');
      stateController.show();
    });

    createdWindow.on('closed' as any, () => {
      console.log('[OmniWindowHelper] baseWindow closed, cleaning up');
      if (this.baseWindow === createdWindow) {
        this._creationGeneration += 1;
        this.cleanupAllViews();
      }
    });

    createdWindow.on('resize' as any, () => {
      if (this.baseWindow !== createdWindow) return;
      this.throttledApplyLayout();
      this.updateMenubarBounds();
      this.updateControlBounds();
    });

    this.updateMenubarBounds();
    this.updateControlBounds();

    // Create controlView singleton (reuse across window open/close cycles)
    if (!this.controlView || !this.isWebContentsAlive(this.controlView.webContents)) {
      this.controlView = this.createWebContentsView('omniControl');
      this.controlView.setBackgroundColor('#00000000');
      this.controlView.webContents.on('did-finish-load', () => {
        this.replayControlState();
      });
      console.log('[OmniWindowHelper] controlView singleton created');
    }
    // Set proper bounds even when hidden — prevents splitpanes layout thrashing in a 0×0 container
    const [cvWidth, cvHeight] = createdWindow.getContentSize();
    this.controlView.setBounds({
      x: 0,
      y: MENUBAR_HEIGHT,
      width: cvWidth,
      height: Math.max(cvHeight - MENUBAR_HEIGHT, 0),
    });

    const shouldOpenDevTools = import.meta.env.VITE_ENV === 'dev' || import.meta.env.VITE_MODE === 'debug';
    if (shouldOpenDevTools) {
      menubarView.webContents.openDevTools({ mode: 'detach' });
    }

    // Permission handler: deny notifications for specific domains (e.g. larksuite.com),
    // allow for all others so the executeJavaScript override can intercept them instead.
    const NOTIFICATION_BLOCKED_DOMAINS = ['larksuite.com'];
    for (const partition of OMNI_BROWSER_PARTITIONS) {
      session.fromPartition(partition).setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'notifications') {
          try {
            const hostname = new URL(webContents.getURL()).hostname;
            const blocked = NOTIFICATION_BLOCKED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
            if (blocked) {
              console.log(`[OmniWindowHelper] Notification permission denied for ${hostname}`);
              callback(false);
              return;
            }
          } catch {
            callback(false);
            return;
          }
        }
        callback(true);
      });
    }

    // Restore saved cell layout so cells appear immediately on window open
    await this.restoreSavedLayout(creationGeneration);
    this.assertCreationActive(creationGeneration, createdWindow);

    return createdWindow;
  }

  toggleControl(): void {
    if (!this.baseWindow || this.baseWindow.isDestroyed() || !this.controlView) return;

    this.controlVisible = !this.controlVisible;
    if (this.controlVisible) {
      this.baseWindow.contentView.addChildView(this.controlView);
      this.controlView.setVisible(true);
      this.updateControlBounds();
      this.replayControlState();
    } else {
      this.controlView.setVisible(false);
      this.baseWindow.contentView.removeChildView(this.controlView);
    }
  }

  getLayoutConfig(): OmniLayoutConfig | null {
    if (!this.currentLayoutTree) return null;
    return { tree: parseOmniPaneTree(this.currentLayoutTree) };
  }

  async commitLayout(tree: OmniPaneNode): Promise<void> {
    const committedTree = parseOmniPaneTree(tree);
    await this.layoutCommitQueue.enqueue(async () => {
      this.updateLayout(committedTree);
      await this.persistLayoutToDao();
    });
  }

  updateLayout(tree: OmniPaneNode): void {
    const normalizedTree = parseOmniPaneTree(tree);
    const normalizedCells: OmniCellLayout[] = extractTreeLeaves(normalizedTree).map((leaf) => ({
      ...leaf,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }));
    this.currentLayout = normalizedCells;
    this.currentLayoutTree = normalizedTree;

    const nextCellsById = new Map(normalizedCells.map((cell) => [cell.id, cell]));
    for (const [cellId, failedMiniAppId] of this.miniAppLoadFailures) {
      const nextCell = nextCellsById.get(cellId);
      if (
        !nextCell ||
        nextCell.contentMode !== 'miniapp' ||
        nextCell.miniAppId !== failedMiniAppId
      ) this.miniAppLoadFailures.delete(cellId);
    }

    // Remove deleted cells and recreate only cells whose content runtime changed.
    const toRemove = this.cells.filter((cell) => {
      const next = normalizedCells.find((candidate) => candidate.id === cell.id);
      return !next ||
        next.contentMode !== cell.contentMode ||
        next.miniAppId !== cell.miniAppId;
    });
    this.cells = this.cells.filter((cell) => !toRemove.includes(cell));
    for (const cell of toRemove) {
      this.removeCellViews(cell);
    }

    // Add new cells
    for (const layoutCell of normalizedCells) {
      if (!this.cells.some((cell) => cell.id === layoutCell.id)) {
        this.addCell(layoutCell);
      }
    }

    this.applyLayoutInternal();
  }

  navigateCell(cellId: string, url: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (
      !cell ||
      cell.contentMode !== 'browser' ||
      !this.isWebContentsAlive(cell.content.webContents)
    ) return;
    const nextProfile = resolveOmniBrowserProfile(url);
    if (!nextProfile) {
      cell.content.webContents.loadURL(url).catch(() => {});
      return;
    }
    if (cell.browserProfile !== nextProfile) {
      this.replaceBrowserCellContentView(cell, url, nextProfile);
      return;
    }
    cell.content.webContents.loadURL(url).catch(() => {});
  }

  cellGoBack(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (
      cell?.contentMode === 'browser' &&
      this.isWebContentsAlive(cell.content.webContents) &&
      cell.content.webContents.canGoBack()
    ) {
      cell.content.webContents.goBack();
    }
  }

  cellGoForward(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (
      cell?.contentMode === 'browser' &&
      this.isWebContentsAlive(cell.content.webContents) &&
      cell.content.webContents.canGoForward()
    ) {
      cell.content.webContents.goForward();
    }
  }

  cellRefresh(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (cell && this.isWebContentsAlive(cell.content.webContents)) {
      cell.content.webContents.reload();
    }
  }

  closeCell(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (cell) {
      this.cells = this.cells.filter((c) => c.id !== cellId);
      this.miniAppLoadFailures.delete(cellId);
      this.removeCellViews(cell);
    }
  }

  destroy(): void {
    this._creationGeneration += 1;
    this.creationPromise = null;
    this.cleanupAllViews();
    // Destroy the singleton controlView only on full destroy (app quit)
    this.closeWebContentsView(this.controlView);
    this.controlView = null;
  }

  private createBrowserCellContentView(profile: OmniBrowserProfile): WebContentsView {
    const browserSession = session.fromPartition(
      profile === 'google' ? OMNI_GOOGLE_PARTITION : OMNI_PARTITION,
    );
    const userAgent = profile === 'google'
      ? buildGoogleProfileUserAgent(browserSession.getUserAgent())
      : null;
    if (userAgent) browserSession.setUserAgent(userAgent);

    const content = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/omniCellContent.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        session: browserSession,
      },
    });
    if (userAgent) content.webContents.setUserAgent(userAgent);
    return content;
  }

  private createMiniAppCellContentView(preloadPath: string): WebContentsView {
    return new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: ['--mode=omni'],
      },
    });
  }

  private getMiniAppRendererTarget(miniAppId: OmniMiniAppId): OmniMiniAppRendererTarget {
    const { rendererName } = OMNI_MINI_APP_RUNTIME[miniAppId];
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const rendererBaseUrl = process.env['ELECTRON_RENDERER_URL'].replace(/\/+$/, '');
      return {
        filePath: null,
        url: `${rendererBaseUrl}/${rendererName}/index.html`,
      };
    }
    const filePath = join(app.getAppPath(), 'out', 'renderer', rendererName, 'index.html');
    return {
      filePath,
      url: pathToFileURL(filePath).href,
    };
  }

  private resolveMiniAppRuntime(miniAppId: OmniMiniAppId): ResolvedOmniMiniAppRuntime {
    const runtime = OMNI_MINI_APP_RUNTIME[miniAppId];
    const preloadPath = join(app.getAppPath(), 'out', 'preload', runtime.preloadFile);
    if (!existsSync(preloadPath)) {
      throw new Error(`expected preload does not exist: ${preloadPath}`);
    }

    const rendererTarget = this.getMiniAppRendererTarget(miniAppId);
    if (rendererTarget.filePath && !existsSync(rendererTarget.filePath)) {
      throw new Error(`expected renderer does not exist: ${rendererTarget.filePath}`);
    }

    return { preloadPath, rendererTarget };
  }

  private broadcastMiniAppLoadState(params: OmniMiniAppLoadState): void {
    if (params.status === 'failed') {
      this.miniAppLoadFailures.set(params.cellId, params.miniAppId);
    } else {
      this.miniAppLoadFailures.delete(params.cellId);
    }
    xpcMain.broadcast(OMNI_MINI_APP_LOAD_STATE_EVENT, params);
  }

  private replayMiniAppLoadFailures(): void {
    for (const [cellId, miniAppId] of this.miniAppLoadFailures) {
      xpcMain.broadcast(OMNI_MINI_APP_LOAD_STATE_EVENT, {
        cellId,
        miniAppId,
        status: 'failed',
      } satisfies OmniMiniAppLoadState);
    }
  }

  private broadcastLayoutRecoveryState(): void {
    xpcMain.broadcast(OMNI_LAYOUT_RECOVERY_STATE_EVENT, {
      recoveredFromInvalidLayout: this.recoveredFromInvalidLayout,
    } satisfies OmniLayoutRecoveryState);
  }

  private replayControlState(): void {
    this.replayMiniAppLoadFailures();
    this.broadcastLayoutRecoveryState();
    const config = this.getLayoutConfig();
    if (config) xpcMain.broadcast(OMNI_LAYOUT_SNAPSHOT_EVENT, config);
  }

  private setLayoutRecoveryState(recoveredFromInvalidLayout: boolean): void {
    this.recoveredFromInvalidLayout = recoveredFromInvalidLayout;
    this.broadcastLayoutRecoveryState();
  }

  private reportMiniAppLoadFailure(params: {
    cellId: string;
    miniAppId: OmniMiniAppId;
    stage: 'target-validation' | 'renderer-load' | 'renderer-process';
    expectedTarget: string;
    error: unknown;
  }): void {
    const detail = params.error instanceof Error ? params.error.message : 'unknown error';
    console.error(
      `[OmniWindowHelper] Mini app ${params.miniAppId} ${params.stage} failed; expected ${params.expectedTarget}: ${detail}`,
    );
    this.broadcastMiniAppLoadState({
      cellId: params.cellId,
      miniAppId: params.miniAppId,
      status: 'failed',
    });
  }

  private loadMiniAppCellContent(
    content: WebContentsView,
    params: {
      cellId: string;
      miniAppId: OmniMiniAppId;
      target: OmniMiniAppRendererTarget;
    },
  ): void {
    const { cellId, miniAppId, target } = params;
    const loadPromise = target.filePath
      ? content.webContents.loadFile(target.filePath)
      : content.webContents.loadURL(target.url);
    loadPromise.then(() => {
      const cell = this.cells.find(
        (candidate) => candidate.id === cellId && candidate.content === content,
      );
      if (!cell) return;
      this.broadcastMiniAppLoadState({ cellId, miniAppId, status: 'ready' });
    }).catch((error) => {
      const cell = this.cells.find(
        (candidate) => candidate.id === cellId && candidate.content === content,
      );
      if (!cell) return;
      this.reportMiniAppLoadFailure({
        cellId,
        miniAppId,
        stage: 'renderer-load',
        expectedTarget: target.url,
        error,
      });
      this.cells = this.cells.filter((candidate) => candidate !== cell);
      this.removeCellViews(cell);
    });
  }

  private addCell(layoutCell: OmniCellLayout): void {
    if (!this.baseWindow) return;

    const { id, url, contentMode, miniAppId } = layoutCell;
    const displayUrl = getCellDisplayUrl(layoutCell);
    const browserProfile = contentMode === 'browser'
      ? resolveOmniBrowserProfile(url) ?? 'default'
      : null;
    let miniAppRuntime: ResolvedOmniMiniAppRuntime | null = null;

    if (contentMode === 'miniapp') {
      try {
        miniAppRuntime = this.resolveMiniAppRuntime(miniAppId);
      } catch (error) {
        this.reportMiniAppLoadFailure({
          cellId: id,
          miniAppId,
          stage: 'target-validation',
          expectedTarget: join(app.getAppPath(), 'out'),
          error,
        });
        return;
      }
    }

    const menubar = contentMode === 'browser'
      ? this.createWebContentsView('omniCell', [
        `--cellId=${id}`,
        `--initialUrl=${displayUrl}`,
        `--contentMode=${contentMode}`,
      ])
      : null;
    if (menubar) this.baseWindow.contentView.addChildView(menubar);

    const content = contentMode === 'browser'
      ? this.createBrowserCellContentView(browserProfile!)
      : this.createMiniAppCellContentView(miniAppRuntime!.preloadPath);
    this.baseWindow.contentView.addChildView(content);

    if (contentMode === 'browser') {
      this.configureBrowserCellContentView(id, content);
    } else {
      // Mini-app cells have privileged first-party preloads. Never allow one to become a browser.
      const expectedRendererUrl = miniAppRuntime!.rendererTarget.url;
      content.webContents.setWindowOpenHandler((details) => {
        if (/^https?:\/\//i.test(details.url)) shell.openExternal(details.url);
        return { action: 'deny' };
      });
      content.webContents.on('will-navigate', (event, navigationUrl) => {
        if (navigationUrl === expectedRendererUrl) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(navigationUrl)) shell.openExternal(navigationUrl);
      });
    }

    // Browser-only chrome may mount after the page has already navigated.
    if (menubar) {
      menubar.webContents.on('did-finish-load', () => {
        const currentContent = this.cells.find((candidate) => candidate.id === id)?.content
          ?? content;
        if (!this.isWebContentsAlive(menubar.webContents)) return;
        if (!this.isWebContentsAlive(currentContent.webContents)) return;
        const currentUrl = currentContent.webContents.getURL();
        xpcMain.broadcast('omniCell/urlChanged', { cellId: id, url: currentUrl || url });
        this.notifyControlUrlChanged(id, currentUrl || url);
      });
    }

    if (menubar) {
      menubar.webContents.on('focus' as any, () => {
        if (!this.isWebContentsAlive(menubar.webContents)) return;
        this.broadcastActiveCell(id);
      });
    }

    const cell: CellViewPair = {
      id,
      menubar,
      content,
      contentMode,
      miniAppId,
      browserProfile,
      lastUrl: url || '',
    };

    this.bindCellContentLifecycle(cell, content, miniAppRuntime);

    this.cells.push(cell);

    if (contentMode === 'miniapp' && miniAppRuntime) {
      this.loadMiniAppCellContent(content, {
        cellId: id,
        miniAppId,
        target: miniAppRuntime.rendererTarget,
      });
    } else if (url) {
      // Semaphore (capacity 3): stagger concurrent URL loads to avoid overwhelming the shared session.
      // aborted is set to true by drain() path — checked after acquire() resolves to skip destroyed views.
      let aborted = false;
      const abortToken = { abort: () => { aborted = true; } };
      this._abortTokens.add(abortToken);

      this._loadSemaphore.acquire().then(() => {
        this._abortTokens.delete(abortToken);
        if (aborted || !this.isWebContentsAlive(content.webContents)) {
          this._loadSemaphore.release();
          return;
        }
        let released = false;
        const releaseOnce = () => {
          if (released) return;
          released = true;
          setTimeout(() => this._loadSemaphore.release(), 1000);
        };
        const timeoutId = setTimeout(releaseOnce, 30_000);
        content.webContents.once('did-finish-load', () => { clearTimeout(timeoutId); releaseOnce(); });
        content.webContents.once('did-fail-load', () => { clearTimeout(timeoutId); releaseOnce(); });
        content.webContents.once('did-fail-provisional-load', () => { clearTimeout(timeoutId); releaseOnce(); });
        content.webContents.once('render-process-gone', () => { clearTimeout(timeoutId); releaseOnce(); });
        content.webContents.loadURL(url).catch(() => {});
      });
    }

    // Ensure control overlay stays on top
    if (this.controlVisible && this.controlView) {
      this.baseWindow.contentView.removeChildView(this.controlView);
      this.baseWindow.contentView.addChildView(this.controlView);
    }
  }

  private configureBrowserCellContentView(id: string, content: WebContentsView): void {
    content.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    content.webContents.on('did-navigate', (_e, navUrl) => {
      const cell = this.cells.find((candidate) => candidate.id === id);
      if (cell?.content !== content) return;
      if (!this.isWebContentsAlive(content.webContents)) return;
      this.notifyCellUrl(id, navUrl);
    });
    content.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      const cell = this.cells.find((candidate) => candidate.id === id);
      if (cell?.content !== content) return;
      if (!this.isWebContentsAlive(content.webContents)) return;
      this.notifyCellUrl(id, navUrl);
    });

    // Block remote pages from setting app badge (e.g. Telegram Web)
    // Also override Notification in the main world (executeJavaScript runs in main world,
    // bypassing contextIsolation — preload-level assignment only affects the isolated world).
    content.webContents.on('dom-ready', () => {
      if (!this.isWebContentsAlive(content.webContents)) return;
      content.webContents.executeJavaScript(`
      if ('setAppBadge' in navigator) {
        navigator.setAppBadge = () => Promise.resolve();
      }
      if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge = () => Promise.resolve();
      }

      // Layer 1: override window.Notification in main world
      window.Notification = class InterceptedNotification {
        static permission = 'granted';
        static requestPermission() { return Promise.resolve('granted'); }
        constructor(title, options) {
          console.log('[OmniCell] Notification intercepted:', { title, body: options && options.body, tag: options && options.tag, time: new Date().toISOString() });
        }
        addEventListener() {} removeEventListener() {} dispatchEvent() { return false; } close() {}
      };

      // Layer 2: override ServiceWorker showNotification (handles SW-triggered notifications)
      function patchSWRegistration(reg) {
        reg.showNotification = function(title, options) {
          console.log('[OmniCell] SW showNotification intercepted:', { title, body: options && options.body, tag: options && options.tag, time: new Date().toISOString() });
          return Promise.resolve();
        };
      }
      if (navigator.serviceWorker) {
        navigator.serviceWorker.ready.then(patchSWRegistration).catch(function(){});
        var _origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
        navigator.serviceWorker.register = function() {
          return _origRegister.apply(null, arguments).then(function(reg) {
            patchSWRegistration(reg);
            return reg;
          });
        };
      }
      `).catch(() => {});
    });
  }

  private bindCellContentLifecycle(
    cell: CellViewPair,
    content: WebContentsView,
    miniAppRuntime: ResolvedOmniMiniAppRuntime | null,
  ): void {
    content.webContents.on('focus' as any, () => {
      if (cell.content !== content) return;
      if (!this.isWebContentsAlive(content.webContents)) return;
      this.broadcastActiveCell(cell.id);
    });

    content.webContents.on('render-process-gone', (_e, details) => {
      if (!this.cells.includes(cell) || cell.content !== content) return;
      if (cell.contentMode === 'miniapp' && miniAppRuntime) {
        this.reportMiniAppLoadFailure({
          cellId: cell.id,
          miniAppId: cell.miniAppId,
          stage: 'renderer-process',
          expectedTarget: miniAppRuntime.rendererTarget.url,
          error: new Error(details.reason),
        });
      } else {
        console.warn(`[OmniWindowHelper] Cell ${cell.id} renderer crashed:`, details.reason);
      }
      this.cells = this.cells.filter((candidate) => candidate !== cell);
      this.removeCellViews(cell);
    });
  }

  private replaceBrowserCellContentView(
    cell: CellViewPair,
    url: string,
    profile: OmniBrowserProfile,
  ): void {
    if (!this.baseWindow || this.baseWindow.isDestroyed()) return;

    const previousContent = cell.content;
    const content = this.createBrowserCellContentView(profile);
    this.configureBrowserCellContentView(cell.id, content);
    cell.content = content;
    cell.browserProfile = profile;
    this.bindCellContentLifecycle(cell, content, null);

    this.baseWindow.contentView.removeChildView(previousContent);
    this.closeWebContentsView(previousContent);
    this.baseWindow.contentView.addChildView(content);
    this.applyLayoutInternal();

    if (this.controlVisible && this.controlView) {
      this.baseWindow.contentView.removeChildView(this.controlView);
      this.baseWindow.contentView.addChildView(this.controlView);
    }

    content.webContents.loadURL(url).catch(() => {});
  }

  private removeCellViews(cell: CellViewPair): void {
    try {
      if (this.baseWindow && !this.baseWindow.isDestroyed()) {
        if (cell.menubar) this.baseWindow.contentView.removeChildView(cell.menubar);
        this.baseWindow.contentView.removeChildView(cell.content);
      }
      this.closeWebContentsView(cell.menubar);
      this.closeWebContentsView(cell.content);
    } catch {
      // view may already be destroyed
    }
  }

  private notifyCellUrl(cellId: string, url: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (!cell) return;
    // Skip if URL unchanged — SPA replaceState may fire did-navigate-in-page with the same URL
    if (cell.lastUrl === url) return;
    cell.lastUrl = url;

    xpcMain.broadcast('omniCell/urlChanged', { cellId, url });
    this.notifyControlUrlChanged(cellId, url);

    // Update tree and save to SettingDao (throttled to avoid excessive writes from SPA navigations)
    if (this.updateTreeUrl(this.currentLayoutTree, cellId, url)) {
      this.throttledSaveLayoutToDao();
    }
  }

  private broadcastActiveCell(activeCellId: string): void {
    xpcMain.broadcast('omniCell/activeChanged', { activeCellId });
  }

  private notifyControlUrlChanged(cellId: string, url: string): void {
    xpcMain.broadcast('omniControl/cellUrlChanged', { cellId, url });
  }

  private updateTreeUrl(tree: OmniPaneNode | null, cellId: string, url: string): boolean {
    if (!tree) return false;
    if (tree.type === 'leaf' && tree.id === cellId) {
      tree.url = url;
      return true;
    }
    if (tree.children) {
      for (const child of tree.children) {
        if (this.updateTreeUrl(child, cellId, url)) return true;
      }
    }
    return false;
  }

  private async restoreSavedLayout(creationGeneration: number): Promise<void> {
    try {
      const persistedValue = await settingEmitter.get<unknown>({ key: LAYOUT_KEY });
      if (this._creationGeneration !== creationGeneration) return;
      if (persistedValue === null || persistedValue === undefined) {
        this.restoreDefaultBrowserLayout();
        this.setLayoutRecoveryState(false);
        return;
      }
      const config = parseOmniLayoutConfig(persistedValue);
      const leaves = extractTreeLeaves(config.tree);
      this.updateLayout(config.tree);
      this.setLayoutRecoveryState(false);
      console.log('[OmniWindowHelper] Restored saved layout with', leaves.length, 'cells');
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to restore saved layout:', err);
      if (this._creationGeneration !== creationGeneration) return;
      this.restoreDefaultBrowserLayout();
      this.setLayoutRecoveryState(true);
    }
  }

  private restoreDefaultBrowserLayout(): void {
    const tree = createDefaultOmniLayoutTree();
    this.updateLayout(tree);
  }

  private isCreationActive(
    creationGeneration: number,
    createdWindow?: BaseWindow,
  ): boolean {
    return this._creationGeneration === creationGeneration &&
      (!createdWindow || (
        this.baseWindow === createdWindow &&
        !createdWindow.isDestroyed()
      ));
  }

  private assertCreationActive(
    creationGeneration: number,
    createdWindow?: BaseWindow,
  ): void {
    if (!this.isCreationActive(creationGeneration, createdWindow)) {
      throw new Error('[OmniWindowHelper] Window creation was cancelled');
    }
  }

  async saveLayoutToDao(): Promise<void> {
    try {
      await this.persistLayoutToDao();
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to save layout:', err);
    }
  }

  private async persistLayoutToDao(): Promise<void> {
    if (!this.currentLayoutTree) return;
    const config = parseOmniLayoutConfig({ tree: this.currentLayoutTree });
    this.currentLayoutTree = config.tree;
    await settingEmitter.upsert({ key: LAYOUT_KEY, value: config });
    console.log('[OmniWindowHelper] Layout saved to SettingDao');
  }

  private setCellBounds(
    cell: CellViewPair,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const viewBounds = resolveOmniCellViewBounds(
      bounds,
      cell.menubar ? OMNI_BROWSER_HEADER_HEIGHT : 0,
    );
    if (cell.menubar && viewBounds.header) cell.menubar.setBounds(viewBounds.header);
    cell.content.setBounds(viewBounds.content);
  }

  private applyLayoutInternal(): void {
    if (!this.baseWindow) return;
    const [contentWidth, contentHeight] = this.baseWindow.getContentSize();
    const areaTop = MENUBAR_HEIGHT;
    const areaWidth = contentWidth;
    const areaHeight = contentHeight - MENUBAR_HEIGHT;

    if (this.currentLayoutTree) {
      const pixelCells = flattenOmniPaneTreePixels(this.currentLayoutTree, {
        x: 0,
        y: areaTop,
        width: areaWidth,
        height: areaHeight,
      });
      for (const layoutCell of pixelCells) {
        const cell = this.cells.find((c) => c.id === layoutCell.id);
        if (!cell) continue;
        const { x, y, width: w, height: h } = layoutCell;
        this.setCellBounds(cell, { x, y, width: w, height: h });
      }
      return;
    }

    // Fallback: percentage-based (before tree is available)
    for (const layoutCell of this.currentLayout) {
      const cell = this.cells.find((c) => c.id === layoutCell.id);
      if (!cell) continue;
      const x = Math.round(areaWidth * (layoutCell.x / 100));
      const y = Math.round(areaTop + areaHeight * (layoutCell.y / 100));
      const w = Math.round(areaWidth * (layoutCell.width / 100));
      const h = Math.round(areaHeight * (layoutCell.height / 100));
      this.setCellBounds(cell, { x, y, width: w, height: h });
    }
  }

  private updateMenubarBounds(): void {
    if (!this.baseWindow || !this.menubarView) return;
    const [contentWidth] = this.baseWindow.getContentSize();
    this.menubarView.setBounds({
      x: 0,
      y: 0,
      width: contentWidth,
      height: MENUBAR_HEIGHT,
    });
  }

  private updateControlBounds(): void {
    if (!this.baseWindow || !this.controlView || !this.controlVisible) return;
    const [contentWidth, contentHeight] = this.baseWindow.getContentSize();
    this.controlView.setBounds({
      x: 0,
      y: MENUBAR_HEIGHT,
      width: contentWidth,
      height: Math.max(contentHeight - MENUBAR_HEIGHT, 0),
    });
  }

  private createWebContentsView(
    rendererName: string,
    additionalArguments: string[] = [],
  ): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/omni.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments,
      },
    });

    const rendererPath = `omni/${rendererName}/index.html`;

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${rendererPath}`);
    } else {
      view.webContents.loadFile(join(__dirname, `../renderer/${rendererPath}`));
    }

    return view;
  }
}

export const omniWindowHelper = new OmniWindowHelper();
