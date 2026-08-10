import {
  app,
  BaseWindow,
  BrowserWindow,
  screen,
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
import { resolveOnlyPreviewSettingsBounds } from '@main/onlypreview/onlyPreviewWindowBounds.service';
import { onlyPreviewSearchBootstrapRegistry } from '@main/onlypreview/onlyPreviewSearchBootstrap.registry';
import { onlyPreviewSearchUtilityLifecycleService } from '@main/onlypreview/onlyPreviewSearchUtilityLifecycle.service';
import '@main/xpc/onlyPreviewSearchRuntime.handler';
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
const PREVIEW_HEADER_HEIGHT = 43;

type OnlyPreviewRendererMode = 'shell' | 'previewHeader' | 'preview' | 'settings' | 'guide';
type OnlyPreviewNativeCommand =
  | 'choose-folder'
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
): string[] => {
  return [
    `--onlypreview-host-token=${host.hostToken}`,
    `--onlypreview-host-id=${host.hostId}`,
    `--onlypreview-mode=${mode}`
  ];
};

const closeView = (view: WebContentsView | null): void => {
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.close();
  } catch {
    // The owning BaseWindow may already have destroyed this view.
  }
};

const configureNavigationFence = (
  webContents: Electron.WebContents,
  expectedUrl: string,
  allowExternalHttp = true
): void => {
  webContents.setWindowOpenHandler(({ url }) => {
    if (allowExternalHttp && /^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const fenceNavigation = (event: Electron.Event, url: string): void => {
    if (url === expectedUrl) return;
    event.preventDefault();
    if (allowExternalHttp && /^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  webContents.on('will-navigate', fenceNavigation);
  webContents.on('will-redirect', fenceNavigation);
};

const isCommandModifier = (input: Input): boolean =>
  process.platform === 'darwin' ? input.meta : input.control;

const isProjectSearchShortcut = (input: Input): boolean => {
  if (
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    input.key.toLowerCase() !== 'f' ||
    !input.shift ||
    input.alt ||
    !isCommandModifier(input)
  ) {
    return false;
  }
  return process.platform === 'darwin' ? !input.control : !input.meta;
};

const shouldAutoOpenOnlyPreviewDevTools = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' && process.env.BITTERLESS_E2E !== '1';

const isOnlyPreviewDevToolsEnabled = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' || (process.env.BITTERLESS_E2E === '1' && !app.isPackaged);

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

const settingsBoundsForParent = (
  parentBounds: Rectangle,
  width: number,
  height: number
): Rectangle => {
  const workArea = screen.getDisplayMatching(parentBounds).workArea;
  return resolveOnlyPreviewSettingsBounds({
    parentBounds,
    workArea,
    width,
    height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT
  });
};

export class OnlyPreviewWindowHelper {
  baseWindow: BaseWindow | null = null;
  shellView: WebContentsView | null = null;
  previewHeaderView: WebContentsView | null = null;
  previewView: WebContentsView | null = null;
  settingsWindow: BrowserWindow | null = null;
  agentSkillGuideWindow: BrowserWindow | null = null;
  private standaloneHost: OnlyPreviewHostCapability | null = null;
  private settingsHost: OnlyPreviewHostCapability | null = null;
  private agentSkillGuideHost: OnlyPreviewHostCapability | null = null;
  private searchBootstrapToken: string | null = null;
  private previewHostBounds: Rectangle | null = null;
  private baseWindowState: WindowStateController | null = null;
  private settingsWindowState: WindowStateController | null = null;
  private agentSkillGuideWindowState: WindowStateController | null = null;
  private commandHandler: ((payload: OnlyPreviewNativeCommandPayload) => void) | null = null;

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

  getStandaloneWindow(hostToken: string): BaseWindow {
    return this.requireStandaloneWindow(hostToken);
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
    const headerView = this.previewHeaderView;
    const contentView = this.previewView;
    if (
      !window ||
      window.isDestroyed() ||
      !headerView ||
      headerView.webContents.isDestroyed() ||
      !contentView ||
      contentView.webContents.isDestroyed()
    ) {
      throw new Error(`OnlyPreview host ${host.hostId} has no active preview surface.`);
    }
    const [contentWidth, contentHeight] = window.getContentSize();
    this.applyPreviewHostBounds(clampPreviewBounds(value, contentWidth, contentHeight));
  }

  async openSettings(sourceHostToken: string): Promise<void> {
    const parentWindow = this.requireStandaloneWindow(sourceHostToken);
    const current = this.settingsWindow;
    if (current && !current.isDestroyed()) {
      current.setBounds(settingsBoundsForParent(parentWindow.getBounds(), ...current.getSize()));
      current.show();
      current.focus();
      return;
    }
    this.destroySettings();
    const host = onlyPreviewHostRegistry.issue('settings', 'settings');
    this.settingsHost = host;
    const restored = windowStateService.resolve('onlypreview-settings');
    const width = restored?.bounds.width ?? MIN_WIDTH;
    const height = restored?.bounds.height ?? MIN_HEIGHT;
    const bounds = settingsBoundsForParent(parentWindow.getBounds(), width, height);
    const target = rendererTarget('settings');
    const window = new BrowserWindow({
      title: 'OnlyPreview Settings',
      ...bounds,
      parent: parentWindow,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      backgroundColor: '#f5f3ee',
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
      if (this.settingsWindow !== window) return;
      window.setBounds(settingsBoundsForParent(parentWindow.getBounds(), ...window.getSize()));
      window.show();
      window.focus();
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

  async openAgentSkillGuide(sourceHostToken: string): Promise<void> {
    const parentWindow = this.requireStandaloneWindow(sourceHostToken);
    const current = this.agentSkillGuideWindow;
    if (current && !current.isDestroyed()) {
      current.setBounds(settingsBoundsForParent(parentWindow.getBounds(), ...current.getSize()));
      current.show();
      current.focus();
      return;
    }
    this.destroyAgentSkillGuide();
    const host = onlyPreviewHostRegistry.issue('guide', 'guide');
    this.agentSkillGuideHost = host;
    const restored = windowStateService.resolve('onlypreview-guide');
    const width = restored?.bounds.width ?? MIN_WIDTH;
    const height = restored?.bounds.height ?? MIN_HEIGHT;
    const bounds = settingsBoundsForParent(parentWindow.getBounds(), width, height);
    const target = rendererTarget('guide');
    const window = new BrowserWindow({
      title: 'Copy the skill to your agent',
      ...bounds,
      parent: parentWindow,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#f6f7fa',
      webPreferences: {
        preload: join(__dirname, '../preload/onlypreview.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: additionalArguments(host, 'guide')
      }
    });
    this.agentSkillGuideWindow = window;
    this.agentSkillGuideWindowState = windowStateService.register('onlypreview-guide', window);
    configureNavigationFence(window.webContents, target.url, false);
    window.once('ready-to-show', () => {
      if (this.agentSkillGuideWindow !== window) return;
      window.setBounds(settingsBoundsForParent(parentWindow.getBounds(), ...window.getSize()));
      window.show();
      window.focus();
    });
    window.webContents.once('render-process-gone', () => {
      if (this.agentSkillGuideWindow === window) this.destroyAgentSkillGuide();
    });
    window.once('closed', () => {
      if (this.agentSkillGuideWindow !== window) return;
      this.agentSkillGuideWindow = null;
      this.agentSkillGuideWindowState = null;
      if (this.agentSkillGuideHost?.hostToken === host.hostToken) {
        this.agentSkillGuideHost = null;
      }
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    try {
      await (is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(target.url)
        : window.loadFile(target.filePath));
    } catch (error) {
      if (this.agentSkillGuideWindow === window) this.destroyAgentSkillGuide();
      throw error;
    }
  }

  requireAgentSkillGuideHost(hostToken: unknown): OnlyPreviewHostCapability {
    const host = onlyPreviewHostRegistry.require(hostToken, ['guide']);
    const window = this.agentSkillGuideWindow;
    if (
      host.kind !== 'guide' ||
      host.hostToken !== this.agentSkillGuideHost?.hostToken ||
      !window ||
      window.isDestroyed()
    ) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview request does not belong to the active agent skill Guide.'
      );
    }
    return host;
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
    this.destroySettings();
    this.destroyAgentSkillGuide();
    const window = this.baseWindow;
    const shellView = this.shellView;
    const previewHeaderView = this.previewHeaderView;
    const previewView = this.previewView;
    this.baseWindow = null;
    this.shellView = null;
    this.previewHeaderView = null;
    this.previewView = null;
    this.previewHostBounds = null;
    this.baseWindowState = null;
    onlyPreviewSearchUtilityLifecycleService.stop();
    if (window && !window.isDestroyed()) {
      try {
        if (shellView) window.contentView.removeChildView(shellView);
      } catch {
        // The view may already have been detached by Electron during teardown.
      }
      try {
        if (previewHeaderView) window.contentView.removeChildView(previewHeaderView);
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
    closeView(previewHeaderView);
    closeView(previewView);
    if (window && !window.isDestroyed()) window.destroy();
    if (this.searchBootstrapToken) {
      onlyPreviewSearchBootstrapRegistry.revoke(this.searchBootstrapToken);
    }
    this.searchBootstrapToken = null;
    if (this.standaloneHost) onlyPreviewHostRegistry.revoke(this.standaloneHost.hostToken);
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

  destroyAgentSkillGuide(): void {
    const window = this.agentSkillGuideWindow;
    const windowState = this.agentSkillGuideWindowState;
    this.agentSkillGuideWindow = null;
    this.agentSkillGuideWindowState = null;
    windowState?.flushAndDispose();
    if (window && !window.isDestroyed()) window.destroy();
    if (this.agentSkillGuideHost) {
      onlyPreviewHostRegistry.revoke(this.agentSkillGuideHost.hostToken);
    }
    this.agentSkillGuideHost = null;
  }

  destroy(): void {
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
    const searchBootstrap = onlyPreviewSearchBootstrapRegistry.issue(host.hostToken);
    this.searchBootstrapToken = searchBootstrap.searchToken;
    await onlyPreviewSearchUtilityLifecycleService.start({
      host,
      searchToken: searchBootstrap.searchToken,
      broadcast: (eventName, params) => xpcMain.broadcast(eventName, params),
      onUnexpectedExit: () => this.destroyStandalone()
    });
    if (this.baseWindow !== window || this.standaloneHost?.hostToken !== host.hostToken) {
      throw new Error('OnlyPreview search utility startup was superseded.');
    }
    const shellView = this.createView(host, 'shell');
    const previewHeaderView = this.createView(host, 'previewHeader');
    const previewView = this.createView(host, 'preview');
    this.shellView = shellView;
    this.previewHeaderView = previewHeaderView;
    this.previewView = previewView;
    window.contentView.addChildView(shellView);
    window.contentView.addChildView(previewHeaderView);
    window.contentView.addChildView(previewView);
    this.applyInitialBounds();

    const closeOnRendererFailure = (): void => {
      if (this.baseWindow === window) this.destroyStandalone();
    };
    shellView.webContents.once('render-process-gone', closeOnRendererFailure);
    previewHeaderView.webContents.once('render-process-gone', closeOnRendererFailure);
    previewView.webContents.once('render-process-gone', closeOnRendererFailure);
    shellView.webContents.once('did-finish-load', () => {
      if (this.baseWindow === window) this.baseWindowState?.show();
    });
    window.on('resize' as any, () => {
      if (this.baseWindow !== window) return;
      const [width, height] = window.getContentSize();
      shellView.setBounds({ x: 0, y: 0, width, height });
      const currentBounds = this.previewHostBounds || {
        x: previewView.getBounds().x,
        y: Math.max(MENU_BAR_HEIGHT, previewHeaderView.getBounds().y),
        width: previewView.getBounds().width,
        height: previewHeaderView.getBounds().height + previewView.getBounds().height
      };
      this.applyPreviewHostBounds(clampPreviewBounds(currentBounds, width, height));
    });
    window.once('closed' as any, () => {
      if (this.baseWindow !== window) return;
      this.destroySettings();
      this.destroyAgentSkillGuide();
      this.baseWindow = null;
      this.shellView = null;
      this.previewHeaderView = null;
      this.previewView = null;
      this.previewHostBounds = null;
      this.baseWindowState = null;
      onlyPreviewSearchUtilityLifecycleService.stop();
      closeView(shellView);
      closeView(previewHeaderView);
      closeView(previewView);
      if (this.searchBootstrapToken === searchBootstrap.searchToken) {
        onlyPreviewSearchBootstrapRegistry.revoke(searchBootstrap.searchToken);
        this.searchBootstrapToken = null;
      }
      if (this.standaloneHost?.hostToken === host.hostToken) this.standaloneHost = null;
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    await this.loadView(previewView, 'preview');
    await Promise.all([
      this.loadView(shellView, 'shell'),
      this.loadView(previewHeaderView, 'previewHeader')
    ]);
    if (
      !shouldAutoOpenOnlyPreviewDevTools() ||
      this.baseWindow !== window ||
      this.shellView !== shellView ||
      this.previewHeaderView !== previewHeaderView ||
      this.previewView !== previewView ||
      window.isDestroyed() ||
      previewView.webContents.isDestroyed() ||
      previewView.webContents.isDevToolsOpened()
    ) {
      return;
    }
    previewView.webContents.openDevTools({ mode: 'detach', activate: false });
  }

  private createView(
    host: OnlyPreviewHostCapability,
    mode: 'shell' | 'previewHeader' | 'preview'
  ): WebContentsView {
    const target = rendererTarget(mode);
    const view = new WebContentsView({
      webPreferences: {
        preload: join(
          __dirname,
          mode === 'preview' ? '../preload/onlypreviewContent.js' : '../preload/onlypreview.js'
        ),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        additionalArguments: additionalArguments(host, mode)
      }
    });
    configureNavigationFence(view.webContents, target.url, mode === 'shell');
    this.bindNativeShortcuts(view.webContents, host);
    bindOnlyPreviewDevToolsShortcut(view.webContents);
    return view;
  }

  private async loadView(
    view: WebContentsView,
    mode: 'shell' | 'previewHeader' | 'preview'
  ): Promise<void> {
    const target = rendererTarget(mode);
    await (is.dev && process.env['ELECTRON_RENDERER_URL']
      ? view.webContents.loadURL(target.url)
      : view.webContents.loadFile(target.filePath));
  }

  private applyInitialBounds(): void {
    if (!this.baseWindow || !this.shellView || !this.previewHeaderView || !this.previewView) return;
    const [width, height] = this.baseWindow.getContentSize();
    this.shellView.setBounds({ x: 0, y: 0, width, height });
    this.applyPreviewHostBounds({
      x: Math.min(DEFAULT_SIDEBAR_WIDTH + RESIZE_HANDLE_WIDTH, width),
      y: Math.min(MENU_BAR_HEIGHT, height),
      width: Math.max(0, width - DEFAULT_SIDEBAR_WIDTH - RESIZE_HANDLE_WIDTH),
      height: Math.max(0, height - MENU_BAR_HEIGHT - STATUS_HEIGHT)
    });
  }

  private applyPreviewHostBounds(bounds: Rectangle): void {
    const headerView = this.previewHeaderView;
    const contentView = this.previewView;
    if (!headerView || !contentView) return;
    const headerHeight = Math.min(PREVIEW_HEADER_HEIGHT, Math.max(0, bounds.height));
    this.previewHostBounds = { ...bounds };
    headerView.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: headerHeight
    });
    contentView.setBounds({
      x: bounds.x,
      y: bounds.y + headerHeight,
      width: bounds.width,
      height: Math.max(0, bounds.height - headerHeight)
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
    if (isProjectSearchShortcut(input)) return 'focus-search';
    if (input.type === 'keyDown' && key === 'f5') return 'refresh';
    if (input.type !== 'keyDown' || !isCommandModifier(input)) return null;
    if (key === 'o') return 'choose-folder';
    if (key === 'r') return 'refresh';
    if (key === ',' || (process.platform !== 'darwin' && key === 's' && input.alt)) {
      return 'open-settings';
    }
    return null;
  }
}

export const onlyPreviewWindowHelper = new OnlyPreviewWindowHelper();
