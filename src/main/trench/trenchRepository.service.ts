import { createHash, randomUUID } from 'crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import {
  TRENCH_CHAINS,
  type TrenchAnalysisListResult,
  type TrenchCaAnalysisSummary,
  type TrenchCaAnalysisV1,
  type TrenchChain,
  type TrenchContentHash,
  type TrenchDataChangedEvent,
  type TrenchDocument,
  type TrenchExposureReferenceStatus,
  type TrenchIndexWallet,
  type TrenchIndexWalletDetail,
  type TrenchIndexWalletListResult,
  type TrenchIndexWalletSource,
  type TrenchNegativeWalletDetail,
  type TrenchNegativeWalletHoldingsV1,
  type TrenchNegativeWalletListResult,
  type TrenchNegativeWalletSummary,
  type TrenchNegativeWalletV1,
  type TrenchStoredIssue,
  type TrenchWalletExposure
} from '@shared/trench/trench.type';
import {
  TRENCH_MAX_LIST_LIMIT,
  TRENCH_MAX_RECORD_BYTES,
  assertTrenchChain,
  assertTrenchRequestId,
  canonicalizeTrenchAddress,
  createTrenchNegativeWallet,
  normalizeTrenchCaAnalysis,
  normalizeTrenchNegativeWallet,
  normalizeTrenchNegativeWalletHoldings,
  serializeTrenchDocument
} from '@shared/trench/trench.validation';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DEFAULT_LIST_LIMIT = 50;
const MAX_ACTIVE_RECORDS = 10_000;
const MAX_ISSUES = 100;
const MAX_QUERY_CODE_POINTS = 200;
const MAX_CURSOR_LENGTH = 4_096;
export const TRENCH_INDEX_DETAIL_MAX_BYTES = 1024 * 1024;

export type TrenchRepositoryErrorCode =
  | 'CONFLICT'
  | 'CURSOR_INVALID'
  | 'CURSOR_STALE'
  | 'FUTURE_TIMESTAMP'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_INPUT'
  | 'INVALID_STORED_RECORD'
  | 'NOT_FOUND'
  | 'REFERENCE_NOT_FOUND'
  | 'STALE_WRITE';

export class TrenchRepositoryError extends Error {
  readonly code: TrenchRepositoryErrorCode;

  constructor(code: TrenchRepositoryErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'TrenchRepositoryError';
    this.code = code;
  }
}

const REPOSITORY_UNAVAILABLE_CODES = new Set([
  'EACCES',
  'EBUSY',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'EROFS'
]);

const isRepositoryUnavailableError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error &&
  REPOSITORY_UNAVAILABLE_CODES.has(String((error as NodeJS.ErrnoException).code));

const isRepositoryInfrastructureError = (error: unknown): error is NodeJS.ErrnoException =>
  isRepositoryUnavailableError(error) &&
  !['ENOENT', 'ENOTDIR'].includes(String(error.code));

const normalizeStoredReadError = (error: unknown, message: string): Error => {
  if (error instanceof TrenchRepositoryError) return error;
  if (isRepositoryUnavailableError(error)) return error;
  return new TrenchRepositoryError('INVALID_STORED_RECORD', message);
};

export interface TrenchRepositoryOptions {
  userDataRoot: () => string;
  now?: () => number;
  randomId?: () => string;
  archiveId?: () => string;
  platform?: NodeJS.Platform;
  beforeCommit?: (params: { targetPath: string; temporaryPath: string; document: string }) => void;
  onChanged?: (event: TrenchDataChangedEvent) => void;
}

interface ListInput {
  query?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

interface NormalizedListInput {
  query: string;
  cursor?: string;
  limit: number;
}

interface CursorPayload {
  version: 2;
  epoch: string;
  module: string;
  revision: number;
  query: string;
  key: string;
}

interface AnalysisCollection {
  documents: Array<TrenchDocument<TrenchCaAnalysisV1>>;
  issues: TrenchStoredIssue[];
}

interface NegativeCollection {
  details: TrenchNegativeWalletDetail[];
  issues: TrenchStoredIssue[];
}

interface NegativeReadDetail extends TrenchNegativeWalletDetail {
  holdingsIssue?: TrenchStoredIssue | null;
}

interface IndexProjectionEntry {
  wallet: TrenchIndexWallet;
  sources: TrenchIndexWalletSource[];
}

interface IndexProjection {
  entries: IndexProjectionEntry[];
  contentHash: TrenchContentHash;
  issues: TrenchStoredIssue[];
}

interface AnalysisDetail extends TrenchDocument<TrenchCaAnalysisV1> {
  references: TrenchExposureReferenceStatus[];
  revision: number;
}

interface AnalysisMutationResult extends AnalysisDetail {
  changed: boolean;
}

interface NegativeMutationResult extends TrenchNegativeWalletDetail {
  changed: boolean;
  revision: number;
}

interface HoldingsMutationResult extends TrenchDocument<TrenchNegativeWalletHoldingsV1> {
  compositeContentHash: TrenchContentHash;
  changed: boolean;
  revision: number;
}

interface ArchiveReceipt<T> extends TrenchDocument<T> {
  archived: true;
  revision: number;
}

const contentHash = (document: string): TrenchContentHash => {
  return `sha256:${createHash('sha256').update(document, 'utf8').digest('hex')}`;
};

const addressKey = (address: string): string => {
  return createHash('sha256').update(address, 'utf8').digest('hex');
};

const assertContentHash = (value: unknown, label: string): TrenchContentHash => {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new TrenchRepositoryError('INVALID_INPUT', `${label} must be a sha256 content hash`);
  }
  return value as TrenchContentHash;
};

const jsonByteLength = (value: unknown): number => {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
};

const compareText = (left: string, right: string): number => {
  return left < right ? -1 : left > right ? 1 : 0;
};

const compareChain = (left: TrenchChain, right: TrenchChain): number => {
  return TRENCH_CHAINS.indexOf(left) - TRENCH_CHAINS.indexOf(right);
};

const hasControlCharacter = (value: string): boolean => {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
};

export class TrenchRepository {
  private readonly options: TrenchRepositoryOptions;
  private readonly cursorEpoch: string;
  private mutationQueue: Promise<void> = Promise.resolve();
  private currentRevision = 0;

  constructor(options: TrenchRepositoryOptions) {
    this.options = options;
    this.cursorEpoch = randomUUID();
  }

  get rootPath(): string {
    return join(this.options.userDataRoot(), 'trench');
  }

  get revision(): number {
    return this.currentRevision;
  }

  getAnalysisFilePath(contractAddress: string): string {
    const canonicalAddress = canonicalizeTrenchAddress(
      contractAddress,
      undefined,
      'contractAddress'
    );
    return this.analysisFilePath(canonicalAddress);
  }

  getNegativeWalletDirectory(chainValue: unknown, addressValue: unknown): string {
    const chain = assertTrenchChain(chainValue);
    const address = canonicalizeTrenchAddress(addressValue, chain);
    return this.negativeWalletDirectory(chain, address);
  }

