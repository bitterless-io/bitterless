export const CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT =
  'core-sqlite/target-preload-registered';

export interface CoreSqliteTargetPreloadRegistration {
  targetId: string;
}

export const readCoreSqliteTargetPreloadRegistration = (
  value: unknown,
): CoreSqliteTargetPreloadRegistration | null => {
  if (!value || typeof value !== 'object') return null;
  const targetId = (value as { targetId?: unknown }).targetId;
  if (typeof targetId !== 'string' || !targetId.trim()) return null;
  return { targetId };
};
