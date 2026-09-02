# maestro-external-tools-094 — Review 1

- Date: 2026-09-01
- Scope: independent source review of the external-tool store, initialization integrity, offline
  package staging, Electron Builder boundaries, and focused regression coverage against
  `docs/plan/tasks/maestro-external-tools-094.md`.
- Method: task-scoped diff and source inspection plus fixture-only Node checks. No network,
  initializer, desktop build/package, Electron/E2E, signing, notarization, or publication was used.

## Findings

The first pass found two P2 gaps:

1. Generic `build:unpack` had become unsupported on Linux because it unconditionally selected the
   three-platform external-tools path.
2. Fixtures covered only macOS ARM and did not lock the complete release inventory or initializer
   replacement/idempotence behavior.

Both findings were fixed before approval. A host dispatcher now sends macOS/Windows unpack to the
offline external-tools stage and retains Linux arm64/x64 on the legacy AnyDoc/Ouch flow. The suite
now locks every URL/archive/inner/output/archive digest/payload digest, exercises all three targets,
and verifies successful replacement, failure rollback/cleanup, and non-force reuse.

No unresolved P0-P2 findings remain.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Git boundary | Root ignore rules retain only `.gitignore` plus the three `.gitkeep` files; fixture checks prove payloads, nested contents, and rogue root entries are ignored. | pass |
| Pinned initialization | The inventory fixes five versions and every archive/extracted digest; AnyDoc additionally fixes its npm SHA-512, JS bundle hashes, native hashes, name, and version. | pass |
| Atomic/idempotent store | Each platform is built in temporary directories, validated before replacement, restores the old directory on install failure, cleans temporary/backup state, and reuses a valid non-force store without entering download functions. | pass |
| Offline package stage | Stage reads only the selected local store, validates exact real-file tree/manifest/size/hash, preserves the target Micromeet CLI, removes other-target artifacts, and verifies the result. | pass |
| Cross-platform routing | `mac_arm`, `mac_intel`, and `win64 -> win` all pass fixtures; the generic dispatcher preserves Linux arm64/x64 behavior and rejects unsupported hosts. | pass |
| ASAR/resource/signing | Builder excludes `external_tools/**` and `prebuilt/**`, copies only `build/maestro-tools` to `Resources/maestro-tools`, and lists all six macOS executable/native paths. | pass |

## Verification

- `yarn test:maestro-external-tools`: passed, 10/10.
- `yarn test:desktop-package-audit`: passed, 25/25.
- `node scripts/maestro/check-file-reading.mjs`: passed.
- `node --check scripts/maestro/externalTools.cjs`: passed.
- `node --check scripts/prepare-maestro-package-tools.cjs`: passed.
- `git diff --check`: passed.

## Conclusion

**Approved — no unresolved P0-P2 findings.**

Owner initialization and a real packaged-app audit remain intentionally pending.
