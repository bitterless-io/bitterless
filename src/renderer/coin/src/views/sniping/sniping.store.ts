import type {
  SnipingActivityCursor,
  SnipingActivityListInput,
  SnipingActivityOutcome,
  SnipingActivityProduct,
  SnipingActivityRow,
  SnipingBridge,
  SnipingChain,
  SnipingConfigDetail,
  SnipingConfigSummary,
  SnipingJsonObject,
  SnipingJsonValue,
  SnipingReleaseProjection,
  SnipingRuntimeProjection,
  SnipingShadowPolicy,
  SnipingSimulationEvent,
  SnipingSimulationRequestProjection,
} from '@shared/sniping/snipingBridge.type';
import { SnipingDraftController, type SnipingDraftSnapshot } from './snipingDraft.service';
import {
  compileSnipingForm,
  validateSnipingDraft,
  type SnipingCompiledForm,
  type SnipingDraftIssue,
} from './snipingSchema.service';
import {
  buildSnipingEvidenceStages,
  simulationProjectionMatchesDetail,
  SnipingLatestEvidenceController,
} from './snipingEvidence.service';

type SnipingPhase = 'idle' | 'loading' | 'refreshing' | 'ready' | 'empty' | 'unavailable';
type SnipingDetailTab = 'configuration' | 'simulation' | 'versions';

const blankDraft = (): SnipingDraftSnapshot => ({ value: {}, json: '{}\n', jsonError: null, changed: false });
const emptyForm = (): SnipingCompiledForm => ({
  supported: false, safeAdvanced: false, groups: [], fields: [], derivedKeys: [], readOnlyKeys: [],
});
const requestId = (prefix: string): string => `${prefix}-${window.crypto.randomUUID()}`;

const unavailableCode = (result: { ok: false; error: { code: string } }): string => result.error.code;

export class SnipingStore {
  phase: SnipingPhase = 'idle';
  surfaceErrors: Partial<Record<'catalog' | 'detail' | 'events' | 'exact' | 'shadow' | 'runtime' | 'activity' | 'action', string>> = {};
  releases: SnipingReleaseProjection[] = [];
  configs: SnipingConfigSummary[] = [];
  configTotal = 0; configPage = 1; configPageSize = 20; configSearch = '';
  selectedConfigId: string | null = null;
  detail: SnipingConfigDetail | null = null;
  runtimes: SnipingRuntimeProjection[] = [];
  form: SnipingCompiledForm = emptyForm();
  draft: SnipingDraftSnapshot = blankDraft();
  draftIssues: SnipingDraftIssue[] = []; serverIssues: SnipingDraftIssue[] = [];
  validationHash: string | null = null; revisionConflict = false;
  detailTab: SnipingDetailTab = 'configuration'; advancedOpen = false; mobileDetail = false;
  pendingAction: string | null = null;
  events: SnipingSimulationEvent[] = [];
  eventTotal = 0; eventPage = 1;
  selectedEventKey: string | null = null;
  exactRuns: SnipingSimulationRequestProjection[] = [];
  exactTotal = 0; exactPage = 1;
  shadowRuns: SnipingSimulationRequestProjection[] = [];
  shadowTotal = 0; shadowPage = 1;
  shadowPolicy: { maxEvents: string; checkpointBlocks: string; evidenceTtlSeconds: string } = {
    maxEvents: '', checkpointBlocks: '', evidenceTtlSeconds: '',
  };
  shadowRequestId: string | null = null; shadowFingerprint: string | null = null;
  shadowRetryUncertain = false;
  activity: SnipingActivityRow[] = [];
  activityCursor: SnipingActivityCursor | null = null;
  activityFilter: {
    product: '' | SnipingActivityProduct;
    outcome: '' | SnipingActivityOutcome;
    chain: '' | SnipingChain;
    search: string;
  } = { product: '', outcome: '', chain: 'bsc', search: '' };
  selectedActivity: SnipingActivityRow | null = null; activityLoading = false;
  workspaceRefreshing = false;
  private readonly draftController = new SnipingDraftController();
  private readonly latestEvidence = new SnipingLatestEvidenceController();
  private listSequence = 0; private detailSequence = 0; private eventSequence = 0;
  private exactSequence = 0; private shadowSequence = 0; private runtimeSequence = 0;
  private actionSequence = 0; private activitySequence = 0; private workspaceSequence = 0;
  private draftProvenance: string | null = null;
  private nameBaseline = '';
  private detailFreshness: string | null = null;

