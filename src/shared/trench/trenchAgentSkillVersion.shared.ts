export const TRENCH_AGENT_SKILL_VERSION_CODE = '260809005952';

export const isTrenchAgentSkillVersionCode = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{12}$/.test(value);
