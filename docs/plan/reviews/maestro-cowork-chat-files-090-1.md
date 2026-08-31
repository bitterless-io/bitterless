# maestro-cowork-chat-files-090 — Review 1

- Date: 2026-08-31
- Scope: independent source review of Maestro attachment, directory, thumbnail, archive, local-link,
  activity-label, document-reading, and anydoc packaging migration against task 090 and Cowork
  `67b056b`.
- Method: task/source/diff inspection and bounded symbol/call-chain audit only. Per the delivery
  contract, no checks/scripts, tests, typecheck, lint, build, Electron, Playwright/E2E, application
  launch, staging, or network runtime probe was run.

## Findings

No unresolved P0-P2 findings.

The first inspection found two P1 blockers and three P2 defects: archive password support lacked a
traceable consumer contract; archive member traversal/link safety was not independently visible;
malformed URLs could expose raw query values in activity labels; the old file-reading check still
asserted legacy parser output; and `file:///C:/...` was mis-normalized on Windows. All five were
repaired before this approval and were re-reviewed independently.

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Anydoc uses the `rg`-style prebuilt CLI lifecycle | `package.json` pins `anydoc_version: 0.2.4`; `scripts/prepare-maestro-anydoc.cjs` verifies the npm tarball SHA-512 and five native SHA-256 values, stages exactly `cli.js`, `anydoc.js`, `index.js`, `package.json`, and one `anydoc.node`, and supports target verification. Every package chain stages and verifies it; `electron-builder.tmp.yml` copies `build/maestro-tools` and signs the macOS native binding. | pass |
| Runtime conversion is local and bounded | `anydoc.service.ts` resolves only the packaged Resources/dev staging path, spawns `process.execPath` with `ELECTRON_RUN_AS_NODE=1` and `NAPI_RS_NATIVE_LIBRARY_PATH`, continuously drains bounded stdout/stderr, enforces 30 seconds, handles exit codes 0-3, and contains no runtime download, WASM, or UtilityProcess path. | pass |
| Archive password transport is supported without argv exposure | `package.json` pins Ouch `0.8.2`; `archive.service.ts` links the fixed-tag upstream changelog documenting `OUCH_PASSWORD`, writes the password only into the child environment, removes it when absent, and never appends `-p` or the secret to argv/log output. | pass |
| Archive extraction is workspace-confined and auditable | `workspaceArchive.service.ts` extracts into a workspace-real-root staging directory, verifies the staging root identity, recursively uses `lstat`/`realpath`, rejects symlinks/junctions, hard links, and special entries, then renames the audited tree only into a new or existing empty destination. Failure cleanup runs after the Ouch child closes. Ouch `0.8.2` also contains its upstream traversal and link-escape fixes. | pass |
| Attachment and directory semantics stay complete | `isDirectory` is carried through renderer state, shared contracts, XPC/Main status and staging, persistence, prompt construction, and media exclusion. One fixed `AttachmentCard` renders pending inputs, sent files, and assistant artifacts with bounded thumbnails, explicit missing state, and horizontal rails. | pass |
| Local links and activity labels fail closed | `MessageItem.vue` preserves UNC paths and removes the WHATWG drive-prefix slash for `file:///C:/...`, while HTTP(S) remains a normal link. `BaseAgent.ts` replaces malformed/non-HTTP targets with safe placeholders, masks query values, and caps the final activity label at 180 characters. | pass |
| Static file-reading guard matches the new architecture | `scripts/maestro/check-file-reading.mjs` is now a source-only contract audit for the pinned five-file anydoc CLI, packaging/signing, process boundary, exit codes, archive boundary, and local links. It no longer loads Electron Main or generates files to assert obsolete `exceljs`/`unpdf` formatting. | pass |
| Exclusions remain absent | No anydoc application dependency, WASM worker, UtilityProcess, runtime download, Connector/Demo/CRMS fixed-tab/login behavior, captureDisk, or unrelated Cowork bootstrap was introduced by task 090. | pass |

## Verification

- Independent second-pass source and call-chain review: completed.
- Task-scoped `git diff --check`: clean.
- Source searches for runtime anydoc network/WASM/UtilityProcess and archive password argv: clean.
- Checks/scripts, tests, typecheck, lint, build, Electron, Playwright/E2E, application launch,
  staging, and network runtime probes: **not run**, as explicitly required. Ral owns runtime/E2E
  acceptance.

## Conclusion

**Approved — no P0-P2 findings.**

Task 090 now preserves Maestro's workspace/provider/UI boundaries while bringing over Cowork's
current attachment and file capabilities. Anydoc is a build-time-prepared, integrity-pinned CLI
bundle like `rg`; archive extraction has an independently inspectable workspace staging boundary;
and all first-pass blockers were closed before approval.
