export const ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE = '260809003838';

export const isOnlyPreviewAgentSkillVersionCode = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{12}$/.test(value);
