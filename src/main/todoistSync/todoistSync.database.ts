import Database from 'better-sqlite3-multiple-ciphers';
import { chmodSync, mkdirSync } from 'fs';
import { basename, dirname, join, normalize } from 'path';
import { applyTodoistSyncMigrations } from './todoistSync.migration';

export interface TodoistSyncDatabasePaths {
  directory: string;
  databasePath: string;
  keyPath: string;
}

export interface TodoistSyncExecuteResult {
  rows?: { _array: unknown[] };
  changes?: number;
}

export interface TodoistSyncSqlExecutor {
  execute(sql: string, values?: unknown[]): Promise<TodoistSyncExecuteResult>;
  getAll<T>(sql: string, values?: unknown[]): Promise<T[]>;
  getOptional<T>(sql: string, values?: unknown[]): Promise<T | undefined>;
  get<T>(sql: string, values?: unknown[]): Promise<T>;
}

export interface TodoistSyncRepositoryDatabase extends TodoistSyncSqlExecutor {
  writeTransaction<T>(
    runner: (tx: TodoistSyncSqlExecutor) => Promise<T>,
    beforeCommit?: () => void,
  ): Promise<T>;
}

const normalizeCustomerId = (customerId: string | number): string => {
  const value = String(customerId);
  if (!/^[1-9]\d*$/.test(value) || value.length > 20) {
    throw new Error('[todoist sync] customerId must be a positive decimal identifier');
  }
  return value;
};

export const resolveTodoistSyncDatabasePaths = (
  userDataPath: string,
  customerId: string | number,
): TodoistSyncDatabasePaths => {
  const normalizedCustomerId = normalizeCustomerId(customerId);
  const directory = join(userDataPath, 'db', 'todoist-sync-v1');
  return {
    directory,
    databasePath: join(directory, `customer-${normalizedCustomerId}.db`),
    keyPath: join(directory, `customer-${normalizedCustomerId}.key.bin`),
  };
};

export const assertTodoistSyncDatabaseIsolation = (
  paths: TodoistSyncDatabasePaths,
  userDataPath: string,
): void => {
  const legacyPath = normalize(join(userDataPath, 'db', 'main.db'));
  const candidate = normalize(paths.databasePath);
  if (candidate === legacyPath || dirname(candidate) === dirname(legacyPath)) {
    throw new Error('[todoist sync] customer database must be isolated from legacy main.db');
  }
};

const quoteSqliteText = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export class TodoistSyncDatabase implements TodoistSyncRepositoryDatabase {
  readonly raw: Database.Database;
  private transactionDepth = 0;
  private closed = false;

  constructor(path: string, password: string) {
    if (basename(normalize(path)).toLowerCase() === 'main.db') {
      throw new Error('[todoist sync] refusing to open legacy main.db');
    }
    if (typeof password !== 'string' || password.length < 16 || password.length > 256) {
      throw new Error('[todoist sync] injected database password is invalid');
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(dirname(path), 0o700);
    this.raw = new Database(path);
    try {
      this.raw.pragma("cipher = 'sqlcipher'");
      this.raw.pragma('legacy = 4');
      this.raw.pragma(`key = ${quoteSqliteText(password)}`);
      this.raw.pragma('cipher_page_size = 8192');
      this.raw.pragma('foreign_keys = ON');
      this.raw.pragma('journal_mode = WAL');
      this.raw.pragma('busy_timeout = 5000');
      applyTodoistSyncMigrations(this.raw);
      this.assertHealthy();
    } catch (error) {
      this.raw.close();
      throw error;
    }
  }

  async execute(sql: string, values: unknown[] = []): Promise<TodoistSyncExecuteResult> {
    this.assertOpen();
    const statement = this.raw.prepare(sql);
    if (/\bRETURNING\b/i.test(sql) || /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) {
      return { rows: { _array: statement.all(...values) } };
    }
    const result = statement.run(...values);
    return { changes: result.changes };
  }

  async getAll<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    this.assertOpen();
    return this.raw.prepare(sql).all(...values) as T[];
  }

  async getOptional<T>(sql: string, values: unknown[] = []): Promise<T | undefined> {
    this.assertOpen();
    return this.raw.prepare(sql).get(...values) as T | undefined;
  }

  async get<T>(sql: string, values: unknown[] = []): Promise<T> {
    const result = await this.getOptional<T>(sql, values);
    if (result === undefined) throw new Error('[todoist sync] query returned no row');
    return result;
  }

  async writeTransaction<T>(
    runner: (tx: TodoistSyncSqlExecutor) => Promise<T>,
    beforeCommit?: () => void,
  ): Promise<T> {
    this.assertOpen();
    const depth = this.transactionDepth;
    const savepoint = `todoist_sync_${depth}`;
    this.transactionDepth += 1;
    this.raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
    try {
      const result = await runner(this);
      beforeCommit?.();
      this.raw.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      if (depth === 0) {
        this.raw.exec('ROLLBACK');
      } else {
        this.raw.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  assertHealthy(): void {
    const integrity = this.raw.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`[todoist sync] SQLite integrity check failed: ${String(integrity)}`);
    const foreignKeyErrors = this.raw.pragma('foreign_key_check');
    if (Array.isArray(foreignKeyErrors) && foreignKeyErrors.length > 0) {
      throw new Error('[todoist sync] SQLite foreign key check failed');
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.raw.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('[todoist sync] database is closed');
  }
}
