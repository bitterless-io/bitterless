import { BrowserWindow } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { createXpcMainEmitter } from 'electron-xpc/main';
import type { OnlyPreviewHostCapability } from '@main/onlypreview/onlyPreviewHost.registry';
import type { FileSearchRuntimePrivateApi } from '@shared/onlypreview/fileSearchRuntime.types';
import { fileSearchRuntimeHandlerName } from '@shared/onlypreview/fileSearchRuntime.types';
import { fileSearchRuntimeRelayService } from './fileSearchRuntimeRelay.service';
import { FileSearchLifecycleFence } from './fileSearchLifecycleFence.service';
import { waitForFileSearchRuntimeReady } from './fileSearchRuntimeReady.service';
import { registerFileSearchRuntimeEventHandler } from './fileSearchRuntimeEvent.handler';

const rendererTarget = (): { filePath: string; url: string } => {
  const rendererPath = 'fileSearch/index.html';
  const filePath = join(__dirname, `../renderer/${rendererPath}`);
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return {
      filePath,
      url: `${process.env.ELECTRON_RENDERER_URL.replace(/\/+$/, '')}/${rendererPath}`
    };
  }
  return { filePath, url: pathToFileURL(filePath).href };
};

export class FileSearchWindowService {
  private window: BrowserWindow | null = null;
  private lifecycleId = 0;

  async start(params: {
    host: OnlyPreviewHostCapability;
    bootstrapToken: string;
    broadcast(eventName: string, value: unknown): void;
    onUnexpectedExit(reason: string): void;
  }): Promise<void> {
    this.stop();
    const lifecycleId = ++this.lifecycleId;
    const capability = randomBytes(32).toString('base64url');
    const instanceId = randomUUID();
    registerFileSearchRuntimeEventHandler(capability);
    const runtimeClient = createXpcMainEmitter<FileSearchRuntimePrivateApi>(
      fileSearchRuntimeHandlerName(capability)
    );
    const target = rendererTarget();
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 16,
      height: 16,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/fileSearch.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        additionalArguments: [
          `--file-search-capability=${capability}`,
          `--file-search-instance=${instanceId}`
        ]
      }
    });
    window.setMenuBarVisibility(false);
    this.window = window;

    let resolveStopped = (): void => undefined;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const lifecycleFence = new FileSearchLifecycleFence(target.url, (message) => {
      if (this.window !== window || this.lifecycleId !== lifecycleId) return;
      resolveStopped();
      this.stop();
      params.onUnexpectedExit(message);
    });
    const fenceNavigation = (event: Electron.Event, url: string): void => {
      if (lifecycleFence.acceptNavigation(url)) return;
      event.preventDefault();
    };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', fenceNavigation);
    window.webContents.on('will-redirect', fenceNavigation);
    window.webContents.once('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) lifecycleFence.fail('File-search renderer failed to load.');
    });
    window.webContents.once('render-process-gone', () => {
      lifecycleFence.fail('File-search renderer exited unexpectedly.');
    });
    window.once('unresponsive', () =>
      lifecycleFence.fail('File-search renderer became unresponsive.')
    );
    window.once('closed', () => lifecycleFence.fail('File-search renderer closed unexpectedly.'));

    try {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) await window.loadURL(target.url);
      else await window.loadFile(target.filePath);
      if (this.window !== window || this.lifecycleId !== lifecycleId || window.isDestroyed()) {
        throw new Error('File-search renderer startup was superseded.');
      }
      await waitForFileSearchRuntimeReady({
        runtimeClient,
        capability,
        instanceId,
        stopped
      });
      if (this.window !== window || this.lifecycleId !== lifecycleId || window.isDestroyed()) {
        throw new Error('File-search renderer startup was superseded.');
      }
      fileSearchRuntimeRelayService.attach({
        hostToken: params.host.hostToken,
        hostId: params.host.hostId,
        bootstrapToken: params.bootstrapToken,
        capability,
        client: runtimeClient,
        broadcast: params.broadcast
      });
      window.once('closed', () => lifecycleFence.stop());
    } catch (error) {
      if (this.window === window) this.stop();
      throw error;
    }
  }

  stop(): void {
    this.lifecycleId += 1;
    const window = this.window;
    this.window = null;
    fileSearchRuntimeRelayService.detach();
    if (window && !window.isDestroyed()) window.destroy();
  }

  isOwner(window: BrowserWindow): boolean {
    return this.window === window && !window.isDestroyed();
  }
}

export const fileSearchWindowService = new FileSearchWindowService();
