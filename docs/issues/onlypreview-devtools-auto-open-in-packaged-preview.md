# Packaged Preview opens OnlyPreview DevTools by itself

Status: implemented; owner verification pending

## Observed behavior

Ral 2026-09-04: 「onlypreview devtool 只在 debug 的时候打开，通过构建的包就不要打开了」. The packaged
Preview build opened a detached DevTools window for the OnlyPreview shell view on startup.

## Root cause

`onlyPreviewWindow.helper.ts` has two predicates with different jobs:

```ts
const shouldAutoOpenOnlyPreviewDevTools = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' && process.env.BITTERLESS_E2E !== '1';

const isOnlyPreviewDevToolsEnabled = (): boolean =>
  import.meta.env.VITE_MODE === 'debug' ||
  import.meta.env.VITE_RELEASE_CHANNEL === 'preview' ||          // ← packaged Preview
  (process.env.BITTERLESS_E2E === '1' && !app.isPackaged);
```

The second exists to bind the DevTools **keyboard shortcut** on the Preview channel, and its own
comment said "Auto-open stays debug-only either way". But the shell view's auto-open was gated on
`isOnlyPreviewDevToolsEnabled()`, not on `shouldAutoOpenOnlyPreviewDevTools()` — so on the packaged
Preview build the condition was true and DevTools opened unasked. The Vue preview view directly
below it used the correct predicate, which is why only the shell pane did this.

This reverses an earlier owner decision recorded in
`tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` ("The owner asked for the OnlyPreview
window's own DevTools on the Preview channel too").

## Fix

The shell auto-open now uses `shouldAutoOpenOnlyPreviewDevTools()`. Auto-open is debug-only on every
channel; a packaged build never opens DevTools by itself.

The **shortcut** stays bound on Preview — it opens nothing until Ral presses it, and Preview is the
owner-facing channel where reaching for DevTools by hand is the point. Say so if that should go too.

## Acceptance

| Scenario | Expectation |
|---|---|
| Packaged Preview startup | No DevTools window |
| Packaged Stable startup | No DevTools window (unchanged) |
| `yarn dev` / debug profile | Shell and preview DevTools auto-open detached (unchanged) |
| Isolated E2E (`BITTERLESS_E2E=1`) | No auto-open (unchanged) |
| DevTools shortcut on packaged Preview | Still opens and closes on demand |

Regression: `onlyPreviewSourceIntegration.test.mjs` asserts both auto-opens are gated on the
debug-only predicate and that `isOnlyPreviewDevToolsEnabled()` no longer appears in the standalone
startup path at all.

Implementation task:
[onlypreview-devtools-debug-only-auto-open-124](../plan/tasks/onlypreview-devtools-debug-only-auto-open-124.md).
