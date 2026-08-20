# OnlyPreview Dual Preview Region 024 — Independent Review

Status: **BLOCKED**

Date: 2026-08-20

## Verdict

Task 024 is not ready to close. The main topology is substantially present: Shell owns the fixed
toolbar, the Region owns the current presentation and mutually exclusive native content view,
HTML/PDF use disposable zero-preload sessions, Vue asset access is runtime-token-bound, and the
document/asset protocols apply canonical identity, bounded streaming, and revocation controls.

However, two lifecycle races can expose or restore stale content, `.mdx` was routed contrary to the
current product contract, retired renderer-authored revision channels remain exported, and the
design/task ledgers do not truthfully describe the implementation. All open P1/P2 findings below
are blocking under the docs-sprint gate.

## Findings

### P1 · blocking

1. **A stale asynchronous HTML document issuance can overwrite the current selection and leave a
   post-revocation token alive.**

   - Path: `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:171-216`
   - Evidence: the Region checks `isCurrent(runtime, revision)` at lines 175-178, then awaits
     `onlyPreviewDocumentRegistry.issue(...)` at line 182. It does not check the runtime/revision
     again before assigning `activePreviewSurface`, publishing the presentation, and mounting or
     queueing the raw view at lines 193-215.
   - Impact: selection A can pass the first fence and pause in `issue()` while selection B increments
     the revision and revokes all existing authority. A's token is minted only after that revocation;
     A then overwrites B's presentation and can mount stale executable HTML. Window/host teardown
     during the same await also leaves an unserved token in the registry until later eviction.
   - Coverage gap: `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs:246-248` implements
     `documentRegistry.issue` synchronously. The delayed race test covers proxy setup, not document
     issuance.
   - Required correction: after every awaited authority issuance, re-check exact runtime + revision;
     if stale, revoke that exact document revision before returning. Add a deferred `issue()` race
     regression proving the newer presentation remains current and the late token is revoked.

2. **The persistent Vue WebContents is reattached before it acknowledges reset, so the new Shell
   identity can temporarily expose the previous file's DOM/model/media.**

   - Paths: `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:266-275,329-345,548-559`;
     `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:130-159,230-246`
   - Evidence: `beginTransition()` detaches the view and publishes only a host-id nudge. For a Vue
     result, `attachActiveView()` immediately reattaches the same persistent view. `clearWorkspace()`
     does this synchronously in the same Main call. The Vue renderer can clear its old descriptor,
     model, DOM, selection state, and media only after receiving the IPC nudge, completing a new XPC
     snapshot request, and running `beginSelection()`; there is no reset acknowledgement between
     detach and reattach.
   - Impact: a slow, wedged, or merely not-yet-scheduled Vue renderer can render the old file below a
     toolbar that already identifies the new file or empty workspace. This violates the atomic
     teardown/reset-before-attach contract in design #7.2 and the task's requirement that every
     selection reset dispose current Vue work.
   - Coverage gap: Region tests model view membership but not the renderer's old DOM/model state, so
     `children.size === 1` cannot prove truthful content.
   - Required correction: keep the persistent Vue view detached until a capability-bound exact
     revision reset acknowledgement is accepted (distinct from final render-ready), or recreate the
     Vue view. Add a rapid Vue→Vue and `clearWorkspace()` regression that proves old content is never
     attached after the transition begins.

### P2 · blocking

3. **`.mdx` was changed from Monaco source to rendered Markdown, contradicting the frozen feature
   contract.**

   - Paths: `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:66-69`;
     `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue:184-188`;
     `tests/onlypreview/onlyPreviewCore.test.mjs:1808-1822`
   - Contract: `docs/features/onlypreview.md:554-578` says only `.md` uses the sanitized Markdown DOM;
     `.markdown` and `.mdx` remain Monaco source because interpreting JSX/import semantics is outside
     scope.
   - Impact: MDX is now parsed as ordinary Markdown, receives the 1 MiB Markdown ceiling instead of
     the 8 MiB source ceiling, and no longer shows its source semantics. The updated source test
     positively locks in the contract violation.
   - Required correction: route only `.md` to `markdown-dom`, keep `.mdx` on `monaco`, and restore the
     negative `.mdx` renderer assertion.

4. **Two retired renderer-authored character-count revision channels remain in the shared public
   contract after their publishers/subscribers were removed.**

   - Path: `src/shared/onlypreview/onlyPreview.types.ts:188-191`
   - Evidence: `ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT` and
     `ONLY_PREVIEW_CHARACTER_COUNT_SYNC_REQUEST_EVENT` have no remaining source/test consumer; the
     former Shell/Preview UUID transition protocol was replaced by the Main-owned presentation
     revision. Existing negative coverage removes only `PREVIEW_CONTROL`.
   - Impact: the shared contract still advertises exactly the obsolete cross-renderer revision path
     task 024 was meant to retire, inviting later code to revive a second revision authority.
   - Required correction: remove both unused event constants and add negative source-contract
     coverage beside the retired `PREVIEW_CONTROL` assertion.

