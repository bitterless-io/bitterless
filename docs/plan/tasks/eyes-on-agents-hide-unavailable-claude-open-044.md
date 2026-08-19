---
id: eyes-on-agents-hide-unavailable-claude-open-044
scope: Hide unavailable Claude Desktop Open controls while preserving unread and explicit Preview affordances
status: done
depends-on: [eyes-on-agents-official-provider-logos-043]
---

# EyesOnAgents Hide Unavailable Claude Open

## Objective

Do not render a disabled **Open in Claude** control for a Claude task unless Main has a verified
Desktop `desktopSessionId`. CLI/Hook-only Claude tasks remain visible and retain folder, unread,
Domain, and explicit transcript Preview behavior without suggesting an unavailable action.

## Evidence boundary

- Codex tasks always retain their existing Open action.
- Claude Open is safe only after a one-to-one Desktop metadata mapping supplies
  `desktopSessionId`; the CLI/Hook session UUID is not a Desktop deep-link ID.
- Missing/inaccessible Desktop metadata, a schema mismatch, or duplicate/remapped identity evidence
  must continue to fail closed. The renderer must not guess `claude://resume` or
  `claude://code/<id>` targets.
- Main/store guards remain authoritative even after the unavailable control is hidden.

## Interaction contract

```text
verified Codex / Claude Desktop task     now      [folder] [Open] [More]
Claude CLI/Hook-only task                now      [folder]        [More]
                                                               red dot when idle unread
```

- Render the Open tooltip/button only when `canOpenThread` is true; do not leave an empty control
  box or disabled tooltip.
- A non-openable card is not a keyboard Open target: remove it from the card-level tab order and
  keep Enter/double-click as safe no-ops. Its real buttons remain independently focusable.
- Idle unread remains visible. When Open exists, keep the dot on Open. When Open is hidden, anchor
  the same dot to More and append localized **New** text to the card and More accessible labels.
- Keep explicit **Preview transcript** in the Claude More menu when `canPreviewTranscript` is true.
  Preview is not promoted into Open and does not mark the task read.
- Do not change card height, action-row spacing, provider marks, folder behavior, Domain movement,
  SQLite capabilities, or Main deep-link validation.

## Path

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- Source/render tests cover Codex, Desktop-mapped Claude, and CLI-only Claude rows.
- Assert that CLI-only rows contain no Open control/tooltip or card-level keyboard Open target,
  while their More menu, Preview action, unread dot, and localized accessibility text remain.
- Assert that Codex and Desktop-mapped Claude Open behavior and all Main/store guards are unchanged.
- Run the EyesOnAgents UI aggregate, strict UI typecheck, renderer i18n check, and
  `git diff --check`; do not launch Electron.
- Independent review must report no open P1, P2, or P3 before completion.

## Implementation evidence

- `ThreadCard` now renders its tooltip and Open button only for Codex tasks or Claude tasks with a
  verified `desktopSessionId`. CLI/Hook-only Claude cards omit the control entirely and omit the
  card-level `tabindex`, while the existing renderer and Main fail-closed Open guards remain intact.
- Idle unread uses the existing 6px status mark. Openable tasks keep it on Open; CLI/Hook-only tasks
  place it on More, and both the card and More accessible labels include the localized unread text.
- The existing Claude transcript Preview option remains capability-gated in More. The obsolete
  disabled-control explanation was removed from both locale objects.

## Verification evidence

- `node --test scripts/eyes-on-agents/thread-card-open-capability.test.mjs` — passed 5/5. The
  focused 430-line test covers Codex, Desktop-mapped Claude, and CLI/Hook-only Claude, including
  tab order, hidden Open, unread placement, and renderer/Main safety guards. Its mounted Arco/JSDOM
  interaction case clicks the direct More button and exercises both CLI Preview and normal Domain
  actions, preventing a wrapper from silently breaking the Dropdown trigger. Mounted gesture cases
  also prove CLI-only Enter/double-click no-ops, both openable providers' Open behavior, and the
  absence of unread presentation outside idle.
- `yarn test:eyes-on-agents:ui` — passed 63/63 after updating only the directly superseded
  ThreadCard assertions in `ui-source.test.mjs`; that legacy file is one line shorter than before
  044, and the complete new behavior contract remains in the focused test.
- `yarn typecheck:eyes-on-agents:ui`, `yarn check:renderer-i18n`, and `git diff --check` — passed.
  Electron was not launched. Independent review remains required before this task is marked done.
