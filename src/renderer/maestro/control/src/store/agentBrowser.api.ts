import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
export const getAgentBrowserSession = (sessionId: string) => coach.getAgentBrowserSession({ sessionId })
export const showAgentBrowserTab = (sessionId: string, tabId: string) => coach.showAgentBrowserTab({ sessionId, tabId })
