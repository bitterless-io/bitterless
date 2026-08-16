import { createHash } from 'node:crypto';
import { compareVersions } from 'compare-versions';
import { normalizeTrenchXIdentity } from '../../shared/trench/trenchPerson.validation';

export const TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE = '260807114211';
export const TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE = '260811170011';
export const TRENCH_IO_PERSON_SCHEMA_VERSION_CODE = '260813155644';
export const TRENCH_IO_SCHEMA_VERSION_CODE = '260813155645';

export const TRENCH_IO_MIGRATION_MANIFEST = [
  { versionCode: TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, name: 'initial-index-schema' },
  { versionCode: TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE, name: 'chain-partitioned-index' },
  { versionCode: TRENCH_IO_PERSON_SCHEMA_VERSION_CODE, name: 'global-wallet-person-registry' },
  { versionCode: TRENCH_IO_SCHEMA_VERSION_CODE, name: 'person-import-ledger' },
] as const;

export interface TrenchIoMigrationDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
    run(...values: unknown[]): unknown;
  };
  transaction<T>(runner: () => T): () => T;
}

export const TRENCH_IO_TABLE_COLUMNS = {
  trench_schema_migrations: ['version_code', 'name', 'applied_at'],
  trench_repository_state: ['id', 'revision', 'current_run_id', 'updated_at'],
  trench_index_targets: [
    'target_id', 'chain', 'canonical_address', 'address', 'active', 'state', 'token_name',
    'token_symbol', 'price_usd', 'circulating_supply', 'current_market_cap_usd',
    'highest_market_cap_usd', 'highest_market_cap_kind', 'metadata_observed_at',
    'last_success_at', 'error_code', 'error_message', 'error_at', 'created_at', 'updated_at',
  ],
  trench_wallets: [
    'wallet_id', 'address_namespace', 'canonical_address', 'address', 'name', 'avatar_url',
    'note', 'metadata_json', 'metadata_source', 'first_seen_at', 'last_seen_at',
    'metadata_updated_at',
  ],
  trench_wallet_chain_accounts: [
    'wallet_account_id', 'wallet_id', 'chain', 'wallet_kind', 'classification_source',
    'classification_updated_at', 'first_seen_at', 'last_seen_at',
  ],
  trench_index_runs: [
    'run_id', 'request_id', 'request_fingerprint', 'trigger', 'status', 'started_at',
    'completed_at', 'target_count', 'candidate_count', 'eligible_count', 'published_count',
    'policy_version', 'error_code', 'error_message',
  ],
  trench_index_target_snapshots: [
    'run_id', 'target_id', 'token_name', 'token_symbol', 'price_usd', 'circulating_supply',
    'current_market_cap_usd', 'highest_market_cap_usd', 'highest_market_cap_kind', 'observed_at',
  ],
  trench_index_wallet_candidates: [
    'run_id', 'target_id', 'wallet_account_id', 'source_rank', 'profit_usd', 'realized_profit_usd',
    'unrealized_profit_usd', 'eligible', 'exclusion_reason', 'evidence_json',
  ],
  trench_index_wallets: [
    'run_id', 'wallet_account_id', 'chain', 'chain_rank', 'total_profit_usd', 'source_ca_count',
    'profitable_ca_count', 'best_source_rank', 'realized_profit_usd', 'unrealized_profit_usd',
  ],
  trench_persons: [
    'person_id', 'status', 'merged_into_person_id', 'display_name', 'avatar_url', 'note',
    'display_name_source', 'avatar_source', 'note_source', 'metadata_json', 'created_at',
    'updated_at',
  ],
  trench_person_wallets: [
    'membership_id', 'person_id', 'wallet_id', 'link_source', 'evidence_json', 'linked_at',
    'updated_at',
  ],
  trench_person_external_identities: [
    'external_identity_id', 'person_id', 'provider', 'canonical_value', 'display_value',
    'source', 'evidence_json', 'created_at', 'updated_at',
  ],
  trench_person_identity_conflicts: [
    'conflict_id', 'provider', 'canonical_value', 'identity_owner_person_id',
    'contender_person_id', 'wallet_id', 'status', 'evidence_json', 'created_at', 'resolved_at',
  ],
  trench_person_imports: [
    'import_id', 'request_id', 'source_sha256', 'content_sha256', 'chain', 'wallet_kind',
    'normalization_version', 'chunk_count', 'row_count', 'status', 'created_at', 'finalized_at',
    'created_persons', 'created_wallets', 'created_chain_accounts', 'linked_existing_wallets',
    'skipped_existing_memberships', 'collapsed_duplicates', 'revision',
  ],
  trench_person_import_chunks: [
    'import_id', 'chunk_index', 'chunk_hash', 'content_json', 'created_at',
  ],
} as const;

export const TRENCH_IO_INDEXES = [
  'trench_index_targets_identity',
  'trench_index_targets_active',
  'trench_wallets_identity',
  'trench_wallets_name',
  'trench_wallets_note',
  'trench_wallet_accounts_identity',
  'trench_wallet_accounts_chain_kind',
  'trench_index_runs_status_started',
  'trench_index_candidates_wallet',
  'trench_index_candidates_rank',
  'trench_index_wallets_rank',
  'trench_persons_active_updated',
  'trench_persons_name',
  'trench_person_wallets_person',
  'trench_person_wallets_wallet',
  'trench_person_external_identity_unique',
  'trench_person_external_identities_person',
  'trench_person_identity_conflicts_open',
  'trench_person_imports_source',
  'trench_person_imports_request',
] as const;

