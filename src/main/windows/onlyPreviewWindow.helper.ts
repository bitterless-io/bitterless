import {
  app,
  BaseWindow,
  BrowserWindow,
  WebContentsView,
  shell,
  type Input,
  type Rectangle
} from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import type { OnlyPreviewBounds } from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_FOCUS_PROJECT_EVENT,
  ONLY_PREVIEW_FOCUS_SEARCH_EVENT
} from '@shared/onlypreview/onlyPreview.types';
import { xpcMain } from 'electron-xpc/main';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  onlyPreviewHostRegistry,
  type OnlyPreviewHostCapability
} from '@main/onlypreview/onlyPreviewHost.registry';
import { windowStateService, type WindowStateController } from './windowState.service';

const DEFAULT_WIDTH = 1180;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const MIN_SIDEBAR_WIDTH = 180;
const RESIZE_HANDLE_WIDTH = 5;
const DEFAULT_SIDEBAR_WIDTH = 264;
const MENU_BAR_HEIGHT = 32;
const STATUS_HEIGHT = 25;

type OnlyPreviewRendererMode = 'shell' | 'preview' | 'settings';
type OnlyPreviewNativeCommand =
  | 'choose-file'
  | 'choose-directory'
  | 'open-settings'
  | 'refresh'
  | 'focus-project'
  | 'focus-search';

interface OnlyPreviewNativeCommandPayload {
  hostToken: string;
  command: OnlyPreviewNativeCommand;
}

const rendererTarget = (mode: OnlyPreviewRendererMode): { filePath: string; url: string } => {
  const rendererPath = `onlypreview/${mode}/index.html`;
  const filePath = join(__dirname, `../renderer/${rendererPath}`);
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return {
      filePath,
      url: `${process.env['ELECTRON_RENDERER_URL'].replace(/\/+$/, '')}/${rendererPath}`
    };
  }
  return { filePath, url: pathToFileURL(filePath).href };
};

const additionalArguments = (
  host: OnlyPreviewHostCapability,
  mode: OnlyPreviewRendererMode
): string[] => [
  `--onlypreview-host-token=${host.hostToken}`,
  `--onlypreview-host-id=${host.hostId}`,
  `--onlypreview-mode=${mode}`
];

const closeView = (view: WebContentsView | null): void => {
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.close();
  } catch {
    // The owning BaseWindow may already have destroyed this view.
  }
};

const configureNavigationFence = (webContents: Electron.WebContents, expectedUrl: string): void => {
  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const fenceNavigation = (event: Electron.Event, url: string): void => {
    if (url === expectedUrl) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  webContents.on('will-navigate', fenceNavigation);
  webContents.on('will-redirect', fenceNavigation);
};

const isCommandModifier = (input: Input): boolean =>
  process.platform === 'darwin' ? input.meta : input.control;

const isOnlyPreviewDevToolsEnabled = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' ||
  (process.env.BITTERLESS_E2E === '1' && !app.isPackaged);

const isOnlyPreviewDevToolsShortcut = (input: Input): boolean => {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false;
  const key = input.key.toLowerCase();
  if (key === 'f12') return !input.shift && !input.control && !input.alt && !input.meta;
  if (key !== 'i') return false;
  if (process.platform === 'darwin') {
    return input.meta && input.alt && !input.control && !input.shift;
  }
  if (process.platform === 'win32') {
    return input.control && input.shift && !input.meta && !input.alt;
  }
  return false;
};

const bindOnlyPreviewDevToolsShortcut = (webContents: Electron.WebContents): void => {
  if (!isOnlyPreviewDevToolsEnabled()) return;
  webContents.on('before-input-event', (event, input) => {
    if (!isOnlyPreviewDevToolsShortcut(input)) return;
    event.preventDefault();
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools();
      return;
    }
    webContents.openDevTools({ mode: 'detach' });
  });
};

const clampPreviewBounds = (
  value: OnlyPreviewBounds,
  contentWidth: number,
  contentHeight: number
): Rectangle => {
  const x = Math.min(Math.max(value.x, MIN_SIDEBAR_WIDTH + RESIZE_HANDLE_WIDTH), contentWidth);
  const y = Math.min(
    Math.max(value.y, MENU_BAR_HEIGHT),
    Math.max(MENU_BAR_HEIGHT, contentHeight - STATUS_HEIGHT)
  );
  return {
    x,
    y,
    width: Math.min(value.width, Math.max(0, contentWidth - x)),
    height: Math.min(value.height, Math.max(0, contentHeight - y - STATUS_HEIGHT))
  };
};

