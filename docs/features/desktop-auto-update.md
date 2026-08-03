# Desktop Automatic Updates

Status: implemented; owner verification pending

## Ownership and cadence

- Main owns the automatic-update lifecycle. Home asks Main to start polling, but repeated requests
  must still produce exactly one timer per process.
- Starting the poll performs one immediate check and then checks every 60 seconds.
- A timer tick and a manual check share the same in-flight operation. They must never overlap
  manifest checks or downloads, and every resolved or rejected operation must release the in-flight
  slot so a later tick can retry without restarting Bitterless.

## Version contract

Bitterless uses two remote metadata files with different responsibilities:

1. `version_info.json.versionCode` is the product release-order gate.
2. The platform updater metadata, such as `latest-mac.yml.version`, is the authoritative statement
   that `electron-updater` can download a newer artifact for the running application version.

The updater must not enter downloading state until both gates agree that an update is available.
If `versionCode` is newer but `electron-updater` reports `isUpdateAvailable: false`, the check is a
retryable metadata-disagreement error. It must not report a successful download, must not leave a
sticky lock, and the next scheduled or manual check must fetch the metadata again.

## State and renderer UI

- `isDownloading` is true only around the actual `downloadUpdate` call and is reset in `finally`,
  including failures.
- Main broadcasts `coach/update-available` only after the platform updater confirms a downloadable
  update, and broadcasts `app/updated` after the package is downloaded and ready to install.
- Home registers its update subscriber before mounting the root application and starting the first
  poll. XPC subscribers consume the typed update value from `payload.params`.
- Main retains the latest download-ready `UpdateInfo` in memory for the lifetime of the process and
  exposes it as an optional snapshot. A recreated Home, Maestro, or Omni renderer must subscribe to live
  events first, then request that snapshot without blocking renderer mount.
- A valid live update event wins over an in-flight snapshot response. In Maestro this includes the
  downloading event for precedence without treating it as install-ready; a stale ready snapshot
  must not overwrite newer live downloading state. An absent snapshot is a normal optional lookup;
  malformed event or snapshot data is rejected and logged rather than applied.
- Main normalizes `electron-updater` release notes (`string`, note array, or absent) to the string
  field required by Home before storing or broadcasting ready state.
- The Home update button continues to mean "download completed and ready to install"; detecting an
  outer manifest alone must not expose that button.

## Menu-bar coverage and label

The update action appears in the existing window chrome without adding a second toolbar:

```text
Home     │ Bitterless                         [update] [Proxy] [window controls] │
Maestro  │ tabs · address · tools                         [update] [other tools] │
Omni     │ Omni Browser [Layout]                       [update] [window controls] │
```

- The visible label is the exact lowercase literal `update` in every language and state. It never
  expands to `Restart to Update` or `Updating`.
- Home and Omni hide the action until the package is downloaded and ready, then keep it enabled and
  route clicks through the existing quit-and-install lifecycle. Both use the Home Menu Bar's compact
  4px × 10px padding, 12px label, 12px radius, blue background, shimmer treatment, and effective
  12px trailing separation.
- Maestro may reveal the same label while downloading, but keeps it disabled until the downloaded
  event arrives. Its title may continue to describe downloading versus install-ready state.
- Omni places the content-width action only in the top-level `omniWindow` 32px Menu Bar that already
  owns `Layout`, immediately before native Windows controls when present. `omniCell`, Omni Control's
  per-pane Menu Bar, and embedded mini-app/subwindow renderers never show it. The action remains in
  a `no-drag` region and has no fixed or minimum label width. Its complete geometry, blue background,
  white label, and reduced-motion-aware shimmer match the main-window update treatment.
- Omni registers the live ready subscription before requesting Main's optional snapshot and before
  Vue mount. Valid live state wins over an in-flight stale snapshot; malformed values are logged and
  never applied.

## Failure behavior

- Manifest HTTP, parsing, updater-check, metadata-disagreement, and download failures are observable
  check errors and are retryable on the next poll.
- Repeated `startPolling` calls are no-ops after the first start. `stopPolling` clears that one timer
  and allows a later start to create a fresh immediate check and timer.
- E2E-disabled update behavior and the existing install-on-confirmation flow remain unchanged.

## Verification boundary

Automated coverage uses a controlled scheduler and deferred checks to prove immediate start,
idempotent timer ownership, non-overlap, and release after success or failure. Source-contract
coverage protects the two-gate decision, download-only state, subscribe-before-mount ordering, and
race-safe ready-state replay in Home, Maestro, and Omni. Packaging and publication remain separate
release-pipeline responsibilities.
