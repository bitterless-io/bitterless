import dayjs from 'dayjs';
import { reactive } from 'vue';
import type {
  CodingAgentDiscoveryIssue,
  CodingAgentProvider,
  CodingAgentSessionRecord,
  CodingAgentSurface,
  RefreshCodingAgentSessionsResult,
  RegisterCodingAgentSessionParams
} from '@shared/codingAgent/codingAgentSession.type';
import { parseUuid } from '@shared/codingAgent/codingAgentSession.contract';
import {
  codingAgentSessionEmitter,
  subscribeCodingAgentSessionChanges
} from '@/emitter/codingAgentSession.emitter';
import type {
  CodingAgentActionError,
  CodingAgentDialogMode,
  CodingAgentDiscoveryAvailability,
  CodingAgentDisplayState,
  CodingAgentFreshness,
  CodingAgentIntegrationMap,
  CodingAgentPrimaryAction,
  CodingAgentProviderFilter,
  CodingAgentRegistrationErrors,
  CodingAgentRegistrationForm,
  CodingAgentSessionChangedPayload,
  CodingAgentSessionFilter,
  CodingAgentSessionStoreDependencies
} from './codingAgentSession.type';

const VISIBLE_POLL_MS = 15_000;
const HIDDEN_POLL_MS = 60_000;
const UUID_ERROR = 'uuid';
const REQUIRED_ERROR = 'required';
const ABSOLUTE_PATH_ERROR = 'absolute-path';
const MAX_LENGTH_ERROR = 'max-length';

const SURFACES: Record<CodingAgentProvider, CodingAgentSurface[]> = {
  codex: ['codex-desktop'],
  claude: ['claude-code-cli', 'claude-desktop-chat', 'claude-desktop-code']
};

const STATE_RANK: Record<CodingAgentDisplayState, number> = {
  waiting_approval: 0,
  waiting_input: 0,
  working: 1,
  failed: 2,
  turn_complete: 3,
  idle: 3,
  stopped: 4,
  ended: 4,
  unknown: 5
};

const isAbsolutePathInput = (value: string): boolean => {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const parseChangedPayload = (value: unknown): CodingAgentSessionChangedPayload | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) return null;
  if (!Array.isArray(record.ids) || !record.ids.every((id) => typeof id === 'string')) {
    return null;
  }
  return {
    ids: record.ids as string[],
    revision: record.revision as number
  };
};

const defaultCopyText = async (value: string): Promise<void> => {
  if (!globalThis.navigator?.clipboard) {
    throw new Error('Clipboard is unavailable');
  }
  await globalThis.navigator.clipboard.writeText(value);
};

const defaultDependencies: CodingAgentSessionStoreDependencies = {
  api: codingAgentSessionEmitter,
  subscribeChanged: subscribeCodingAgentSessionChanges,
  copyText: defaultCopyText,
  now: Date.now,
  setInterval: (handler, timeout) => globalThis.setInterval(handler, timeout),
  clearInterval: (handle) => globalThis.clearInterval(handle)
};

export class CodingAgentSessionState {
  sessions: CodingAgentSessionRecord[] = [];
  initialLoading = true;
  refreshing = false;
  loadError: string | null = null;
  refreshError: string | null = null;
  stateFilter: CodingAgentSessionFilter = 'all';
  providerFilter: CodingAgentProviderFilter = 'all';
  discoveryIssues: CodingAgentDiscoveryIssue[] = [];
  discoveryAvailability: Record<CodingAgentProvider, CodingAgentDiscoveryAvailability> = {
    codex: 'unknown',
    claude: 'unknown'
  };
  dialogMode: CodingAgentDialogMode = null;
  registrationForm: CodingAgentRegistrationForm = {
    provider: 'codex',
    surface: 'codex-desktop',
    externalSessionId: '',
    title: '',
    cwd: ''
  };
  registrationErrors: CodingAgentRegistrationErrors = {};
  registering = false;
  selectedSession: CodingAgentSessionRecord | null = null;
  renameTitle = '';
  renameError: string | null = null;
  renaming = false;
  removing = false;
  openingIds = new Set<string>();
  actionErrors: Record<string, CodingAgentActionError | undefined> = {};
  copiedSessionId: string | null = null;
  copyError: string | null = null;
  integrationDrawerVisible = false;
  integrationStatuses: CodingAgentIntegrationMap = {};
  integrationLoading = new Set<CodingAgentProvider>();
  integrationErrors: Partial<Record<CodingAgentProvider, string>> = {};
  pageVisible = false;
  nowValue: number;

  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private subscribed = false;
  private lastRevision = 0;
  private reloadPromise: Promise<void> | null = null;
  private reloadRequested = false;
  private pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;