  constructor(private readonly bridge: SnipingBridge) {}

  get selectedRelease(): SnipingReleaseProjection | null {
    const detail = this.detail;
    if (!detail) return null;
    return this.releases.find((release) =>
      release.component_id === detail.component_id &&
      release.component_version === detail.component_version &&
      release.schema_hash === detail.schema_hash) ?? null;
  }

  get isMonitoring(): boolean { return this.detail?.desired_state === 'armed'; }

  get displayStateKey(): 'monitoring' | 'disabled' { return this.isMonitoring ? 'monitoring' : 'disabled'; }

  get editable(): boolean {
    return Boolean(
      this.detail && this.releaseUsable && (this.form.supported || this.form.safeAdvanced) &&
      this.detailRemoteReady && !this.isMonitoring && this.pendingAction === null,
    );
  }

  get releaseUsable(): boolean { return Boolean(this.detail?.release_available && this.selectedRelease); }

  get remoteReady(): boolean { return !this.workspaceRefreshing && (this.phase === 'ready' || this.phase === 'empty'); }

  get detailRemoteReady(): boolean {
    return Boolean(this.remoteReady && this.detail && (
      this.detail.config_id === '0' || this.detailFreshness === this.provenanceKey(this.detail)
    ));
  }

  get ownerDraftChanged(): boolean { return this.draft.changed || Boolean(this.detail && this.detail.name !== this.nameBaseline); }

  get detailProjectionStale(): boolean { return Boolean(
    this.detail && this.detail.config_id !== '0' && !this.detailRemoteReady,
  ); }

  get canStartMonitoring(): boolean {
    return Boolean(
      this.detail && this.detail.config_id !== '0' && !this.isMonitoring && this.pendingAction === null &&
      this.detailRemoteReady && !this.ownerDraftChanged && !this.draft.jsonError &&
      this.draftIssues.length === 0 && this.serverIssues.length === 0 && !this.revisionConflict &&
      this.detail.name.trim() && this.releaseUsable &&
      this.detail.credential_status.every((credential) => credential.configured),
    );
  }

  get selectedRuntimeState(): string | null {
    const detail = this.detail;
    if (!detail) return null;
    const preferred = this.runtimes.find((runtime) => runtime.region === detail.primary_region);
    return (preferred ?? this.runtimes[0])?.observed_state ?? null;
  }

  get currentErrorCode(): string | null { return this.productsErrorCode ?? this.activityErrorCode; }

  get productsErrorCode(): string | null {
    const priority: Array<keyof SnipingStore['surfaceErrors']> = [
      'action', 'detail', 'catalog', 'runtime', 'events', 'exact', 'shadow',
    ];
    for (const surface of priority) {
      const code = this.surfaceErrors[surface];
      if (code) return code;
    }
    return null;
  }

  get activityErrorCode(): string | null { return this.surfaceErrors.activity ?? null; }

  get monitorQualificationReady(): boolean {
    return Boolean(
      this.detail && this.detail.config_id !== '0' && this.isMonitoring &&
      this.runtimes.some((runtime) => runtime.observed_state === 'active'),
    );
  }

  get shadowRetryAvailable(): boolean {
    const fingerprint = this.currentShadowFingerprint();
    return Boolean(
      this.shadowRetryUncertain && this.shadowRequestId && fingerprint && this.shadowFingerprint === fingerprint,
    );
  }

  get canRequestSimulation(): boolean {
    return Boolean(
      this.detail && this.detail.config_id !== '0' && this.releaseUsable && this.detailRemoteReady &&
      this.pendingAction === null && !this.revisionConflict && !this.ownerDraftChanged,
    );
  }

