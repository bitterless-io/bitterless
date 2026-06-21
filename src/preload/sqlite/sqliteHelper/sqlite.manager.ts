import { ipcRenderer } from 'electron';
import { join, dirname } from 'path';
import { rmSync, mkdirSync, existsSync } from 'fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { packageHelper } from '../../../shared/packageHelper/preload/packagePreload.helper';
import type { BaseTable } from '../dao/base.table';
import { sqlitePasswordHelper } from './sqlitePassword.helper';

type MigrationRunner = string | ((db: Database.Database) => void);

interface MigrationEntry {
  versionCode: number;
  runner: MigrationRunner;
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

  addMigration(versionCode: number, runner: MigrationRunner): void {
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

  private runMigrations(currentVersionCode: number, dbExistedBeforeOpen: boolean): void {
    const lastRow = this.db
      .prepare('SELECT MAX(version_code) as last FROM migration')
      .get() as { last: number | null };
    let lastVersionCode = lastRow?.last ?? null;

    const insertMigration = this.db.prepare('INSERT OR IGNORE INTO migration (version_code) VALUES (?)');

    if (lastVersionCode === null) {
      if (dbExistedBeforeOpen) {
        lastVersionCode = 0;
      } else {
        // New database: tables were just created with the latest schema, so old ALTER migrations are unnecessary.
        insertMigration.run(currentVersionCode);
        lastVersionCode = currentVersionCode;
      }
    }

    // Existing DB: run migrations with versionCode > lastVersionCode
    const pending = this.migrations
      .filter((m) => m.versionCode > lastVersionCode)
      .sort((a, b) => a.versionCode - b.versionCode);

    for (const m of pending) {
      console.log('[sqlite] running migration:', m.versionCode);
      try {
        if (typeof m.runner === 'string') {
          this.db.exec(m.runner);
        } else {
          m.runner(this.db);
        }
      } catch (err: any) {
        console.warn(`[sqlite] migration ${m.versionCode} failed (skipped):`, err.message);
      }
      insertMigration.run(m.versionCode);
    }

    if (pending.length > 0) {
      console.log(`[sqlite] executed ${pending.length} migration(s)`);
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
    const currentVersionCode: number = packageInfo.versionCode || 0;
    console.log('[sqlite] current versionCode:', currentVersionCode);

    this.runTables();
    this.runMigrations(currentVersionCode, dbExistedBeforeOpen);

    console.log('[sqlite] database initialized');
  }
}

export const sqliteManager = new SqliteManager();
