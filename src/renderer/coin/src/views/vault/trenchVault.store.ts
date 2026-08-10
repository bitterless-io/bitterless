import type {
  TrenchAnalysisListResult,
  TrenchCaAnalysisSummary,
  TrenchDataChangedEvent,
  TrenchIndexWallet,
  TrenchIndexWalletDetail,
  TrenchIndexWalletSource,
  TrenchIndexWalletListResult,
  TrenchNegativeWalletListResult,
  TrenchNegativeWalletSummary,
  TrenchStoredIssue,
} from '@shared/trench/trench.type';
import type {
  TrenchReadError,
  TrenchReadResult,
} from '@shared/trench/trenchXpc.type';
import type {
  TrenchDetailState,
  TrenchDetailValue,
  TrenchListState,
  TrenchModule,
  TrenchRecordSummary,
  TrenchSourceDocumentState,
  TrenchVaultClient,
} from './trenchVault.type';

type TrenchListResult =
  | TrenchAnalysisListResult
  | TrenchIndexWalletListResult
  | TrenchNegativeWalletListResult;

const modules: TrenchModule[] = ['ca', 'index-wallets', 'negative-wallets'];

const createListState = (): TrenchListState => ({
  query: '',
  items: [],
  issues: [],
  phase: 'loading',
  error: null,
  nextCursor: null,
  total: null,
  appending: false,
  revision: 0,
});

const createDetailState = (module: TrenchModule): TrenchDetailState => ({
  module,
  identity: null,
  phase: 'idle',
  refreshing: false,
  value: null,
  error: null,
  issue: null,
  indexSourcePhase: 'idle',
  indexSourceError: null,
});

const isDataChangedEvent = (value: unknown): value is TrenchDataChangedEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<TrenchDataChangedEvent>;
  return event.schema === 'bl-trench-data-changed-v1'
    && Number.isInteger(event.revision)
    && Number(event.revision) >= 0
    && ['analysis', 'negative-wallet', 'negative-wallet-holdings'].includes(String(event.entity))
    && typeof event.identity === 'string'
    && ['put', 'archive'].includes(String(event.operation));
};

export const trenchRecordIdentity = (
  module: TrenchModule,
  item: TrenchRecordSummary,
): string => {
  if (module === 'ca') {
    return `ca:${(item as TrenchCaAnalysisSummary).contractAddress}`;
  }
  if (module === 'index-wallets') {
    const wallet = item as TrenchIndexWallet;
    return `index:${wallet.chain}:${wallet.address}`;
  }
  const wallet = item as TrenchNegativeWalletSummary;
  return `negative:${wallet.chain}:${wallet.address}`;
};

const errorPhase = (error: TrenchReadError): TrenchListState['phase'] => {
  return error.code === 'REPOSITORY_UNAVAILABLE' ? 'unavailable' : 'error';
};

export class TrenchVaultStore {
  readonly client: TrenchVaultClient;
  module: TrenchModule = 'ca';
  lists: Record<TrenchModule, TrenchListState> = {
    ca: createListState(),
    'index-wallets': createListState(),
    'negative-wallets': createListState(),
  };
  details: Record<TrenchModule, TrenchDetailState> = {
    ca: createDetailState('ca'),
    'index-wallets': createDetailState('index-wallets'),
    'negative-wallets': createDetailState('negative-wallets'),
  };
  selections: Record<TrenchModule, string | null> = {
    ca: null,
    'index-wallets': null,
    'negative-wallets': null,
  };
  sourceDocument: TrenchSourceDocumentState = {
    phase: 'idle',
    source: null,
    value: null,
    error: null,
  };
  observedRevision = 0;
  mobileDetailOpen = false;
  initialized = false;

  private latestBroadcastRevision = -1;

  private readonly listGeneration: Record<TrenchModule, number> = {
    ca: 0,
    'index-wallets': 0,
    'negative-wallets': 0,
  };
  private readonly detailGeneration: Record<TrenchModule, number> = {
    ca: 0,
    'index-wallets': 0,
    'negative-wallets': 0,
  };
  private readonly listInFlight: Record<TrenchModule, boolean> = {
    ca: false,
    'index-wallets': false,
    'negative-wallets': false,
  };
  private readonly pendingRefresh: Record<TrenchModule, boolean> = {
    ca: false,
    'index-wallets': false,
    'negative-wallets': false,
  };
  private sourceGeneration = 0;

  constructor(client: TrenchVaultClient) {
    this.client = client;
  }

  get currentList(): TrenchListState {
    return this.lists[this.module];
  }

  get currentDetail(): TrenchDetailState {
    return this.details[this.module];
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.client.subscribe((event) => this.handleDataChanged(event));
    await this.refreshModule(this.module);
  }

