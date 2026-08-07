---
id: onlypreview-mvp-001-1
status: pass
reviewed_task: onlypreview-mvp-001
target: 18631c175b59b144b9d5aad8101a94a57878d589
base: 1fb6b99
date: 2026-08-07
review_type: independent-source-contract-runtime-package
---

# Verdict

**PASS. No open P1, P2, or P3 finding remains.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Review Scope

The review independently inspected the accepted feature/task/analysis documents, the complete
`1fb6b99..18631c1` change, the Main capability and file boundaries, standalone and Omni window
lifecycles, all three renderers, settings persistence, Home/Omni/auth/logging integration, generated
build output, Windows installer source, and the current unsigned macOS arm64 unpack.

The first audit of `c7d8d77` found that the explicit OS association catalog omitted the supported
`css` and `env` extensions. That contract mismatch was fixed before this verdict in `18631c1`, and
the focused integration test now compares the full text/PDF/image/audio/video classifier catalogs
against every explicit association. The review target has 69 supported and 69 associated
extensions, with no missing or extra entry (`electron-builder.tmp.yml:60`;
`tests/onlypreview/onlyPreviewCore.test.mjs:971`).

# Contract Assessment

- Main issues bounded, unguessable, role-scoped host capabilities. Workspace authority is bound to
  the exact live host and exposes only opaque workspace IDs plus normalized relative paths
  (`src/main/onlypreview/onlyPreviewHost.registry.ts:11`, `:27`, `:45`, `:70`;
  `src/main/onlypreview/onlyPreviewWorkspace.registry.ts:81`, `:156`).
- File access rejects absolute/traversal input and escaping symlinks, opens through a read-only
  handle with `O_NOFOLLOW` where supported, verifies a regular file, then rechecks canonical
  containment and device/inode identity before reads or streams consume that handle
  (`src/main/onlypreview/onlyPreviewWorkspace.registry.ts:177`, `:226`, `:228`, `:240`, `:250`).
  The XPC surface contains no renderer-callable absolute-path or teardown method and converts every
  fallible operation to the discriminated result envelope
  (`src/main/xpc/onlyPreview.handler.ts:28`, `:51`;
  `src/shared/onlypreview/onlyPreview.types.ts:129`).
- The index is metadata-only, naturally sorted, symlink-leaf-only, hidden/excluded-directory aware,
  capped at 20,000 entries and depth 32, and reports partial state. Text reads are complete-or-error
  at 8 MiB with explicit binary/encoding errors
  (`src/main/onlypreview/onlyPreviewIndex.service.ts:21`, `:68`, `:101`;
  `src/main/onlypreview/onlyPreviewClassifier.service.ts:264`, `:303`).
- Asset URLs contain only a canonical 64-hex bearer token and encoded display filename. Tokens are
  bounded, expire, remain host/workspace-owned, and destroy active streams on revocation. The
  privileged scheme is registered before ready and serves manual full, HEAD, and single-range
  responses from the already verified file handle
  (`src/main/onlypreview/onlyPreviewAsset.registry.ts:14`, `:69`, `:147`, `:166`, `:258`;
  `src/main/onlypreview/onlyPreviewProtocol.service.ts:8`, `:25`).
- Standalone uses one `BaseWindow` with separate sandboxed Shell and Preview views, exact local
  navigation fences, clamped native preview bounds, explicit child detachment/closure, 800x600
  minimums, and persisted top-level state. Settings uses an independently sandboxed singleton
  `BrowserWindow` and settings-only host
  (`src/main/windows/onlyPreviewWindow.helper.ts:25`, `:81`, `:98`, `:167`, `:209`, `:277`, `:330`,
  `:381`).
- Each Omni cell receives a distinct content host. Replace, close, renderer failure, and Omni
  teardown revoke that exact host before disposing its views; top-level navigation and redirects
  remain fenced. The serial Electron run proved two distinct live tokens and revocation after both
  close and renderer-crash paths (`src/main/windows/omniWindow.helper.ts:275`, `:792`, `:1008`,
  `:1058`; `tests/onlypreview/specs/onlyPreview.spec.ts:1281`).
- Monaco is configured `readOnly` plus `domReadOnly` and disposes both editor and model. PDF uses
  PDF.js canvas rendering with print intent, disabled annotations, and a selectable `TextLayer`.
  User HTML remains source, SVG remains an image resource, and media receives only tokenized bytes
  (`src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue:24`,
  `:39`; `src/renderer/onlypreview/preview/src/components/PdfPreview/PdfPreview.vue:27`, `:54`,
  `:88`, `:99`).
