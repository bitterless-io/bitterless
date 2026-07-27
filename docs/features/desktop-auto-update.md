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
  exposes it as an optional snapshot. A recreated Home or Maestro renderer must subscribe to live
  events first, then request that snapshot without blocking renderer mount.
- A valid live update event wins over an in-flight snapshot response. In Maestro this includes the
  downloading event for precedence without treating it as ready; a stale ready snapshot must not
  overwrite newer live downloading state. An absent snapshot is a normal optional lookup;
  malformed event or snapshot data is rejected and logged rather than applied.
- Main normalizes `electron-updater` release notes (`string`, note array, or absent) to the string
  field required by Home before storing or broadcasting ready state.
- The Home update button continues to mean "download completed and ready to install"; detecting an
  outer manifest alone must not expose that button.

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
race-safe ready-state replay in Home and Maestro. This task does not package, sign, notarize,
publish, or mutate the production update feed.