  async setModule(module: TrenchModule): Promise<void> {
    if (!modules.includes(module)) return;
    this.detailGeneration[this.module] += 1;
    this.module = module;
    this.mobileDetailOpen = false;
    this.resetSourceDocument();
    const list = this.lists[module];
    if (list.phase === 'loading' && list.items.length === 0) {
      await this.refreshModule(module);
      return;
    }
    const selected = this.selections[module];
    if (selected) await this.loadDetail(module, selected);
  }

  async setSearch(value: string): Promise<void> {
    const list = this.currentList;
    if (list.query === value) return;
    this.resetSourceDocument();
    list.query = value;
    this.selections[this.module] = null;
    this.detailGeneration[this.module] += 1;
    this.details[this.module] = createDetailState(this.module);
    this.mobileDetailOpen = false;
    this.listGeneration[this.module] += 1;
    await this.refreshModule(this.module);
  }

  async refresh(): Promise<void> {
    await this.refreshModule(this.module);
  }

  async loadMoreRecords(): Promise<void> {
    const module = this.module;
    if (!this.lists[module].nextCursor || this.listInFlight[module]) return;
    await this.refreshModule(module, true);
  }

  async selectRecord(item: TrenchRecordSummary): Promise<void> {
    this.resetSourceDocument();
    const identity = this.recordIdentity(this.module, item);
    this.selections[this.module] = identity;
    this.mobileDetailOpen = true;
    await this.loadDetail(this.module, identity);
  }

  selectIssue(issue: TrenchStoredIssue): void {
    this.resetSourceDocument();
    this.setIssueDetail(this.module, issue);
    this.selections[this.module] = null;
    this.mobileDetailOpen = true;
  }

  recordIdentity(module: TrenchModule, item: TrenchRecordSummary): string {
    return trenchRecordIdentity(module, item);
  }

  issueIdentity(issue: TrenchStoredIssue): string {
    return `issue:${issue.entity}:${issue.identity}`;
  }

  indexSourceIdentity(source: TrenchIndexWalletSource): string {
    return `${source.contractAddress}:${source.analysisId}:${source.analysisContentHash}`;
  }

  caSummary(item: TrenchRecordSummary): TrenchCaAnalysisSummary {
    return item as TrenchCaAnalysisSummary;
  }

  indexSummary(item: TrenchRecordSummary): TrenchIndexWallet {
    return item as TrenchIndexWallet;
  }

  negativeSummary(item: TrenchRecordSummary): TrenchNegativeWalletSummary {
    return item as TrenchNegativeWalletSummary;
  }

  recordPrimary(module: TrenchModule, item: TrenchRecordSummary): string {
    if (module === 'ca') return this.caSummary(item).contractAddress;
    if (module === 'index-wallets') return this.indexSummary(item).address;
    return this.negativeSummary(item).address;
  }

  caSymbol(item: TrenchRecordSummary): string {
    return this.caSummary(item).chains
      .map((chain) => chain.token?.symbol)
      .filter(Boolean)
      .join(' / ') || '—';
  }

  caSource(item: TrenchRecordSummary): string {
    const source = this.caSummary(item).source;
    return [source.agent, source.skill, ...source.providers].filter(Boolean).join(' · ');
  }

  firstLine(value: string): string {
    return value.split(/\r?\n/).find((line) => line.trim())?.trim() || '—';
  }

