# Global Search Office preview analysis

## Decision

Reuse `OnlyPreviewOfficeSession` only at the renderer-session boundary. Give Global Search its own
hidden-preload Office reader and bounded relay protocol; do not reuse the main Preview broker,
current-file store, Find adapter, or read lane.

## Why the lane must be independent

The current main Preview Office broker is bound to one Preview runtime token, one current selection,
and a single prepared/active hidden reader. Search is a separate `WebContentsView` with its own
selection lifecycle. Sharing that reader would let a Search click cancel the document already open
in the main Preview (and vice versa), while sharing `OfficePreview.vue` would register the wrong
current-file readiness/find state.

## Module flow

```text
Search result token
   │ preview metadata (no path/bytes)
   ▼
hidden file-search preload ── one-shot Search Office grant
   │ async fs read, stable identity, ≤25MiB, ≤512KiB frames
   ▼
Main Search relay ─────────── validate/fence/relay one bounded frame
   │ no fs, no complete-package buffer
   ▼
Global Search renderer ───── assemble current revision only
   │
   ▼
OfficeSearchPreview.vue ──── lazy `OnlyPreviewOfficeSession`
                               ├─ xlsx/xlsm viewer
                               ├─ docx viewer
                               └─ pptx viewer
```

The `office` preview variant carries the adapter, filename/source extension, size/modified time,
and an opaque read grant tied to the current workspace generation, request, result token, and
preview revision. It contains neither an absolute path nor file bytes.

## Selection state machine

```text
idle
 │ select                    immediate selected row + pending state
 ▼
scheduled ── leading ───────> loading ────────────────> ready
   ▲                            │  select                 │ select
   │ select within 120ms        └──── dispose/cancel ─────┘
   └── keep only last trailing candidate

query/scope/workspace/close ──> cancel timer + read + session ──> idle
late success/error at any phase ── revision mismatch ──> discard
```

The leading dispatch prevents a single click from feeling delayed. The 120ms minimum dispatch
spacing bounds churn during rapid navigation, while the trailing candidate guarantees the final
selection is rendered. Selection itself is never throttled.

## Resource and security invariants

- One live Search Office reader/session, one full `ArrayBuffer`, one OOXML Worker, and one Viewer.
- A new selection unmounts the keyed component before the next dispatch and calls the read-lane
  cancellation path even when the old async operation has not settled.
- Every async boundary checks the captured preview revision; stale errors are as inert as stale
  successes.
- The hidden preload owns all potentially large disk I/O. Main handles only strict, ordered,
  bounded frames and capability metadata.
- The Search renderer enables only the Worker/WASM CSP required by the pinned OOXML runtime; it
  remains a trusted local renderer with navigation/window-open fences.
- Existing lazy text/Markdown/static-HTML/directory/info components remain out of the initial
  Office bundle, and each Office format remains a dynamic import.

## Verification map

- Contract/parser: exact `office` variant and exact open/read/cancel request identities.
- Reader/relay: separate lane, stable-file checks, max package size, 512KiB ordered frames,
  cancellation and grant reuse rejection.
- Scheduler: immediate first dispatch, one trailing last dispatch, no intermediate dispatch,
  timer cancellation, stale success/error rejection.
- Renderer: keyed Office component, format-to-session mapping, unmount disposal, no main Preview
  store/find coupling, loading/error/current-file naming.
- Build/security: Search CSP Worker/WASM exception is narrow and all new lazy modules are emitted.
- Run Node/source tests, typecheck/lint/format, and build only. Electron/Playwright/E2E remains Ral's
  live acceptance step.
