export type CodingAgentProvider = 'codex' | 'claude';

export type CodingAgentSurface =
  | 'codex-desktop'
  | 'codex-managed-app-server'
  | 'claude-code-background'
  | 'claude-code-cli'
  | 'claude-desktop-chat'
  | 'claude-desktop-code';

export type CodingAgentRuntimeState =
  | 'working'
  | 'waiting_approval'
  | 'waiting_input'
  | 'idle'
  | 'failed'
  | 'stopped'
  | 'ended'
  | 'unknown';

export type CodingAgentTurnState =
  | 'in_progress'
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'unknown';

export type CodingAgentStatusSource =
  | 'codex-app-server'
  | 'codex-hook'
  | 'claude-agents-cli'
  | 'claude-hook'
  | 'manual'
  | 'none';

export interface CodingAgentSessionRecord {
  id: string;
  provider: CodingAgentProvider;
  surface: CodingAgentSurface;
  externalSessionId: string;
  runtimeJobId: string | null;
  title: string | null;
  titleIsCustom: boolean;
  cwd: string | null;
  state: CodingAgentRuntimeState;
  lastTurnState: CodingAgentTurnState;
  providerState: string | null;
  statusSource: CodingAgentStatusSource;
  statusObservedAt: number | null;
  statusFreshUntil: number | null;
  isProcessAlive: boolean | null;
  createdAt: number;
  updatedAt: number;
}

export interface CodingAgentSessionDraft {
  id: string;
  provider: CodingAgentProvider;
  surface: CodingAgentSurface;
  externalSessionId: string;
  runtimeJobId: string | null;
  title: string | null;
  titleIsCustom: boolean;
  cwd: string | null;
  state: CodingAgentRuntimeState;
  lastTurnState: CodingAgentTurnState;
  providerState: string | null;
  statusSource: CodingAgentStatusSource;
  statusObservedAt: number | null;
  statusFreshUntil: number | null;
  isProcessAlive: boolean | null;
}

export interface CodingAgentStatusUpdate {
  id: string;
  state: CodingAgentRuntimeState;
  lastTurnState: CodingAgentTurnState;
  providerState: string | null;
  statusSource: CodingAgentStatusSource;
  statusObservedAt: number | null;
  statusFreshUntil: number | null;
  isProcessAlive: boolean | null;
}

export interface CodingAgentSessionDaoApi {
  upsert(params: CodingAgentSessionDraft): Promise<CodingAgentSessionRecord>;
  list(params?: { includeUnknown?: boolean }): Promise<CodingAgentSessionRecord[]>;
  getById(params: { id: string }): Promise<CodingAgentSessionRecord | undefined>;
  rename(params: { id: string; title: string | null }): Promise<CodingAgentSessionRecord>;
  updateStatus(params: CodingAgentStatusUpdate): Promise<CodingAgentSessionRecord>;
  softDelete(params: { id: string }): Promise<boolean>;
}

export interface RegisterCodingAgentSessionParams {
  provider: CodingAgentProvider;
  surface: CodingAgentSurface;
  externalSessionId: string;
  title?: string | null;
  cwd?: string | null;
}

export interface CodingAgentDiscoveryIssue {
  provider: CodingAgentProvider;
  code:
    | 'cli-unavailable'
    | 'command-failed'
    | 'invalid-output'
    | 'invalid-entry'
    | 'unsupported-entry'
    | 'missing-session-id';
  message: string;
  entryIndex?: number;
}

export interface CodingAgentDiscoveryResult {
  provider: CodingAgentProvider;
  sessions: CodingAgentSessionDraft[];
  issues: CodingAgentDiscoveryIssue[];
  snapshot:
    | {
        status: 'success';
        observedAt: number;
        freshUntil: number;
      }
    | { status: 'failed' };
  supportsCompletedSessions?: boolean;
}

export interface RefreshCodingAgentSessionsResult {
  providers: CodingAgentProvider[];
  discoveredCount: number;
  importedCount: number;
  issues: CodingAgentDiscoveryIssue[];
}

export type CodingAgentCommandTarget =
  | {
      kind: 'claude-attach';
      executable: 'claude';
      args: ['attach', string];
      cwd: string;
    }
  | {
      kind: 'claude-resume';
      executable: 'claude';
      args: ['--resume', string];
      cwd: string;
    };

export type OpenCodingAgentSessionResult =
  | { kind: 'opened-url'; url: string }
  | { kind: 'terminal-command'; target: CodingAgentCommandTarget }
  | { kind: 'already-open'; message: string }
  | { kind: 'unavailable'; reason: string };

export interface CodingAgentSessionApi {
  list(params?: { includeUnknown?: boolean }): Promise<CodingAgentSessionRecord[]>;
  register(params: RegisterCodingAgentSessionParams): Promise<CodingAgentSessionRecord>;
  refresh(params?: { provider?: CodingAgentProvider }): Promise<RefreshCodingAgentSessionsResult>;
  open(params: { id: string }): Promise<OpenCodingAgentSessionResult>;
  rename(params: { id: string; title: string | null }): Promise<CodingAgentSessionRecord>;
  remove(params: { id: string }): Promise<boolean>;
}

export interface NormalizedCodingAgentStatus {
  state: CodingAgentRuntimeState;
  lastTurnState: CodingAgentTurnState;
  providerState: string | null;
  recognized: boolean;
}
