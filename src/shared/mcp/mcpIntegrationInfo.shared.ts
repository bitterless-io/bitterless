export type McpIntegrationSkillState =
  | { status: 'pending'; skillPath: null }
  | { status: 'restart-required'; skillPath: null }
  | { status: 'ready'; skillPath: string };

export const resolveMcpIntegrationSkillState = (
  integrationInfo: unknown,
): McpIntegrationSkillState => {
  if (integrationInfo === null) return { status: 'pending', skillPath: null };
  if (typeof integrationInfo !== 'object') {
    return { status: 'restart-required', skillPath: null };
  }

  const skillPath = Reflect.get(integrationInfo, 'skillPath');
  if (typeof skillPath !== 'string' || !skillPath.trim()) {
    return { status: 'restart-required', skillPath: null };
  }

  return { status: 'ready', skillPath: skillPath.trim() };
};