export class OnlyPreviewWindowHelper {
  baseWindow: BaseWindow | null = null;
  shellView: WebContentsView | null = null;
  previewView: WebContentsView | null = null;
  settingsWindow: BrowserWindow | null = null;
  private standaloneHost: OnlyPreviewHostCapability | null = null;
  private settingsHost: OnlyPreviewHostCapability | null = null;
  private baseWindowState: WindowStateController | null = null;
  private settingsWindowState: WindowStateController | null = null;
  private commandHandler: ((payload: OnlyPreviewNativeCommandPayload) => void) | null = null;
  private readonly lastShiftKeyDownByHost = new Map<string, number>();

  setCommandHandler(handler: (payload: OnlyPreviewNativeCommandPayload) => void): void {
    this.commandHandler = handler;
  }

  bindNativeShortcuts(webContents: Electron.WebContents, host: OnlyPreviewHostCapability): void {
    webContents.on('before-input-event', (event, input) => {
      const command = this.resolveNativeCommand(host, input);
      if (!command) return;
      event.preventDefault();
      if (command === 'focus-project' || command === 'focus-search') {
        if (
          host.kind === 'standalone' &&
          host.hostToken === this.standaloneHost?.hostToken &&
          this.shellView &&
          !this.shellView.webContents.isDestroyed()
        ) {
          this.shellView.webContents.focus();
        }
        xpcMain.broadcast(
          command === 'focus-project'
            ? ONLY_PREVIEW_FOCUS_PROJECT_EVENT
            : ONLY_PREVIEW_FOCUS_SEARCH_EVENT,
          { hostId: host.hostId }
        );
      } else {
        this.commandHandler?.({ hostToken: host.hostToken, command });
      }
    });
  }

  getStandaloneHost(): OnlyPreviewHostCapability | null {
    const host = this.standaloneHost;
    return host && onlyPreviewHostRegistry.isLive(host.hostToken) ? host : null;
  }

  async ensureStandalone(): Promise<OnlyPreviewHostCapability> {
    const currentWindow = this.baseWindow;
    const currentHost = this.getStandaloneHost();
    if (currentWindow && !currentWindow.isDestroyed() && currentHost) {
      this.show();
      return currentHost;
    }
    this.destroyStandalone();
    const host = onlyPreviewHostRegistry.issue('standalone', 'content');
    this.standaloneHost = host;
    try {
      await this.createStandaloneWindow(host);
      return host;
    } catch (error) {
      this.destroyStandalone();
      throw error;
    }
  }

  show(): void {
    const window = this.baseWindow;
    if (!window || window.isDestroyed()) return;
    if (this.baseWindowState) {
      this.baseWindowState.show();
    } else {
      if (window.isMinimized()) window.restore();
      window.show();
    }
    window.focus();
  }

  minimizeWindow(hostToken: string): void {
    this.requireStandaloneWindow(hostToken).minimize();
  }

  toggleMaximizeWindow(hostToken: string): void {
    const window = this.requireStandaloneWindow(hostToken);
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  }

  closeWindow(hostToken: string): void {
    this.requireStandaloneWindow(hostToken).close();
  }

  updatePreviewBounds(hostToken: string, value: OnlyPreviewBounds): void {
    const host = this.requireStandaloneHost(hostToken);
    const window = this.baseWindow;
    const view = this.previewView;
    if (!window || window.isDestroyed() || !view || view.webContents.isDestroyed()) {
      throw new Error(`OnlyPreview host ${host.hostId} has no active preview surface.`);
    }
    const [contentWidth, contentHeight] = window.getContentSize();
    view.setBounds(clampPreviewBounds(value, contentWidth, contentHeight));
  }