export const TRENCH_IO_CHAIN_SCHEMA = `
  CREATE TABLE trench_schema_migrations (
    version_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    CHECK (length(version_code) = 12)
  );

  CREATE TABLE trench_index_targets (
    target_id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    canonical_address TEXT NOT NULL,
    address TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL DEFAULT 'pending',
    token_name TEXT,
    token_symbol TEXT,
    price_usd REAL,
    circulating_supply REAL,
    current_market_cap_usd REAL,
    highest_market_cap_usd REAL,
    highest_market_cap_kind TEXT NOT NULL DEFAULT 'unavailable',
    metadata_observed_at INTEGER NOT NULL,
    last_success_at INTEGER,
    error_code TEXT,
    error_message TEXT,
    error_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (length(target_id) = 36),
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (active IN (0, 1)),
    CHECK (state IN ('pending', 'analyzing', 'ready', 'error')),
    CHECK (highest_market_cap_kind IN ('provider-ath', 'estimated-ath', 'observed', 'unavailable')),
    CHECK (price_usd IS NULL OR price_usd >= 0),
    CHECK (circulating_supply IS NULL OR circulating_supply >= 0),
    CHECK (current_market_cap_usd IS NULL OR current_market_cap_usd >= 0),
    CHECK (highest_market_cap_usd IS NULL OR highest_market_cap_usd >= 0)
  );

  CREATE UNIQUE INDEX trench_index_targets_identity
    ON trench_index_targets(chain, canonical_address);
  CREATE INDEX trench_index_targets_active
    ON trench_index_targets(active, created_at, target_id);

  CREATE TABLE trench_wallets (
    wallet_id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    canonical_address TEXT NOT NULL,
    address TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    note TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    metadata_source TEXT NOT NULL DEFAULT 'gmgn',
    wallet_kind TEXT NOT NULL DEFAULT 'unknown',
    classification_source TEXT NOT NULL DEFAULT 'unclassified',
    classification_updated_at INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    metadata_updated_at INTEGER NOT NULL,
    CHECK (length(wallet_id) = 36),
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (metadata_source IN ('manual', 'gmgn', 'agent', 'mixed')),
    CHECK (wallet_kind IN ('user', 'amm', 'exchange', 'contract', 'unknown')),
    CHECK (classification_source IN (
      'chain-known', 'gmgn-addr-type', 'gmgn-label', 'manual', 'agent', 'mixed', 'unclassified'
    ))
  );

  CREATE UNIQUE INDEX trench_wallets_identity
    ON trench_wallets(chain, canonical_address);
  CREATE INDEX trench_wallets_name ON trench_wallets(name);
  CREATE INDEX trench_wallets_note ON trench_wallets(note);
  CREATE INDEX trench_wallets_kind ON trench_wallets(wallet_kind, chain, canonical_address);

  CREATE TABLE trench_index_runs (
    run_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_fingerprint TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    target_count INTEGER NOT NULL,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    eligible_count INTEGER NOT NULL DEFAULT 0,
    published_count INTEGER NOT NULL DEFAULT 0,
    policy_version TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    CHECK (length(run_id) = 36),
    CHECK (trigger IN ('add-target', 'reanalyze')),
    CHECK (status IN ('running', 'completed', 'failed')),
    CHECK (target_count BETWEEN 1 AND 1000),
    CHECK (candidate_count BETWEEN 0 AND 100000),
    CHECK (eligible_count BETWEEN 0 AND candidate_count),
    CHECK (published_count BETWEEN 0 AND 300)
  );

  CREATE INDEX trench_index_runs_status_started
    ON trench_index_runs(status, started_at DESC, run_id);

  CREATE TABLE trench_index_target_snapshots (
    run_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    token_name TEXT,
    token_symbol TEXT,
    price_usd REAL,
    circulating_supply REAL,
    current_market_cap_usd REAL,
    highest_market_cap_usd REAL,
    highest_market_cap_kind TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, target_id),
    FOREIGN KEY (run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_id) REFERENCES trench_index_targets(target_id) ON DELETE RESTRICT,
    CHECK (highest_market_cap_kind IN ('provider-ath', 'estimated-ath', 'observed', 'unavailable')),
    CHECK (price_usd IS NULL OR price_usd >= 0),
    CHECK (circulating_supply IS NULL OR circulating_supply >= 0),
    CHECK (current_market_cap_usd IS NULL OR current_market_cap_usd >= 0),
    CHECK (highest_market_cap_usd IS NULL OR highest_market_cap_usd >= 0)
  );

  CREATE TABLE trench_index_wallet_candidates (
    run_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    source_rank INTEGER NOT NULL,
    profit_usd REAL NOT NULL,
    realized_profit_usd REAL,
    unrealized_profit_usd REAL,
    eligible INTEGER NOT NULL,
    exclusion_reason TEXT,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, target_id, wallet_id),
    FOREIGN KEY (run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_id) REFERENCES trench_index_targets(target_id) ON DELETE RESTRICT,
    FOREIGN KEY (wallet_id) REFERENCES trench_wallets(wallet_id) ON DELETE RESTRICT,
    CHECK (source_rank BETWEEN 1 AND 100),
    CHECK (eligible IN (0, 1)),
    CHECK ((eligible = 1 AND exclusion_reason IS NULL) OR (eligible = 0 AND exclusion_reason IS NOT NULL)),
    CHECK (exclusion_reason IS NULL OR exclusion_reason IN (
      'amm-or-liquidity-pool', 'exchange-or-custody', 'contract-or-program',
      'other-non-user', 'unknown-wallet-kind'
    ))
  );

  CREATE INDEX trench_index_candidates_wallet
    ON trench_index_wallet_candidates(wallet_id, run_id);
  CREATE UNIQUE INDEX trench_index_candidates_rank
    ON trench_index_wallet_candidates(run_id, target_id, source_rank);

  CREATE TABLE trench_index_wallets (
    run_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    chain_rank INTEGER NOT NULL,
    total_profit_usd REAL NOT NULL,
    source_ca_count INTEGER NOT NULL,
    profitable_ca_count INTEGER NOT NULL,
    best_source_rank INTEGER NOT NULL,
    realized_profit_usd REAL,
    unrealized_profit_usd REAL,
    PRIMARY KEY (run_id, wallet_id),
    FOREIGN KEY (run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT,
    FOREIGN KEY (wallet_id) REFERENCES trench_wallets(wallet_id) ON DELETE RESTRICT,
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (chain_rank BETWEEN 1 AND 100),
    CHECK (source_ca_count BETWEEN 1 AND 1000),
    CHECK (profitable_ca_count BETWEEN 0 AND source_ca_count),
    CHECK (best_source_rank BETWEEN 1 AND 100)
  );

  CREATE UNIQUE INDEX trench_index_wallets_rank
    ON trench_index_wallets(run_id, chain, chain_rank);

  CREATE TABLE trench_repository_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    current_run_id TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (current_run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT
  );
`;

export const TRENCH_IO_INITIAL_SCHEMA = TRENCH_IO_CHAIN_SCHEMA
  .replace('CHECK (published_count BETWEEN 0 AND 300)', 'CHECK (published_count BETWEEN 0 AND 100)')
  .replace(
    "    chain TEXT NOT NULL,\n    chain_rank INTEGER NOT NULL,\n    total_profit_usd REAL NOT NULL,",
    "    global_rank INTEGER NOT NULL,\n    total_profit_usd REAL NOT NULL,",
  )
  .replace("    CHECK (chain IN ('bsc', 'solana', 'robinhood')),\n    CHECK (chain_rank BETWEEN 1 AND 100),",
    '    CHECK (global_rank BETWEEN 1 AND 100),')
  .replace('ON trench_index_wallets(run_id, chain, chain_rank);',
    'ON trench_index_wallets(run_id, global_rank);');