5. **The two governing design documents still claim the implemented 024 topology is unimplemented.**

   - Paths: `docs/design/onlypreview-preview-merge-find.md:5-34,206-217,240-246,383-409,579-601,656-661`;
     `docs/design/onlypreview-format-coverage.md:23-35,183-194,278-289`
   - Evidence: preview goals G1/G2/G3/G5 and headings #7/#7.2/#7.5 still say the app has one Vue
     renderer or that the work is `未实施`; #7.3 also labels the whole local HTML boundary
     unimplemented even though 024 implements its offline/default-deny portion. The format document's
     G7 still says all formats use one Vue renderer, its engine section says Vue currently imports
     pdf.js, and its PDF gate calls `PdfPreview.vue` a current gap. The implementation-side path also
     says the Asset registry will own document scope, while the code introduced a separate Document
     registry.
   - Required correction: record 024's completed dual-view/toolbar/Main-owner/offline-HTML/PDF
     foundation as implemented; retain #7.4 Find as pending task 019, retain Office/guard/media work as
     pending tasks 020/021/022/023, and keep only the future remote-network policy in #7.3 pending.

6. **Task 024's `# Path` ledger omits files materially changed by the delivery.**

   - Path: `docs/plan/tasks/onlypreview-dual-preview-region-024.md:56-99`
   - Missing 024 paths include:
     `docs/design/onlypreview-preview-merge-find.md`,
     `docs/design/onlypreview-format-coverage.md`,
     `docs/INDEX.md` (OnlyPreview entries),
     `src/main/onlypreview/onlyPreviewClassifier.service.ts`,
     `src/main/onlypreview/onlyPreviewWorkspace.registry.ts`,
     `src/preload/onlypreview/onlyPreviewEnv.preload.ts`,
     `src/preload/onlypreview/onlypreview.preload.type.ts`, and
     `src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.vue`.
   - Impact: the delivery ledger cannot reproduce or review the actual contract surface, and it hides
     security-relevant runtime-token and filesystem-identity changes from the declared scope.
   - Required correction: make `# Path` enumerate the actual 024-owned files and remove/annotate any
     planned path that was not changed; do not absorb unrelated concurrent working-tree files.

### P3 · non-blocking code-review rule debt

The code-review `TS-1` rule (maximum 800 lines) remains violated by three changed, pre-existing test
containers: `tests/onlypreview/onlyPreviewCore.test.mjs:1-2156`,
`tests/onlypreview/onlyPreviewSearchShell.test.mjs:1-1410`, and
`tests/onlypreview/specs/onlyPreview.spec.ts:1-1897`. Task 024 edited existing sections rather than
creating these oversized files, so this is recorded as non-blocking debt. No `TS-2` function-style
finding was found in the reviewed 024 implementation set.

## Contract matrix

| Contract | Result | Independent evidence |
|---|---|---|
| Exactly one attached content view / first-bounds gate | PASS | Region creates no Vue view in `start()`, waits for bounds, detaches before add, and focused membership tests pass |
| Main-only revision and host-only presentation nudge | **BLOCKED** | Main is the sole writer and nudges are host-only, but the post-`issue()` fence is missing |
| Vue runtime capability | PASS | rotating runtime token is injected only into the app-owned Vue view and required for Vue snapshot/observations |
| HTML/PDF raw isolation | PASS | fresh memory partition, zero preload/arguments, sandbox/context isolation/web security/plugins, dead proxy, WebRTC policy, request/permission/popup/navigation/download fences |
| Document/asset identity, bounds, completion, revoke | PASS except stale issuance race | canonical entry directory + exact file/resource identities, per-file/total ceilings, EOF revalidation, active-stream destruction, per-session token scope |
| Session/view teardown and crash recovery | PASS | raw protocol/listeners/session data are torn down; Chrome/Vue crashes preserve Shell and publish unavailable state |
| Restore/watch/manual refresh convergence | PASS except Vue reset attach ordering | all route through Region transitions, but persistent Vue reset is not acknowledged before visibility |
| Shell toolbar identity/actions | PASS | public snapshot is URL-free; fallback `fileRef` keeps identity and native actions when descriptor/render fails |
| Historical Vue HTML/PDF/header/action paths | PASS | active imports/routes are removed and the raw Chrome surface owns HTML/PDF |
| Documentation/evidence truth | **BLOCKED** | design status and Path ledger contradict the actual 024 diff |

## Independent verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewPreviewRegion.test.mjs tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs` | PASS — 23/23 |
| `node --test tests/onlypreview/*.test.mjs` | PASS — 185/185 |
| `yarn typecheck:node` | PASS |
| strict node TypeScript with `--noCheck false` | NOT COMPLETED — default 4 GiB and bounded 8 GiB reruns both terminated with V8 heap OOM; no diagnostic was emitted before OOM |
| `yarn typecheck:web` | expected baseline failure — only existing non-OnlyPreview connector, Poker, Home/Omni/Maestro, and path-helper errors; no OnlyPreview diagnostic |
| `yarn check:renderer-i18n` | PASS |
| focused ESLint on the actual 024 TS/Vue/MJS file set | PASS |
| `yarn test:application-diagnostics` | PASS — 12/12 |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | PASS |
| `git diff --check` | PASS |

Electron/Playwright E2E, a real app launch, and packaged-app smoke testing were not run, per Ral's
instruction. This review changes only this review file and leaves implementation/task status
untouched.

## Conclusion

**BLOCKED.** Fix the two lifecycle races, restore the `.mdx` contract, remove the retired shared
channels, and make both design status and the task Path ledger truthful. Then rerun the focused
Region/document tests with the two missing race regressions plus the existing non-E2E verification
before requesting review 2.
