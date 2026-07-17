export interface CoreSqliteStartupResult {
  ok: boolean;
  error?: string;
}

export interface CoreGatedGuiStartupDependencies {
  initializeCorePrerequisites(): Promise<void> | void;
  waitForTargetPreloadRegistration(): Promise<void>;
  waitForCoreSqlite(): Promise<CoreSqliteStartupResult | null | undefined>;
  initializeLanguage(): Promise<void>;
  createHome(): Promise<void>;
  refreshMcpShim(): Promise<void>;
  initializeTray(): Promise<void> | void;
  startOptionalIntegrations(): Promise<void> | void;
  shouldStop(): boolean;
}

export const runCoreGatedGuiStartup = async (
  dependencies: CoreGatedGuiStartupDependencies,
): Promise<void> => {
  await dependencies.initializeCorePrerequisites();
  if (dependencies.shouldStop()) return;

  await dependencies.waitForTargetPreloadRegistration();
  if (dependencies.shouldStop()) return;

  const coreSqliteResult = await dependencies.waitForCoreSqlite();
  if (!coreSqliteResult?.ok) {
    throw new Error(
      coreSqliteResult?.error || 'Core SQLite preload did not report a successful result',
    );
  }
  if (dependencies.shouldStop()) return;

  await dependencies.initializeLanguage();
  if (dependencies.shouldStop()) return;

  await dependencies.createHome();
  if (dependencies.shouldStop()) return;

  await dependencies.refreshMcpShim();
  if (dependencies.shouldStop()) return;

  await dependencies.initializeTray();
  if (dependencies.shouldStop()) return;

  await dependencies.startOptionalIntegrations();
};
