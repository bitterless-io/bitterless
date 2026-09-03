import {
  app,
  BaseWindow,
  BrowserWindow,
  screen,
  WebContentsView,
  type Input,
  type Rectangle
} from 'electron';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import type {
  OnlyPreviewBounds,
  OnlyPreviewGlobalSearchFocusOrigin
} from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT,
  ONLY_PREVIEW_FIND_FOCUS_EVENT,
  ONLY_PREVIEW_FOCUS_PROJECT_EVENT
} from '@shared/onlypreview/onlyPreview.types';
import { xpcMain } from 'electron-xpc/main';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  onlyPreviewHostRegistry,
  type OnlyPreviewHostCapability
} from '@main/onlypreview/onlyPreviewHost.registry';
import { resolveOnlyPreviewSettingsBounds } from '@main/onlypreview/onlyPreviewWindowBounds.service';
import { onlyPreviewSearchBootstrapRegistry } from '@main/onlypreview/onlyPreviewSearchBootstrap.registry';
import { onlyPreviewProjectIndexStateService } from '@main/onlypreview/onlyPreviewProjectIndexState.service';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewPreviewRegionService } from '@main/onlypreview/views/onlyPreviewPreviewRegion.service';
import { onlyPreviewGlobalSearchFocusService } from '@main/onlypreview/onlyPreviewGlobalSearchFocus.service';
import { onlyPreviewGlobalSearchWindowService } from '@main/onlypreview/views/onlyPreviewGlobalSearchWindow.service';
import {
  configureOnlyPreviewNavigationFence,
  getOnlyPreviewRendererArguments,
  getOnlyPreviewRendererTarget
} from '@main/onlypreview/views/onlyPreviewRendererTarget.service';
import {
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT,
  type OnlyPreviewSearchSnapshotEvent,
  type OnlyPreviewSearchWatchCommitEvent
} from '@shared/onlypreview/onlyPreviewSearch.type';
import '@main/xpc/onlyPreviewSearchRuntime.handler';
import { windowStateService, type WindowStateController } from './windowState.service';
import {
  createOnlyPreviewSearchDiagnostics,
  type OnlyPreviewSearchDiagnostics
} from '@shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import {
  createOnlyPreviewWindowOpenCoordinator,
  type OnlyPreviewOpenTrace
} from '@shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';
import { onlyPreviewOpenDiagnostics } from '@main/onlypreview/onlyPreviewOpenDiagnostics.runtime';

const DEFAULT_WIDTH = 1180;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const MIN_SIDEBAR_WIDTH = 180;
const RESIZE_HANDLE_WIDTH = 5;
const MENU_BAR_HEIGHT = 32;
const PREVIEW_TOOLBAR_HEIGHT = 43;
const STATUS_HEIGHT = 25;

type OnlyPreviewShortcutOrigin = OnlyPreviewGlobalSearchFocusOrigin | 'search';
type OnlyPreviewNativeCommand =
  | 'choose-folder'
  | 'open-settings'
  | 'refresh'
  | 'focus-project'
  | 'focus-search'
  | 'find-in-file'
  | 'close-find-in-file'
  | 'copy-project-path'
  | 'copy-project-name';

interface OnlyPreviewNativeCommandPayload {
  hostToken: string;
  command: OnlyPreviewNativeCommand;
}

