# Terminal setting

**Retired by owner decision 2026-09-12.** Zellij now opens directly; the preference and its UI
are removed under [automatic opening and cwd memory](zellij-auto-open-directory.md). The
original default-off contract below is historical and must not gate new startup behavior.
The Terminal settings category now holds shared shortcuts/configuration for all Zellij tabs;
its return does not restore the enable preference.

Status: implemented; human testing pending. Owner decision: 2026-09-10, enable a Bitterless
Terminal switch with the default set to off, matching Cowork.

## Contract

The shared Settings page used by Home and Workbench adds a Terminal category:

```text
Settings
  General          Terminal
  Account            Enable terminal                       [off]
  Terminal
  ...
```

- `CoachSettings.terminalEnabled` is persisted in the existing `coach-settings.json`
  through `CoachXpcHandler.getSettings` / `saveSettings`; no new IPC method is needed.
- Fresh installations and existing files without the field read as `false`. Only
  the boolean `true` enables it; all other stored values normalize to `false`.
- The switch is disabled while loading or saving. A failed load leaves it disabled
  and displays an error. A failed save preserves the last saved value and displays
  an error. Re-entering the category reloads the saved setting.
- Both English and Chinese label the category and switch. Reuse the Settings page's
  typography, spacing, theme colors, and borderless Arco switch.
- The [Zellij miniapp](zellij-miniapp.md) uses this same preference as its runtime
  gate. Enabling alone does not launch a process; Initialize and open does. Disabling
  detaches the terminal and stops only the server child owned by Bitterless.

## Verification

- Passed: default-off, legacy/malformed values, save/reload, unrelated setting
  preservation against the real settings service using an isolated temporary directory;
  renderer load/save success and error guards; Vue SFC and Less compilation.
- Passed: focused TypeScript check of the settings service and Vue/TypeScript check
  of the new component/store and setting contract; new component/store ESLint;
  `yarn check:renderer-i18n`; existing `maestroWorkbenchAccount.test.mjs` (3 tests);
  `node scripts/maestro/check-startup-settings.mjs`; `git diff --check`.
- Human test: open Settings → Terminal, verify the initial off state, enable and
  reopen Settings, restart the app and verify it remains on, then disable it again.
  Verify the English and Chinese labels. Electron E2E is not run automatically.
