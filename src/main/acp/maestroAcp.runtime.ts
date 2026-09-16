import { app } from 'electron'
import { createXpcMainEmitter } from 'electron-xpc/main'
import { maestroWindowHandler } from '../xpc/maestroWindow.handler'
import { maestroWindowHelper } from '../maestro/windows/main/maestroWindow.controller'
import { getRuntimeProfile } from '../environment/runtimeProfile.runtime'
import type { MaestroChatApi } from '../../shared/maestro/maestroChat.api'
import { MaestroAcpHost } from './maestroAcp.host'
import { createAcpEndpoint } from './core/acpEndpoint'
import { startAcpServer } from './core/acpServer'

const store = createXpcMainEmitter<MaestroChatApi>('MaestroChatDao')
export const maestroAcpHost = new MaestroAcpHost(store, {
  prepare: async () => await maestroWindowHandler.ensureExternalRuntimeReady(),
  assertAccess: () => maestroWindowHandler.assertExternalAccess(),
  checkTarget: async () => await maestroWindowHelper.agentService.ensureAgents().pi.checkTarget(),
  prompt: async (params) => await maestroWindowHelper.sendAgentMessage(params),
  abort: async (sessionId) => await maestroWindowHelper.abortAgent({ sessionId }),
  release: async (sessionId) => await maestroWindowHelper.agentService.releaseExternalSession(sessionId)
})

let server: Awaited<ReturnType<typeof startAcpServer>> | undefined

export const startMaestroAcpServer = async (): Promise<void> => {
  if (server) return
  const endpoint = createAcpEndpoint({
    appId: 'bitterless',
    userData: app.getPath('userData'),
    environment: getRuntimeProfile().id,
    socketPath: process.env.BITTERLESS_ACP_SOCKET,
    descriptorPath: process.env.BITTERLESS_ACP_DESCRIPTOR
  })
  server = await startAcpServer({ host: maestroAcpHost, endpoint })
}

export const stopMaestroAcpServer = async (): Promise<void> => {
  const current = server
  server = undefined
  await current?.close()
}
