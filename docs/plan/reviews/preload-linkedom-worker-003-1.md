---
id: preload-linkedom-worker-003-1
status: pass
reviewed_task: preload-linkedom-worker-003
date: 2026-07-22
review_type: independent-read-only
---

# Findings

| Priority | Blocking | Location | Finding |
| --- | --- | --- | --- |
| P1 | blocking | N/A | None. |
| P2 | blocking | N/A | None. |
| P3 | non-blocking | N/A | None. |

# Conclusion

**pass.** The four preload imports are complete, preserve the existing `parseHTML` call semantics,
remain inside the preload bundle, and the current generated SQLite preload has no optional native
canvas resolution or error stub. The reviewed diff introduces no P1, P2, or P3 risk.

# Evidence

- The only four LinkeDOM imports under `src/preload/` now use `linkedom/worker`:
  `src/preload/agent/defaultSkills/searchWeb.skill.ts:2`,
  `src/preload/agent/search.adaptor.ts:2`,
  `src/preload/base/langGraph/defaultSkills/searchWeb.skill.ts:3`, and
  `src/preload/base/searchHelper/search.helper.ts:2`. No root `linkedom` import remains there.
- All eight existing calls still use `parseHTML(html)` and destructure the returned `document` in
  the same places. LinkeDOM 0.18.12 exports the worker subpath, and its worker and normal ESM
  entries define `parseHTML` identically through `DOMParser.parseFromString(..., 'text/html')`.
  A read-only representative DOM plus Mozilla Readability probe produced identical results from
  both entry points.
- `electron.vite.config.ts:44` includes `linkedom` in `bundledRuntimeDependencies`, and the preload
  applies that list through `externalizeDeps.exclude` at `electron.vite.config.ts:137`. Electron
  Vite 5.0.0 removes excluded package names before constructing both root-package and subpath
  external matchers, so `linkedom/worker` is bundled. The explicit preload externals at
  `electron.vite.config.ts:153` do not include LinkeDOM.
- `out/preload/sqlite.js` is newer than the four changed source files and contains an inline
  `parseHTML` implementation plus the worker entry's local no-op Canvas implementation. It has no
  `require("canvas")`, `__require("canvas")`, `canvas.cjs`, `canvas-shim.cjs`, optional-peer marker,
  `Cannot find module ... canvas`, or `Could not resolve ... canvas` signature. All 13 case-insensitive
  `canvas` tokens belong to DOM tag/class handling, the local no-op implementation, or Readability
  constants. `canvas` is absent from `package.json`, `yarn.lock`, and `node_modules/`.
- The tracked diff changes only the four import specifiers and the task index entry. The untracked
  task document was also read for scope consistency. No behavior beyond the LinkeDOM entry point is
  changed, and `git diff --check` passes.

# Read-only Checks

- Inspected `git status --short`, `git diff --stat`, `git diff --name-status`, the complete tracked
  patch, and `docs/plan/tasks/preload-linkedom-worker-003.md`.
- Enumerated every preload LinkeDOM import and every affected `parseHTML` call with `rg`.
- Inspected LinkeDOM 0.18.12 package exports, normal/worker `parseHTML` definitions, worker Canvas
  implementation, and optional canvas peer bridge.
- Ran an in-memory Node comparison of normal versus worker DOM parsing and Readability output.
- Inspected Electron Vite 5.0.0's installed externalization implementation and the repository's
  preload Rollup configuration.
- Scanned `out/preload/sqlite.js` for every canvas occurrence and known resolution/error-stub
  signature, then inspected its bundled parser and Canvas markers.
- Ran `git diff --check`.

# Verification Boundary

No build, typecheck, Electron startup, or runtime database action was run because this review was
restricted to checks that do not rewrite files or application state. The existing generated
artifact was inspected in place. This review adds only this review file and does not modify source,
the task document, or any other documentation.
