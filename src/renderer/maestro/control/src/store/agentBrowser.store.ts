import { reactive } from 'vue'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import type { AgentBrowserSessionState } from '@maestro-shared/coach.api'
import { getAgentBrowserSession, showAgentBrowserTab } from './agentBrowser.api'

export class AgentBrowserStore {
  sessionId = ''
  state: AgentBrowserSessionState | null = null
  loading = false
  error = ''
  private revision = 0

  async select(sessionId: string): Promise<void> {
    this.sessionId = sessionId
    this.state = null
    this.error = ''
    this.loading = true
    const revision = ++this.revision
    try {
      const state = await getAgentBrowserSession(sessionId)
      if (revision === this.revision) this.state = state
    } catch (error) {
      if (revision === this.revision) this.error = String(error)
    } finally {
      if (revision === this.revision) this.loading = false
    }
  }

  accept(state: AgentBrowserSessionState): void {
    if (state.sessionId !== this.sessionId) return
    this.revision += 1
    this.state = state
    this.loading = false
  }

  async show(tabId: string): Promise<void> {
    const sessionId = this.sessionId
    this.error = ''
    try {
      const result = await showAgentBrowserTab(sessionId, tabId)
      if (this.sessionId === sessionId && !result.ok) this.error = result.error || i18nHelper.maestroControl.chat.browserTabs.status.unavailable
    } catch (error) {
      if (this.sessionId === sessionId) this.error = String(error)
    }
  }
}

export const agentBrowserStore = reactive(new AgentBrowserStore())