  async putAnalysis(params: {
    record: unknown;
    replaceNewer?: boolean;
  }): Promise<AnalysisMutationResult> {
    const normalized = this.normalizeAnalysis(params.record);
    if (params.replaceNewer !== undefined && typeof params.replaceNewer !== 'boolean') {
      throw new TrenchRepositoryError('INVALID_INPUT', 'replaceNewer must be a boolean');
    }
    return this.enqueueMutation(async () => {
      this.ensureBaseDirectories();
      const targetPath = this.analysisFilePath(normalized.contractAddress);
      const existing = this.pathEntryExists(targetPath)
        ? this.readAnalysisDocument(targetPath, addressKey(normalized.contractAddress))
        : null;
      const incomingDocument = serializeTrenchDocument(normalized, 'analysis');
      if (existing?.record.analysisId === normalized.analysisId) {
        if (existing.document !== incomingDocument) {
          throw new TrenchRepositoryError(
            'IDEMPOTENCY_CONFLICT',
            `analysisId ${normalized.analysisId} already belongs to different canonical content`
          );
        }
        return {
          ...existing,
          references: this.getReferenceStatuses(existing.record),
          revision: this.currentRevision,
          changed: false
        };
      }
      if (
        existing &&
        Date.parse(normalized.generatedAt) <= Date.parse(existing.record.generatedAt) &&
        params.replaceNewer !== true
      ) {
        throw new TrenchRepositoryError(
          'STALE_WRITE',
          'The incoming generatedAt must be strictly newer than the active analysis'
        );
      }
      this.assertProspectiveExposureReferences(normalized);
      this.writeAtomic(targetPath, incomingDocument);
      const persisted = this.readAnalysisDocument(
        targetPath,
        addressKey(normalized.contractAddress)
      );
      if (persisted.record.analysisId !== normalized.analysisId) {
        throw new TrenchRepositoryError(
          'INVALID_STORED_RECORD',
          'Persisted analysis identity changed'
        );
      }
      const revision = this.commitChange('analysis', normalized.contractAddress, 'put');
      return {
        ...persisted,
        references: this.getReferenceStatuses(persisted.record),
        revision,
        changed: true
      };
    });
  }

  listAnalyses(input: ListInput = {}): TrenchAnalysisListResult {
    this.ensureBaseDirectories();
    const listInput = this.normalizeListInput(input);
    const collection = this.collectAnalysisDocuments();
    const items = collection.documents
      .map((document) => this.toAnalysisSummary(document))
      .filter((item) => this.analysisMatchesQuery(item, listInput.query))
      .sort(
        (left, right) =>
          Date.parse(right.generatedAt) - Date.parse(left.generatedAt) ||
          compareText(left.contractAddress, right.contractAddress)
      );
    return this.pageItems({
      items,
      issues: collection.issues,
      input: listInput,
      module: 'analysis-list',
      keyOf: (item) => `${item.generatedAt}\0${item.contractAddress}`
    });
  }

  getAnalysis(contractAddressValue: unknown): AnalysisDetail {
    this.ensureBaseDirectories();
    const contractAddress = canonicalizeTrenchAddress(
      contractAddressValue,
      undefined,
      'contractAddress'
    );
    const path = this.analysisFilePath(contractAddress);
    if (!this.pathEntryExists(path)) {
      throw new TrenchRepositoryError('NOT_FOUND', `Analysis not found: ${contractAddress}`);
    }
    let document: TrenchDocument<TrenchCaAnalysisV1>;
    try {
      document = this.readAnalysisDocument(path, addressKey(contractAddress));
    } catch (error) {
      throw normalizeStoredReadError(error, 'The stored Analysis document is invalid');
    }
    return {
      ...document,
      references: this.getReferenceStatuses(document.record),
      revision: this.currentRevision
    };
  }

  async archiveAnalysis(params: {
    contractAddress: unknown;
    expectedAnalysisId: unknown;
    expectedContentHash: unknown;
  }): Promise<
    ArchiveReceipt<TrenchCaAnalysisV1> & { references: TrenchExposureReferenceStatus[] }
  > {
    const contractAddress = canonicalizeTrenchAddress(
      params.contractAddress,
      undefined,
      'contractAddress'
    );
    const expectedAnalysisId = assertTrenchRequestId(
      params.expectedAnalysisId,
      'expectedAnalysisId'
    );
    const expectedContentHash = assertContentHash(
      params.expectedContentHash,
      'expectedContentHash'
    );
    return this.enqueueMutation(async () => {
      this.ensureBaseDirectories();
      const activePath = this.analysisFilePath(contractAddress);
      if (!this.pathEntryExists(activePath)) {
        throw new TrenchRepositoryError('NOT_FOUND', `Analysis not found: ${contractAddress}`);
      }
      const active = this.readAnalysisDocument(activePath, addressKey(contractAddress));
      if (
        active.record.analysisId !== expectedAnalysisId ||
        active.contentHash !== expectedContentHash
      ) {
        throw new TrenchRepositoryError(
          'CONFLICT',
          'The active analysis no longer matches the archive CAS'
        );
      }
      const archiveDirectory = join(this.rootPath, 'archive', 'analyses');
      const archiveContainer = this.reserveArchiveContainer(
        archiveDirectory,
        addressKey(contractAddress)
      );
      const archivePath = join(archiveContainer, basename(activePath));
      try {
        this.assertExistingDirectory(dirname(activePath));
        this.assertExistingRegularTarget(activePath);
        this.assertExistingDirectory(archiveContainer);
        if (this.pathEntryExists(archivePath)) {
          throw new TrenchRepositoryError(
            'CONFLICT',
            'Reserved Analysis archive container was not empty'
          );
        }
        renameSync(activePath, archivePath);
      } catch (error) {
        this.removeReservedArchiveContainer(archiveContainer);
        throw error;
      }
      this.fsyncDirectory(dirname(activePath));
      this.fsyncDirectory(archiveContainer);
      const archived = this.readAnalysisDocument(archivePath, addressKey(contractAddress));
      const revision = this.commitChange('analysis', contractAddress, 'archive');
      return {
        ...archived,
        references: this.getReferenceStatuses(archived.record),
        archived: true,
        revision
      };
    });
  }

  listIndexWallets(input: ListInput = {}): TrenchIndexWalletListResult {
    this.ensureBaseDirectories();
    const listInput = this.normalizeListInput(input);
    const projection = this.buildIndexProjection();
    const filtered = projection.entries
      .filter((entry) => this.indexMatchesQuery(entry, listInput.query))
      .sort((left, right) => this.compareIndexEntries(left, right));
    const page = this.pageItems({
      items: filtered.map((entry) => entry.wallet),
      issues: projection.issues,
      input: listInput,
      module: 'index-list',
      keyOf: (item) => `${item.lastSeenAt}\0${item.chain}\0${item.address}`
    });
    return { ...page, contentHash: projection.contentHash };
  }

