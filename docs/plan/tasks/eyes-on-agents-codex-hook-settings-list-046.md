---
id: eyes-on-agents-codex-hook-settings-list-046
scope: Replace the verbose Codex Hook guide with a concise status-first settings list
status: in-progress
depends-on: [eyes-on-agents-agent-connections-navigation-045]
---

# EyesOnAgents Codex Hook Settings List

## Objective

Turn the Codex observation card into a compact settings surface: current status and **Check status**
at the top, followed by a vertical list where each row says what to do on the left and exposes only
the action Bitterless can actually perform on the right.

## Current product boundary

- Bitterless owns four user-level Codex hooks as one exact observation set:
  `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, and `Stop`.
- Bitterless can install/repair/remove that owned set, check aggregate status, and control the
  separate default-off latest-question permission.
- Review, trust, manual enablement, and reload happen inside Codex. There is no supported deep link
  that opens the Hooks settings page directly, so external rows intentionally have no button.
- The official [Codex Hooks documentation](https://developers.openai.com/codex/hooks) states that
  non-managed command hooks must be reviewed and trusted before running and documents `/hooks` for
  inspection. The official [Settings documentation](https://learn.chatgpt.com/codex/reference/settings)
  documents opening Settings from the app menu or keyboard shortcut.

## UI contract

```text
Codex observation                [Needs review] [Check status]
Needs review in Codex. Turn on and trust all four Bitterless hooks.
────────────────────────────────────────────────────────────
Codex → Settings → Hooks
Turn on and trust: SessionStart · UserPromptSubmit ·
                   PermissionRequest · Stop
Store latest user question                           [Switch]
Remove Codex observation                            [Remove]
```

- Remove the general description, facts box, conditional trust paragraph, nested four-step guide,
  numbered steps, and bottom action cluster.
- Keep one white observation card. Rows use 1px hairlines, 48–52px rhythm, a 12px action label, and
  at most one compact 10px supporting line. Do not add nested cards, chips, shadows, or extra badges.
- Header always shows the aggregate status pill, one status-specific sentence, and one
  **Check status** button. Check status remains a Bitterless action and does not claim to check the
  independent App Server.
- The complete **Install Bitterless hooks** row appears only when absent or drifted; it shows
  **Enable** only when absent and **Repair** only on proven drift.
- **Codex → Settings → Hooks** appears only while Codex review is required. It is an external
  instruction with no right-side control, and its supporting line names exactly the four
  Bitterless hooks to turn on and trust. It uses the existing pale amber treatment and a 2px left
  indicator.
- **Store latest user question** keeps its existing independent Switch and privacy semantics.
- The UI support copy stays to one line; the complete privacy contract remains in the feature docs.
- The complete **Remove Codex observation** row appears only while an owned installation may exist.
- Error text remains bounded and visible in the header status sentence; no raw Hook key, hash,
  command, filesystem path, or per-hook mutation capability reaches the renderer.

## State copy

- `not_installed`: Not installed; Enable is available.
- `drifted`: Needs repair; Repair is available.
- `needs_trust/untrusted`: Needs review in Codex; emphasize the external row.
- `needs_trust/disabled`: Disabled in Codex; tell the user to turn on all four hooks.
- `needs_trust/modified`: Definitions changed; tell the user to review and trust the current set.
- `installed/listening`: Observing; all four hooks and listener are active.
- `installed/not listening`: Installed, listener paused; Check status remains available.
- `error`: Status unavailable; Check status remains available without guessing the failed hook.

## Path

- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.vue`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- directly affected EyesOnAgents UI source assertions

## Verification handoff

Ral requested no agent-run tests for this task and will perform end-to-end verification. The agent
must update directly stale source assertions but must not run automated, type, build, renderer, or
Electron tests. Static code review may inspect the final diff without executing it. Completion stays
owner-verification pending until Ral confirms the live flow.

## Implementation evidence

- Replaced the description, facts, trust summary, numbered Hook guide, and bottom action cluster
  with a status-first header and up to four flat, state-filtered settings rows.
- Kept **Check status** permanently available in the header; complete install/repair, external
  Settings, and remove rows now render only in their relevant aggregate states.
- Made `Codex → Settings → Hooks` an instruction-only row and named the exact owned Hook set:
  `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, and `Stop`.
- Added state-specific status sentences and limited amber attention styling to the external settings
  row while Codex review is required.
- Preserved the independent latest-question switch with one concise support line; the full
  local-storage, clearing, and content boundary remains in the feature contract.
- Follow-up static product review removed irrelevant whole rows: absent observation has no blank
  Remove row, observing has no enable/trust instruction, and Settings appears only for review.
- Removed unused renderer computeds, the renderer-side Codex review action, obsolete i18n copy, and
  directly stale UI source assertions.
- Static source inspection and `git diff --check` only. Per Ral's instruction, no automated test,
  typecheck, build, renderer, or Electron command was run; live end-to-end verification is pending.
