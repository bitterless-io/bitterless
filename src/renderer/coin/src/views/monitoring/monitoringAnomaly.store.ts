import type {
  MonitoringAnomalyCursor,
  MonitoringAnomalyFilterState,
  MonitoringBridge,
  MonitoringListItem,
  MonitoringSampleProjection
} from '@shared/monitoring/monitoringBridge.type';
import { monitoringAnomalyPageMatches } from './monitoringPaging.service';
import {
  monitoringAnomalyDisplay,
  monitoringCollectionDisplayState
} from './monitoringPresentation.service';

export type MonitoringErrorScope =
  | 'list'
  | 'detail'
  | 'samples'
  | 'anomalies'
  | 'anomalyOptions'
  | 'action';

export class MonitoringAnomalyStore {
  errors: Partial<Record<MonitoringErrorScope, string>> = {};
  anomalies: MonitoringSampleProjection[] = [];
  anomalyCursor: MonitoringAnomalyCursor | null = null;
  anomalyConfigId = '';
  anomalyStates: MonitoringAnomalyFilterState[] = [];
  anomalyLoading = false;
  anomalyOptionsLoading = false;
  anomalyWatchOptions: MonitoringListItem[] = [];
  anomaliesInitialized = false;
  anomaliesStaleSince: string | null = null;
  anomalyFailedCursor: MonitoringAnomalyCursor | null = null;
  selectedAnomaly: MonitoringSampleProjection | null = null;
  private anomalySequence = 0;
  private anomalyOptionSequence = 0;

  constructor(protected readonly bridge: MonitoringBridge) {}

  get anomalyDisplays() {
    return this.anomalies.map(monitoringAnomalyDisplay);
  }

  get anomalyViewState() {
    return monitoringCollectionDisplayState(
      this.anomalies.length,
      this.anomalyLoading,
      this.errors.anomalies
    );
  }

  get selectedAnomalyDisplay() {
    return this.selectedAnomaly ? monitoringAnomalyDisplay(this.selectedAnomaly) : null;
  }

  async refreshAnomalies(preserveRows: boolean): Promise<void> {
    const sequence = ++this.anomalySequence;
    this.anomalyLoading = true;
    this.anomalyFailedCursor = null;
    delete this.errors.anomalies;
    const result = await this.bridge.listAnomalies({
      page_size: 50,
      ...(this.anomalyConfigId ? { config_id: this.anomalyConfigId } : {}),
      ...(this.anomalyStates.length ? { states: [...this.anomalyStates] } : {})
    });
    if (sequence !== this.anomalySequence) return;
    this.anomalyLoading = false;
    if (!result.ok) {
      this.errors.anomalies = result.error.code;
      if (this.anomalies.length && !this.anomaliesStaleSince)
        this.anomaliesStaleSince = new Date().toISOString();
      if (!preserveRows) this.clearAnomalies();
      return;
    }
    if (
      !monitoringAnomalyPageMatches({
        rows: result.value.list,
        before: null,
        next: result.value.next_cursor,
        pageSize: 50,
        configId: this.anomalyConfigId,
        states: this.anomalyStates
      })
    ) {
      this.errors.anomalies = 'MONITORING_RESPONSE_INTEGRITY';
      if (this.anomalies.length && !this.anomaliesStaleSince)
        this.anomaliesStaleSince = new Date().toISOString();
      if (!preserveRows) this.clearAnomalies();
      return;
    }
    delete this.errors.anomalies;
    this.anomalies = result.value.list;
    this.anomalyCursor = result.value.next_cursor;
    this.selectedAnomaly = null;
    this.anomaliesInitialized = true;
    this.anomaliesStaleSince = null;
  }

  async initializeAnomalies(): Promise<void> {
    await Promise.all([this.refreshAnomalyWatchOptions(), this.refreshAnomalies(true)]);
  }

  async refreshAnomalyWatchOptions(): Promise<void> {
    const sequence = ++this.anomalyOptionSequence;
    this.anomalyOptionsLoading = true;
    const result = await this.bridge.list({ page: 1, page_size: 100 });
    if (sequence !== this.anomalyOptionSequence) return;
    this.anomalyOptionsLoading = false;
    if (!result.ok || result.value.page !== 1 || result.value.page_size !== 100) {
      this.errors.anomalyOptions = result.ok ? 'MONITORING_RESPONSE_INTEGRITY' : result.error.code;
      return;
    }
    delete this.errors.anomalyOptions;
    this.anomalyWatchOptions = result.value.list;
  }

  async setAnomalyFilter(configId: string, states: MonitoringAnomalyFilterState[]): Promise<void> {
    this.anomalyConfigId = configId;
    this.anomalyStates = [...states];
    this.anomalySequence += 1;
    this.clearAnomalies();
    this.anomalyLoading = false;
    delete this.errors.anomalies;
    await this.refreshAnomalies(false);
  }

  async loadOlderAnomalies(): Promise<void> {
    const cursor = this.anomalyCursor;
    if (!cursor || this.anomalyLoading) return;
    const sequence = ++this.anomalySequence;
    this.anomalyLoading = true;
    delete this.errors.anomalies;
    const result = await this.bridge.listAnomalies({
      page_size: 50,
      ...(this.anomalyConfigId ? { config_id: this.anomalyConfigId } : {}),
      ...(this.anomalyStates.length ? { states: [...this.anomalyStates] } : {}),
      cursor
    });
    if (sequence !== this.anomalySequence) return;
    this.anomalyLoading = false;
    if (!result.ok) {
      this.errors.anomalies = result.error.code;
      this.anomalyFailedCursor = cursor;
      this.anomaliesStaleSince ??= new Date().toISOString();
      return;
    }
    if (
      !monitoringAnomalyPageMatches({
        rows: result.value.list,
        before: cursor,
        next: result.value.next_cursor,
        pageSize: 50,
        configId: this.anomalyConfigId,
        states: this.anomalyStates,
        existing: this.anomalies
      })
    ) {
      this.errors.anomalies = 'MONITORING_RESPONSE_INTEGRITY';
      this.anomalyFailedCursor = cursor;
      this.anomaliesStaleSince ??= new Date().toISOString();
      return;
    }
    this.anomalies = [...this.anomalies, ...result.value.list];
    this.anomalyCursor = result.value.next_cursor;
    this.anomalyFailedCursor = null;
    this.anomaliesStaleSince = null;
    delete this.errors.anomalies;
  }

  selectAnomaly(sample: MonitoringSampleProjection | null): void {
    this.selectedAnomaly = sample;
  }

  async retryAnomalies(): Promise<void> {
    if (this.anomalyFailedCursor) await this.loadOlderAnomalies();
    else await this.refreshAnomalies(true);
  }

  private clearAnomalies(): void {
    this.anomalies = [];
    this.anomalyCursor = null;
    this.selectedAnomaly = null;
    this.anomaliesStaleSince = null;
    this.anomalyFailedCursor = null;
  }
}
