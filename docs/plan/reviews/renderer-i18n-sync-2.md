# Review: renderer-i18n-sync (round 2)

## Findings

No P1, P2, or P3 finding was found in the round 2 fix or regression scope.

## Blocking-finding resolution

| Contract | Result | Evidence |
|---|---|---|
| Overlapping requests preserve invocation order | pass | `setLanguage()` appends every validated request to one `mutationQueue`; only the queued callback enters `commitLanguage()` (`src/shared/i18n/applicationLanguage.ts:120-130`). The focused test holds the earlier `zh` write, proves the newer `en` request remains pending, then observes ordered commits `zh@1` followed by `en@2` and final main state `en@2` (`scripts/renderer-i18n/check-renderer-i18n.mjs:183-242`). |
| Idempotence uses the post-wait snapshot | pass | The equality check moved into `commitLanguage()`, after the request reaches the head of the queue (`src/shared/i18n/applicationLanguage.ts:132-147`). An independent held-write probe queued two `zh` requests and observed one durable write; both callers received `zh@1`. |
| Failed writes do not poison the queue | pass | The private queue tail converts both fulfillment and rejection to a resolved `Promise<void>`, while the individual request still receives its rejection (`src/shared/i18n/applicationLanguage.ts:125-129`). An independent probe queued two `zh` requests against a first-write failure: the first rejected, the second executed, persisted successfully, and returned `zh@1` after two total attempts. |
| Persist before commit/apply/broadcast | pass | `commitLanguage()` still awaits `persistence.write()` before assigning the next revision, applying main i18n/tray state, and broadcasting (`src/shared/i18n/applicationLanguage.ts:135-147`). The existing failure assertion continues to prove a rejected write leaves `en@0` with no apply/broadcast effect (`scripts/renderer-i18n/check-renderer-i18n.mjs:244-261`). |

## Regression review

| Contract | Result | Evidence |
|---|---|---|
| Main hydration | pass | Core SQLite readiness still precedes language initialization, which still precedes Home and tray creation (`src/main/app.main.ts:207-247`). |
| Renderer revision race | pass | Renderers still subscribe before fetching, ignore lower revisions, and reject same-revision language conflicts (`src/renderer/common/i18n/rendererLanguage.ts:21-57`). Main now assigns revisions inside the serialized commit path. |
| Nine entries before mount | pass | The unchanged fixed inventory still covers Home, Todo, Connector, three Omni renderers, and three Maestro renderers, requiring shared initialization and `use(i18n)` before mount (`scripts/renderer-i18n/check-renderer-i18n.mjs:10-40`). |
| Home authority | pass | The real General setting still calls the typed main request path and does not write durable language or broadcast directly (`src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts:20-38,58-62`). |
| Live update and recreated windows | pass | Electron E2E still observes live Home, Todo, Maestro Home/Control/Workbench updates, then fresh Todo and Maestro renderers starting in committed Chinese (`tests/maestro/specs/baseline.spec.ts:109-133,216-281`). |
| Required-state errors and external pages | pass | Renderer bootstrap still cannot mount after an initialization rejection, and arbitrary Maestro/Omni operation pages still lack the first-party language/XPC preload boundary established in round 1. |

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn check:renderer-i18n` | pass | Focused contract test, including the overlapping reverse-change regression, exited 0. |
| Independent queue probes | pass | Overlapping same-language requests produced one write and `zh@1` for both; a failed first write did not prevent the queued retry from committing `zh@1`. |
| `yarn typecheck:node` | pass | Configured Node gate exited 0 (`tsc --noCheck`). |
| `yarn build` | pass | Main, preload, and all renderer bundles built successfully; only the existing mixed static/dynamic Home-router warning remained. |
| `yarn test:e2e:maestro` | pass | One Electron test passed in 7.6 seconds. |
| `git diff --check` | pass | Exited 0 before the review write and was re-run after it. |
| `yarn typecheck:web` | baseline failure | The diagnostic set remains the existing Connector, Poker, Home, Maestro, Omni, Todo, and shared-helper debt; no task-owned i18n/entry file is reported. |

## Conclusion

**pass** — the mutation queue resolves the round 1 blocking race: request ordering is authoritative,
the idempotence decision uses the state current at execution time, and a rejected mutation cannot
block later requests. Persist-before-broadcast, revision handling, all nine renderer bootstraps, and
the Electron live/recreate flow remain green.
