export const TRENCH_AGENT_SKILL_VERSION_CODE = '260813155645';

export const isTrenchAgentSkillVersionCode = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{12}$/.test(value);