  async openSettings(sourceHostToken: string): Promise<void> {
    onlyPreviewHostRegistry.require(sourceHostToken, ['content']);
    const current = this.settingsWindow;
    if (current && !current.isDestroyed()) {
      current.show();
      current.focus();
      return;
    }
    this.destroySettings();
    const host = onlyPreviewHostRegistry.issue('settings', 'settings');
    this.settingsHost = host;
    const restored = windowStateService.resolve('onlypreview-settings');
    const target = rendererTarget('settings');
    const window = new BrowserWindow({
      title: 'OnlyPreview Settings',
      width: restored?.bounds.width ?? MIN_WIDTH,
      height: restored?.bounds.height ?? MIN_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      backgroundColor: '#f5f3ee',
      ...(restored ? { x: restored.bounds.x, y: restored.bounds.y } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/onlypreview.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: additionalArguments(host, 'settings')
      }
    });
    this.settingsWindow = window;
    this.settingsWindowState = windowStateService.register('onlypreview-settings', window);
    configureNavigationFence(window.webContents, target.url);
    window.once('ready-to-show', () => {
      if (this.settingsWindow === window) this.settingsWindowState?.show();
    });
    window.webContents.once('render-process-gone', () => {
      if (this.settingsWindow === window) this.destroySettings();
    });
    window.once('closed', () => {
      if (this.settingsWindow !== window) return;
      this.settingsWindow = null;
      this.settingsWindowState = null;
      if (this.settingsHost?.hostToken === host.hostToken) this.settingsHost = null;
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    try {
      await (is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(target.url)
        : window.loadFile(target.filePath));
    } catch (error) {
      if (this.settingsWindow === window) this.destroySettings();
      throw error;
    }
  }

  closeSettings(hostToken: string): void {
    const host = onlyPreviewHostRegistry.require(hostToken, ['settings']);
    if (host.hostToken !== this.settingsHost?.hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview settings host is not the active settings window.'
      );
    }
    this.settingsWindow?.close();
  }

  destroyStandalone(): void {
    const window = this.baseWindow;
    const shellView = this.shellView;
    const previewView = this.previewView;
    this.baseWindow = null;
    this.shellView = null;
    this.previewView = null;
    this.baseWindowState = null;
    if (window && !window.isDestroyed()) {
      try {
        if (shellView) window.contentView.removeChildView(shellView);
      } catch {
        // The view may already have been detached by Electron during teardown.
      }
      try {
        if (previewView) window.contentView.removeChildView(previewView);
      } catch {
        // The view may already have been detached by Electron during teardown.
      }
    }
    closeView(shellView);
    closeView(previewView);
    if (window && !window.isDestroyed()) window.destroy();
    if (this.standaloneHost) onlyPreviewHostRegistry.revoke(this.standaloneHost.hostToken);
    if (this.standaloneHost) this.lastShiftKeyDownByHost.delete(this.standaloneHost.hostToken);
    this.standaloneHost = null;
  }

  destroySettings(): void {
    const window = this.settingsWindow;
    this.settingsWindow = null;
    this.settingsWindowState = null;
    if (window && !window.isDestroyed()) window.destroy();
    if (this.settingsHost) onlyPreviewHostRegistry.revoke(this.settingsHost.hostToken);
    this.settingsHost = null;
  }

  destroy(): void {
    this.destroySettings();
    this.destroyStandalone();
  }

  private requireStandaloneHost(hostToken: string): OnlyPreviewHostCapability {
    const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
    if (host.kind !== 'standalone' || host.hostToken !== this.standaloneHost?.hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview request does not belong to the active standalone window.'
      );
    }
    return host;
  }

  private requireStandaloneWindow(hostToken: string): BaseWindow {
    const host = this.requireStandaloneHost(hostToken);
    const window = this.baseWindow;
    if (!window || window.isDestroyed()) {
      throw new Error(`OnlyPreview host ${host.hostId} has no active standalone window.`);
    }
    return window;
  }

