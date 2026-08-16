import { createHash, randomUUID } from 'node:crypto';
import type {
  TrenchIndexCompletedBatch,
  TrenchIndexError,
  TrenchIndexErrorCode,
  TrenchIndexRunSummary,
  TrenchIndexStorageAddTargetsAndBeginRunInput,
  TrenchIndexStorageBeginRunInput,
  TrenchIndexStorageBeginRunResult,
  TrenchIndexStorageFailRunInput,
  TrenchIndexStorageTarget,
  TrenchIndexTargetRow,
  TrenchIndexTokenMetadata,
  TrenchIndexWalletRow,
  TrenchIndexWorkspaceSnapshot,
  TrenchIndexXIdentityEvidence,
  TrenchWalletClassificationSource,
} from '@shared/trench/trenchIndex.type';
import {
  TRENCH_INDEX_MAX_TARGETS,
  TRENCH_INDEX_POLICY_VERSION,
} from '@shared/trench/trenchIndex.type';
import type { TrenchJsonObject } from '@shared/trench/trench.type';
import type { TrenchChain } from '@shared/trench/trench.type';
import type {
  TrenchPersonAttachWalletInput,
  TrenchPersonDetail,
  TrenchPersonExternalIdentity,
  TrenchPersonImportInput,
  TrenchPersonImportReceipt,
  TrenchPersonImportRow,
  TrenchPersonListInput,
  TrenchPersonListPage,
  TrenchPersonMutationReceipt,
  TrenchPersonProfileSource,
  TrenchPersonSummary,
  TrenchPersonUpdateProfileInput,
  TrenchPersonWalletAccountRow,
  TrenchPersonWalletLinkSource,
  TrenchPersonWalletRow,
} from '@shared/trench/trenchPerson.type';
import {
  TRENCH_PERSON_DEFAULT_PAGE_SIZE,
  TRENCH_PERSON_MAX_PAGE_SIZE,
  TRENCH_PERSON_PROFIT_MODEL,
} from '@shared/trench/trenchPerson.type';
import {
  normalizeTrenchXIdentity,
  TrenchPersonValidationError,
} from '@shared/trench/trenchPerson.validation';
import type { TrenchIoDatabase } from './trenchIo.database';

interface RepositoryStateRow {
  revision: number;
  current_run_id: string | null;
}

interface RunRow {
  run_id: string;
  request_id: string;
  request_fingerprint: string;
  trigger: TrenchIndexRunSummary['trigger'];
  status: TrenchIndexRunSummary['status'];
  started_at: number;
  completed_at: number | null;
  target_count: number;
  candidate_count: number;
  eligible_count: number;
  published_count: number;
  error_code: TrenchIndexErrorCode | null;
  error_message: string | null;
}

interface TargetRow {
  target_id: string;
  chain: TrenchIndexTargetRow['chain'];
  canonical_address: string;
  address: string;
  state: TrenchIndexTargetRow['state'];
  token_name: string | null;
  token_symbol: string | null;
  price_usd: number | null;
  circulating_supply: number | null;
  current_market_cap_usd: number | null;
  highest_market_cap_usd: number | null;
  highest_market_cap_kind: TrenchIndexTargetRow['highestMarketCapKind'];
  metadata_observed_at: number;
  last_success_at: number | null;
  error_code: TrenchIndexErrorCode | null;
  error_message: string | null;
  error_at: number | null;
  created_at: number;
  updated_at: number;
}

interface WalletRow {
  wallet_id: string;
  wallet_account_id: string;
  chain: TrenchIndexWalletRow['chain'];
  address: string;
  canonical_address: string;
  name: string | null;
  avatar_url: string | null;
  note: string | null;
  metadata_json: string;
  metadata_source: TrenchIndexWalletRow['metadataSource'];
  wallet_kind: TrenchIndexWalletRow['walletKind'];
  classification_source: TrenchIndexWalletRow['classificationSource'];
  classification_updated_at: number;
  chain_rank: number;
  total_profit_usd: number;
  source_ca_count: number;
  profitable_ca_count: number;
  best_source_rank: number;
  realized_profit_usd: number | null;
  unrealized_profit_usd: number | null;
}

interface PersonRow {
  person_id: string;
  status: 'active' | 'merged';
  merged_into_person_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  note: string | null;
  display_name_source: TrenchPersonProfileSource;
  avatar_source: TrenchPersonProfileSource;
  note_source: TrenchPersonProfileSource;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

interface MembershipRow {
  membership_id: string;
  person_id: string;
  wallet_id: string;
  link_source: TrenchPersonWalletLinkSource;
  evidence_json: string;
  linked_at: number;
  updated_at: number;
}

interface PersonImportRow {
  import_id: string;
  request_id: string;
  source_sha256: string;
  content_sha256: string;
  chain: TrenchChain;
  wallet_kind: 'user';
  normalization_version: string;
  chunk_count: number;
  row_count: number;
  status: 'staging' | 'completed';
  created_at: number;
  finalized_at: number | null;
  created_persons: number;
  created_wallets: number;
  created_chain_accounts: number;
  linked_existing_wallets: number;
  skipped_existing_memberships: number;
  collapsed_duplicates: number;
  revision: number;
}

interface PersonImportChunkRow {
  chunk_index: number;
  chunk_hash: string;
  content_json: string;
}

const REGISTRY_EVIDENCE_KEYS = new Set([
  'address', 'wallet', 'wallet_address', 'walletaddress', 'owner', 'account', 'chain',
  'canonical_address', 'canonicaladdress', 'name', 'wallet_name', 'walletname',
  'display_name', 'displayname', 'avatar', 'avatar_url', 'avatarurl', 'note', 'metadata',
  'metadata_json', 'metadatasource', 'metadata_source', 'twitter', 'twitter_username',
  'twitterusername', 'twitter_handle', 'twitterhandle', 'x', 'x_handle', 'xhandle',
  'x_username', 'xusername', 'wallet_score', 'walletscore', 'wallet_kind', 'walletkind',
  'classification_source', 'classificationsource', 'classification_updated_at',
  'classificationupdatedat', 'addr_type', 'addrtype', 'exchange', 'label', 'labels', 'tag',
  'tags', 'maker_token_tags', 'is_amm', 'is_lp', 'is_exchange', 'is_cex', 'is_contract',
]);

const PERSON_IDENTITY_METADATA_KEYS = new Set([
  'twitter', 'twitterusername', 'twitterhandle', 'x', 'xusername', 'xhandle',
]);

const normalizedMetadataKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const assertNoPersonIdentityMetadata = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertNoPersonIdentityMetadata);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (PERSON_IDENTITY_METADATA_KEYS.has(normalizedMetadataKey(key))) {
      throw new TrenchIndexRepositoryError(
        'SOURCE_INVALID',
        'Wallet metadata contains a person-owned identity field.',
      );
    }
    assertNoPersonIdentityMetadata(nested);
  }
};

const assertXIdentity = (
  value: TrenchIndexXIdentityEvidence | null,
  label: string,
): void => {
  if (value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'canonicalValue,displayValue') {
    throw new TrenchIndexRepositoryError('SOURCE_INVALID', `${label} X identity is invalid.`);
  }
  const normalized = normalizeTrenchXIdentity(value.displayValue);
  if (!normalized || normalized.canonicalValue !== value.canonicalValue ||
    normalized.displayValue !== value.displayValue) {
    throw new TrenchIndexRepositoryError('SOURCE_INVALID', `${label} X identity is invalid.`);
  }
};

export class TrenchIndexRepositoryError extends Error {
  constructor(
    readonly code: TrenchIndexErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TrenchIndexRepositoryError';
  }
}

const assertFiniteOrNull = (value: number | null, label: string, nonNegative = false): void => {
  if (value === null) return;
  if (!Number.isFinite(value) || (nonNegative && value < 0)) {
    throw new TrenchIndexRepositoryError('SOURCE_INVALID', `${label} is invalid.`);
  }
};

const assertTimestamp = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TrenchIndexRepositoryError('SOURCE_INVALID', `${label} is invalid.`);
  }
};

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const assertFingerprint = (value: string): void => {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new TrenchIndexRepositoryError('INVALID_INPUT', 'Request fingerprint is invalid.');
  }
};

const assertNoRegistryEvidence = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(assertNoRegistryEvidence);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (REGISTRY_EVIDENCE_KEYS.has(key.toLowerCase())) {
      throw new TrenchIndexRepositoryError(
        'SOURCE_INVALID',
        `Candidate evidence contains registry-owned field: ${key}.`,
      );
    }
    assertNoRegistryEvidence(nested);
  }
};

const parseObject = (value: string): TrenchJsonObject => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as TrenchJsonObject
      : {};
  } catch {
    return {};
  }
};

const highestMarketCapPriority: Record<TrenchIndexTokenMetadata['highestMarketCapKind'], number> = {
  unavailable: 0,
  observed: 1,
  'estimated-ath': 2,
  'provider-ath': 3,
};

const preferredHighestMarketCap = (
  stored: Pick<TrenchIndexTokenMetadata, 'highestMarketCapUsd' | 'highestMarketCapKind'>,
  incoming: Pick<TrenchIndexTokenMetadata, 'highestMarketCapUsd' | 'highestMarketCapKind'>,
): Pick<TrenchIndexTokenMetadata, 'highestMarketCapUsd' | 'highestMarketCapKind'> => {
  if (stored.highestMarketCapUsd === null) return incoming;
  if (incoming.highestMarketCapUsd === null) return stored;
  if (stored.highestMarketCapUsd !== incoming.highestMarketCapUsd) {
    return stored.highestMarketCapUsd > incoming.highestMarketCapUsd ? stored : incoming;
  }
  return highestMarketCapPriority[stored.highestMarketCapKind] >=
    highestMarketCapPriority[incoming.highestMarketCapKind]
    ? stored
    : incoming;
};

const walletKindPriority: Record<TrenchIndexWalletRow['walletKind'], number> = {
  unknown: 0,
  user: 1,
  amm: 2,
  exchange: 3,
  contract: 4,
};

const classificationSourcePriority: Record<TrenchWalletClassificationSource, number> = {
  unclassified: 0,
  import: 1,
  'gmgn-addr-type': 2,
  'gmgn-label': 3,
  'chain-known': 4,
  agent: 5,
  manual: 6,
  mixed: 7,
};

const personProfileSourcePriority: Record<TrenchPersonProfileSource, number> = {
  system: 0,
  import: 1,
  gmgn: 2,
  agent: 3,
  manual: 4,
};

