import Database from 'better-sqlite3-multiple-ciphers';
import { chmodSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';
import {
  applyTrenchIoMigrations,
  type TrenchIoMigrationDatabase,
} from './trenchIo.migration';

export interface TrenchIoPaths {
  directory: string;
  databasePath: string;
  keyPath: string;
}

export const resolveTrenchIoPaths = (userDataPath: string): TrenchIoPaths => {
  const directory = join(userDataPath, 'trench');
  return {
    directory,
    databasePath: join(directory, 'trench.db'),
    keyPath: join(directory, 'trench.key.bin'),
  };
};

const quoteSqliteText = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export class TrenchIoDatabase {
  readonly raw: Database.Database;
  private closed = false;

  constructor(path: string, password: string, currentVersionCode: string) {
    if (basename(normalize(path)).toLowerCase() !== 'trench.db') {
      throw new Error('[trench-io] database filename must be trench.db');
    }
    if (!/^[0-9a-f]{64}$/.test(password)) {
      throw new Error('[trench-io] database password is invalid');
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
      applyTrenchIoMigrations(
        this.raw as unknown as TrenchIoMigrationDatabase,
        currentVersionCode,
      );
      this.assertHealthy();
    } catch (error) {
      this.raw.close();
      throw error;
    }
  }

  transaction<T>(runner: () => T): T {
    this.assertOpen();
    return this.raw.transaction(runner).immediate();
  }

  readTransaction<T>(runner: () => T): T {
    this.assertOpen();
    return this.raw.transaction(runner).deferred();
  }

  assertHealthy(): void {
    const integrity = this.raw.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`[trench-io] integrity check failed: ${String(integrity)}`);
    const foreignKeys = this.raw.pragma('foreign_key_check');
    if (Array.isArray(foreignKeys) && foreignKeys.length > 0) {
      throw new Error('[trench-io] foreign key check failed');
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.raw.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('[trench-io] database is closed');
  }
}
