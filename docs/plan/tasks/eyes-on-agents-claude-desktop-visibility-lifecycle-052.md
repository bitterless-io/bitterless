---
id: eyes-on-agents-claude-desktop-visibility-lifecycle-052
scope: show only Claude sessions with a trusted Desktop route and keep Hook-owned responses active until an explicit terminal event
status: in-progress
depends-on: [eyes-on-agents-hide-unavailable-claude-open-044, eyes-on-agents-claude-stop-alert-047, eyes-on-agents-claude-deletion-sync-051]
---

# EyesOnAgents Claude Desktop Visibility And Response Lifecycle

## Objective

Remove Claude inventory rows that Bitterless cannot safely open in Claude Desktop from every user
surface, and keep a live Claude response in Focus/loading through thinking and tool execution until
Claude emits an admitted terminal Hook event.

## Evidence

- The packaged production database contains two `COWORK-CHAT` rows. The current row has one unique
  `local_<uuid>` Desktop identity. The older row has no Desktop identity and is marked ambiguous.
- Claude Desktop metadata maps only the current CLI session. Both JSONL files remain after the
  Cowork session rolled to a new CLI session, so transcript inventory correctly retains internal
  evidence but cannot provide a safe Desktop deep link for the old row.
- The affected Cowork process runs with `bypassPermissions`; no permission dialog caused the
  observed loading loss.
- `UserPromptSubmit` currently grants Claude Hook active state only a 30-second freshness lease.
  The response spent roughly that interval thinking, then entered `Run command`; snapshot
  projection expired it to `unknown` even though no `Stop` or `StopFailure` had arrived.

## Required behavior

- A Claude row is user-visible only while Claude support is available, it is neither archived nor
  deleted, and it has a validated, unique, non-ambiguous `desktopSessionId`. Codex visibility is
  unchanged.
- Claude JSONL/Hook/Agent View rows without that Desktop identity remain Main-private inventory for
  future identity reconciliation, deletion barriers, delivery deduplication, Domain continuity,
  unread state, and consented latest-question state. They do not enter Focus, All, Domains, Project
  filters, search, or card actions.
- A later unique Desktop mapping exposes the same canonical row; no duplicate renderer card is
  created. A collision or ambiguity removes the card again without guessing a deep link.
- Main keeps its existing Open target guard even though the renderer never receives an ineligible
  row. The task-047 Stop alert contract remains unchanged: a valid CLI-only Stop may still notify a
  user who can return to that terminal session.
- `UserPromptSubmit` opens a Hook-owned response epoch. `PermissionRequest`, thinking, tool
  execution, and waiting phases remain active and keep the card in Focus with a loading indicator.
- Ordinary time passage, the former 30-second freshness limit, transcript polling, and Agent View
  `done`/`idle`/`stopped` observations must not end a current Hook-owned epoch.
- Only a newer admitted `Stop` completes the epoch and produces the existing deduplicated completion
  alert. `StopFailure` ends it as failed without a completion alert. `SessionEnd`, provider disable,
  coverage loss, archive, and deletion may invalidate or hide the state but never fabricate a
  completion.
- Persisted Hook-active state is invalidated when a new Bitterless/provider listener lifecycle
  starts, before new live/outbox evidence is accepted. This prevents a crash or restart from leaving
  an unbounded stale loader while preserving the no-premature-terminal rule within one lifecycle.
- If Claude omits `Stop` after a user interruption, Bitterless may retain loading until that
  listener/session lifecycle is invalidated; it must not guess that the response completed from a
  timeout.

## Path

- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- focused EyesOnAgents service/repository/render tests under `scripts/eyes-on-agents/`
- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`

## Verification

- Mapped Claude rows and every Codex row remain visible; unmapped or ambiguous Claude rows are absent
  from every snapshot-derived renderer view while existing Main Open validation remains fail closed.
- Hook-first inventory stays hidden until a unique Desktop mapping appears, then the same row becomes
  visible with its retained Domain/unread/latest-question state.
- `UserPromptSubmit -> more than 30 seconds -> Run command` remains active/loading and in Focus.
- `PermissionRequest`, `waiting_approval`, and `waiting_input` retain the loading indicator.
- Agent View terminal evidence cannot overwrite a Hook-owned active epoch; a valid Stop or
  StopFailure can, and duplicate/older terminal delivery cannot.
- Startup/resume/provider-off/coverage-loss invalidation prevents stale loaders without generating
  completion alerts.
- Run focused service/repository/render tests, Core/UI strict typechecks, renderer i18n, and
  `git diff --check`. Do not launch Electron; Ral owns development and packaged Claude E2E.

## Implementation evidence

- Main snapshot projection now retains every Codex row while publishing a Claude row only when the
  provider lifecycle is available and the repository row has a non-null validated Desktop session
  identity. The underlying Claude row is not deleted, so later inventory reconciliation can expose
  that same canonical row after a unique Desktop mapping appears.
- Claude Hook active writes no longer create or renew a 30-second freshness lease. Transcript
  inventory preserves the Hook epoch timestamps, Agent View reconciliation skips a Hook-owned
  active epoch, and ordinary expiry targets only Agent View leases.
- Provider/listener activation force-invalidates persisted Hook-active rows before listener start
  and outbox replay. Disable, listener failure, bridge refresh/install/remove, and coverage-loss
  paths also invalidate the applicable active state without claiming a completion.
- The task card renders its existing loading indicator for `working`, `waiting_approval`, and
  `waiting_input`; no additional Claude tool hooks were introduced.
- `scripts/eyes-on-agents/claude-visibility-lifecycle.test.mjs` provides a bounded service/DAO
  regression suite for mapped versus unmapped projection, Hook state after the former timeout,
  Agent View suppression, Stop/StopFailure/SessionEnd terminals, older/duplicate delivery fences,
  and activation invalidation ordering. Existing repository and card tests assert transcript mtime
  preservation and all three active-state spinners.

## Verification evidence

- `node --test scripts/eyes-on-agents/claude-visibility-lifecycle.test.mjs` — 2 passed.
- `yarn test:eyes-on-agents:repository` — passed.
- `node --test scripts/eyes-on-agents/thread-card-open-capability.test.mjs` — 6 passed.
- `node --test scripts/eyes-on-agents/ui-source.test.mjs` — 25 passed.
- `yarn test:eyes-on-agents:claude` — passed, including the new focused suite.
- `yarn typecheck:eyes-on-agents:core` and `yarn typecheck:eyes-on-agents:ui` — passed.
- `yarn check:renderer-i18n` and `git diff --check` — passed.
- Electron, packaged-app, and end-to-end tests were not run; Ral owns that verification.
