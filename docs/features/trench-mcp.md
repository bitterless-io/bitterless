# BL Trench MCP And Agent Skill

Status: Accepted for implementation

## Boundary

The production `bitterless` MCP server is the only write path into the Trench vault. The agent or
its read-only market/wallet skills performs research; the running Bitterless GUI validates and owns
local persistence. Neither the stdio helper nor `bitterless-trench` opens `userData` directly.

```text
human request
  -> agent + read-only research skills/data sources
  -> bitterless-trench workflow
  -> production bitterless MCP helper
  -> GUI local RPC bridge
  -> Trench repository (validate / atomic write / reread)
  -> XPC data-changed broadcast
  -> standalone and Omni Trench refresh
```

No API key, private key, cookie, signing material, or credential path may enter MCP arguments,
persisted analysis, logs, the portable skill, or a renderer. This is a skill/caller policy; the
repository enforces JSON shape/bounds but cannot prove an arbitrary string contains no secret.

The helper now serves Todo and Trench, so its MCP wire identity is `name: bitterless`, version
`0.2.0`. Registration key and helper path remain `bitterless`; no second server is introduced.

## Public tools

| Tool | Input | Output | Mutation rule |
|---|---|---|---|
| `trench.analysis.put` | `{record, replaceNewer?}` | persisted analysis detail + `changed` | ID/time rules below |
| `trench.analysis.list` | `{query?,cursor?,limit?}` | metadata page + issues/revision | read-only |
| `trench.analysis.get` | `{contractAddress}` | parsed record, exact document, hash | no path input |
| `trench.analysis.archive` | `{contractAddress,expectedAnalysisId,expectedContentHash}` | archive receipt | explicit human request + CAS |
| `trench.index_wallet.list` | `{query?,cursor?,limit?}` | derived wallet page + issues/revision | read-only projection |
| `trench.index_wallet.get` | `{chain,address,cursor?,limit?}` | wallet summary + paged source-CA provenance | read-only projection |
| `trench.negative_wallet.put` | `{requestId,chain,address,explanation}` | persisted tag detail + `changed` | human-authorized only |
| `trench.negative_wallet.list` | `{query?,cursor?,limit?}` | metadata page + issues/revision | read-only |
| `trench.negative_wallet.get` | `{chain,address}` | tag, holdings status, composite hash | read-only |
| `trench.negative_wallet_holdings.put` | `{record,replaceNewer?}` | persisted holdings detail + `changed` | requires live tag |
| `trench.negative_wallet_holdings.get` | `{chain,address}` | parsed holdings, exact document, hash | read-only |
| `trench.negative_wallet.archive` | `{chain,address,expectedTagId,expectedContentHash}` | archive receipt | whole-directory CAS |

List queries trim to at most 200 Unicode code points; limits default to 50 and cap at 100. Cursor
values bind the normalized query/module/revision. Pages carry
`nextCursor`, repository `revision`, and at most 100 sanitized invalid-file issues; full flexible
results/documents appear only in detail calls. Invalid cursors fail explicitly.
Index list items contain only summary/count/rank/timestamp fields; unbounded source provenance is
paged by Index get. Source items omit flexible evidence and point to the source CA content hash;
full evidence is obtained with Analysis get. Index get caps its serialized result below 1 MiB and
may end a page before the item limit. If the repository revision changes between pages, the cursor
returns `CURSOR_STALE` and the caller restarts that query.

## Put and archive contracts

```ts
type AnalysisPutInput = {
  record: TrenchCaAnalysisV1;
  replaceNewer?: boolean;
};

type NegativeWalletPutInput = {
  requestId: string;
  chain: TrenchChain;
  address: string;
  explanation: string;
};

type NegativeHoldingsPutInput = {
  record: TrenchNegativeWalletHoldingsV1;
  replaceNewer?: boolean;
};

type AnalysisArchiveInput = {
  contractAddress: string;
  expectedAnalysisId: string;
  expectedContentHash: string;
};

type NegativeArchiveInput = {
  chain: TrenchChain;
  address: string;
  expectedTagId: string;
  expectedContentHash: string; // composite tag + optional holdings hash
};
```

| Existing state | Incoming write | Result |
|---|---|---|
| none | valid record | create |
| same ID + same canonical document | retry | success, `changed: false` |
| same ID + different canonical document | any | `IDEMPOTENCY_CONFLICT` |
| different ID + strictly newer generated time | normal put | replace |
| different ID + equal/older generated time | normal put | `STALE_WRITE` |
| different ID + equal/older generated time | `replaceNewer: true` | explicit replace |
| generated time > Main now + 5 minutes | any | `FUTURE_TIMESTAMP` |
| archive expected ID/hash no longer current | archive | `CONFLICT`; nothing moves |