  constructor(private readonly dependencies: CodingAgentSessionStoreDependencies) {
    this.nowValue = dependencies.now();
  }

  get availableSurfaces(): CodingAgentSurface[] {
    return SURFACES[this.registrationForm.provider];
  }

  get providerScopedSessions(): CodingAgentSessionRecord[] {
    return this.providerFilter === 'all'
      ? this.sessions
      : this.sessions.filter((session) => session.provider === this.providerFilter);
  }

  get allCount(): number {
    return this.providerScopedSessions.length;
  }

  get needsInputCount(): number {
    return this.providerScopedSessions.filter(
      (session) => session.state === 'waiting_approval' || session.state === 'waiting_input'
    ).length;
  }

  get workingCount(): number {
    return this.providerScopedSessions.filter((session) => session.state === 'working').length;
  }

  get unknownCount(): number {
    return this.providerScopedSessions.filter((session) => session.state === 'unknown').length;
  }

  get visibleSessions(): CodingAgentSessionRecord[] {
    const matches = this.providerScopedSessions.filter((session) => {
      if (this.stateFilter === 'all') return true;
      if (this.stateFilter === 'needs-input') {
        return session.state === 'waiting_approval' || session.state === 'waiting_input';
      }
      return session.state === this.stateFilter;
    });
    return [...matches].sort((left, right) => {
      const rank = STATE_RANK[this.displayState(left)] - STATE_RANK[this.displayState(right)];
      return rank === 0 ? right.updatedAt - left.updatedAt : rank;
    });
  }

  get dialogSubmitting(): boolean {
    return this.registering || this.renaming || this.removing;
  }

  displayState(session: CodingAgentSessionRecord): CodingAgentDisplayState {
    if (session.state === 'idle' && session.lastTurnState === 'completed') {
      return 'turn_complete';
    }
    return session.state;
  }

  primaryAction(session: CodingAgentSessionRecord): CodingAgentPrimaryAction {
    if (session.surface === 'claude-code-background') {
      if (!session.runtimeJobId) {
        return { kind: 'attach', disabled: true, reason: 'attach-unavailable' };
      }
      if (!session.cwd) {
        return { kind: 'attach', disabled: true, reason: 'cwd-missing' };
      }
      return { kind: 'attach', disabled: false, reason: null };
    }
    if (session.surface === 'claude-code-cli') {
      if (session.isProcessAlive === true) {
        return { kind: 'already-open', disabled: true, reason: 'already-open' };
      }
      if (session.isProcessAlive === null) {
        return { kind: 'open', disabled: true, reason: 'liveness-unknown' };
      }
      if (!session.cwd) {
        return { kind: 'open', disabled: true, reason: 'cwd-missing' };
      }
    }
    return { kind: 'open', disabled: false, reason: null };
  }

  freshness(timestamp: number | null): CodingAgentFreshness {
    if (timestamp === null) return { kind: 'never', value: 0 };
    const seconds = Math.max(0, dayjs(this.nowValue).diff(dayjs(timestamp), 'second'));
    if (seconds < 5) return { kind: 'now', value: 0 };
    if (seconds < 60) return { kind: 'seconds', value: seconds };
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return { kind: 'minutes', value: minutes };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { kind: 'hours', value: hours };
    return { kind: 'days', value: Math.floor(hours / 24) };
  }

  async initialize(): Promise<void> {
    if (this.initializationPromise) return await this.initializationPromise;
    if (this.initialized) return;
    if (!this.subscribed) {
      this.dependencies.subscribeChanged((payload) => this.handleChanged(payload));
      this.subscribed = true;
    }
    this.initialLoading = true;
    this.initializationPromise = (async () => {
      await this.reloadCanonical();
      this.initialized = true;
      this.initialLoading = false;
      this.schedulePoll();
      if (this.pageVisible) void this.refresh('claude', false);
    })().finally(() => {
      this.initializationPromise = null;
    });
    return await this.initializationPromise;
  }

  setPageVisible(visible: boolean): void {
    if (this.pageVisible === visible) return;
    this.pageVisible = visible;
    this.nowValue = this.dependencies.now();
    if (!this.initialized) return;
    this.schedulePoll();
    if (visible) void this.refresh('claude', false);
  }