  get latestExactRun(): SnipingSimulationRequestProjection | null { return this.latestEvidence.exact; }

  get latestShadowRun(): SnipingSimulationRequestProjection | null { return this.latestEvidence.shadow; }

  get evidenceStages(): ReturnType<typeof buildSnipingEvidenceStages> {
    return buildSnipingEvidenceStages({
      runtimeState: this.selectedRuntimeState,
      canonicalSelected: Boolean(this.selectedEventKey),
      exact: this.latestExactRun,
      shadow: this.latestShadowRun,
    });
  }

  async initialize(): Promise<void> { if (this.phase === 'idle') await this.refreshProducts(); }

  async refreshProducts(): Promise<void> {
    const sequence = ++this.listSequence;
    this.phase = this.phase === 'idle' ? 'loading' : 'refreshing';
    const [catalog, configs] = await Promise.all([
      this.bridge.listComponents(),
      this.bridge.listConfigs({
        page: this.configPage,
        page_size: this.configPageSize,
        ...(this.configSearch.trim() ? { search_text: this.configSearch.trim() } : {}),
      }),
    ]);
    if (sequence !== this.listSequence) return;
    if (!catalog.ok || !configs.ok) {
      this.phase = 'unavailable';
      this.surfaceErrors.catalog = !catalog.ok
        ? unavailableCode(catalog)
        : unavailableCode(configs as { ok: false; error: { code: string } });
      return;
    }
    delete this.surfaceErrors.catalog;
    this.releases = catalog.value.filter((release) => release.available);
    this.configs = configs.value.list;
    this.configTotal = configs.value.total;
    this.phase = this.configs.length || this.releases.length ? 'ready' : 'empty';
  }

  async refreshWorkspace(): Promise<void> {
    const sequence = ++this.workspaceSequence;
    this.workspaceRefreshing = true;
    const selectedId = this.detail?.config_id === '0' ? null : this.detail?.config_id ?? null;
    const preservedName = this.detail?.name ?? '';
    const changedDraft = this.ownerDraftChanged;
    try {
      await this.refreshProducts();
      if (sequence !== this.workspaceSequence || !selectedId || this.phase === 'unavailable') return;
      if (changedDraft) await this.refreshConflictFacts(selectedId, preservedName);
      else await this.selectConfig(selectedId, false);
    } finally {
      if (sequence === this.workspaceSequence) this.workspaceRefreshing = false;
    }
  }

  async searchConfigs(value: string): Promise<void> {
    this.configSearch = value;
    this.configPage = 1;
    await this.refreshProducts();
  }

  setConfigSearch(value: string): void { this.configSearch = value; }

  async setConfigPage(page: number): Promise<void> { this.configPage = page; await this.refreshProducts(); }

  async selectConfig(configId: string, switchPane = true): Promise<void> {
    this.actionSequence += 1;
    const sequence = ++this.detailSequence;
    this.detailFreshness = null;
    this.pendingAction = 'detail';
    const result = await this.bridge.getConfig({ config_id: configId });
    if (sequence !== this.detailSequence) return;
    this.pendingAction = null;
    if (!result.ok) {
      this.surfaceErrors.detail = result.error.code;
      return;
    }
    delete this.surfaceErrors.detail;
    this.selectedConfigId = configId;
    this.detail = result.value;
    this.draftProvenance = this.provenanceKey(result.value);
    this.detailFreshness = this.draftProvenance;
    this.nameBaseline = result.value.name;
    this.runtimes = result.value.runtimes;
    const release = this.releases.find((item) =>
      item.component_id === result.value.component_id &&
      item.component_version === result.value.component_version &&
      item.schema_hash === result.value.schema_hash);
    this.form = release ? compileSnipingForm(release.config_schema, release.ui_schema) : emptyForm();
    this.draft = this.draftController.reset(result.value.config, this.form);
    this.draftIssues = validateSnipingDraft(this.form, this.draft.value);
    this.serverIssues = [];
    this.revisionConflict = false;
    this.validationHash = null;
    this.resetSimulationState();
    if (switchPane) this.mobileDetail = true;
    await this.refreshSimulation();
  }

