export const SNIPING_SESSION_IPC_CHANNELS = {
  activate: 'sniping:session:activate',
  clear: 'sniping:session:clear',
} as const;

export interface SnipingSessionActivateInput {
  coreToken: string;
  sessionId: string;
}

export interface SnipingSessionClearInput {
  sessionId: string;
}

export interface SnipingSessionBridge {
  activate(input: SnipingSessionActivateInput): Promise<{ active: true }>;
  clear(input: SnipingSessionClearInput): Promise<{ cleared: boolean }>;
}