const closeView = (view: WebContentsView | null): void => {
  if (!view || view.webContents.isDestroyed()) return;
  try {
    view.webContents.close();
  } catch {
    // The owning BaseWindow may already have destroyed this view.
  }
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

/**
 * Copy Path (Shift) and Copy Name (Alt), as window-wide shortcuts.
 *
 * They used to exist only as a DOM handler in the shell renderer, which required the tree row to
 * hold DOM focus. Every other OnlyPreview shortcut is Main-owned through `before-input-event` on
 * all four views precisely so it survives focus living anywhere, and these two were simply never
 * given that treatment. Plain Cmd+C is deliberately excluded: inside a document it means "copy the
 * selected text", and taking it here would break that.
 */
const isProjectItemCopyShortcut = (input: Input): boolean => {
  if (
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    input.key.toLowerCase() !== 'c' ||
    !isCommandModifier(input) ||
    // Exactly one of Shift/Alt, matching the renderer's XOR: Shift+Alt+Cmd+C is not a copy.
    input.shift === input.alt
  ) {
    return false;
  }
  return process.platform === 'darwin' ? !input.control : !input.meta;
};

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

// Preview is the owner-facing test channel, so it carries the DevTools shortcut even though it is a
// packaged release build. Stable keeps DevTools closed. Auto-open stays debug-only either way.
const isOnlyPreviewDevToolsEnabled = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' ||
  import.meta.env.VITE_RELEASE_CHANNEL === 'preview' ||
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
  private readonly windowOpenTraces = createOnlyPreviewWindowOpenCoordinator({
    diagnostics: onlyPreviewOpenDiagnostics
  });
  private shellStartupLease: {
    hostToken: string;
    window: BaseWindow;
    view: WebContentsView;
  } | null = null;

  constructor(diagnostics = createOnlyPreviewSearchDiagnostics()) {
    this.diagnostics = diagnostics;
  }

  setCommandHandler(handler: (payload: OnlyPreviewNativeCommandPayload) => void): void {
    this.commandHandler = handler;
  }

  bindNativeShortcuts(
    webContents: Electron.WebContents,
    host: OnlyPreviewHostCapability,
    origin: OnlyPreviewShortcutOrigin
  ): void {
    webContents.on('before-input-event', (event, input) => {
      const command = this.resolveNativeCommand(host, input);
      if (!command) return;
      event.preventDefault();
      if (command === 'find-in-file') {
        onlyPreviewGlobalSearchWindowService.closeForFind(host.hostToken);
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
      if (command === 'copy-project-path' || command === 'copy-project-name') {
        // No focus move: a copy must not pull the owner out of the document they are reading.
        xpcMain.broadcast(ONLY_PREVIEW_COPY_PROJECT_ITEM_EVENT, {
          hostId: host.hostId,
          copyKind: command === 'copy-project-path' ? 'absolute-path' : 'name'
        });
        return;
      }
      if (command === 'close-find-in-file') {
        onlyPreviewPreviewRegionService.closeFind(host.hostToken);
        onlyPreviewPreviewRegionService.focusActiveContent(host.hostToken);
        return;
      }
      if (command === 'focus-search') {
        onlyPreviewPreviewRegionService.closeFind(host.hostToken);
        onlyPreviewGlobalSearchWindowService.open(host, origin, webContents);
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

  async ensureStandalone(route: 'api' | 'explicit' = 'api'): Promise<OnlyPreviewHostCapability> {
    const currentWindow = this.baseWindow;
    const currentHost = this.getStandaloneHost();
    const mode = currentWindow && !currentWindow.isDestroyed() && currentHost ? 'existing' : 'cold';
    if (mode === 'cold') this.destroyStandalone();
    const openTrace = this.windowOpenTraces.begin(route, mode);
    if (currentWindow && !currentWindow.isDestroyed() && currentHost) {
      this.show();
      openTrace.mark({ phase: 'show' });
      this.windowOpenTraces.finish(openTrace.tag, 'success');
      return currentHost;
    }
    const host = onlyPreviewHostRegistry.issue('standalone', 'content');
    this.standaloneHost = host;
    const diagnostic = { tag: this.diagnostics.nextTag('v'), startedAt: this.diagnostics.now() };
    this.diagnostics.emit('visible-window', {
      tag: diagnostic.tag,
      phase: 'start',
      elapsedMs: 0
    });
    try {
      await this.createStandaloneWindow(host, diagnostic, openTrace);
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
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'fail');
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

  reportShellMounted(
    hostToken: string,
    openTag: string,
    phase: 'renderer-script' | 'renderer-language' | 'renderer-import' | 'renderer-mount' | 'renderer-receipt',
    outcome?: 'success' | 'failure'
  ): void {
    this.requireStandaloneHost(hostToken);
    const window = this.baseWindow;
    const shellView = this.shellView;
    if (
      !window ||
      window.isDestroyed() ||
      !shellView ||
      shellView.webContents.isDestroyed() ||
      !this.isCurrentShell(hostToken, window, shellView)
    ) return;
    if (phase === 'renderer-receipt' && outcome) {
      this.settleShellStartupLease(hostToken, window, shellView);
    }
    if (this.windowOpenTraces.isActive(openTag)) this.windowOpenTraces.mark(openTag, {
      phase,
      role: 'shell',
      lifecycle: 'bootstrap',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: shellView.webContents.getBackgroundThrottling()
    });
    if (phase === 'renderer-receipt' && outcome) {
      if (outcome === 'success' && this.windowOpenTraces.isActive(openTag)) {
        this.windowOpenTraces.mark(openTag, {
          phase: 'interactive',
          role: 'shell',
          lifecycle: 'interactive',
          visible: window.isVisible(),
          focused: window.isFocused(),
          backgroundThrottling: shellView.webContents.getBackgroundThrottling()
        });
      }
      this.finishShellOpenTrace(
        openTag,
        outcome,
        outcome === 'failure' ? 'bootstrap-fail' : 'none'
      );
      // The shell is interactive, so its first paint is no longer at stake and the search overlay's
      // renderer can be built now instead of on the first Shift+Cmd+F. Building it earlier — in
      // `start()`, before the shell's own load — would contend with exactly what `first-visible`
      // exists to protect.
      if (outcome === 'success') {
        try {
          onlyPreviewGlobalSearchWindowService.preload(hostToken);
        } catch {
          // A host that was revoked between the receipt and here simply gets no warm overlay.
        }
      }
    }
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
    const bounds = clampPreviewBounds(value, contentWidth, contentHeight);
    onlyPreviewPreviewRegionService.updateBounds(host.hostToken, bounds);
    onlyPreviewGlobalSearchWindowService.updateBounds(
      host.hostToken,
      { x: 0, y: 0, width: contentWidth, height: contentHeight },
      bounds
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
    const target = getOnlyPreviewRendererTarget('settings', __dirname);
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
        additionalArguments: getOnlyPreviewRendererArguments(host, 'settings')
      }
    });
    this.settingsWindow = window;
    this.settingsWindowState = windowStateService.register('onlypreview-settings', window);
    configureOnlyPreviewNavigationFence(window.webContents, target.url);
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
    const target = getOnlyPreviewRendererTarget('guide', __dirname);
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
        additionalArguments: getOnlyPreviewRendererArguments(host, 'guide')
      }
    });
    this.agentSkillGuideWindow = window;
    this.agentSkillGuideWindowState = windowStateService.register('onlypreview-guide', window);
    configureOnlyPreviewNavigationFence(window.webContents, target.url, false);
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
    this.windowOpenTraces.supersede();
    if (window && shellView && this.standaloneHost) {
      this.settleShellStartupLease(this.standaloneHost.hostToken, window, shellView);
    }
    onlyPreviewGlobalSearchWindowService.destroy();
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
    diagnostic: { tag: string; startedAt: number },
    openTrace: OnlyPreviewOpenTrace
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
    openTrace.mark({
      phase: 'native',
      role: 'base',
      lifecycle: 'created',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: true
    });
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
        // Main sees every snapshot before the renderers do, and the relay has already validated its
        // shape and fenced it on the active workspace generation, so this is the authoritative
        // point to record whether the Project index is finished.
        if (eventName === ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT) {
          const event = params as OnlyPreviewSearchSnapshotEvent;
          if (event.hostId === host.hostId) {
            onlyPreviewProjectIndexStateService.markObserved(
              host.hostId,
              event.snapshot.workspaceId,
              event.snapshot.state
            );
          }
        }
        xpcMain.broadcast(eventName, params);
      },
      onUnexpectedExit: (reason) => {
        console.warn(`[OnlyPreview] ${reason} Closing the standalone window.`);
        this.destroyStandalone();
      },
      onOpenStage: (phase) => openTrace.mark({
        phase,
        role: 'hidden-search',
        lifecycle: 'ready',
        visible: false,
        focused: false,
        backgroundThrottling: false
      })
    });
    openTrace.mark({ phase: 'runtime' });
    this.diagnostics.emit('visible-window', {
      tag: diagnostic.tag,
      phase: 'runtime-ready',
      elapsedMs: this.diagnostics.elapsed(diagnostic.startedAt)
    });
    if (this.baseWindow !== window || this.standaloneHost?.hostToken !== host.hostToken) {
      throw new Error('OnlyPreview file-search runtime startup was superseded.');
    }
    const shellView = this.createView(host, 'shell', undefined, undefined, undefined, openTrace.tag);
    openTrace.mark({
      phase: 'shell-create',
      role: 'shell',
      lifecycle: 'created',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: shellView.webContents.getBackgroundThrottling()
    });
    this.shellView = shellView;
    this.shellStartupLease = { hostToken: host.hostToken, window, view: shellView };
    window.contentView.addChildView(shellView);
    // The constructor only carries width/height/x/y. WindowStateController.show() is what applies
    // the persisted bounds and any saved maximize/full-screen, so the listener has to exist before
    // show() or that restore resize lands with nothing watching and the content keeps the
    // constructor-time layout for the whole session.
    window.on('resize' as any, () => {
      if (this.baseWindow !== window) return;
      const [width, height] = window.getContentSize();
      shellView.setBounds({ x: 0, y: 0, width, height });
      const currentBounds = onlyPreviewPreviewRegionService.getBounds();
      if (currentBounds) {
        const bounds = clampPreviewBounds(currentBounds, width, height);
        onlyPreviewPreviewRegionService.updateBounds(host.hostToken, bounds);
        onlyPreviewGlobalSearchWindowService.updateBounds(
          host.hostToken,
          { x: 0, y: 0, width, height },
          bounds
        );
      }
    });
    this.applyInitialBounds();
    this.show();
    // maximize() and setFullScreen(true) settle asynchronously on macOS: this covers the first
    // frame, the listener above covers the settle.
    this.applyInitialBounds();
    openTrace.mark({
      phase: 'show',
      role: 'base',
      lifecycle: 'shown',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: shellView.webContents.getBackgroundThrottling()
    });
    openTrace.mark({
      phase: 'first-visible',
      role: 'base',
      lifecycle: 'shown',
      visible: window.isVisible(),
      focused: window.isFocused(),
      backgroundThrottling: shellView.webContents.getBackgroundThrottling()
    });
    onlyPreviewGlobalSearchWindowService.start({
      window,
      host,
      shellView,
      isCurrent: () => this.shellView === shellView && this.baseWindow === window,
      createView: () => this.createView(host, 'globalSearch'),
      loadView: async (view) => await this.loadView(view, 'globalSearch')
    });
    onlyPreviewPreviewRegionService.start({
      window,
      host,
      createVuePreviewView: (
        previewRuntimeToken,
        officeBrokerCapability,
        previewReadBrokerCapability
      ) =>
        this.createView(
          host,
          'preview',
          previewRuntimeToken,
          officeBrokerCapability,
          previewReadBrokerCapability
        ),
      loadVuePreviewView: async (view) => await this.loadView(view, 'preview'),
      bindChromeShortcuts: (webContents) => {
        this.bindNativeShortcuts(webContents, host, 'chrome');
        bindOnlyPreviewDevToolsShortcut(webContents);
      },
      onActiveViewAttached: () =>
        onlyPreviewGlobalSearchWindowService.raiseAfterPreviewAttach(host.hostToken)
    });

    // A dead view closes the whole standalone window, which otherwise looks like the window simply
    // vanished. Name the view and the exit reason so the cause is recoverable from the log.
    const closeOnRendererFailure = (details: Electron.RenderProcessGoneDetails): void => {
      if (!this.isCurrentShell(host.hostToken, window, shellView)) return;
      this.settleShellStartupLease(host.hostToken, window, shellView);
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'render-gone');
      console.warn(
        `[OnlyPreview] The shell renderer exited (${details.reason}, exitCode ${details.exitCode}); closing the standalone window.`
      );
      if (this.baseWindow === window) this.destroyStandalone();
    };
    shellView.webContents.once('render-process-gone', (_event, details) =>
      closeOnRendererFailure(details)
    );
    shellView.webContents.once('dom-ready', () => {
      if (this.shellView !== shellView) return;
      openTrace.mark({ phase: 'shell-dom-ready', role: 'shell', lifecycle: 'dom-ready' });
    });
    shellView.webContents.once('did-finish-load', () => {
      if (this.baseWindow !== window || this.shellView !== shellView) return;
      openTrace.mark({ phase: 'shell-did-finish', role: 'shell', lifecycle: 'did-finish' });
    });
    shellView.webContents.once('did-fail-load', () => {
      if (!this.isCurrentShell(host.hostToken, window, shellView)) return;
      this.settleShellStartupLease(host.hostToken, window, shellView);
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'load-fail');
    });
    shellView.webContents.once('unresponsive', () => {
      if (!this.isCurrentShell(host.hostToken, window, shellView)) return;
      this.settleShellStartupLease(host.hostToken, window, shellView);
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'unresponsive');
    });
    window.once('closed' as any, () => {
      if (
        this.baseWindow !== window ||
        this.standaloneHost?.hostToken !== host.hostToken
      ) return;
      this.settleShellStartupLease(host.hostToken, window, shellView);
      this.finishShellOpenTrace(openTrace.tag, 'failure', 'closed');
      this.destroySettings();
      this.destroyAgentSkillGuide();
      this.baseWindow = null;
      this.shellView = null;
      this.baseWindowState = null;
      fileSearchWindowService.stop();
      onlyPreviewGlobalSearchWindowService.destroy();
      onlyPreviewPreviewRegionService.destroy();
      closeView(shellView);
      if (this.searchBootstrapToken === searchBootstrap.searchToken) {
        onlyPreviewSearchBootstrapRegistry.revoke(searchBootstrap.searchToken);
        this.searchBootstrapToken = null;
      }
      if (this.standaloneHost?.hostToken === host.hostToken) this.standaloneHost = null;
      onlyPreviewHostRegistry.revoke(host.hostToken);
    });
    openTrace.mark({ phase: 'shell-load-start', role: 'shell', lifecycle: 'loading' });
    await this.loadView(shellView, 'shell');
    openTrace.mark({ phase: 'shell-load-resolved', role: 'shell', lifecycle: 'load-resolved' });
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
    mode: 'shell' | 'preview' | 'globalSearch',
    previewRuntimeToken?: string,
    officeBrokerCapability?: string,
    previewReadBrokerCapability?: string,
    openTag?: string
  ): WebContentsView {
    const target = getOnlyPreviewRendererTarget(mode, __dirname);
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
        backgroundThrottling: mode !== 'shell',
        additionalArguments: getOnlyPreviewRendererArguments(
          host,
          mode,
          previewRuntimeToken,
          officeBrokerCapability,
          previewReadBrokerCapability,
          openTag
        )
      }
    });
    if (mode === 'globalSearch') view.setBackgroundColor('#00000000');
    configureOnlyPreviewNavigationFence(view.webContents, target.url, mode === 'shell');
    this.bindNativeShortcuts(
      view.webContents,
      host,
      mode === 'shell' ? 'shell' : mode === 'preview' ? 'vue' : 'search'
    );
    bindOnlyPreviewDevToolsShortcut(view.webContents);
    return view;
  }

  private async loadView(
    view: WebContentsView,
    mode: 'shell' | 'preview' | 'globalSearch'
  ): Promise<void> {
    const target = getOnlyPreviewRendererTarget(mode, __dirname);
    await (is.dev && process.env['ELECTRON_RENDERER_URL']
      ? view.webContents.loadURL(target.url)
      : view.webContents.loadFile(target.filePath));
  }

  private applyInitialBounds(): void {
    if (!this.baseWindow || !this.shellView) return;
    const [width, height] = this.baseWindow.getContentSize();
    this.shellView.setBounds({ x: 0, y: 0, width, height });
  }

  private finishShellOpenTrace(
    tag: string,
    outcome: 'success' | 'failure' | 'superseded',
    reason: 'none' | 'fail' | 'closed' | 'load-fail' | 'render-gone' | 'unresponsive' | 'bootstrap-fail' = 'none'
  ): void {
    this.windowOpenTraces.finish(tag, outcome, reason);
  }

  private isCurrentShell(
    hostToken: string,
    window: BaseWindow,
    view: WebContentsView
  ): boolean {
    return this.baseWindow === window && this.shellView === view &&
      this.standaloneHost?.hostToken === hostToken;
  }

  private settleShellStartupLease(
    hostToken: string,
    window: BaseWindow,
    view: WebContentsView
  ): boolean {
    if (!this.isCurrentShell(hostToken, window, view)) return false;
    const lease = this.shellStartupLease;
    if (lease?.hostToken !== hostToken || lease.window !== window || lease.view !== view) return false;
    this.shellStartupLease = null;
    if (!view.webContents.isDestroyed()) view.webContents.setBackgroundThrottling(true);
    return true;
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
      isProjectItemCopyShortcut(input) &&
      this.standaloneHost?.hostToken === host.hostToken &&
      // A keystroke typed into the Global Search field belongs to that field, not to the tree.
      !onlyPreviewGlobalSearchWindowService.isActive(host.hostToken)
    ) {
      return input.shift ? 'copy-project-path' : 'copy-project-name';
    }
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
