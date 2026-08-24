import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { AuthSessionApi } from '@shared/auth/auth.type'
import {
  parseHomeShellCommandAck,
  parseHomeShellSessionSummary,
  type HomeShellBridgeApi,
  type HomeShellSessionSummary,
} from '@shared/home/homeShellBridge.contract'

const homeShellEmitter =
  createXpcRendererEmitter<HomeShellBridgeApi>('HomeShellBridgeHandler')
const authSessionEmitter = createXpcRendererEmitter<AuthSessionApi>('AuthHandler')

const HOME_SHELL_CALL_TIMEOUT_MS = 8_000

const withHomeShellTimeout = async <T>(operation: Promise<T>, label: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out while waiting for the Home shell`)),
      HOME_SHELL_CALL_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

export const homeShellBridge = {
  async getSessionSummary(): Promise<HomeShellSessionSummary> {
    const value = await withHomeShellTimeout(
      homeShellEmitter.getSessionSummary(),
      'Session summary',
    )
    return parseHomeShellSessionSummary(value)
  },

  async openTodo(): Promise<void> {
    const value = await withHomeShellTimeout(homeShellEmitter.openTodo(), 'Open Todo')
    parseHomeShellCommandAck(value)
  },

  async logout(): Promise<void> {
    const value = await withHomeShellTimeout(
      homeShellEmitter.prepareLogout(),
      'Prepare logout',
    )
    parseHomeShellCommandAck(value)

    // Deactivation destroys the calling Workbench renderer. Dispatch only after Home has
    // acknowledged local-session cleanup, and intentionally do not await the return path.
    void authSessionEmitter.deactivateSession().catch((err) => {
      console.warn('[HomeShellBridge] Failed to request session deactivation:', err)
    })
  },
}