const CHAIN_PARTITION_MIGRATION = `
  CREATE TABLE trench_index_runs_next (
    run_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_fingerprint TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    target_count INTEGER NOT NULL,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    eligible_count INTEGER NOT NULL DEFAULT 0,
    published_count INTEGER NOT NULL DEFAULT 0,
    policy_version TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    CHECK (length(run_id) = 36),
    CHECK (trigger IN ('add-target', 'reanalyze')),
    CHECK (status IN ('running', 'completed', 'failed')),
    CHECK (target_count BETWEEN 1 AND 1000),
    CHECK (candidate_count BETWEEN 0 AND 100000),
    CHECK (eligible_count BETWEEN 0 AND candidate_count),
    CHECK (published_count BETWEEN 0 AND 300)
  );
  INSERT INTO trench_index_runs_next SELECT * FROM trench_index_runs;

  CREATE TABLE trench_index_wallets_next (
    run_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    chain_rank INTEGER NOT NULL,
    total_profit_usd REAL NOT NULL,
    source_ca_count INTEGER NOT NULL,
    profitable_ca_count INTEGER NOT NULL,
    best_source_rank INTEGER NOT NULL,
    realized_profit_usd REAL,
    unrealized_profit_usd REAL,
    PRIMARY KEY (run_id, wallet_id),
    FOREIGN KEY (run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT,
    FOREIGN KEY (wallet_id) REFERENCES trench_wallets(wallet_id) ON DELETE RESTRICT,
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (chain_rank BETWEEN 1 AND 100),
    CHECK (source_ca_count BETWEEN 1 AND 1000),
    CHECK (profitable_ca_count BETWEEN 0 AND source_ca_count),
    CHECK (best_source_rank BETWEEN 1 AND 100)
  );
  INSERT INTO trench_index_wallets_next (
    run_id,wallet_id,chain,chain_rank,total_profit_usd,source_ca_count,
    profitable_ca_count,best_source_rank,realized_profit_usd,unrealized_profit_usd
  )
  SELECT ranked.run_id,ranked.wallet_id,ranked.chain,ranked.chain_rank,
         ranked.total_profit_usd,ranked.source_ca_count,ranked.profitable_ca_count,
         ranked.best_source_rank,ranked.realized_profit_usd,ranked.unrealized_profit_usd
  FROM (
    SELECT i.*,w.chain,
      ROW_NUMBER() OVER (
        PARTITION BY i.run_id,w.chain
        ORDER BY i.total_profit_usd DESC,i.profitable_ca_count DESC,
          i.source_ca_count DESC,i.best_source_rank ASC,w.canonical_address ASC
      ) AS chain_rank
    FROM trench_index_wallets i
    JOIN trench_wallets w ON w.wallet_id=i.wallet_id
  ) ranked;

  DROP INDEX trench_index_wallets_rank;
  DROP INDEX trench_index_runs_status_started;
  DROP TABLE trench_index_wallets;
  DROP TABLE trench_index_runs;
  ALTER TABLE trench_index_wallets_next RENAME TO trench_index_wallets;
  ALTER TABLE trench_index_runs_next RENAME TO trench_index_runs;
  CREATE UNIQUE INDEX trench_index_wallets_rank
    ON trench_index_wallets(run_id,chain,chain_rank);
  CREATE INDEX trench_index_runs_status_started
    ON trench_index_runs(status,started_at DESC,run_id);
`;

