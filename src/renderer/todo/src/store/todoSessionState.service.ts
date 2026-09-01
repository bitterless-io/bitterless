export type TodoUnavailableReason = 'sessionRequired' | 'runtimeUnavailable';

export interface TodoSessionProbe {
  getStatus(): Promise<{ active: boolean }>;
}

// The Todo board fails identically whether local SQLite is broken or this installation has no
// signed-in customer. A separate install — Preview, Development, a new machine — owns its own
// userData and therefore its own session, so the second case is normal and needs a sign-in
// instruction rather than a storage error.
export const resolveTodoUnavailableReason = async (
  probe: TodoSessionProbe,
): Promise<TodoUnavailableReason> => {
  try {
    const status = await probe.getStatus();
    if (!status.active) return 'sessionRequired';
  } catch (error) {
    console.warn('[todo] session status probe failed:', error);
  }
  return 'runtimeUnavailable';
};
