export interface CoreSqliteStartupResult {
  ok: boolean;
  error?: string;
}

export interface SqliteFirstGuiStartupDependencies {
  initializeCorePrerequisites(): Promise<void> | void;
  startCoreSqlite(): Promise<CoreSqliteStartupResult | null | undefined>;
  initializeLanguageFallback(): void;
  initializeForegroundRuntime(): Promise<void> | void;
  createHome(): Promise<void> | void;
  refreshMcpShim(): Promise<void> | void;
  initializeTray(): Promise<void> | void;
  handleCoreSqliteReady(): Promise<void> | void;
  handleCoreSqliteFailure(error: unknown): Promise<void> | void;
  shouldStop(): boolean;
}

const requireCoreSqliteSuccess = (
  result: CoreSqliteStartupResult | null | undefined,
): CoreSqliteStartupResult => {
  if (!result?.ok) {
    throw new Error(
      result?.error || 'Core SQLite preload did not report a successful result',
    );
  }
  return result;
};

export const runSqliteFirstGuiStartup = async (
  dependencies: SqliteFirstGuiStartupDependencies,
): Promise<void> => {
  await dependencies.initializeCorePrerequisites();
  if (dependencies.shouldStop()) return;

  let coreSqliteResult: Promise<CoreSqliteStartupResult | null | undefined>;
  try {
    coreSqliteResult = dependencies.startCoreSqlite();
  } catch (error) {
    coreSqliteResult = Promise.reject(error);
  }

  let resolveHomeCreated: (() => void) | null = null;
  const homeCreated = new Promise<void>((resolve) => {
    resolveHomeCreated = resolve;
  });

  // The fallback is deliberately synchronous and follows the SQLite renderer launch in the same
  // turn. The Core result is observed immediately, but it is never awaited by the foreground lane.
  dependencies.initializeLanguageFallback();
  void coreSqliteResult
    .then(requireCoreSqliteSuccess)
    .then(async () => {
      await homeCreated;
      if (dependencies.shouldStop()) return;
      await dependencies.handleCoreSqliteReady();
    })
    .catch(async (error: unknown) => {
      if (dependencies.shouldStop()) return;
      await dependencies.handleCoreSqliteFailure(error);
    });

  await dependencies.initializeForegroundRuntime();
  if (dependencies.shouldStop()) return;

  await dependencies.createHome();
  resolveHomeCreated?.();
  if (dependencies.shouldStop()) return;

  await dependencies.refreshMcpShim();
  if (dependencies.shouldStop()) return;

  await dependencies.initializeTray();
};
