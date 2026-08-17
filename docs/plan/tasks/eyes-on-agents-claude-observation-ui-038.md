---
id: eyes-on-agents-claude-observation-ui-038
scope: Claude plugin lifecycle observation, connection guide, provider icons, and full integration
status: implemented; owner verification pending
depends-on: [eyes-on-agents-claude-inventory-open-037]
---

# EyesOnAgents Claude Observation And UI

## Objective

Install a safe Claude user-scope observation plugin, deliver lifecycle state reliably, and expose
Claude alongside Codex in the existing compact Monitor UI.

## Required behavior

- Generate/install/repair/remove only the Bitterless-owned Claude plugin and local marketplace;
  preserve every unrelated plugin, Hook, setting, and transcript.
- Observe SessionStart, UserPromptSubmit, PermissionRequest, Stop, StopFailure, and SessionEnd with
  a short-lived content-free helper, profile socket, bounded outbox, commit ACK, and receipt dedupe.
- Discard prompt, reply, reasoning, tool, attachment, and other non-allowlisted Hook input.
- Track configured, listener, first/last committed receipt, trust-withheld inference, drift, and
  bounded errors separately.
- Add a Claude connection section with Enable/Repair, Check status, Disable, and `/hooks` guidance.
- Add compact accessible Codex/Claude glyphs before titles without new rows, borders, or card height.
- Keep the existing one ten-second poll, Focus/unread/completion notification semantics, stable
  active ordering, and Codex UI behavior.

## Expected paths

- `src/main/eyesOnAgents/claude*`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/shared/eyesOnAgents/**`
- `src/renderer/eyesOnAgents/**`
- `src/renderer/common/i18n/**`
- `scripts/eyes-on-agents/**`

## Verification

- Bridge tests prove exact owned-plugin mutation, unrelated-setting preservation, content stripping,
  offline replay, receipt dedupe, and trust/receipt status.
- UI source/store tests prove provider icons, guide lifecycle, provider-qualified actions, and no
  Codex regression.
- Run full EyesOnAgents, migration, node/type, production-build, and `git diff --check` checks; do
  not launch Electron.

## Implementation evidence

- Main generates a Bitterless-owned user-scope marketplace/plugin with the six metadata-only Hooks,
  a two-second platform wrapper, an `ELECTRON_RUN_AS_NODE=1` helper, and no settings-file mutation.
  Its marketplace description and plugin author metadata satisfy Claude 2.1.220 strict manifest
  validation and remain part of the exact artifact digest.
  Packaged Linux wrappers persist the validated executable `APPIMAGE` path rather than the ephemeral
  `/tmp/.mount_*` runtime path; invalid, relative, symlinked, or non-executable values fail closed to
  the current process executable.
- Each installation/repair rotates a UUID generation and private outbox. The listener validates the
  exact endpoint, generation, and outbox; removal closes admission and drains the socket before
  exact user-scope CLI cleanup, so cached old Hooks cannot update runtime state.
- Same-build Repair verifies exact ownership, then uses user-scope uninstall/install/enable instead
  of a same-version update; this refreshes Claude's cached wrapper generation while a failed repair
  remains restart-required with intake closed. Marketplace removal additionally requires an exact
  one-plugin catalog and proves that no extra or non-user-scope plugin shares the namespace.
- Plugin state, owner markers, and artifact comparisons use bounded regular-file reads; artifact
  traversal has file-count/depth limits and rejects symlinks, oversized files, and unexpected tree
  entries as recoverable drift instead of reading unbounded local input.
- Current-generation observation proof stays generation-bound in the private bridge state, while
  first/last committed receipt timestamps are projected from SQLite's provider-qualified receipt
  ledger.
- The private outbox uses occurred-time filenames, a process lock, bounded pending/quarantine
  directories, coverage-gap markers, commit ACKs, ordered replay, and live-versus-replay proof.
- A detected durability gap is persisted as a bounded Repair-required bridge error rather than a
  normal restart notice. Repair rotates the generation, clears every prior Bitterless outbox and
  marker, and only then reopens intake; Disable idempotently removes the entire owned outbox root.
- Bridge state uses an exact, bounded schema with strict booleans, digest, recovery-reason, paired
  receipt timestamps, and JavaScript Date-range validation, so malformed local state cannot project
  observing or make status rendering throw.
- Claude Hook transcript paths remain Main-private and are joined only after canonical root and
  expected-session validation. Prompt, reply, tool, reasoning, attachment, and raw Hook objects are
  discarded before socket delivery, offline storage, SQLite, and logging.
- Canonical JSONL mtime advancement renews an active Claude Hook lease without changing its working
  start time. The ten-second fallback now serializes Claude inventory refresh before lease expiry,
  so a fresh transcript heartbeat cannot race an old lease to `unknown`; scan failure still expires
  stale activity, independently of Codex reconciliation.
- A JSONL mtime ahead of the observation clock is ignored for both activity and heartbeat until the
  clock actually reaches it, preventing a fixed future timestamp from renewing interrupted work on
  every poll.
- Connection status, provider-qualified glyphs/actions, and explicit JSONL Preview are projected
  through strict shared/XPC contracts without exposing URL, command, or transcript paths.
- Cold startup treats persisted plugin state only as configuration intent until a fresh CLI
  inspection proves the user plugin enabled. The asynchronous inspection/listener transition then
  broadcasts one snapshot invalidation, so an early renderer snapshot cannot remain stale.

## Verification evidence

- `yarn test:eyes-on-agents` — passed, including Claude inventory, Hook bridge, repository, core,
  Codex bridge, UI source/store, and rendered-DOM suites; the Hook bridge fixture also asserts the
  Claude 2.1.220 strict-required marketplace description and plugin author shapes.
- `yarn audit:sqlite-migrations` — passed all Core, Maestro, Todoist, and Trench baselines.
- `yarn typecheck:eyes-on-agents:core` — passed.
- `yarn typecheck:eyes-on-agents:ui` — passed after the shared window contract moved out of the
  preload-only alias boundary.
- `yarn build` — passed without launching Electron.
- `git diff --check` — passed.

## Review

- Independent review accepted with no open P1, P2, or P3 finding:
  [round 1](../reviews/eyes-on-agents-claude-observation-ui-038-1.md).
- Live Electron plugin installation and visual/runtime acceptance remain with Ral, as requested.
