import type {
  CodingAgentProvider,
  CodingAgentRuntimeState,
  CodingAgentStatusSource,
  CodingAgentTurnState
} from './codingAgentSession.type';

export type CodingAgentBridgeTransport = 'unix' | 'win32-named-pipe';

export interface CodingAgentBridgeEndpoint {
  transport: CodingAgentBridgeTransport;
  path: string;
}

export type CodexHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PermissionRequest'
  | 'Stop';

export type ClaudeHookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PermissionRequest'
  | 'Notification'
  | 'Stop'
  | 'StopFailure'
  | 'SessionEnd';

export type CodingAgentHookEventName = CodexHookEventName | ClaudeHookEventName;
export type CodingAgentHookNotificationType = 'permission_prompt' | 'idle_prompt';

export interface CodingAgentHookEvent {
  schemaVersion: 1;
  provider: CodingAgentProvider;
  installationId: string;
  eventId: string;
  occurredAt: number;
  payload: {
    sessionId: string;
    cwd: string | null;
    hookEventName: CodingAgentHookEventName;
    turnId: string | null;
    notificationType: CodingAgentHookNotificationType | null;
  };
}

export interface CodingAgentHookStatusEvidence {
  provider: CodingAgentProvider;
  externalSessionId: string;
  cwd: string | null;
  state: CodingAgentRuntimeState;
  lastTurnState: CodingAgentTurnState | null;
  providerState: string;
  statusSource: Extract<CodingAgentStatusSource, 'codex-hook' | 'claude-hook'>;
  observedAt: number;
}

export interface CodingAgentHookHelperArgs {
  endpoint: CodingAgentBridgeEndpoint;
  provider: CodingAgentProvider;
  installationId: string;
}