  async reloadCanonical(): Promise<void> {
    if (this.reloadPromise) {
      this.reloadRequested = true;
      return await this.reloadPromise;
    }
    const operation = async (): Promise<void> => {
      do {
        this.reloadRequested = false;
        try {
          const sessions = await this.dependencies.api.list({ includeUnknown: true });
          this.sessions = sessions;
          this.loadError = null;
        } catch (error) {
          this.loadError = errorMessage(error);
        }
      } while (this.reloadRequested);
    };
    this.reloadPromise = operation().finally(() => {
      this.reloadPromise = null;
    });
    return await this.reloadPromise;
  }

  async refresh(provider?: CodingAgentProvider, showBusy = true): Promise<void> {
    if (showBusy && this.refreshing) return;
    if (showBusy) this.refreshing = true;
    this.refreshError = null;
    this.nowValue = this.dependencies.now();
    try {
      const result = await this.dependencies.api.refresh(provider ? { provider } : undefined);
      this.applyDiscoveryResult(result);
      await this.reloadCanonical();
    } catch (error) {
      this.refreshError = errorMessage(error);
    } finally {
      if (showBusy) this.refreshing = false;
    }
  }

  openAddDialog(): void {
    this.dialogMode = 'add';
    this.registrationForm = {
      provider: 'codex',
      surface: 'codex-desktop',
      externalSessionId: '',
      title: '',
      cwd: ''
    };
    this.registrationErrors = {};
    this.selectedSession = null;
  }

  setRegistrationProvider(provider: CodingAgentProvider): void {
    this.registrationForm.provider = provider;
    this.registrationForm.surface = SURFACES[provider][0];
    this.registrationErrors.provider = undefined;
    this.registrationErrors.surface = undefined;
    this.registrationErrors.cwd = undefined;
  }

  validateRegistration(): boolean {
    const errors: CodingAgentRegistrationErrors = {};
    const form = this.registrationForm;
    if (!SURFACES[form.provider].includes(form.surface)) errors.surface = REQUIRED_ERROR;
    try {
      parseUuid(form.externalSessionId.trim(), 'session id');
    } catch {
      errors.externalSessionId = UUID_ERROR;
    }
    if (form.title.trim().length > 300) errors.title = MAX_LENGTH_ERROR;
    const cwd = form.cwd.trim();
    if (form.surface === 'claude-code-cli' && !cwd) errors.cwd = REQUIRED_ERROR;
    if (cwd && !isAbsolutePathInput(cwd)) errors.cwd = ABSOLUTE_PATH_ERROR;
    if (cwd.length > 4096) errors.cwd = MAX_LENGTH_ERROR;
    this.registrationErrors = errors;
    return Object.keys(errors).length === 0;
  }

  async submitRegistration(): Promise<void> {
    if (this.registering || !this.validateRegistration()) return;
    this.registering = true;
    this.registrationErrors.form = undefined;
    const form = this.registrationForm;
    const params: RegisterCodingAgentSessionParams = {
      provider: form.provider,
      surface: form.surface,
      externalSessionId: parseUuid(form.externalSessionId.trim(), 'session id')
    };
    const title = form.title.trim();
    const cwd = form.cwd.trim();
    if (title) params.title = title;
    if (cwd) params.cwd = cwd;
    try {
      await this.dependencies.api.register(params);
      this.dialogMode = null;
      await this.reloadCanonical();
    } catch (error) {
      this.registrationErrors.form = errorMessage(error);
    } finally {
      this.registering = false;
    }
  }

  openRenameDialog(session: CodingAgentSessionRecord): void {
    this.selectedSession = session;
    this.renameTitle = session.title ?? '';
    this.renameError = null;
    this.dialogMode = 'rename';
  }

  async submitRename(): Promise<void> {
    if (!this.selectedSession || this.renaming) return;
    const title = this.renameTitle.trim();
    if (title.length > 300) {
      this.renameError = MAX_LENGTH_ERROR;
      return;
    }
    this.renaming = true;
    this.renameError = null;
    try {
      await this.dependencies.api.rename({
        id: this.selectedSession.id,
        title: title || null
      });
      this.dialogMode = null;
      await this.reloadCanonical();
    } catch (error) {
      this.renameError = errorMessage(error);
    } finally {
      this.renaming = false;
    }
  }

  openRemoveDialog(session: CodingAgentSessionRecord): void {
    this.selectedSession = session;
    this.renameError = null;
    this.dialogMode = 'remove';
  }

  async submitRemove(): Promise<void> {
    if (!this.selectedSession || this.removing) return;
    this.removing = true;
    try {
      const removed = await this.dependencies.api.remove({ id: this.selectedSession.id });
      if (!removed) throw new Error('Coding-agent session was not found');
      this.dialogMode = null;
      await this.reloadCanonical();
    } catch (error) {
      this.renameError = errorMessage(error);
    } finally {
      this.removing = false;
    }
  }

