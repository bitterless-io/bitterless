import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { is } from '@electron-toolkit/utils';
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import type { TrenchIoRuntimeApi } from '@shared/trench/trenchIndex.type';
import {
  TRENCH_INDEX_CHANGED_EVENT,
  trenchIoRuntimeHandlerName,
} from '@shared/trench/trenchIndex.type';
import { trenchIoCapabilityRegistry } from './trenchIoCapability.registry';
import { trenchIoClientService } from './trenchIoClient.service';
import { TRENCH_PERSON_CHANGED_EVENT } from '@shared/trench/trenchPerson.type';

const STARTUP_TIMEOUT_MS = 20_000;

const rendererTarget = (): { filePath: string; url: string } => {
  const rendererPath = 'trench-io/index.html';
  const filePath = join(__dirname, `../renderer/${rendererPath}`);
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return {
      filePath,
      url: `${process.env.ELECTRON_RENDERER_URL.replace(/\/+$/, '')}/${rendererPath}`,
    };
  }
  return { filePath, url: pathToFileURL(filePath).href };
};

export class TrenchIoWindowService {
  private window: BrowserWindow | null = null;
  private lifecycle = 0;
  private shouldRun = false;
  private restartAttempts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRevision = 0;

  async start(): Promise<void> {
    this.shouldRun = true;
    this.restartAttempts = 0;
    this.clearRestart();
    try {
      await this.startWindow();
    } catch (error) {
      this.scheduleRestart();
      throw error;
    }
  }

  stop(): void {
    this.shouldRun = false;
    this.clearRestart();
    this.destroyWindow();
  }

  private async startWindow(): Promise<void> {
    this.destroyWindow();
    const lifecycle = ++this.lifecycle;
    const identity = trenchIoCapabilityRegistry.issue();
    const client = createXpcMainEmitter<TrenchIoRuntimeApi>(
      trenchIoRuntimeHandlerName(identity.capability),
    );
    const target = rendererTarget();
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 16,
      height: 16,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/trench-io.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        additionalArguments: [
          `--trench-io-capability=${identity.capability}`,
          `--trench-io-instance=${identity.instanceId}`,
        ],
      },
    });
    window.setMenuBarVisibility(false);
    this.window = window;
    const fail = (): void => {
      if (this.window !== window || this.lifecycle !== lifecycle) return;
      this.destroyWindow();
      this.broadcast('unavailable');
      this.scheduleRestart();
    };
    const fence = (event: Electron.Event, url: string): void => {
      if (url === target.url) return;
      event.preventDefault();
    };
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', fence);
    window.webContents.on('will-redirect', fence);
    window.webContents.once('render-process-gone', fail);
    window.once('unresponsive', fail);
    window.once('closed', fail);
    try {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) await window.loadURL(target.url);
      else await window.loadFile(target.filePath);
      const deadline = Date.now() + STARTUP_TIMEOUT_MS;
      const callReady = async () => {
        try {
          return await client.ready(identity);
        } catch {
          return null;
        }
      };
      let ready = await callReady();
      while ((!ready || !ready.ok) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        ready = await callReady();
      }
      if (!ready?.ok) throw new Error(ready?.error.message ?? '[trench-io] runtime did not register.');
      if (this.window !== window || this.lifecycle !== lifecycle || window.isDestroyed()) {
        throw new Error('[trench-io] startup was superseded.');
      }
      trenchIoClientService.attach({ ...identity, client });
      this.lastRevision = ready.value.revision;
      const workspace = await client.getWorkspace({ ...identity, request: {} }).catch(() => null);
      if (workspace?.ok) {
        this.lastRevision = workspace.value.revision;
        this.broadcast(workspace.value.jobState);
      } else {
        this.broadcast('idle');
      }
    } catch (error) {
      if (this.window === window) this.destroyWindow();
      this.broadcast('unavailable');
      throw error;
    }
  }

  private destroyWindow(): void {
    this.lifecycle += 1;
    const window = this.window;
    this.window = null;
    trenchIoClientService.detach();
    trenchIoCapabilityRegistry.revoke();
    if (window && !window.isDestroyed()) window.destroy();
  }

  private scheduleRestart(): void {
    if (!this.shouldRun || this.restartTimer || this.restartAttempts >= 3) return;
    const delay = [250, 1_000, 3_000][this.restartAttempts] ?? 3_000;
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.shouldRun) return;
      void this.startWindow().catch(() => this.scheduleRestart());
    }, delay);
  }

  private clearRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private broadcast(jobState: 'idle' | 'running' | 'unavailable'): void {
    xpcMain.broadcast(TRENCH_INDEX_CHANGED_EVENT, {
      schema: 'bl-trench-index-changed-v1',
      revision: this.lastRevision,
      jobState,
    });
    xpcMain.broadcast(TRENCH_PERSON_CHANGED_EVENT, {
      schema: 'bl-trench-person-changed-v1',
      revision: this.lastRevision,
    });
  }
}

export const trenchIoWindowService = new TrenchIoWindowService();
