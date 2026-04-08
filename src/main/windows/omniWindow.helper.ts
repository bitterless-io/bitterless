import { BaseWindow, WebContentsView, screen, session, shell } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { throttle } from 'es-toolkit';
import type { OmniCellLayout, OmniLayoutConfig, OmniPaneNode } from '@shared/omni/omni.types';
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import type { WindowLayout } from '@shared/window/window.types';

const LAYOUT_KEY = 'omni_layout';
const WINDOW_LAYOUT_KEY = 'window_layout';
const WINDOW_LAYOUT_SUB_KEY = 'omni';
const settingEmitter = createXpcMainEmitter<SettingDao>('SettingDao');

class Semaphore {
  private _count: number;
  private _queue: Array<() => void> = [];
  constructor(capacity: number) { this._count = capacity; }
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
}

const MENUBAR_HEIGHT = 32;
const CELL_MENUBAR_HEIGHT = 36;
const DIVIDER_SIZE = 4;
const OMNI_PARTITION = 'persist:omni';
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

function flattenTreePixels(
  node: OmniPaneNode,
  x: number,
  y: number,
  width: number,
  height: number,
): Array<{ id: string; url: string; x: number; y: number; width: number; height: number }> {
  if (node.type === 'leaf') {
    return [{ id: node.id, url: node.url || '', x, y, width, height }];
  }

  const results: Array<{ id: string; url: string; x: number; y: number; width: number; height: number }> = [];
  const children = node.children || [];
  const n = children.length;
  if (n === 0) return results;

  const rawSizes = node.sizes && node.sizes.length === n ? node.sizes : children.map(() => 100 / n);
  // Normalize sizes to sum exactly to 100
  const totalSize = rawSizes.reduce((s, v) => s + v, 0);
  const sizes = rawSizes.map((v) => (v / totalSize) * 100);

  const totalDividers = (n - 1) * DIVIDER_SIZE;

  if (node.direction === 'h') {
    const available = width - totalDividers;
    let offsetX = x;
    for (let i = 0; i < n; i++) {
      const paneW = i === n - 1 ? x + width - offsetX : Math.round(available * sizes[i] / 100);
      results.push(...flattenTreePixels(children[i], offsetX, y, paneW, height));
      offsetX += paneW + DIVIDER_SIZE;
    }
  } else {
    const available = height - totalDividers;
    let offsetY = y;
    for (let i = 0; i < n; i++) {
      const paneH = i === n - 1 ? y + height - offsetY : Math.round(available * sizes[i] / 100);
      results.push(...flattenTreePixels(children[i], x, offsetY, width, paneH));
      offsetY += paneH + DIVIDER_SIZE;
    }
  }

  return results;
}

function extractTreeLeaves(node: OmniPaneNode): Array<{ id: string; url: string }> {
  if (node.type === 'leaf') return [{ id: node.id, url: node.url || '' }];
  const results: Array<{ id: string; url: string }> = [];
  for (const child of node.children || []) {
    results.push(...extractTreeLeaves(child));
  }
  return results;
}

interface CellViewPair {
  id: string;
  menubar: WebContentsView;
  browser: WebContentsView;
  lastUrl: string;
}

export class OmniWindowHelper {
  baseWindow: BaseWindow | null = null;
  private menubarView: WebContentsView | null = null;
  private controlView: WebContentsView | null = null;
  private controlVisible = false;
  private cells: CellViewPair[] = [];
  private currentLayout: OmniCellLayout[] = [];
  private currentLayoutTree: OmniPaneNode | null = null;
  private _throttledApplyLayoutFn: (() => void) | null = null;
  private _throttledSaveWindowLayoutFn: (() => void) | null = null;
  private _throttledSaveLayoutToDaoFn: (() => void) | null = null;
  private _creating = false;
  private _loadSemaphore = new Semaphore(3);

  get isCreating(): boolean {
    return this._creating;
  }

  private throttledApplyLayout(): void {
    if (!this._throttledApplyLayoutFn) {
      this._throttledApplyLayoutFn = throttle(() => {
        this.applyLayoutInternal();
      }, 16, { trailing: true });
    }
    this._throttledApplyLayoutFn();
  }

