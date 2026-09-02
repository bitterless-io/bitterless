import type { EyesOnAgentsClaudeEnvironment } from '@shared/eyesOnAgents/eyesOnAgents.type';

const MAX_CLAUDE_BRIDGE_LOG_ERROR_LENGTH = 300;

const sanitizeClaudeBridgeLogError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return (text.trim() || 'Claude plugin operation failed').slice(0, MAX_CLAUDE_BRIDGE_LOG_ERROR_LENGTH);
};

export type ClaudeBridgeLogAction = 'install' | 'refresh' | 'remove' | 'status';

// [claude-bridge] mutation/error logging (task 086): stage + sanitized, length-bounded error text
// only — never configDirectory, raw CLI output, or the resolved executable path — with the target
// environment's id/label, matching the [claude-environment]/[claude-watcher] scope convention
// established by tasks 084/085.
export const logClaudeBridgeAction = (
  action: ClaudeBridgeLogAction,
  environment: EyesOnAgentsClaudeEnvironment,
  error?: unknown,
  logger: Pick<Console, 'info' | 'error'> = console
): void => {
  const line = `[claude-bridge] action=${action} id=${environment.id} label="${environment.label}"`;
  if (error === undefined) logger.info(line);
  else logger.error(`${line} error=${sanitizeClaudeBridgeLogError(error)}`);
};
