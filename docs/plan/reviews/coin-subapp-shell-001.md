# Coin Sub-application Shell Review

Date: 2026-07-15
Verdict: Pass after fix

## Finding and resolution

The first independent run found one medium lifecycle defect: a rapid second Open resolved and showed
the published window before the first boot promise completed. The lifecycle now gives an active boot
promise precedence over the provisional window, awaits it, rechecks the lock, and only then
shows/focuses.

The regression proves the first and second Open remain unsettled with no show calls before boot
completion, then both settle against one created window. Auth invalidation and permanent host cleanup
tests remain passing.

## Evidence

- Focused lifecycle/sender/geometry tests: `8/8` passed.
- Focused Coin renderer and Node typechecks passed.
- `yarn build` passed with only the existing Home router mixed-import warning.
- Electron Playwright passed at `1360x860` and `800x600`.
- Source/bundle audit found no chat, composer, prompt, split, hidden Coin SQLite, browser view, iframe,
  remote page, or `CoinCodexPane` residue.
- Full-width workspace, Resources shell, locale sync, sender guard, geometry restore, and auth cleanup
  passed. Screenshots showed no clipping, overlap, overflow, blank region, or text-fit defect.
- Task-scoped `git diff --check` passed.

Residual manual risk is limited to native OS drag/minimize/maximize gestures, whose CSS/IPC contracts
were source-inspected while close and geometry behavior were exercised in Electron.