- Shell implements the accepted searchable tree, roving focus/arrow/Home/End/Space semantics,
  native window shortcuts, stale-request generations, resizable project column, Index Rail, and
  distinct empty/index-failure/partial states. Fresh normal and 800x600 captures were visually
  inspected with no clipped controls, overlap, or preview escape over Shell-owned regions
  (`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:67`, `:188`, `:327`, `:399`, `:511`;
  `src/renderer/onlypreview/shell/src/App.vue:1`, `:314`, `:365`).
- Settings defaults and bounds match the contract. Reads share one bounded storage retry, stale
  hydration cannot overwrite a save, a valid save performs one upsert and broadcasts the committed
  snapshot, and Cancel/Escape close without writing
  (`src/main/onlypreview/onlyPreviewSettings.service.ts:13`, `:19`, `:42`, `:54`, `:61`, `:90`;
  `src/renderer/onlypreview/settings/src/onlyPreviewSettings.store.ts:54`, `:79`;
  `src/renderer/onlypreview/settings/src/App.vue:154`).
- Home exposes one guarded `onlypreview` card; auth invalidation and host quit destroy all remaining
  windows, views, hosts, workspaces, assets, and protocol state. The logging and renderer-i18n
  allowlists contain all three entries.
- The generated macOS bundle contains exactly two document declarations: 69 explicit extensions
  (including `css` and `env`) plus `public.data` with `Viewer`/`Alternate`. The Windows template
  writes only `Software\\Classes\\*\\shell\\OnlyPreview` and uninstall deletes that exact key
  (`electron-builder.tmp.yml:60`, `:156`; `build/installer.tmp.nsh:10`, `:15`).

# Verification

- `node --test tests/onlypreview/*.test.mjs` — pass, 28/28.
- `yarn test:e2e:onlypreview` — pass, 4/4 with one worker. It covered two native views and exact
  800x600 geometry, shortcuts, immutable/selectable Monaco, selectable non-empty PDF, image pixels,
  seekable audio/video, persisted/cancelled settings, two isolated Omni cells, and close/crash
  capability revocation.
- `yarn build` — pass. `out/preload/onlypreview.js` is self-contained except for Electron; Shell,
  Preview, and Settings HTML exist, place CSP first, authorize the exact Monaco bootstrap hash, and
  resolve built worker paths.
- `yarn typecheck:node` — pass.
- `yarn check:renderer-i18n` — pass.
- Focused error-level ESLint over `src/main/onlypreview`, `src/preload/onlypreview`,
  `src/renderer/onlypreview`, `src/shared/onlypreview`, `tests/onlypreview`, and the new
  window/handler/Home emitter — pass.
- `yarn test:motto` — pass, 18/18; `yarn test:omni-layout` — pass, 9/9;
  `yarn test:application-diagnostics` — pass, 10/10; `yarn test:customer-auth` — pass, 20/20.
- `node scripts/package/desktopPackage.audit.cjs --app dist/mac-arm64/Bitterless.app` — pass:
  193.74 MiB ASAR, 504.34 MiB application, arm64 application/native SQLite match, and ICNS valid.
  Direct `Info.plist` inspection confirmed 2 document types, 69 explicit extensions including
  `css`/`env`, and `public.data` as `Viewer`/`Alternate`.
- `git diff --check 1fb6b99..18631c1` — pass. The target worktree was clean before this requested
  review artifact was created.

Known unrelated baselines were reproduced rather than relabeled:

- `yarn typecheck:web` exits 2, but every reported diagnostic is in a source file unchanged from
  `1fb6b99`; no OnlyPreview file reports an error.
- The all-touched error-level ESLint command reaches 16 existing errors: 15 historical empty catches
  in `src/main/app.main.ts` and the historical unused `maestroIcon` import in
  `miniApps.constant.ts`. Git blame and base comparison place all 16 before this task; the new
  OnlyPreview lines pass.
- `yarn test:desktop-package-audit` remains 17/19 because its expected external package list omits
  existing `electron-log`, and its publish-order assertion no longer matches `scripts/publish.js`.
  Both failing test/source locations are unchanged from `1fb6b99`. The real current macOS unpack
  audit passes as recorded above.

# Remaining Owner Handoff

Installed-shell behavior cannot be proven by source or an unsigned unpack. Before production
delivery, Ral should install signed macOS and Windows builds and verify: Finder offers Bitterless as
an alternate (not default) viewer for a listed file and an unknown file; Windows shows `Open in
Bitterless` for an arbitrary file and removes only that verb on uninstall; representative audio and
video files play/seek on both packaged Chromium runtimes.

# Conclusion

Target `18631c1` satisfies the accepted OnlyPreview MVP contract and is ready for merge. The signed
macOS/Windows association and codec checks above remain the explicit post-merge owner acceptance,
not an implementation blocker.
