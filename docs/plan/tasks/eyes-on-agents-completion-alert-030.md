---
id: eyes-on-agents-completion-alert-030
scope: one localized system notification and supplied tone per newly completed Codex turn
status: done
depends-on: [eyes-on-agents-stop-reconciliation-025, eyes-on-agents-active-focus-read-semantics-028]
---

# EyesOnAgents Completion Alert

## Objective

Emit one sound and localized native notification when a task enters the exact successful terminal
state that produces the unread Open dot, including immediate Hook/App Server completion and the
existing polling fallback.

## Required behavior

- Add a durable completion-notification receipt keyed by `(thread_id, turn_id)`. Seed current
  historical completion identities during migration so upgrades do not alert old unread tasks.
- Return a bounded completion-alert intent only when an accepted `completed` turn both changes the
  row to `idle + unread` and inserts its receipt. A duplicate Hook delivery, repeated App Server
  completion, and Hook/poll race must not emit twice. Polling may emit only when its guarded
  terminal compare-and-set changed the row.
- Fail closed when no concrete completed turn ID exists; a side effect without a durable dedupe
  identity is not allowed.
- Do not scan snapshots for alerts and do not notify historical idle/unread rows on startup.
- Invoke the Main side effect after SQLite commit. Side-effect errors are logged and isolated from
  observation, persistence, renderer broadcasts, and Hook ACKs.
- Route native notification, current-language message assembly, bounded title handling, sound path
  resolution, and platform playback through the shared Main notification-center helper.
- Add localized notification title/body templates under the existing `eyesOnAgents` messages. Bound
  the displayed thread name and use the localized untitled label when no usable title exists.
- Copy the supplied WAV to `build/sounds/eyes-on-agents-thread-completed.wav`, package it as an
  external resource, and resolve separate development/packaged paths. Use no new dependency.
- Support the product's macOS and Windows targets using non-shell, argument-based child processes;
  suppress the system notification sound to avoid playing two tones.
- Align the Windows AppUserModelID with the builder's production/development app IDs so native
  notifications are attributed to Bitterless.
- Do not add settings, UI controls, prompt/response content, click actions, a second poll, or an
  Electron UI run.

## Expected paths

- `docs/issues/eyes-on-agents-completion-alert.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/INDEX.md`
- `build/sounds/eyes-on-agents-thread-completed.wav`
- `electron-builder.tmp.yml`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/app.main.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/notificationcenter/notify.helper.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/preload/sqlite/coreSqlite.release.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/preload/sqlite/dao/eyesOnAgents.migration.ts`
- `src/preload/sqlite/dao/eyesOnAgents.table.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Repository tests cover first completed turn, same-turn duplicate, Hook/App Server race, failed and
  interrupted outcomes, missing turn identity, one guarded polling completion, receipt persistence,
  and historical migration backfill.
- Service tests prove immediate and polling intents call the notifier once after persistence while
  duplicate/no-intent results do not call it.
- Static source coverage checks i18n strings, bundled WAV resource, platform audio commands, silent
  native notification, correct Windows AppUserModelID, and absence of prompt/response fields in the
  alert payload.
- Run `yarn test:eyes-on-agents`, `yarn typecheck:node`, the relevant packaging source test, and
  `git diff --check`. Do not launch Electron; Ral owns audible/native runtime verification.

## Delivery evidence

- Completed on 2026-07-28 and accepted by
  [independent review](../reviews/eyes-on-agents-completion-alert-030-1.md).
- Successful completion persists `idle + unread` and claims one `(thread_id, turn_id)` receipt
  before Main dispatches the alert intent. Historical completion identities are seeded only by the
  versioned migration, so startup cannot replay old alerts.
- System notification, current-language message assembly, bounded title handling, development and
  packaged sound paths, and macOS/Windows playback are centralized in
  `src/main/notificationcenter/notify.helper.ts`.
- `yarn test:eyes-on-agents`, `yarn typecheck:node`, renderer i18n validation, the desktop package
  audit tests, `yarn audit:sqlite-migrations`, and `git diff --check` pass.
- Ral verified on 2026-07-28 that both the system notification and supplied completion sound were
  delivered in the running app.
