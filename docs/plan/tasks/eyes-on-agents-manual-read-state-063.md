---
id: eyes-on-agents-manual-read-state-063
scope: per-thread manual read/unread toggle, and move the unread dot into the title status slot after the Open button goes away
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-header-search-062]
---

# EyesOnAgents Manual Read State

## Objective

Give every thread — Codex and Claude alike — an explicit read/unread toggle in its overflow menu, and
retire the icon-only Open **button** from the card, moving the unread dot into the title-row status
slot that the working indicator already occupies.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md) — unread persistence and the
  Open-acknowledgement contract
- [Focus Read all](eyes-on-agents-focus-read-all-021.md) — the bulk mutation this sits beside
- [Hide unavailable Claude Desktop Open](eyes-on-agents-hide-unavailable-claude-open-044.md) — the dot
  fallbacks this replaces

Until now the only way to acknowledge one thread was to Open it, and the only bulk path was
`Read all`. There was no way to say "I have dealt with this" without launching the provider UI, and no
way to re-flag something for later at all.

## Required behavior

### Manual read/unread

- Every rendered card's overflow menu carries exactly one read-state item, labelled from the row's
  stored unread flag: unread → **Mark as read**; read → **Mark as unread**. Both providers, every
  runtime state.
- The same menu carries a provider-specific open item — **Open in Codex** for a Codex row, **Open in
  Claude** for a Claude row — with a quiet trailing hint that double-click does the same thing
  (`double click` / `双击`). It calls the existing `openThread` path, so it acknowledges read, records
  `last_opened_*`, and syncs status exactly like the retired button did. It is omitted for a Claude row
  without a trusted Desktop route, matching task 044.
- The mutation is per-thread and addressed by provider-qualified session key. It writes only the unread
  flag; it must not touch `last_opened_turn_id`, `last_opened_at`, runtime evidence, or archive state,
  because a manual acknowledgement is not a deep-link receipt.
- It reuses the existing snapshot-returning mutation shape: contract parser for `{ sessionKey }`,
  provider-visibility guard, `notify()` on change, snapshot back to the renderer.
- Automatic observation stays authoritative. A later accepted Hook/App Server event may set a manually
  cleared row unread again, or clear a manually set one, exactly as it does today for `Read all`. This
  is deliberate: unread means "attention Bitterless observed and you have not acknowledged", and the
  manual toggle is an acknowledgement, not a lock. Document it where the unread contract lives.
- On a non-terminal row (`working`, `waiting_*`, `unknown`) the toggle still writes the flag, but the
  dot only becomes visible once the row settles into `idle`/`failed`/`ended` — the same latent-marker
  rule `Read all` already honors. The menu label always reflects the stored flag, so it stays truthful.
- `Read all` is unchanged: it keeps its terminal-only allowlist and its single-mutation behavior.
- Known consequence, deliberately not guarded: re-flagging a Codex row that sits at
  `status_source = 'discovery'` / `runtime_state = 'unknown'` with no active turn turns it into a
  recovery candidate, so the next background refresh may settle its turn from metadata-only proof and
  possibly claim a completion alert. Guarding it would contradict the latent-marker rule above;
  document it instead.

### Card affordances

- Remove the icon-only Open **button** from the action row. Keep every other way to open a thread:
  double-click and `Enter` still launch the provider deep link, the card keeps its `tabindex` and
  keyboard focus, and the store's `openThread` path — with its read acknowledgement, `last_opened_*`
  evidence, and on-Open status sync — is untouched.
- The unread red dot moves into the title-row status slot that the working indicator uses. Spinner and
  dot are mutually exclusive there (an active row never shows the dot), so the card height does not
  change and no second status region appears.
- Delete the dot's old hosts: the Open-corner dot, the `thread-card__more-control--unread` fallback,
  and the standalone `thread-card__unread-marker` added for routeless Claude rows. With the dot in the
  title slot, every row can show it regardless of Open availability.
- Menu order: open item, read-state item, then the Claude **Preview transcript** item under its own
  condition. The overflow control now always has at least the read-state item, so the "render the menu
  only when it owns an action" rule from task 054 is retired.

### Out of scope

