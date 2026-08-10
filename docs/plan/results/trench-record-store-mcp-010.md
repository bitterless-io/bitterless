# Trench Record Store And MCP Verification — Remediation Round 2

Task: `trench-record-store-mcp-010`

Status: **PASS — frozen v1 scope verified; Windows runtime evidence remains pending**

Date: 2026-08-08

This was an independent Verify pass against the current `docs/features/coin.md`,
`docs/features/trench-mcp.md`, `docs/plan/analysis/trench-record-vault.md`, and task 010. No source,
test, configuration, or task document was changed. Only this verification report was replaced.

## Findings

- **Blocker:** none.
- **Important:** none.
- **Nit:** none material to delivery.
- **Platform evidence gap:** actual Windows NTFS inherited-ACL, junction/reparse-point, archive
  collision, rename durability, and crash behavior were not exercised on a Windows runner. The
  Windows branches were inspected, but this report does not represent static inspection or a
  non-Windows run as Windows proof.

## Frozen v1 security boundary

The four acceptance sources now state the same bounded contract:

| Source | Boundary stated | Result |
|---|---|---|
| `docs/features/coin.md` | One Bitterless Main writer; callers supply no paths; reject traversal, pre-existing links/reparse points, non-regular files, and resolved escapes | PASS |
| `docs/features/trench-mcp.md` | Main owns disk; automated tests use synthetic temporary data; same single-writer boundary | PASS |
| `docs/plan/analysis/trench-record-vault.md` | Native handle-relative confinement against a concurrently tampering same-user process is a separate dual-platform hardening task | PASS |
| `docs/plan/tasks/trench-record-store-mcp-010.md` | Task 010 implements the single-Main boundary and explicitly does not claim the stronger native boundary | PASS |

The implementation does not advertise confinement against another process already running as the
same OS user and concurrently changing repository parents. That stronger principal is outside the
frozen v1 contract and would require a separate native handle-relative implementation plus macOS
and Windows release evidence. Within the supported single-Main model, no caller-controlled path,
pre-existing link/non-regular entry, ordinary Main concurrency, or archive no-clobber gap was found.

## Remediation closure

| Prior item | Result | Independent evidence |
|---|---|---|
| B1 — storage-boundary links and non-regular entries | PASS in the supported v1 boundary | Maintained and temporary tests reject a linked root, nested Analysis/Negative/archive directories, active Analysis/tag/holdings links, temporary-file links, and a final-target change at the commit hook. Outside sentinels and POSIX modes remained unchanged. Source review confirms POSIX `O_NOFOLLOW`, opened-descriptor `fstat`, name/descriptor identity checks, realpath containment, and descriptor-based permission changes. |
| B2 — archive collision/no-clobber | PASS | With fixed clock and archive identifiers, two Analysis generations and two Negative Wallet generations produce distinct exclusive archive containers. Both Analysis documents remain distinct; each Negative archive contains its complete `tag.json` + `holdings.json` tree. Failed Analysis and Negative CAS attempts leave active bytes, revision, events, and archive/container state unchanged. |
| B3 — cursor revision alias after restart | PASS | Cursor v2 binds revision to a random repository-instance epoch. An old cursor is `CURSOR_STALE` in a new repository instance even at the same numeric revision; same-instance pagination remains valid. |
| I1 — archive parent durability | PASS on verified POSIX platform | Source and destination parents are both fsynced after cross-directory archive rename; exclusive archive-container creation is also parent-fsynced. Windows rename/crash durability remains part of the platform evidence gap above. |
| I2 — schema/runtime fail-closed behavior | PASS | Negative explanation schema and runtime both cap at 2,000 code points. All three list tools reject `null`, array, string, and number arguments through real stdio helper to local RPC/Main; omitted arguments and `{}` remain valid. Legacy Todo argument behavior passes its regressions. |
| I3 — maintained coverage | PASS | The maintained suite covers the mutation queue and queued-error recovery, malformed Negative tag/holdings, Holdings stale/future/replace, Analysis CAS, 100 Index source summaries with byte paging, link/non-regular boundaries, archive collisions, cursor epochs, and a real transport-shaped response above 5 MiB and below 8 MiB. |

## Requirement-by-requirement result

