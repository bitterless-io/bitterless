export interface CoreSqliteReloadTarget {
  isDestroyed(): boolean;
  webContents: {
    isDestroyed(): boolean;
    reload(): void;
  };
}

export const reloadCoreSqliteRuntime = (
  target: CoreSqliteReloadTarget,
  isShutdownStarted: boolean,
): boolean => {
  if (isShutdownStarted || target.isDestroyed() || target.webContents.isDestroyed()) {
    return false;
  }
  target.webContents.reload();
  return true;
};
