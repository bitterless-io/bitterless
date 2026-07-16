export type CodexHookBridgeTransport = 'unix' | 'win32-named-pipe';

export interface CodexHookBridgeEndpoint {
  transport: CodexHookBridgeTransport;
  path: string;
}

export type CodexHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PermissionRequest'
  | 'Stop';

export interface CodexHookEvent {
  schemaVersion: 1;
  installationId: string;
  eventId: string;
  occurredAt: number;
  payload: {
    sessionId: string;
    cwd: string | null;
    hookEventName: CodexHookEventName;
    turnId: string | null;
  };
}

export interface CodexHookHelperArgs {
  endpoint: CodexHookBridgeEndpoint;
  installationId: string;
}