| Requirement | Result | Evidence |
|---|---|---|
| One canonical CA, one active file | PASS | EVM normalization and hash-derived identity converge on one active JSON file; repeat/newer writes do not create duplicate active files. |
| Nested BSC + Robinhood, with Solana support | PASS | Repository tests preserve sorted BSC and Robinhood chain blocks and exact Solana address case; incompatible identity mixes reject. |
| Canonical document and byte hash | PASS | Accepted records are canonicalized, atomically persisted, reread and revalidated; `contentHash` is SHA-256 of the canonical persisted bytes. |
| Idempotency, stale/future, replace, and CAS | PASS | Analysis, Negative tag, and holdings paths enforce idempotency, clock bounds, explicit replacement, and expected ID/hash guards without mutating state on failure. |
| Caller/path confinement and non-regular files | PASS for frozen v1 | Traversal and caller-supplied paths are rejected; pre-existing link/reparse and non-regular entries are rejected. The explicitly excluded same-user concurrent-directory adversary is not claimed. |
| Atomic write, crash/no-clobber, and whole Negative archive | PASS on verified POSIX platform | Exclusive temporary writes, file fsync, atomic rename, parent fsync, exclusive archive containers, both-parent fsync, and whole-directory Negative archive are present and tested. Windows runtime evidence is pending. |
| POSIX/Windows permissions | PARTIAL platform evidence | POSIX `0700` directories and `0600` files, including descriptor enforcement, pass. Windows stays on the current user's `userData` and does not intentionally broaden ACLs, but actual NTFS inherited-ACL behavior is not yet runner-verified. |
| Index prospective refs and derived projection | PASS | Prospective references validate before commit; Index rows are derived from active Analyses; replacement/archive removes retired provenance. |
| Index list/detail and byte paging | PASS | List is bounded metadata; detail returns bounded source summaries, up to 100, with byte-aware paging under the response cap. Flexible evidence stays in Analysis detail. |
| Negative tag/holdings separation | PASS | `tag.json` and `holdings.json` have independent validation/update paths; holdings require a live tag; archive moves the wallet tree together. |
| Query/revision cursor correctness | PASS | Cursors bind module, normalized query, revision, instance epoch, and item position; mismatches or intervening revisions fail stale. |
| Malformed stored records | PASS | Malformed Analysis, Negative tag, and holdings files surface bounded sanitized issues rather than raw paths/payloads or process failure. |
| Twelve schemas to stdio to real Main dispatch | PASS | Exact twelve `trench.*` schemas are advertised and every family executes through the production stdio helper, local RPC, and real Main dispatch/repository. |
| Server identity | PASS | Helper identity is `bitterless` `0.2.0`; the registered helper path/server key is unchanged. |
| Sanitized broadcast | PASS | One content-free `trench/data-changed` event is emitted per committed mutation; idempotent and failed writes emit none. |
| Helper does not write Trench disk | PASS | Helper imports schemas and forwards local RPC only; it has no filesystem import or repository/runtime dependency. |
| Mutation queue recovery | PASS | Same-instance writes serialize; a rejected queued mutation does not poison later queued work. |
| Local RPC 8 MiB boundary | PASS | The real helper/local-RPC contract case produces a response above 5 MiB and below the 8 MiB maximum using a near-maximum legal CA document. |
| Windows runtime verification | PARTIAL platform evidence | No Windows runner was available; no Windows-only ACL/reparse/rename/crash result is claimed. |

## Coverage audit

The repository suite contains 14 maintained tests. Inspection confirmed that the assertions, rather
than only the exit status, cover:

- canonical single-file storage, hash/reread behavior, nested chain data, and Solana case;
- idempotency, stale/future/replace/CAS behavior and preservation of active bytes on rejection;
- 100 Index source summaries, prospective refs, retirement, list/detail separation, and byte cap;
- malformed Analysis and malformed Negative tag/holdings handling;
- static link/non-regular path boundaries and unchanged outside sentinels/permissions;
- fixed-identifier two-generation Analysis and Negative archives with complete Negative trees;
- repository-instance cursor epoch plus normal same-instance pagination;
- 21 queued writes, one expected stale rejection, and subsequent queue recovery;
- 2,000-code-point explanation and holdings stale/future/replace behavior.

The real MCP contract test inspects all twelve schemas, exercises every tool family through spawned
stdio to the local RPC/Main repository, checks fail-closed list parameters, validates exact broadcast
count/sanitization, checks helper disk independence, and measures the large response boundary.

## Commands and results

Passed:

- `node --test <temporary esbuild bundle of tests/coin/unit/trenchRepository.service.test.ts>` —
  **14/14 passed**.
- `node scripts/mcp/trench-contract.test.mjs` — **passed**.
- `yarn typecheck:mcp` — **passed**.
- `yarn typecheck:node` — **passed**.
- `yarn test:mcp:domain-catalog` — **passed**.
- `yarn test:mcp:domain-create` — **passed**.
- `yarn test:mcp:todo-step-crud` — **passed**.
- `yarn test:mcp:agent-onboarding` — **passed**.
- `yarn test:mcp:todo-smoke` — **passed**.
- `yarn test:mcp:todo-skill-export` — **passed**.
- Focused ESLint over the Trench repository/shared schema, MCP bridge/helper, repository test, and
  real contract test — **passed with zero findings**.
- `git diff --check` — **passed**.

Independent temporary probes additionally passed the nested Negative/archive directory boundary,
active tag/holdings boundary, unchanged outside sentinel/mode, failed Negative CAS preservation,
archive no-clobber/tree preservation, and cursor-instance checks. Temporary artifacts were outside
the repository and removed after use.

Known unrelated failure, retained for attribution:

- `yarn test:mcp:multi-instance` reaches the socket ownership, stale recovery, endpoint replacement,
  not-ready, and DAO cases, then fails a pre-existing static assertion because unmodified
  `src/main/app.main.ts` contains `CORE_SQLITE_STARTUP_TIMEOUT_MS`. Neither that source file nor the
  multi-instance test is part of task 010's dirty changes. This failure is not attributed to the
  Trench implementation and is not concealed by the task result.

## Verdict

**PASS.** Task 010 satisfies the frozen v1 product and security contract, and the prior B1-B3/I1-I3
findings are closed. It may advance within the single-Bitterless-Main writer boundary. A real
Windows runner remains necessary before making Windows-specific ACL, reparse, rename-durability, or
crash-proof claims; that platform evidence gap is recorded but is not a task 010 code or contract
blocker.
