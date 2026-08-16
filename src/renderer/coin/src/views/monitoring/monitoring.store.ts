import type {
  MonitoringBridge,
  MonitoringDetailProjection,
  MonitoringListItem,
  MonitoringSampleProjection
} from '@shared/monitoring/monitoringBridge.type';
import {
  blankMonitoringDraft,
  type MonitoringDraft,
  validateMonitoringDraft
} from './monitoringDraft.service';
import {
  canRetainMonitoringSamples,
  monitoringSampleIdentity,
  retainsMonitoringRevisionHistory,
  sameMonitoringMutationIdentity,
  sameMonitoringRevisionIdentity,
  type MonitoringSampleIdentity
} from './monitoringIntegrity.service';
import { MonitoringAnomalyStore } from './monitoringAnomaly.store';
import { monitoringSamplePageMatches } from './monitoringPaging.service';
import {
  monitoringCollectionDisplayState,
  monitoringDetailCurrent,
  monitoringSampleDisplay,
  monitoringWatchDisplay,
  monitoringWatchListDisplay
} from './monitoringPresentation.service';

type MonitoringPhase = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable';
type MonitoringDialogMode = 'create' | 'edit';
type MonitoringSampleFailure = { operation: 'initial' | 'older'; before: string | null };
type MonitoringListIntent = { page: number; search: string };
const maximumRetainedSamples = 8_640;

export class MonitoringStore extends MonitoringAnomalyStore {
  phase: MonitoringPhase = 'idle';
  watches: MonitoringListItem[] = [];
  watchesLoading = false;
  workspaceRefreshLoading = false;
  detailLoading = false;
  watchTotal = 0;
  watchPage = 1;
  watchPageSize = 20;
  watchSearch = '';
  appliedWatchSearch = '';
  watchListStaleSince: string | null = null;
  listIntent: MonitoringListIntent | null = null;
  failedListIntent: MonitoringListIntent | null = null;
  selectedConfigId: string | null = null;
  detail: MonitoringDetailProjection | null = null;
  detailFresh = false;
  mobileDetail = false;
  samples: MonitoringSampleProjection[] = [];
  samplesRevision: number | null = null;
  samplesCursor: string | null = null;
  samplesLoading = false;
  samplesInitialPartial = false;
  samplesIdentity: MonitoringSampleIdentity | null = null;
  samplesFailedRequest: MonitoringSampleFailure | null = null;
  samplesPendingOperation: 'initial' | 'older' | null = null;
  samplesStaleSince: string | null = null;
  dialogOpen = false;
  dialogMode: MonitoringDialogMode = 'create';
  draft: MonitoringDraft = blankMonitoringDraft();
  draftError: string | null = null;
  duplicateExistingId: string | null = null;
  dialogActionError: string | null = null;
  revisionConflict = false;
  pendingAction: 'save' | 'start' | 'stop' | null = null;
  detailStaleSince: string | null = null;
  private listSequence = 0;
  private detailSequence = 0;
  private sampleSequence = 0;
  private actionSequence = 0;

  constructor(bridge: MonitoringBridge) {
    super(bridge);
  }

  get selectedWatch(): MonitoringListItem | null {
    return this.watches.find((watch) => watch.config_id === this.selectedConfigId) ?? null;
  }

  get selectedDetail(): MonitoringDetailProjection | null {
    return this.detail?.config_id === this.selectedConfigId ? this.detail : null;
  }

  get isMonitoring(): boolean {
    return this.selectedDetail?.status === 'Monitoring';
  }

  get canMutate(): boolean {
    return Boolean(
      this.selectedDetail && this.detailFresh && !this.pendingAction && !this.revisionConflict
    );
  }

  get canEdit(): boolean {
    return this.canMutate && !this.isMonitoring;
  }

  get dialogRevisionConflict(): boolean {
    return this.dialogMode === 'edit' && this.revisionConflict;
  }

  get watchPages(): number {
    return Math.max(1, Math.ceil(this.watchTotal / this.watchPageSize));
  }

