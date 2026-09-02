# desktop-youtube-dl-removal-003 — Review 1

- Date: 2026-09-01
- Scope: independent review of the unused `youtube-dl-exec` dependency, helper, package-audit
  bookkeeping, lockfile pruning, and preservation of unrelated external-tools/release work against
  `docs/plan/tasks/desktop-youtube-dl-removal-003.md`.
- Method: task/design/source inspection, task-scoped diff, an independent Yarn v1 lock-graph
  reachability check, residual-consumer search, focused package-audit tests, and diff validation.
  No install lifecycle, network request, external-tool initialization, build/package,
  Electron/E2E, signing, notarization, or publication was used.

## Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

## Reviewed files

| File | Review result |
|---|---|
| `package.json` | The direct dev dependency is removed. Existing `0.0.81 / 260901100557` Preview release fields, external-tool version pins, commands, and packaging order remain present. |
| `yarn.lock` | The 217 removed lines represent 33 records reachable only through `youtube-dl-exec`; the two added lines contract shared `cross-spawn` and `semver` selector groups without deleting their still-reachable records. |
| `scripts/ytdl.js` | The only project consumer is deleted with the dependency. |
| `scripts/package/desktopPackage.audit.cjs` | Only the obsolete banned-package entry is removed; nearby package-audit behavior and external-tools work remain intact. |
| `scripts/package/desktopPackageAudit.test.mjs` | Only the obsolete dev-dependency expectation is removed; current external-tools ASAR/resource/signing assertions remain intact and pass. |
| `docs/issues/youtube-dl-exec-postinstall-rate-limit.md` | The observed failure, required removal boundary, and acceptance criteria match the implementation. |
| `docs/plan/tasks/desktop-youtube-dl-removal-003.md` | The task path, mutation restrictions, and verification contract are complete and consistent with the diff. |
| `docs/INDEX.md`, `docs/plan/README.md` | The issue and task are indexed without altering unrelated delivery records. |

## Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Remove the failing dependency | `package.json` and current `yarn.lock` contain no `youtube-dl-exec` record. The removed package was a direct dev dependency, so its postinstall can no longer run during a clean project install. | pass |
| Remove the sole executable consumer | A repository-wide non-doc search found no `youtube-dl-exec`, `youtube-dl`, `yt-dlp`, or `ytdl` consumer, and `scripts/ytdl.js` is absent. | pass |
| Prune only unreachable lock records | Parsing the HEAD lock graph produced 1,450 reachable records before removal and 1,417 after deleting the root dependency. The exact 33-record difference matches every fully deleted lock stanza. The current graph has 1,417 reachable records and zero unresolved selectors. | pass |
| Preserve shared dependency records | `cross-spawn@^7.0.3` and `semver@^7.6.0` were removed only from combined selector headers; the shared records remain for their other selectors. | pass |
| Preserve external-tools changes | Package pins/commands/stage ordering, Builder audit assertions for `external_tools/**`, `prebuilt/**`, `Resources/maestro-tools`, and the macOS signing inventory remain present. The focused audit suite passed. | pass |
| Preserve release changes | `_version`, `version`, `version_code`, and channel name remain `0.0.81`, `0.0.81`, `260901100557`, and `Bitterless_PREVIEW`, matching the post-task-008 operator state documented in its review. | pass |
| Keep audit bookkeeping coherent | The package is absent from both `BANNED_PACKAGES` and the expected dev-dependency list; no audit rule now requires or classifies a removed package. | pass |
| Code-review rules | No task-added TS/JS implementation remains that violates TS-1 or TS-2; FE/BE rules are not applicable to this dependency-removal diff. | pass |

## Verification

- `yarn test:desktop-package-audit`: passed, 25/25.
- Independent Yarn v1 lock-graph reachability check: passed; exactly 33 orphan-only records removed,
  1,417 current reachable records, zero unresolved selectors.
- Non-doc repository search for `youtube-dl-exec`, `youtube-dl`, `yt-dlp`, and `ytdl`: no match.
- `git diff --check` on every task-owned implementation/doc path: passed.
- Install lifecycle, network, external-tools initialization, build/package, Electron/E2E, signing,
  notarization, and publication: intentionally not run.

## Conclusion

**Pass — no P1, P2, or P3 findings.**

The removal is complete and scoped: the rate-limited postinstall package and its only consumer are
gone, all deleted lock records are proven orphan-only, shared lock records remain resolvable, and
the existing external-tools and Preview release work is preserved.
