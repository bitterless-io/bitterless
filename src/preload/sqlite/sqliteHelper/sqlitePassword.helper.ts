import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'sqk';
const DEV_PASSWORD = '123456';

interface SqlitePasswordHandlerType {
  encryptPassword(params: { password: string }): Promise<string>;
  decryptPassword(params: { encrypted: string }): Promise<string>;
}

class SqlitePasswordHelper {
  private passwordEmitter = createXpcPreloadEmitter<SqlitePasswordHandlerType>('SqlitePasswordHandler');

  async getOrCreatePassword(): Promise<string> {
    const viteEnv = import.meta.env.VITE_ENV;
    
    if (viteEnv === 'dev') {
      console.log('[sqlitePassword] using hardcoded password for dev environment');
      return DEV_PASSWORD;
    }

    console.log('[sqlitePassword] production environment detected, using encrypted password');
    
    const encryptedPassword = localStorage.getItem(STORAGE_KEY);
    
    if (encryptedPassword) {
      console.log('[sqlitePassword] found existing encrypted password, decrypting...');
      try {
        const password = await this.passwordEmitter.decryptPassword({ encrypted: encryptedPassword });
        console.log('[sqlitePassword] password decrypted successfully');
        return password;
      } catch (err: any) {
        console.error('[sqlitePassword] failed to decrypt password:', err.message);
        throw new Error('Failed to decrypt SQLite password. Please contact support.');
      }
    }

    console.log('[sqlitePassword] no existing password found, generating new UUID password...');
    const newPassword = uuidv4();
    
    try {
      const encrypted = await this.passwordEmitter.encryptPassword({ password: newPassword });
      localStorage.setItem(STORAGE_KEY, encrypted);
      console.log('[sqlitePassword] new password generated, encrypted, and stored');
      return newPassword;
    } catch (err: any) {
      console.error('[sqlitePassword] failed to encrypt password:', err.message);
      throw new Error('Failed to encrypt SQLite password. Please contact support.');
    }
  }
}

export const sqlitePasswordHelper = new SqlitePasswordHelper();