  private async createStandaloneWindow(host: OnlyPreviewHostCapability): Promise<void> {
    const restored = windowStateService.resolve('onlypreview');
    const window = new BaseWindow({
      title: 'OnlyPreview',
      width: restored?.bounds.width ?? DEFAULT_WIDTH,
      height: restored?.bounds.height ?? DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      backgroundColor: '#f6f7fa',
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin' && { trafficLightPosition: { x: 12, y: 8 } }),
      ...(restored ? { x: restored.bounds.x, y: restored.bounds.y } : {})
    });
    this.baseWindow = window;
    this.baseWindowState = windowStateService.register('onlypreview', window);
    const shellView = this.createView(host, 'shell');
    const previewView = this.createView(host, 'preview');
    this.shellView = shellView;
    this.previewView = previewView;
    window.contentView.addChildView(shellView);
    window.contentView.addChildView(previewView);
    this.applyInitialBounds();

    const closeOnRendererFailure = (): void => {
      if (this.baseWindow === window) this.destroyStandalone();
    };
    shellView.webContents.once('render-process-gone', closeOnRendererFailure);
    previewView.webContents.once('render-process-gone', closeOnRendererFailure);
    shellView.webContents.once('did-finish-load', () => {
      if (this.baseWindow === window) this.baseWindowState?.show();
    });
    window.on('resize' as any, () => {
      if (this.baseWindow !== window) return;
      const [width, height] = window.getContentSize();
      shellView.setBounds({ x: 0, y: 0, width, height });
      previewView.setBounds(clampPreviewBounds(previewView.getBounds(), width, height));
    });
    window.once('closed' as any, () => {
      if (this.baseWindow !== window) return;
      this.baseWindow = null;
      this.shellView = null;
      this.previewView = null;
      this.baseWindowState = null;
      closeView(shellView);
      closeView(previewView);
      this.lastShiftKeyDownByHost.delete(host.hostToken);
      if (this.standaloneHost?.hostToken === host.hostToken) this.standaloneHost = null;
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    await Promise.all([this.loadView(shellView, 'shell'), this.loadView(previewView, 'preview')]);
  }

  private createView(host: OnlyPreviewHostCapability, mode: 'shell' | 'preview'): WebContentsView {
    const target = rendererTarget(mode);
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/onlypreview.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: additionalArguments(host, mode)
      }
    });
    configureNavigationFence(view.webContents, target.url);
    this.bindNativeShortcuts(view.webContents, host);
    bindOnlyPreviewDevToolsShortcut(view.webContents);
    return view;
  }

  private async loadView(view: WebContentsView, mode: 'shell' | 'preview'): Promise<void> {
    const target = rendererTarget(mode);
    await (is.dev && process.env['ELECTRON_RENDERER_URL']
      ? view.webContents.loadURL(target.url)
      : view.webContents.loadFile(target.filePath));
  }

  private applyInitialBounds(): void {
    if (!this.baseWindow || !this.shellView || !this.previewView) return;
    const [width, height] = this.baseWindow.getContentSize();
    this.shellView.setBounds({ x: 0, y: 0, width, height });
    this.previewView.setBounds({
      x: Math.min(DEFAULT_SIDEBAR_WIDTH + RESIZE_HANDLE_WIDTH, width),
      y: Math.min(MENU_BAR_HEIGHT, height),
      width: Math.max(0, width - DEFAULT_SIDEBAR_WIDTH - RESIZE_HANDLE_WIDTH),
      height: Math.max(0, height - MENU_BAR_HEIGHT - STATUS_HEIGHT)
    });
  }

  private resolveNativeCommand(
    host: OnlyPreviewHostCapability,
    input: Input
  ): OnlyPreviewNativeCommand | null {
    const key = input.key.toLowerCase();
    if (
      input.type === 'keyDown' &&
      (input.code === 'Digit1' || key === '1') &&
      input.alt &&
      !input.control &&
      !input.meta
    ) {
      return 'focus-project';
    }
    if (
      input.type === 'keyDown' &&
      key === 'shift' &&
      !input.isAutoRepeat &&
      !input.control &&
      !input.meta &&
      !input.alt
    ) {
      const now = Date.now();
      const previous = this.lastShiftKeyDownByHost.get(host.hostToken) ?? 0;
      this.lastShiftKeyDownByHost.set(host.hostToken, now);
      if (now - previous <= 400) {
        this.lastShiftKeyDownByHost.delete(host.hostToken);
        return 'focus-search';
      }
      return null;
    }
    if (input.type === 'keyDown' && key === 'f5') return 'refresh';
    if (input.type !== 'keyDown' || !isCommandModifier(input)) return null;
    if (key === 'o') return input.shift ? 'choose-directory' : 'choose-file';
    if (key === 'r') return 'refresh';
    if (key === ',' || (process.platform !== 'darwin' && key === 's' && input.alt)) {
      return 'open-settings';
    }
    return null;
  }
}

export const onlyPreviewWindowHelper = new OnlyPreviewWindowHelper();
