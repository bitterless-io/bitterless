# BL Trench Record Vault Delivery Analysis

Status: accepted; implementation pending

## Goal decomposition

Delivery is complete only when all of these statements are true at the same time:

1. Trench has no user-visible or preload-exposed analysis capability.
2. CA Records, Index Wallets, and Negative Wallets each have a complete list/detail flow.
3. One canonical CA maps to one active JSON file, including a possible BSC+Robinhood multi-chain
   result inside that file.
4. The positive dictionary is derived from at most the top 100 profit wallets in every active CA
   chain result, and is readable before a later CA analysis.
5. A human-explained negative wallet and its separately analyzed holdings are durable and readable.
6. External agents write only through the production `bitterless` MCP; Bitterless Main owns disk.
7. The portable `bitterless-trench` skill drives put-reread workflows without credentials or trade
   execution.
8. Standalone and truly embedded Omni Trench render the same live repository.
9. Automated contract/Electron checks pass, followed by Ral's installed MCP/skill/manual-view test.

## Module decomposition

| Module | Inputs | Outputs | Owner | Task |
|---|---|---|---|---|
| Shared contracts | MCP/renderer unknown JSON | bounded validated v1 records | shared | 010 |
| Trench repository | validated identities and records | owner-only atomic files, list/get/index | Main | 010 |
| MCP surface | `trench.*` calls | validated repository operations | helper + Main bridge | 010 |
| Read-only XPC | list/get + data-changed | renderer-safe snapshots | Main | 011 |
| Record vault UI | XPC snapshots + host context | three module list/detail views | renderer | 011 |
| Omni runtime | `miniAppId: trench` | embedded local operation view | Omni Main/control | 012 |
| Portable skill | human request + research evidence + MCP | verified persisted records | skill package | 013 |
| Integration acceptance | synthetic MCP writes | disk/UI/Omni proof | tests + owner | 013 |

## Data graph

```text
CA JSON (one active file per canonical CA)
└─ chains[]
   ├─ chain-specific token/result{}
   ├─ topProfitWallets[0..100]
   ├─ indexWalletExposure[]
   └─ negativeWalletExposure[]
           │
           └─ deterministic fold ──> Index Wallet dictionary
                                      └─ source CA/rank/profit provenance

Negative Wallet directory
├─ tag.json (human explanation)
└─ holdings.json (separate current analysis)
```

CA analysis is the positive dictionary's only source of truth. Negative tags never become positive
index entries merely because the same address appears in a top-profit list; the UI may show the
conflict, but neither source silently deletes the other.

## Lifecycle closure

| Entity | Entry condition | Busy/error | Update/conflict | Terminal condition |
|---|---|---|---|---|
| CA analysis | valid MCP envelope | atomic put or explicit rejection | exact ID retry is idempotent; stale timestamp denied | explicit CAS archive; bytes retained |
| Index wallet | at least one active CA references it | derivation failure identifies invalid source | recomputed after every CA mutation | no active source reference |
| Negative tag | explicit human address + explanation | no partial tag | put corrects explanation/timestamps | whole-directory CAS archive |
| Negative holdings | existing live negative tag | source failure remains outside vault or in result JSON | newer snapshot replaces same wallet file | archived with tag |
| Renderer selection | list contains item | prior valid snapshot remains marked refreshing | preserve identity after broadcast | fallback to first row/empty state |

The UI is intentionally read-only; its missing mutation controls are not a CRUD gap because MCP is
the authorized create/update/archive surface. The derived Index dictionary has no independent
create/update/delete operation by design.

## Integration enumeration

