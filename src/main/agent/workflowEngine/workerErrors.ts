import type { WireError } from './protocol'
/** Preserve typed error names across IPC without importing a retired engine's private classes. */
export function restoreWorkerError(error: WireError): Error {
  return Object.assign(new Error(error.message), { name: error.name, ...(error.details ? { details: error.details } : {}) })
}
