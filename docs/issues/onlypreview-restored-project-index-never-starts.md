# OnlyPreview restored Project index is scheduled but never starts

Status: fixed in source; owner verification pending

## Symptom

Opening OnlyPreview restores the Project shell but leaves the directory empty and shows
`OnlyPreview could not complete this action.`. The debug console also reports that Vite's
`env.mjs` violates `default-src 'none'`.

## Runtime evidence

The 2026-09-03 10:40 debug run proves the CSP record is from the hidden `renderer:fileSearch`
page. Its renderer, preload, relay, search, office, authority, and preview-read boundaries all
became ready, while the visible Shell became interactive in 494ms. The same CSP record has appeared
in successful older runs.

The failing run emits `restore-index-grace phase=scheduled` but never emits `phase=start`, an
`initialize` XPC request, or a root listing. The generic Renderer toast has no operation-level
record, so the failure is currently indistinguishable from a Main API failure without reconstructing
the entire event sequence.

## Root cause

`OnlyPreviewDeferredIndexService` stores the browser-native `queueMicrotask` function as an object
member and invokes it as `this.scheduleMicrotask(...)`. Chromium therefore receives the service
instance as the native method receiver and may throw `TypeError: Illegal invocation`. The service
records `scheduled` before this call, the Shell catches the exception and generalizes it to
`OPERATION_FAILED`, and no deferred callback reaches the hidden runtime.

The reported `env.mjs` CSP record is a separate development conflict: Vite injects its HMR client
into the intentionally scriptless `fileSearch/index.html`, whose privileged-page policy correctly
remains `default-src 'none'`. The global Monaco plugin also injects an inline bootstrap in serve and
build, so the hidden page was not truly scriptless in either output mode.

## Repair contract

- Bind deferred scheduling through an arrow wrapper so the fixed browser scheduler is invoked with
  its valid global receiver.
- Emit a fixed-schema failure phase when scheduling or the deferred action fails; never log a path,
  workspace identity, filename, token, query, payload, or raw error.
- Keep the `fileSearch` page scriptless in development by stripping Vite-injected page scripts;
  do not weaken its CSP.
- Add regressions that exercise the real default-scheduler receiver behavior and prove the
  privileged development HTML retains an empty body and no scripts.

Delivery: [onlypreview-deferred-index-runtime-118](../plan/tasks/onlypreview-deferred-index-runtime-118.md).

## Delivered repair

- The default microtask scheduler is now called through a global receiver-safe wrapper.
- `schedule-failure` and `action-failure` identify failures after `scheduled` without recording
  paths, workspace identities, queries, payloads, or raw errors.
- The hidden `fileSearch` and `trench-io` pages remove injected page scripts in serve and build;
  the restrictive CSP is unchanged and built output is audited only during builds.
- Focused scheduler, diagnostics, privileged-HTML, and search-window tests pass. Node type checking
  and the release-preview build pass. The repository-wide Web type check remains blocked by its
  existing unrelated Poker GTO, Home, Connector, Maestro, Omni, and path-helper failures.

Ral owns the final DEBUG runtime acceptance; Electron/Playwright/E2E was not run.
