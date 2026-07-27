# Desktop Update-Ready State Is Lost After Renderer Rebuild

Status: active

## Symptom

An update can already be downloaded and ready to install, but a recreated Home or Maestro renderer
does not show the Update button until another ready event occurs or the application is restarted and
downloads the update again.

## Root cause

The polling recovery task made `startPolling()` idempotent and moved Home's subscription before App
mount, which closes duplicate-timer and first-mount ordering gaps. Readiness is still delivered only
through transient `app/updated` and `coach/update-downloaded` broadcasts, however. Main does not keep
an authoritative ready snapshot or expose a read path, so a renderer created after the broadcast
cannot reconstruct the already downloaded state.

Moving the subscription earlier prevents one startup race but cannot recover an event emitted before
the new renderer existed.

## Resolution contract

- Main stores the latest download-ready update snapshot before broadcasting it.
- Home and Maestro can read the optional snapshot through their existing Main XPC boundaries.
- Each renderer subscribes first and requests the snapshot second without delaying mount.
- A valid live update event received while the snapshot request is in flight wins over the snapshot
  response; Maestro availability wins precedence without being mislabeled ready.
- Missing state returns an explicit absent value; malformed data is not applied.
- Keep the single polling timer, non-overlap, two version gates, download-ready button semantics,
  E2E guards, and install lifecycle unchanged.

Delivery: [desktop-auto-update-state-replay-008](../plan/tasks/desktop-auto-update-state-replay-008.md)