  startCreate(release: SnipingReleaseProjection): void {
    if (!this.remoteReady || !release.available) return;
    this.actionSequence += 1;
    this.detailSequence += 1;
    this.invalidateSimulationReads();
    this.selectedConfigId = null;
    this.detail = {
      config_id: '0',
      name: '',
      component_id: release.component_id,
      component_version: release.component_version,
      schema_hash: release.schema_hash,
      release_available: release.available,
      chain: release.chains[0] ?? 'bsc',
      config_revision: 0,
      desired_state: 'disabled',
      primary_region: 'sg',
      standby_region: 'jp',
      updated_at: new Date(0).toISOString(),
      config: release.default_config,
      credential_status: release.secret_slots.map((slot) => ({ slot, configured: false })),
      runtimes: [],
    };
    this.draftProvenance = this.provenanceKey(this.detail);
    this.detailFreshness = null;
    this.nameBaseline = this.detail.name;
    this.form = compileSnipingForm(release.config_schema, release.ui_schema);
    this.draft = this.draftController.reset(release.default_config, this.form);
    this.draftIssues = validateSnipingDraft(this.form, this.draft.value);
    this.serverIssues = [];
    this.revisionConflict = false;
    this.resetSimulationState();
    this.mobileDetail = true;
    this.detailTab = 'configuration';
    this.pendingAction = null;
  }

  setName(name: string): void {
    if (!this.editable || !this.detail) return;
    this.detail = { ...this.detail, name };
  }

  setField(key: string, value: SnipingJsonValue): void {
    if (!this.editable) return;
    this.draft = this.draftController.setField(key, value);
    this.draftIssues = validateSnipingDraft(this.form, this.draft.value);
    this.validationHash = null;
  }

  setAdvancedJson(value: string): void {
    if (!this.editable) return;
    this.draft = this.draftController.setJson(value);
    this.draftIssues = this.draft.jsonError ? [] : validateSnipingDraft(this.form, this.draft.value);
    this.validationHash = null;
  }

  setDetailTab(tab: SnipingDetailTab): void { this.detailTab = tab; }

  setAdvancedOpen(open: boolean): void { this.advancedOpen = open; }
  setMobileDetail(open: boolean): void { this.mobileDetail = open; }

  selectEvent(canonicalEventKey: string): void {
    if (!this.events.some((event) => event.canonical_event_key === canonicalEventKey)) return;
    this.selectedEventKey = canonicalEventKey;
  }

  setShadowPolicyField(
    field: keyof SnipingStore['shadowPolicy'],
    value: string,
  ): void {
    this.shadowPolicy = { ...this.shadowPolicy, [field]: value };
    if (!this.shadowRetryAvailable) this.shadowRetryUncertain = false;
  }

  async validate(): Promise<boolean> {
    if (!this.editable || !this.detail || this.draft.jsonError || this.draftIssues.length) return false;
    const detail = this.detail;
    const sequence = ++this.actionSequence;
    this.pendingAction = 'validate';
    const result = await this.bridge.validateConfig({
      component_id: detail.component_id,
      component_version: detail.component_version,
      schema_hash: detail.schema_hash,
      chain: detail.chain,
      config: this.draftController.payload(),
    });
    if (sequence !== this.actionSequence || this.detail !== detail) return false;
    this.pendingAction = null;
    if (!result.ok) {
      this.surfaceErrors.action = result.error.code;
      this.serverIssues = result.error.issues ?? [];
      return false;
    }
    this.serverIssues = [];
    delete this.surfaceErrors.action;
    this.validationHash = result.value.normalized_config_hash;
    return true;
  }