const PERSON_REGISTRY_SCHEMA = `
  CREATE TABLE trench_wallets (
    wallet_id TEXT PRIMARY KEY,
    address_namespace TEXT NOT NULL,
    canonical_address TEXT NOT NULL,
    address TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    note TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    metadata_source TEXT NOT NULL DEFAULT 'gmgn',
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    metadata_updated_at INTEGER NOT NULL,
    CHECK (length(wallet_id) = 36),
    CHECK (address_namespace IN ('evm', 'solana')),
    CHECK (metadata_source IN ('manual', 'gmgn', 'agent', 'mixed'))
  );
  CREATE UNIQUE INDEX trench_wallets_identity
    ON trench_wallets(address_namespace, canonical_address);
  CREATE INDEX trench_wallets_name ON trench_wallets(name);
  CREATE INDEX trench_wallets_note ON trench_wallets(note);

  CREATE TABLE trench_wallet_chain_accounts (
    wallet_account_id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    wallet_kind TEXT NOT NULL DEFAULT 'unknown',
    classification_source TEXT NOT NULL DEFAULT 'unclassified',
    classification_updated_at INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    FOREIGN KEY (wallet_id) REFERENCES trench_wallets(wallet_id) ON DELETE RESTRICT,
    CHECK (length(wallet_account_id) = 36),
    CHECK (length(wallet_id) = 36),
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (wallet_kind IN ('user', 'amm', 'exchange', 'contract', 'unknown')),
    CHECK (classification_source IN (
      'chain-known', 'gmgn-addr-type', 'gmgn-label', 'manual', 'agent', 'mixed', 'unclassified'
    ))
  );
  CREATE UNIQUE INDEX trench_wallet_accounts_identity
    ON trench_wallet_chain_accounts(wallet_id, chain);
  CREATE INDEX trench_wallet_accounts_chain_kind
    ON trench_wallet_chain_accounts(chain, wallet_kind, wallet_id);

  CREATE TABLE trench_index_runs (
    run_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_fingerprint TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    target_count INTEGER NOT NULL,
    candidate_count INTEGER NOT NULL DEFAULT 0,
    eligible_count INTEGER NOT NULL DEFAULT 0,
    published_count INTEGER NOT NULL DEFAULT 0,
    policy_version TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    CHECK (length(run_id) = 36),
    CHECK (trigger IN ('add-target', 'reanalyze')),
    CHECK (status IN ('running', 'completed', 'failed')),
    CHECK (target_count BETWEEN 1 AND 1000),
    CHECK (candidate_count BETWEEN 0 AND 100000),
    CHECK (eligible_count BETWEEN 0 AND candidate_count),
    CHECK (published_count BETWEEN 0 AND 900)
  );
  CREATE INDEX trench_index_runs_status_started
    ON trench_index_runs(status, started_at DESC, run_id);

  CREATE TABLE trench_index_target_snapshots (
    run_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    token_name TEXT,
    token_symbol TEXT,
    price_usd REAL,
    circulating_supply REAL,
    current_market_cap_usd REAL,
    highest_market_cap_usd REAL,
    highest_market_cap_kind TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, target_id),
    FOREIGN KEY (run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_id) REFERENCES trench_index_targets(target_id) ON DELETE RESTRICT,
    CHECK (highest_market_cap_kind IN ('provider-ath', 'estimated-ath', 'observed', 'unavailable')),
    CHECK (price_usd IS NULL OR price_usd >= 0),
    CHECK (circulating_supply IS NULL OR circulating_supply >= 0),
    CHECK (current_market_cap_usd IS NULL OR current_market_cap_usd >= 0),
    CHECK (highest_market_cap_usd IS NULL OR highest_market_cap_usd >= 0)
  );

  CREATE TABLE trench_index_wallet_candidates (
    run_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    wallet_account_id TEXT NOT NULL,
    source_rank INTEGER NOT NULL,
    profit_usd REAL NOT NULL,
    realized_profit_usd REAL,
    unrealized_profit_usd REAL,
    eligible INTEGER NOT NULL,
    exclusion_reason TEXT,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, target_id, wallet_account_id),
    FOREIGN KEY (run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_id) REFERENCES trench_index_targets(target_id) ON DELETE RESTRICT,
    FOREIGN KEY (wallet_account_id) REFERENCES trench_wallet_chain_accounts(wallet_account_id)
      ON DELETE RESTRICT,
    CHECK (source_rank BETWEEN 1 AND 100),
    CHECK (eligible IN (0, 1)),
    CHECK ((eligible = 1 AND exclusion_reason IS NULL) OR
      (eligible = 0 AND exclusion_reason IS NOT NULL)),
    CHECK (exclusion_reason IS NULL OR exclusion_reason IN (
      'amm-or-liquidity-pool', 'exchange-or-custody', 'contract-or-program',
      'other-non-user', 'unknown-wallet-kind'
    ))
  );
  CREATE INDEX trench_index_candidates_wallet
    ON trench_index_wallet_candidates(wallet_account_id, run_id);
  CREATE UNIQUE INDEX trench_index_candidates_rank
    ON trench_index_wallet_candidates(run_id, target_id, source_rank);

  CREATE TABLE trench_index_wallets (
    run_id TEXT NOT NULL,
    wallet_account_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    chain_rank INTEGER NOT NULL,
    total_profit_usd REAL NOT NULL,
    source_ca_count INTEGER NOT NULL,
    profitable_ca_count INTEGER NOT NULL,
    best_source_rank INTEGER NOT NULL,
    realized_profit_usd REAL,
    unrealized_profit_usd REAL,
    PRIMARY KEY (run_id, wallet_account_id),
    FOREIGN KEY (run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT,
    FOREIGN KEY (wallet_account_id) REFERENCES trench_wallet_chain_accounts(wallet_account_id)
      ON DELETE RESTRICT,
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (chain_rank BETWEEN 1 AND 300),
    CHECK (source_ca_count BETWEEN 1 AND 1000),
    CHECK (profitable_ca_count BETWEEN 0 AND source_ca_count),
    CHECK (best_source_rank BETWEEN 1 AND 100)
  );
  CREATE UNIQUE INDEX trench_index_wallets_rank
    ON trench_index_wallets(run_id, chain, chain_rank);

  CREATE TABLE trench_persons (
    person_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    merged_into_person_id TEXT,
    display_name TEXT,
    avatar_url TEXT,
    note TEXT,
    display_name_source TEXT NOT NULL DEFAULT 'system',
    avatar_source TEXT NOT NULL DEFAULT 'system',
    note_source TEXT NOT NULL DEFAULT 'system',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (merged_into_person_id) REFERENCES trench_persons(person_id) ON DELETE RESTRICT,
    CHECK (length(person_id) = 36),
    CHECK (status IN ('active', 'merged')),
    CHECK ((status = 'active' AND merged_into_person_id IS NULL) OR
      (status = 'merged' AND merged_into_person_id IS NOT NULL)),
    CHECK (display_name_source IN ('system', 'import', 'gmgn', 'agent', 'manual')),
    CHECK (avatar_source IN ('system', 'import', 'gmgn', 'agent', 'manual')),
    CHECK (note_source IN ('system', 'import', 'gmgn', 'agent', 'manual'))
  );
  CREATE INDEX trench_persons_active_updated
    ON trench_persons(status, updated_at DESC, person_id);
  CREATE INDEX trench_persons_name ON trench_persons(display_name);

  CREATE TABLE trench_person_wallets (
    membership_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    link_source TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    linked_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (person_id) REFERENCES trench_persons(person_id) ON DELETE RESTRICT,
    FOREIGN KEY (wallet_id) REFERENCES trench_wallets(wallet_id) ON DELETE RESTRICT,
    CHECK (length(membership_id) = 36),
    CHECK (link_source IN (
      'index-auto', 'gmgn-x', 'import', 'manual', 'agent', 'transfer-evidence'
    ))
  );
  CREATE INDEX trench_person_wallets_person ON trench_person_wallets(person_id, linked_at, wallet_id);
  CREATE UNIQUE INDEX trench_person_wallets_wallet ON trench_person_wallets(wallet_id);

  CREATE TABLE trench_person_external_identities (
    external_identity_id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    canonical_value TEXT NOT NULL,
    display_value TEXT NOT NULL,
    source TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (person_id) REFERENCES trench_persons(person_id) ON DELETE RESTRICT,
    CHECK (length(external_identity_id) = 36),
    CHECK (provider = 'x'),
    CHECK (source IN ('system', 'import', 'gmgn', 'agent', 'manual')),
    CHECK (length(canonical_value) BETWEEN 1 AND 15)
  );
  CREATE UNIQUE INDEX trench_person_external_identity_unique
    ON trench_person_external_identities(provider, canonical_value);
  CREATE INDEX trench_person_external_identities_person
    ON trench_person_external_identities(person_id, provider, canonical_value);

  CREATE TABLE trench_person_identity_conflicts (
    conflict_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    canonical_value TEXT NOT NULL,
    identity_owner_person_id TEXT NOT NULL,
    contender_person_id TEXT NOT NULL,
    wallet_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (identity_owner_person_id) REFERENCES trench_persons(person_id) ON DELETE RESTRICT,
    FOREIGN KEY (contender_person_id) REFERENCES trench_persons(person_id) ON DELETE RESTRICT,
    FOREIGN KEY (wallet_id) REFERENCES trench_wallets(wallet_id) ON DELETE RESTRICT,
    CHECK (length(conflict_id) = 36),
    CHECK (provider = 'x'),
    CHECK (status IN ('open', 'resolved')),
    CHECK (identity_owner_person_id <> contender_person_id),
    CHECK ((status = 'open' AND resolved_at IS NULL) OR
      (status = 'resolved' AND resolved_at IS NOT NULL))
  );
  CREATE UNIQUE INDEX trench_person_identity_conflicts_open
    ON trench_person_identity_conflicts(provider, canonical_value, identity_owner_person_id,
      contender_person_id, wallet_id) WHERE status = 'open';

  CREATE TABLE trench_person_imports (
    import_id TEXT PRIMARY KEY,
    source_sha256 TEXT NOT NULL,
    chain TEXT NOT NULL,
    wallet_kind TEXT NOT NULL,
    normalization_version TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'staging',
    created_at INTEGER NOT NULL,
    finalized_at INTEGER,
    CHECK (length(import_id) = 36),
    CHECK (length(source_sha256) = 64),
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (wallet_kind = 'user'),
    CHECK (chunk_count BETWEEN 1 AND 10000),
    CHECK (row_count BETWEEN 0 AND 1000000),
    CHECK (status IN ('staging', 'completed')),
    CHECK ((status = 'staging' AND finalized_at IS NULL) OR
      (status = 'completed' AND finalized_at IS NOT NULL))
  );
  CREATE UNIQUE INDEX trench_person_imports_source
    ON trench_person_imports(source_sha256, chain, normalization_version);

  CREATE TABLE trench_person_import_chunks (
    import_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_hash TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (import_id, chunk_index),
    FOREIGN KEY (import_id) REFERENCES trench_person_imports(import_id) ON DELETE RESTRICT,
    CHECK (chunk_index BETWEEN 0 AND 9999),
    CHECK (length(chunk_hash) = 64)
  );

  CREATE TABLE trench_repository_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    current_run_id TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (current_run_id) REFERENCES trench_index_runs(run_id) ON DELETE RESTRICT
  );
`;

