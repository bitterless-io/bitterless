---
id: eyes-on-agents-remove-iterm2-claude-097
scope: Remove the iTerm2 connection section and Open-in-iTerm2 capability while preserving Claude observation and multi-environment management
status: implemented; owner verification pending
depends-on: [eyes-on-agents-claude-iterm2-section-093, eyes-on-agents-iterm2-reveal-applescript-094]
verify: focused EyesOnAgents Claude/UI contract tests and Core/UI strict typechecks; no Electron
---

# EyesOnAgents Remove iTerm2 Claude

## Objective

Return Agent connections to two entries, **Codex** and **Claude**, and remove the complete
user-callable iTerm2 integration without regressing Claude observation, Hook setup, Desktop Open,
multi-environment configuration, Codex, or shared card actions.

## Required behavior

- The 60px connection rail contains only Codex and Claude. Remove the `claude-iterm2` tab/panel,
  label, requirement note, and third-section keyboard navigation.
- Keep the existing Claude environments list and every non-iTerm2 environment action. Move it into
  the Claude detail as a neutral `ClaudeEnvironmentCard` so adding, renaming, enabling, removing,
  selecting, retrying, and installing a plugin for a `CLAUDE_CONFIG_DIR` remain available.
- Remove **Open in iTerm2** from both card-menu entrances and delete its component event, card
  handler, renderer store action, typed API, XPC handler, Main service action/dependency, AppleScript
  transport, diagnostic helper, localized copy, focused test, and package-script wiring.
- Claude visibility returns to the trusted Desktop route: `desktopSessionId !== null`. A captured
  historical `iterm2SessionId` no longer makes a CLI-only row visible or openable.
- Remove the macOS Apple Events automation entitlement and usage description introduced solely for
  iTerm2 control.
- Retain the nullable SQLite column, shared snapshot fields, and old Hook payload parser as inert
  upgrade/backward-compatibility data. Do not add a migration, rewrite user data, reject queued old
  Hook deliveries, or expose the retained value anywhere.
- Preserve Claude provider toggle, Desktop inventory/archive/delete sync, Hook lifecycle and sound,
  latest-question permission, transcript path copy, environment attribution, plugin setup/repair,
  card read state, Codex actions, search, context menu, and archive behavior.

## UI contract

```text
┌ Agent connections ─────────────────────────────────────── × ┐
│ Codex │ Codex connection and observation                   │
│  logo │                                                    │
│ Claude│ Claude observation                                 │
│  logo │ Claude environments                                │
└───────┴────────────────────────────────────────────────────┘

Thread card menu: Open in Claude (when Desktop-routable), read state,
Copy session path, and Codex-only Archive. No terminal action remains.
```

## Expected paths

- `docs/INDEX.md`
- `docs/features/eyes-on-agents-iterm2-open.md`
- `docs/features/eyes-on-agents-claude-multi-environment.md`
- `docs/issues/eyes-on-agents-open-in-iterm2-does-nothing.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/common/i18n/en.ts`, `zh.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/main/eyesOnAgents/iterm2Reveal.helper.ts` and `claudeIterm2Log.helper.ts` (remove)
- `electron-builder.yml`, `electron-builder.tmp.yml`, `build/entitlements.mac.plist`
- focused EyesOnAgents tests and `package.json`

## Verification

- Source/mounted UI coverage proves exactly two connection tabs, the environment list remains under
  Claude, and neither card-menu entrance contains an iTerm2 action.
- Core contract coverage proves CLI-only historical iTerm2 identity does not pass visibility, while
  Desktop-routable Claude and Codex behavior remain unchanged.
- Grep confirms no callable `openThreadInIterm2`, reveal helper/log helper, user-facing iTerm2 copy,
  or Apple Events entitlement remains; compatibility schema/storage fields are the only allowed
  iTerm2 references.
- `yarn test:eyes-on-agents:claude`
- `yarn test:eyes-on-agents:ui`
- `yarn typecheck:eyes-on-agents:core`
- `yarn typecheck:eyes-on-agents:ui`
- `git diff --check`
- Electron E2E is not run; Ral verifies the packaged/live UI.

## Result

Implemented on `dev/next`:

- Agent Connections now contains only Codex and Claude. Claude observation and the renamed neutral
  `ClaudeEnvironmentCard` share the Claude detail, preserving every environment/plugin action.
- The complete Open-in-iTerm2 UI → renderer → API/XPC → Main → AppleScript path, its diagnostics,
  localized copy, focused test, and Apple Events packaging permission are removed.
- Claude projection requires a trusted `desktopSessionId`; new Hook events neither emit nor persist
  terminal identity. Historical V3/V4 fields and SQLite storage remain readable but inert.

Code-level verification:

- `yarn test:eyes-on-agents:claude` — passed.
- Focused connection navigation, environment render, thread-card, store, and Claude UI source tests
  — passed.
- `yarn typecheck:eyes-on-agents:core` — passed.
- `yarn typecheck:eyes-on-agents:ui` — passed.
- `yarn test:desktop-package-audit`, `plutil -lint build/entitlements.mac.plist`, and
  `git diff --check` — passed.
- The full UI aggregate still hits an unrelated current-branch runtime-profile bundle-id assertion,
  and the repository-wide renderer-i18n check still hits an unrelated current-branch Tray/Home
  ordering assertion; neither assertion reads or exercises this task's changed surface.
- Electron E2E was not run. Owner verification remains the packaged/live UI handoff.