  private throttledSaveWindowLayout(): void {
    if (!this._throttledSaveWindowLayoutFn) {
      this._throttledSaveWindowLayoutFn = throttle(() => {
        this.saveWindowLayout();
      }, 100, { trailing: true });
    }
    this._throttledSaveWindowLayoutFn();
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
    // Detach controlView from baseWindow before destroying (preserve singleton)
    if (this.controlView && this.baseWindow && !this.baseWindow.isDestroyed()) {
      try {
        if (this.controlVisible) {
          this.baseWindow.contentView.removeChildView(this.controlView);
        }
      } catch {}
    }
    this.controlVisible = false;

    for (const cell of this.cells) {
      try {
        if (this.baseWindow && !this.baseWindow.isDestroyed()) {
          this.baseWindow.contentView.removeChildView(cell.menubar);
          this.baseWindow.contentView.removeChildView(cell.browser);
        }
        this.closeWebContentsView(cell.menubar);
        this.closeWebContentsView(cell.browser);
      } catch {
        // view may already be destroyed
      }
    }
    this.cells = [];

    this.closeWebContentsView(this.menubarView);
    this.menubarView = null;
    this.currentLayout = [];
    this.currentLayoutTree = null;

    if (this.baseWindow && !this.baseWindow.isDestroyed()) {
      this.baseWindow.destroy();
    }
    this.baseWindow = null;

    // Clear ServiceWorkers so a stuck SW from this session doesn't survive into the next open
    session.fromPartition(OMNI_PARTITION)
      .clearStorageData({ storages: ['serviceworkers'] })
      .catch((err) => console.warn('[OmniWindowHelper] Failed to clear SW:', err));
  }

  private async saveWindowLayout(): Promise<void> {
    if (!this.baseWindow || this.baseWindow.isDestroyed()) return;
    try {
      const bounds = this.baseWindow.getBounds();
      const layout: WindowLayout = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
      await settingEmitter.upsert({
        key: WINDOW_LAYOUT_KEY,
        sub_key: WINDOW_LAYOUT_SUB_KEY,
        value: layout,
      });
      console.log('[OmniWindowHelper] Window layout saved:', layout);
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to save window layout:', err);
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
    if (this._creating) {
      console.log('[OmniWindowHelper] create() already in progress, skipping');
      return this.baseWindow!;
    }
    this._creating = true;
    console.log('[OmniWindowHelper] create() called');
    try {
    this.cleanupAllViews();

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const defaultWidth = Math.floor(screenWidth * 0.7);
    const defaultHeight = Math.floor(screenHeight * 0.7);

    const savedLayout = await this.loadWindowLayout();

    const windowOptions: any = {
      width: savedLayout?.width ?? defaultWidth,
      height: savedLayout?.height ?? defaultHeight,
      minWidth: 800,
      minHeight: 600,
      title: 'Omni Browser',
      show: false,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 8 } }
        : { frame: false }),
    };

    if (savedLayout) {
      windowOptions.x = savedLayout.x;
      windowOptions.y = savedLayout.y;
    }

    this.baseWindow = new BaseWindow(windowOptions);
    console.log('[OmniWindowHelper] BaseWindow created');

    // Create top menubar view
    this.menubarView = this.createWebContentsView('omniWindow');
    this.baseWindow.contentView.addChildView(this.menubarView);
    console.log('[OmniWindowHelper] menubarView added');

    // BaseWindow does not emit 'ready-to-show' (that is a BrowserWindow event).
    // Show the window once the menubar webContents finishes loading instead.
    this.menubarView.webContents.on('did-finish-load', () => {
      console.log('[OmniWindowHelper] menubar did-finish-load, showing window');
      this.baseWindow?.show();
    });

    this.baseWindow.on('closed' as any, () => {
      console.log('[OmniWindowHelper] baseWindow closed, cleaning up');
      this.cleanupAllViews();
    });

    this.baseWindow.on('resize' as any, () => {
      this.throttledApplyLayout();
      this.updateMenubarBounds();
      this.updateControlBounds();
      this.throttledSaveWindowLayout();
    });

    this.baseWindow.on('move' as any, () => {
      this.throttledSaveWindowLayout();
    });

    this.updateMenubarBounds();
    this.updateControlBounds();

    // Create controlView singleton (reuse across window open/close cycles)
    if (!this.controlView || !this.isWebContentsAlive(this.controlView.webContents)) {
      this.controlView = this.createWebContentsView('omniControl');
      this.controlView.setBackgroundColor('#00000000');
      console.log('[OmniWindowHelper] controlView singleton created');
    }
    // Set proper bounds even when hidden — prevents splitpanes layout thrashing in a 0×0 container
    const [cvWidth, cvHeight] = this.baseWindow.getContentSize();
    this.controlView.setBounds({
      x: 0,
      y: MENUBAR_HEIGHT,
      width: cvWidth,
      height: Math.max(cvHeight - MENUBAR_HEIGHT, 0),
    });

    const shouldOpenDevTools = import.meta.env.VITE_ENV === 'dev' || import.meta.env.VITE_MODE === 'debug';
    if (shouldOpenDevTools) {
      this.menubarView.webContents.openDevTools({ mode: 'detach' });
    }

    // Restore saved cell layout so cells appear immediately on window open
    await this.restoreSavedLayout();

