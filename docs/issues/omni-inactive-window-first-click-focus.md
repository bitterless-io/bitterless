# Omni inactive-window first click does not focus another cell

Status: implemented; owner verification pending

Implementation: [omni-inactive-first-click-focus-005](../plan/tasks/omni-inactive-first-click-focus-005.md)

## Report

With two Omni cells A and B, focus an input in A, switch to another macOS application, then click an
input in B. The first click only reactivates the Omni top-level window; B receives no click and its
input does not focus until the second click.

## Root Cause

Omni's `BaseWindow` uses the macOS default `acceptFirstMouse: false`. Cocoa consumes the first click
to activate an inactive window instead of passing that gesture through to the child
`WebContentsView` under the pointer. The previously focused input in A remains the window's first
responder until a later delivered click selects B.

This is a top-level native-window delivery policy, not a renderer timing defect. Omni's recursive
layout is flattened into sibling native views under one `BaseWindow.contentView`, and native hit
testing already owns the exact target view.

## Fix Contract

- Set `acceptFirstMouse: true` only for the Omni `BaseWindow` on macOS.
- Let native hit testing route the activation click to the exact browser chrome, browser content, or
  mini-app `WebContentsView` under the pointer.
- Do not synthesize renderer clicks, add timing delays, call `webContents.focus()` for the
  previously active cell, or change active-frame persistence.
- Keep Windows behavior unchanged; Electron does not configure this option outside macOS.

## Acceptance

1. Focus an input in cell A.
2. Activate another macOS application.
3. Click an input in cell B once.
4. Omni becomes active and B's input receives focus from that same click.
5. Repeat with browser and mini-app cells and confirm normal already-active-window clicks are
   unchanged.

The first activation click is window-wide and may also activate a link or button under the pointer.
Ral owns live desktop verification. Electron E2E is not run.

## Implementation

- Omni's macOS `BaseWindow` now sets `acceptFirstMouse: true`; the non-macOS constructor branch is
  unchanged.
- Website URL chrome, Website remote content, and Mini App content all remain sibling native views
  under that one window and receive the same first-mouse policy.
- Independent review passed with no findings:
  [omni-inactive-first-click-focus-005-1](../plan/reviews/omni-inactive-first-click-focus-005-1.md).
- `yarn build` and `git diff --check` passed. Electron E2E was not run; Ral owns the live acceptance
  sequence above.
