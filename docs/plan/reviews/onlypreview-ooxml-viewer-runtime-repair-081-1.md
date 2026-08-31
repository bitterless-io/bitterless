---
id: onlypreview-ooxml-viewer-runtime-repair-081-1
target: working-tree-2026-08-31
compared_with: onlypreview-ooxml-viewer-runtime-repair-081
---

# Verdict

**PASS. No blocking P1 or P2 finding.** The current implementation satisfies the Task 081 source
and bounded-test contract for XLSX/XLSM, DOCX, and PPTX. Two P3 follow-ups remain; neither permits
parallel Office generations, unbounded file admission, Main-process Office filesystem access, or a
stale selection to publish ready state.

# Findings

## P1 — blocking

None.

## P2 — blocking

None.

## P3 — non-blocking: timed-out `electron-xpc` calls have no upstream cancellation lifecycle

Locations:

- `src/main/fileSearch/fileSearchWindow.service.ts:291-343`
- `node_modules/electron-xpc/dist/main/index.mjs:144-155,194-241`

`FileSearchWindowService` gives Office control calls a ten-second deadline and chunk calls a
five-second deadline, then destroys the hidden renderer on timeout. That bounds the application
failure path, but the timeout races an `electron-xpc` promise that the library keeps in
`pendingTasks` until a renderer sends `__xpc_finish__`. If that renderer is hung or destroyed, the
library exposes no cancellation/removal API; its capability-named registry entry is likewise not
unregistered when a hidden renderer is replaced. Repeated forced timeouts/restarts can therefore
retain small task and registry records in Main.

This does not block Task 081 because successful reads remove their tasks, the hidden renderer owns
and closes the file handle, every replacement gets new unguessable capabilities, and the Office
reader admits only one generation. Repair belongs in an `electron-xpc` lifecycle API (cancel task
and unregister renderer handler) rather than another local timeout race.

## P3 — non-blocking: admitted Office files still have bounded transient memory amplification

Locations:

- `src/preload/onlypreview/onlypreviewContent.preload.ts:41-85`
- `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts:499-619`
- `node_modules/@silurus/ooxml/dist/xlsx-BibrHQ52.js:4330`
- `node_modules/@silurus/ooxml/README.md:596-601,1020-1024`

The hidden reader transports at most 512 KiB per serial XPC frame, but the Vue preload eventually
assembles the full admitted file and `contextBridge` copies that result into the page. The XLSX
engine additionally slices its input for the main-mode parser bridge. A 25 MiB workbook can thus
briefly occupy multiple input-sized buffers before the parser model, inflated XML, decoded raster,
and canvas allocations are counted.

The risk is bounded and isolated: input is capped at 25 MiB; archive admission is capped at 5,000
entries, 64 MiB per entry, 128 MiB total inflation, and 200:1 compression; raster decode is capped
at 32 megapixels / 128 MiB with concurrency two; frames are pulled serially; preflight transfers
ownership; only one Office generation is live; and the disposable Preview renderer has a
30-second Main watchdog. This is sufficient for this repair, but peak-memory telemetry or a future
stream-aware viewer boundary would be the appropriate follow-up if live large-workbook testing
shows pressure on low-memory devices.

# Requirements evidence

