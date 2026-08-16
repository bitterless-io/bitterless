export type SafeStorageIsolationMode = 'e2e' | 'debug' | null;
export type SafeStorageCaller =
  | 'core-sqlite'
  | 'todoist-sync'
  | 'sqlite-password'
  | 'maestro-sqlite'
  | 'trench-io';

export const resolveSafeStorageIsolationMode = (input: {
  e2e: boolean;
  viteMode: 'debug' | 'release';
}): SafeStorageIsolationMode => {
  if (input.e2e) return 'e2e';
  if (input.viteMode === 'debug') return 'debug';
  return null;
};

export const assertSafeStorageOperationAllowed = (input: {
  mode: SafeStorageIsolationMode;
  operation: 'availability' | 'encrypt' | 'decrypt';
  caller: SafeStorageCaller;
  packaged: boolean;
}): void => {
  if (!input.mode && input.packaged) return;
  const runtime = input.packaged ? 'packaged' : 'unpackaged';
  const mode = input.mode ?? 'release-unpackaged';
  throw new Error(
    `[safeStorage] tripwire blocked ${input.operation}; mode=${mode}; caller=${input.caller}; runtime=${runtime}`,
  );
};