  async save(): Promise<void> {
    if (!this.editable || !this.detail || !this.detail.name.trim()) return;
    if (!(await this.validate())) return;
    const detail = this.detail;
    const draftName = detail.name;
    const draftPayload = this.draftController.payload();
    const sequence = ++this.actionSequence;
    this.pendingAction = 'save';
    const result = await this.bridge.saveConfig({
      ...(detail.config_id === '0' ? {} : { config_id: detail.config_id }),
      name: draftName.trim(),
      component_id: detail.component_id,
      component_version: detail.component_version,
      schema_hash: detail.schema_hash,
      chain: detail.chain,
      config: draftPayload,
      primary_region: detail.primary_region,
      standby_region: detail.standby_region,
      expected_revision: detail.config_revision,
    });
    if (sequence !== this.actionSequence || this.detail !== detail) return;
    this.pendingAction = null;
    if (!result.ok) {
      this.surfaceErrors.action = result.error.code;
      if (result.error.status === 409 && detail.config_id !== '0') {
        await this.refreshConflictFacts(detail.config_id, draftName);
      }
      return;
    }
    this.adoptDetailRevision(result.value);
    delete this.surfaceErrors.action;
    this.revisionConflict = false;
    this.selectedConfigId = result.value.config_id;
    this.draft = this.draftController.commit(result.value.config);
    this.draftProvenance = this.provenanceKey(result.value);
    this.detailFreshness = this.draftProvenance;
    this.nameBaseline = result.value.name;
    await this.refreshProducts();
    await this.refreshSimulation();
  }

  async setMonitoring(enabled: boolean): Promise<void> {
    if (!this.detail || this.detail.config_id === '0' || this.pendingAction) return;
    if (enabled && !this.canStartMonitoring) return;
    if (!enabled && (!this.isMonitoring || !this.detailRemoteReady)) return;
    const detail = this.detail;
    const sequence = ++this.actionSequence;
    this.pendingAction = enabled ? 'start' : 'stop';
    const input = { config_id: detail.config_id, expected_revision: detail.config_revision };
    const result = enabled
      ? await this.bridge.startMonitoring(input)
      : await this.bridge.stopMonitoring(input);
    if (sequence !== this.actionSequence || this.detail !== detail) return;
    this.pendingAction = null;
    if (!result.ok) {
      this.surfaceErrors.action = result.error.code;
      if (result.error.status === 409) await this.refreshConflictFacts(detail.config_id, detail.name);
      return;
    }
    this.adoptDetailRevision(result.value);
    this.draftProvenance = this.provenanceKey(result.value);
    this.detailFreshness = this.draftProvenance;
    this.nameBaseline = result.value.name;
    delete this.surfaceErrors.action;
    await this.refreshProducts();
    await this.refreshSimulation();
  }

  async refreshSimulation(): Promise<void> {
    await Promise.all([
      this.refreshEvents(),
      this.refreshExactRuns(),
      this.refreshShadowRuns(),
      this.refreshRuntimes(),
    ]);
  }

  async refreshEvents(): Promise<void> {
    const detail = this.persistedDetail();
    if (!detail) return;
    const sequence = ++this.eventSequence;
    const events = await this.bridge.listSimulationEvents({
      config_id: detail.config_id,
      page: this.eventPage,
      page_size: 20,
    });
    if (!this.isCurrentSimulationRead(detail, sequence, this.eventSequence)) return;
    if (events.ok) {
      delete this.surfaceErrors.events;
      this.events = events.value.list;
      this.eventTotal = events.value.total;
      if (this.selectedEventKey && !this.events.some((item) => item.canonical_event_key === this.selectedEventKey)) {
        this.selectedEventKey = null;
      }
    } else {
      this.surfaceErrors.events = events.error.code;
    }
  }

  async refreshExactRuns(): Promise<void> {
    const detail = this.persistedDetail();
    if (!detail) return;
    const sequence = ++this.exactSequence;
    const [result, latest] = await Promise.all([this.bridge.listExactSimulations({
      config_id: detail.config_id,
      page: this.exactPage,
      page_size: 20,
    }), this.latestEvidence.loadExact(this.bridge, detail, () => this.sameDetail(detail))]);
    if (!this.isCurrentSimulationRead(detail, sequence, this.exactSequence)) return;
    if (!result.ok) { this.surfaceErrors.exact = result.error.code; return; }
    if (result.value.list.some((run) => !simulationProjectionMatchesDetail(run, detail, 'exact'))) {
      this.surfaceErrors.exact = 'SNIPING_RESPONSE_INTEGRITY';
      return;
    }
    if (!latest.stale && latest.error) { this.surfaceErrors.exact = latest.error; return; }
    delete this.surfaceErrors.exact;
    this.exactRuns = result.value.list;
    this.exactTotal = result.value.total;
  }