interface LegacyWalletRow {
  wallet_id: string;
  chain: 'bsc' | 'solana' | 'robinhood';
  canonical_address: string;
  address: string;
  name: string | null;
  avatar_url: string | null;
  note: string | null;
  metadata_json: string;
  metadata_source: 'manual' | 'gmgn' | 'agent' | 'mixed';
  wallet_kind: 'user' | 'amm' | 'exchange' | 'contract' | 'unknown';
  classification_source: string;
  classification_updated_at: number;
  first_seen_at: number;
  last_seen_at: number;
  metadata_updated_at: number;
}

interface LegacyWalletMetadata {
  cleaned: Record<string, unknown>;
  xIdentity: {
    canonicalValue: string;
    displayValue: string;
    metadataSource: LegacyWalletRow['metadata_source'];
    observedAt: number;
    legacyWalletId: string;
  } | null;
}

const metadataSourcePriority: Record<LegacyWalletRow['metadata_source'], number> = {
  gmgn: 1,
  agent: 3,
  manual: 4,
  mixed: 4,
};

const identitySourcePriority: Record<LegacyWalletRow['metadata_source'], number> = {
  gmgn: 1,
  mixed: 2,
  agent: 3,
  manual: 4,
};

const PERSON_IDENTITY_METADATA_KEYS = new Set([
  'twitter', 'twitterusername', 'twitterhandle', 'x', 'xusername', 'xhandle',
]);

const normalizedMetadataKey = (key: string): string => key.toLowerCase().replace(/[_\-.]/g, '');

const stripLegacyPersonIdentityMetadata = (
  value: unknown,
  row: LegacyWalletRow,
  identities: NonNullable<LegacyWalletMetadata['xIdentity']>[],
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stripLegacyPersonIdentityMetadata(item, row, identities));
  }
  if (!value || typeof value !== 'object') return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (PERSON_IDENTITY_METADATA_KEYS.has(normalizedMetadataKey(key))) {
      const identity = normalizeTrenchXIdentity(item);
      if (!identity) throw new Error('[trench-io] legacy wallet X identity is invalid');
      identities.push({
        ...identity,
        metadataSource: row.metadata_source,
        observedAt: row.metadata_updated_at,
        legacyWalletId: row.wallet_id,
      });
      continue;
    }
    cleaned[key] = stripLegacyPersonIdentityMetadata(item, row, identities);
  }
  return cleaned;
};

const parseLegacyWalletMetadata = (row: LegacyWalletRow): LegacyWalletMetadata => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.metadata_json) as unknown;
  } catch {
    throw new Error('[trench-io] legacy wallet metadata is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('[trench-io] legacy wallet metadata is invalid');
  }
  const identities: NonNullable<LegacyWalletMetadata['xIdentity']>[] = [];
  const cleaned = stripLegacyPersonIdentityMetadata(parsed, row, identities) as Record<string, unknown>;
  const canonicalValues = new Set(identities.map(({ canonicalValue }) => canonicalValue));
  if (canonicalValues.size > 1) {
    throw new Error('[trench-io] legacy wallet metadata contains conflicting X identities');
  }
  const xIdentity = identities.sort((left, right) =>
    identitySourcePriority[right.metadataSource] - identitySourcePriority[left.metadataSource] ||
    left.legacyWalletId.localeCompare(right.legacyWalletId) ||
    left.displayValue.localeCompare(right.displayValue))[0] ?? null;
  return { cleaned, xIdentity };
};

const canonicalJsonObject = (
  values: readonly LegacyWalletRow[],
  metadata: ReadonlyMap<string, LegacyWalletMetadata>,
): string => {
  const merged: Record<string, unknown> = {};
  for (const row of [...values].sort((left, right) =>
    metadataSourcePriority[left.metadata_source] - metadataSourcePriority[right.metadata_source] ||
    right.wallet_id.localeCompare(left.wallet_id))) {
    Object.assign(merged, metadata.get(row.wallet_id)!.cleaned);
  }
  return JSON.stringify(Object.fromEntries(Object.entries(merged).sort(([left], [right]) =>
    left.localeCompare(right))));
};

const legacyGroupXIdentity = (
  values: readonly LegacyWalletRow[],
  metadata: ReadonlyMap<string, LegacyWalletMetadata>,
): LegacyWalletMetadata['xIdentity'] => {
  const identities = values.flatMap((row) => {
    const identity = metadata.get(row.wallet_id)!.xIdentity;
    return identity ? [identity] : [];
  });
  const canonicalValues = new Set(identities.map(({ canonicalValue }) => canonicalValue));
  if (canonicalValues.size > 1) {
    throw new Error('[trench-io] cross-chain wallet metadata contains conflicting X identities');
  }
  return identities.sort((left, right) =>
    identitySourcePriority[right.metadataSource] - identitySourcePriority[left.metadataSource] ||
    left.legacyWalletId.localeCompare(right.legacyWalletId) ||
    left.displayValue.localeCompare(right.displayValue))[0] ?? null;
};

