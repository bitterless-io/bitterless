// Runtime owner: the hidden Core SQLite preload process.
import { randomBytes } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import type { TodoistSyncDatabasePaths } from './todoistSync.database';

export interface TodoistSyncPasswordProtection {
  encryptString(value: string): Buffer | Promise<Buffer>;
  decryptString(value: Buffer): string | Promise<string>;
}

export interface TodoistSyncRuntimePasswordOptions {
  protection: TodoistSyncPasswordProtection;
  generatePassword?: () => string;
}

const assertPassword = (value: string): string => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('[todoist sync] protected database password is invalid');
  return value;
};

export const getOrCreateTodoistSyncRuntimePassword = (
  paths: TodoistSyncDatabasePaths,
  options: TodoistSyncRuntimePasswordOptions,
): Promise<string> => {
  return getOrCreateTodoistSyncRuntimePasswordAsync(paths, options);
};

const getOrCreateTodoistSyncRuntimePasswordAsync = async (
  paths: TodoistSyncDatabasePaths,
  options: TodoistSyncRuntimePasswordOptions,
): Promise<string> => {
  const protection = options.protection;
  const generatePassword = options.generatePassword ?? (() => randomBytes(32).toString('hex'));
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(paths.directory, 0o700);
  if (existsSync(paths.keyPath)) {
    if (process.platform !== 'win32') chmodSync(paths.keyPath, 0o600);
    return assertPassword(await protection.decryptString(readFileSync(paths.keyPath)));
  }
  if (existsSync(paths.databasePath)) {
    throw new Error('[todoist sync] customer database exists but its protected password is missing');
  }
  const password = assertPassword(generatePassword());
  try {
    writeFileSync(paths.keyPath, await protection.encryptString(password), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return assertPassword(await protection.decryptString(readFileSync(paths.keyPath)));
  }
  return password;
};
