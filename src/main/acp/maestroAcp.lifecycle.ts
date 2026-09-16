/** Kept separate from Electron wiring to avoid a host/runtime/auth import cycle. */
const cancellations = new Set<() => Promise<void>>()

export const registerExternalTurn = (cancelAndDrain: () => Promise<void>): (() => void) => {
  cancellations.add(cancelAndDrain)
  return () => cancellations.delete(cancelAndDrain)
}

export const cancelExternalTurns = async (): Promise<void> => {
  await Promise.allSettled([...cancellations].map((cancel) => cancel()))
}