    return this.baseWindow;
    } finally {
      this._creating = false;
    }
  }

  toggleControl(): void {
    if (!this.baseWindow || this.baseWindow.isDestroyed() || !this.controlView) return;

    this.controlVisible = !this.controlVisible;
    if (this.controlVisible) {
      this.baseWindow.contentView.addChildView(this.controlView);
      this.controlView.setVisible(true);
      this.updateControlBounds();
    } else {
      this.controlView.setVisible(false);
      this.baseWindow.contentView.removeChildView(this.controlView);
    }
  }

  setLayoutTree(tree: OmniPaneNode): void {
    this.currentLayoutTree = tree;
  }

  updateLayout(cells: OmniCellLayout[], tree?: OmniPaneNode): void {
    this.currentLayout = cells;
    if (tree) this.currentLayoutTree = tree;

    // Determine which cells to add/remove
    const newIds = new Set(cells.map((c) => c.id));
    const existingIds = new Set(this.cells.map((c) => c.id));

    // Remove cells no longer in layout
    const toRemove = this.cells.filter((c) => !newIds.has(c.id));
    for (const cell of toRemove) {
      this.removeCellViews(cell);
    }
    this.cells = this.cells.filter((c) => newIds.has(c.id));

    // Add new cells
    for (const layoutCell of cells) {
      if (!existingIds.has(layoutCell.id)) {
        this.addCell(layoutCell.id, layoutCell.url);
      }
    }

    this.applyLayoutInternal();
  }

  navigateCell(cellId: string, url: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (!cell || !this.isWebContentsAlive(cell.browser.webContents)) return;
    cell.browser.webContents.loadURL(url).catch(() => {});
  }

  cellGoBack(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (cell && this.isWebContentsAlive(cell.browser.webContents) && cell.browser.webContents.canGoBack()) {
      cell.browser.webContents.goBack();
    }
  }

  cellGoForward(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (cell && this.isWebContentsAlive(cell.browser.webContents) && cell.browser.webContents.canGoForward()) {
      cell.browser.webContents.goForward();
    }
  }

  cellRefresh(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (cell && this.isWebContentsAlive(cell.browser.webContents)) {
      cell.browser.webContents.reload();
    }
  }

  closeCell(cellId: string): void {
    const cell = this.cells.find((c) => c.id === cellId);
    if (cell) {
      this.removeCellViews(cell);
      this.cells = this.cells.filter((c) => c.id !== cellId);
    }
  }

  destroy(): void {
    this.cleanupAllViews();
    // Destroy the singleton controlView only on full destroy (app quit)
    this.closeWebContentsView(this.controlView);
    this.controlView = null;
  }

  private addCell(id: string, url: string): void {
    if (!this.baseWindow) return;

    // Cell menubar
    const menubar = this.createWebContentsView('omniCell', [`--cellId=${id}`, `--initialUrl=${url || ''}`]);
    this.baseWindow.contentView.addChildView(menubar);

    // Browser view (no preload — raw web content, shared session)
    const omniSession = session.fromPartition(OMNI_PARTITION);
    const browser = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        session: omniSession,
      },
    });
    browser.webContents.setUserAgent(CHROME_USER_AGENT);
    this.baseWindow.contentView.addChildView(browser);

    // Open new windows/tabs in default browser instead of creating new Electron windows
    browser.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });

    // Listen for navigation events to update cell menubar
    browser.webContents.on('did-navigate', (_e, navUrl) => {
      if (!this.isWebContentsAlive(browser.webContents)) return;
      this.notifyCellUrl(id, navUrl);
    });
    browser.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      if (!this.isWebContentsAlive(browser.webContents)) return;
      this.notifyCellUrl(id, navUrl);
    });

    // After menubar finishes loading, send the current browser URL to it
    // (did-navigate may have already fired before the menubar's Vue app mounted)
    menubar.webContents.on('did-finish-load', () => {
      if (!this.isWebContentsAlive(menubar.webContents)) return;
      if (!this.isWebContentsAlive(browser.webContents)) return;
      const currentUrl = browser.webContents.getURL();
      if (currentUrl) {
        xpcMain.broadcast('omniCell/urlChanged', { cellId: id, url: currentUrl });
      } else if (url) {
        xpcMain.broadcast('omniCell/urlChanged', { cellId: id, url });
      }
      this.notifyControlUrlChanged(id, currentUrl || url);
    });

    // Track active cell on browser focus
    browser.webContents.on('focus' as any, () => {
      if (!this.isWebContentsAlive(browser.webContents)) return;
      this.broadcastActiveCell(id);
    });
    menubar.webContents.on('focus' as any, () => {
      if (!this.isWebContentsAlive(menubar.webContents)) return;
      this.broadcastActiveCell(id);
    });

    // Block remote pages from setting app badge (e.g. Telegram Web)
    browser.webContents.on('dom-ready', () => {
      if (!this.isWebContentsAlive(browser.webContents)) return;
      browser.webContents.executeJavaScript(`
        if ('setAppBadge' in navigator) {
          navigator.setAppBadge = () => Promise.resolve();
        }
        if ('clearAppBadge' in navigator) {
          navigator.clearAppBadge = () => Promise.resolve();
        }
      `).catch(() => {});
    });

    // Auto-cleanup crashed cell
    browser.webContents.on('render-process-gone', (_e, details) => {
      console.warn(`[OmniWindowHelper] Cell ${id} renderer crashed:`, details.reason);
      this.removeCellViews({ id, menubar, browser });
      this.cells = this.cells.filter((c) => c.id !== id);
    });

    if (url) {
      // Semaphore (capacity 3): stagger concurrent URL loads to avoid overwhelming the shared session
      this._loadSemaphore.acquire().then(() => {
        if (!this.isWebContentsAlive(browser.webContents)) {
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
        browser.webContents.once('did-finish-load', () => { clearTimeout(timeoutId); releaseOnce(); });
        browser.webContents.once('did-fail-load', () => { clearTimeout(timeoutId); releaseOnce(); });
        browser.webContents.once('did-fail-provisional-load', () => { clearTimeout(timeoutId); releaseOnce(); });
        browser.webContents.once('render-process-gone', () => { clearTimeout(timeoutId); releaseOnce(); });
        browser.webContents.loadURL(url).catch(() => {});
      });
    }

    this.cells.push({ id, menubar, browser, lastUrl: url || '' });

    // Ensure control overlay stays on top
    if (this.controlVisible && this.controlView) {
      this.baseWindow.contentView.removeChildView(this.controlView);
      this.baseWindow.contentView.addChildView(this.controlView);
    }
  }

  private removeCellViews(cell: CellViewPair): void {
    try {
      if (this.baseWindow && !this.baseWindow.isDestroyed()) {
        this.baseWindow.contentView.removeChildView(cell.menubar);
        this.baseWindow.contentView.removeChildView(cell.browser);
      }
      this.closeWebContentsView(cell.menubar);
      this.closeWebContentsView(cell.browser);
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

  private async restoreSavedLayout(): Promise<void> {
    try {
      const config = await settingEmitter.get<OmniLayoutConfig>({ key: LAYOUT_KEY });
      if (config?.tree) {
        const leaves = extractTreeLeaves(config.tree);
        const cells: OmniCellLayout[] = leaves.map((l) => ({ id: l.id, url: l.url, x: 0, y: 0, width: 100, height: 100 }));
        this.updateLayout(cells, config.tree);
        console.log('[OmniWindowHelper] Restored saved layout with', leaves.length, 'cells');
      }
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to restore saved layout:', err);
    }
    xpcMain.broadcast('omni/allCellAdded', {});
  }

  async saveLayoutToDao(): Promise<void> {
    if (!this.currentLayoutTree) return;
    try {
      const config: OmniLayoutConfig = { tree: JSON.parse(JSON.stringify(this.currentLayoutTree)) };
      await settingEmitter.upsert({ key: LAYOUT_KEY, value: config });
      console.log('[OmniWindowHelper] Layout saved to SettingDao');
    } catch (err) {
      console.error('[OmniWindowHelper] Failed to save layout:', err);
    }
  }

  private applyLayoutInternal(): void {
    if (!this.baseWindow) return;
    const [contentWidth, contentHeight] = this.baseWindow.getContentSize();
    const areaTop = MENUBAR_HEIGHT;
    const areaWidth = contentWidth;
    const areaHeight = contentHeight - MENUBAR_HEIGHT;

    if (this.currentLayoutTree) {
      const pixelCells = flattenTreePixels(this.currentLayoutTree, 0, areaTop, areaWidth, areaHeight);
      for (const layoutCell of pixelCells) {
        const cell = this.cells.find((c) => c.id === layoutCell.id);
        if (!cell) continue;
        const { x, y, width: w, height: h } = layoutCell;
        cell.menubar.setBounds({ x, y, width: Math.max(w, 0), height: CELL_MENUBAR_HEIGHT });
        cell.browser.setBounds({
          x,
          y: y + CELL_MENUBAR_HEIGHT,
          width: Math.max(w, 0),
          height: Math.max(h - CELL_MENUBAR_HEIGHT, 0),
        });
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
      cell.menubar.setBounds({ x, y, width: Math.max(w, 0), height: CELL_MENUBAR_HEIGHT });
      cell.browser.setBounds({
        x,
        y: y + CELL_MENUBAR_HEIGHT,
        width: Math.max(w, 0),
        height: Math.max(h - CELL_MENUBAR_HEIGHT, 0),
      });
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
