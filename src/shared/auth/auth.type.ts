export interface AuthInvalidationPayload {
  reason?: string;
  sessionId?: string;
  source?: string;
  status?: number;
}

export interface AuthSessionApi {
  activateSession(): Promise<void>;
  showHomeWindow(): Promise<void>;
  showPrimaryWindow(): Promise<void>;
  deactivateSession(): Promise<void>;
  invalidateSession(params?: AuthInvalidationPayload): Promise<void>;
}