  async refreshShadowRuns(): Promise<void> {
    const detail = this.persistedDetail();
    if (!detail) return;
    const sequence = ++this.shadowSequence;
    const [result, latest] = await Promise.all([this.bridge.listShadowSimulations({
      config_id: detail.config_id,
      page: this.shadowPage,
      page_size: 20,
    }), this.latestEvidence.loadShadow(this.bridge, detail, () => this.sameDetail(detail))]);
    if (!this.isCurrentSimulationRead(detail, sequence, this.shadowSequence)) return;
    if (!result.ok) { this.surfaceErrors.shadow = result.error.code; return; }
    if (result.value.list.some((run) => !simulationProjectionMatchesDetail(run, detail, 'shadow'))) {
      this.surfaceErrors.shadow = 'SNIPING_RESPONSE_INTEGRITY';
      return;
    }
    if (!latest.stale && latest.error) { this.surfaceErrors.shadow = latest.error; return; }
    delete this.surfaceErrors.shadow;
    this.shadowRuns = result.value.list;
    this.shadowTotal = result.value.total;
  }

  async refreshRuntimes(): Promise<void> {
    const detail = this.persistedDetail();
    if (!detail) return;
    const sequence = ++this.runtimeSequence;
    const result = await this.bridge.listRuntimes({ config_id: detail.config_id });
    if (!this.isCurrentSimulationRead(detail, sequence, this.runtimeSequence)) return;
    if (!result.ok) { this.surfaceErrors.runtime = result.error.code; return; }
    delete this.surfaceErrors.runtime;
    this.runtimes = result.value.list;
  }

  async setEventPage(page: number): Promise<void> {
    if (!Number.isSafeInteger(page) || page < 1) return;
    this.eventPage = page; this.selectedEventKey = null; await this.refreshEvents();
  }

  async setExactPage(page: number): Promise<void> {
    if (!Number.isSafeInteger(page) || page < 1) return;
    this.exactPage = page; await this.refreshExactRuns();
  }

  async setShadowPage(page: number): Promise<void> {
    if (!Number.isSafeInteger(page) || page < 1) return;
    this.shadowPage = page;
    await this.refreshShadowRuns();
  }

  async requestExact(): Promise<void> {
    if (!this.detail || !this.selectedEventKey || !this.canRequestSimulation) return;
    const detail = this.detail;
    const eventKey = this.selectedEventKey;
    const sequence = ++this.actionSequence;
    this.pendingAction = 'exact';
    const result = await this.bridge.requestExactSimulation({
      config_id: detail.config_id,
      expected_revision: detail.config_revision,
      request_id: requestId('exact'),
      canonical_event_key: eventKey,
    });
    if (
      sequence !== this.actionSequence || this.detail?.config_id !== detail.config_id ||
      this.detail.config_revision !== detail.config_revision
    ) return;
    this.pendingAction = null;
    if (!result.ok) this.surfaceErrors.action = result.error.code;
    else if (!simulationProjectionMatchesDetail(result.value, detail, 'exact')) {
      this.surfaceErrors.exact = 'SNIPING_RESPONSE_INTEGRITY';
      return;
    } else delete this.surfaceErrors.action;
    await Promise.all([this.refreshEvents(), this.refreshExactRuns()]);
  }

