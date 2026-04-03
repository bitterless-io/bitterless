import { ipcRenderer } from 'electron';
import { join } from 'path';
import Database from 'better-sqlite3-multiple-ciphers';
import { packageHelper } from '../../../shared/packageHelper/preload/packagePreload.helper';
import type { BaseTable } from '../dao/base.table';
import { sqlitePasswordHelper } from './sqlitePassword.helper';

interface MigrationEntry {
  versionCode: number;
  sql: string;
}

class SqliteManager {
  private _db: Database.Database | null = null;
  private tables: BaseTable[] = [];
  private migrations: MigrationEntry[] = [];

  get db(): Database.Database {
    if (!this._db) {
      throw new Error('[sqlite] database not initialized, call init() first');
    }
    return this._db;
  }

  addTable(table: BaseTable): void {
    this.tables.push(table);
  }

  addMigration(versionCode: number, sql: string): void {
    this.migrations.push({ versionCode, sql });
  }

  private runTables(): void {
    for (const table of this.tables) {
      this.db.exec(table.createSql);
    }
    if (this.tables.length > 0) {
      console.log(`[sqlite] created/verified ${this.tables.length} table(s)`);
    }
  }

  private runMigrations(currentVersionCode: number): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_code INTEGER NOT NULL UNIQUE,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const executed = this.db
      .prepare('SELECT version_code FROM migration')
      .all()
      .map((row: any) => row.version_code as number);

    const pending = this.migrations
      .filter((m) => m.versionCode <= currentVersionCode && !executed.includes(m.versionCode))
      .sort((a, b) => a.versionCode - b.versionCode);

    const insertMigration = this.db.prepare('INSERT INTO migration (version_code) VALUES (?)');

    for (const m of pending) {
      console.log('[sqlite] running migration:', m.versionCode);
      this.db.exec(m.sql);
      insertMigration.run(m.versionCode);
    }

    if (pending.length > 0) {
      console.log(`[sqlite] executed ${pending.length} migration(s)`);
    }
  }

  async init(): Promise<void> {
    const bitterlessPath = await ipcRenderer.invoke('bitterless:get-userdata-path');
    const dbPath = join(bitterlessPath, 'db', 'main.db');

    console.log('[sqlite] opening database:', dbPath);

    const password = await sqlitePasswordHelper.getOrCreatePassword();

    this._db = new Database(dbPath);

    this._db.pragma(`key='${password}'`);
    this._db.pragma('cipher_page_size=8192');
    this._db.pragma('journal_mode=WAL');
    this._db.pragma('mmap_size=268435456');
    this._db.pragma('cache_size=2080');
    this._db.pragma('synchronous=normal');
    this._db.pragma('optimize(0x10002)');

    const packageInfo = await packageHelper.getPackageInfo();
    const currentVersionCode: number = packageInfo.versionCode || 0;
    console.log('[sqlite] current versionCode:', currentVersionCode);

    this.runTables();
    this.runMigrations(currentVersionCode);

    console.log('[sqlite] database initialized');
  }
}

export const sqliteManager = new SqliteManager();
