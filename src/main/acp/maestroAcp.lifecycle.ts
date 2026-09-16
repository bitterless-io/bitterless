/** Kept separate from Electron wiring to avoid a host/runtime/auth import cycle. */
let accessGeneration = 0

export const externalAccessGeneration = (): number => accessGeneration

const cancellations = new Set<() => Promise<void>>()

export const registerExternalTurn = (cancelAndDrain: () => Promise<void>): (() => void) => {
  cancellations.add(cancelAndDrain)
  return () => cancellations.delete(cancelAndDrain)
}

export const cancelExternalTurns = async (): Promise<void> => {
  accessGeneration += 1
  await Promise.allSettled([...cancellations].map((cancel) => cancel()))
}