  get watchDisplay() {
    return monitoringWatchDisplay(this.samples, this.samplesRevision, this.selectedDetail);
  }

  get sampleViewState() {
    return monitoringCollectionDisplayState(
      this.samples.length,
      this.samplesLoading,
      this.errors.samples
    );
  }

  get watchDisplays() {
    return this.watches.map(monitoringWatchListDisplay);
  }

  get sampleDisplays() {
    return this.samples.map(monitoringSampleDisplay);
  }

  async initialize(): Promise<void> {
    if (this.phase === 'idle') await this.refreshWatches();
  }

  async refreshWatches(
    targetPage = this.watchPage,
    targetSearch = this.appliedWatchSearch
  ): Promise<void> {
    const sequence = ++this.listSequence;
    this.watchesLoading = true;
    if (this.phase === 'idle') this.phase = 'loading';
    const search = targetSearch.trim();
    this.listIntent = { page: targetPage, search };
    const result = await this.bridge.list({
      page: targetPage,
      page_size: this.watchPageSize,
      ...(search ? { search_text: search } : {})
    });
    if (sequence !== this.listSequence) return;
    this.watchesLoading = false;
    this.listIntent = null;
    if (
      !result.ok ||
      result.value.page !== targetPage ||
      result.value.page_size !== this.watchPageSize ||
      result.value.list.some((next) => {
        const prior =
          this.watches.find((watch) => watch.config_id === next.config_id) ??
          (this.detail?.config_id === next.config_id ? this.detail : null);
        return (
          prior?.config_revision === next.config_revision &&
          !sameMonitoringRevisionIdentity(next, prior)
        );
      })
    ) {
      this.errors.list = result.ok ? 'MONITORING_RESPONSE_INTEGRITY' : result.error.code;
      this.failedListIntent = { page: targetPage, search };
      if (!this.watches.length) this.phase = 'unavailable';
      else if (!this.watchListStaleSince) this.watchListStaleSince = new Date().toISOString();
      return;
    }
    const lastPage = Math.max(1, Math.ceil(result.value.total / this.watchPageSize));
    if (!result.value.list.length && targetPage > lastPage) {
      await this.refreshWatches(lastPage, search);
      return;
    }
    delete this.errors.list;
    this.failedListIntent = null;
    this.watches = result.value.list;
    this.watchTotal = result.value.total;
    this.watchPage = targetPage;
    this.appliedWatchSearch = search;
    this.watchListStaleSince = null;
    this.phase = this.watches.length ? 'ready' : 'empty';
    if (
      this.selectedConfigId &&
      !this.watches.some((watch) => watch.config_id === this.selectedConfigId)
    ) {
      this.mobileDetail = Boolean(this.detail);
    }
  }

  async refreshSelectedScope(scope: 'watches' | 'anomalies'): Promise<void> {
    if (scope === 'anomalies') {
      await this.initializeAnomalies();
      return;
    }
    if (this.workspaceRefreshLoading) return;
    this.workspaceRefreshLoading = true;
    try {
      await this.refreshWatches();
      if (this.selectedConfigId) await this.selectWatch(this.selectedConfigId, false);
    } finally {
      this.workspaceRefreshLoading = false;
    }
  }

  setSearch(value: string): void {
    this.watchSearch = value;
  }

  async applySearch(): Promise<void> {
    await this.refreshWatches(1, this.watchSearch);
  }

  async clearSearch(): Promise<void> {
    this.watchSearch = '';
    await this.applySearch();
  }

  async retryWatches(): Promise<void> {
    const intent = this.failedListIntent;
    await this.refreshWatches(
      intent?.page ?? this.watchPage,
      intent?.search ?? this.appliedWatchSearch
    );
  }

  async setWatchPage(page: number): Promise<void> {
    if (!Number.isSafeInteger(page) || page < 1 || page > this.watchPages) return;
    await this.refreshWatches(page, this.appliedWatchSearch);
  }

