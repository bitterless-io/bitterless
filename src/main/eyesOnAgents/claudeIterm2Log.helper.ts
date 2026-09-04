const MAX_CLAUDE_ITERM2_LOG_ERROR_LENGTH = 300;

const sanitizeClaudeIterm2LogError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return (text.trim() || 'iTerm2 reveal failed').slice(0, MAX_CLAUDE_ITERM2_LOG_ERROR_LENGTH);
};

export type ClaudeIterm2RevealStage =
  | 'attempt'
  | 'revealed'
  | 'not_found'
  | 'denied'
  | 'failed';

const CLAUDE_ITERM2_ERROR_STAGES = new Set<ClaudeIterm2RevealStage>(['denied', 'failed']);

// [claude-iterm2] Open-in-iTerm2 logging (task 094): the absence of any log line here is why a
// completely non-functional Open action was invisible in main.log — `openExternal` resolved, the
// thread was marked opened, and nothing observed iTerm2 afterwards. Every attempt and every outcome
// is now recorded, identified by session id only: the Claude session key and the derived iTerm2
// session UUID are content-free identifiers, and no cwd, transcript path, or configDirectory is
// ever logged (matching the [claude-bridge]/[claude-environment]/[claude-watcher] convention).
// `denied` and `failed` go to error; `attempt`, `revealed`, and `not_found` are expected outcomes.
export const logClaudeIterm2Reveal = (params: {
  stage: ClaudeIterm2RevealStage;
  sessionKey: string;
  sessionUuid: string | null;
  error?: unknown;
  logger?: Pick<Console, 'info' | 'error'>;
}): void => {
  const logger = params.logger ?? console;
  const session = params.sessionUuid ?? 'none';
  const line = `[claude-iterm2] action=reveal stage=${params.stage} `
    + `id=${params.sessionKey} session=${session}`;
  const suffix = params.error === undefined
    ? ''
    : ` error=${sanitizeClaudeIterm2LogError(params.error)}`;
  if (CLAUDE_ITERM2_ERROR_STAGES.has(params.stage)) logger.error(`${line}${suffix}`);
  else logger.info(`${line}${suffix}`);
};
