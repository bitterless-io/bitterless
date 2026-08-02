export interface AuthInvalidationPayload {
  reason?: string;
  sessionId?: string;
  source?: string;
  status?: number;
}