  async selectWatch(configId: string, switchPane = true): Promise<void> {
    this.actionSequence += 1;
    this.pendingAction = null;
    const sequence = ++this.detailSequence;
    const prior = this.detail?.config_id === configId ? this.detail : null;
    const listRow = this.watches.find((watch) => watch.config_id === configId) ?? null;
    this.sampleSequence += 1;
    this.samplesLoading = false;
    this.samplesPendingOperation = null;
    this.detailFresh = false;
    this.detailLoading = true;
    this.selectedConfigId = configId;
    if (switchPane) this.mobileDetail = true;
    delete this.errors.detail;
    const result = await this.bridge.get({ config_id: configId });
    if (sequence !== this.detailSequence) return;
    if (
      !result.ok ||
      result.value.config_id !== configId ||
      [prior, listRow].some(
        (candidate) =>
          candidate?.config_revision === result.value.config_revision &&
          !sameMonitoringRevisionIdentity(result.value, candidate)
      ) ||
      (prior !== null && !retainsMonitoringRevisionHistory(result.value, prior))
    ) {
      this.detailLoading = false;
      this.errors.detail = result.ok ? 'MONITORING_RESPONSE_INTEGRITY' : result.error.code;
      if (this.detail?.config_id === configId) this.markDetailStale();
      return;
    }
    delete this.errors.detail;
    const retainSamples = canRetainMonitoringSamples(
      this.detail,
      result.value,
      this.samplesRevision,
      this.samplesIdentity
    );
    this.adoptDetail(result.value, retainSamples);
    await this.refreshInitialSamples();
  }

  backToWatches(): void {
    this.mobileDetail = false;
  }

  openCreate(): void {
    this.dialogMode = 'create';
    this.draft = blankMonitoringDraft();
    this.resetDialogFacts();
    this.dialogActionError = null;
    this.dialogOpen = true;
  }

  openEdit(): void {
    const detail = this.selectedDetail;
    if (!this.canEdit || !detail) return;
    this.dialogMode = 'edit';
    this.draft = {
      name: detail.name,
      tokenAddress: detail.token_address,
      threshold: detail.zscore_threshold.toFixed(2)
    };
    this.resetDialogFacts();
    this.dialogActionError = null;
    this.dialogOpen = true;
  }

  closeDialog(): void {
    if (this.pendingAction === 'save') return;
    this.dialogOpen = false;
    this.dialogActionError = null;
    this.resetDialogFacts();
  }

  setDraft(field: keyof MonitoringDraft, value: string): void {
    this.draft = { ...this.draft, [field]: value };
    this.draftError = null;
    this.duplicateExistingId = null;
    this.dialogActionError = null;
  }

  validateDraft() {
    const result = validateMonitoringDraft(
      this.draft,
      this.selectedDetail,
      this.dialogMode === 'edit',
      this.canEdit
    );
    this.draftError = result.ok ? null : result.error;
    return result.ok ? result.input : null;
  }

  async saveDraft(): Promise<void> {
    const input = this.validateDraft();
    if (!input || this.pendingAction) return;
    const editedDetail =
      input.config_id !== undefined && this.selectedDetail?.config_id === input.config_id
        ? this.selectedDetail
        : null;
    const sequence = ++this.actionSequence;
    this.pendingAction = 'save';
    const result = await this.bridge.save(input);
    if (sequence !== this.actionSequence) return;
    this.pendingAction = null;
    if (!result.ok) {
      this.dialogActionError = result.error.code;
      if (result.error.code === 'SNIPING_MONITOR_ASSET_CONFLICT')
        await this.resolveDuplicate(input.token_address);
      if (editedDetail && result.error.code === 'SNIPING_CONFIG_REVISION_STALE') {
        this.revisionConflict = true;
        this.detailFresh = false;
      }
      return;
    }
    const expectedName = input.name ?? `BSC ${input.token_address}`;
    if (
      (input.config_id !== undefined && result.value.config_id !== input.config_id) ||
      result.value.config_revision !== input.expected_revision + 1 ||
      result.value.status !== 'Stopped' ||
      result.value.desired_state !== 'disabled' ||
      result.value.token_address !== input.token_address ||
      result.value.asset_key !== `eip155:56:${input.token_address}` ||
      result.value.name !== expectedName ||
      result.value.zscore_threshold !== input.zscore_threshold ||
      result.value.primary_region !== 'sg' ||
      result.value.standby_region !== 'jp' ||
      result.value.latest !== null ||
      result.value.readiness.state !== 'WARMING' ||
      result.value.readiness.baseline_count !== 0 ||
      (editedDetail !== null && !retainsMonitoringRevisionHistory(result.value, editedDetail))
    ) {
      this.dialogActionError = 'MONITORING_RESPONSE_INTEGRITY';
      if (editedDetail && this.selectedDetail === editedDetail) {
        this.errors.action = 'MONITORING_RESPONSE_INTEGRITY';
        this.detailFresh = false;
        this.revisionConflict = true;
        this.markDetailStale();
      }
      return;
    }
    this.dialogActionError = null;
    delete this.errors.action;
    this.dialogOpen = false;
    this.resetDialogFacts();
    this.adoptDetail(result.value);
    this.mobileDetail = true;
    await this.refreshWatches();
    await this.refreshInitialSamples();
  }

