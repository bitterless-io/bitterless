# OnlyPreview Project width is not persisted

Status: implemented; owner verification pending

## Problem

The Project directory pane can already be resized through its 5px vertical separator, but the
width lives only in the current Shell renderer store. Closing or recreating the OnlyPreview window
returns the pane to the hard-coded `264px` default.

Writing on every pointer event would also turn one drag into an unnecessary stream of synchronous
storage writes.

## Accepted correction

```text
before drag                         after drag and window recreation
┌──────── 264px ────────┬──────┐   ┌────────── saved width ──────────┬──────┐
│ Project               │      │   │ Project                         │      │
│ directory tree        │Preview│   │ directory tree                  │Preview│
└───────────────────────┴──────┘   └─────────────────────────────────┴──────┘
                        ⇆                                          ⇆
```

- Treat Project width as a renderer-local visual preference shared across Projects, not Project
  data and not an encrypted/Main-owned setting.
- Restore a valid saved width before the Shell's normal initialization work. Invalid, missing, or
  inaccessible storage falls back to `264px`.
- Keep the existing `180px` minimum, `480px` maximum, and the current viewport-aware maximum that
  reserves at least `320px` for Preview.
- Apply width continuously during dragging, but throttle persistence with leading and trailing
  writes. The trailing write must always contain the latest dragged width.
- `pointerup`, `pointercancel`, and Shell teardown synchronously flush the last pending width so a
  window close immediately after dragging cannot preserve an earlier sample.
- Keyboard separator resizing uses the same persistence path.

## Acceptance

- Dragging the separator remains visually immediate and does not write once per pointer event.
- The final clamped width is saved even when the drag ends inside a throttle interval.
- Recreating OnlyPreview restores the saved width, clamped for the current window size.
- Corrupt or unavailable local storage cannot prevent Shell startup.
- Preview native-view bounds continue to track the live resized layout.

## Resolution

[Task 102](../plan/tasks/onlypreview-project-width-persistence-102.md) implements this contract with
a renderer-local leading-plus-trailing persistence service and a real `pagehide` teardown flush.
[Independent review 1](../plan/reviews/onlypreview-project-width-persistence-102-1.md) passed after
closing its teardown-lifecycle finding. Ral's live drag/recreate check remains.