const deterministicMigrationUuid = (kind: string, walletId: string): string => {
  const bytes = createHash('sha256')
    .update(`trench:${TRENCH_IO_PERSON_SCHEMA_VERSION_CODE}:${kind}:${walletId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

const legacyIdentitySource = (
  source: LegacyWalletRow['metadata_source'],
): 'gmgn' | 'agent' | 'manual' => source === 'gmgn' ? 'gmgn' : source === 'manual' ? 'manual' : 'agent';

const preferredText = (
  values: readonly LegacyWalletRow[],
  field: 'name' | 'avatar_url' | 'note',
): string | null => [...values]
  .filter((row) => row[field] !== null)
  .sort((left, right) =>
    metadataSourcePriority[right.metadata_source] - metadataSourcePriority[left.metadata_source] ||
    left.wallet_id.localeCompare(right.wallet_id))[0]?.[field] ?? null;

const applyPersonRegistryMigration = (db: TrenchIoMigrationDatabase, now: number): void => {
  const legacyWallets = db.prepare('SELECT * FROM trench_wallets ORDER BY wallet_id').all() as LegacyWalletRow[];
  const legacyMetadata = new Map(legacyWallets.map((row) => [row.wallet_id, parseLegacyWalletMetadata(row)]));
  for (const index of [
    'trench_wallets_identity', 'trench_wallets_name', 'trench_wallets_note', 'trench_wallets_kind',
    'trench_index_runs_status_started', 'trench_index_candidates_wallet',
    'trench_index_candidates_rank', 'trench_index_wallets_rank',
  ]) db.exec(`DROP INDEX ${index};`);
  db.exec(`
    ALTER TABLE trench_repository_state RENAME TO trench_repository_state_019;
    ALTER TABLE trench_index_target_snapshots RENAME TO trench_index_target_snapshots_019;
    ALTER TABLE trench_index_wallet_candidates RENAME TO trench_index_wallet_candidates_019;
    ALTER TABLE trench_index_wallets RENAME TO trench_index_wallets_019;
    ALTER TABLE trench_wallets RENAME TO trench_wallets_019;
    ALTER TABLE trench_index_runs RENAME TO trench_index_runs_019;
    ${PERSON_REGISTRY_SCHEMA}
    INSERT INTO trench_index_runs SELECT * FROM trench_index_runs_019;
    INSERT INTO trench_index_target_snapshots SELECT * FROM trench_index_target_snapshots_019;
    INSERT INTO trench_repository_state SELECT * FROM trench_repository_state_019;
  `);

  const grouped = new Map<string, LegacyWalletRow[]>();
  for (const row of legacyWallets) {
    const namespace = row.chain === 'solana' ? 'solana' : 'evm';
    const key = `${namespace}:${row.canonical_address}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const insertWallet = db.prepare(`
    INSERT INTO trench_wallets (
      wallet_id,address_namespace,canonical_address,address,name,avatar_url,note,metadata_json,
      metadata_source,first_seen_at,last_seen_at,metadata_updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertAccount = db.prepare(`
    INSERT INTO trench_wallet_chain_accounts (
      wallet_account_id,wallet_id,chain,wallet_kind,classification_source,
      classification_updated_at,first_seen_at,last_seen_at
    ) VALUES (?,?,?,?,?,?,?,?)
  `);
  const groupIdentityByWalletId = new Map<string, LegacyWalletMetadata['xIdentity']>();
  for (const [key, rows] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    const [namespace] = key.split(':') as ['evm' | 'solana'];
    const walletId = rows.map((row) => row.wallet_id).sort()[0]!;
    const sources = new Set(rows.map((row) => row.metadata_source));
    insertWallet.run(
      walletId, namespace, rows[0]!.canonical_address, rows[0]!.address,
      preferredText(rows, 'name'), preferredText(rows, 'avatar_url'), preferredText(rows, 'note'),
      canonicalJsonObject(rows, legacyMetadata), sources.size === 1 ? rows[0]!.metadata_source : 'mixed',
      Math.min(...rows.map((row) => row.first_seen_at)),
      Math.max(...rows.map((row) => row.last_seen_at)),
      Math.max(...rows.map((row) => row.metadata_updated_at)),
    );
    groupIdentityByWalletId.set(walletId, legacyGroupXIdentity(rows, legacyMetadata));
    for (const row of rows) insertAccount.run(
      row.wallet_id, walletId, row.chain, row.wallet_kind, row.classification_source,
      row.classification_updated_at, row.first_seen_at, row.last_seen_at,
    );
  }
  db.exec(`
    INSERT INTO trench_index_wallet_candidates (
      run_id,target_id,wallet_account_id,source_rank,profit_usd,realized_profit_usd,
      unrealized_profit_usd,eligible,exclusion_reason,evidence_json
    ) SELECT run_id,target_id,wallet_id,source_rank,profit_usd,realized_profit_usd,
      unrealized_profit_usd,eligible,exclusion_reason,evidence_json
      FROM trench_index_wallet_candidates_019;
    INSERT INTO trench_index_wallets (
      run_id,wallet_account_id,chain,chain_rank,total_profit_usd,source_ca_count,
      profitable_ca_count,best_source_rank,realized_profit_usd,unrealized_profit_usd
    ) SELECT run_id,wallet_id,chain,chain_rank,total_profit_usd,source_ca_count,
      profitable_ca_count,best_source_rank,realized_profit_usd,unrealized_profit_usd
      FROM trench_index_wallets_019;
  `);

  const currentWallets = db.prepare(`
    SELECT DISTINCT accounts.wallet_id
    FROM trench_repository_state state
    JOIN trench_index_wallets results ON results.run_id=state.current_run_id
    JOIN trench_wallet_chain_accounts accounts
      ON accounts.wallet_account_id=results.wallet_account_id
    WHERE state.id=1 AND accounts.wallet_kind='user'
    ORDER BY accounts.wallet_id
  `).all() as Array<{ wallet_id: string }>;
  const insertPerson = db.prepare(`
    INSERT INTO trench_persons (
      person_id,status,merged_into_person_id,display_name,avatar_url,note,
      display_name_source,avatar_source,note_source,metadata_json,created_at,updated_at
    ) VALUES (?,'active',NULL,NULL,NULL,NULL,'system','system','system','{}',?,?)
  `);
  const insertMembership = db.prepare(`
    INSERT INTO trench_person_wallets (
      membership_id,person_id,wallet_id,link_source,evidence_json,linked_at,updated_at
    ) VALUES (?,?,?,'index-auto','{}',?,?)
  `);
  const personByWalletId = new Map<string, string>();
  for (const { wallet_id: walletId } of currentWallets) {
    const personId = deterministicMigrationUuid('person', walletId);
    personByWalletId.set(walletId, personId);
    insertPerson.run(personId, now, now);
    insertMembership.run(deterministicMigrationUuid('membership', walletId), personId, walletId, now, now);
  }

  const insertExternalIdentity = db.prepare(`
    INSERT INTO trench_person_external_identities (
      external_identity_id,person_id,provider,canonical_value,display_value,source,
      evidence_json,created_at,updated_at
    ) VALUES (?,?,'x',?,?,?,?,?,?)
  `);
  const insertConflict = db.prepare(`
    INSERT INTO trench_person_identity_conflicts (
      conflict_id,provider,canonical_value,identity_owner_person_id,contender_person_id,
      wallet_id,status,evidence_json,created_at,resolved_at
    ) VALUES (?,'x',?,?,?,?,'open',?,?,NULL)
  `);
  for (const { wallet_id: walletId } of currentWallets) {
    const identity = groupIdentityByWalletId.get(walletId);
    if (!identity) continue;
    const contenderPersonId = personByWalletId.get(walletId)!;
    const source = legacyIdentitySource(identity.metadataSource);
    const evidence = JSON.stringify({
      schema: 'bl-trench-x-legacy-wallet-evidence-v1',
      walletId,
      metadataSource: identity.metadataSource,
      observedAt: identity.observedAt,
    });
    const linkSource = source === 'gmgn' ? 'gmgn-x' : source;
    const owner = db.prepare(`
      SELECT person_id,source FROM trench_person_external_identities
      WHERE provider='x' AND canonical_value=?
    `).get(identity.canonicalValue) as { person_id: string; source: string } | undefined;
    if (!owner) {
      insertExternalIdentity.run(
        deterministicMigrationUuid('external-identity', walletId), contenderPersonId,
        identity.canonicalValue, identity.displayValue, source, evidence, now, now,
      );
      db.prepare(`
        UPDATE trench_person_wallets SET link_source=?,evidence_json=?,updated_at=?
        WHERE wallet_id=?
      `).run(linkSource, evidence, now, walletId);
      continue;
    }
    const curated = source === 'manual' || source === 'agent' ||
      owner.source === 'manual' || owner.source === 'agent';
    if (curated) {
      db.prepare(`
        UPDATE trench_person_wallets SET link_source=?,evidence_json=?,updated_at=?
        WHERE wallet_id=?
      `).run(linkSource, evidence, now, walletId);
      insertConflict.run(
        deterministicMigrationUuid(`identity-conflict:${owner.person_id}:${contenderPersonId}`, walletId),
        identity.canonicalValue, owner.person_id, contenderPersonId, walletId,
        JSON.stringify({ ...JSON.parse(evidence), displayValue: identity.displayValue, source }), now,
      );
      continue;
    }
    db.prepare(`
      UPDATE trench_person_wallets SET person_id=?,link_source='gmgn-x',evidence_json=?,updated_at=?
      WHERE wallet_id=?
    `).run(owner.person_id, evidence, now, walletId);
    db.prepare(`
      UPDATE trench_persons SET status='merged',merged_into_person_id=?,updated_at=? WHERE person_id=?
    `).run(owner.person_id, now, contenderPersonId);
  }

  db.exec(`
    DROP TABLE trench_repository_state_019;
    DROP TABLE trench_index_target_snapshots_019;
    DROP TABLE trench_index_wallet_candidates_019;
    DROP TABLE trench_index_wallets_019;
    DROP TABLE trench_wallets_019;
    DROP TABLE trench_index_runs_019;
  `);
  db.prepare(
    'INSERT INTO trench_schema_migrations (version_code,name,applied_at) VALUES (?,?,?)',
  ).run(TRENCH_IO_PERSON_SCHEMA_VERSION_CODE, 'global-wallet-person-registry', now);
};

const PERSON_IMPORT_LEDGER_MIGRATION = `
  CREATE TABLE trench_wallets_025 (
    wallet_id TEXT PRIMARY KEY,
    address_namespace TEXT NOT NULL,
    canonical_address TEXT NOT NULL,
    address TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    note TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    metadata_source TEXT NOT NULL DEFAULT 'gmgn',
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    metadata_updated_at INTEGER NOT NULL,
    CHECK (length(wallet_id) = 36),
    CHECK (address_namespace IN ('evm', 'solana')),
    CHECK (metadata_source IN ('manual', 'gmgn', 'import', 'agent', 'mixed'))
  );
  INSERT INTO trench_wallets_025 SELECT * FROM trench_wallets;

  CREATE TABLE trench_wallet_chain_accounts_025 (
    wallet_account_id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    wallet_kind TEXT NOT NULL DEFAULT 'unknown',
    classification_source TEXT NOT NULL DEFAULT 'unclassified',
    classification_updated_at INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    FOREIGN KEY (wallet_id) REFERENCES trench_wallets_025(wallet_id) ON DELETE RESTRICT,
    CHECK (length(wallet_account_id) = 36),
    CHECK (length(wallet_id) = 36),
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (wallet_kind IN ('user', 'amm', 'exchange', 'contract', 'unknown')),
    CHECK (classification_source IN (
      'chain-known', 'gmgn-addr-type', 'gmgn-label', 'import', 'manual', 'agent', 'mixed',
      'unclassified'
    ))
  );
  INSERT INTO trench_wallet_chain_accounts_025 SELECT * FROM trench_wallet_chain_accounts;

  DROP INDEX trench_wallet_accounts_chain_kind;
  DROP INDEX trench_wallet_accounts_identity;
  DROP INDEX trench_wallets_note;
  DROP INDEX trench_wallets_name;
  DROP INDEX trench_wallets_identity;
  DROP TABLE trench_wallet_chain_accounts;
  DROP TABLE trench_wallets;
  ALTER TABLE trench_wallets_025 RENAME TO trench_wallets;
  ALTER TABLE trench_wallet_chain_accounts_025 RENAME TO trench_wallet_chain_accounts;
  CREATE UNIQUE INDEX trench_wallets_identity
    ON trench_wallets(address_namespace, canonical_address);
  CREATE INDEX trench_wallets_name ON trench_wallets(name);
  CREATE INDEX trench_wallets_note ON trench_wallets(note);
  CREATE UNIQUE INDEX trench_wallet_accounts_identity
    ON trench_wallet_chain_accounts(wallet_id, chain);
  CREATE INDEX trench_wallet_accounts_chain_kind
    ON trench_wallet_chain_accounts(chain, wallet_kind, wallet_id);

  DROP INDEX trench_person_imports_source;
  DROP TABLE trench_person_import_chunks;
  DROP TABLE trench_person_imports;

  CREATE TABLE trench_person_imports (
    import_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    chain TEXT NOT NULL,
    wallet_kind TEXT NOT NULL,
    normalization_version TEXT NOT NULL,
    chunk_count INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'staging',
    created_at INTEGER NOT NULL,
    finalized_at INTEGER,
    created_persons INTEGER NOT NULL DEFAULT 0,
    created_wallets INTEGER NOT NULL DEFAULT 0,
    created_chain_accounts INTEGER NOT NULL DEFAULT 0,
    linked_existing_wallets INTEGER NOT NULL DEFAULT 0,
    skipped_existing_memberships INTEGER NOT NULL DEFAULT 0,
    collapsed_duplicates INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    CHECK (length(import_id) = 36),
    CHECK (length(request_id) = 36),
    CHECK (length(source_sha256) = 64),
    CHECK (length(content_sha256) = 64),
    CHECK (chain IN ('bsc', 'solana', 'robinhood')),
    CHECK (wallet_kind = 'user'),
    CHECK (normalization_version = 'trench-person-import-v1'),
    CHECK (chunk_count BETWEEN 1 AND 10000),
    CHECK (row_count BETWEEN 1 AND 2500000),
    CHECK (status IN ('staging', 'completed')),
    CHECK (created_persons >= 0 AND created_wallets >= 0 AND created_chain_accounts >= 0),
    CHECK (linked_existing_wallets >= 0 AND skipped_existing_memberships >= 0),
    CHECK (collapsed_duplicates >= 0 AND revision >= 0),
    CHECK ((status = 'staging' AND finalized_at IS NULL) OR
      (status = 'completed' AND finalized_at IS NOT NULL))
  );
  CREATE UNIQUE INDEX trench_person_imports_source
    ON trench_person_imports(source_sha256, chain, normalization_version);
  CREATE UNIQUE INDEX trench_person_imports_request
    ON trench_person_imports(request_id);

  CREATE TABLE trench_person_import_chunks (
    import_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_hash TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (import_id, chunk_index),
    FOREIGN KEY (import_id) REFERENCES trench_person_imports(import_id) ON DELETE RESTRICT,
    CHECK (chunk_index BETWEEN 0 AND 9999),
    CHECK (length(chunk_hash) = 64),
    CHECK (length(content_json) BETWEEN 2 AND 1000000)
  );
`;

const applyPersonImportLedgerMigration = (
  db: TrenchIoMigrationDatabase,
  now: number,
): void => {
  const importCount = db.prepare('SELECT COUNT(*) AS count FROM trench_person_imports')
    .get() as { count?: unknown } | undefined;
  const chunkCount = db.prepare('SELECT COUNT(*) AS count FROM trench_person_import_chunks')
    .get() as { count?: unknown } | undefined;
  if (importCount?.count !== 0 || chunkCount?.count !== 0) {
    throw new Error('[trench-io] pre-release person import staging rows are not supported');
  }
  db.exec(PERSON_IMPORT_LEDGER_MIGRATION);
  db.prepare(
    'INSERT INTO trench_schema_migrations (version_code,name,applied_at) VALUES (?,?,?)',
  ).run(TRENCH_IO_SCHEMA_VERSION_CODE, 'person-import-ledger', now);
};

interface ColumnRow {
  name: unknown;
}

interface IndexRow {
  name: unknown;
}

interface IndexColumnRow {
  name: unknown;
}

interface ForeignKeyRow {
  table: unknown;
  from: unknown;
}

interface TrenchMigrationLedgerRow {
  version_code: unknown;
  name: unknown;
  applied_at: unknown;
}

const readTrenchIoMigrationLedger = (
  db: TrenchIoMigrationDatabase,
): readonly TrenchMigrationLedgerRow[] => db.prepare(`
  SELECT version_code,name,applied_at FROM trench_schema_migrations ORDER BY version_code
`).all() as TrenchMigrationLedgerRow[];

const assertTrenchIoMigrationLedgerPrefix = (
  rows: readonly TrenchMigrationLedgerRow[],
): void => {
  if (rows.length < 1 || rows.length > TRENCH_IO_MIGRATION_MANIFEST.length) {
    throw new Error('[trench-io] migration ledger is not an exact supported manifest prefix');
  }
  let priorAppliedAt = -1;
  for (const [index, row] of rows.entries()) {
    const expected = TRENCH_IO_MIGRATION_MANIFEST[index]!;
    if (row.version_code !== expected.versionCode || row.name !== expected.name) {
      throw new Error('[trench-io] migration ledger identity or order is invalid');
    }
    if (!Number.isSafeInteger(row.applied_at) || (row.applied_at as number) < 0 ||
      (row.applied_at as number) < priorAppliedAt) {
      throw new Error('[trench-io] migration ledger timestamp is invalid');
    }
    priorAppliedAt = row.applied_at as number;
  }
};

export const assertTrenchIoSchema = (db: TrenchIoMigrationDatabase): void => {
  for (const [table, expected] of Object.entries(TRENCH_IO_TABLE_COLUMNS)) {
    const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as ColumnRow[];
    const actual = columns.map((row) => row.name);
    if (actual.length !== expected.length || !expected.every((column, index) => actual[index] === column)) {
      throw new Error(`[trench-io] ${table} does not match its column contract`);
    }
  }
  const indexes = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as IndexRow[])
      .map((row) => row.name),
  );
  for (const index of TRENCH_IO_INDEXES) {
    if (!indexes.has(index)) throw new Error(`[trench-io] index ${index} is missing`);
  }
  const rankColumns = db.prepare('PRAGMA index_info("trench_index_wallets_rank")').all()
    .map((row) => (row as IndexColumnRow).name);
  if (rankColumns.join(',') !== 'run_id,chain,chain_rank') {
    throw new Error('[trench-io] chain-local rank index does not match its column contract');
  }
  const foreignKeys: Record<string, Record<string, string>> = {
    trench_wallet_chain_accounts: { wallet_id: 'trench_wallets' },
    trench_index_wallet_candidates: { wallet_account_id: 'trench_wallet_chain_accounts' },
    trench_index_wallets: { wallet_account_id: 'trench_wallet_chain_accounts' },
    trench_persons: { merged_into_person_id: 'trench_persons' },
    trench_person_wallets: { person_id: 'trench_persons', wallet_id: 'trench_wallets' },
    trench_person_external_identities: { person_id: 'trench_persons' },
    trench_person_identity_conflicts: {
      identity_owner_person_id: 'trench_persons',
      contender_person_id: 'trench_persons',
      wallet_id: 'trench_wallets',
    },
    trench_person_import_chunks: { import_id: 'trench_person_imports' },
  };
  for (const [table, expected] of Object.entries(foreignKeys)) {
    const actual = new Map((db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as ForeignKeyRow[])
      .map((row) => [String(row.from), String(row.table)]));
    for (const [column, target] of Object.entries(expected)) {
      if (actual.get(column) !== target) {
        throw new Error(`[trench-io] ${table}.${column} foreign key is missing`);
      }
    }
  }
};

export const applyTrenchIoMigrations = (
  db: TrenchIoMigrationDatabase,
  currentVersionCode: string,
  now = Date.now(),
): void => {
  if (!/^\d{12}$/.test(currentVersionCode)) {
    throw new Error('[trench-io] current version code is invalid');
  }
  if (compareVersions(currentVersionCode, TRENCH_IO_SCHEMA_VERSION_CODE) < 0) {
    throw new Error('[trench-io] application version predates the Trench schema');
  }
  const migrationTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='trench_schema_migrations'",
  ).get();
  if (!migrationTable) {
    const existing = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'trench_%'",
    ).all();
    if (existing.length > 0) {
      throw new Error('[trench-io] partial pre-ledger schema is not supported');
    }
    db.transaction(() => {
      db.exec(TRENCH_IO_CHAIN_SCHEMA);
      db.prepare(
        'INSERT INTO trench_schema_migrations (version_code,name,applied_at) VALUES (?,?,?)',
      ).run(TRENCH_IO_INITIAL_SCHEMA_VERSION_CODE, 'initial-index-schema', now);
      db.prepare(
        'INSERT INTO trench_schema_migrations (version_code,name,applied_at) VALUES (?,?,?)',
      ).run(TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE, 'chain-partitioned-index', now);
      db.prepare(
        'INSERT INTO trench_repository_state (id,revision,current_run_id,updated_at) VALUES (1,0,NULL,?)',
      ).run(now);
    })();
  }
  let ledger = readTrenchIoMigrationLedger(db);
  assertTrenchIoMigrationLedgerPrefix(ledger);
  if (ledger.length === 1) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(CHAIN_PARTITION_MIGRATION);
        db.prepare(
          'INSERT INTO trench_schema_migrations (version_code,name,applied_at) VALUES (?,?,?)',
        ).run(TRENCH_IO_CHAIN_SCHEMA_VERSION_CODE, 'chain-partitioned-index', now);
      })();
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    ledger = readTrenchIoMigrationLedger(db);
    assertTrenchIoMigrationLedgerPrefix(ledger);
  }
  if (ledger.length === 2) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.transaction(() => applyPersonRegistryMigration(db, now))();
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    ledger = readTrenchIoMigrationLedger(db);
    assertTrenchIoMigrationLedgerPrefix(ledger);
  }
  if (ledger.length === 3) {
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.transaction(() => applyPersonImportLedgerMigration(db, now))();
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    ledger = readTrenchIoMigrationLedger(db);
    assertTrenchIoMigrationLedgerPrefix(ledger);
  }
  if (ledger.length !== TRENCH_IO_MIGRATION_MANIFEST.length) {
    throw new Error('[trench-io] migration ledger is not current');
  }
  assertTrenchIoSchema(db);
};
