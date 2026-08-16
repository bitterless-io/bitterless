# Trench non-overwriting person import and portable skill result

## Outcome

Bitterless now exposes exactly 13 public `trench.*` tools. The new
`trench.person.import` accepts only structured normalized chunks with an explicit chain and
`walletKind: "user"`; it accepts no source path or raw file text. Main validates and forwards the
request without SQL. The hidden `trench-io` runtime stages exact chunks in encrypted SQLite and
publishes the complete import in one transaction only after all ordered hashes and counts match.

The bundled `bitterless-trench` skill now includes a deterministic Node converter and a documented
production-only import workflow. The full directory was copied additively to the overmind
`.agents/skills` and `.claude/skills` mirrors and to `~/.codex/skills`. Skill version and application
version code are `260813155645`.

Implementation status: **implemented; independent Verify pending**. Task 025 remains `in-progress`.
No live import, Electron E2E, DEBUG_PROD operation, or production Trench write was performed.

## Implementation

- Added immutable Trench migration `260813155645` (`person-import-ledger`) after the unchanged
  `260813155644` person-registry identity. It adds persistent request/content fingerprints,
  aggregate completion counts, revision, and request uniqueness to the import ledger while
  preserving the exact four-entry ordered manifest.
- Extended wallet and chain-account provenance with `import`. Imported values are lower priority
  than GMGN and remain improvable by later provider/manual evidence; import itself never overwrites
  an existing wallet, classification, membership, person, profile, note, or metadata field.
- Implemented hidden staging/finalization with exact chunk JSON SHA-256, canonical whole-content
  SHA-256, ascending contiguous chunks, at most 250 rows per call, stable import/request/source
  conflicts, exact duplicate collapse, conflicting duplicate rejection, and value-free aggregate
  receipts. A failed finalize rolls back every live wallet/person effect. Replaying exact completed
  content returns the stored receipt with `replayed: true` and does not advance revision.
- New addresses create one wallet, explicit user chain account, person, and membership. An existing
  unowned wallet keeps all bytes, gains only its missing explicit chain account and one membership.
  An already linked wallet keeps its person/profile and may gain only a missing explicit account.
  Equal names on different addresses always remain different people.
- Routed the hidden runtime through the typed Main client and one Main import service. Main emits a
  single content-free `trench/person-changed` event only for a newly completed finalize. MCP and
  visible Main/renderer code contain no SQLite import or SQL.
- Added `trench.person.import` as the exact 13th schema/dispatch/stdio tool, with strict UUIDv4,
  explicit chain/user kind, hashes, bounded rows, exact fields, and no path property. Updated the
  current-instance guide, localized tool-count text, skill version, and package version code.
- Added `scripts/convert-person-import.mjs` to the portable skill. It accepts strict UTF-8 JSON arrays
  of exact string `{address, rename, emoji}` rows, NFC/trim normalizes them, canonicalizes only for
  the caller-selected chain, rejects invalid/conflicting input, collapses exact duplicates, sorts by
  canonical address, emits 250-row tool-call files, and prints aggregate manifest data only. Stable
  UUIDv4-shaped IDs derive from chain plus source/content hashes, so identical conversion is replayable.
- Added focused schema/import/converter/skill references and retained the prior CA Analysis and
  Negative Wallet workflows. The skill dependency remains only the production MCP named
  `bitterless`; DEBUG aliases remain forbidden for real work.

## Supplied fixture audit

`/Users/ral/Downloads/message.txt` was used only as a read-only converter forward fixture. The
converter reported 3,120 unique BSC-shaped EVM rows, 13 chunks, 3,120 nonempty names, and zero
nonempty emoji fields. Tests asserted aggregate output contains no full EVM address. Generated
temporary chunks were deleted by test cleanup and were never sent to MCP or imported into any DB.
The source's real chain remains an explicit owner decision; BSC in this check is only the task's
syntactic fixture parameter, not a production authorization.

