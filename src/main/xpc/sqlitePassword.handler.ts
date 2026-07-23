import { XpcMainHandler } from 'electron-xpc/main';
import { safeStorage } from 'electron';
import { dialogHelper } from '../dialog/dialog.helper';
import type { TodoistSyncPasswordCapabilityApi } from '@shared/todoistSync/todoistSyncCapability.type';

class SqlitePasswordHandler extends XpcMainHandler implements TodoistSyncPasswordCapabilityApi {
  async encryptPassword(params: { password: string }): Promise<string> {
    if (!safeStorage.isEncryptionAvailable()) {
      if (process.platform === 'darwin') {
        await dialogHelper.showKeychainAccessDeniedDialog();
      }
      throw new Error('[sqlitePassword] safeStorage encryption is not available on this platform');
    }

    const buffer = safeStorage.encryptString(params.password);
    const encrypted = buffer.toString('base64');
    console.log('[sqlitePassword] password encrypted successfully');
    return encrypted;
  }

  async decryptPassword(params: { encrypted: string }): Promise<string> {
    if (!safeStorage.isEncryptionAvailable()) {
      if (process.platform === 'darwin') {
        await dialogHelper.showKeychainAccessDeniedDialog();
      }
      throw new Error('[sqlitePassword] safeStorage decryption is not available on this platform');
    }

    const buffer = Buffer.from(params.encrypted, 'base64');
    const decrypted = safeStorage.decryptString(buffer);
    console.log('[sqlitePassword] password decrypted successfully');
    return decrypted;
  }
}

export const sqlitePasswordHandler = new SqlitePasswordHandler();
