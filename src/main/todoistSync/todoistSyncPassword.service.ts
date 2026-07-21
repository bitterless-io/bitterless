import { randomBytes } from 'crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { safeStorage } from 'electron';
import type { TodoistSyncDatabasePaths } from './todoistSync.database';

export interface TodoistSyncPasswordProtection {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const assertPassword = (value: string): string => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('[todoist sync] protected database password is invalid');
  return value;
};

export const getOrCreateTodoistSyncRuntimePassword = (
  paths: TodoistSyncDatabasePaths,
  protection: TodoistSyncPasswordProtection = safeStorage,
): string => {
  if (!protection.isEncryptionAvailable()) {
    throw new Error('[todoist sync] Electron safeStorage is unavailable');
  }
  if (existsSync(paths.keyPath)) {
    if (process.platform !== 'win32') chmodSync(paths.keyPath, 0o600);
    return assertPassword(protection.decryptString(readFileSync(paths.keyPath)));
  }
  if (existsSync(paths.databasePath)) {
    throw new Error('[todoist sync] customer database exists but its protected password is missing');
  }
  const password = randomBytes(32).toString('hex');
  try {
    writeFileSync(paths.keyPath, protection.encryptString(password), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return assertPassword(protection.decryptString(readFileSync(paths.keyPath)));
  }
  return password;
};
