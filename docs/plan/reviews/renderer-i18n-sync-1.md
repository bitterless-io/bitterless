# Review: renderer-i18n-sync (round 1)

## Findings

### P2 · blocking — concurrent Home changes can acknowledge the newer choice and then commit the older one

- **Design contract:** Home requests the authoritative change from main, main owns the current value,
  and a successful Home change updates all live renderers (`docs/features/renderer-i18n.md:7-9,52-55,72-78`).
  The analysis also identifies failed or misleading persistence as a controlled risk
  (`docs/plan/analysis/renderer-i18n-sync.md:24-29,33-40`).
- **Code:** `ApplicationLanguageCoordinator.setLanguage()` snapshots `current`, returns immediately
  when the requested value equals that snapshot, and performs an awaited persistence write without
  serializing mutations (`src/shared/i18n/applicationLanguage.ts:119-133`). The real General setting
  allows another radio change while `loading` is true; `loading` is not bound to the radio group's
  disabled/loading state (`src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue:5-9,34-36`,
  `src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts:27-37`).
- **Deterministic evidence:** from initial `en`, hold the persistence for an earlier `setLanguage('zh')`,
  then call the newer `setLanguage('en')`. The newer call resolves successfully with
  `{ language: 'en', revision: 0 }`; releasing the earlier write then persists, applies, and
  broadcasts `{ language: 'zh', revision: 1 }`. Final main state is therefore `zh`, contrary to the
  last acknowledged Home choice. The renderer revision filter cannot correct this because main
  itself assigned the later revision to the older request.
- **Required fix:** serialize authoritative mutations (or otherwise make request ordering explicit)
  and add a focused test that holds the first persistence write while issuing the reverse change.
  The last successfully acknowledged request must be the committed/broadcast snapshot; failed writes
  must still leave the prior committed state untouched.

No P1 or P3 finding was found.

## Contract review

| Contract | Result | Evidence |
|---|---|---|
| Main hydrate timing | pass | Core SQLite load/readiness is awaited before `applicationLanguageService.initialize()`, and Home plus tray creation follow it (`src/main/app.main.ts:207-247`). Invalid persisted values fail through `parseAppLanguage` rather than mounting a guessed locale (`src/shared/i18n/applicationLanguage.ts:50-61,100-106`). |
| Persist before apply/broadcast | pass for one mutation; blocked under concurrency | A single mutation awaits durable write before snapshot/apply/broadcast (`src/shared/i18n/applicationLanguage.ts:119-133`), and the focused failure test proves no effects after a rejected write (`scripts/renderer-i18n/check-renderer-i18n.mjs:135-200`). The finding above shows the missing cross-request ordering contract. |
| Nine renderer entries | pass | The fixed inventory names Home, Todo, Connector, three Omni entries, and three Maestro entries; each source guard requires awaited initialization, dynamic product import, `use(i18n)`, and mount ordering (`scripts/renderer-i18n/check-renderer-i18n.mjs:10-40`). Direct inspection confirmed those nine entries follow that structure. |
| Subscribe/fetch revision race | pass for renderer startup | Shared bootstrap subscribes before `getCurrentLanguage()`, rejects malformed/conflicting snapshots, and ignores a stale fetch response after a newer broadcast (`src/renderer/common/i18n/rendererLanguage.ts:21-57`). Applying a language also updates Vue i18n, reactive messages, and `document.documentElement.lang` (`src/renderer/common/i18n/i18n.helper.ts:32-42`). |
| Real Home General setting | pass except concurrent changes | The routed `GeneralSetting.vue` uses `generalSettingStore`, whose change path calls the typed main API and never writes/broadcasts directly (`src/renderer/home/src/views/setting/Setting.vue:43,57`; `src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts:20-38,58-62`). |
| Todo embedded + standalone | pass by shared-entry inspection | Both the embedded `WebContentsView` and standalone `BrowserWindow` load `todo/index.html` with the Todo preload (`src/main/xpc/todoWindow.handler.ts:65-103,118-176`), so each independent instance executes the same pre-mount fetch/subscription. E2E additionally proves live Todo update and a destroyed/recreated Todo starts in the committed language (`tests/maestro/specs/baseline.spec.ts:109-126,127-133,236-249`). |
| Omni multiple cells + reused control | pass by lifecycle inspection | Every cell chrome is a fresh `omniCell` first-party view (`src/main/windows/omniWindow.helper.ts:450-466`); the control is a live singleton reused across BaseWindow cycles and is destroyed only on host shutdown (`src/main/windows/omniWindow.helper.ts:167-205,315-328,443-447`). Both execute the shared bootstrap, while raw cell web content uses the separate no-XPC `omniCellContent` preload (`src/preload/omni/omniCellContent.preload.ts:1-4`). |
| Maestro destroy/recreate | pass | E2E observes Home, Control, and Workbench live updates, closes the full graph, reopens fresh webContents, and observes `zh` in all three before asserting no renderer errors (`tests/maestro/specs/baseline.spec.ts:116-124,216-234,251-281,310`). |
| No silent required-state fallback | pass | Renderer bootstrap rejection prevents the dynamic product import and Vue mount; no browser/local-storage inference remains. The i18n construction locale is only a pre-mount placeholder and fallback locale is disabled (`src/renderer/common/i18n/i18n.helper.ts:16-30`; all nine entry bootstraps). |
| No language privilege on arbitrary pages | pass | Maestro operation views are created without a preload (`src/main/maestro/windows/maestroWindow.helper.ts:5788-5797`); Omni raw browser cells receive the separate empty `omniCellContent` preload rather than the first-party `omni` XPC preload (`src/main/windows/omniWindow.helper.ts:457-466`; `src/preload/omni/omniCellContent.preload.ts:1-4`). |

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn check:renderer-i18n` | pass | Focused source/contract check exited 0. It does not test overlapping writes. |
| `yarn typecheck:node` | pass | Exited 0. The project script currently invokes `tsc --noCheck`, so this is a configured gate rather than a full Node semantic typecheck. |
| `yarn build` | pass | Main, preload, and all renderer bundles built successfully. Vite emitted only the documented mixed static/dynamic Home-router warning. |
| `yarn test:e2e:maestro` | pass | One Electron test passed in 8.1 seconds. |
| `git diff --check` | pass | Exited 0. |
| `yarn typecheck:web` | baseline failure | Exited 2 with existing Connector, Poker, Home, Maestro, Omni, Todo, and shared-helper debt. No diagnostic references the task-owned i18n contract/bootstrap files or any of the nine changed entry files. |
| Overlapping mutation probe | fail | A held `zh` write followed by an `en` request produced newer result `en@0` but final committed state `zh@1`, reproducing the blocking finding. |

## Conclusion

**blocked** — startup hydration, all nine renderer bootstraps, live fan-out, recreated Todo/Maestro
behavior, explicit initialization failure, and external-page isolation are implemented and their
required gates pass. Delivery is blocked because main does not order overlapping Home mutations, so
an older persistence operation can overwrite a newer successfully acknowledged language choice.
