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

export interface CodexHookEventPayloadBase {
  sessionId: string;
  cwd: string | null;
  hookEventName: CodexHookEventName;
  turnId: string | null;
}

export interface CodexHookEventV1 {
  schemaVersion: 1;
  installationId: string;
  eventId: string;
  occurredAt: number;
  payload: CodexHookEventPayloadBase;
}

type CodexHookPromptFieldsAbsent = {
  userPromptPreview?: never;
  userPromptTruncated?: never;
};

export type CodexHookEventV2Payload =
  | (Omit<CodexHookEventPayloadBase, 'hookEventName'> & {
      hookEventName: Exclude<CodexHookEventName, 'UserPromptSubmit'>;
    } & CodexHookPromptFieldsAbsent)
  | (Omit<CodexHookEventPayloadBase, 'hookEventName'> & {
      hookEventName: 'UserPromptSubmit';
    } & (
      | CodexHookPromptFieldsAbsent
      | {
          userPromptPreview: string;
          userPromptTruncated: boolean;
        }
    ));

export interface CodexHookEventV2 {
  schemaVersion: 2;
  installationId: string;
  eventId: string;
  occurredAt: number;
  payload: CodexHookEventV2Payload;
}

export type CodexHookEvent = CodexHookEventV1 | CodexHookEventV2;
export type CodexHookMetadataOnlyEvent =
  | (Omit<CodexHookEventV1, 'payload'> & {
      payload: CodexHookEventPayloadBase & CodexHookPromptFieldsAbsent;
    })
  | (Omit<CodexHookEventV2, 'payload'> & {
      payload: CodexHookEventPayloadBase & CodexHookPromptFieldsAbsent;
    });

export interface CodexHookDelivery {
  schemaVersion: 1;
  deliveryId: string;
  event: CodexHookEvent;
}

export type CodexHookLiveDelivery = CodexHookDelivery;

export interface CodexHookMetadataOnlyDelivery {
  schemaVersion: 1;
  deliveryId: string;
  event: CodexHookMetadataOnlyEvent;
}

export interface CodexHookDeliveryAck {
  status: 'committed';
}

export interface CodexHookHelperArgs {
  endpoint: CodexHookBridgeEndpoint;
  installationId: string;
  outboxPath: string;
}
