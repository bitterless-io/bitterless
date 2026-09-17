---
id: skills-p0-completeness-003
scope: Complete standard skill packages and available runtime usage
status: done
depends-on: [skills-pi-reload-cache-002]
verify: passed
---

# Complete the two approved P0 skill improvements

Ral, 2026-09-17: “先做 P0 然后更新文档”. The approved scope is chapter 3 P0-1/P0-2 in the cross-project Agent Runtime skill assessment. P1 work is excluded. Work in the existing checkout and preserve unrelated edits.

## P0-1 — Complete standard package import/export

- Standard SKILL.md directory import/export preserves the legal complete resource tree, including nested scripts, references, assets, sidecars and binary files. A standard skill does not require recipe.json.
- Reuse existing destination, source, institution authorization, audit and recording-recipe behavior. Document any existing metadata normalization separately from resource preservation.
- Share consistent package path validation between import and export. Reject unsafe link/path escapes and unsupported filesystem entries explicitly; never silently truncate a package. Preserve valid in-package resources.
- Publish a new destination only after successful copying/validation; name collisions must not overwrite an existing package. A failed operation must not damage a previous package or leave a discoverable partial install.
- Import → read/execute a representative nested resource → export → re-import must preserve resource bytes and usable relative paths. Verify directory conflict, rejected unsafe paths, and failure cleanup. Keep ordinary read/turn caching and explicit/New Chat refresh behavior.

## P0-2 applicability

Bitterless currently uses Pi native file/process tools. Verify its authoring/scope baseline remains intact; do not add an artificial AI-CRMS adapter. Cowork owns the backend-specific change.

## Verification and handoff

Run focused behavioral tests and relevant TypeScript checks, then the appropriate build without launching Electron. Do not start an independent code review or Electron E2E. Record exact results and any unrelated failures. Update this task, the project feature/index links, and the cross-project HTML matrix and P0 status after implementation. Human acceptance: use the existing Skills directory import/export UI with a nested standard package; Cowork also creates and runs the same example via both Pi and AI-CRMS, with selected workspace and without one, and no institution.

## Implementation and verification — 2026-09-17

- `skillPackage.ts` is the shared-behavior filesystem helper used by registry import/export: complete directory inventory, portable path validation, in-root link materialization, binary copying, executable file modes, hidden sibling staging, collision-safe destination selection, synchronous final rename, and cleanup on failure. Source escape/broken/cyclic links, unsupported entries and portable path collisions fail explicitly. The helper preserves the caller's lexical scope root when a parent path is itself a platform alias.
- Standard imports and exports now retain nested scripts, references, assets, hidden files, sidecars and empty directories. The existing host metadata normalization remains separate: import normalizes `SKILL.md` and fills missing portable docs/sidecar; export sanitizes its existing Markdown document set; both regenerate their audit/operation manifests. Recording recipe redaction and portable document regeneration are retained. See the [feature contract](../../features/skills-three-sources.md).
- Existing targets are preserved; an occupied import/export name receives a new suffix. Metadata and native skill validation occur in staging. Failed copy, normalization or publication removes staging and does not invalidate the previous catalog or damage an earlier package.
- P0-2: Bitterless's existing native authoring baseline remains unchanged: selected workspace first, Global fallback without institution, bundled Bun instructions, New Chat initialization and explicit-refresh boundaries. No new adapter or generation subsystem was added.

Exact completed verification:

| Command | Result |
|---|---|
| `node --test tests/skillsThreeSources/packageRoundtrip.test.mjs` | 11/11 passed; real registry import → execute nested script → export → re-import preserves resource bytes, empty directories and executable mode. Also covers collisions, safe internal links, escape/broken/cyclic links, unsafe names, FIFO rejection, copy/publish fault injection, metadata failure cleanup, hidden-stage invisibility and source/scope boundaries. |
| `node --test --test-name-pattern='export rejects an escaping resource' tests/skillsThreeSources/packageRoundtrip.test.mjs` | 1/1 additional export-boundary regression passed after adding it: a resource link introduced after catalog loading is rejected without modifying the prior export. |
| `node --test tests/skillScopes/*.test.mjs tests/skillsThreeSources/catalog.test.mjs tests/skillsThreeSources/cloud.test.mjs tests/skillsThreeSources/requestParity.test.mjs tests/skillsThreeSources/nativeReload.test.mjs` | 64/64 passed; includes recording authorization/training, no-institution operation, source isolation, complete catalogs, cached turns, native/New Chat reload and unchanged workspace/Global/Bun authoring guidance. |
| `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false` | Passed (5.36 s). |
| `yarn build` | Passed (57.06 s); actual `out/.bitterless-runtime-profile.json` is `debug_dev` / release channel `dev` / Vite mode `debug`. Log: `/tmp/bl-p0-build.log`. |
| `git diff --check -- src/main/maestro/skills/skillRegistry.service.ts src/main/maestro/skills/skillPackage.ts tests/skillsThreeSources/packageRoundtrip.test.mjs docs/features/skills-three-sources.md docs/plan/tasks/skills-p0-completeness-003.md docs/INDEX.md docs/plan/README.md` | Passed. |

The script fixture ran locally with Node and returned `{"ok":true,"assetHex":"0001027f80feff"}` from its relative JSON/binary resources at all three locations. No Electron app, E2E suite, live model or independent review was run. Owner acceptance of the existing directory import/export UI remains pending; the root task owns the cross-project assessment update and human handoff. No ZIP/GitHub/npm installer, dependency manager, cloud publishing or P1 behavior was added.
