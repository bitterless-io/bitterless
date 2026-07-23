import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import { v4 as uuidv4 } from 'uuid';
import {
  createBoundedTodoXpcClient,
  TodoXpcTimeoutError,
} from '@shared/todoistSync/todoXpcCall.shared';

const STORAGE_KEY = 'sqk';
const DEV_PASSWORD = '123456';

interface SqlitePasswordHandlerType {
  encryptPassword(params: { password: string }): Promise<string>;
  decryptPassword(params: { encrypted: string }): Promise<string>;
}

export interface SqlitePasswordResult {
  password: string;
  isReset: boolean;
}

class SqlitePasswordHelper {
  private passwordEmitter = createBoundedTodoXpcClient(
    createXpcPreloadEmitter<SqlitePasswordHandlerType>('SqlitePasswordHandler'),
    'SqlitePasswordHandler',
  );

  async getOrCreatePassword(): Promise<SqlitePasswordResult> {
    const viteMode = import.meta.env.VITE_MODE;

    if (viteMode === 'debug') {
      console.log('[sqlitePassword] using hardcoded password for debug mode');
      return { password: DEV_PASSWORD, isReset: false };
    }

    console.log('[sqlitePassword] release mode detected, using encrypted password');
    
    let isReset = false;
    const encryptedPassword = localStorage.getItem(STORAGE_KEY);
    
    if (encryptedPassword) {
      console.log('[sqlitePassword] found existing encrypted password, decrypting...');
      try {
        const password = await this.passwordEmitter.decryptPassword({ encrypted: encryptedPassword });
        console.log('[sqlitePassword] password decrypted successfully');
        return { password, isReset: false };
      } catch (err: any) {
        if (err instanceof TodoXpcTimeoutError) throw err;
        console.error('[sqlitePassword] failed to decrypt password, clearing invalid ciphertext:', err.message);
        localStorage.removeItem(STORAGE_KEY);
        isReset = true;
      }
    }

    console.log('[sqlitePassword] generating new UUID password...');
    const newPassword = uuidv4();
    
    try {
      const encrypted = await this.passwordEmitter.encryptPassword({ password: newPassword });
      localStorage.setItem(STORAGE_KEY, encrypted);
      console.log('[sqlitePassword] new password generated, encrypted, and stored');
      return { password: newPassword, isReset };
    } catch (err: any) {
      console.error('[sqlitePassword] failed to encrypt password:', err.message);
      throw new Error('Failed to encrypt SQLite password. Please contact support.');
    }
  }
}

export const sqlitePasswordHelper = new SqlitePasswordHelper();
