import type { EyesOnAgentsClaudeEnvironment } from '@shared/eyesOnAgents/eyesOnAgents.type';

// Resolves the Claude plugin bridge's optional { environmentId } param (task 086) against the
// currently configured environment list. An omitted environmentId targets environments[0] (the
// one automatic environment), preserving every pre-086 zero-arg install/refresh/remove/status
// caller unchanged; an explicitly supplied id must match a real configured environment or this
// throws — never a silent fallback to the default environment.
export const resolveClaudeBridgeEnvironment = (
  environments: readonly EyesOnAgentsClaudeEnvironment[],
  params?: { environmentId?: string }
): EyesOnAgentsClaudeEnvironment => {
  const environment = params?.environmentId === undefined
    ? environments[0]
    : environments.find((entry) => entry.id === params.environmentId);
  if (!environment) throw new Error('Claude environment was not found');
  return environment;
};