| Requirement                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Result |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| No Office filesystem I/O in Main           | `OnlyPreviewHandler.selectStandaloneFile` branches on the Office suffix before `resolveFile`; `OnlyPreviewPreviewRegionService.present` branches before `openFile`, classifier `describe`, document issuance, or asset issuance. Production target inspection and workspace binding go through the hidden file-search preload. Main brokers only in-memory identity and bounded structured-clone frames. Existing non-Office filesystem adapters are outside Task 081 and recorded separately.                                  | pass   |
| Direct OS open before search indexing      | `OnlyPreviewRecentDirectoryService.createWorkspaceForTarget` awaits hidden `inspectTarget`, registers only the validated target, and awaits hidden `bindOfficeWorkspace` before returning the workspace. It does not depend on index completion.                                                                                                                                                                                                                                                                                | pass   |
| Path/capability secrecy                    | The visible Preview remains `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Its page receives only `readCurrentOfficeBytes({ selectionRevision })`; the per-Vue broker capability remains preload-only, while the hidden-reader capability is a separate random argument. Public presentations contain no Office `assetUrl`, path, root, grant, or capability.                                                                                                                                             | pass   |
| Exact authority and stale-revision fencing | Host token, per-view runtime token, per-view broker capability, selection revision, one-shot grant, and hidden workspace generation are checked at their respective boundaries. Transition/ready/error paths revoke authority; public cancel fences pending prepare and open work; the next prepare awaits the cancellation fence.                                                                                                                                                                                              | pass   |
| Symlink, replacement, and TOCTOU handling  | Hidden `inspectTarget` and `bindWorkspace` compare final path identity; `prepare` and `open` use `O_NOFOLLOW`, containment, regular-file checks, and post-open path/handle identity comparisons; EOF revalidates both handle and current path. Same-path inode replacement and in-flight-open cancellation are covered by focused tests.                                                                                                                                                                                        | pass   |
| Bounded serial transport                   | The protocol hard-caps files at 25 MiB and frames at 512 KiB. The hidden reader requires the exact next offset, returns exact runtime/revision/grant identity, validates EOF identity, and closes on EOF/error/cancel. The Vue preload pulls serially, validates runtime, revision, grant, offset, frame size, EOF type, exact EOF position, and final length.                                                                                                                                                                  | pass   |
| XLSX/XLSM, DOCX, and PPTX viewer path      | Extension routing maps XLSX/XLSM to `ooxml-xlsx`, DOCX to `ooxml-docx`, and PPTX to `ooxml-pptx`. The session lazy-imports the three pinned `@silurus/ooxml@0.83.0` subpaths and constructs each Viewer once with `mode: 'main'`. In this library mode, WASM parsing remains in its parser Worker while layout and 2D canvas painting stay inside the disposable Vue Preview renderer—not Electron Main.                                                                                                                        | pass   |
| Find and highlight preservation            | All three Viewers receive the configured match/active colors and use `findText`, `findNext`, `findPrev`, and `clearFind`; every ready report declares complete Office coverage. Generation fencing prevents a stale Find completion from clearing replacement highlights. DOCX/PPTX retain text selection.                                                                                                                                                                                                                      | pass   |
| Resource and freeze safeguards             | The existing 25 MiB size ceiling, ZIP structure/CRC validation, entry/inflation/ratio limits, XLSX merge limits, ten-second preflight timeout, package raster limits, 25-second Viewer-worker timeout, ten-second Find timeout, single live generation, deterministic teardown, and 30-second outer renderer watchdog remain active.                                                                                                                                                                                            | pass   |
| Errors, diagnostics, and teardown          | Read, preflight, import, construction, load, layout, render, and Find are distinct phases. A session logs at most one bounded diagnostic containing opaque runtime ID, revision, elapsed time, kind, phase, and sanitized error tokens. Viewer `onError(error)` is forwarded for all formats; typed package/resource failures are preserved; other failures use render/runtime wording. Dispose terminates preflight, destroys Viewer/parser Worker state, clears Find, empties the container, and suppresses late ready/error. | pass   |

# Verification

| Check                                                                                                                                           | Result                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Eight focused Node suites: Office reader/session/preflight, Preview Region/guards, rendering adapters, recent-directory startup, and app wiring | PASS, 107/107                                                                                                                |
| Task-owned targeted ESLint (`--no-cache`)                                                                                                       | PASS                                                                                                                         |
| Task-owned Prettier check                                                                                                                       | PASS                                                                                                                         |
| `yarn typecheck:node`                                                                                                                           | PASS                                                                                                                         |
| `git diff --check`                                                                                                                              | PASS                                                                                                                         |
| Existing production output inspection                                                                                                           | PASS; lazy Office chunks plus XLSX/DOCX/PPTX parser WASM and Office preflight worker are present under `out/renderer/assets` |
| `yarn typecheck:web`                                                                                                                            | Baseline-blocked by unrelated existing Poker/Home/Connector/shared-path errors; no Task 081 file appears in the diagnostics  |
| `yarn build`                                                                                                                                    | Not repeated in this independent review; the implementer reported PASS and the produced Office assets were inspected         |
| Electron / Playwright / packaged smoke / E2E                                                                                                    | Not run — explicitly reserved for Ral                                                                                        |

# Conclusion

**Approved — PASS with two non-blocking P3 follow-ups.** The modern Office formats now use the
intended single-pass OOXML path, retain complete Find/highlight behavior, and read through a
capability-bound hidden preload without an Office filesystem call in Main. Cancellation,
replacement, size, archive, and renderer-lifecycle risks are bounded well enough that no current
path can grow work by file size without the documented limits.

The original `bitmaprenderer` explanation remains source-backed inference rather than captured
Electron evidence. Ral still owns the final live acceptance: open representative XLSX, XLSM, DOCX,
and PPTX files, verify first render and Find highlights, then try a near-limit workbook while
watching renderer memory and responsiveness.
