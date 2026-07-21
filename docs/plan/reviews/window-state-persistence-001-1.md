# Unified Top-level Window State Persistence Review — Round 1

Status: accepted

Date: 2026-07-21

## Findings and resolutions

No open P1, P2, or P3 finding remains.

- **Omni creation versus teardown:** the initial implementation could resume an awaited legacy or
  cell-layout read after authentication or host teardown. Omni now tracks the active creation
  promise and a generation token. Destroy invalidates the generation, and callbacks capture and
  validate the concrete `BaseWindow` and controller, so an old continuation cannot create, show,
  clean up, or clear the promise of a newer window.
- **Malformed geometry:** absolute and work-area coordinates, relative offsets, dimensions, and
  optional mode fields are validated before an entry is accepted. Unreasonably large coordinates
  reject the entry instead of being silently clamped into a plausible window.
- **Opaque display identifiers:** display ids use independent safe-integer validation rather than a
  coordinate magnitude limit. Valid large nonnegative Electron ids remain persistable; negative
  invalid/unified-desktop ids are omitted from normalized state.

## Static contract assessment

- All eight reachable user-visible top-level identities register with the shared service. Hidden
  SQLite hosts, PDF rendering, detached DevTools, and embedded views remain excluded.
- Capture uses `getNormalBounds()` plus maximized/fullscreen state and the matched physical
  display's work area and relative offset. One process-wide display listener keeps registered
  normal windows usable after removal or relevant metric changes.
- Restore resolves the saved display id, matching work-area fingerprint, still-visible absolute
  rectangle, then primary-display fallback. It constrains size and position in Electron DIP.
- Every first-show path goes through its persistence controller; macOS bounds are reasserted before
  showing. Close and host/auth explicit-destroy paths flush and unregister their controllers.
- The shared JSON store updates one logical-window key at a time, skips unchanged values, and writes
  through a temporary file plus rename. Legacy SQLite, Coin, and Cowork state is imported only when
  the corresponding unified key is absent.

## Conclusion

**Pass.** No static blocker remains. Ral's move/resize/mode/reopen and secondary-display check is the
remaining runtime acceptance step.

## Verification

Per owner instruction, no Electron process, test, build, typecheck, formatter, or lint command was
run. Verification was limited to independent source and lifecycle review plus whitespace/diff
inspection.
