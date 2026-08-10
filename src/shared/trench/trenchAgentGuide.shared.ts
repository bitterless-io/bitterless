import type { McpIntegrationInfo } from '../mcp/mcpBridge.type';

export type TrenchAgentGuideInfoState =
  | { status: 'ready'; info: McpIntegrationInfo }
  | { status: 'restart-required'; reason: 'invalid-payload' | 'version-mismatch' };

const readRequiredText = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value;
};

export const resolveTrenchAgentGuideInfo = (
  value: unknown,
  expectedSkillVersionCode: string,
): TrenchAgentGuideInfoState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { status: 'restart-required', reason: 'invalid-payload' };
  }

  const serverName = readRequiredText(Reflect.get(value, 'serverName'));
  const commandPath = readRequiredText(Reflect.get(value, 'commandPath'));
  const configJson = readRequiredText(Reflect.get(value, 'configJson'));
  const skillPath = readRequiredText(Reflect.get(value, 'skillPath'));
  const skillVersionCode = readRequiredText(Reflect.get(value, 'skillVersionCode'));
  const instruction = readRequiredText(Reflect.get(value, 'instruction'));
  const bridgePath = readRequiredText(Reflect.get(value, 'bridgePath'));
  const transport = Reflect.get(value, 'transport');

  if (skillVersionCode !== null && skillVersionCode !== expectedSkillVersionCode) {
    return { status: 'restart-required', reason: 'version-mismatch' };
  }
  if (
    !serverName
    || !commandPath
    || !configJson
    || !skillPath
    || !skillVersionCode
    || !instruction
    || !bridgePath
    || (transport !== 'unix' && transport !== 'win32-named-pipe')
  ) {
    return { status: 'restart-required', reason: 'invalid-payload' };
  }

  return {
    status: 'ready',
    info: {
      serverName,
      commandPath,
      configJson,
      skillPath,
      skillVersionCode,
      instruction,
      bridgePath,
      transport,
    },
  };
};
