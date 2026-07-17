export const CORE_SQLITE_READ_PROBE_SQL =
  'SELECT COUNT(*) AS object_count FROM sqlite_master';

export interface CoreSqliteReadProbeDatabase {
  prepare(sql: string): {
    get(): unknown;
  };
}

export const probeCoreSqliteReadable = (
  db: CoreSqliteReadProbeDatabase,
): number => {
  const row = db.prepare(CORE_SQLITE_READ_PROBE_SQL).get() as {
    object_count?: unknown;
  } | undefined;
  const objectCount = row?.object_count;
  if (!Number.isInteger(objectCount) || Number(objectCount) < 0) {
    throw new Error(
      `[sqlite] read probe returned invalid object_count: ${String(objectCount)}`,
    );
  }
  return Number(objectCount);
};
