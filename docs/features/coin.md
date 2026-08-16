# BL Trench Record Vault

Status: Superseded for the visible UI by [`trench-index.md`](trench-index.md); retained as the
legacy JSON/MCP repository contract

## Purpose

BL Trench is a local evidence vault. It renders analysis produced by an external agent and written
to Bitterless through the production `bitterless` MCP server. Trench itself does not discover a
chain, query GMGN, run Codex, inspect X, score a token, or accept an analysis prompt.

The existing internal `coin` runtime name may remain for compatibility, but the user-visible
product is Trench and its active renderer/preload path is read-only.

## Information architecture

| Module           | Left pane                                           | Right pane                                                                      | Writer                                                                 |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| CA Records       | searchable current CA records, newest first         | structured chain/token/result/wallet/exposure evidence plus exact-document copy | `trench.analysis.put`                                                  |
| Index Wallets    | derived positive-wallet dictionary                  | source CAs, ranks, profit evidence, and recorded CA exposure                    | derived from current CA JSON                                           |
| Negative Wallets | manually supplied negative wallets and explanations | structured tag provenance plus the wallet's separate holdings analysis          | `trench.negative_wallet.put` and `trench.negative_wallet_holdings.put` |

There is no Analyze, Paste and analyze, Terminal, Scan, Focus, Decision, Codex, model, effort,
resource, or X-browser control. Search, selection, JSON copy, refresh, and opening the same vault in
Omni are record operations, not analysis capabilities.

## Identity and JSON contracts

One canonical contract address owns one active JSON file. EVM addresses are compared and stored in
lowercase; Solana addresses preserve case after a real Base58 decode proves a 32-byte public key.
If the same EVM address exists on BSC and Robinhood Chain, both chain results live inside that one
file. A Solana-shaped CA may contain only `solana`; an EVM-shaped CA may contain unique `bsc` and/or
`robinhood` results.

```ts
type TrenchChain = 'bsc' | 'solana' | 'robinhood';

interface TrenchCaAnalysisV1 {
  schema: 'bl-trench-ca-analysis-v1';
  analysisId: string; // caller-generated idempotency key
  contractAddress: string;
  generatedAt: string; // ISO-8601, caller-owned evidence time
  source: {
    kind: 'agent' | 'legacy-coin-state';
    agent?: string;
    skill?: string;
    providers: string[];
  };
  chains: TrenchChainAnalysisV1[];
}

interface TrenchChainAnalysisV1 {
  chain: TrenchChain;
  token?: { name?: string; symbol?: string };
  topProfitWallets: Array<{
    address: string;
    rank: number;
    profitUsd?: number;
    winRate?: number; // inclusive 0..1
    evidence?: Record<string, unknown>;
  }>;
  indexWalletExposure?: TrenchWalletExposureV1[];
  negativeWalletExposure?: TrenchWalletExposureV1[];
  result: Record<string, unknown>;
}

interface TrenchWalletExposureV1 {
  address: string; // chain is the containing chain result
  holding: boolean | null; // null means the source proved neither yes nor no
  balance?: string; // decimal string; never an unsafe JavaScript integer
  sharePercent?: number; // 0..100
  valueUsd?: number; // >= 0
  evidence?: Record<string, unknown>;
}

interface TrenchNegativeWalletV1 {
  schema: 'bl-trench-negative-wallet-v1';
  tagId: string; // caller requestId
  chain: TrenchChain;
  address: string;
  explanation: string;
  source: 'human-via-agent';
  createdAt: string; // assigned by Bitterless Main
  updatedAt: string; // assigned by Bitterless Main
}

interface TrenchNegativeWalletHoldingsV1 {
  schema: 'bl-trench-negative-wallet-holdings-v1';
  analysisId: string;
  chain: TrenchChain;
  address: string;
  generatedAt: string;
  holdings: Array<{
    contractAddress?: string; // omitted only for the chain's native asset
    symbol?: string;
    balance?: string;
    valueUsd?: number; // >= 0
    portfolioPercent?: number; // 0..100
    evidence?: Record<string, unknown>;
  }>;
  result: Record<string, unknown>;
}
```

Within one CA chain result, wallet/exposure addresses must match that chain's address shape and are
unique after canonicalization. `topProfitWallets` contains contiguous, unique ranks `1..N`, where
`N <= 100`. Exposure identities are unique. When `holding` is `false` or `null`, balance/share/value
fields must be absent; `true` may carry any subset of valid measurements.

Exposure references are validated atomically at CA put time. A Negative exposure must point to a
currently live Negative Wallet. An Index exposure must exist in the prospective Index projection:
current active CA files excluding the replaced CA, plus the incoming CA. A later CA/tag replacement
or archive never rewrites historical CA JSON; read detail computes whether each reference is still
`active` or `no-longer-current`. An exposure never independently creates an Index Wallet.

For `source.kind: agent`, `agent` and `skill` are required; for `legacy-coin-state` they are absent.
Provider names are bounded provenance labels, never credentials. Balance strings are non-negative
decimal fixed-point values. Holdings assets are unique by canonical contract address plus one
optional native-asset sentinel, and token contract addresses must match the wallet chain.

