import { XpcMainHandler } from 'electron-xpc/main';
import { dialogHelper } from '../dialog/dialog.helper';
import { mainSafeStorage } from '../security/safeStorage.runtime';
import type { SafeStorageCaller } from '../security/safeStoragePolicy.service';
import type { TodoistSyncPasswordCapabilityApi } from '@shared/todoistSync/todoistSyncCapability.type';

const resolveSafeStorageCaller = (value: unknown): SafeStorageCaller => {
  return value === 'core-sqlite' || value === 'todoist-sync'
    ? value
    : 'sqlite-password';
};

class SqlitePasswordHandler extends XpcMainHandler implements TodoistSyncPasswordCapabilityApi {
  async encryptPassword(params: {
    password: string;
    caller?: 'core-sqlite' | 'todoist-sync';
  }): Promise<string> {
    const caller = resolveSafeStorageCaller(params.caller);
    if (!mainSafeStorage.isEncryptionAvailable(caller)) {
      if (process.platform === 'darwin') {
        await dialogHelper.showKeychainAccessDeniedDialog();
      }
      throw new Error('[sqlitePassword] safeStorage encryption is not available on this platform');
    }

    const buffer = mainSafeStorage.encryptString(params.password, caller);
    const encrypted = buffer.toString('base64');
    console.log('[sqlitePassword] password encrypted successfully');
    return encrypted;
  }

  async decryptPassword(params: {
    encrypted: string;
    caller?: 'core-sqlite' | 'todoist-sync';
  }): Promise<string> {
    const caller = resolveSafeStorageCaller(params.caller);
    if (!mainSafeStorage.isEncryptionAvailable(caller)) {
      if (process.platform === 'darwin') {
        await dialogHelper.showKeychainAccessDeniedDialog();
      }
      throw new Error('[sqlitePassword] safeStorage decryption is not available on this platform');
    }

    const buffer = Buffer.from(params.encrypted, 'base64');
    const decrypted = mainSafeStorage.decryptString(buffer, caller);
    console.log('[sqlitePassword] password decrypted successfully');
    return decrypted;
  }
}

export const sqlitePasswordHandler = new SqlitePasswordHandler();
