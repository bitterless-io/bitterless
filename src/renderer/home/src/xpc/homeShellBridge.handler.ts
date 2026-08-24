import { XpcRendererHandler } from 'electron-xpc/renderer'
import type {
  HomeShellBridgeApi,
  HomeShellCommandAck,
  HomeShellSessionSummary,
} from '@shared/home/homeShellBridge.contract'
import router from '@/router'
import { todoWindowEmitter } from '@/emitter/todoWindow.emitter'
import { authStore } from '@/stores/auth/auth.store'

class HomeShellBridgeHandler extends XpcRendererHandler implements HomeShellBridgeApi {
  async getSessionSummary(): Promise<HomeShellSessionSummary> {
    return { email: authStore.current?.email || '' }
  }

  async openTodo(): Promise<HomeShellCommandAck> {
    await authStore.ensureTodoistSyncReady()
    await todoWindowEmitter.openTodoWindow()
    return { ok: true }
  }

  async prepareLogout(): Promise<HomeShellCommandAck> {
    const cleanup = authStore.prepareExternalLogout()
    await router.replace({ name: 'login' }).catch(() => undefined)
    void cleanup().catch((err) => {
      console.error('[HomeShellBridge] Deferred logout cleanup failed:', err)
    })
    return { ok: true }
  }
}

let handler: HomeShellBridgeHandler | null = null

export const initHomeShellBridge = (): void => {
  handler ??= new HomeShellBridgeHandler()
}