  shadowPolicyValue(): SnipingShadowPolicy | null {
    const maxEvents = Number(this.shadowPolicy.maxEvents);
    const evidence = Number(this.shadowPolicy.evidenceTtlSeconds);
    const checkpoints = this.shadowPolicy.checkpointBlocks
      .split(/[\s,]+/).filter(Boolean).map(Number);
    if (
      !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 500 ||
      !Number.isInteger(evidence) || evidence < 60 || evidence > 86_400 ||
      checkpoints.length < 1 || checkpoints.length > 8 ||
      checkpoints.some((value) => !Number.isInteger(value) || value < 1 || value > 100_000) ||
      checkpoints.some((value, index) => index > 0 && value <= checkpoints[index - 1])
    ) return null;
    return { max_events: maxEvents, checkpoint_blocks: checkpoints, evidence_ttl_seconds: evidence };
  }

  async requestNewShadow(): Promise<void> { this.shadowRetryUncertain = false; await this.requestShadow(true); }

  async retryShadow(): Promise<void> { if (this.shadowRetryAvailable) await this.requestShadow(false); }

  private async requestShadow(newRun: boolean): Promise<void> {
    const policy = this.shadowPolicyValue();
    if (!this.detail || !policy || !this.canRequestSimulation) return;
    const detail = this.detail;
    const fingerprint = JSON.stringify({
      config_id: detail.config_id,
      config_revision: detail.config_revision,
      policy,
    });
    if (newRun || !this.shadowRequestId || this.shadowFingerprint !== fingerprint) {
      this.shadowRequestId = requestId('shadow');
      this.shadowFingerprint = fingerprint;
    }
    const sequence = ++this.actionSequence;
    this.pendingAction = 'shadow';
    const result = await this.bridge.requestShadowSimulation({
      config_id: detail.config_id,
      expected_revision: detail.config_revision,
      request_id: this.shadowRequestId,
      shadow_policy: policy,
    });
    if (
      sequence !== this.actionSequence || this.detail?.config_id !== detail.config_id ||
      this.detail.config_revision !== detail.config_revision
    ) return;
    this.pendingAction = null;
    if (!result.ok) {
      this.surfaceErrors.action = result.error.code;
      this.shadowRetryUncertain = result.error.retryable;
    } else if (!simulationProjectionMatchesDetail(result.value, detail, 'shadow')) {
      this.surfaceErrors.shadow = 'SNIPING_RESPONSE_INTEGRITY';
      return;
    } else {
      delete this.surfaceErrors.action;
      this.shadowRetryUncertain = false;
    }
    await this.refreshShadowRuns();
  }

  async refreshActivity(preserveRetainedRows = true): Promise<void> {
    const sequence = ++this.activitySequence;
    this.activityLoading = true;
    const result = await this.bridge.listActivity({
      page_size: 50,
      ...(this.activityFilter.product ? { product: this.activityFilter.product } : {}),
      ...(this.activityFilter.outcome ? { outcome: this.activityFilter.outcome } : {}),
      ...(this.activityFilter.chain ? { chain: this.activityFilter.chain } : {}),
      ...(this.activityFilter.search.trim() ? { search_text: this.activityFilter.search.trim() } : {}),
    });
    if (sequence !== this.activitySequence) return;
    this.activityLoading = false;
    if (!result.ok) {
      this.surfaceErrors.activity = result.error.code;
      if (!preserveRetainedRows) {
        this.activity = [];
        this.activityCursor = null;
        this.selectedActivity = null;
      }
      return;
    }
    delete this.surfaceErrors.activity;
    this.activity = result.value.list;
    this.activityCursor = result.value.next_cursor;
    if (!this.selectedActivity ||
      !this.activity.some((row) => row.activity_id === this.selectedActivity?.activity_id)) {
      this.selectedActivity = null;
    }
  }

  async loadMoreActivity(): Promise<void> {
    if (this.activityLoading) return;
    const sequence = ++this.activitySequence;
    this.activityLoading = true;
    const initialCursor = this.activityCursor;
    const input: SnipingActivityListInput = {
      page_size: 50,
      ...(this.activityFilter.product ? { product: this.activityFilter.product } : {}),
      ...(this.activityFilter.outcome ? { outcome: this.activityFilter.outcome } : {}),
      ...(this.activityFilter.chain ? { chain: this.activityFilter.chain } : {}),
      ...(this.activityFilter.search.trim() ? { search_text: this.activityFilter.search.trim() } : {}),
      ...(this.activityCursor ? { cursor: this.activityCursor } : {}),
    };
    const result = await this.bridge.listActivity(input);
    if (sequence !== this.activitySequence) return;
    this.activityLoading = false;
    if (!result.ok) {
      this.surfaceErrors.activity = result.error.code;
      return;
    }
    delete this.surfaceErrors.activity;
    this.activity = initialCursor ? [...this.activity, ...result.value.list] : result.value.list;
    this.activityCursor = result.value.next_cursor;
  }