Before serialization, providers sort lexically, chain blocks use `bsc`, `solana`, `robinhood`, top
wallets sort by rank, exposures by canonical address, and holdings by native/contract identity.
Duplicate set members are rejected rather than silently removed. Address compatibility makes the
effective top-profit maximum 100 for a Solana CA or 200 for an EVM CA with both BSC and Robinhood
results. `profitUsd` may be negative; `winRate` must be within `0..1`.

`analysisId` makes an exact retry idempotent. The same ID with different canonical content is an
idempotency conflict. A different ID replaces current JSON only when `generatedAt` is strictly
newer; an equal/older value is stale unless `replaceNewer: true` is explicit. A caller time more
than five minutes ahead of Main's clock is invalid. The left pane is a history of analyzed CAs, not
an unbounded revision log.

## Canonical document and bounds

After validation, the repository recursively sorts object keys, pretty-prints with two spaces and
LF line endings, adds one trailing newline, and writes those UTF-8 bytes. `contentHash` is SHA-256 of
those exact bytes, encoded as `sha256:<64 lowercase hex>`. `get` returns both the parsed record and
`document: string`. Trench renders the parsed record through domain components and copies the
returned `document` directly through an exact-document action. Raw JSON is not the primary preview,
and “exact stored JSON” does not mean preserving caller whitespace lost by MCP.

Limits are explicit: one canonical document at most 2 MiB, JSON depth at most 32, one string at most
64 KiB, flexible evidence/result arrays at most 1,000 items, at most two CA chain results, and at
most 100 top-profit wallets per chain. Numbers must be finite and every flexible value must be plain
JSON. Credentials cannot be recognized perfectly inside arbitrary strings; excluding secrets is a
caller/skill policy, while the repository mechanically enforces only shape and bounds.

## Local storage

Bitterless Main owns the repository below its environment-specific `userData` directory:

```text
userData/trench/
├─ analyses/<sha256-of-canonical-address>.json
├─ negative-wallets/<chain>/<sha256-of-canonical-address>/
│  ├─ tag.json
│  └─ holdings.json
└─ archive/...
```

On POSIX, directories are enforced as `0700` and files as `0600`. On Windows, the repository stays
under the current user's `userData`, inherits its per-user ACL, and never broadens that ACL; POSIX
mode bits are not claimed there. Every file mutation writes a uniquely created temporary file,
fsyncs/closes it, atomically renames it, then rereads and validates the persisted bytes. Per-identity
writes are serialized. Negative archive atomically renames the whole wallet directory, so tag and
holdings cannot split during a crash.

The supported writer boundary is the single Bitterless Main process: renderer and MCP callers never
provide filesystem paths, the helper never writes Trench files, and Main serializes repository
mutations. The repository rejects traversal, pre-existing symlink/reparse-point components,
non-regular record files, and resolved paths outside `userData/trench`. It does not claim to sandbox
another process already running as the same OS user that concurrently renames repository parents;
that principal can already directly alter the user's `userData` and other owner-readable files.
Covering that stronger threat requires a separately shipped and dual-platform-verified native
handle-relative filesystem adapter; it is outside v1 rather than being approximated with a racy
path recheck.

Archive is a terminal MCP operation guarded by expected ID and content hash. Archived bytes remain
on disk for forensic/manual recovery, but v1 exposes no MCP restore. The old
`userData/coin/coin-state.json` is never deleted or rewritten; a future bounded migrator may copy
valid legacy analysis with `source.kind: 'legacy-coin-state'`.

## Index Wallet derivation

Index Wallets are not a second hand-editable source of truth. `trench.index_wallet.list` scans the
current CA files and folds every chain result's `topProfitWallets` into a dictionary keyed by
`{chain,address}`. Each item retains every source CA, rank, profit evidence, and analysis time.
Replacing or archiving a CA immediately removes stale provenance.

Before analyzing a new CA, the external skill reads the Index and Negative dictionaries, checks
their exposure in the target token, and records the resulting positive/negative exposure inside the
new CA JSON. Trench only previews those fields.

## Negative Wallet lifecycle

A negative wallet is created only after a human explicitly supplies its address and explanation to
an agent. The agent sends `requestId`, chain, address, and explanation. Bitterless writes
`tagId = requestId`, canonical identity, `source: human-via-agent`, and Main-owned timestamps. The
same request/content is idempotent; the same request ID with different content conflicts; a new
request ID explicitly corrects the record while preserving `createdAt`.

`explanation` is trimmed as a whole, allows intentional line breaks, rejects NUL/control payloads,
and is limited to 2,000 Unicode code points. The list uses its first non-empty line; detail preserves
the complete explanation.

Holdings analysis is a separate external operation and `holdings.json`. Its ID/time conflict rules
match CA analysis and it never changes `tag.json`. Holdings require a live tag. Archiving a negative
wallet requires a separate explicit human request and moves the whole directory.

## Read APIs and refresh

