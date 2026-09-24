import type { WorkbenchPane } from './coach.api'

/** Settings UI order and the agent's menu share the same product-local destinations. */
export const SETTINGS_TABS = [
  { tab: 'general', pane: 'settings', label: 'General', aliases: ['settings', '通用', '常规', '设置'], description: 'Language, shortcuts, notifications, terminal and other Bitterless preferences.' },
  { tab: 'capture', pane: 'recording', label: 'Capture', aliases: ['recording', '录制'], description: 'Inspect captured browser actions and network requests, configure filters, and export evidence.' },
  { tab: 'skills', pane: 'skills', label: 'Skills', aliases: ['技能'], description: 'Browse, inspect and manage the skills available to Maestro.' },
  { tab: 'workflows', pane: 'workflows', label: 'Workflows', aliases: ['工作流'], description: 'Browse the workflow library and inspect workflow runs.' },
  { tab: 'injections', pane: 'injections', label: 'Injections', aliases: ['注入按钮'], description: 'Manage website buttons that trigger skills.' },
  { tab: 'tools', pane: 'tools', label: 'Tools', aliases: ['工具'], description: 'Inspect host tool capabilities, policies and approval history.' },
  { tab: 'models', pane: 'models', label: 'Models', aliases: ['模型'], description: 'Configure model providers, sign in and choose available models.' },
  { tab: 'apps', pane: 'apps', label: 'Apps', aliases: ['小程序', '应用'], description: 'Open Bitterless apps such as Todo, OnlyPreview, Eyes on Agents, Omni Browser and Zellij.' },
  { tab: 'connectors', pane: 'connectors', label: 'Connectors', aliases: ['连接器'], description: 'Inspect the available connector integrations.' },
  { tab: 'about', pane: 'about', label: 'About', aliases: ['关于'], description: 'Check this Bitterless installation and version.' },
  { tab: 'log', pane: 'log', label: 'Log', aliases: ['logs', '日志'], description: 'Inspect application diagnostics and the host log location.' }
] as const satisfies ReadonlyArray<{ tab: string; pane: WorkbenchPane; label: string; aliases: readonly string[]; description: string }>

export const workbenchPanes: WorkbenchPane[] = SETTINGS_TABS.map(({ pane }) => pane)

export const isWorkbenchPane = (value: unknown): value is WorkbenchPane =>
  typeof value === 'string' && workbenchPanes.includes(value as WorkbenchPane)

export const findSettingsTab = (value: string): typeof SETTINGS_TABS[number] | undefined => {
  const name = value.trim().toLowerCase()
  return SETTINGS_TABS.find((entry) => entry.tab === name || entry.aliases.some((alias) => alias === name))
}

export const SETTINGS_PANE_REQUEST_EVENT = 'coach/settings-pane-request'
