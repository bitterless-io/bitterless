export type ClaudeHookBridgeTransport = 'unix' | 'win32-named-pipe';

export interface ClaudeHookBridgeEndpoint {
  transport: ClaudeHookBridgeTransport;
  path: string;
}

export type ClaudeHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PermissionRequest'
  | 'Stop'
  | 'StopFailure'
  | 'SessionEnd';

export interface ClaudeHookEvent {
  schemaVersion: 1;
  eventId: string;
  occurredAt: number;
  payload: {
    hookEventName: ClaudeHookEventName;
    sessionId: string;
    transcriptPath: string | null;
    cwd: string | null;
  };
}

export interface ClaudeHookDelivery {
  schemaVersion: 1;
  deliveryId: string;
  installationId: string;
  event: ClaudeHookEvent;
}

export interface ClaudeHookCommitAcknowledgement {
  schemaVersion: 1;
  deliveryId: string;
  status: 'committed';
}

export interface ClaudeHookHelperArgs {
  endpoint: ClaudeHookBridgeEndpoint;
  installationId: string;
  outboxPath: string;
}