  formatTime(value: string, locale: string): string {
    return new Intl.DateTimeFormat(locale || 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  holdingMessageKey(holding: boolean | null): string {
    return holding === null
      ? 'trench.index.unknown'
      : holding
        ? 'trench.index.holding'
        : 'trench.index.notHolding';
  }

  formatWinRate(value: number): string {
    const percentage = value >= 0 && value <= 1 ? value * 100 : value;
    return `${Math.round(percentage * 100) / 100}%`;
  }

  backToList(): void {
    this.mobileDetailOpen = false;
    this.resetSourceDocument();
  }

  async retryDetail(): Promise<void> {
    const identity = this.selections[this.module];
    if (identity) await this.loadDetail(this.module, identity);
  }

  async loadMoreIndexSources(): Promise<void> {
    const detail = this.details['index-wallets'];
    if (detail.phase !== 'ready' || !detail.value) return;
    const current = detail.value as TrenchIndexWalletDetail;
    if (!current.nextCursor || detail.indexSourcePhase === 'loading-more') return;
    const identity = this.selections['index-wallets'];
    if (!identity) return;
    const generation = ++this.detailGeneration['index-wallets'];
    detail.indexSourcePhase = 'loading-more';
    detail.indexSourceError = null;
    const result = await this.client.getIndexWallet({
      chain: current.wallet.chain,
      address: current.wallet.address,
      cursor: current.nextCursor,
      limit: current.limit,
    });
    if (generation !== this.detailGeneration['index-wallets'] || identity !== this.selections['index-wallets']) {
      return;
    }
    if (!result.ok) {
      if (result.error.code === 'CURSOR_STALE' || result.error.code === 'CURSOR_INVALID') {
        await this.loadDetail('index-wallets', identity);
        return;
      }
      detail.indexSourcePhase = 'error';
      detail.indexSourceError = result.error;
      return;
    }
    if (result.value.revision < this.observedRevision) {
      await this.loadDetail('index-wallets', identity);
      return;
    }
    this.observedRevision = Math.max(this.observedRevision, result.value.revision);
    if (
      result.value.wallet.chain !== current.wallet.chain
      || result.value.wallet.address !== current.wallet.address
      || result.value.contentHash !== current.contentHash
    ) {
      await this.loadDetail('index-wallets', identity);
      return;
    }
    detail.value = {
      ...result.value,
      items: [...current.items, ...result.value.items],
    };
    detail.indexSourcePhase = 'idle';
  }

  async openIndexSource(source: TrenchIndexWalletSource): Promise<void> {
    const generation = ++this.sourceGeneration;
    this.sourceDocument = { phase: 'loading', source, value: null, error: null };
    const result = await this.client.getAnalysis({ contractAddress: source.contractAddress });
    if (generation !== this.sourceGeneration) return;
    if (!result.ok) {
      if (result.error.code === 'NOT_FOUND' || result.error.code === 'INVALID_STORED_RECORD') {
        this.sourceDocument = { phase: 'idle', source: null, value: null, error: null };
        const identity = this.selections['index-wallets'];
        if (identity) await this.loadDetail('index-wallets', identity);
        return;
      }
      this.sourceDocument = {
        phase: 'error',
        source,
        value: null,
        error: result.error,
      };
      return;
    }
    if (
      result.value.record.analysisId !== source.analysisId
      || result.value.contentHash !== source.analysisContentHash
    ) {
      this.sourceDocument = { phase: 'idle', source: null, value: null, error: null };
      const identity = this.selections['index-wallets'];
      if (identity) await this.loadDetail('index-wallets', identity);
      return;
    }
    if (result.value.revision < this.observedRevision) {
      this.sourceDocument = { phase: 'idle', source: null, value: null, error: null };
      const identity = this.selections['index-wallets'];
      if (identity) await this.loadDetail('index-wallets', identity);
      return;
    }
    this.observedRevision = Math.max(this.observedRevision, result.value.revision);
    this.sourceDocument = { phase: 'ready', source, value: result.value, error: null };
  }

  closeIndexSource(): void {
    this.resetSourceDocument();
  }

  handleDataChanged(value: unknown): void {
    if (!isDataChangedEvent(value) || value.revision <= this.latestBroadcastRevision) return;
    this.latestBroadcastRevision = value.revision;
    this.observedRevision = Math.max(this.observedRevision, value.revision);
    const openSource = this.sourceDocument.phase === 'ready'
      ? this.sourceDocument.source
      : null;
    if (openSource) void this.openIndexSource(openSource);
    for (const module of modules) {
      if (this.listInFlight[module]) {
        this.listGeneration[module] += 1;
        this.pendingRefresh[module] = true;
      } else {
        void this.refreshModule(module);
      }
    }
  }

  private resetSourceDocument(): void {
    this.sourceGeneration += 1;
    this.sourceDocument = { phase: 'idle', source: null, value: null, error: null };
  }

  private async refreshModule(module: TrenchModule, append = false): Promise<void> {
    const list = this.lists[module];
    if (this.listInFlight[module]) {
      if (append) return;
      this.listGeneration[module] += 1;
      this.pendingRefresh[module] = true;
      return;
    }
    if (append && !list.nextCursor) return;

    this.listInFlight[module] = true;
    list.appending = append;
    const generation = ++this.listGeneration[module];
    const cursor = append ? list.nextCursor ?? undefined : undefined;
    if (!append) list.phase = list.items.length ? 'refreshing' : 'loading';
    list.error = null;
    try {
      const params = { query: list.query, cursor, limit: 50 };
      let result: TrenchReadResult<TrenchListResult>;
      if (module === 'ca') result = await this.client.listAnalyses(params);
      else if (module === 'index-wallets') result = await this.client.listIndexWallets(params);
      else result = await this.client.listNegativeWallets(params);

      if (generation !== this.listGeneration[module]) return;
      if (!result.ok) {
        if (append && (result.error.code === 'CURSOR_STALE' || result.error.code === 'CURSOR_INVALID')) {
          list.nextCursor = null;
          this.pendingRefresh[module] = true;
          return;
        }
        list.phase = errorPhase(result.error);
        list.error = result.error;
        return;
      }
      if (result.value.revision < this.observedRevision) {
        this.pendingRefresh[module] = true;
        return;
      }
      this.observedRevision = Math.max(this.observedRevision, result.value.revision);
      list.items = append
        ? [...list.items, ...(result.value.items as TrenchRecordSummary[])]
        : result.value.items as TrenchRecordSummary[];
      list.issues = result.value.issues;
      list.nextCursor = result.value.nextCursor;
      list.total = result.value.total;
      list.revision = result.value.revision;
      list.phase = list.items.length
        ? 'ready'
        : list.query.trim()
          ? 'no-match'
          : list.issues.length
            ? 'ready'
            : 'empty';

      const identities = new Set(list.items.map((item) => this.recordIdentity(module, item)));
      const previousSelection = this.selections[module];
      const previousIssue = this.details[module].issue;
      const retainedIssue = previousIssue
        ? list.issues.find(
          (candidate) => candidate.entity === previousIssue?.entity
            && candidate.identity === previousIssue.identity,
        )
        : undefined;
      const nextSelection = previousSelection && identities.has(previousSelection)
        ? previousSelection
        : retainedIssue
          ? null
          : list.items[0]
            ? this.recordIdentity(module, list.items[0])
            : null;
      const nextIssue = nextSelection
        ? undefined
        : retainedIssue ?? list.issues[0];
      const nextDetailIdentity = nextSelection
        ?? (nextIssue ? this.issueIdentity(nextIssue) : null);
      if (module === this.module && this.details[module].identity !== nextDetailIdentity) {
        this.resetSourceDocument();
      }
      if (nextSelection) {
        this.selections[module] = nextSelection;
        await this.loadDetail(module, nextSelection);
      } else if (nextIssue) {
        this.selections[module] = null;
        this.setIssueDetail(module, nextIssue);
      } else {
        this.selections[module] = null;
        this.details[module] = createDetailState(module);
      }
    } finally {
      this.listInFlight[module] = false;
      list.appending = false;
      if (this.pendingRefresh[module]) {
        this.pendingRefresh[module] = false;
        void this.refreshModule(module);
      }
    }
  }

  private async loadDetail(module: TrenchModule, identity: string): Promise<void> {
    const item = this.lists[module].items.find(
      (candidate) => this.recordIdentity(module, candidate) === identity,
    );
    if (!item) {
      if (module === this.module && this.details[module].identity !== null) {
        this.resetSourceDocument();
      }
      this.selections[module] = null;
      this.details[module] = createDetailState(module);
      return;
    }
    const generation = ++this.detailGeneration[module];
    const detail = this.details[module];
    const preserveCurrentEvidence = detail.identity === identity
      && detail.phase === 'ready'
      && detail.value !== null;
    detail.module = module;
    detail.identity = identity;
    detail.refreshing = preserveCurrentEvidence;
    if (!preserveCurrentEvidence) {
      detail.phase = 'loading';
      detail.value = null;
    }
    detail.error = null;
    detail.issue = null;
    let result: TrenchReadResult<TrenchDetailValue>;
    if (module === 'ca') {
      result = await this.client.getAnalysis({
        contractAddress: (item as TrenchCaAnalysisSummary).contractAddress,
      });
    } else if (module === 'index-wallets') {
      const wallet = item as TrenchIndexWallet;
      result = await this.client.getIndexWallet({
        chain: wallet.chain,
        address: wallet.address,
        limit: 50,
      });
    } else {
      const wallet = item as TrenchNegativeWalletSummary;
      result = await this.client.getNegativeWallet({
        chain: wallet.chain,
        address: wallet.address,
      });
    }
    if (generation !== this.detailGeneration[module] || identity !== this.selections[module]) return;
    if (!result.ok) {
      detail.refreshing = false;
      detail.phase = result.error.code === 'NOT_FOUND'
        ? 'missing'
        : result.error.code === 'INVALID_STORED_RECORD'
          ? 'invalid'
          : 'error';
      detail.error = result.error;
      if (result.error.code === 'NOT_FOUND') void this.refreshModule(module);
      return;
    }
    const revision = (result.value as { revision: number }).revision;
    if (revision < this.observedRevision) {
      detail.refreshing = false;
      this.pendingRefresh[module] = true;
      if (!this.listInFlight[module]) void this.refreshModule(module);
      return;
    }
    this.observedRevision = Math.max(this.observedRevision, revision);
    detail.value = result.value;
    detail.phase = 'ready';
    detail.refreshing = false;
    detail.indexSourcePhase = 'idle';
    detail.indexSourceError = null;
  }

  private setIssueDetail(module: TrenchModule, issue: TrenchStoredIssue): void {
    const detail = createDetailState(module);
    detail.identity = this.issueIdentity(issue);
    detail.phase = 'invalid';
    detail.issue = issue;
    this.details[module] = detail;
  }
}
