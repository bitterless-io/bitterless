import { randomBytes } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { safeStorage } from 'electron';
import type { TodoistSyncDatabasePaths } from './todoistSync.database';

export interface TodoistSyncPasswordProtection {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface TodoistSyncRuntimePasswordOptions {
  protection?: TodoistSyncPasswordProtection;
  generatePassword?: () => string;
}

const assertPassword = (value: string): string => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('[todoist sync] protected database password is invalid');
  return value;
};

export const getOrCreateTodoistSyncRuntimePassword = (
  paths: TodoistSyncDatabasePaths,
  options: TodoistSyncRuntimePasswordOptions = {},
): string => {
  const protection = options.protection ?? safeStorage;
  const generatePassword = options.generatePassword ?? (() => randomBytes(32).toString('hex'));
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(paths.directory, 0o700);
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
  const password = assertPassword(generatePassword());
  try {
    writeFileSync(paths.keyPath, protection.encryptString(password), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return assertPassword(protection.decryptString(readFileSync(paths.keyPath)));
  }
  return password;
};
