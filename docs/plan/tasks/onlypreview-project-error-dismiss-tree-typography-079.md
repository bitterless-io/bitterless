---
id: onlypreview-project-error-dismiss-tree-typography-079
scope: Make Project index errors dismissible and increase Project tree text by one pixel and one font-weight step
status: implemented; owner verification pending
depends-on:
  - onlypreview-design-completion-025
verify: focused non-Electron Shell source/store tests, directed lint/format and git diff checks; no Electron/Playwright/E2E
---

# Project error dismissal and tree typography

## Objective

Keep a Project/index failure visible without trapping it permanently in the sidebar, and make the
Project tree easier to scan.

## Contract

- The Project inline error keeps its alert icon and message and adds one keyboard-accessible close
  button with a localized accessible name.
- Closing the error clears only the current Shell error message. It does not retry, cancel, or hide
  a later independent failure.
- Project tree entry names use `font-size: 13px` and `font-weight: 500`, increasing the inherited
  12px/400 typography by exactly one pixel and one weight step.
- Row height, indentation, icons, selection, exclusion colors, and directory interactions remain
  unchanged.

## Verification

- Focused source/store tests cover the close button wiring, localized label, state transition, and
  exact Project tree typography.
- Run focused Node tests plus lint, formatting, and `git diff --check` for the touched paths.
- Do not run Electron, Playwright, packaged smoke, or E2E; Ral performs the live visual check.

## Delivery

- The Project inline error now has a localized, keyboard-focusable close button. Its action clears
  only the current Shell error message and leaves later failures visible.
- Project tree rows now render at 13px/500 while retaining their 27px height, indentation, icons,
  selection/exclusion colors, and click behavior.
- Focused Shell/adapter source tests passed 9/9. Focused ESLint, formatting for the touched
  docs/UI/test paths, and task-path `git diff --check` passed. The Shell Store remains within its
  existing source cap at 798 lines.
- The repository-wide web typecheck remains blocked by existing Poker, Connector, Home, Maestro,
  Omni, and path-helper diagnostics; none report a Task 079 file. Electron, Playwright, packaged
  smoke, and E2E were not run by request.

## Owner verification

- Trigger a Project/index failure, close the alert with mouse and keyboard, and confirm the Project
  tree remains visible at the larger medium weight.