List calls accept `{query?: string, cursor?: string, limit?: number}` with a trimmed 200-code-point
query, default limit 50, and maximum 100. Cursors are opaque and bound to the normalized query,
module, and revision. CA sorts by `generatedAt DESC, canonicalAddress ASC`; Negative
sorts by `updatedAt DESC, chain ASC, address ASC`; Index sorts by last evidence time descending,
then chain/address. Responses contain metadata only, `nextCursor`, repository `revision`, and a
bounded `issues` array for invalid stored entries. A cursor also binds the originating revision;
mutation between pages returns `CURSOR_STALE` instead of silently skipping/duplicating entries.
Detail `get` fetches one selected document. Index list returns summaries only. Index get pages one
selected wallet's source-CA summaries: CA/analysis ID/hash, rank/profit/win-rate,
`evidenceAvailable`, and exposure measurements without flexible evidence. Full evidence remains in
the source CA document and is read through `trench.analysis.get`. An Index detail response stops
before 1 MiB even when its item limit is not reached and supplies `nextCursor`.

Committed mutations broadcast this content-free event:

```ts
interface TrenchDataChangedV1 {
  schema: 'bl-trench-data-changed-v1';
  revision: number;
  entity: 'analysis' | 'negative-wallet' | 'negative-wallet-holdings';
  identity: string;
  operation: 'put' | 'archive';
}
```

The renderer subscribes before its first fetch and rejects responses older than the latest observed
revision/request generation. Trench read methods return discriminated
`{ok:true,value}|{ok:false,error:{code,message}}` results because `electron-xpc` converts thrown Main
errors to `null`. Missing and failed reads remain distinct.

Pure XPC has no sender context, so `TrenchHandler` is intentionally an app-wide trusted, read-only
API available to first-party local renderers that load `electron-xpc`; remote Omni browser cells do
not. All mutation remains behind MCP/Main validation.

## Active runtime boundary

Trench uses a dedicated preload exposing only static host context and `electron-xpc`. The active
standalone window lifecycle no longer imports/registers legacy Coin data, AI, strategy, resource,
clipboard, or X-browser services. Historical source may remain unreachable, but neither standalone
nor Omni Trench loads the legacy Coin preload or active analysis import graph.

## Omni hosting

Trench is a first-party Omni mini app with ID `trench`, URL `bl://miniapp/trench`, the dedicated
preload, and the local Trench renderer. It renders inside the operation `WebContentsView`; selecting
it does not open the standalone window. Its runtime explicitly opts into sandbox, context isolation,
web security, no Node integration, and navigation/new-window fences.

Standalone chrome is hidden in Omni. Embedded roots have no 800×600 CSS minimum, drag region,
traffic-light padding, or native window controls. Multiple Trench cells may read the same repository
and receive the same broadcast because no process-global analysis job remains active.

## Lifecycle and CRUD closure

| Entity            | Create                              | Read/search       | Update                                     | Terminal state                             |
| ----------------- | ----------------------------------- | ----------------- | ------------------------------------------ | ------------------------------------------ |
| CA analysis       | MCP `put`                           | UI + MCP list/get | newer/CAS-safe `put` replaces current JSON | explicit CAS archive; bytes retained       |
| Index wallet      | derived from CA JSON                | UI + MCP list     | automatic rebuild                          | disappears when no active CA references it |
| Negative wallet   | explicit human-authorized MCP `put` | UI + MCP list/get | explicit correction                        | explicit whole-directory CAS archive       |
| Negative holdings | MCP `put`                           | UI + MCP get      | newer snapshot replaces current JSON       | archived with its negative tag             |

The renderer intentionally has no mutation controls. Empty, loading, selected, stale-refresh,
invalid-file, repository-unavailable, and read-error states are visible; no sample data is fabricated.

## Acceptance

- Standalone Trench shows exactly CA Records, Index Wallets, and Negative Wallets, with no analysis
  trigger or legacy analysis/resource/X preload method.
- One MCP CA write creates exactly one active address-keyed JSON; a BSC+Robinhood address contains
  two independently renderable chain blocks in that file.
- An already-open row live-refreshes into structured domain sections without clearing valid old
  evidence; `Copy exact JSON` returns the exact `document` whose UTF-8 bytes produced `contentHash`.
- Index Wallets are the deterministic union of at most 100 wallets per active CA chain block and
  lose stale provenance after replacement/archive.
- A human-explained Negative Wallet and its holdings appear together while remaining separate JSON
  documents in one atomically archivable directory.
- Omni offers Trench as a real local cell. Standalone and Omni show the same records, and 800×568,
  398×568, and 800×282 cells have no body-level horizontal overflow.
- Foreign paths, malformed/incompatible addresses, duplicate chains/wallets/ranks, gaps in ranks,
  stale/future writes, ID/hash conflicts, oversized/deep JSON, remote navigation, and partial writes
  fail closed.

## Superseded behavior

`coin-analysis-workspace-003`, `coin-ai-analysis-004`, `trench-single-page-workspace-008`, and
`trench-auto-chain-analysis-009` describe historical analysis surfaces. Their user-visible actions
are not retained as an alternate Trench mode.
