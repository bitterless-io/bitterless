export type BestEffortOperation = () => Promise<unknown>;

export const scheduleBestEffort = (
  operation: BestEffortOperation,
  onRejected: (error: unknown) => void
): void => {
  void Promise.resolve().then(operation).catch(onRejected);
};

export const settleBestEffort = async (operations: BestEffortOperation[]): Promise<void> => {
  await Promise.allSettled(operations.map(async (operation) => await operation()));
};