  async openExistingDuplicate(): Promise<void> {
    const id = this.duplicateExistingId;
    if (!id) return;
    this.dialogOpen = false;
    await this.selectWatch(id);
  }

  async reloadServerVersion(): Promise<void> {
    if (!this.detail) return;
    const prior = this.detail;
    const configId = this.detail.config_id;
    const sequence = ++this.detailSequence;
    this.sampleSequence += 1;
    this.samplesLoading = false;
    this.detailFresh = false;
    this.detailLoading = true;
    const result = await this.bridge.get({ config_id: configId });
    if (
      sequence !== this.detailSequence ||
      this.detail !== prior ||
      this.selectedConfigId !== configId
    )
      return;
    if (
      !result.ok ||
      result.value.config_id !== configId ||
      !retainsMonitoringRevisionHistory(result.value, prior) ||
      (result.value.config_revision === prior.config_revision &&
        !sameMonitoringRevisionIdentity(result.value, prior))
    ) {
      this.detailLoading = false;
      this.errors.detail = result.ok ? 'MONITORING_RESPONSE_INTEGRITY' : result.error.code;
      this.markDetailStale();
      return;
    }
    delete this.errors.detail;
    this.adoptDetail(result.value);
    if (this.dialogOpen && this.dialogMode === 'edit' && !this.canEdit) {
      this.dialogOpen = false;
      this.dialogActionError = null;
      this.resetDialogFacts();
    } else
      this.draft = {
        name: result.value.name,
        tokenAddress: result.value.token_address,
        threshold: result.value.zscore_threshold.toFixed(2)
      };
    this.revisionConflict = false;
    delete this.errors.action;
    await this.refreshInitialSamples();
  }

  async setMonitoring(enabled: boolean): Promise<void> {
    if (!this.detail || !this.canMutate || enabled === this.isMonitoring) return;
    const detail = this.detail;
    const sequence = ++this.actionSequence;
    this.pendingAction = enabled ? 'start' : 'stop';
    const result = enabled
      ? await this.bridge.start({
          config_id: detail.config_id,
          expected_revision: detail.config_revision
        })
      : await this.bridge.stop({
          config_id: detail.config_id,
          expected_revision: detail.config_revision
        });
    if (
      sequence !== this.actionSequence ||
      !monitoringDetailCurrent(this.detail, detail.config_id, detail.config_revision)
    ) {
      return;
    }
    this.pendingAction = null;
    if (!result.ok) {
      this.errors.action = result.error.code;
      if (result.error.code === 'SNIPING_CONFIG_REVISION_STALE') {
        this.revisionConflict = true;
        this.detailFresh = false;
      }
      return;
    }
    if (
      !sameMonitoringMutationIdentity(result.value, detail) ||
      result.value.config_revision !== detail.config_revision + 1 ||
      result.value.status !== (enabled ? 'Monitoring' : 'Stopped') ||
      result.value.latest !== null ||
      result.value.desired_state !== (enabled ? 'armed' : 'disabled') ||
      result.value.readiness.state !== 'WARMING' ||
      result.value.readiness.baseline_count !== 0
    ) {
      this.errors.action = 'MONITORING_RESPONSE_INTEGRITY';
      this.detailFresh = false;
      this.revisionConflict = true;
      this.markDetailStale();
      return;
    }
    delete this.errors.action;
    this.adoptDetail(result.value);
    await this.refreshWatches();
    await this.refreshInitialSamples();
  }