interface PersonCursor {
  schema: 'bl-trench-person-cursor-v1';
  revision: number;
  query: string;
  updatedAt: number;
  personId: string;
}

const encodePersonCursor = (cursor: PersonCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const decodePersonCursor = (value: string): PersonCursor => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const cursor = parsed as Partial<PersonCursor>;
    if (cursor.schema !== 'bl-trench-person-cursor-v1' ||
      !Number.isSafeInteger(cursor.revision) || (cursor.revision ?? -1) < 0 ||
      typeof cursor.query !== 'string' || typeof cursor.updatedAt !== 'number' ||
      !Number.isSafeInteger(cursor.updatedAt) || cursor.updatedAt < 0 ||
      typeof cursor.personId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(cursor.personId) || Object.keys(cursor).length !== 5) throw new Error('invalid');
    return cursor as PersonCursor;
  } catch {
    throw new TrenchIndexRepositoryError('CURSOR_INVALID', 'The person cursor is invalid.');
  }
};

const addressNamespace = (chain: TrenchChain): 'evm' | 'solana' =>
  chain === 'solana' ? 'solana' : 'evm';

interface PublishedPersonEvidence {
  displayName: string | null;
  avatarUrl: string | null;
  xIdentity: (TrenchIndexXIdentityEvidence & { targetId: string; sourceRank: number }) | null;
}

interface PersonFieldEvidence {
  value: string | null;
  source: TrenchPersonProfileSource;
}

const walletMetadataPersonSource = (
  source: TrenchIndexWalletRow['metadataSource'],
): TrenchPersonProfileSource => source === 'mixed' ? 'agent' : source;

const walletMetadataIsCurated = (
  source: TrenchIndexWalletRow['metadataSource'],
): boolean => source === 'manual' || source === 'agent' || source === 'mixed';

const providerClassificationPriority = (
  walletKind: TrenchIndexWalletRow['walletKind'],
  source: TrenchWalletClassificationSource,
): number => {
  if (source === 'chain-known') return 50;
  if (walletKind === 'amm' || walletKind === 'exchange' || walletKind === 'contract') {
    return 40 + walletKindPriority[walletKind];
  }
  if (walletKind === 'unknown' && (source === 'gmgn-label' || source === 'gmgn-addr-type')) {
    return 35;
  }
  if (walletKind === 'user') return 20;
  return 0;
};

const runSummary = (row: RunRow | undefined): TrenchIndexRunSummary | null => row ? ({
  runId: row.run_id,
  trigger: row.trigger,
  status: row.status,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  targetCount: row.target_count,
  candidateCount: row.candidate_count,
  eligibleCount: row.eligible_count,
  publishedCount: row.published_count,
  errorCode: row.error_code,
  errorMessage: row.error_message,
}) : null;

