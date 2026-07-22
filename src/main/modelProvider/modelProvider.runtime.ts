import { watchFile, unwatchFile, type Stats } from 'node:fs';
import { app } from 'electron';
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import type { SettingDao } from '@preload/sqlite/dao/setting.dao';
import {
  MODEL_PROVIDER_DEVICE_CODE_EVENT,
  MODEL_PROVIDER_SNAPSHOT_CHANGED_EVENT,
  type ModelProviderDeviceCodeNotice
} from '@shared/modelProvider/modelProvider.contract';
import { codexAuthPath } from '@main/codex/codexPaths';
import { codexCredentialService } from '@main/codex/codexCredential.runtime';
import { ModelProviderService } from './modelProvider.service';

const settings = createXpcMainEmitter<SettingDao>('SettingDao');

const watchCodexCredentials = (listener: () => void): (() => void) => {
  const path = codexAuthPath(app.getPath('userData'));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onChange = (current: Stats, previous: Stats): void => {
    if (
      current.mtimeMs === previous.mtimeMs &&
      current.ctimeMs === previous.ctimeMs &&
      current.size === previous.size
    ) {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(listener, 200);
  };
  watchFile(path, { persistent: false, interval: 750 }, onChange);
  return () => {
    if (timer) clearTimeout(timer);
    unwatchFile(path, onChange);
  };
};

export const modelProviderService = new ModelProviderService({
  settings,
  credentials: codexCredentialService,
  broadcastSnapshot: (snapshot) => {
    xpcMain.broadcast(MODEL_PROVIDER_SNAPSHOT_CHANGED_EVENT, snapshot);
  },
  broadcastDeviceCode: (notice: ModelProviderDeviceCodeNotice | null) => {
    xpcMain.broadcast(MODEL_PROVIDER_DEVICE_CODE_EVENT, notice);
  },
  watchCredentialChanges: watchCodexCredentials
});
