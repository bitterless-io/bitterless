# Review: settings-notification-runtime-recovery-002

## Findings

No P1, P2, or P3 findings. No blocking or non-blocking contract deviations were found.

## Conclusion

**pass**

The implementation matches the recovery contract in
`docs/issues/settings-notification-test-silent-noop.md` and preserves the existing Settings and
EyesOnAgents contracts.

- `src/main/notificationcenter/notify.helper.ts:67-195` retains each native object before
  `show()`, bounds retention at 60 seconds, and uses idempotent release plus a guarded settlement
  path. `show`, `failed`, lifecycle timeout, constructor failure, and synchronous `show()` failure
  cannot settle the test more than once. Failure and timeout paths release the strong reference;
  the success path deliberately keeps it until a native terminal interaction or the retention
  deadline. Lifecycle listeners and timers are removed or cancelled on every applicable terminal
  path.
- `src/shared/setting/settingNavigation.contract.ts:26-69` accepts only the four exact result
  shapes, rejects extra keys and unknown variants, and throws the typed
  `NotificationSettingsContractError` on malformed transport data.
- `src/renderer/home/src/views/setting/components/NotificationSetting/notificationSetting.store.ts:14-44`
  maps `unsupported`, `show-failed`, `show-timeout`, and transport/contract rejection to separate
  localized feedback while retaining the single in-flight guard. The unchanged
  `NotificationSetting.vue` still contains one mini button.
- `scripts/notification/notificationTest.test.mjs:285-295` executes the real `electron-xpc` Main
  registry through the actual `NotificationHandler` and an actual `NotifyHelper` instance with an
  injected native runtime; this integration assertion is not regex-only. The remaining runtime,
  contract, Renderer source, and layout checks cover all required variants.
- `src/main/notificationcenter/notify.helper.ts:75-77,176-233` keeps EyesOnAgents completion
  best-effort and non-fatal, preserves `silent: true`, uses the unchanged supplied completion-tone
  path/playback implementation, and now shares the bounded retention helper.
- The notification changes are a surgical overlay. Mixed files contain clearly separate parallel
  Trench/Coin hunks (`docs/INDEX.md`, `docs/plan/README.md`, and both locale files), while all Coin
  source/test additions remain outside the notification task path. `package.json` currently has
  only an unrelated version bump relative to HEAD; the pre-existing `test:notification` script is
  preserved. No parallel work was edited or attributed to this task.

## Verification evidence

- `yarn test:notification` — pass, 11/11 tests. This includes strict parser variants, retained
  `show`, native `failed`, missing-event timeout, unsupported, support-check/constructor/show
  synchronous failures, executable Main XPC integration, EyesOnAgents silent sound/retention, and
  Renderer feedback source coverage.
- `yarn check:renderer-i18n` — pass.
- `yarn typecheck:node` — pass.
- Focused ESLint over all changed notification source, locale, contract, and test files — exit 0,
  no errors. The full locale files report existing Prettier-warning debt (HEAD already reports 131
  English and 109 Chinese warnings); a second focused run over notification code/contract/test
  files excluding the full locale data was clean.
- `yarn typecheck:web` — repository baseline failure only. Diagnostics are confined to existing
  connector, poker-test, chat, renderer bridge, EyesOnAgents, and path-helper files. A filtered
  rerun reported `[notification-task-path] no web typecheck diagnostics`.
- `git diff --check` — pass.
- Source/diff audit — reviewed the complete task file, all context documents, `docs/INDEX.md`, every
  task-path source/test file, the actual `electron-xpc` 1.1.0 Main registry implementation, current
  task-path diffs, and the full working-tree name/stat inventory.
- Per task restriction, no build, installed-app restart, branch operation, commit, or source/test/
  configuration/task-file edit was performed. The signed-build click check remains Ral's runtime
  handoff.
