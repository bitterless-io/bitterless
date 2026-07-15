import type {
  CodingAgentIntegrationStatus,
  CodingAgentProvider,
  CodingAgentSessionApi,
  CodingAgentSessionRecord,
  CodingAgentSurface
} from '@shared/codingAgent/codingAgentSession.type';

export type CodingAgentSessionFilter = 'all' | 'needs-input' | 'working' | 'unknown';
export type CodingAgentProviderFilter = 'all' | CodingAgentProvider;
export type CodingAgentDialogMode = 'add' | 'rename' | 'remove' | null;
export type CodingAgentDiscoveryAvailability = 'unknown' | 'available' | 'unavailable';

export type CodingAgentDisplayState =
  | 'working'
  | 'waiting_approval'
  | 'waiting_input'
  | 'turn_complete'
  | 'idle'
  | 'failed'
  | 'stopped'
  | 'ended'
  | 'unknown';

export type CodingAgentPrimaryAction =
  | { kind: 'open'; disabled: false; reason: null }
  | { kind: 'attach'; disabled: false; reason: null }
  | {
      kind: 'open' | 'attach' | 'already-open';
      disabled: true;
      reason: 'already-open' | 'liveness-unknown' | 'cwd-missing' | 'attach-unavailable';
    };

export type CodingAgentActionError = {
  code: 'already-open' | 'unavailable' | 'request-failed';
  detail: string | null;
};

export interface CodingAgentRegistrationForm {
  provider: CodingAgentProvider;
  surface: CodingAgentSurface;
  externalSessionId: string;
  title: string;
  cwd: string;
}

export type CodingAgentRegistrationField =
  | 'provider'
  | 'surface'
  | 'externalSessionId'
  | 'title'
  | 'cwd'
  | 'form';

export type CodingAgentRegistrationErrors = Partial<Record<CodingAgentRegistrationField, string>>;

export interface CodingAgentSessionChangedPayload {
  ids: string[];
  revision: number;
}

export interface CodingAgentFreshness {
  kind: 'never' | 'now' | 'seconds' | 'minutes' | 'hours' | 'days';
  value: number;
}

export interface CodingAgentSessionStoreDependencies {
  api: CodingAgentSessionApi;
  subscribeChanged: (listener: (payload: unknown) => void) => void;
  copyText: (value: string) => Promise<void>;
  now: () => number;
  setInterval: (handler: () => void, timeout: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval: (handle: ReturnType<typeof globalThis.setInterval>) => void;
}

export type CodingAgentIntegrationMap = Partial<
  Record<CodingAgentProvider, CodingAgentIntegrationStatus>
>;

export type CodingAgentSessionMap = Record<string, CodingAgentSessionRecord>;
