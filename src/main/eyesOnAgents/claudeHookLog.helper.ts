export type ClaudeHookLogTerminalApp = 'iterm2' | null;

export interface ClaudeHookLogFields {
  hookEventName: string;
  sessionId: string;
  schemaVersion: number;
  terminalApp: ClaudeHookLogTerminalApp;
  terminalSessionId: string | null;
  environmentAttribution: boolean;
  transcript: boolean;
}

// [claude-hook] per-delivery logging (task 095). The line this replaces was
// `event=SessionStart environmentAttribution=<bool>` and only existed for SessionStart, inside the
// transcript-validation branch — so a session that never reached a board could not be traced at all:
// no session id, no schemaVersion, no terminal identity, and nothing for the other five hook events.
//
// Paths are never logged. `claudeConfigDir`, `cwd` and `transcriptPath` collapse to booleans
// (`environmentAttribution`, `transcript`), matching the [claude-bridge]/[claude-watcher]/
// [claude-iterm2] id-or-label-only convention. `terminalSessionId` is `ITERM_SESSION_ID`
// (`w<window>t<tab>p<pane>:<UUID>`) — an opaque terminal identifier, not a path — so it is safe and
// is the one field that answers "did session X arrive with an iTerm2 identity?" directly.
export const buildClaudeHookLogLine = (fields: ClaudeHookLogFields): string => {
  return `[claude-hook] event=${fields.hookEventName} session=${fields.sessionId} `
    + `schemaVersion=${fields.schemaVersion} `
    + `terminalIdentity=${fields.terminalApp !== null} `
    + `terminalApp=${fields.terminalApp ?? 'none'} `
    + `terminalSession=${fields.terminalSessionId ?? 'none'} `
    + `environmentAttribution=${fields.environmentAttribution} `
    + `transcript=${fields.transcript}`;
};

export const logClaudeHookEvent = (
  fields: ClaudeHookLogFields,
  logger: Pick<Console, 'info'> = console
): void => {
  logger.info(buildClaudeHookLogLine(fields));
};
