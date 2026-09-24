import type { AgentSkillBrief } from '@main/agent/runtime/agentPrompt'

export const MENU_BUILTIN_SKILL: AgentSkillBrief = {
  id: 'builtin:menu',
  name: 'Menu',
  triggers: ['/menu', 'menu', '打开设置', '查看设置', 'open settings', 'show settings'],
  inputs: [], seed: {}, missing: [],
  description: 'Built-in Settings navigation. Call menu without tab to list this app\'s sections, or with tab to open the requested section for the user, e.g. menu {tab:"general"} or menu {tab:"skills"}. Use the returned allowed tabs for unknown names; do not guess or open a different page. No get_skill_contract or recorded recipe is needed.'
}

export const MANUAL_BUILTIN_SKILL: AgentSkillBrief = {
  id: 'builtin:manual',
  name: 'Manual',
  triggers: ['/manual', 'manual', '使用手册', '使用说明', 'how to use Bitterless', 'Bitterless help'],
  inputs: [], seed: {}, missing: [],
  description: 'Built-in Bitterless / Maestro usage manual. Call manual without topic for the bundled guide, or with topic for one section, e.g. manual {topic:"capture"}. Explain this product\'s actual features from that content; use menu if the user also wants to see a Settings section. No get_skill_contract or recorded recipe is needed.'
}