- No manual "force working" control. The owner dropped it: fewer manual overrides is the goal, and a
  forced active state would fight the observation-authority model.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/repository.test.mjs`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/thread-card-open-capability.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `scripts/eyes-on-agents/focus-board-store.test.mjs`

## Verification

- `yarn typecheck:node` and `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents` (repository, core, and UI suites)
- `yarn check:renderer-i18n`
- `yarn build`
- Repository coverage: single-row set/clear writes only the unread flag, leaves `last_opened_*` and
  runtime evidence alone, refuses an archived or invisible row, and reports changed truthfully.
- Rendered-DOM coverage: the dot appears in the title slot for a terminal unread row of either
  provider, never together with the spinner, the Open button is absent, and double-click plus `Enter`
  still call `openThread`.
- Static coverage: the menu label switches on `thread.isUnread`, and no dot fallback markup remains.
- Do not launch Electron E2E; Ral performs the visual check.

## Result

Implemented across all five layers.

**Persistence.** `setThreadUnread({ sessionKey, isUnread })` in the DAO writes `is_unread` and nothing
else — no `last_opened_*`, no runtime evidence, and deliberately no `updated_at`, because
`updated_at` is a refresh sort key (`COALESCE(last_activity_at, updated_at)`) and a pure
acknowledgement must not repage a card. Its visibility guard is byte-identical to the snapshot's
(`archive_state <> 'archived' AND is_deleted = 0`), and `is_unread <> ?` makes `changed: false` mean
"already in that state". No migration was needed and no recompute can undo it: the derivation helper
`isEyesOnAgentsUnread` still has zero callers, and the one-time backfill is gated on
`needsUnreadBackfill`.

**Contract, service, XPC.** `parseEyesOnAgentsSetThreadUnreadParams` validates
`{ sessionKey, isUnread }` with `assertOnlyKeys`. The service resolves the row first (so a missing
thread throws rather than silently no-oping), wraps Claude rows in `runClaudeProviderIntent` +
`requireClaudeProviderEnabled()` — the same serialization boundary `markAllRead` uses, so a paused
provider rejects — and notifies only when the row actually changed. It deliberately does *not* copy
`openThread`'s routeless-Claude refusal: a row you can see must be markable.

**Renderer.** `eyesOnAgentsStore.setThreadUnread(sessionKey, isUnread)` short-circuits a no-op
locally, then runs through `runSnapshotAction`. The card's menu item is disabled while any action is
in flight, which is what makes the store's global busy lock visible rather than silently dropping a
click.

**Card.** The action row lost the icon-only Open button; double-click, `Enter`, `tabindex`, and the
whole `openThread` path (read acknowledgement, `last_opened_*`, on-Open status sync) are untouched.
The overflow menu is now always present and holds, in order: the provider-named open item with a
`(double click)` / `（双击）` hint (omitted for a routeless Claude row), the read-state item labelled
from the stored flag, and the Claude preview item. One `thread-card__status` slot beside the title
carries either the spinner (`role="status"`) or the unread dot (`role="img"`), so they can never
collide and the card height is unchanged. The retired dot hosts —
`thread-card__more-control--unread` and `thread-card__unread-marker` — and the old
`thread-card__working` class are gone.

A read-only mapping workflow cross-checked the shipped chain against the existing house patterns and
found one real side effect, now documented here and in the integration doc: re-flagging a
`discovery`/`unknown` Codex row makes it a recovery candidate for the next background poll. It is
left unguarded on purpose, since a guard would contradict the latent-marker rule.

New coverage: repository (single-row set/clear writes only `is_unread`, no-op reporting, latent
marker on an active row, archived refusal, three parameter rejections), core (parser accept/reject),
store (no-op guard, unknown key, acknowledge, re-flag, unread-tier re-entry), rendered DOM (menu
contents and order per provider, provider-named label with the hint, read-state click payload, dot in
the title slot, no Open button, gestures preserved).

Verified: `yarn typecheck:node`, `yarn typecheck:eyes-on-agents:core`,
`yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents` (all suites; 68 UI assertions),
`yarn check:renderer-i18n`, `yarn build`. Electron E2E not run; Ral performs the visual check.
