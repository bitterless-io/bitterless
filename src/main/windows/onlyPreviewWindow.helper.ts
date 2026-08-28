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
import type {
  OnlyPreviewBounds,
  OnlyPreviewGlobalSearchFocusOrigin
} from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_FIND_FOCUS_EVENT,
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
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewPreviewRegionService } from '@main/onlypreview/views/onlyPreviewPreviewRegion.service';
import { onlyPreviewGlobalSearchFocusService } from '@main/onlypreview/onlyPreviewGlobalSearchFocus.service';
import {
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewSearchWatchCommitEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';
import '@main/xpc/onlyPreviewSearchRuntime.handler';
import { windowStateService, type WindowStateController } from './windowState.service';
import {
  createOnlyPreviewSearchDiagnostics,
  type OnlyPreviewSearchDiagnostics
} from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

const DEFAULT_WIDTH = 1180;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const MIN_SIDEBAR_WIDTH = 180;
const RESIZE_HANDLE_WIDTH = 5;
const MENU_BAR_HEIGHT = 32;
const PREVIEW_TOOLBAR_HEIGHT = 43;
const STATUS_HEIGHT = 25;

type OnlyPreviewRendererMode = 'shell' | 'preview' | 'settings' | 'guide';
type OnlyPreviewNativeCommand =
  | 'choose-folder'
  | 'open-settings'
  | 'refresh'
  | 'focus-project'
  | 'focus-search'
  | 'find-in-file'
  | 'close-find-in-file';

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
  mode: OnlyPreviewRendererMode,
  previewRuntimeToken?: string
): string[] => {
  return [
    `--onlypreview-host-token=${host.hostToken}`,
    `--onlypreview-host-id=${host.hostId}`,
    `--onlypreview-mode=${mode}`,
    ...(previewRuntimeToken ? [`--onlypreview-runtime-token=${previewRuntimeToken}`] : [])
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

const isGlobalSearchShortcut = (input: Input): boolean => {
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

const isHiddenPreviewBounds = (value: OnlyPreviewBounds): boolean =>
  value.x === 0 && value.y === 0 && value.width === 0 && value.height === 0;

const isCurrentFileFindShortcut = (input: Input): boolean => {
  if (
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    input.key.toLowerCase() !== 'f' ||
    input.shift ||
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
  const minimumY = MENU_BAR_HEIGHT + PREVIEW_TOOLBAR_HEIGHT;
  const y = Math.min(
    Math.max(value.y, minimumY),
    Math.max(minimumY, contentHeight - STATUS_HEIGHT)
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
  settingsWindow: BrowserWindow | null = null;
  agentSkillGuideWindow: BrowserWindow | null = null;
  private standaloneHost: OnlyPreviewHostCapability | null = null;
  private settingsHost: OnlyPreviewHostCapability | null = null;
  private agentSkillGuideHost: OnlyPreviewHostCapability | null = null;
  private searchBootstrapToken: string | null = null;
  private baseWindowState: WindowStateController | null = null;
  private settingsWindowState: WindowStateController | null = null;
  private agentSkillGuideWindowState: WindowStateController | null = null;
  private commandHandler: ((payload: OnlyPreviewNativeCommandPayload) => void) | null = null;
  private readonly diagnostics: OnlyPreviewSearchDiagnostics;

  constructor(diagnostics = createOnlyPreviewSearchDiagnostics()) {
    this.diagnostics = diagnostics;
  }

  setCommandHandler(handler: (payload: OnlyPreviewNativeCommandPayload) => void): void {
    this.commandHandler = handler;
  }

  bindNativeShortcuts(
    webContents: Electron.WebContents,
    host: OnlyPreviewHostCapability,
    origin: OnlyPreviewGlobalSearchFocusOrigin
  ): void {
    webContents.on('before-input-event', (event, input) => {
      const command = this.resolveNativeCommand(host, input);
      if (!command) return;
      event.preventDefault();
      if (command === 'find-in-file') {
        const opened = onlyPreviewPreviewRegionService.openFind(host.hostToken);
        if (
          opened &&
          host.kind === 'standalone' &&
          host.hostToken === this.standaloneHost?.hostToken &&
          this.shellView &&
          !this.shellView.webContents.isDestroyed()
        ) {
          this.shellView.webContents.focus();
        }
        xpcMain.broadcast(ONLY_PREVIEW_FIND_FOCUS_EVENT, { hostId: host.hostId });
        return;
      }
      if (command === 'close-find-in-file') {
        onlyPreviewPreviewRegionService.closeFind(host.hostToken);
        onlyPreviewPreviewRegionService.focusActiveContent(host.hostToken);
        return;
      }
      if (command === 'focus-search') {
        onlyPreviewPreviewRegionService.closeFind(host.hostToken);
        onlyPreviewGlobalSearchFocusService.capture(host.hostToken, origin, webContents);
        if (
          host.kind === 'standalone' &&
          host.hostToken === this.standaloneHost?.hostToken &&
          this.shellView &&
          !this.shellView.webContents.isDestroyed()
        ) {
          this.shellView.webContents.focus();
        }
        xpcMain.broadcast(ONLY_PREVIEW_FOCUS_SEARCH_EVENT, { hostId: host.hostId, origin });
        return;
      }
      if (command === 'focus-project') {
        if (
          host.kind === 'standalone' &&
          host.hostToken === this.standaloneHost?.hostToken &&
          this.shellView &&
          !this.shellView.webContents.isDestroyed()
        ) {
          this.shellView.webContents.focus();
        }
        xpcMain.broadcast(ONLY_PREVIEW_FOCUS_PROJECT_EVENT, { hostId: host.hostId });
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
    const diagnostic = { tag: this.diagnostics.nextTag('v'), startedAt: this.diagnostics.now() };
    this.diagnostics.emit('visible-window', {
      tag: diagnostic.tag,
      phase: 'start',
      elapsedMs: 0
    });
    try {
      await this.createStandaloneWindow(host, diagnostic);
      this.diagnostics.emit('visible-window-terminal', {
        tag: diagnostic.tag,
        outcome: 'success',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
      return host;
    } catch (error) {
      this.diagnostics.emit('visible-window-terminal', {
        tag: diagnostic.tag,
        outcome: 'failure',
        elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
      });
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
    if (!window || window.isDestroyed()) {
      throw new Error(`OnlyPreview host ${host.hostId} has no active preview surface.`);
    }
    const [contentWidth, contentHeight] = window.getContentSize();
    onlyPreviewPreviewRegionService.updateBounds(
      host.hostToken,
      isHiddenPreviewBounds(value)
        ? { x: 0, y: 0, width: 0, height: 0 }
        : clampPreviewBounds(value, contentWidth, contentHeight)
    );
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
    onlyPreviewPreviewRegionService.destroy();
    this.baseWindow = null;
    this.shellView = null;
    this.baseWindowState = null;
    fileSearchWindowService.stop();
    if (window && !window.isDestroyed()) {
      try {
        if (shellView) window.contentView.removeChildView(shellView);
      } catch {
        // The view may already have been detached by Electron during teardown.
      }
    }
    closeView(shellView);
    if (window && !window.isDestroyed()) window.destroy();
    if (this.searchBootstrapToken) {
      onlyPreviewSearchBootstrapRegistry.revoke(this.searchBootstrapToken);
    }
    this.searchBootstrapToken = null;
    onlyPreviewGlobalSearchFocusService.clear(this.standaloneHost?.hostToken);
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

  private async createStandaloneWindow(
    host: OnlyPreviewHostCapability,
    diagnostic: { tag: string; startedAt: number }
  ): Promise<void> {
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
    await fileSearchWindowService.start({
      host,
      bootstrapToken: searchBootstrap.searchToken,
      broadcast: (eventName, params) => {
        if (eventName === ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT) {
          const event = params as OnlyPreviewSearchWatchCommitEvent;
          if (event.hostId === host.hostId) {
            void onlyPreviewPreviewRegionService
              .handleWatchCommit(host.hostToken, event.commit)
              .catch(() => undefined);
          }
        }
        xpcMain.broadcast(eventName, params);
      },
      onUnexpectedExit: (reason) => {
        console.warn(`[OnlyPreview] ${reason} Closing the standalone window.`);
        this.destroyStandalone();
      }
    });
    this.diagnostics.emit('visible-window', {
      tag: diagnostic.tag,
      phase: 'runtime-ready',
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    if (this.baseWindow !== window || this.standaloneHost?.hostToken !== host.hostToken) {
      throw new Error('OnlyPreview file-search runtime startup was superseded.');
    }
    const shellView = this.createView(host, 'shell');
    this.shellView = shellView;
    window.contentView.addChildView(shellView);
    this.applyInitialBounds();
    onlyPreviewPreviewRegionService.start({
      window,
      host,
      createVuePreviewView: (previewRuntimeToken) =>
        this.createView(host, 'preview', previewRuntimeToken),
      loadVuePreviewView: async (view) => await this.loadView(view, 'preview'),
      bindChromeShortcuts: (webContents) => {
        this.bindNativeShortcuts(webContents, host, 'chrome');
        bindOnlyPreviewDevToolsShortcut(webContents);
      }
    });

    // A dead view closes the whole standalone window, which otherwise looks like the window simply
    // vanished. Name the view and the exit reason so the cause is recoverable from the log.
    const closeOnRendererFailure = (details: Electron.RenderProcessGoneDetails): void => {
      console.warn(
        `[OnlyPreview] The shell renderer exited (${details.reason}, exitCode ${details.exitCode}); closing the standalone window.`
      );
      if (this.baseWindow === window) this.destroyStandalone();
    };
    shellView.webContents.once('render-process-gone', (_event, details) =>
      closeOnRendererFailure(details)
    );
    shellView.webContents.once('did-finish-load', () => {
      if (this.baseWindow === window) this.baseWindowState?.show();
    });
    window.on('resize' as any, () => {
      if (this.baseWindow !== window) return;
      const [width, height] = window.getContentSize();
      shellView.setBounds({ x: 0, y: 0, width, height });
      const currentBounds = onlyPreviewPreviewRegionService.getBounds();
      if (currentBounds) {
        onlyPreviewPreviewRegionService.updateBounds(
          host.hostToken,
          isHiddenPreviewBounds(currentBounds)
            ? { x: 0, y: 0, width: 0, height: 0 }
            : clampPreviewBounds(currentBounds, width, height)
        );
      }
    });
    window.once('closed' as any, () => {
      if (this.baseWindow !== window) return;
      this.destroySettings();
      this.destroyAgentSkillGuide();
      this.baseWindow = null;
      this.shellView = null;
      this.baseWindowState = null;
      fileSearchWindowService.stop();
      onlyPreviewPreviewRegionService.destroy();
      closeView(shellView);
      if (this.searchBootstrapToken === searchBootstrap.searchToken) {
        onlyPreviewSearchBootstrapRegistry.revoke(searchBootstrap.searchToken);
        this.searchBootstrapToken = null;
      }
      if (this.standaloneHost?.hostToken === host.hostToken) this.standaloneHost = null;
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    await this.loadView(shellView, 'shell');
    this.diagnostics.emit('visible-window', {
      tag: diagnostic.tag,
      phase: 'renderer-loaded',
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    const previewView = onlyPreviewPreviewRegionService.getVuePreviewView();
    if (
      !shouldAutoOpenOnlyPreviewDevTools() ||
      this.baseWindow !== window ||
      this.shellView !== shellView ||
      !previewView ||
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
    mode: 'shell' | 'preview',
    previewRuntimeToken?: string
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
        additionalArguments: additionalArguments(host, mode, previewRuntimeToken)
      }
    });
    configureNavigationFence(view.webContents, target.url, mode === 'shell');
    this.bindNativeShortcuts(view.webContents, host, mode === 'shell' ? 'shell' : 'vue');
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
    if (!this.baseWindow || !this.shellView) return;
    const [width, height] = this.baseWindow.getContentSize();
    this.shellView.setBounds({ x: 0, y: 0, width, height });
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
    if (isGlobalSearchShortcut(input)) return 'focus-search';
    if (isCurrentFileFindShortcut(input)) return 'find-in-file';
    if (
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      input.key === 'Escape' &&
      !input.shift &&
      !input.alt &&
      !input.control &&
      !input.meta &&
      this.standaloneHost?.hostToken === host.hostToken &&
      onlyPreviewPreviewRegionService.isFindOpen(host.hostToken)
    ) {
      return 'close-find-in-file';
    }
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