  async setSamplesRevision(revision: number): Promise<void> {
    if (!this.detail?.available_revisions.some((item) => item.revision === revision)) return;
    this.samplesRevision = revision;
    this.samples = [];
    this.samplesCursor = null;
    this.samplesInitialPartial = false;
    this.samplesIdentity = null;
    this.samplesFailedRequest = null;
    await this.refreshInitialSamples();
  }

  async refreshInitialSamples(): Promise<void> {
    const detail = this.selectedDetail;
    const revision = this.samplesRevision ?? detail?.config_revision ?? null;
    if (!detail || revision === null) return;
    const sequence = ++this.sampleSequence;
    this.samplesLoading = true;
    this.samplesPendingOperation = 'initial';
    this.samplesInitialPartial = false;
    this.samplesFailedRequest = null;
    delete this.errors.samples;
    const first = await this.bridge.listSamples({
      config_id: detail.config_id,
      config_revision: revision,
      page_size: 250
    });
    if (!this.currentSampleIntent(sequence, detail, revision)) return;
    if (!first.ok) {
      this.samplesLoading = false;
      this.samplesPendingOperation = null;
      this.errors.samples = first.error.code;
      this.samplesFailedRequest = { operation: 'initial', before: null };
      if (this.samples.length && !this.samplesStaleSince)
        this.samplesStaleSince = new Date().toISOString();
      return;
    }
    if (
      !monitoringSamplePageMatches({
        rows: first.value.list,
        detail,
        revision,
        before: null,
        next: first.value.next_before_bucket_sequence,
        pageSize: 250,
        identity: this.samplesIdentity
      })
    ) {
      this.samplesLoading = false;
      this.samplesPendingOperation = null;
      this.errors.samples = 'MONITORING_RESPONSE_INTEGRITY';
      this.samplesFailedRequest = { operation: 'initial', before: null };
      if (this.samples.length && !this.samplesStaleSince)
        this.samplesStaleSince = new Date().toISOString();
      return;
    }
    this.samples = first.value.list;
    this.samplesIdentity = first.value.list[0]
      ? monitoringSampleIdentity(first.value.list[0])
      : null;
    this.samplesCursor = first.value.next_before_bucket_sequence;
    delete this.errors.samples;
    if (!this.samplesCursor) {
      this.samplesLoading = false;
      this.samplesPendingOperation = null;
      this.samplesStaleSince = null;
      return;
    }
    this.samplesPendingOperation = 'older';
    const secondCursor = this.samplesCursor;
    const second = await this.bridge.listSamples({
      config_id: detail.config_id,
      config_revision: revision,
      before_bucket_sequence: secondCursor,
      page_size: 250
    });
    if (!this.currentSampleIntent(sequence, detail, revision)) return;
    this.samplesLoading = false;
    this.samplesPendingOperation = null;
    if (!second.ok) {
      this.samplesInitialPartial = true;
      this.errors.samples = second.error.code;
      this.samplesFailedRequest = { operation: 'older', before: secondCursor };
      this.samplesStaleSince ??= new Date().toISOString();
      return;
    }
    if (
      !monitoringSamplePageMatches({
        rows: second.value.list,
        detail,
        revision,
        before: secondCursor,
        next: second.value.next_before_bucket_sequence,
        pageSize: 250,
        identity: this.samplesIdentity,
        existing: this.samples
      })
    ) {
      this.samplesInitialPartial = true;
      this.errors.samples = 'MONITORING_RESPONSE_INTEGRITY';
      this.samplesFailedRequest = { operation: 'older', before: secondCursor };
      this.samplesStaleSince ??= new Date().toISOString();
      return;
    }
    this.samples = [...this.samples, ...second.value.list];
    this.samplesCursor = second.value.next_before_bucket_sequence;
    this.samplesInitialPartial = false;
    this.samplesFailedRequest = null;
    this.samplesStaleSince = null;
    delete this.errors.samples;
  }

