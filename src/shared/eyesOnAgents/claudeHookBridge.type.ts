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

export interface ClaudeHookEventPayloadBase {
  hookEventName: ClaudeHookEventName;
  sessionId: string;
  transcriptPath: string | null;
  cwd: string | null;
}

export interface ClaudeHookEventV1 {
  schemaVersion: 1;
  eventId: string;
  occurredAt: number;
  payload: ClaudeHookEventPayloadBase;
}

type ClaudeHookPromptFieldsAbsent = {
  userPromptPreview?: never;
  userPromptTruncated?: never;
};

export type ClaudeHookEventV2Payload =
  | (Omit<ClaudeHookEventPayloadBase, 'hookEventName'> & {
      hookEventName: Exclude<ClaudeHookEventName, 'UserPromptSubmit'>;
    } & ClaudeHookPromptFieldsAbsent)
  | (Omit<ClaudeHookEventPayloadBase, 'hookEventName'> & {
      hookEventName: 'UserPromptSubmit';
    } & (
      | ClaudeHookPromptFieldsAbsent
      | {
          userPromptPreview: string;
          userPromptTruncated: boolean;
        }
    ));

export interface ClaudeHookEventV2 {
  schemaVersion: 2;
  eventId: string;
  occurredAt: number;
  payload: ClaudeHookEventV2Payload;
}

export type ClaudeHookTerminalFieldsAbsent = {
  terminalApp?: never;
  terminalSessionId?: never;
};

export type ClaudeHookEventV3Payload =
  | (Omit<ClaudeHookEventV2Payload, 'hookEventName'> & {
      hookEventName: Exclude<ClaudeHookEventName, 'SessionStart'>;
    } & ClaudeHookTerminalFieldsAbsent)
  | (Omit<ClaudeHookEventV2Payload, 'hookEventName'> & {
      hookEventName: 'SessionStart';
    } & (
      | ClaudeHookTerminalFieldsAbsent
      | {
          terminalApp: 'iterm2';
          terminalSessionId: string;
        }
    ));

export interface ClaudeHookEventV3 {
  schemaVersion: 3;
  eventId: string;
  occurredAt: number;
  payload: ClaudeHookEventV3Payload;
}

// SessionStart-only, one level up from terminal identity: which CLAUDE_CONFIG_DIR emitted this
// delivery. Never present on any other hookEventName.
export type ClaudeHookEnvironmentFieldAbsent = {
  claudeConfigDir?: never;
};

export type ClaudeHookEventV4Payload =
  | (Omit<ClaudeHookEventV3Payload, 'hookEventName'> & {
      hookEventName: Exclude<ClaudeHookEventName, 'SessionStart'>;
    } & ClaudeHookEnvironmentFieldAbsent)
  | (Omit<ClaudeHookEventV3Payload, 'hookEventName'> & {
      hookEventName: 'SessionStart';
    } & (
      | ClaudeHookEnvironmentFieldAbsent
      | {
          claudeConfigDir: string;
        }
    ));

export interface ClaudeHookEventV4 {
  schemaVersion: 4;
  eventId: string;
  occurredAt: number;
  payload: ClaudeHookEventV4Payload;
}

export type ClaudeHookEvent =
  | ClaudeHookEventV1
  | ClaudeHookEventV2
  | ClaudeHookEventV3
  | ClaudeHookEventV4;
export type ClaudeHookMetadataOnlyEvent =
  | (Omit<ClaudeHookEventV1, 'payload'> & {
      payload: ClaudeHookEventPayloadBase & ClaudeHookPromptFieldsAbsent;
    })
  | (Omit<ClaudeHookEventV2, 'payload'> & {
      payload: ClaudeHookEventPayloadBase & ClaudeHookPromptFieldsAbsent;
    })
  | (Omit<ClaudeHookEventV3, 'payload'> & {
      payload:
        | (ClaudeHookEventPayloadBase & ClaudeHookPromptFieldsAbsent & {
            hookEventName: Exclude<ClaudeHookEventName, 'SessionStart'>;
          } & ClaudeHookTerminalFieldsAbsent)
        | (ClaudeHookEventPayloadBase & ClaudeHookPromptFieldsAbsent & {
            hookEventName: 'SessionStart';
          } & (
            | ClaudeHookTerminalFieldsAbsent
            | {
                terminalApp: 'iterm2';
                terminalSessionId: string;
              }
          ));
    })
  | (Omit<ClaudeHookEventV4, 'payload'> & {
      payload:
        | (ClaudeHookEventPayloadBase & ClaudeHookPromptFieldsAbsent & {
            hookEventName: Exclude<ClaudeHookEventName, 'SessionStart'>;
          } & ClaudeHookTerminalFieldsAbsent & ClaudeHookEnvironmentFieldAbsent)
        | (ClaudeHookEventPayloadBase & ClaudeHookPromptFieldsAbsent & {
            hookEventName: 'SessionStart';
          } & (
            | ClaudeHookTerminalFieldsAbsent
            | {
                terminalApp: 'iterm2';
                terminalSessionId: string;
              }
          ) & (
            | ClaudeHookEnvironmentFieldAbsent
            | {
                claudeConfigDir: string;
              }
          ));
    });

export interface ClaudeHookDelivery {
  schemaVersion: 1;
  deliveryId: string;
  installationId: string;
  event: ClaudeHookEvent;
}

export interface ClaudeHookMetadataOnlyDelivery {
  schemaVersion: 1;
  deliveryId: string;
  installationId: string;
  event: ClaudeHookMetadataOnlyEvent;
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