  async setActivityFilter(input: Partial<SnipingStore['activityFilter']>): Promise<void> {
    this.activityFilter = { ...this.activityFilter, ...input };
    this.activitySequence += 1;
    this.activityLoading = false;
    this.activity = [];
    this.activityCursor = null;
    this.selectedActivity = null;
    await this.refreshActivity(false);
  }

  selectActivity(row: SnipingActivityRow | null): void { this.selectedActivity = row; }
  private resetSimulationState(): void {
    this.invalidateSimulationReads();
    this.eventPage = 1;
    this.exactPage = 1;
    this.shadowPage = 1;
    this.events = [];
    this.eventTotal = 0;
    this.selectedEventKey = null;
    this.exactRuns = [];
    this.exactTotal = 0;
    this.shadowRuns = [];
    this.shadowTotal = 0;
    this.shadowRequestId = null;
    this.shadowFingerprint = null;
    this.shadowRetryUncertain = false;
    this.latestEvidence.clear();
  }

  private invalidateSimulationReads(): void {
    this.eventSequence += 1;
    this.exactSequence += 1;
    this.shadowSequence += 1;
    this.runtimeSequence += 1;
  }

  private persistedDetail(): SnipingConfigDetail | null {
    return this.detail && this.detail.config_id !== '0' ? this.detail : null;
  }

  private isCurrentSimulationRead(
    detail: SnipingConfigDetail,
    sequence: number,
    currentSequence: number,
  ): boolean {
    return sequence === currentSequence && this.detail?.config_id === detail.config_id &&
      this.detail.config_revision === detail.config_revision;
  }

  private sameDetail(detail: SnipingConfigDetail): boolean {
    return this.detail?.config_id === detail.config_id &&
      this.detail.config_revision === detail.config_revision;
  }

  private currentShadowFingerprint(): string | null {
    const policy = this.shadowPolicyValue();
    if (!this.detail || this.detail.config_id === '0' || !policy) return null;
    return JSON.stringify({
      config_id: this.detail.config_id,
      config_revision: this.detail.config_revision,
      policy,
    });
  }

  private async refreshConflictFacts(configId: string, draftName: string): Promise<void> {
    const sequence = ++this.detailSequence;
    this.detailFreshness = null;
    const result = await this.bridge.getConfig({ config_id: configId });
    if (sequence !== this.detailSequence || this.detail?.config_id !== configId) return;
    if (!result.ok) {
      this.surfaceErrors.detail = result.error.code;
      return;
    }
    delete this.surfaceErrors.detail;
    const provenanceChanged = this.draftProvenance !== this.provenanceKey(result.value);
    this.adoptDetailRevision({ ...result.value, name: draftName });
    this.detailFreshness = this.provenanceKey(result.value);
    this.revisionConflict = provenanceChanged;
    this.validationHash = null;
    if (provenanceChanged) {
      this.shadowRequestId = null;
      this.shadowFingerprint = null;
      this.shadowRetryUncertain = false;
    }
    await this.refreshSimulation();
  }

  private adoptDetailRevision(next: SnipingConfigDetail): void {
    const revisionChanged = this.detail?.config_id !== next.config_id ||
      this.detail.config_revision !== next.config_revision;
    this.detail = next;
    this.runtimes = next.runtimes;
    if (revisionChanged) this.resetSimulationState();
  }

  private provenanceKey(detail: SnipingConfigDetail): string {
    return [
      detail.component_id,
      detail.component_version,
      detail.schema_hash,
      detail.config_revision,
    ].join(':');
  }
}
