---
id: trench-record-store-mcp-010
scope: Per-CA JSON repository, derived Index Wallets, negative-wallet records, and production MCP tools
status: done
depends-on: []
---

# Trench Record Store And MCP

## Objective

Create the Main-owned `userData/trench` repository and add `trench.*` tools to the existing
production Bitterless MCP so external agents can durably write and reread analysis records without
direct filesystem access.

## Scope

- Add bounded shared v1 contracts for nested chain-specific CA analysis, typed wallet exposure,
  negative tags, holdings, paged summaries, exact documents, and errors.
- Implement one active address-keyed CA JSON, multi-chain content, atomic owner-only writes,
  serialized mutations, reread validation, list/get, archive, and content hashes.
- Derive Index Wallets from current `topProfitWallets`, preserving source CA/chain/rank/profit.
- Store negative `tag.json` and `holdings.json` separately inside one per-wallet directory; require a
  live tag before holdings put and archive that directory with one atomic rename.
- Add the public tools defined in `docs/features/trench-mcp.md` to `tools/list` and Main dispatch.
- Rename the now multi-domain helper wire identity from `bitterless-todo` to `bitterless` and bump
  its protocol version to `0.2.0` without changing the registered helper path/server key.
- Broadcast one sanitized `trench/data-changed` event after committed mutations.
- Do not write into `coin-state.json`, accept filesystem paths, or expose credentials.
- Treat Bitterless Main as the only supported repository writer. Reject traversal and pre-existing
  link/reparse entries, but do not claim confinement against a hostile same-OS-user process racing
  parent-directory replacement; that stronger boundary requires a separate dual-platform native
  implementation and release proof.

## Acceptance

- A valid CA put creates exactly one active JSON named by a hash of its canonical address.
- A BSC+Robinhood record remains one file; Solana case is preserved; invalid addresses fail.
- Exact `analysisId` retry is idempotent, different newer ID atomically replaces, stale put fails by
  default, and failed validation/write leaves the prior valid file intact.
- Index list includes at most the recorded top 100 per CA chain result and loses stale evidence after
  replacement/archive.
- Index detail omits flexible source evidence, points to source CA hashes, and byte-pages below 1 MiB
  even when up to 100 source summaries were requested.
- Negative tag explanation and holdings occupy distinct files in one wallet directory; holdings
  cannot be written for an unknown/archived tag and the pair cannot partially archive.
- Detail results come from persisted rereads and include the exact canonical document plus its byte
  hash; list results are cursor-paged and metadata-only.
- Traversal, deep/large/non-JSON values, incompatible addresses, duplicate chains/wallets/ranks,
  rank gaps, contradictory holding fields, invalid prospective exposure references, stale/future
  writes, ID/hash conflicts, and caller paths are rejected.

## Verification

- Temporary-userData repository tests including POSIX `0700`/`0600`, Windows inherited-userData ACL
  behavior without ACL widening, and failed atomic replacement.
- Real stdio-helper/local-RPC MCP contract test for tools/list and every put/list/get/archive family.
- Index paging test with several near-limit CA documents proves every MCP response remains below the
  repository's 1 MiB Index-detail cap and all source summaries remain reachable.
- Static boundary test that the stdio helper performs no direct Trench filesystem write.
- Focused Node typecheck and `git diff --check`.

## Implementation result

- Added closed, bounded v1 contracts and canonical validators for nested CA chain documents, typed
  exposure, Negative Wallet tags/holdings, cursor pages, issues, reference status, and exact JSON.
- Added the Main-owned `userData/trench` repository with canonical address hashes, `0700`/`0600`
  POSIX modes, fsync + atomic rename writes, serialized mutations, reread validation, byte hashes,
  CAS archive, whole-directory Negative archive, revisioned events, and bounded invalid-file issues.
- Index Wallet list is a metadata-only active projection. Index detail separately byte-pages bounded
  source summaries below 1 MiB and points to the full CA document hash instead of copying evidence.
- Added all twelve `trench.*` tools to the existing stdio helper and Main bridge. The helper remains
  a forwarding-only process and now advertises `bitterless` `0.2.0`; successful Main mutations emit
  one content-free `trench/data-changed` event.
- Repository focused tests pass `8/8`; the real production stdio-helper/local-RPC contract test
  covers tool discovery and every put/list/get/archive family. Existing Domain catalog/create and
  Todo Step MCP regression tests also pass. Strict MCP TypeScript, focused Node syntax/type
  compilation, focused ESLint error checks, and `git diff --check` pass.
- The broader Coin unit suite retains one pre-existing failure in
  `GMGN regular-wallet rank 1 is retained as independent`; the focused Trench suite is green and
  does not touch that normalizer behavior.
- Remediation after independent verification now walks every existing path component from
  `userData/trench`, rejects symlinks/non-directories and resolved-path escapes, and never applies a
  path-based chmod. POSIX directories and final/temporary files use `O_NOFOLLOW` plus `fstat`
  identity/containment checks and descriptor-based `fchmod`; Windows rejects the symlink/junction
  forms visible through `lstat` plus realpath deviations and relies on the per-user `userData` ACL.
- Analysis and Negative Wallet archives now reserve an exclusive `0700` container, retry bounded
  deterministic suffixes on fixed time/random collisions, and rename the active record once into
  that container. POSIX syncs the archive parent after reservation and both the source and actual
  destination parents after rename, so an existing archive is never a rename overwrite target.
- Opaque cursors now carry a cryptographically random repository-instance epoch and format version 2. A cursor from an earlier process is stale even if the new process reaches the same numeric
  revision. Trench Main dispatch also rejects scalar/array/null params without changing legacy Todo
  coercion, and the public Negative explanation schema now matches the 2,000-code-point validator.
- Remediated repository coverage passes `14/14`, including Trench-root/nested/final/temporary
  symlinks, fixed-name two-generation archives, failed Analysis CAS, restart cursor aliasing,
  same-instance concurrent ordering, Holdings stale/future writes, malformed Negative files, and
  100 Index sources with a near-2-MiB source document. The real stdio-helper/local-RPC test passes a
  high-escape response above 5 MiB and below the 8 MiB transport cap.
- Actual Windows NTFS inherited-ACL, junction/reparse-point, collision, and rename-durability proof
  remains pending on a Windows runner; a macOS test with `platform: 'win32'` would not prove those OS
  semantics and is intentionally not reported as verification.
- A second independent probe demonstrated the residual check-to-rename window inherent in public
  path-only Node filesystem APIs when another process already running as the same OS user races a
  parent-directory replacement. V1 now states that principal is outside its supported single-Main
  writer boundary instead of introducing an unverified native FFI layer or claiming path rechecks
  eliminate the race.
