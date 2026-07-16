import { compareVersions } from 'compare-versions';
import type Database from 'better-sqlite3-multiple-ciphers';

export type SqliteMigrationRunner = string | ((db: Database.Database) => void);

export interface SqliteMigration {
  versionCode: string;
  runner: SqliteMigrationRunner;
}

export interface RunSqliteMigrationsParams {
  db: Database.Database;
  migrations: readonly SqliteMigration[];
  currentVersionCode: string;
  dbExistedBeforeOpen: boolean;
  logPrefix: string;
}

export interface RunSqliteMigrationsResult {
  appliedVersionCodes: string[];
  stampedVersionCode: string | null;
}

interface MigrationLedgerRow {
  version_code: string | number;
}

const CURRENT_VERSION_CODE_PATTERN = /^\d{12}$/;
const LEDGER_VERSION_CODE_PATTERN = /^\d+$/;

export const isTimestampVersionCode = (versionCode: string): boolean => {
  if (!CURRENT_VERSION_CODE_PATTERN.test(versionCode)) return false;
  const year = 2000 + Number(versionCode.slice(0, 2));
  const month = Number(versionCode.slice(2, 4));
  const day = Number(versionCode.slice(4, 6));
  const hour = Number(versionCode.slice(6, 8));
  const minute = Number(versionCode.slice(8, 10));
  const second = Number(versionCode.slice(10, 12));
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
};

export class SqliteMigrationError extends Error {
  readonly versionCode: string;
  readonly originalError: unknown;

  constructor(versionCode: string, originalError: unknown) {
    const detail = originalError instanceof Error ? originalError.message : String(originalError);
    super(`SQLite migration ${versionCode} failed: ${detail}`);
    this.name = 'SqliteMigrationError';
    this.versionCode = versionCode;
    this.originalError = originalError;
  }
}

const assertCurrentVersionCode = (versionCode: string): void => {
  if (!isTimestampVersionCode(versionCode)) {
    throw new Error(
      `Current version_code must be a 12-digit YYMMDDHHmmss string, received: ${versionCode}`,
    );
  }
};

const normalizeLedgerVersionCode = (value: string | number): string => {
  const versionCode = String(value);
  if (!LEDGER_VERSION_CODE_PATTERN.test(versionCode)) {
    throw new Error(`SQLite migration ledger contains an invalid version_code: ${versionCode}`);
  }
  return versionCode;
};

export const assertSqliteMigrationManifest = (
  migrations: readonly SqliteMigration[],
  currentVersionCode: string,
): void => {
  assertCurrentVersionCode(currentVersionCode);

  let previousVersionCode: string | null = null;
  for (const migration of migrations) {
    if (!isTimestampVersionCode(migration.versionCode)) {
      throw new Error(
        `Migration version_code must be a 12-digit YYMMDDHHmmss string, received: ${migration.versionCode}`,
      );
    }
    if (
      previousVersionCode !== null &&
      compareVersions(migration.versionCode, previousVersionCode) <= 0
    ) {
      throw new Error(
        `Migration version_code values must be unique and strictly increasing: ${previousVersionCode}, ${migration.versionCode}`,
      );
    }
    previousVersionCode = migration.versionCode;
  }

  if (
    previousVersionCode !== null &&
    compareVersions(currentVersionCode, previousVersionCode) < 0
  ) {
    throw new Error(
      `Current version_code ${currentVersionCode} is older than migration ${previousVersionCode}`,
    );
  }
};

export const getLatestAppliedVersionCode = (db: Database.Database): string | null => {
  const rows = db.prepare('SELECT version_code FROM migration').all() as MigrationLedgerRow[];
  let latestVersionCode: string | null = null;
  for (const row of rows) {
    const versionCode = normalizeLedgerVersionCode(row.version_code);
    if (
      latestVersionCode === null ||
      compareVersions(versionCode, latestVersionCode) > 0
    ) {
      latestVersionCode = versionCode;
    }
  }
  return latestVersionCode;
};

export const runSqliteMigrations = (
  params: RunSqliteMigrationsParams,
): RunSqliteMigrationsResult => {
  const {
    db,
    migrations,
    currentVersionCode,
    dbExistedBeforeOpen,
    logPrefix,
  } = params;
  assertSqliteMigrationManifest(migrations, currentVersionCode);

  const insertMigration = db.prepare(
    'INSERT INTO migration (version_code) VALUES (?)',
  );
  let latestVersionCode = getLatestAppliedVersionCode(db);

  if (latestVersionCode === null && !dbExistedBeforeOpen) {
    db.transaction(() => {
      insertMigration.run(Number(currentVersionCode));
    })();
    return {
      appliedVersionCodes: [],
      stampedVersionCode: currentVersionCode,
    };
  }

  if (latestVersionCode === null) latestVersionCode = '0';

  const pending = migrations.filter(
    (migration) => compareVersions(migration.versionCode, latestVersionCode) > 0,
  );
  const appliedVersionCodes: string[] = [];

  for (const migration of pending) {
    console.log(`${logPrefix} running migration:`, migration.versionCode);
    try {
      db.transaction(() => {
        if (typeof migration.runner === 'string') {
          db.exec(migration.runner);
        } else {
          migration.runner(db);
        }
        insertMigration.run(Number(migration.versionCode));
      })();
    } catch (error) {
      throw new SqliteMigrationError(migration.versionCode, error);
    }
    appliedVersionCodes.push(migration.versionCode);
  }

  if (appliedVersionCodes.length > 0) {
    console.log(`${logPrefix} executed ${appliedVersionCodes.length} migration(s)`);
  }

  return {
    appliedVersionCodes,
    stampedVersionCode: null,
  };
};
