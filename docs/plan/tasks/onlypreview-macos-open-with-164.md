---
id: onlypreview-macos-open-with-164
scope: macOS Open With registration and workspace-safe OS file opens; BL/Cowork parity
status: done
depends-on: []
verify: Native association, startup queue, default-app guard and existing navigation unit tests
---

2026-09-14 update: [External file tabs and current-preview identity](../../issues/onlypreview-external-file-tab-and-current-preview.md) supersedes the OS/file-tab routing below: OS regular files open a new main-window file tab, and all file tabs stay outside OnlyPreview Recents. MCP remains in OnlyPreview. Its footer and current-file Recents background follow the live preview, independently from tree/keyboard selection.


# macOS Open With

Both signed app bundles declare ordinary files as Viewer/Alternate, not Owner/Default. Keep
public.data fallback and explicit supported document families, including Office and Draw.io.
Do not register folders or application bundles as preview documents. Edit builder templates and
verify final Info.plist through packaging hooks; do not patch installed/signed applications.

Register open-file before ready. Queue cold-start requests, then drain serially through the existing
OnlyPreview opener after its host is available. Reuse the current tab/standalone host; preserve the
active Project/tree selection, and record opens in that Project's Recents without indexing external
files. Cowork gains the missing entry point; no new file-content I/O in Main.

Before Open in default app, resolve the handler for the full file URL. If it is this app, do not
reopen it: display a localized explanation directing the user to Finder > Open With > Other.
Do not modify default associations. Keep authorization checks current across the async lookup.

Verify source/manifest contracts, queue readiness/order/failure recovery, host reuse, external
selection/Recents behavior and native default-app guard with stubs. No Electron/E2E, package build,
release/install, independent review or Git sync. Cowork task mini-030 is the matching port.

## Delivery — 2026-09-08

- Updated builder templates with Viewer/Alternate document families and Office/Draw.io extensions;
  kept existing bundle identities and user defaults. The afterPack hook now reads and validates
  the final macOS Info.plist without modifying it.
- BL's existing OS queue now preserves tree selection. Cowork registers open-file before ready,
  coalesces window startup, drains after Main/config readiness (before network skill updates finish),
  and reuses a live tab or detached host. Cold Cowork opens use its normal OnlyPreview tab.
- Queue deduplication now includes in-flight files and releases failed requests for a later retry.
- Project/external Open actions share a native default-app guard. It uses the full escaped file URL,
  compares the resolved application bundle path with the current executable's bundle, shows
  localized Finder guidance for self-open, and rechecks authority before invoking the OS.
  No target contents are read in Main. Existing configuration persistence is unchanged.

Verification: BL MacOpenWith/RecentNavigation/HeaderFileMenu 36/36; Cowork equivalent plus
AgentTarget/NativeLabels 52/52. Includes native metadata-fixture validation without an app launch,
cold/warm queue order/deduplication/failure, detached-host reuse, stale authority, default-self and
missing-handler cases. Targeted strict semantic checks of the guard against each installed
Electron/Node API pass; these use explicit locale/contract type seams, not an app-wide typecheck.
Cowork native labels match all 60 BL source labels. Scoped diff checks pass. Scoped lint finds no
errors except 18 existing no-empty catches in BL app.main.ts cleanup (outside the modified queue);
Cowork uses BL's lint config because it has no own config. No full build/typecheck/E2E or release.

Owner acceptance requires newly packaged and installed apps: Finder Open With for PDF, Markdown,
Office, Draw.io, media and unknown-extension text; cold and already-running apps; tab and detached
OnlyPreview; keep Project/tree selection and Project-scoped Recents. External files must not create
an index/root. Select this app as a test file's default viewer and verify the native guidance instead
of self-reopening; restore the previous default afterward. Packaging/installation was not performed.

Reference: [Electron 40.4.1 macOS URL-handler resolution](https://github.com/electron/electron/blob/v40.4.1/shell/browser/browser_mac.mm)
passes the complete URL to Launch Services, not just its scheme.