  closeDialog(): void {
    if (this.dialogSubmitting) return;
    this.dialogMode = null;
    this.selectedSession = null;
    this.renameError = null;
    this.registrationErrors = {};
  }

  async openSession(session: CodingAgentSessionRecord): Promise<void> {
    const action = this.primaryAction(session);
    if (action.disabled || this.openingIds.has(session.id)) return;
    this.openingIds.add(session.id);
    this.actionErrors[session.id] = undefined;
    try {
      const result = await this.dependencies.api.open({ id: session.id });
      if (result.kind === 'already-open') {
        this.actionErrors[session.id] = { code: 'already-open', detail: null };
      } else if (result.kind === 'unavailable') {
        this.actionErrors[session.id] = { code: 'unavailable', detail: result.reason };
      }
    } catch (error) {
      this.actionErrors[session.id] = {
        code: 'request-failed',
        detail: errorMessage(error)
      };
    } finally {
      this.openingIds.delete(session.id);
    }
  }

  async copySessionId(session: CodingAgentSessionRecord): Promise<void> {
    this.copyError = null;
    try {
      await this.dependencies.copyText(session.externalSessionId);
      this.copiedSessionId = session.id;
    } catch (error) {
      this.copyError = errorMessage(error);
    }
  }

  clearCopyError(): void {
    this.copyError = null;
  }

  async openIntegrations(): Promise<void> {
    this.integrationDrawerVisible = true;
    await Promise.all([this.loadIntegrationStatus('codex'), this.loadIntegrationStatus('claude')]);
  }

  closeIntegrations(): void {
    this.integrationDrawerVisible = false;
  }

  async loadIntegrationStatus(provider: CodingAgentProvider): Promise<void> {
    if (this.integrationLoading.has(provider)) return;
    this.integrationLoading.add(provider);
    this.integrationErrors[provider] = undefined;
    try {
      this.integrationStatuses[provider] = await this.dependencies.api.getIntegrationStatus({
        provider
      });
    } catch (error) {
      this.integrationErrors[provider] = errorMessage(error);
    } finally {
      this.integrationLoading.delete(provider);
    }
  }

  async installIntegration(provider: CodingAgentProvider): Promise<void> {
    if (this.integrationLoading.has(provider)) return;
    this.integrationLoading.add(provider);
    this.integrationErrors[provider] = undefined;
    try {
      this.integrationStatuses[provider] = await this.dependencies.api.installStatusBridge({
        provider
      });
    } catch (error) {
      this.integrationErrors[provider] = errorMessage(error);
    } finally {
      this.integrationLoading.delete(provider);
    }
  }

  async removeIntegration(provider: CodingAgentProvider): Promise<void> {
    if (this.integrationLoading.has(provider)) return;
    this.integrationLoading.add(provider);
    this.integrationErrors[provider] = undefined;
    try {
      this.integrationStatuses[provider] = await this.dependencies.api.removeStatusBridge({
        provider
      });
    } catch (error) {
      this.integrationErrors[provider] = errorMessage(error);
    } finally {
      this.integrationLoading.delete(provider);
    }
  }

  private schedulePoll(): void {
    if (this.pollTimer !== null) this.dependencies.clearInterval(this.pollTimer);
    if (!this.initialized) return;
    const interval = this.pageVisible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS;
    this.pollTimer = this.dependencies.setInterval(() => {
      this.nowValue = this.dependencies.now();
      if (!this.refreshing) void this.refresh('claude', false);
    }, interval);
  }

  private handleChanged(value: unknown): void {
    const payload = parseChangedPayload(value);
    if (!payload || payload.revision <= this.lastRevision) return;
    this.lastRevision = payload.revision;
    void this.reloadCanonical();
  }

  private applyDiscoveryResult(result: RefreshCodingAgentSessionsResult): void {
    const refreshed = new Set(result.providers);
    this.discoveryIssues = [
      ...this.discoveryIssues.filter((issue) => !refreshed.has(issue.provider)),
      ...result.issues
    ];
    for (const provider of result.providers) {
      const issues = result.issues.filter((issue) => issue.provider === provider);
      const unavailable = issues.some((issue) =>
        ['cli-unavailable', 'command-failed', 'invalid-output'].includes(issue.code)
      );
      this.discoveryAvailability[provider] = unavailable ? 'unavailable' : 'available';
    }
  }
}

export const codingAgentSessionStore = reactive<CodingAgentSessionState>(
  new CodingAgentSessionState(defaultDependencies)
);
