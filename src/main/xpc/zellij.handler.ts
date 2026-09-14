import { clipboard, shell } from 'electron';
import { existsSync } from 'node:fs';
import { XpcMainHandler, xpcMain } from 'electron-xpc/main';
import type { ZellijApi, ZellijErrorCode, ZellijSnapshot } from '@shared/zellij/zellij.type';
import { getZellijRuntime } from '@main/zellij/zellijRuntime.service';
import { zellijWindowService } from '@main/zellij/zellijWindow.service';
import { ZELLIJ_SETTINGS_OPEN_EVENT } from '@shared/zellij/zellij.type';
import { maestroWindowHandler } from './maestroWindow.handler';
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller';

class ZellijHandler extends XpcMainHandler implements ZellijApi {
  private settingsRequested = false;

  async openSettings(): Promise<void> {
    this.settingsRequested = true;
    await maestroWindowHandler.openMaestroWindow();
    await maestroWindowHelper.openWorkbenchTab();
    xpcMain.broadcast(ZELLIJ_SETTINGS_OPEN_EVENT, {});
  }

  async consumeSettingsRequest(): Promise<boolean> {
    const pending = this.settingsRequested;
    this.settingsRequested = false;
    return pending;
  }
  async snapshot(params: { surfaceId: string }): Promise<ZellijSnapshot> {
    if (!params.surfaceId) return getZellijRuntime().settingsSnapshot();
    return zellijWindowService.snapshot(params.surfaceId);
  }
  async initialize(params: { surfaceId: string }): Promise<ZellijSnapshot> {
    return zellijWindowService.initializeSurface(params.surfaceId);
  }
  async saveShortcuts(params: {
    revision: string;
    shortcuts: ZellijSnapshot['shortcuts'];
  }): Promise<ZellijSnapshot> {
    return getZellijRuntime().saveShortcuts(params);
  }
  async copyConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }> {
    try {
      clipboard.writeText(getZellijRuntime().snapshot().configDirectory);
      return { ok: true, error: null };
    } catch {
      return { ok: false, error: 'operation-failed' };
    }
  }
  async openConfigDirectory(): Promise<{ ok: boolean; error: ZellijErrorCode | null }> {
    const directory = getZellijRuntime().snapshot().configDirectory;
    if (!existsSync(directory)) return { ok: false, error: 'directory-missing' };
    try {
      if (await shell.openPath(directory)) return { ok: false, error: 'directory-open-failed' };
      return { ok: true, error: null };
    } catch {
      return { ok: false, error: 'directory-open-failed' };
    }
  }
  async setContentBounds(params: {
    surfaceId: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<void> {
    // An `XpcMainHandler` method sees only `params` — there is no sender web contents to infer the
    // surface from — so a call without an id cannot be routed and is dropped rather than guessed.
    if (!params?.surfaceId) return;
    zellijWindowService.setContentBounds(params.surfaceId, params);
  }
}

export const zellijHandler = new ZellijHandler();