const target = (row: TargetRow): TrenchIndexTargetRow => ({
  targetId: row.target_id,
  chain: row.chain,
  contractAddress: row.address,
  canonicalAddress: row.canonical_address,
  state: row.state,
  name: row.token_name,
  symbol: row.token_symbol,
  priceUsd: row.price_usd,
  circulatingSupply: row.circulating_supply,
  currentMarketCapUsd: row.current_market_cap_usd,
  highestMarketCapUsd: row.highest_market_cap_usd,
  highestMarketCapKind: row.highest_market_cap_kind,
  observedAt: row.metadata_observed_at,
  lastSuccessAt: row.last_success_at,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  errorAt: row.error_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const storageTarget = (row: Pick<TargetRow, 'target_id' | 'chain' | 'address' | 'canonical_address'>): TrenchIndexStorageTarget => ({
  targetId: row.target_id,
  chain: row.chain,
  contractAddress: row.address,
  canonicalAddress: row.canonical_address,
});

export class TrenchIoRepository {
  constructor(
    private readonly database: TrenchIoDatabase,
    private readonly now: () => number = Date.now,
    private readonly uuid: () => string = randomUUID,
  ) {}

  initialize(): void {
    this.database.transaction(() => {
      const interrupted = this.database.raw.prepare(
        "SELECT * FROM trench_index_runs WHERE status='running' ORDER BY started_at DESC,run_id",
      ).all() as RunRow[];
      if (interrupted.length === 0) return;
      const failedAt = this.now();
      for (const run of interrupted) {
        this.database.raw.prepare(`
          UPDATE trench_index_runs
          SET status='failed',completed_at=?,error_code='INTERNAL',error_message=?
          WHERE run_id=? AND status='running'
        `).run(failedAt, 'Analysis was interrupted before atomic publication.', run.run_id);
      }
      this.database.raw.prepare(`
        UPDATE trench_index_targets
        SET state=CASE WHEN last_success_at IS NULL THEN 'error' ELSE 'ready' END,
            error_code=CASE WHEN last_success_at IS NULL THEN 'INTERNAL' ELSE NULL END,
            error_message=CASE WHEN last_success_at IS NULL THEN ? ELSE NULL END,
            error_at=CASE WHEN last_success_at IS NULL THEN ? ELSE NULL END,
            updated_at=?
        WHERE active=1 AND state='analyzing'
      `).run('Analysis was interrupted before atomic publication.', failedAt, failedAt);
      this.bumpRevision(failedAt);
    });
    this.database.assertHealthy();
  }

  getWorkspace(): TrenchIndexWorkspaceSnapshot {
    return this.database.readTransaction(() => {
      const state = this.state();
      const activeRun = this.database.raw.prepare(
        "SELECT * FROM trench_index_runs WHERE status='running' ORDER BY started_at DESC,run_id LIMIT 1",
      ).get() as RunRow | undefined;
      const currentRun = state.current_run_id
        ? this.database.raw.prepare('SELECT * FROM trench_index_runs WHERE run_id=?')
          .get(state.current_run_id) as RunRow | undefined
        : undefined;
      const lastFailed = this.database.raw.prepare(
        "SELECT * FROM trench_index_runs WHERE status='failed' ORDER BY completed_at DESC,run_id LIMIT 1",
      ).get() as RunRow | undefined;
      const targets = (this.database.raw.prepare(`
        SELECT * FROM trench_index_targets WHERE active=1 ORDER BY created_at,target_id
      `).all() as TargetRow[]).map(target);
      const wallets = state.current_run_id
        ? (this.database.raw.prepare(`
            SELECT w.*,a.wallet_account_id,a.chain,a.wallet_kind,a.classification_source,
                   a.classification_updated_at,i.chain_rank,i.total_profit_usd,i.source_ca_count,
                   i.profitable_ca_count,i.best_source_rank,i.realized_profit_usd,
                   i.unrealized_profit_usd
            FROM trench_index_wallets i
            JOIN trench_wallet_chain_accounts a ON a.wallet_account_id=i.wallet_account_id
            JOIN trench_wallets w ON w.wallet_id=a.wallet_id
            WHERE i.run_id=?
            ORDER BY CASE i.chain WHEN 'solana' THEN 0 WHEN 'bsc' THEN 1 ELSE 2 END,i.chain_rank
          `).all(state.current_run_id) as WalletRow[]).map((row): TrenchIndexWalletRow => ({
            walletId: row.wallet_id,
            walletAccountId: row.wallet_account_id,
            chain: row.chain,
            address: row.address,
            canonicalAddress: row.canonical_address,
            name: row.name,
            avatarUrl: row.avatar_url,
            note: row.note,
            metadata: parseObject(row.metadata_json),
            metadataSource: row.metadata_source,
            walletKind: row.wallet_kind,
            classificationSource: row.classification_source,
            classificationUpdatedAt: row.classification_updated_at,
            chainRank: row.chain_rank,
            totalProfitUsd: row.total_profit_usd,
            sourceCaCount: row.source_ca_count,
            profitableCaCount: row.profitable_ca_count,
            bestSourceRank: row.best_source_rank,
            realizedProfitUsd: row.realized_profit_usd,
            unrealizedProfitUsd: row.unrealized_profit_usd,
          }))
        : [];
      return {
        schema: 'bl-trench-index-workspace-v2',
        revision: state.revision,
        jobState: activeRun ? 'running' : 'idle',
        activeRun: runSummary(activeRun),
        currentRun: runSummary(currentRun),
        lastFailedRun: runSummary(lastFailed),
        chainProjections: (['solana', 'bsc', 'robinhood'] as const)
          .filter((chain) => chain !== 'robinhood' ||
            targets.some((row) => row.chain === chain) || wallets.some((row) => row.chain === chain))
          .map((chain) => ({
            chain,
            targets: targets.filter((row) => row.chain === chain),
            wallets: wallets.filter((row) => row.chain === chain),
          })),
      };
    });
  }

  listPersons(input: TrenchPersonListInput = {}): TrenchPersonListPage {
    return this.database.readTransaction(() => {
      const state = this.state();
      const query = input.query?.trim() ?? '';
      const limit = input.limit ?? TRENCH_PERSON_DEFAULT_PAGE_SIZE;
      if (Array.from(query).length > 200 || !Number.isInteger(limit) || limit < 1 ||
        limit > TRENCH_PERSON_MAX_PAGE_SIZE) {
        throw new TrenchIndexRepositoryError('INVALID_INPUT', 'The person list request is invalid.');
      }
      const cursor = input.cursor ? decodePersonCursor(input.cursor) : null;
      if (cursor && cursor.revision !== state.revision) {
        throw new TrenchIndexRepositoryError('CURSOR_STALE', 'People changed while paging.');
      }
      if (cursor && cursor.query !== query) {
        throw new TrenchIndexRepositoryError('CURSOR_INVALID', 'The person cursor query does not match.');
      }
      const like = `%${query.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
      const rows = this.database.raw.prepare(`
        SELECT p.* FROM trench_persons p
        WHERE p.status='active'
          AND (?='' OR lower(COALESCE(p.display_name,'')) LIKE ? ESCAPE '\\'
            OR lower(COALESCE(p.note,'')) LIKE ? ESCAPE '\\'
            OR EXISTS (
              SELECT 1 FROM trench_person_wallets pw
              JOIN trench_wallets w ON w.wallet_id=pw.wallet_id
              WHERE pw.person_id=p.person_id AND (
                lower(w.canonical_address) LIKE ? ESCAPE '\\'
                OR lower(COALESCE(w.name,'')) LIKE ? ESCAPE '\\'
                OR lower(COALESCE(w.note,'')) LIKE ? ESCAPE '\\'
              )
            ))
          AND (? IS NULL OR p.updated_at < ? OR (p.updated_at=? AND p.person_id>?))
        ORDER BY p.updated_at DESC,p.person_id ASC LIMIT ?
      `).all(
        query, like, like, like, like, like,
        cursor?.personId ?? null, cursor?.updatedAt ?? 0, cursor?.updatedAt ?? 0,
        cursor?.personId ?? '', limit + 1,
      ) as PersonRow[];
      const pageRows = rows.slice(0, limit);
      const tail = pageRows.at(-1);
      return {
        schema: 'bl-trench-person-list-v1',
        revision: state.revision,
        items: pageRows.map((row) => this.personSummary(row)),
        nextCursor: rows.length > limit && tail ? encodePersonCursor({
          schema: 'bl-trench-person-cursor-v1',
          revision: state.revision,
          query,
          updatedAt: tail.updated_at,
          personId: tail.person_id,
        }) : null,
      };
    });
  }

  getPerson(personId: string): TrenchPersonDetail {
    return this.database.readTransaction(() => {
      const resolved = this.resolveActivePerson(personId);
      if (!resolved) throw new TrenchIndexRepositoryError('NOT_FOUND', 'The person was not found.');
      const { person, resolvedFromPersonId } = resolved;
      const memberships = this.database.raw.prepare(`
        SELECT pw.*,w.address_namespace,w.address,w.canonical_address,w.name,w.avatar_url,w.note,
          w.metadata_json
        FROM trench_person_wallets pw JOIN trench_wallets w ON w.wallet_id=pw.wallet_id
        WHERE pw.person_id=? ORDER BY w.address_namespace,w.canonical_address,w.wallet_id
      `).all(person.person_id) as Array<MembershipRow & {
        address_namespace: 'evm' | 'solana';
        address: string;
        canonical_address: string;
        name: string | null;
        avatar_url: string | null;
        note: string | null;
        metadata_json: string;
      }>;
      const wallets: TrenchPersonWalletRow[] = memberships.map((membership) => {
        const accounts = this.database.raw.prepare(`
          SELECT a.*,i.chain_rank,i.total_profit_usd,i.realized_profit_usd,i.unrealized_profit_usd
          FROM trench_wallet_chain_accounts a
          LEFT JOIN trench_repository_state s ON s.id=1
          LEFT JOIN trench_index_wallets i ON i.run_id=s.current_run_id
            AND i.wallet_account_id=a.wallet_account_id
          WHERE a.wallet_id=?
          ORDER BY CASE a.chain WHEN 'solana' THEN 0 WHEN 'bsc' THEN 1 ELSE 2 END
        `).all(membership.wallet_id) as Array<{
          wallet_account_id: string;
          chain: TrenchChain;
          wallet_kind: TrenchIndexWalletRow['walletKind'];
          classification_source: TrenchWalletClassificationSource;
          classification_updated_at: number;
          first_seen_at: number;
          last_seen_at: number;
          chain_rank: number | null;
          total_profit_usd: number | null;
          realized_profit_usd: number | null;
          unrealized_profit_usd: number | null;
        }>;
        return {
          walletId: membership.wallet_id,
          addressNamespace: membership.address_namespace,
          address: membership.address,
          canonicalAddress: membership.canonical_address,
          name: membership.name,
          avatarUrl: membership.avatar_url,
          note: membership.note,
          metadata: parseObject(membership.metadata_json),
          membershipSource: membership.link_source,
          accounts: accounts.map((account): TrenchPersonWalletAccountRow => ({
            walletAccountId: account.wallet_account_id,
            chain: account.chain,
            walletKind: account.wallet_kind,
            classificationSource: account.classification_source,
            classificationUpdatedAt: account.classification_updated_at,
            firstSeenAt: account.first_seen_at,
            lastSeenAt: account.last_seen_at,
            currentChainRank: account.chain_rank,
            currentTotalProfitUsd: account.total_profit_usd,
            currentRealizedProfitUsd: account.realized_profit_usd,
            currentUnrealizedProfitUsd: account.unrealized_profit_usd,
          })),
        };
      });
      const externalIdentities = (this.database.raw.prepare(`
        SELECT provider,canonical_value,display_value,source,evidence_json,created_at,updated_at
        FROM trench_person_external_identities WHERE person_id=?
        ORDER BY provider,canonical_value
      `).all(person.person_id) as Array<{
        provider: 'x';
        canonical_value: string;
        display_value: string;
        source: TrenchPersonProfileSource;
        evidence_json: string;
        created_at: number;
        updated_at: number;
      }>).map((identity): TrenchPersonExternalIdentity => ({
        provider: identity.provider,
        canonicalValue: identity.canonical_value,
        displayValue: identity.display_value,
        source: identity.source,
        evidence: parseObject(identity.evidence_json),
        createdAt: identity.created_at,
        updatedAt: identity.updated_at,
      }));
      return {
        ...this.personSummary(person),
        resolvedFromPersonId,
        metadata: parseObject(person.metadata_json),
        wallets,
        externalIdentities,
      };
    });
  }

  updatePersonProfile(input: TrenchPersonUpdateProfileInput): TrenchPersonMutationReceipt {
    return this.database.transaction(() => {
      this.assertExpectedRevision(input.expectedRevision);
      this.assertProfileEdit(input);
      const resolved = this.resolveActivePerson(input.personId);
      if (!resolved || resolved.resolvedFromPersonId) {
        throw new TrenchIndexRepositoryError('NOT_FOUND', 'The active person was not found.');
      }
      const assignments: string[] = [];
      const values: unknown[] = [];
      for (const [property, column, sourceColumn] of [
        ['displayName', 'display_name', 'display_name_source'],
        ['avatarUrl', 'avatar_url', 'avatar_source'],
        ['note', 'note', 'note_source'],
      ] as const) {
        if (!Object.hasOwn(input, property)) continue;
        assignments.push(`${column}=?`, `${sourceColumn}='manual'`);
        values.push(input[property]);
      }
      if (assignments.length === 0) {
        throw new TrenchIndexRepositoryError('INVALID_INPUT', 'At least one profile field is required.');
      }
      const now = this.now();
      this.database.raw.prepare(`
        UPDATE trench_persons SET ${assignments.join(',')},updated_at=?
        WHERE person_id=? AND status='active'
      `).run(...values, now, input.personId);
      return { personId: input.personId, revision: this.bumpRevision(now) };
    });
  }

  attachWalletToPerson(input: TrenchPersonAttachWalletInput): TrenchPersonMutationReceipt {
    return this.database.transaction(() => {
      this.assertExpectedRevision(input.expectedRevision);
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidPattern.test(input.personId) || !uuidPattern.test(input.walletId) ||
        (input.expectedCurrentPersonId !== null &&
          !uuidPattern.test(input.expectedCurrentPersonId))) {
        throw new TrenchIndexRepositoryError('INVALID_INPUT', 'The membership edit is invalid.');
      }
      const person = this.resolveActivePerson(input.personId);
      if (!person || person.resolvedFromPersonId) {
        throw new TrenchIndexRepositoryError('NOT_FOUND', 'The active person was not found.');
      }
      const wallet = this.database.raw.prepare('SELECT wallet_id FROM trench_wallets WHERE wallet_id=?')
        .get(input.walletId) as { wallet_id: string } | undefined;
      if (!wallet) throw new TrenchIndexRepositoryError('NOT_FOUND', 'The wallet was not found.');
      const existing = this.database.raw.prepare(
        'SELECT * FROM trench_person_wallets WHERE wallet_id=?',
      ).get(input.walletId) as MembershipRow | undefined;
      if ((existing?.person_id ?? null) !== input.expectedCurrentPersonId) {
        throw new TrenchIndexRepositoryError(
          'MEMBERSHIP_CONFLICT',
          'The wallet membership changed before this edit.',
        );
      }
      const now = this.now();
      if (existing) {
        this.database.raw.prepare(`
          UPDATE trench_person_wallets SET person_id=?,link_source='manual',evidence_json='{}',
            updated_at=? WHERE membership_id=?
        `).run(input.personId, now, existing.membership_id);
      } else {
        this.database.raw.prepare(`
          INSERT INTO trench_person_wallets (
            membership_id,person_id,wallet_id,link_source,evidence_json,linked_at,updated_at
          ) VALUES (?,?,?,'manual','{}',?,?)
        `).run(this.uuid(), input.personId, input.walletId, now, now);
      }
      this.database.raw.prepare('UPDATE trench_persons SET updated_at=? WHERE person_id=?')
        .run(now, input.personId);
      return { personId: input.personId, revision: this.bumpRevision(now) };
    });
  }

  importPersonWallets(input: TrenchPersonImportInput): TrenchPersonImportReceipt {
    return this.database.transaction(() => {
      const chunkDocument = JSON.stringify(input.rows);
      if (sha256Hex(chunkDocument) !== input.chunkHash) {
        throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'The import chunk hash is invalid.');
      }
      const candidates = this.database.raw.prepare(`
        SELECT * FROM trench_person_imports
        WHERE import_id=? OR request_id=? OR
          (source_sha256=? AND chain=? AND normalization_version=?)
      `).all(
        input.importId,
        input.requestId,
        input.sourceSha256,
        input.chain,
        input.normalizationVersion,
      ) as PersonImportRow[];
      const existing = candidates[0];
      if (candidates.some((candidate) => candidate.import_id !== existing?.import_id) ||
        (existing && !this.personImportEnvelopeMatches(existing, input))) {
        throw new TrenchIndexRepositoryError('REQUEST_CONFLICT', 'The import identity or content conflicts.');
      }
      const now = this.now();
      if (!existing) {
        this.database.raw.prepare(`
          INSERT INTO trench_person_imports (
            import_id,request_id,source_sha256,content_sha256,chain,wallet_kind,
            normalization_version,chunk_count,row_count,status,created_at
          ) VALUES (?,?,?,?,?, 'user',?,?,?,'staging',?)
        `).run(
          input.importId,
          input.requestId,
          input.sourceSha256,
          input.contentSha256,
          input.chain,
          input.normalizationVersion,
          input.chunkCount,
          input.rowCount,
          now,
        );
      }
      const importRow = existing ?? this.database.raw.prepare(
        'SELECT * FROM trench_person_imports WHERE import_id=?',
      ).get(input.importId) as PersonImportRow;
      const priorChunk = this.database.raw.prepare(`
        SELECT chunk_index,chunk_hash,content_json FROM trench_person_import_chunks
        WHERE import_id=? AND chunk_index=?
      `).get(input.importId, input.chunkIndex) as PersonImportChunkRow | undefined;
      if (priorChunk && (priorChunk.chunk_hash !== input.chunkHash ||
        priorChunk.content_json !== chunkDocument)) {
        throw new TrenchIndexRepositoryError('REQUEST_CONFLICT', 'The import chunk conflicts.');
      }
      if (importRow.status === 'completed') {
        if (!priorChunk) {
          throw new TrenchIndexRepositoryError('REQUEST_CONFLICT', 'The completed import chunk conflicts.');
        }
        return this.personImportReceipt(importRow, input.chunkCount, true);
      }
      const stagedBefore = this.personImportStagedCount(input.importId);
      if (!priorChunk) {
        if (input.chunkIndex !== stagedBefore) {
          throw new TrenchIndexRepositoryError('REQUEST_CONFLICT', 'Import chunks must be staged in order.');
        }
        this.database.raw.prepare(`
          INSERT INTO trench_person_import_chunks (
            import_id,chunk_index,chunk_hash,content_json,created_at
          ) VALUES (?,?,?,?,?)
        `).run(input.importId, input.chunkIndex, input.chunkHash, chunkDocument, now);
      }
      const stagedChunkCount = this.personImportStagedCount(input.importId);
      if (!input.finalize) {
        return this.personImportReceipt(importRow, stagedChunkCount, priorChunk !== undefined);
      }
      if (input.chunkIndex !== input.chunkCount - 1 || stagedChunkCount !== input.chunkCount) {
        throw new TrenchIndexRepositoryError('REQUEST_CONFLICT', 'The import is missing ordered chunks.');
      }
      const chunks = this.database.raw.prepare(`
        SELECT chunk_index,chunk_hash,content_json FROM trench_person_import_chunks
        WHERE import_id=? ORDER BY chunk_index
      `).all(input.importId) as PersonImportChunkRow[];
      const rows = chunks.flatMap((chunk, index): TrenchPersonImportRow[] => {
        if (chunk.chunk_index !== index || sha256Hex(chunk.content_json) !== chunk.chunk_hash) {
          throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'The staged import chunks are invalid.');
        }
        const parsed = JSON.parse(chunk.content_json) as unknown;
        if (!Array.isArray(parsed)) {
          throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'The staged import content is invalid.');
        }
        return parsed as TrenchPersonImportRow[];
      });
      if (rows.length !== input.rowCount || sha256Hex(JSON.stringify(rows)) !== input.contentSha256) {
        throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'The import content hash is invalid.');
      }
      const uniqueRows = new Map<string, TrenchPersonImportRow>();
      let collapsedDuplicates = 0;
      for (const row of rows) {
        const prior = uniqueRows.get(row.address);
        if (!prior) {
          uniqueRows.set(row.address, row);
          continue;
        }
        if (prior.name !== row.name || prior.displayEmoji !== row.displayEmoji) {
          throw new TrenchIndexRepositoryError('REQUEST_CONFLICT', 'The import has conflicting duplicate rows.');
        }
        collapsedDuplicates += 1;
      }
      const counts = {
        createdPersons: 0,
        createdWallets: 0,
        createdChainAccounts: 0,
        linkedExistingWallets: 0,
        skippedExistingMemberships: 0,
      };
      for (const row of uniqueRows.values()) this.publishImportedPersonWallet(input, row, now, counts);
      const revision = this.bumpRevision(now);
      this.database.raw.prepare(`
        UPDATE trench_person_imports SET status='completed',finalized_at=?,created_persons=?,
          created_wallets=?,created_chain_accounts=?,linked_existing_wallets=?,
          skipped_existing_memberships=?,collapsed_duplicates=?,revision=?
        WHERE import_id=? AND status='staging'
      `).run(
        now,
        counts.createdPersons,
        counts.createdWallets,
        counts.createdChainAccounts,
        counts.linkedExistingWallets,
        counts.skippedExistingMemberships,
        collapsedDuplicates,
        revision,
        input.importId,
      );
      const completed = this.database.raw.prepare(
        'SELECT * FROM trench_person_imports WHERE import_id=?',
      ).get(input.importId) as PersonImportRow;
      return this.personImportReceipt(completed, input.chunkCount, false);
    });
  }

  addTargetsAndBeginRun(
    input: TrenchIndexStorageAddTargetsAndBeginRunInput,
  ): TrenchIndexStorageBeginRunResult {
    assertFingerprint(input.requestFingerprint);
    return this.database.transaction(() => {
      const replay = this.replay(input.requestId, input.requestFingerprint, 'add-target');
      if (replay) return replay;
      this.assertIdle();
      if (input.targets.length < 1 || input.targets.length > TRENCH_INDEX_MAX_TARGETS) {
        throw new TrenchIndexRepositoryError('INVALID_INPUT', 'Target batch size is invalid.');
      }
      const identities = new Set<string>();
      for (const target of input.targets) {
        this.assertMetadata(target.metadata);
        const identity = `${target.chain}:${target.canonicalAddress}`;
        if (identities.has(identity)) {
          throw new TrenchIndexRepositoryError('INVALID_INPUT', 'Target batch contains a duplicate CA.');
        }
        identities.add(identity);
      }
      const now = this.now();
      for (const inputTarget of input.targets) {
        const existing = this.database.raw.prepare(`
          SELECT * FROM trench_index_targets WHERE chain=? AND canonical_address=?
        `).get(inputTarget.chain, inputTarget.canonicalAddress) as TargetRow | undefined;
        const targetId = existing?.target_id ?? this.uuid();
        if (existing) {
          const highest = preferredHighestMarketCap({
            highestMarketCapUsd: existing.highest_market_cap_usd,
            highestMarketCapKind: existing.highest_market_cap_kind,
          }, inputTarget.metadata);
          this.database.raw.prepare(`
            UPDATE trench_index_targets
            SET address=?,active=1,state='pending',token_name=?,token_symbol=?,price_usd=?,
                circulating_supply=?,current_market_cap_usd=?,highest_market_cap_usd=?,
                highest_market_cap_kind=?,metadata_observed_at=?,error_code=NULL,error_message=NULL,
                error_at=NULL,updated_at=?
            WHERE target_id=?
          `).run(
            inputTarget.contractAddress, inputTarget.metadata.name, inputTarget.metadata.symbol,
            inputTarget.metadata.priceUsd, inputTarget.metadata.circulatingSupply,
            inputTarget.metadata.currentMarketCapUsd, highest.highestMarketCapUsd,
            highest.highestMarketCapKind, inputTarget.metadata.observedAt, now, targetId,
          );
        } else {
          this.database.raw.prepare(`
            INSERT INTO trench_index_targets (
              target_id,chain,canonical_address,address,active,state,token_name,token_symbol,price_usd,
              circulating_supply,current_market_cap_usd,highest_market_cap_usd,
              highest_market_cap_kind,metadata_observed_at,created_at,updated_at
            ) VALUES (?,?,?,?,1,'pending',?,?,?,?,?,?,?,?,?,?)
          `).run(
            targetId, inputTarget.chain, inputTarget.canonicalAddress, inputTarget.contractAddress,
            inputTarget.metadata.name, inputTarget.metadata.symbol, inputTarget.metadata.priceUsd,
            inputTarget.metadata.circulatingSupply, inputTarget.metadata.currentMarketCapUsd,
            inputTarget.metadata.highestMarketCapUsd, inputTarget.metadata.highestMarketCapKind,
            inputTarget.metadata.observedAt, now, now,
          );
        }
      }
      return this.createRun(input.requestId, input.requestFingerprint, 'add-target', now);
    });
  }

  beginRun(input: TrenchIndexStorageBeginRunInput): TrenchIndexStorageBeginRunResult {
    assertFingerprint(input.requestFingerprint);
    return this.database.transaction(() => {
      const replay = this.replay(input.requestId, input.requestFingerprint, input.trigger);
      if (replay) return replay;
      this.assertIdle();
      return this.createRun(input.requestId, input.requestFingerprint, input.trigger, this.now());
    });
  }

  completeRun(batch: TrenchIndexCompletedBatch): { revision: number } {
    assertTimestamp(batch.observedAt, 'completed batch observedAt');
    return this.database.transaction(() => {
      const run = this.database.raw.prepare('SELECT * FROM trench_index_runs WHERE run_id=?')
        .get(batch.runId) as RunRow | undefined;
      if (!run || run.status !== 'running') {
        throw new TrenchIndexRepositoryError('REQUEST_CONFLICT', 'The analysis run is not active.');
      }
      const expectedTargets = this.runTargets(batch.runId);
      const actualIds = new Set(batch.targets.map(({ targetId }) => targetId));
      if (actualIds.size !== batch.targets.length || actualIds.size !== expectedTargets.length ||
        expectedTargets.some(({ targetId }) => !actualIds.has(targetId))) {
        throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Completed target set does not match the run snapshot.');
      }
      const candidateKeys = new Set<string>();
      let candidateCount = 0;
      let eligibleCount = 0;
      for (const analysis of batch.targets) {
        const expectedTarget = expectedTargets.find(({ targetId }) => targetId === analysis.targetId);
        if (!expectedTarget || analysis.chain !== expectedTarget.chain ||
          analysis.contractAddress !== expectedTarget.contractAddress) {
          throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Completed target belongs to the wrong chain.');
        }
        if (analysis.candidates.length > 100) {
          throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'A target exceeds 100 candidates.');
        }
        this.assertMetadata(analysis.metadata);
        for (const candidate of analysis.candidates) {
          if (candidate.wallet.chain !== analysis.chain) {
            throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Candidate wallet belongs to the wrong chain.');
          }
          candidateCount += 1;
          if (candidate.eligible) eligibleCount += 1;
          assertFiniteOrNull(candidate.profitUsd, 'candidate profit');
          assertFiniteOrNull(candidate.realizedProfitUsd, 'candidate realized profit');
          assertFiniteOrNull(candidate.unrealizedProfitUsd, 'candidate unrealized profit');
          if (!Number.isInteger(candidate.sourceRank) || candidate.sourceRank < 1 || candidate.sourceRank > 100 ||
            candidate.eligible !== (candidate.wallet.walletKind === 'user') ||
            candidate.eligible !== (candidate.exclusionReason === null)) {
            throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Candidate eligibility is inconsistent.');
          }
          assertXIdentity(candidate.xIdentity, 'Candidate');
          assertNoPersonIdentityMetadata(candidate.wallet.metadata);
          const key = `${analysis.targetId}:${candidate.wallet.chain}:${candidate.wallet.canonicalAddress}`;
          if (candidateKeys.has(key)) {
            throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Completed batch contains a duplicate candidate.');
          }
          candidateKeys.add(key);
          assertNoRegistryEvidence(candidate.evidence);
        }
      }
      if (batch.wallets.length > 900) {
        throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Published INDEX exceeds 300 wallets per chain.');
      }

      const walletIds = new Map<string, string>();
      const walletAccountIds = new Map<string, string>();
      for (const analysis of batch.targets) {
        const metadata = analysis.metadata;
        this.database.raw.prepare(`
          UPDATE trench_index_target_snapshots
          SET token_name=?,token_symbol=?,price_usd=?,circulating_supply=?,current_market_cap_usd=?,
              highest_market_cap_usd=?,highest_market_cap_kind=?,observed_at=?
          WHERE run_id=? AND target_id=?
        `).run(
          metadata.name, metadata.symbol, metadata.priceUsd, metadata.circulatingSupply,
          metadata.currentMarketCapUsd, metadata.highestMarketCapUsd,
          metadata.highestMarketCapKind, metadata.observedAt, batch.runId, analysis.targetId,
        );
        const current = this.database.raw.prepare(`
          SELECT highest_market_cap_usd,highest_market_cap_kind
          FROM trench_index_targets WHERE target_id=?
        `).get(analysis.targetId) as {
          highest_market_cap_usd: number | null;
          highest_market_cap_kind: TrenchIndexTargetRow['highestMarketCapKind'];
        } | undefined;
        const highest = preferredHighestMarketCap({
          highestMarketCapUsd: current?.highest_market_cap_usd ?? null,
          highestMarketCapKind: current?.highest_market_cap_kind ?? 'unavailable',
        }, metadata);
        this.database.raw.prepare(`
          UPDATE trench_index_targets
          SET state='ready',token_name=?,token_symbol=?,price_usd=?,circulating_supply=?,
              current_market_cap_usd=?,highest_market_cap_usd=?,highest_market_cap_kind=?,
              metadata_observed_at=?,last_success_at=?,error_code=NULL,error_message=NULL,error_at=NULL,
              updated_at=?
          WHERE target_id=?
        `).run(
          metadata.name, metadata.symbol, metadata.priceUsd, metadata.circulatingSupply,
          metadata.currentMarketCapUsd, highest.highestMarketCapUsd, highest.highestMarketCapKind,
          metadata.observedAt, batch.observedAt, batch.observedAt, analysis.targetId,
        );
        for (const candidate of analysis.candidates) {
          const globalIdentity = `${addressNamespace(candidate.wallet.chain)}:${candidate.wallet.canonicalAddress}`;
          const accountIdentity = `${candidate.wallet.chain}:${candidate.wallet.canonicalAddress}`;
          let walletId = walletIds.get(globalIdentity);
          let walletAccountId = walletAccountIds.get(accountIdentity);
          const upserted = this.upsertWallet(walletId, walletAccountId, candidate.wallet, batch.observedAt);
          walletId = upserted.walletId;
          walletAccountId = upserted.walletAccountId;
          walletIds.set(globalIdentity, walletId);
          walletAccountIds.set(accountIdentity, walletAccountId);
          this.database.raw.prepare(`
            INSERT INTO trench_index_wallet_candidates (
              run_id,target_id,wallet_account_id,source_rank,profit_usd,realized_profit_usd,
              unrealized_profit_usd,eligible,exclusion_reason,evidence_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?)
          `).run(
            batch.runId, analysis.targetId, walletAccountId, candidate.sourceRank, candidate.profitUsd,
            candidate.realizedProfitUsd, candidate.unrealizedProfitUsd,
            candidate.eligible ? 1 : 0, candidate.exclusionReason, JSON.stringify(candidate.evidence),
          );
        }
      }

      const ranks = new Set<string>();
      const expectedRanks = new Map<string, number>();
      for (const ranked of batch.wallets) {
        assertFiniteOrNull(ranked.totalProfitUsd, 'ranked wallet profit');
        assertFiniteOrNull(ranked.realizedProfitUsd, 'ranked realized profit');
        assertFiniteOrNull(ranked.unrealizedProfitUsd, 'ranked unrealized profit');
        const expectedRank = (expectedRanks.get(ranked.chain) ?? 0) + 1;
        assertXIdentity(ranked.xIdentity, 'Published');
        const rankKey = `${ranked.chain}:${ranked.chainRank}`;
        if (!Number.isInteger(ranked.chainRank) || ranked.chainRank !== expectedRank ||
          ranked.chainRank > 300 || ranks.has(rankKey)) {
          throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Published chain-local INDEX rank is invalid.');
        }
        expectedRanks.set(ranked.chain, expectedRank);
        ranks.add(rankKey);
        const walletId = walletIds.get(`${addressNamespace(ranked.chain)}:${ranked.canonicalAddress}`);
        const walletAccountId = walletAccountIds.get(`${ranked.chain}:${ranked.canonicalAddress}`);
        if (!walletId || !walletAccountId) {
          throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Published wallet has no candidate evidence.');
        }
        const eligible = this.database.raw.prepare(`
          SELECT 1 FROM trench_index_wallet_candidates c
          JOIN trench_wallet_chain_accounts a ON a.wallet_account_id=c.wallet_account_id
          WHERE c.run_id=? AND c.wallet_account_id=? AND c.eligible=1 AND a.wallet_kind='user'
            AND a.chain=? LIMIT 1
        `).get(batch.runId, walletAccountId, ranked.chain);
        if (!eligible) {
          throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Published wallet is not an eligible user wallet.');
        }
        this.database.raw.prepare(`
          INSERT INTO trench_index_wallets (
            run_id,wallet_account_id,chain,chain_rank,total_profit_usd,source_ca_count,profitable_ca_count,
            best_source_rank,realized_profit_usd,unrealized_profit_usd
          ) VALUES (?,?,?,?,?,?,?,?,?,?)
        `).run(
          batch.runId, walletAccountId, ranked.chain, ranked.chainRank, ranked.totalProfitUsd, ranked.sourceCaCount,
          ranked.profitableCaCount, ranked.bestSourceRank, ranked.realizedProfitUsd,
          ranked.unrealizedProfitUsd,
        );
        this.ensurePublishedPerson(
          walletId,
          this.publishedPersonEvidence(batch, ranked),
          batch.observedAt,
        );
      }
      this.database.raw.prepare(`
        UPDATE trench_index_runs
        SET status='completed',completed_at=?,candidate_count=?,eligible_count=?,published_count=?,
            error_code=NULL,error_message=NULL
        WHERE run_id=?
      `).run(batch.observedAt, candidateCount, eligibleCount, batch.wallets.length, batch.runId);
      const revision = this.bumpRevision(batch.observedAt, batch.runId);
      return { revision };
    });
  }

  failRun(input: TrenchIndexStorageFailRunInput): { revision: number } {
    assertTimestamp(input.failedAt, 'failedAt');
    return this.database.transaction(() => {
      const run = this.database.raw.prepare('SELECT * FROM trench_index_runs WHERE run_id=?')
        .get(input.runId) as RunRow | undefined;
      if (!run || run.status !== 'running') {
        throw new TrenchIndexRepositoryError('REQUEST_CONFLICT', 'The analysis run is not active.');
      }
      this.database.raw.prepare(`
        UPDATE trench_index_runs
        SET status='failed',completed_at=?,error_code=?,error_message=? WHERE run_id=?
      `).run(input.failedAt, input.error.code, input.error.message, input.runId);
      this.database.raw.prepare(`
        UPDATE trench_index_targets
        SET state=CASE
              WHEN target_id=? THEN 'error'
              WHEN last_success_at IS NULL THEN 'pending'
              ELSE 'ready'
            END,
            error_code=CASE WHEN target_id=? THEN ? ELSE NULL END,
            error_message=CASE WHEN target_id=? THEN ? ELSE NULL END,
            error_at=CASE WHEN target_id=? THEN ? ELSE NULL END,
            updated_at=?
        WHERE target_id IN (SELECT target_id FROM trench_index_target_snapshots WHERE run_id=?)
      `).run(
        input.targetId, input.targetId, input.error.code, input.targetId, input.error.message,
        input.targetId, input.failedAt, input.failedAt, input.runId,
      );
      return { revision: this.bumpRevision(input.failedAt) };
    });
  }

  private createRun(
    requestId: string,
    fingerprint: string,
    trigger: TrenchIndexRunSummary['trigger'],
    startedAt: number,
  ): TrenchIndexStorageBeginRunResult {
    const targets = this.database.raw.prepare(`
      SELECT * FROM trench_index_targets WHERE active=1 ORDER BY created_at,target_id
    `).all() as TargetRow[];
    if (targets.length === 0) {
      throw new TrenchIndexRepositoryError('EMPTY_TARGET_SET', 'Add a target CA before reanalyzing.');
    }
    const runId = this.uuid();
    this.database.raw.prepare(`
      INSERT INTO trench_index_runs (
        run_id,request_id,request_fingerprint,trigger,status,started_at,target_count,policy_version
      ) VALUES (?,?,?,?,'running',?,?,?)
    `).run(runId, requestId, fingerprint, trigger, startedAt, targets.length, TRENCH_INDEX_POLICY_VERSION);
    const insertSnapshot = this.database.raw.prepare(`
      INSERT INTO trench_index_target_snapshots (
        run_id,target_id,token_name,token_symbol,price_usd,circulating_supply,current_market_cap_usd,
        highest_market_cap_usd,highest_market_cap_kind,observed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    for (const row of targets) {
      insertSnapshot.run(
        runId, row.target_id, row.token_name, row.token_symbol, row.price_usd,
        row.circulating_supply, row.current_market_cap_usd, row.highest_market_cap_usd,
        row.highest_market_cap_kind, row.metadata_observed_at,
      );
    }
    this.database.raw.prepare(`
      UPDATE trench_index_targets SET state='analyzing',error_code=NULL,error_message=NULL,
        error_at=NULL,updated_at=? WHERE active=1
    `).run(startedAt);
    const revision = this.bumpRevision(startedAt);
    return {
      runId,
      revision,
      targets: targets.map(storageTarget),
      replayed: false,
      status: 'running',
    };
  }

  private replay(
    requestId: string,
    fingerprint: string,
    trigger: TrenchIndexRunSummary['trigger'],
  ): TrenchIndexStorageBeginRunResult | null {
    const run = this.database.raw.prepare('SELECT * FROM trench_index_runs WHERE request_id=?')
      .get(requestId) as RunRow | undefined;
    if (!run) return null;
    if (run.request_fingerprint !== fingerprint || run.trigger !== trigger) {
      throw new TrenchIndexRepositoryError(
        'REQUEST_CONFLICT',
        'requestId was already used for a different Trench INDEX command.',
      );
    }
    return {
      runId: run.run_id,
      revision: this.state().revision,
      targets: this.runTargets(run.run_id),
      replayed: true,
      status: run.status,
    };
  }

  private runTargets(runId: string): TrenchIndexStorageTarget[] {
    return (this.database.raw.prepare(`
      SELECT t.target_id,t.chain,t.address,t.canonical_address
      FROM trench_index_target_snapshots s
      JOIN trench_index_targets t ON t.target_id=s.target_id
      WHERE s.run_id=? ORDER BY t.created_at,t.target_id
    `).all(runId) as Array<Pick<TargetRow, 'target_id' | 'chain' | 'address' | 'canonical_address'>>)
      .map(storageTarget);
  }

  private assertIdle(): void {
    const active = this.database.raw.prepare(
      "SELECT 1 FROM trench_index_runs WHERE status='running' LIMIT 1",
    ).get();
    if (active) throw new TrenchIndexRepositoryError('ANALYSIS_BUSY', 'A Trench INDEX analysis is already running.');
  }

  private assertMetadata(metadata: TrenchIndexTokenMetadata): void {
    assertTimestamp(metadata.observedAt, 'token metadata observedAt');
    assertFiniteOrNull(metadata.priceUsd, 'token price', true);
    assertFiniteOrNull(metadata.circulatingSupply, 'token circulating supply', true);
    assertFiniteOrNull(metadata.currentMarketCapUsd, 'token current market cap', true);
    assertFiniteOrNull(metadata.highestMarketCapUsd, 'token highest market cap', true);
  }

  private publishedPersonEvidence(
    batch: TrenchIndexCompletedBatch,
    ranked: TrenchIndexCompletedBatch['wallets'][number],
  ): PublishedPersonEvidence {
    const candidates = batch.targets.flatMap((analysis) => analysis.candidates
      .filter((candidate) => candidate.eligible && candidate.wallet.walletKind === 'user' &&
        candidate.wallet.chain === ranked.chain &&
        candidate.wallet.canonicalAddress === ranked.canonicalAddress)
      .map((candidate) => ({ targetId: analysis.targetId, candidate })))
      .sort((left, right) => left.candidate.sourceRank - right.candidate.sourceRank ||
        left.targetId.localeCompare(right.targetId) ||
        (left.candidate.xIdentity?.displayValue ?? '')
          .localeCompare(right.candidate.xIdentity?.displayValue ?? ''));
    const identityValues = new Set(candidates
      .map(({ candidate }) => candidate.xIdentity?.canonicalValue)
      .filter((value): value is string => !!value));
    const identityCandidate = identityValues.size === 1
      ? candidates.find(({ candidate }) => candidate.xIdentity?.canonicalValue === [...identityValues][0])
      : undefined;
    const xIdentity = identityCandidate?.candidate.xIdentity
      ? {
          ...identityCandidate.candidate.xIdentity,
          targetId: identityCandidate.targetId,
          sourceRank: identityCandidate.candidate.sourceRank,
        }
      : null;
    if (
      ranked.xIdentity?.canonicalValue !== xIdentity?.canonicalValue ||
      ranked.xIdentity?.displayValue !== xIdentity?.displayValue
    ) {
      throw new TrenchIndexRepositoryError(
        'SOURCE_INVALID',
        'Published person identity does not match eligible candidate evidence.',
      );
    }
    return {
      displayName: candidates.find(({ candidate }) => candidate.wallet.name !== null)
        ?.candidate.wallet.name ?? null,
      avatarUrl: candidates.find(({ candidate }) => candidate.wallet.avatarUrl !== null)
        ?.candidate.wallet.avatarUrl ?? null,
      xIdentity,
    };
  }

  private upsertWallet(
    suggestedWalletId: string | undefined,
    suggestedWalletAccountId: string | undefined,
    wallet: TrenchIndexCompletedBatch['targets'][number]['candidates'][number]['wallet'],
    observedAt: number,
  ): { walletId: string; walletAccountId: string } {
    assertTimestamp(wallet.classificationUpdatedAt, 'wallet classification timestamp');
    const namespace = addressNamespace(wallet.chain);
    const existingWallet = this.database.raw.prepare(`
      SELECT wallet_id,metadata_json,metadata_source FROM trench_wallets
      WHERE address_namespace=? AND canonical_address=?
    `).get(namespace, wallet.canonicalAddress) as {
      wallet_id: string;
      metadata_json: string;
      metadata_source: TrenchIndexWalletRow['metadataSource'];
    } | undefined;
    const walletId = existingWallet?.wallet_id ?? suggestedWalletId ?? this.uuid();
    const metadataJson = JSON.stringify(existingWallet?.metadata_source === 'gmgn'
      ? { ...wallet.metadata, ...parseObject(existingWallet.metadata_json) }
      : wallet.metadata);
    if (Buffer.byteLength(metadataJson, 'utf8') > 16 * 1024) {
      throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Wallet metadata is too large.');
    }
    this.database.raw.prepare(`
      INSERT INTO trench_wallets (
        wallet_id,address_namespace,canonical_address,address,name,avatar_url,note,metadata_json,
        metadata_source,first_seen_at,last_seen_at,metadata_updated_at
      ) VALUES (?,?,?,?,?,?,NULL,?,'gmgn',?,?,?)
      ON CONFLICT(address_namespace,canonical_address) DO UPDATE SET
        address=excluded.address,
        name=CASE
          WHEN trench_wallets.metadata_source='import'
            THEN COALESCE(excluded.name,trench_wallets.name)
          WHEN trench_wallets.metadata_source='gmgn'
            THEN COALESCE(trench_wallets.name,excluded.name)
          ELSE trench_wallets.name END,
        avatar_url=CASE
          WHEN trench_wallets.metadata_source='import'
            THEN COALESCE(excluded.avatar_url,trench_wallets.avatar_url)
          WHEN trench_wallets.metadata_source='gmgn'
            THEN COALESCE(trench_wallets.avatar_url,excluded.avatar_url)
          ELSE trench_wallets.avatar_url END,
        metadata_json=CASE WHEN trench_wallets.metadata_source IN ('gmgn','import')
          THEN excluded.metadata_json ELSE trench_wallets.metadata_json END,
        metadata_source=CASE WHEN trench_wallets.metadata_source='import'
          THEN 'gmgn' ELSE trench_wallets.metadata_source END,
        last_seen_at=excluded.last_seen_at,
        metadata_updated_at=CASE WHEN trench_wallets.metadata_source IN ('gmgn','import')
          THEN excluded.metadata_updated_at ELSE trench_wallets.metadata_updated_at END
    `).run(
      walletId, namespace, wallet.canonicalAddress, wallet.address, wallet.name, wallet.avatarUrl,
      metadataJson, observedAt, observedAt, observedAt,
    );

    const existingAccount = this.database.raw.prepare(`
      SELECT wallet_account_id,wallet_kind,classification_source,classification_updated_at
      FROM trench_wallet_chain_accounts WHERE wallet_id=? AND chain=?
    `).get(walletId, wallet.chain) as {
      wallet_account_id: string;
      wallet_kind: TrenchIndexWalletRow['walletKind'];
      classification_source: TrenchWalletClassificationSource;
      classification_updated_at: number;
    } | undefined;
    const walletAccountId = existingAccount?.wallet_account_id ?? suggestedWalletAccountId ?? this.uuid();
    const protectedExisting = existingAccount && ['manual', 'agent', 'mixed']
      .includes(existingAccount.classification_source);
    const existingPriority = existingAccount
      ? providerClassificationPriority(existingAccount.wallet_kind, existingAccount.classification_source)
      : -1;
    const incomingPriority = providerClassificationPriority(
      wallet.walletKind,
      wallet.classificationSource,
    );
    const existingWins = existingAccount && (protectedExisting || existingPriority > incomingPriority ||
      (existingPriority === incomingPriority &&
        walletKindPriority[existingAccount.wallet_kind] > walletKindPriority[wallet.walletKind]) ||
      (existingAccount.wallet_kind === wallet.walletKind && existingPriority === incomingPriority &&
        classificationSourcePriority[existingAccount.classification_source] >
          classificationSourcePriority[wallet.classificationSource]));
    const walletKind = existingWins ? existingAccount.wallet_kind : wallet.walletKind;
    const classificationSource = existingWins
      ? existingAccount.classification_source
      : wallet.classificationSource;
    const classificationUpdatedAt = existingWins
      ? existingAccount.classification_updated_at
      : wallet.classificationUpdatedAt;
    this.database.raw.prepare(`
      INSERT INTO trench_wallet_chain_accounts (
        wallet_account_id,wallet_id,chain,wallet_kind,classification_source,
        classification_updated_at,first_seen_at,last_seen_at
      ) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(wallet_id,chain) DO UPDATE SET
        wallet_kind=excluded.wallet_kind,
        classification_source=excluded.classification_source,
        classification_updated_at=excluded.classification_updated_at,
        last_seen_at=excluded.last_seen_at
    `).run(
      walletAccountId, walletId, wallet.chain, walletKind, classificationSource,
      classificationUpdatedAt, observedAt, observedAt,
    );
    return { walletId, walletAccountId };
  }

  private ensurePublishedPerson(
    walletId: string,
    evidence: PublishedPersonEvidence,
    observedAt: number,
  ): void {
    const wallet = this.database.raw.prepare(`
      SELECT wallets.wallet_id,wallets.name,wallets.avatar_url,wallets.metadata_source,
        EXISTS (
          SELECT 1 FROM trench_wallet_chain_accounts accounts
          WHERE accounts.wallet_id=wallets.wallet_id
            AND accounts.classification_source IN ('manual','agent','mixed')
        ) AS has_curated_account
      FROM trench_wallets wallets WHERE wallets.wallet_id=?
    `).get(walletId) as {
      wallet_id: string;
      name: string | null;
      avatar_url: string | null;
      metadata_source: TrenchIndexWalletRow['metadataSource'];
      has_curated_account: 0 | 1;
    } | undefined;
    if (!wallet) throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Published wallet is missing.');
    const walletSource = walletMetadataPersonSource(wallet.metadata_source);
    const walletMetadataCurated = walletMetadataIsCurated(wallet.metadata_source);
    const walletHasCuratedEvidence = walletMetadataCurated || wallet.has_curated_account === 1;
    const profileEvidence = {
      displayName: walletMetadataCurated
        ? { value: wallet.name, source: walletSource }
        : { value: evidence.displayName ?? wallet.name, source: 'gmgn' as const },
      avatarUrl: walletMetadataCurated
        ? { value: wallet.avatar_url, source: walletSource }
        : { value: evidence.avatarUrl ?? wallet.avatar_url, source: 'gmgn' as const },
    };
    const existingMembership = this.database.raw.prepare(
      'SELECT * FROM trench_person_wallets WHERE wallet_id=?',
    ).get(walletId) as MembershipRow | undefined;
    const canonicalX = evidence.xIdentity?.canonicalValue ?? null;
    const identityEvidence: TrenchJsonObject | null = evidence.xIdentity ? {
      schema: 'bl-trench-x-gmgn-evidence-v1',
      walletId,
      targetId: evidence.xIdentity.targetId,
      sourceRank: evidence.xIdentity.sourceRank,
      observedAt,
    } : null;
    const identity = canonicalX ? this.database.raw.prepare(`
      SELECT e.person_id,e.source FROM trench_person_external_identities e
      JOIN trench_persons p ON p.person_id=e.person_id
      WHERE e.provider='x' AND e.canonical_value=? AND p.status='active'
    `).get(canonicalX) as { person_id: string; source: TrenchPersonProfileSource } | undefined : undefined;

    const directCuratedIdentityCollision = !existingMembership && identity !== undefined &&
      walletHasCuratedEvidence;
    let personId = existingMembership?.person_id ??
      (directCuratedIdentityCollision ? null : identity?.person_id) ?? null;
    if (!personId) {
      personId = this.uuid();
      this.database.raw.prepare(`
        INSERT INTO trench_persons (
          person_id,status,display_name_source,avatar_source,note_source,metadata_json,
          created_at,updated_at
        ) VALUES (?,'active','system','system','system','{}',?,?)
      `).run(personId, observedAt, observedAt);
    }

    if (walletMetadataCurated || (
      !walletHasCuratedEvidence && !this.personHasCuratedWalletEvidence(personId)
    )) {
      this.enrichPersonProfile(
        personId,
        profileEvidence.displayName,
        profileEvidence.avatarUrl,
        observedAt,
      );
    }

    if (existingMembership && identity && existingMembership.person_id !== identity.person_id) {
      const membershipPerson = this.resolveActivePerson(existingMembership.person_id)?.person;
      const identityPerson = this.resolveActivePerson(identity.person_id)?.person;
      if (!membershipPerson || !identityPerson) {
        throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Person identity points to a merged dead end.');
      }
      if (membershipPerson.person_id !== identityPerson.person_id) {
        if (this.personIsCurated(membershipPerson.person_id) || this.personIsCurated(identityPerson.person_id)) {
          this.recordIdentityConflict(
            canonicalX!,
            identityPerson.person_id,
            membershipPerson.person_id,
            walletId,
            evidence.xIdentity!.displayValue,
            identityEvidence!,
            observedAt,
          );
          personId = membershipPerson.person_id;
        } else {
          this.mergeUncuratedPerson(
            membershipPerson.person_id,
            identityPerson.person_id,
            observedAt,
          );
          personId = identityPerson.person_id;
        }
      }
    }

    if (!existingMembership) {
      this.database.raw.prepare(`
        INSERT INTO trench_person_wallets (
          membership_id,person_id,wallet_id,link_source,evidence_json,linked_at,updated_at
        ) VALUES (?,?,?,?,?, ?,?)
      `).run(
        this.uuid(), personId, walletId, canonicalX ? 'gmgn-x' : 'index-auto',
        JSON.stringify(identityEvidence ?? {}),
        observedAt, observedAt,
      );
    }

    if (directCuratedIdentityCollision) {
      this.recordIdentityConflict(
        canonicalX!,
        identity!.person_id,
        personId,
        walletId,
        evidence.xIdentity!.displayValue,
        identityEvidence!,
        observedAt,
      );
    }

    if (canonicalX && !identity) {
      this.database.raw.prepare(`
        INSERT INTO trench_person_external_identities (
          external_identity_id,person_id,provider,canonical_value,display_value,source,
          evidence_json,created_at,updated_at
        ) VALUES (?,?,'x',?,?,'gmgn',?,?,?)
      `).run(
        this.uuid(), personId, canonicalX, evidence.xIdentity!.displayValue,
        JSON.stringify(identityEvidence), observedAt, observedAt,
      );
    } else if (canonicalX && identity?.person_id === personId) {
      this.database.raw.prepare(`
        UPDATE trench_person_external_identities SET updated_at=?
        WHERE provider='x' AND canonical_value=? AND person_id=?
      `).run(observedAt, canonicalX, personId);
    }
    if (walletMetadataCurated || (
      !walletHasCuratedEvidence && !this.personHasCuratedWalletEvidence(personId)
    )) {
      this.enrichPersonProfile(
        personId,
        profileEvidence.displayName,
        profileEvidence.avatarUrl,
        observedAt,
      );
    }
  }

  private enrichPersonProfile(
    personId: string,
    displayName: PersonFieldEvidence,
    avatarUrl: PersonFieldEvidence,
    observedAt: number,
  ): void {
    const person = this.database.raw.prepare('SELECT * FROM trench_persons WHERE person_id=?')
      .get(personId) as PersonRow | undefined;
    if (!person || person.status !== 'active') return;
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (displayName.value && personProfileSourcePriority[displayName.source] >
      personProfileSourcePriority[person.display_name_source]) {
      assignments.push('display_name=?', 'display_name_source=?');
      values.push(displayName.value, displayName.source);
    }
    if (avatarUrl.value && personProfileSourcePriority[avatarUrl.source] >
      personProfileSourcePriority[person.avatar_source]) {
      assignments.push('avatar_url=?', 'avatar_source=?');
      values.push(avatarUrl.value, avatarUrl.source);
    }
    if (assignments.length === 0) return;
    this.database.raw.prepare(`UPDATE trench_persons SET ${assignments.join(',')},updated_at=?
      WHERE person_id=?`).run(...values, observedAt, personId);
  }

  private personIsCurated(personId: string): boolean {
    const person = this.database.raw.prepare(`
      SELECT display_name_source,avatar_source,note_source FROM trench_persons WHERE person_id=?
    `).get(personId) as Pick<PersonRow,
      'display_name_source' | 'avatar_source' | 'note_source'> | undefined;
    if (person && [person.display_name_source, person.avatar_source, person.note_source]
      .some((source) => source === 'manual' || source === 'agent')) return true;
    if (this.database.raw.prepare(`
      SELECT 1 FROM trench_person_external_identities
      WHERE person_id=? AND source IN ('manual','agent') LIMIT 1
    `).get(personId)) return true;
    return this.personHasCuratedWalletEvidence(personId);
  }

  private personHasCuratedWalletEvidence(personId: string): boolean {
    return !!this.database.raw.prepare(`
      SELECT 1 FROM trench_person_wallets memberships
      JOIN trench_wallets wallets ON wallets.wallet_id=memberships.wallet_id
      WHERE memberships.person_id=? AND (
        memberships.link_source IN ('manual','agent') OR
        wallets.metadata_source IN ('manual','agent','mixed') OR
        EXISTS (
          SELECT 1 FROM trench_wallet_chain_accounts accounts
          WHERE accounts.wallet_id=wallets.wallet_id
            AND accounts.classification_source IN ('manual','agent','mixed')
        )
      )
      LIMIT 1
    `).get(personId);
  }

  private mergeUncuratedPerson(fromPersonId: string, intoPersonId: string, observedAt: number): void {
    const from = this.database.raw.prepare('SELECT * FROM trench_persons WHERE person_id=?')
      .get(fromPersonId) as PersonRow | undefined;
    const into = this.database.raw.prepare('SELECT * FROM trench_persons WHERE person_id=?')
      .get(intoPersonId) as PersonRow | undefined;
    if (!from || !into || from.status !== 'active' || into.status !== 'active') {
      throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Only active people can be merged.');
    }
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [column, sourceColumn, fromValue, fromSource, intoValue, intoSource] of [
      ['display_name', 'display_name_source', from.display_name, from.display_name_source,
        into.display_name, into.display_name_source],
      ['avatar_url', 'avatar_source', from.avatar_url, from.avatar_source,
        into.avatar_url, into.avatar_source],
      ['note', 'note_source', from.note, from.note_source, into.note, into.note_source],
    ] as const) {
      if (fromValue !== null && (
        intoValue === null || personProfileSourcePriority[fromSource] >
          personProfileSourcePriority[intoSource]
      )) {
        assignments.push(`${column}=?`, `${sourceColumn}=?`);
        values.push(fromValue, fromSource);
      }
    }
    const metadata = { ...parseObject(from.metadata_json), ...parseObject(into.metadata_json) };
    assignments.push('metadata_json=?', 'updated_at=?');
    values.push(JSON.stringify(metadata), observedAt);
    this.database.raw.prepare(`UPDATE trench_persons SET ${assignments.join(',')} WHERE person_id=?`)
      .run(...values, intoPersonId);
    this.database.raw.prepare(`
      UPDATE trench_person_wallets SET person_id=?,updated_at=? WHERE person_id=?
    `).run(intoPersonId, observedAt, fromPersonId);
    this.database.raw.prepare(`
      UPDATE trench_person_external_identities SET person_id=?,updated_at=? WHERE person_id=?
    `).run(intoPersonId, observedAt, fromPersonId);
    this.database.raw.prepare(`
      UPDATE trench_persons SET status='merged',merged_into_person_id=?,updated_at=?
      WHERE person_id=? AND status='active'
    `).run(intoPersonId, observedAt, fromPersonId);
  }

  private recordIdentityConflict(
    canonicalX: string,
    ownerPersonId: string,
    contenderPersonId: string,
    walletId: string,
    displayValue: string,
    evidence: TrenchJsonObject,
    observedAt: number,
  ): void {
    const conflictEvidence = JSON.stringify({
      ...evidence,
      displayValue,
    });
    this.database.raw.prepare(`
      INSERT OR IGNORE INTO trench_person_identity_conflicts (
        conflict_id,provider,canonical_value,identity_owner_person_id,contender_person_id,
        wallet_id,status,evidence_json,created_at
      ) VALUES (?,'x',?,?,?,?,'open',?,?)
    `).run(
      this.uuid(), canonicalX, ownerPersonId, contenderPersonId, walletId,
      conflictEvidence, observedAt,
    );
  }

  private resolveActivePerson(personId: string): {
    person: PersonRow;
    resolvedFromPersonId: string | null;
  } | null {
    let current = personId;
    for (let depth = 0; depth < 32; depth += 1) {
      const person = this.database.raw.prepare('SELECT * FROM trench_persons WHERE person_id=?')
        .get(current) as PersonRow | undefined;
      if (!person) return null;
      if (person.status === 'active') {
        return { person, resolvedFromPersonId: current === personId ? null : personId };
      }
      if (!person.merged_into_person_id || person.merged_into_person_id === current) return null;
      current = person.merged_into_person_id;
    }
    throw new TrenchIndexRepositoryError('SOURCE_INVALID', 'Person merge chain exceeds its bound.');
  }

  private personSummary(person: PersonRow): TrenchPersonSummary {
    const walletFacts = this.database.raw.prepare(`
      SELECT COUNT(DISTINCT pw.wallet_id) AS wallet_count,
        GROUP_CONCAT(DISTINCT a.chain) AS chains
      FROM trench_person_wallets pw
      LEFT JOIN trench_wallet_chain_accounts a ON a.wallet_id=pw.wallet_id
      WHERE pw.person_id=?
    `).get(person.person_id) as { wallet_count: number; chains: string | null };
    const profit = this.database.raw.prepare(`
      SELECT COALESCE(SUM(i.total_profit_usd),0) AS total_profit_usd,
        SUM(i.realized_profit_usd) AS realized_profit_usd,
        SUM(i.unrealized_profit_usd) AS unrealized_profit_usd,
        COUNT(i.wallet_account_id) AS ranked_wallet_count
      FROM trench_person_wallets pw
      JOIN trench_wallet_chain_accounts a ON a.wallet_id=pw.wallet_id
      JOIN trench_repository_state s ON s.id=1
      LEFT JOIN trench_index_wallets i ON i.run_id=s.current_run_id
        AND i.wallet_account_id=a.wallet_account_id
      WHERE pw.person_id=?
    `).get(person.person_id) as {
      total_profit_usd: number;
      realized_profit_usd: number | null;
      unrealized_profit_usd: number | null;
      ranked_wallet_count: number;
    };
    const presentChains = new Set((walletFacts.chains ?? '').split(',').filter(Boolean));
    const chains = (['solana', 'bsc', 'robinhood'] as const)
      .filter((chain) => presentChains.has(chain));
    return {
      personId: person.person_id,
      status: 'active',
      displayName: person.display_name,
      avatarUrl: person.avatar_url,
      note: person.note,
      displayNameSource: person.display_name_source,
      avatarSource: person.avatar_source,
      noteSource: person.note_source,
      walletCount: walletFacts.wallet_count,
      chains,
      profit: {
        model: TRENCH_PERSON_PROFIT_MODEL,
        totalProfitUsd: profit.total_profit_usd,
        realizedProfitUsd: profit.realized_profit_usd,
        unrealizedProfitUsd: profit.unrealized_profit_usd,
        rankedWalletCount: profit.ranked_wallet_count,
      },
      createdAt: person.created_at,
      updatedAt: person.updated_at,
    };
  }

  private assertExpectedRevision(expectedRevision: number): void {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TrenchIndexRepositoryError('INVALID_INPUT', 'expectedRevision is invalid.');
    }
    if (this.state().revision !== expectedRevision) {
      throw new TrenchIndexRepositoryError('REVISION_CONFLICT', 'Trench data changed before this edit.');
    }
  }

  private personImportEnvelopeMatches(
    row: PersonImportRow,
    input: TrenchPersonImportInput,
  ): boolean {
    return row.import_id === input.importId &&
      row.request_id === input.requestId &&
      row.source_sha256 === input.sourceSha256 &&
      row.content_sha256 === input.contentSha256 &&
      row.chain === input.chain &&
      row.wallet_kind === input.walletKind &&
      row.normalization_version === input.normalizationVersion &&
      row.chunk_count === input.chunkCount &&
      row.row_count === input.rowCount;
  }

  private personImportStagedCount(importId: string): number {
    const row = this.database.raw.prepare(`
      SELECT COUNT(*) AS count FROM trench_person_import_chunks WHERE import_id=?
    `).get(importId) as { count: number };
    return row.count;
  }

  private personImportReceipt(
    row: PersonImportRow,
    stagedChunkCount: number,
    replayed: boolean,
  ): TrenchPersonImportReceipt {
    return {
      schema: 'bl-trench-person-import-receipt-v1',
      importId: row.import_id,
      requestId: row.request_id,
      sourceSha256: row.source_sha256,
      contentSha256: row.content_sha256,
      chain: row.chain,
      chunkCount: row.chunk_count,
      rowCount: row.row_count,
      stagedChunkCount,
      completed: row.status === 'completed',
      replayed,
      createdPersons: row.created_persons,
      createdWallets: row.created_wallets,
      createdChainAccounts: row.created_chain_accounts,
      linkedExistingWallets: row.linked_existing_wallets,
      skippedExistingMemberships: row.skipped_existing_memberships,
      collapsedDuplicates: row.collapsed_duplicates,
      revision: row.revision,
    };
  }

  private publishImportedPersonWallet(
    input: TrenchPersonImportInput,
    row: TrenchPersonImportRow,
    now: number,
    counts: {
      createdPersons: number;
      createdWallets: number;
      createdChainAccounts: number;
      linkedExistingWallets: number;
      skippedExistingMemberships: number;
    },
  ): void {
    const namespace = addressNamespace(input.chain);
    const existingWallet = this.database.raw.prepare(`
      SELECT wallet_id FROM trench_wallets
      WHERE address_namespace=? AND canonical_address=?
    `).get(namespace, row.address) as { wallet_id: string } | undefined;
    const walletId = existingWallet?.wallet_id ?? this.uuid();
    if (!existingWallet) {
      this.database.raw.prepare(`
        INSERT INTO trench_wallets (
          wallet_id,address_namespace,canonical_address,address,name,avatar_url,note,metadata_json,
          metadata_source,first_seen_at,last_seen_at,metadata_updated_at
        ) VALUES (?,?,?,?,?,NULL,NULL,'{}','import',?,?,?)
      `).run(walletId, namespace, row.address, row.address, row.name, now, now, now);
      counts.createdWallets += 1;
    }
    const account = this.database.raw.prepare(`
      SELECT wallet_account_id FROM trench_wallet_chain_accounts WHERE wallet_id=? AND chain=?
    `).get(walletId, input.chain) as { wallet_account_id: string } | undefined;
    if (!account) {
      this.database.raw.prepare(`
        INSERT INTO trench_wallet_chain_accounts (
          wallet_account_id,wallet_id,chain,wallet_kind,classification_source,
          classification_updated_at,first_seen_at,last_seen_at
        ) VALUES (?,?,?,'user','import',?,?,?)
      `).run(this.uuid(), walletId, input.chain, now, now, now);
      counts.createdChainAccounts += 1;
    }
    const membership = this.database.raw.prepare(
      'SELECT membership_id FROM trench_person_wallets WHERE wallet_id=?',
    ).get(walletId) as { membership_id: string } | undefined;
    if (membership) {
      counts.skippedExistingMemberships += 1;
      return;
    }
    const personId = this.uuid();
    const personMetadata = row.displayEmoji === null
      ? '{}'
      : JSON.stringify({ displayEmoji: row.displayEmoji });
    this.database.raw.prepare(`
      INSERT INTO trench_persons (
        person_id,status,merged_into_person_id,display_name,avatar_url,note,
        display_name_source,avatar_source,note_source,metadata_json,created_at,updated_at
      ) VALUES (?,'active',NULL,?,NULL,NULL,?,'system','system',?,?,?)
    `).run(personId, row.name, row.name === null ? 'system' : 'import', personMetadata, now, now);
    this.database.raw.prepare(`
      INSERT INTO trench_person_wallets (
        membership_id,person_id,wallet_id,link_source,evidence_json,linked_at,updated_at
      ) VALUES (?,?,?,'import',?, ?,?)
    `).run(
      this.uuid(),
      personId,
      walletId,
      JSON.stringify({ schema: 'bl-trench-person-import-link-v1', importId: input.importId }),
      now,
      now,
    );
    counts.createdPersons += 1;
    if (existingWallet) counts.linkedExistingWallets += 1;
  }

  private assertProfileEdit(input: TrenchPersonUpdateProfileInput): void {
    const text = (
      value: string | null | undefined,
      max: number,
      label: string,
      allowNewline: boolean,
    ): void => {
      if (value === undefined || value === null) return;
      if (typeof value !== 'string' || value !== value.trim() || !value ||
        Array.from(value).length > max || value.includes('\0') || (!allowNewline && /[\r\n]/.test(value))) {
        throw new TrenchIndexRepositoryError('INVALID_INPUT', `${label} is invalid.`);
      }
    };
    text(input.displayName, 200, 'displayName', false);
    text(input.note, 2_000, 'note', true);
    if (input.avatarUrl !== undefined && input.avatarUrl !== null) {
      text(input.avatarUrl, 2_048, 'avatarUrl', false);
      try {
        const url = new URL(input.avatarUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.href !== input.avatarUrl) {
          throw new Error('invalid');
        }
      } catch {
        throw new TrenchIndexRepositoryError('INVALID_INPUT', 'avatarUrl is invalid.');
      }
    }
  }

  private state(): RepositoryStateRow {
    const state = this.database.raw.prepare('SELECT revision,current_run_id FROM trench_repository_state WHERE id=1')
      .get() as RepositoryStateRow | undefined;
    if (!state) throw new TrenchIndexRepositoryError('STORAGE_UNAVAILABLE', 'Trench repository state is missing.');
    return state;
  }

  private bumpRevision(updatedAt: number, currentRunId?: string): number {
    if (currentRunId === undefined) {
      this.database.raw.prepare(`
        UPDATE trench_repository_state SET revision=revision+1,updated_at=? WHERE id=1
      `).run(updatedAt);
    } else {
      this.database.raw.prepare(`
        UPDATE trench_repository_state SET revision=revision+1,current_run_id=?,updated_at=? WHERE id=1
      `).run(currentRunId, updatedAt);
    }
    return this.state().revision;
  }
}

export const asTrenchIndexError = (error: unknown): TrenchIndexError => error instanceof TrenchIndexRepositoryError
  ? { code: error.code, message: error.message }
  : error instanceof TrenchPersonValidationError
    ? { code: 'INVALID_INPUT', message: error.message }
  : { code: 'INTERNAL', message: '[trench-io] operation failed.' };
