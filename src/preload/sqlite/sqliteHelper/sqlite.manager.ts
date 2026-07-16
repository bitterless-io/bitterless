import { ipcRenderer } from 'electron';
import { join, dirname } from 'path';
import { rmSync, mkdirSync, existsSync } from 'fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { packageHelper } from '../../../shared/packageHelper/preload/packagePreload.helper';
import {
  runSqliteMigrations,
  type SqliteMigration,
  type SqliteMigrationRunner,
} from '../../common/sqliteMigration.service';
import type { BaseTable } from '../dao/base.table';
import { finalizeCoreSqliteSchema } from '../coreSqlite.release';
import { sqlitePasswordHelper } from './sqlitePassword.helper';

class SqliteManager {
  private _db: Database.Database | null = null;
  private tables: BaseTable[] = [];
  private migrations: SqliteMigration[] = [];

  get db(): Database.Database {
    if (!this._db) {
      throw new Error('[sqlite] database not initialized, call init() first');
    }
    return this._db;
  }

  addTable(table: BaseTable): void {
    this.tables.push(table);
  }

  addMigration(versionCode: string, runner: SqliteMigrationRunner): void {
    this.migrations.push({ versionCode, runner });
  }

  private runTables(): void {
    for (const table of this.tables) {
      this.db.exec(table.createSql);
    }
    if (this.tables.length > 0) {
      console.log(`[sqlite] created/verified ${this.tables.length} table(s)`);
    }
  }

  async init(): Promise<void> {
    const bitterlessPath = await ipcRenderer.invoke('bitterless:get-userdata-path');
    const dbPath = join(bitterlessPath, 'db', 'main.db');
    let dbExistedBeforeOpen = existsSync(dbPath);

    console.log('[sqlite] opening database:', dbPath);

    const { password, isReset } = await sqlitePasswordHelper.getOrCreatePassword();

    if (isReset) {
      const dbDir = dirname(dbPath);
      console.log('[sqlite] password was reset, removing old db directory:', dbDir);
      rmSync(dbDir, { recursive: true, force: true });
      mkdirSync(dbDir, { recursive: true });
      dbExistedBeforeOpen = false;
      console.log('[sqlite] db directory recreated');
    }

    this._db = new Database(dbPath);

    this._db.pragma(`key='${password}'`);
    this._db.pragma('cipher_page_size=8192');
    this._db.pragma('journal_mode=WAL');
    this._db.pragma('mmap_size=268435456');
    this._db.pragma('cache_size=2080');
    this._db.pragma('synchronous=normal');
    this._db.pragma('optimize(0x10002)');

    const packageInfo = await packageHelper.getPackageInfo();
    const currentVersionCode = packageInfo.versionCode;
    console.log('[sqlite] current versionCode:', currentVersionCode);

    this.runTables();
    runSqliteMigrations({
      db: this.db,
      migrations: this.migrations,
      currentVersionCode,
      dbExistedBeforeOpen,
      logPrefix: '[sqlite]',
    });
    finalizeCoreSqliteSchema(this.db);

    console.log('[sqlite] database initialized');
  }
}

export const sqliteManager = new SqliteManager();