| Chain | Required proof |
|---|---|
| MCP tools/list → stdio helper | all `trench.*` JSON Schemas are visible on the existing server |
| stdio helper → local RPC | helper forwards values and never imports Electron/file storage |
| local RPC → repository | Main validates, serializes mutation, atomically writes, rereads |
| CA put → address file | exactly one active JSON and stable hash; no caller-controlled path |
| CA put → Index list/get | bounded summaries retain CA/chain/rank/hash provenance; full evidence stays in CA get |
| CA replace/archive → Index list | stale provenance disappears deterministically |
| exposure reference lifecycle | put validates prospective dictionaries; later disappearance is computed, not a CA rewrite |
| negative put → holdings put | tag/holdings remain separate documents in one atomically archivable directory |
| repository mutation → XPC broadcast | every live standalone/Omni Trench refreshes without reopen |
| XPC list/get → renderer | discriminated result; paged metadata excludes large results; detail returns exact document |
| standalone launch → Trench preload | no Coin data/AI/clipboard/X analysis API is loaded |
| Omni selection → operation view | local Trench renderer/preload loads in-cell, no standalone window opens |
| Omni navigation fence | privileged view cannot navigate to remote content or create an in-cell popup |
| skill → research skills | read-only evidence or explicit unavailable state; no trading/signing |
| skill → MCP put → get | caller verifies persisted identity, chains, analysis ID, and content hash |
| DEBUG E2E MCP write → UI | synthetic record appears in both hosts and exact JSON is previewed |

## Rejected architectures

### Keep the current analysis UI but add a history tab

Rejected. It leaves analysis capability in Trench and treats the requested product boundary as a
cosmetic navigation change.

### Let the agent write `userData` directly

Rejected. It bypasses the running application's validation, environment routing, atomicity,
permissions, broadcast, and ownership boundary.

### Store new records inside `coin-state.json`

Rejected. That file has one global size cap, embeds all analyses, may prune history, and cannot
satisfy one CA/one JSON.

### Persist a separately editable Index Wallet file

Rejected. It can drift from the CA evidence that created it. The dictionary is a deterministic
projection of active CA JSON.

### Split the same EVM address into BSC and Robinhood files

Rejected. The explicit storage requirement is one CA/one JSON. Independent `chains[]` blocks
represent true multi-chain results inside one address record.

### Open the standalone Trench window from an Omni button

Rejected. Omni support means the renderer is an operation `WebContentsView` inside a layout cell.

### Reuse the legacy Coin preload for convenience

Rejected. It would continue exposing analysis, AI, resource, clipboard, and X-browser operations to
the supposedly read-only product.

### Add an unverified native filesystem adapter inside task 010

Rejected for v1. Public Node/Electron filesystem APIs expose path-based rename only, while a true
defense against a same-OS-user process racing parent-directory replacement needs Darwin
descriptor-relative syscalls and Windows handle-relative rename/reparse controls. Introducing an
FFI/native boundary without Windows NTFS tests, package audit, code-signing proof, and recovery
tests would create a stronger claim than the release can verify. V1 instead defines Bitterless Main
as the only supported writer and still rejects traversal and pre-existing link/reparse entries. If
the threat model later includes a hostile process already running as the user, that work becomes a
separate native-storage-hardening task with both platform runners.

## Migration

- Old `coin-state.json` remains untouched and readable by historical code.
- A bounded idempotent migrator may copy each valid legacy analysis into the new envelope once.
- Migration records carry `source.kind: legacy-coin-state`; invalid/ambiguous entries are reported and
  skipped individually rather than poisoning the new repository.
- Legacy analysis components/services may remain in source temporarily, but neither standalone nor
  Omni Trench imports their preload or mounts their UI.
- Tasks 008 and 009 are superseded, not silently reinterpreted as current behavior.

## Delivery order

```text
trench-record-store-mcp-010
              |
              v
trench-record-browser-011
              |
              v
trench-omni-embedding-012
              |
              v
trench-agent-skill-integration-013
```

The shared dirty worktree requires serial Develop turns. Each task receives an independent Verify
pass before the next task; verification may report but not rewrite the implementation under review.

## Completion evidence

| Requirement | Authoritative evidence |
|---|---|
| no Trench analysis | runtime preload keys, rendered selector absence, source import graph, Electron test |
| one CA one JSON | temporary-userData repository test plus filesystem enumeration |
| three modules | screenshots and component/Electron assertions |
| positive dictionary | deterministic replace/archive unit tests |
| negative tags/holdings | MCP contract and separate-file tests |
| MCP-owned write | real local RPC fixture through stdio helper to Main repository |
| portable skill | package/export/version/dependency tests and installed tree diff |
| Omni embedded | BaseWindow child-view identity, no standalone BrowserWindow, responsive screenshots |
| live consistency | one MCP write observed by already-open standalone and Omni instances |
| owner acceptance | Ral's fresh-session MCP/skill and visual checklist result |