Negative tag timestamps are Main-owned. Same `requestId`/content is idempotent; the same ID with
different content conflicts; a new request ID is an explicit correction that preserves `createdAt`
and advances `updatedAt`. Negative get returns a composite hash covering `tag.json` and optional
`holdings.json`, so archive compares and atomically moves the whole directory. Archived bytes are
retained for forensic/manual recovery; v1 has no MCP restore.

Every successful mutation returns a persisted reread, exact canonical document where applicable,
content hash, and repository revision. The agent must call the corresponding get/list once and
compare ID, identity, chains, and hash before claiming success. A timeout is indeterminate: reread
before retrying.

## Portable skill

The application ships `skills/bitterless-trench/` with `SKILL.md`, `agents/openai.yaml`, and focused
references for MCP setup, tools, and JSON schemas. It depends on the existing MCP server named
`bitterless` and does not register another server.

The skill has two explicit workflows:

1. Analyze CA: read Index and Negative dictionaries, gather source-backed chain-specific evidence,
   select at most 100 top-profit wallets per chain result, calculate tracked-wallet exposure, put
   the one-address JSON, then reread it.
2. Curate negative wallet: require the human-provided explanation, put the tag, optionally run a
   separate holdings analysis, put that JSON, then reread both records.

The skill may coordinate installed read-only `gmgn-token` and `gmgn-portfolio` skills, but it never
buys, sells, signs, launches a token, or fabricates unavailable data. Provider failures and unknown
values stay explicit in the relevant chain `result`. A provider CLI may consume its own already
configured local credential, but `bitterless-trench` never reads, forwards, logs, or persists it.
For Ral's workspace, any setup lookup must use the exact owner-matched Ops inventory entry and must
not read keychain; an absent Ops resource means the provider-dependent step is unavailable.

## Installation and owner acceptance

The exported skill directory is installed additively at:

- Codex: `~/.codex/skills/bitterless-trench/`
- Claude Code: `~/.claude/skills/bitterless-trench/`
- workspace mirrors: `.agents/skills/bitterless-trench/` and `.claude/skills/bitterless-trench/`

### In-app agent setup guide

Standalone and Omni Trench expose the same always-available Robot action in the Trench header. It
opens a local-only Agent setup modal generated from the currently running Main process:

```text
Trench header Robot
  -> Main ensures the current profile's local MCP shim
  -> Main resolves the bundled bitterless-trench directory
  -> Main returns server name, helper path, MCP JSON, skill path/version, and one English payload
  -> renderer displays three ordered steps and copies exact returned values
```

The guide contains:

1. **Connect MCP** — the current helper path and exact MCP configuration.
2. **Install bitterless-trench** — the complete bundled skill directory, Codex and Claude Code
   destinations, and current 12-digit skill version.
3. **Restart and verify** — start a fresh agent session, keep this Bitterless instance running,
   confirm all 12 `trench.*` tools, then invoke `$bitterless-trench` in Codex or
   `/bitterless-trench` in Claude Code.

One primary `Complete setup instructions` action copies an English payload containing all three
steps. Individual helper/config/skill copy controls remain available for manual setup. The guide
never copies a credential, provider configuration, Trench record, Keychain path, or `userData`
repository path.

The Main response includes the compiled skill version. Missing/invalid fields or a renderer/Main
version mismatch are explicit restart-required errors; the renderer must not show a permanent
loading placeholder or invent a fallback path. A non-production server such as
`bitterless-debug-dev` is visibly marked test-only, must keep its own name, and must not be
registered as `bitterless`. The portable skill's real-work dependency remains the production
`bitterless` server.

Ral performs the final installed-state test:

1. Start the target Bitterless profile and confirm the production helper remains registered as
   `bitterless`.
2. Start a fresh agent session, confirm `trench.*` appears in `tools/list`, and load
   `bitterless-trench`.
3. Ask the skill to store one fixture/test CA analysis and one explicitly explained Negative Wallet
   plus holdings snapshot.
4. Open standalone BL Trench and an Omni Trench cell; confirm both show identical documents.
5. Repeat the same analysis ID/content; confirm `changed: false` and no duplicate file/row. Submit a
   newer ID; confirm the same CA file and row update atomically.

Automated tests use temporary userData and synthetic data. They never read a real keychain or need a
live provider credential.

Repository confinement is verified against caller-controlled values, traversal, and pre-existing
symlink/reparse-point storage entries. Bitterless Main is the only supported writer. A hostile
process already executing as the same OS user and racing directory renames is outside the v1 threat
model; no path-only Node implementation is represented as a substitute for a native
handle-relative filesystem boundary.