  async loadOlderSamples(): Promise<void> {
    const detail = this.selectedDetail;
    const revision = this.samplesRevision;
    const cursor = this.samplesCursor;
    if (!detail || revision === null || !cursor || this.samplesLoading) return;
    const sequence = ++this.sampleSequence;
    this.samplesLoading = true;
    this.samplesPendingOperation = 'older';
    this.samplesFailedRequest = null;
    delete this.errors.samples;
    const result = await this.bridge.listSamples({
      config_id: detail.config_id,
      config_revision: revision,
      before_bucket_sequence: cursor,
      page_size: 250
    });
    if (!this.currentSampleIntent(sequence, detail, revision)) return;
    this.samplesLoading = false;
    this.samplesPendingOperation = null;
    if (!result.ok) {
      this.errors.samples = result.error.code;
      this.samplesFailedRequest = { operation: 'older', before: cursor };
      this.samplesStaleSince ??= new Date().toISOString();
      return;
    }
    if (
      this.samples.length + result.value.list.length > maximumRetainedSamples ||
      !monitoringSamplePageMatches({
        rows: result.value.list,
        detail,
        revision,
        before: cursor,
        next: result.value.next_before_bucket_sequence,
        pageSize: 250,
        identity: this.samplesIdentity,
        existing: this.samples
      })
    ) {
      this.errors.samples = 'MONITORING_RESPONSE_INTEGRITY';
      this.samplesFailedRequest = { operation: 'older', before: cursor };
      this.samplesStaleSince ??= new Date().toISOString();
      return;
    }
    this.samples = [...this.samples, ...result.value.list];
    this.samplesCursor = result.value.next_before_bucket_sequence;
    this.samplesInitialPartial = false;
    this.samplesFailedRequest = null;
    this.samplesStaleSince = null;
    delete this.errors.samples;
  }

  async retrySamples(): Promise<void> {
    const failure = this.samplesFailedRequest;
    if (failure?.operation === 'older' && failure.before === this.samplesCursor) {
      await this.loadOlderSamples();
      return;
    }
    await this.refreshInitialSamples();
  }

  private resetDialogFacts(): void {
    this.draftError = null;
    this.duplicateExistingId = null;
  }

  private async resolveDuplicate(tokenAddress: string): Promise<void> {
    const result = await this.bridge.list({ page: 1, page_size: 100, search_text: tokenAddress });
    if (!result.ok || this.draft.tokenAddress.trim() !== tokenAddress) return;
    this.duplicateExistingId =
      result.value.list.find((item) => item.token_address === tokenAddress)?.config_id ?? null;
  }

  private adoptDetail(detail: MonitoringDetailProjection, retainSamples = false): void {
    this.selectedConfigId = detail.config_id;
    this.detail = detail;
    this.detailFresh = true;
    this.detailLoading = false;
    delete this.errors.detail;
    delete this.errors.action;
    if (!retainSamples) {
      this.samplesRevision = detail.config_revision;
      this.samples = [];
      this.samplesCursor = null;
      this.samplesLoading = false;
      this.samplesPendingOperation = null;
      this.samplesInitialPartial = false;
      this.samplesIdentity = null;
      this.samplesFailedRequest = null;
      this.samplesStaleSince = null;
      delete this.errors.samples;
    }
    this.revisionConflict = false;
    this.detailStaleSince = null;
  }

  private currentSampleIntent(
    sequence: number,
    detail: MonitoringDetailProjection,
    revision: number
  ): boolean {
    return (
      sequence === this.sampleSequence &&
      this.detail === detail &&
      this.samplesRevision === revision
    );
  }

  private markDetailStale(): void {
    if (!this.detailStaleSince) this.detailStaleSince = new Date().toISOString();
  }
}
