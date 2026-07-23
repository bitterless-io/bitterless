export type McpIntegrationSkillState =
  | { status: 'pending'; skillPath: null; skillVersionCode: null }
  | { status: 'restart-required'; skillPath: null; skillVersionCode: null }
  | { status: 'ready'; skillPath: string; skillVersionCode: string };

export const resolveMcpIntegrationSkillState = (
  integrationInfo: unknown,
  expectedSkillVersionCode: string,
): McpIntegrationSkillState => {
  if (integrationInfo === null) {
    return { status: 'pending', skillPath: null, skillVersionCode: null };
  }
  if (typeof integrationInfo !== 'object') {
    return { status: 'restart-required', skillPath: null, skillVersionCode: null };
  }

  const skillPath = Reflect.get(integrationInfo, 'skillPath');
  const skillVersionCode = Reflect.get(integrationInfo, 'skillVersionCode');
  if (
    typeof skillPath !== 'string' ||
    !skillPath.trim() ||
    skillVersionCode !== expectedSkillVersionCode
  ) {
    return { status: 'restart-required', skillPath: null, skillVersionCode: null };
  }

  return {
    status: 'ready',
    skillPath: skillPath.trim(),
    skillVersionCode,
  };
};
