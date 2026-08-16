import type {
  SnipingSessionActivateInput,
  SnipingSessionClearInput,
} from '@shared/sniping/snipingSession.type';

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class SnipingSessionError extends Error {
  constructor(readonly code: 'SNIPING_SESSION_INVALID' | 'SNIPING_SESSION_REQUIRED') {
    super(code);
    this.name = 'SnipingSessionError';
  }
}

export interface ActiveSnipingSession {
  readonly token: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly signal: AbortSignal;
}

interface MutableSnipingSession extends ActiveSnipingSession {
  readonly controller: AbortController;
}

const activateInput = (value: unknown): SnipingSessionActivateInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SnipingSessionError('SNIPING_SESSION_INVALID');
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, 'coreToken') ||
    !Object.hasOwn(input, 'sessionId') ||
    typeof input.coreToken !== 'string' ||
    input.coreToken.length < 1 ||
    input.coreToken.length > 16_384 ||
    input.coreToken !== input.coreToken.trim() ||
    typeof input.sessionId !== 'string' ||
    !SESSION_ID.test(input.sessionId)
  ) throw new SnipingSessionError('SNIPING_SESSION_INVALID');
  return { coreToken: input.coreToken, sessionId: input.sessionId };
};

const clearInput = (value: unknown): SnipingSessionClearInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SnipingSessionError('SNIPING_SESSION_INVALID');
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 1 ||
    !Object.hasOwn(input, 'sessionId') ||
    typeof input.sessionId !== 'string' ||
    !SESSION_ID.test(input.sessionId)
  ) throw new SnipingSessionError('SNIPING_SESSION_INVALID');
  return { sessionId: input.sessionId };
};

export class SnipingSessionService {
  private active: MutableSnipingSession | null = null;
  private generation = 0;

  activate(value: unknown): { active: true } {
    const input = activateInput(value);
    if (this.active?.sessionId === input.sessionId) {
      if (this.active.token !== input.coreToken) {
        throw new SnipingSessionError('SNIPING_SESSION_INVALID');
      }
      return { active: true };
    }
    const controller = new AbortController();
    const previous = this.active;
    this.generation += 1;
    this.active = {
      token: input.coreToken,
      sessionId: input.sessionId,
      generation: this.generation,
      controller,
      signal: controller.signal,
    };
    previous?.controller.abort(new Error('SNIPING_SESSION_REPLACED'));
    return { active: true };
  }

  clear(value: unknown): { cleared: boolean } {
    const input = clearInput(value);
    const active = this.active;
    if (!active || active.sessionId !== input.sessionId) return { cleared: false };
    this.active = null;
    this.generation += 1;
    active.controller.abort(new Error('SNIPING_SESSION_CLEARED'));
    return { cleared: true };
  }

  clearCurrent(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.generation += 1;
    active.controller.abort(new Error('SNIPING_SESSION_CLEARED'));
  }

  capture(): ActiveSnipingSession {
    const active = this.active;
    if (!active) throw new SnipingSessionError('SNIPING_SESSION_REQUIRED');
    return active;
  }

  isCurrent(session: Pick<ActiveSnipingSession, 'sessionId' | 'generation'>): boolean {
    return this.active?.sessionId === session.sessionId && this.active.generation === session.generation;
  }

  clearIfCurrent(session: Pick<ActiveSnipingSession, 'sessionId' | 'generation'>): boolean {
    if (!this.isCurrent(session)) return false;
    this.clearCurrent();
    return true;
  }
}

export const snipingSessionService = new SnipingSessionService();