## Verification

- PASS — native SQLCipher repository/migration suite: `21/21`, including ordered staging, missing
  and conflicting chunks, exact replay, same-name separation, conflicting-duplicate rollback,
  new/unowned/already-linked paths, byte preservation, aggregate counts, and revision behavior.
- PASS — complete Coin unit suite: `171/171`, including strict person-import validation.
- PASS — converter CLI suite: `4/4`, including deterministic hashes/IDs/order, NFC, exact duplicate
  collapse, conflicting duplicate/field/type/UTF-8/length/chain/address rejection, canonical
  exactly-32-byte Solana Base58 validation, nonempty-output refusal, supplied aggregate, and stdout
  row secrecy.
- PASS — exact 13-tool MCP schema/bridge/stdio contract, including structured dispatch, 250-row cap,
  exact 16-Unicode-code-point `displayEmoji` boundary, explicit user kind, no path argument,
  aggregate receipt, and content-free person event.
- PASS — portable skill source/ZIP byte test; all seven files (including converter and import
  reference) are exported, credential scans pass, and production `bitterless` remains the only MCP
  dependency.
- PASS — static Trench boundary/layout suite: `18/18`, including exact 13-tool order and no Main
  SQLite ownership.
- PASS — focused `trench-io`, MCP strict, renderer, Node, and SQLite-migration typechecks.
- PASS — SQLite migration audit across fresh/upgrade/fail-closed baselines.
- PASS — additive three-tree `diff -qr`; Node `js-yaml` parsing of every synchronized SKILL/openai
  file; OpenAI metadata length, `$bitterless-trench` prompt, and production MCP dependency checks.
  The skill-creator Python wrapper could not run because that environment lacks PyYAML; equivalent
  strict YAML validation passed with the repository's installed JS YAML parser.
- PASS — fresh isolated DEBUG_DEV build at version code `260813155645`.
- PASS — `git diff --check` and bounded task-source secret scan.
- BASELINE BLOCKED — full repository `yarn typecheck:web` still reports unrelated pre-existing
  connector, poker-test, Home, Maestro, OnlyPreview, and shared typing errors. The focused Trench
  renderer/hidden-runtime/MCP configs and build pass.
- NOT RUN — Electron/browser E2E or screenshot automation, per task and Ral's instruction.

Develop did not write a review. Fresh independent Verify must write
`docs/plan/reviews/trench-person-import-skill-025-1.md` before task status can become `done`. Ral's
later production import must select the source chain explicitly and run through production
`bitterless` only.

## Review-fix pass 2

The three blocking review findings are addressed without changing the import workflow. The
portable converter performs dependency-free Base58 decode, exactly-32-byte validation, and
canonical re-encoding before it emits a Solana row. The canonical person feature and delivery
analysis enumerate the immutable 018/019/023/025 migration identities and preserve fail-closed
predecessor/order/identity checks. The public MCP JSON Schema now matches the parser and converter
at exactly 16 Unicode code points for `displayEmoji`; the contract probe accepts 16 astral emoji
and rejects 17.

Focused converter and MCP boundary regressions were added for both findings. The task remains
`in-progress` until a fresh independent Verify pass; no review file, live import, DEBUG_PROD
operation, or Electron E2E was performed by Develop.

Review-fix verification passed the `4/4` converter, skill export, MCP contract, `171/171` Coin
unit, `21/21` native SQLCipher, `18/18` static boundary, MCP strict, hidden-runtime, renderer, Node
no-check and SQLite-migration type gates; all eight migration baselines; four-tree YAML and byte
parity; secret/static line-bound checks; and `git diff --check`. The broader
`tsconfig.trench-node.json` remains blocked by four concurrent baseline errors in Codex credential,
Coin normalization, and Coin resource files outside task 025; the exact MCP/shared/import paths
compile under the passing strict MCP and hidden-runtime configs.