  getIndexWallet(params: {
    chain: unknown;
    address: unknown;
    cursor?: unknown;
    limit?: unknown;
  }): TrenchIndexWalletDetail {
    this.ensureBaseDirectories();
    const chain = assertTrenchChain(params.chain);
    const address = canonicalizeTrenchAddress(params.address, chain);
    const listInput = this.normalizeListInput({ cursor: params.cursor, limit: params.limit });
    const projection = this.buildIndexProjection();
    const entry = projection.entries.find(
      (candidate) => candidate.wallet.chain === chain && candidate.wallet.address === address
    );
    if (!entry)
      throw new TrenchRepositoryError('NOT_FOUND', `Index Wallet not found: ${chain}:${address}`);
    const module = `index-get:${chain}:${address}`;
    const sortedSources = [...entry.sources].sort(
      (left, right) =>
        Date.parse(right.generatedAt) - Date.parse(left.generatedAt) ||
        compareText(left.contractAddress, right.contractAddress) ||
        compareText(left.analysisId, right.analysisId)
    );
    const start = this.resolvePageStart(
      sortedSources,
      listInput,
      module,
      (source) =>
        `${source.generatedAt}\0${source.contractAddress}\0${source.analysisId}\0${source.rank}`
    );
    const selected: TrenchIndexWalletSource[] = [];
    for (
      let index = start;
      index < sortedSources.length && selected.length < listInput.limit;
      index += 1
    ) {
      const candidate = [...selected, sortedSources[index]];
      const candidateNextCursor =
        index + 1 < sortedSources.length
          ? this.encodeCursor({
              module,
              query: '',
              key: this.indexSourceKey(sortedSources[index])
            })
          : null;
      const responseProbe = {
        wallet: entry.wallet,
        items: candidate,
        total: sortedSources.length,
        limit: listInput.limit,
        nextCursor: candidateNextCursor,
        revision: this.currentRevision,
        issues: projection.issues,
        contentHash: projection.contentHash
      };
      if (jsonByteLength(responseProbe) >= TRENCH_INDEX_DETAIL_MAX_BYTES) break;
      selected.push(sortedSources[index]);
    }
    if (selected.length === 0 && start < sortedSources.length) {
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        'One Index source summary exceeds the response cap'
      );
    }
    const consumed = start + selected.length;
    const nextCursor =
      consumed < sortedSources.length
        ? this.encodeCursor({
            module,
            query: '',
            key: this.indexSourceKey(selected[selected.length - 1])
          })
        : null;
    const result: TrenchIndexWalletDetail = {
      wallet: entry.wallet,
      items: selected,
      total: sortedSources.length,
      limit: listInput.limit,
      nextCursor,
      revision: this.currentRevision,
      issues: projection.issues,
      contentHash: projection.contentHash
    };
    if (jsonByteLength(result) >= TRENCH_INDEX_DETAIL_MAX_BYTES) {
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        'Index detail response exceeded 1 MiB'
      );
    }
    return result;
  }

  async putNegativeWallet(params: {
    requestId: unknown;
    chain: unknown;
    address: unknown;
    explanation: unknown;
  }): Promise<NegativeMutationResult> {
    return this.enqueueMutation(async () => {
      this.ensureBaseDirectories();
      const now = this.now();
      const timestamp = new Date(now).toISOString();
      const requested = createTrenchNegativeWallet({
        ...params,
        createdAt: timestamp,
        updatedAt: timestamp,
        now
      });
      const directory = this.negativeWalletDirectory(requested.chain, requested.address);
      if (this.pathEntryExists(directory)) this.assertExistingDirectory(directory);
      const tagPath = join(directory, 'tag.json');
      const existing = this.pathEntryExists(tagPath)
        ? this.readNegativeDetailAtDirectory(directory, requested.chain, requested.address)
        : null;
      if (existing?.tag.tagId === requested.tagId) {
        if (
          existing.tag.chain !== requested.chain ||
          existing.tag.address !== requested.address ||
          existing.tag.explanation !== requested.explanation
        ) {
          throw new TrenchRepositoryError(
            'IDEMPOTENCY_CONFLICT',
            `tagId ${requested.tagId} already belongs to different canonical content`
          );
        }
        return { ...existing, changed: false, revision: this.currentRevision };
      }
      const updatedAt = existing
        ? new Date(Math.max(now, Date.parse(existing.tag.updatedAt) + 1)).toISOString()
        : timestamp;
      const record = createTrenchNegativeWallet({
        ...params,
        createdAt: existing?.tag.createdAt ?? timestamp,
        updatedAt,
        now: Math.max(now, Date.parse(updatedAt))
      });
      this.ensureDirectory(directory);
      this.writeAtomic(tagPath, serializeTrenchDocument(record, 'negativeWallet'));
      const persisted = this.readNegativeDetailAtDirectory(directory, record.chain, record.address);
      if (persisted.tag.tagId !== record.tagId) {
        throw new TrenchRepositoryError(
          'INVALID_STORED_RECORD',
          'Persisted negative tag identity changed'
        );
      }
      const revision = this.commitChange(
        'negative-wallet',
        `${record.chain}:${record.address}`,
        'put'
      );
      return { ...persisted, changed: true, revision };
    });
  }

  listNegativeWallets(input: ListInput = {}): TrenchNegativeWalletListResult {
    this.ensureBaseDirectories();
    const listInput = this.normalizeListInput(input);
    const collection = this.collectNegativeWallets();
    const items = collection.details
      .map((detail) => this.toNegativeSummary(detail))
      .filter((item) => this.negativeMatchesQuery(item, listInput.query))
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
          compareChain(left.chain, right.chain) ||
          compareText(left.address, right.address)
      );
    return this.pageItems({
      items,
      issues: collection.issues,
      input: listInput,
      module: 'negative-list',
      keyOf: (item) => `${item.updatedAt}\0${item.chain}\0${item.address}`
    });
  }

  getNegativeWallet(
    chainValue: unknown,
    addressValue: unknown
  ): TrenchNegativeWalletDetail & {
    revision: number;
  } {
    return this.getNegativeWalletDetail(chainValue, addressValue);
  }

  getNegativeWalletForBrowser(
    chainValue: unknown,
    addressValue: unknown
  ): TrenchNegativeWalletDetail & {
    holdingsIssue: TrenchStoredIssue | null;
    revision: number;
  } {
    const detail = this.getNegativeWalletDetail(chainValue, addressValue, true);
    return {
      ...detail,
      holdingsIssue: detail.holdingsIssue ?? null
    };
  }

  private getNegativeWalletDetail(
    chainValue: unknown,
    addressValue: unknown,
    isolateHoldingsIssue = false
  ): NegativeReadDetail & { revision: number } {
    this.ensureBaseDirectories();
    const chain = assertTrenchChain(chainValue);
    const address = canonicalizeTrenchAddress(addressValue, chain);
    const directory = this.negativeWalletDirectory(chain, address);
    if (this.pathEntryExists(directory)) this.assertExistingDirectory(directory);
    if (!this.pathEntryExists(join(directory, 'tag.json'))) {
      throw new TrenchRepositoryError(
        'NOT_FOUND',
        `Negative Wallet not found: ${chain}:${address}`
      );
    }
    return {
      ...this.readNegativeDetailAtDirectory(directory, chain, address, {
        isolateHoldingsIssue
      }),
      revision: this.currentRevision
    };
  }

  async putNegativeWalletHoldings(params: {
    record: unknown;
    replaceNewer?: boolean;
  }): Promise<HoldingsMutationResult> {
    const normalized = this.normalizeHoldings(params.record);
    if (params.replaceNewer !== undefined && typeof params.replaceNewer !== 'boolean') {
      throw new TrenchRepositoryError('INVALID_INPUT', 'replaceNewer must be a boolean');
    }
    return this.enqueueMutation(async () => {
      this.ensureBaseDirectories();
      const directory = this.negativeWalletDirectory(normalized.chain, normalized.address);
      if (this.pathEntryExists(directory)) this.assertExistingDirectory(directory);
      const tagPath = join(directory, 'tag.json');
      if (!this.pathEntryExists(tagPath)) {
        throw new TrenchRepositoryError(
          'REFERENCE_NOT_FOUND',
          `A live Negative Wallet tag is required for ${normalized.chain}:${normalized.address}`
        );
      }
      this.readNegativeTag(tagPath, normalized.chain, normalized.address);
      const holdingsPath = join(directory, 'holdings.json');
      const existing = this.pathEntryExists(holdingsPath)
        ? this.readHoldingsDocument(holdingsPath, normalized.chain, normalized.address)
        : null;
      const incomingDocument = serializeTrenchDocument(normalized, 'holdings');
      if (existing?.record.analysisId === normalized.analysisId) {
        if (existing.document !== incomingDocument) {
          throw new TrenchRepositoryError(
            'IDEMPOTENCY_CONFLICT',
            `analysisId ${normalized.analysisId} already belongs to different holdings content`
          );
        }
        const detail = this.readNegativeDetailAtDirectory(
          directory,
          normalized.chain,
          normalized.address
        );
        return {
          ...existing,
          compositeContentHash: detail.contentHash,
          changed: false,
          revision: this.currentRevision
        };
      }
      if (
        existing &&
        Date.parse(normalized.generatedAt) <= Date.parse(existing.record.generatedAt) &&
        params.replaceNewer !== true
      ) {
        throw new TrenchRepositoryError(
          'STALE_WRITE',
          'The incoming generatedAt must be strictly newer than the active holdings'
        );
      }
      this.writeAtomic(holdingsPath, incomingDocument);
      const persisted = this.readHoldingsDocument(
        holdingsPath,
        normalized.chain,
        normalized.address
      );
      const detail = this.readNegativeDetailAtDirectory(
        directory,
        normalized.chain,
        normalized.address
      );
      const revision = this.commitChange(
        'negative-wallet-holdings',
        `${normalized.chain}:${normalized.address}`,
        'put'
      );
      return {
        ...persisted,
        compositeContentHash: detail.contentHash,
        changed: true,
        revision
      };
    });
  }

  getNegativeWalletHoldings(
    chainValue: unknown,
    addressValue: unknown
  ): TrenchDocument<TrenchNegativeWalletHoldingsV1> & { revision: number } {
    this.ensureBaseDirectories();
    const chain = assertTrenchChain(chainValue);
    const address = canonicalizeTrenchAddress(addressValue, chain);
    const path = join(this.negativeWalletDirectory(chain, address), 'holdings.json');
    if (!this.pathEntryExists(path)) {
      throw new TrenchRepositoryError(
        'NOT_FOUND',
        `Negative Wallet holdings not found: ${chain}:${address}`
      );
    }
    try {
      return {
        ...this.readHoldingsDocument(path, chain, address),
        revision: this.currentRevision
      };
    } catch (error) {
      throw normalizeStoredReadError(
        error,
        'The stored Negative Wallet holdings document is invalid'
      );
    }
  }

  async archiveNegativeWallet(params: {
    chain: unknown;
    address: unknown;
    expectedTagId: unknown;
    expectedContentHash: unknown;
  }): Promise<TrenchNegativeWalletDetail & { archived: true; revision: number }> {
    const chain = assertTrenchChain(params.chain);
    const address = canonicalizeTrenchAddress(params.address, chain);
    const expectedTagId = assertTrenchRequestId(params.expectedTagId, 'expectedTagId');
    const expectedContentHash = assertContentHash(
      params.expectedContentHash,
      'expectedContentHash'
    );
    return this.enqueueMutation(async () => {
      this.ensureBaseDirectories();
      const activeDirectory = this.negativeWalletDirectory(chain, address);
      if (this.pathEntryExists(activeDirectory)) this.assertExistingDirectory(activeDirectory);
      if (!this.pathEntryExists(join(activeDirectory, 'tag.json'))) {
        throw new TrenchRepositoryError(
          'NOT_FOUND',
          `Negative Wallet not found: ${chain}:${address}`
        );
      }
      const active = this.readNegativeDetailAtDirectory(activeDirectory, chain, address);
      if (active.tag.tagId !== expectedTagId || active.contentHash !== expectedContentHash) {
        throw new TrenchRepositoryError(
          'CONFLICT',
          'The Negative Wallet no longer matches the archive CAS'
        );
      }
      const archiveParent = join(this.rootPath, 'archive', 'negative-wallets', chain);
      const archiveContainer = this.reserveArchiveContainer(archiveParent, addressKey(address));
      const archivedDirectory = join(archiveContainer, basename(activeDirectory));
      try {
        this.assertExistingDirectory(activeDirectory);
        this.assertExistingDirectory(archiveContainer);
        if (this.pathEntryExists(archivedDirectory)) {
          throw new TrenchRepositoryError(
            'CONFLICT',
            'Reserved Negative Wallet archive container was not empty'
          );
        }
        renameSync(activeDirectory, archivedDirectory);
      } catch (error) {
        this.removeReservedArchiveContainer(archiveContainer);
        throw error;
      }
      this.fsyncDirectory(dirname(activeDirectory));
      this.fsyncDirectory(archiveContainer);
      const archived = this.readNegativeDetailAtDirectory(archivedDirectory, chain, address);
      const revision = this.commitChange('negative-wallet', `${chain}:${address}`, 'archive');
      return { ...archived, archived: true, revision };
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private normalizeAnalysis(value: unknown): TrenchCaAnalysisV1 {
    try {
      return normalizeTrenchCaAnalysis(value, { now: this.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid analysis';
      const code = message.includes('five minutes in the future')
        ? 'FUTURE_TIMESTAMP'
        : 'INVALID_INPUT';
      throw new TrenchRepositoryError(code, message);
    }
  }

  private normalizeHoldings(value: unknown): TrenchNegativeWalletHoldingsV1 {
    try {
      return normalizeTrenchNegativeWalletHoldings(value, { now: this.now() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid holdings';
      const code = message.includes('five minutes in the future')
        ? 'FUTURE_TIMESTAMP'
        : 'INVALID_INPUT';
      throw new TrenchRepositoryError(code, message);
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private ensureBaseDirectories(): void {
    this.ensureDirectory(this.rootPath);
    this.ensureDirectory(join(this.rootPath, 'analyses'));
    this.ensureDirectory(join(this.rootPath, 'negative-wallets'));
    this.ensureDirectory(join(this.rootPath, 'archive'));
  }

  private ensureDirectory(path: string): void {
    for (const directory of this.storageDirectoryChain(path)) {
      try {
        mkdirSync(directory, { mode: DIRECTORY_MODE });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      this.assertDirectoryEntry(directory, true);
    }
  }

  private analysisFilePath(contractAddress: string): string {
    return join(this.rootPath, 'analyses', `${addressKey(contractAddress)}.json`);
  }

  private negativeWalletDirectory(chain: TrenchChain, address: string): string {
    return join(this.rootPath, 'negative-wallets', chain, addressKey(address));
  }

  private writeAtomic(targetPath: string, document: string): void {
    const directory = dirname(targetPath);
    this.ensureDirectory(directory);
    this.assertExistingRegularTarget(targetPath);
    const temporaryPath = join(
      directory,
      `.tmp-${process.pid}-${createHash('sha256')
        .update(this.options.randomId?.() ?? randomUUID())
        .digest('hex')
        .slice(0, 24)}`
    );
    let descriptor: number | null = null;
    let ownsTemporaryPath = false;
    try {
      try {
        descriptor = openSync(
          temporaryPath,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            (this.isWindowsStorage() ? 0 : constants.O_NOFOLLOW),
          FILE_MODE
        );
        ownsTemporaryPath = true;
      } catch {
        throw new TrenchRepositoryError(
          'INVALID_STORED_RECORD',
          'Could not create an exclusive temporary Trench record'
        );
      }
      const createdStats = fstatSync(descriptor);
      if (!createdStats.isFile()) {
        throw new TrenchRepositoryError(
          'INVALID_STORED_RECORD',
          'The temporary Trench record is not a regular file'
        );
      }
      if (!this.isWindowsStorage()) fchmodSync(descriptor, FILE_MODE);
      writeFileSync(descriptor, document, { encoding: 'utf8' });
      fsyncSync(descriptor);
      this.options.beforeCommit?.({ targetPath, temporaryPath, document });
      this.assertNamedDescriptor(temporaryPath, descriptor, 'Temporary Trench record');
      this.assertExistingDirectory(directory);
      this.assertExistingRegularTarget(targetPath);
      if (this.isWindowsStorage()) {
        closeSync(descriptor);
        descriptor = null;
      }
      renameSync(temporaryPath, targetPath);
      if (descriptor !== null) {
        closeSync(descriptor);
        descriptor = null;
      }
      this.fsyncDirectory(directory);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
      if (ownsTemporaryPath && this.pathEntryExists(temporaryPath)) {
        try {
          unlinkSync(temporaryPath);
        } catch {
          // Never recurse through or chmod an attacker-replaced temporary entry.
        }
      }
    }
  }

  private fsyncDirectory(path: string): void {
    if (this.isWindowsStorage()) return;
    const descriptor = this.openDirectoryDescriptor(path, false);
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  private isWindowsStorage(): boolean {
    return (this.options.platform ?? process.platform) === 'win32';
  }

  private pathEntryExists(path: string): boolean {
    try {
      lstatSync(path);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return false;
      throw error;
    }
  }

  private storageDirectoryChain(path: string): string[] {
    const root = resolve(this.rootPath);
    const target = resolve(path);
    const relativePath = relative(root, target);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        'Trench storage path escaped its repository root'
      );
    }
    const chain = [root];
    if (!relativePath) return chain;
    let current = root;
    for (const component of relativePath.split(sep)) {
      current = join(current, component);
      chain.push(current);
    }
    return chain;
  }

  private assertResolvedStoragePath(path: string): void {
    const root = resolve(this.rootPath);
    const target = resolve(path);
    const relativePath = relative(root, target);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        'Trench storage path escaped its repository root'
      );
    }
    const userDataRoot = realpathSync.native(resolve(this.options.userDataRoot()));
    const expected = resolve(userDataRoot, 'trench', relativePath);
    const actual = realpathSync.native(target);
    const normalize = (value: string): string => {
      const resolved = resolve(value);
      return this.isWindowsStorage() ? resolved.toLowerCase() : resolved;
    };
    if (normalize(actual) !== normalize(expected)) {
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        'Trench storage contains a symlink or reparse-point path escape'
      );
    }
  }

  private openDirectoryDescriptor(path: string, applyMode: boolean): number {
    this.storageDirectoryChain(path);
    let descriptor: number | null = null;
    try {
      descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      const openedStats = fstatSync(descriptor);
      if (!openedStats.isDirectory()) throw new Error('not a directory');
      const namedStats = lstatSync(path);
      if (
        namedStats.isSymbolicLink() ||
        !namedStats.isDirectory() ||
        namedStats.dev !== openedStats.dev ||
        namedStats.ino !== openedStats.ino
      ) {
        throw new Error('directory identity changed');
      }
      this.assertResolvedStoragePath(path);
      if (applyMode) fchmodSync(descriptor, DIRECTORY_MODE);
      return descriptor;
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      if (isRepositoryInfrastructureError(error)) throw error;
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        'Trench storage directory must be a real directory inside the repository root'
      );
    }
  }

  private assertDirectoryEntry(path: string, applyMode: boolean): void {
    if (!this.isWindowsStorage()) {
      const descriptor = this.openDirectoryDescriptor(path, applyMode);
      closeSync(descriptor);
      return;
    }

    // Node does not expose openat/FILE_FLAG_OPEN_REPARSE_POINT. On Windows we reject the
    // symlink/junction forms surfaced by lstat plus any resolved-path deviation, and rely on the
    // per-user userData ACL to prevent a same-user component swap during the check.
    try {
      const before = lstatSync(path);
      if (before.isSymbolicLink() || !before.isDirectory()) throw new Error('not a directory');
      this.assertResolvedStoragePath(path);
      const after = lstatSync(path);
      if (
        after.isSymbolicLink() ||
        !after.isDirectory() ||
        before.dev !== after.dev ||
        before.ino !== after.ino
      ) {
        throw new Error('directory identity changed');
      }
    } catch (error) {
      if (isRepositoryInfrastructureError(error)) throw error;
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        'Trench storage directory must not be a symlink or reparse-point path'
      );
    }
  }

  private assertExistingDirectory(path: string): void {
    for (const directory of this.storageDirectoryChain(path)) {
      this.assertDirectoryEntry(directory, false);
    }
  }

  private assertNamedDescriptor(path: string, descriptor: number, label: string): void {
    try {
      const openedStats = fstatSync(descriptor);
      const namedStats = lstatSync(path);
      if (
        !openedStats.isFile() ||
        namedStats.isSymbolicLink() ||
        !namedStats.isFile() ||
        namedStats.dev !== openedStats.dev ||
        namedStats.ino !== openedStats.ino
      ) {
        throw new Error('file identity changed');
      }
      this.assertResolvedStoragePath(path);
    } catch (error) {
      if (isRepositoryInfrastructureError(error)) throw error;
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        `${label} must be a real file inside the repository root`
      );
    }
  }

  private openRegularFileDescriptor(path: string, label: string): number {
    this.assertExistingDirectory(dirname(path));
    let descriptor: number | null = null;
    try {
      if (this.isWindowsStorage()) {
        const stats = lstatSync(path);
        if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('not a regular file');
        this.assertResolvedStoragePath(path);
      }
      descriptor = openSync(
        path,
        constants.O_RDONLY | (this.isWindowsStorage() ? 0 : constants.O_NOFOLLOW)
      );
      const stats = fstatSync(descriptor);
      if (!stats.isFile() || stats.size > TRENCH_MAX_RECORD_BYTES) {
        throw new Error('not a bounded regular file');
      }
      this.assertNamedDescriptor(path, descriptor, label);
      return descriptor;
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      if (isRepositoryInfrastructureError(error)) throw error;
      throw new TrenchRepositoryError(
        'INVALID_STORED_RECORD',
        `${label} must be a bounded regular file inside the repository root`
      );
    }
  }

  private assertExistingRegularTarget(path: string): void {
    if (!this.pathEntryExists(path)) return;
    const descriptor = this.openRegularFileDescriptor(path, 'Stored Trench record');
    closeSync(descriptor);
  }

  private reserveArchiveContainer(parent: string, identityKey: string): string {
    this.ensureDirectory(parent);
    const baseName = `${this.archivePrefix()}-${identityKey}`;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const container = join(parent, attempt === 0 ? baseName : `${baseName}-${attempt}`);
      try {
        mkdirSync(container, { mode: DIRECTORY_MODE });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      try {
        this.assertDirectoryEntry(container, true);
        this.fsyncDirectory(parent);
        return container;
      } catch (error) {
        this.removeReservedArchiveContainer(container);
        throw error;
      }
    }
    throw new TrenchRepositoryError(
      'CONFLICT',
      'Could not reserve a no-clobber archive destination after 32 attempts'
    );
  }

  private removeReservedArchiveContainer(container: string): void {
    try {
      const stats = lstatSync(container);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return;
      rmdirSync(container);
      this.fsyncDirectory(dirname(container));
    } catch {
      // A failed rename must never trigger recursive cleanup of an untrusted replacement path.
    }
  }

  private readCanonicalDocument<T>(params: {
    path: string;
    label: string;
    normalize: (value: unknown) => T;
  }): TrenchDocument<T> {
    const descriptor = this.openRegularFileDescriptor(params.path, params.label);
    try {
      const openedStats = fstatSync(descriptor);
      if (!openedStats.isFile() || openedStats.size > TRENCH_MAX_RECORD_BYTES) {
        throw new Error(`${params.label} is not a bounded regular file`);
      }
      const document = readFileSync(descriptor, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(document) as unknown;
      } catch {
        throw new Error(`${params.label} is not valid JSON`);
      }
      const record = params.normalize(parsed);
      const canonicalDocument = serializeTrenchDocument(record, params.label);
      if (document !== canonicalDocument) {
        throw new Error(`${params.label} is not canonical JSON`);
      }
      return { record, document, contentHash: contentHash(document) };
    } finally {
      closeSync(descriptor);
    }
  }

  private readAnalysisDocument(
    path: string,
    expectedAddressKey: string
  ): TrenchDocument<TrenchCaAnalysisV1> {
    const document = this.readCanonicalDocument({
      path,
      label: 'Stored analysis',
      normalize: (value) => normalizeTrenchCaAnalysis(value, { now: this.now() })
    });
    if (addressKey(document.record.contractAddress) !== expectedAddressKey) {
      throw new Error('Stored analysis does not match its address key');
    }
    return document;
  }

  private readNegativeTag(
    path: string,
    expectedChain: TrenchChain,
    expectedAddress: string
  ): TrenchDocument<TrenchNegativeWalletV1> {
    const document = this.readCanonicalDocument({
      path,
      label: 'Stored Negative Wallet tag',
      normalize: (value) => normalizeTrenchNegativeWallet(value, { now: this.now() })
    });
    if (document.record.chain !== expectedChain || document.record.address !== expectedAddress) {
      throw new Error('Stored Negative Wallet tag does not match its identity key');
    }
    return document;
  }

  private readHoldingsDocument(
    path: string,
    expectedChain: TrenchChain,
    expectedAddress: string
  ): TrenchDocument<TrenchNegativeWalletHoldingsV1> {
    const document = this.readCanonicalDocument({
      path,
      label: 'Stored Negative Wallet holdings',
      normalize: (value) => normalizeTrenchNegativeWalletHoldings(value, { now: this.now() })
    });
    if (document.record.chain !== expectedChain || document.record.address !== expectedAddress) {
      throw new Error('Stored Negative Wallet holdings does not match its identity key');
    }
    return document;
  }

  private readNegativeDetailAtDirectory(
    directory: string,
    chain: TrenchChain,
    address: string,
    options: { isolateHoldingsIssue?: boolean } = {}
  ): NegativeReadDetail {
    this.assertExistingDirectory(directory);
    let tag: TrenchDocument<TrenchNegativeWalletV1>;
    try {
      tag = this.readNegativeTag(join(directory, 'tag.json'), chain, address);
    } catch (error) {
      throw normalizeStoredReadError(error, 'The stored Negative Wallet tag document is invalid');
    }
    const holdingsPath = join(directory, 'holdings.json');
    let holdings: TrenchDocument<TrenchNegativeWalletHoldingsV1> | null = null;
    let holdingsIssue: TrenchStoredIssue | null = null;
    if (this.pathEntryExists(holdingsPath)) {
      try {
        holdings = this.readHoldingsDocument(holdingsPath, chain, address);
      } catch (error) {
        const normalized = normalizeStoredReadError(
          error,
          'The stored Negative Wallet holdings document is invalid'
        );
        if (
          !options.isolateHoldingsIssue ||
          !(normalized instanceof TrenchRepositoryError) ||
          normalized.code !== 'INVALID_STORED_RECORD'
        ) {
          throw normalized;
        }
        holdingsIssue = this.toStoredIssue(
          'negative-wallet-holdings',
          `${chain}:${addressKey(address)}`,
          normalized
        );
      }
    }
    const detail: TrenchNegativeWalletDetail = {
      tag: tag.record,
      tagDocument: tag.document,
      tagContentHash: tag.contentHash,
      holdings: holdings?.record ?? null,
      holdingsDocument: holdings?.document ?? null,
      holdingsContentHash: holdings?.contentHash ?? null,
      contentHash: this.compositeNegativeHash(tag.contentHash, holdings?.contentHash ?? null)
    };
    return options.isolateHoldingsIssue ? { ...detail, holdingsIssue } : detail;
  }

  private compositeNegativeHash(
    tagHash: TrenchContentHash,
    holdingsHash: TrenchContentHash | null
  ): TrenchContentHash {
    return contentHash(`tag=${tagHash}\nholdings=${holdingsHash ?? 'none'}\n`);
  }

  private collectAnalysisDocuments(excludedAddress?: string): AnalysisCollection {
    const directory = join(this.rootPath, 'analyses');
    this.assertExistingDirectory(directory);
    const entries = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.name.endsWith('.json'))
      .sort((left, right) => compareText(left.name, right.name));
    const issues: TrenchStoredIssue[] = [];
    const documents: Array<TrenchDocument<TrenchCaAnalysisV1>> = [];
    if (entries.length > MAX_ACTIVE_RECORDS) {
      this.appendIssue(issues, {
        code: 'STORED_RECORD_LIMIT',
        entity: 'analysis',
        identity: 'analyses',
        message: `Only the first ${MAX_ACTIVE_RECORDS} stored analyses were inspected`
      });
    }
    for (const entry of entries.slice(0, MAX_ACTIVE_RECORDS)) {
      const identity = entry.name.replace(/\.json$/, '');
      if (excludedAddress && identity === addressKey(excludedAddress)) continue;
      try {
        if (!/^[0-9a-f]{64}\.json$/.test(entry.name) || !entry.isFile()) {
          throw new Error('Stored analysis has an invalid file identity');
        }
        const document = this.readAnalysisDocument(join(directory, entry.name), identity);
        documents.push(document);
      } catch (error) {
        this.appendIssue(issues, this.toStoredIssue('analysis', identity, error));
      }
    }
    return { documents, issues };
  }

  private collectNegativeWallets(): NegativeCollection {
    const details: TrenchNegativeWalletDetail[] = [];
    const issues: TrenchStoredIssue[] = [];
    let inspected = 0;
    for (const chain of TRENCH_CHAINS) {
      const chainDirectory = join(this.rootPath, 'negative-wallets', chain);
      if (!this.pathEntryExists(chainDirectory)) continue;
      this.assertExistingDirectory(chainDirectory);
      const entries = readdirSync(chainDirectory, { withFileTypes: true }).sort((left, right) =>
        compareText(left.name, right.name)
      );
      for (const entry of entries) {
        if (inspected >= MAX_ACTIVE_RECORDS) break;
        inspected += 1;
        const identity = `${chain}:${entry.name}`;
        try {
          if (!/^[0-9a-f]{64}$/.test(entry.name) || !entry.isDirectory()) {
            throw new Error('Stored Negative Wallet has an invalid directory identity');
          }
          const directory = join(chainDirectory, entry.name);
          const tagPath = join(directory, 'tag.json');
          const tag = this.readCanonicalDocument({
            path: tagPath,
            label: 'Stored Negative Wallet tag',
            normalize: (value) => normalizeTrenchNegativeWallet(value, { now: this.now() })
          });
          if (tag.record.chain !== chain || addressKey(tag.record.address) !== entry.name) {
            throw new Error('Stored Negative Wallet does not match its directory key');
          }
          const detail = this.readNegativeDetailAtDirectory(
            directory,
            chain,
            tag.record.address,
            { isolateHoldingsIssue: true }
          );
          details.push(detail);
          if (detail.holdingsIssue) this.appendIssue(issues, detail.holdingsIssue);
        } catch (error) {
          this.appendIssue(issues, this.toStoredIssue('negative-wallet', identity, error));
        }
      }
    }
    if (inspected >= MAX_ACTIVE_RECORDS) {
      this.appendIssue(issues, {
        code: 'STORED_RECORD_LIMIT',
        entity: 'negative-wallet',
        identity: 'negative-wallets',
        message: `Only the first ${MAX_ACTIVE_RECORDS} Negative Wallets were inspected`
      });
    }
    return { details, issues };
  }

  private buildIndexProjection(
    excludedAddress?: string,
    incoming?: TrenchCaAnalysisV1
  ): IndexProjection {
    const collection = this.collectAnalysisDocuments(excludedAddress);
    const documents = [...collection.documents];
    if (incoming) {
      const document = serializeTrenchDocument(incoming, 'analysis');
      documents.push({ record: incoming, document, contentHash: contentHash(document) });
    }
    const entries = new Map<string, IndexProjectionEntry>();
    const analysisHashes: string[] = [];
    for (const document of documents) {
      analysisHashes.push(`${document.record.contractAddress}:${document.contentHash}`);
      for (const chainResult of document.record.chains) {
        const exposures = new Map(
          (chainResult.indexWalletExposure ?? []).map((exposure) => [exposure.address, exposure])
        );
        for (const wallet of chainResult.topProfitWallets) {
          const key = `${chainResult.chain}:${wallet.address}`;
          let entry = entries.get(key);
          if (!entry) {
            entry = {
              wallet: {
                chain: chainResult.chain,
                address: wallet.address,
                sourceCount: 0,
                bestRank: wallet.rank,
                lastSeenAt: document.record.generatedAt
              },
              sources: []
            };
            entries.set(key, entry);
          }
          const exposure = exposures.get(wallet.address);
          entry.sources.push({
            chain: chainResult.chain,
            contractAddress: document.record.contractAddress,
            analysisId: document.record.analysisId,
            analysisContentHash: document.contentHash,
            generatedAt: document.record.generatedAt,
            rank: wallet.rank,
            ...(wallet.profitUsd === undefined ? {} : { profitUsd: wallet.profitUsd }),
            ...(wallet.winRate === undefined ? {} : { winRate: wallet.winRate }),
            evidenceAvailable: wallet.evidence !== undefined,
            ...(exposure ? { exposure: this.toExposureSummary(exposure) } : {})
          });
          entry.wallet.sourceCount += 1;
          entry.wallet.bestRank = Math.min(entry.wallet.bestRank, wallet.rank);
          if (Date.parse(document.record.generatedAt) > Date.parse(entry.wallet.lastSeenAt)) {
            entry.wallet.lastSeenAt = document.record.generatedAt;
          }
        }
      }
    }
    const sortedHashes = analysisHashes.sort().join('\n');
    return {
      entries: [...entries.values()],
      contentHash: contentHash(`index-projection-v1\n${sortedHashes}\n`),
      issues: collection.issues
    };
  }

  private toExposureSummary(
    exposure: TrenchWalletExposure
  ): Omit<TrenchWalletExposure, 'evidence'> & { evidenceAvailable: boolean } {
    return {
      address: exposure.address,
      holding: exposure.holding,
      ...(exposure.balance === undefined ? {} : { balance: exposure.balance }),
      ...(exposure.sharePercent === undefined ? {} : { sharePercent: exposure.sharePercent }),
      ...(exposure.valueUsd === undefined ? {} : { valueUsd: exposure.valueUsd }),
      evidenceAvailable: exposure.evidence !== undefined
    };
  }

  private assertProspectiveExposureReferences(incoming: TrenchCaAnalysisV1): void {
    const hasIndexReferences = incoming.chains.some(
      (chainResult) => (chainResult.indexWalletExposure?.length ?? 0) > 0
    );
    const indexKeys = new Set<string>();
    if (hasIndexReferences) {
      const projection = this.buildIndexProjection(incoming.contractAddress, incoming);
      if (projection.issues.length > 0) {
        throw new TrenchRepositoryError(
          'INVALID_STORED_RECORD',
          'Cannot validate prospective Index references while active analyses are invalid'
        );
      }
      for (const entry of projection.entries) {
        indexKeys.add(`${entry.wallet.chain}:${entry.wallet.address}`);
      }
    }
    for (const chainResult of incoming.chains) {
      for (const exposure of chainResult.indexWalletExposure ?? []) {
        if (!indexKeys.has(`${chainResult.chain}:${exposure.address}`)) {
          throw new TrenchRepositoryError(
            'REFERENCE_NOT_FOUND',
            `Index Wallet exposure is not present in the prospective projection: ${chainResult.chain}:${exposure.address}`
          );
        }
      }
      for (const exposure of chainResult.negativeWalletExposure ?? []) {
        const directory = this.negativeWalletDirectory(chainResult.chain, exposure.address);
        const tagPath = join(directory, 'tag.json');
        if (!this.pathEntryExists(tagPath)) {
          throw new TrenchRepositoryError(
            'REFERENCE_NOT_FOUND',
            `Negative Wallet exposure has no live tag: ${chainResult.chain}:${exposure.address}`
          );
        }
        try {
          this.readNegativeTag(tagPath, chainResult.chain, exposure.address);
        } catch {
          throw new TrenchRepositoryError(
            'REFERENCE_NOT_FOUND',
            `Negative Wallet exposure has no valid live tag: ${chainResult.chain}:${exposure.address}`
          );
        }
      }
    }
  }

  private getReferenceStatuses(record: TrenchCaAnalysisV1): TrenchExposureReferenceStatus[] {
    const projection = this.buildIndexProjection();
    const indexKeys = new Set(
      projection.entries.map((entry) => `${entry.wallet.chain}:${entry.wallet.address}`)
    );
    const statuses: TrenchExposureReferenceStatus[] = [];
    for (const chainResult of record.chains) {
      for (const exposure of chainResult.indexWalletExposure ?? []) {
        statuses.push({
          kind: 'index-wallet',
          chain: chainResult.chain,
          address: exposure.address,
          status: indexKeys.has(`${chainResult.chain}:${exposure.address}`)
            ? 'active'
            : 'no-longer-current'
        });
      }
      for (const exposure of chainResult.negativeWalletExposure ?? []) {
        const tagPath = join(
          this.negativeWalletDirectory(chainResult.chain, exposure.address),
          'tag.json'
        );
        let active = false;
        try {
          if (this.pathEntryExists(tagPath)) {
            this.readNegativeTag(tagPath, chainResult.chain, exposure.address);
            active = true;
          }
        } catch {
          active = false;
        }
        statuses.push({
          kind: 'negative-wallet',
          chain: chainResult.chain,
          address: exposure.address,
          status: active ? 'active' : 'no-longer-current'
        });
      }
    }
    return statuses;
  }

  private toAnalysisSummary(document: TrenchDocument<TrenchCaAnalysisV1>): TrenchCaAnalysisSummary {
    return {
      analysisId: document.record.analysisId,
      contractAddress: document.record.contractAddress,
      generatedAt: document.record.generatedAt,
      source: document.record.source,
      chains: document.record.chains.map((chainResult) => ({
        chain: chainResult.chain,
        ...(chainResult.token ? { token: chainResult.token } : {}),
        topProfitWalletCount: chainResult.topProfitWallets.length
      })),
      contentHash: document.contentHash
    };
  }

  private toNegativeSummary(detail: TrenchNegativeWalletDetail): TrenchNegativeWalletSummary {
    return {
      tagId: detail.tag.tagId,
      chain: detail.tag.chain,
      address: detail.tag.address,
      explanation: detail.tag.explanation,
      source: detail.tag.source,
      createdAt: detail.tag.createdAt,
      updatedAt: detail.tag.updatedAt,
      hasHoldings: detail.holdings !== null,
      ...(detail.holdings
        ? {
            holdingsAnalysisId: detail.holdings.analysisId,
            holdingsGeneratedAt: detail.holdings.generatedAt
          }
        : {}),
      contentHash: detail.contentHash
    };
  }

  private analysisMatchesQuery(item: TrenchCaAnalysisSummary, query: string): boolean {
    if (!query) return true;
    const fields = [
      item.analysisId,
      item.contractAddress,
      item.source.kind,
      item.source.agent ?? '',
      item.source.skill ?? '',
      ...item.source.providers,
      ...item.chains.flatMap((chain) => [
        chain.chain,
        chain.token?.name ?? '',
        chain.token?.symbol ?? ''
      ])
    ];
    return fields.some((field) => field.toLowerCase().includes(query));
  }

  private indexMatchesQuery(entry: IndexProjectionEntry, query: string): boolean {
    if (!query) return true;
    return [
      entry.wallet.chain,
      entry.wallet.address,
      ...entry.sources.flatMap((source) => [source.contractAddress, source.analysisId])
    ].some((field) => field.toLowerCase().includes(query));
  }

  private negativeMatchesQuery(item: TrenchNegativeWalletSummary, query: string): boolean {
    if (!query) return true;
    return [item.tagId, item.chain, item.address, item.explanation].some((field) =>
      field.toLowerCase().includes(query)
    );
  }

  private compareIndexEntries(left: IndexProjectionEntry, right: IndexProjectionEntry): number {
    return (
      Date.parse(right.wallet.lastSeenAt) - Date.parse(left.wallet.lastSeenAt) ||
      compareChain(left.wallet.chain, right.wallet.chain) ||
      compareText(left.wallet.address, right.wallet.address)
    );
  }

  private normalizeListInput(input: ListInput): NormalizedListInput {
    let query = '';
    if (input.query !== undefined) {
      if (typeof input.query !== 'string') {
        throw new TrenchRepositoryError('INVALID_INPUT', 'query must be a string');
      }
      query = input.query.trim().toLowerCase();
      if (Array.from(query).length > MAX_QUERY_CODE_POINTS || hasControlCharacter(query)) {
        throw new TrenchRepositoryError(
          'INVALID_INPUT',
          `query must contain at most ${MAX_QUERY_CODE_POINTS} code points and no control characters`
        );
      }
    }
    let limit = DEFAULT_LIST_LIMIT;
    if (input.limit !== undefined) {
      if (
        !Number.isInteger(input.limit) ||
        (input.limit as number) < 1 ||
        (input.limit as number) > TRENCH_MAX_LIST_LIMIT
      ) {
        throw new TrenchRepositoryError(
          'INVALID_INPUT',
          `limit must be an integer from 1 to ${TRENCH_MAX_LIST_LIMIT}`
        );
      }
      limit = input.limit as number;
    }
    let cursor: string | undefined;
    if (input.cursor !== undefined) {
      if (
        typeof input.cursor !== 'string' ||
        !input.cursor ||
        input.cursor.length > MAX_CURSOR_LENGTH ||
        !/^[A-Za-z0-9_-]+$/.test(input.cursor)
      ) {
        throw new TrenchRepositoryError('CURSOR_INVALID', 'cursor is not a valid opaque cursor');
      }
      cursor = input.cursor;
    }
    return { query, limit, ...(cursor ? { cursor } : {}) };
  }

  private pageItems<T>(params: {
    items: T[];
    issues: TrenchStoredIssue[];
    input: NormalizedListInput;
    module: string;
    keyOf: (item: T) => string;
  }): {
    items: T[];
    total: number;
    limit: number;
    nextCursor: string | null;
    revision: number;
    issues: TrenchStoredIssue[];
  } {
    const start = this.resolvePageStart(params.items, params.input, params.module, params.keyOf);
    const items = params.items.slice(start, start + params.input.limit);
    const nextCursor =
      start + items.length < params.items.length
        ? this.encodeCursor({
            module: params.module,
            query: params.input.query,
            key: params.keyOf(items[items.length - 1])
          })
        : null;
    return {
      items,
      total: params.items.length,
      limit: params.input.limit,
      nextCursor,
      revision: this.currentRevision,
      issues: params.issues.slice(0, MAX_ISSUES)
    };
  }

  private resolvePageStart<T>(
    items: T[],
    input: NormalizedListInput,
    module: string,
    keyOf: (item: T) => string
  ): number {
    if (!input.cursor) return 0;
    const cursor = this.decodeCursor(input.cursor);
    if (cursor.epoch !== this.cursorEpoch) {
      throw new TrenchRepositoryError(
        'CURSOR_STALE',
        'Repository instance changed; restart pagination'
      );
    }
    if (cursor.revision !== this.currentRevision) {
      throw new TrenchRepositoryError(
        'CURSOR_STALE',
        'Repository revision changed; restart pagination'
      );
    }
    if (cursor.module !== module || cursor.query !== input.query) {
      throw new TrenchRepositoryError('CURSOR_INVALID', 'cursor does not belong to this query');
    }
    const index = items.findIndex((item) => keyOf(item) === cursor.key);
    if (index < 0)
      throw new TrenchRepositoryError('CURSOR_INVALID', 'cursor item no longer exists');
    return index + 1;
  }

  private encodeCursor(params: Omit<CursorPayload, 'version' | 'epoch' | 'revision'>): string {
    const payload: CursorPayload = {
      version: 2,
      epoch: this.cursorEpoch,
      revision: this.currentRevision,
      ...params
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeCursor(value: string): CursorPayload {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        (parsed as CursorPayload).version !== 2 ||
        typeof (parsed as CursorPayload).epoch !== 'string' ||
        !/^[0-9a-f-]{36}$/.test((parsed as CursorPayload).epoch) ||
        !Number.isSafeInteger((parsed as CursorPayload).revision) ||
        typeof (parsed as CursorPayload).module !== 'string' ||
        typeof (parsed as CursorPayload).query !== 'string' ||
        typeof (parsed as CursorPayload).key !== 'string'
      ) {
        throw new Error('invalid');
      }
      return parsed as CursorPayload;
    } catch {
      throw new TrenchRepositoryError('CURSOR_INVALID', 'cursor could not be decoded');
    }
  }

  private indexSourceKey(source: TrenchIndexWalletSource): string {
    return `${source.generatedAt}\0${source.contractAddress}\0${source.analysisId}\0${source.rank}`;
  }

  private appendIssue(issues: TrenchStoredIssue[], issue: TrenchStoredIssue): void {
    if (issues.length < MAX_ISSUES) issues.push(issue);
  }

  private toStoredIssue(
    entity: TrenchStoredIssue['entity'],
    identity: string,
    error: unknown
  ): TrenchStoredIssue {
    const rawMessage = error instanceof Error ? error.message : 'Stored record is invalid';
    const message = rawMessage
      .replaceAll(this.rootPath, '<trench>')
      .replace(/[\0\r\n]/g, ' ')
      .slice(0, 300);
    return { code: 'INVALID_STORED_RECORD', entity, identity, message };
  }

  private archivePrefix(): string {
    const random = this.options.archiveId?.() ?? this.options.randomId?.() ?? randomUUID();
    const randomHash = createHash('sha256').update(random).digest('hex').slice(0, 16);
    return `${this.now()}-${randomHash}`;
  }

  private commitChange(
    entity: TrenchDataChangedEvent['entity'],
    identity: string,
    operation: TrenchDataChangedEvent['operation']
  ): number {
    this.currentRevision += 1;
    const event: TrenchDataChangedEvent = {
      schema: 'bl-trench-data-changed-v1',
      revision: this.currentRevision,
      entity,
      identity,
      operation
    };
    try {
      this.options.onChanged?.(event);
    } catch (error) {
      console.warn(
        '[trench] data-changed broadcast failed:',
        error instanceof Error ? error.message : 'unknown'
      );
    }
    return this.currentRevision;
  }
}
