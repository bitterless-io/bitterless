export interface ClaudeHookLogFields {
  hookEventName: string;
  sessionId: string;
  schemaVersion: number;
  environmentAttribution: boolean;
  transcript: boolean;
}

// [claude-hook] per-delivery logging (task 095). The line this replaces was
// `event=SessionStart environmentAttribution=<bool>` and only existed for SessionStart, inside the
// transcript-validation branch — so a session that never reached a board could not be traced at all:
// no session id, no schemaVersion, and nothing for the other five hook events.
//
// Paths are never logged. `claudeConfigDir`, `cwd` and `transcriptPath` collapse to booleans
// (`environmentAttribution`, `transcript`), matching the other Claude diagnostics.
export const buildClaudeHookLogLine = (fields: ClaudeHookLogFields): string => {
  return `[claude-hook] event=${fields.hookEventName} session=${fields.sessionId} `
    + `schemaVersion=${fields.schemaVersion} `
    + `environmentAttribution=${fields.environmentAttribution} `
    + `transcript=${fields.transcript}`;
};

export const logClaudeHookEvent = (
  fields: ClaudeHookLogFields,
  logger: Pick<Console, 'info'> = console
): void => {
  logger.info(buildClaudeHookLogLine(fields));
};

const MAX_CLAUDE_HOOK_LOG_ERROR_LENGTH = 300;

// The rejection reason can name the transcript path Claude Code reported, so it is bounded AND
// stripped of anything path-shaped before it reaches main.log — the whole point of this scope is
// that a line never carries a filesystem path.
const sanitizeClaudeHookLogError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return (text.trim() || 'Claude hook persistence failed')
    .replace(/[^\s]*\/[^\s]*/gu, '<path>')
    .slice(0, MAX_CLAUDE_HOOK_LOG_ERROR_LENGTH);
};

// A rejected transcript path is recorded while the delivery remains accepted: content-free
// lifecycle evidence stays valid.
export const logClaudeHookTranscriptRejection = (
  sessionId: string,
  error: unknown,
  logger: Pick<Console, 'warn'> = console
): void => {
  logger.warn(
    `[claude-hook] stage=transcript_rejected session=${sessionId} `
    + `reason=${sanitizeClaudeHookLogError(error)}`
  );
};

export const logClaudeHookInventoryRejection = (
  sessionId: string,
  error: unknown,
  logger: Pick<Console, 'error'> = console
): void => {
  logger.error(
    `[claude-hook] stage=inventory_rejected session=${sessionId} `
    + `reason=${sanitizeClaudeHookLogError(error)}`
  );
};
