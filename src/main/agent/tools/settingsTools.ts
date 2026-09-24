import type { AgentToolSpec } from '@main/agent/runtime/agentRuntime.types'
import type { WorkbenchPane } from '@maestro-shared/coach.api'
import { findSettingsTab, SETTINGS_TABS } from '@maestro-shared/settingsNavigation'
import { SETTINGS_MANUAL_SECTIONS } from '../settingsManual'

export interface SettingsToolsHost {
  openPane(pane: WorkbenchPane): Promise<void>
}

export const buildSettingsTools = (host: SettingsToolsHost): AgentToolSpec[] => [
  {
    name: 'menu',
    description: 'List Bitterless Settings sections, or open one for the user through native app navigation. Omit tab to list; use an exact tab from the result to open it. This only shows a section and never changes its settings. Invalid tabs return allowed destinations without navigating.',
    params: [{ name: 'tab', type: 'string', description: `Optional Settings section: ${SETTINGS_TABS.map(({ tab }) => tab).join(', ')}.` }],
    executionMode: 'sequential',
    execute: async (args) => {
      const tabs = SETTINGS_TABS.map(({ tab, label, description }) => ({ tab, label, description }))
      if (args.tab === undefined) return JSON.stringify({ ok: true, product: 'Bitterless', tabs })
      const target = typeof args.tab === 'string' ? findSettingsTab(args.tab) : undefined
      if (!target) return JSON.stringify({ ok: false, error: 'Unknown Settings tab. Choose an allowed tab.', tabs })
      await host.openPane(target.pane)
      return JSON.stringify({ ok: true, product: 'Bitterless', tab: target.tab, label: target.label, opened: true })
    }
  },
  {
    name: 'manual',
    description: 'Read the bundled Bitterless / Maestro user manual. Omit topic for the complete guide; optionally request overview, settings, or a Settings section such as general, capture, skills, workflows or apps. Read-only and product-specific; no network lookup.',
    params: [{ name: 'topic', type: 'string', description: 'Optional manual topic. Omit it for all sections.' }],
    execute: async (args) => {
      const topics = SETTINGS_MANUAL_SECTIONS.map(({ topic }) => topic)
      const requested = typeof args.topic === 'string' ? args.topic.trim().toLowerCase() : args.topic
      const topic = typeof requested === 'string' && requested !== 'settings' ? findSettingsTab(requested)?.tab || requested : requested
      const sections = topic === undefined ? SETTINGS_MANUAL_SECTIONS : SETTINGS_MANUAL_SECTIONS.filter((entry) => entry.topic === topic)
      if (!sections.length) return JSON.stringify({ ok: false, error: 'Unknown manual topic. Choose an allowed topic.', topics })
      return JSON.stringify({ ok: true, product: 'Bitterless', topics, content: sections.map(({ title, content }) => `## ${title}\n\n${content}`).join('\n\n') })
    }
  }
]
