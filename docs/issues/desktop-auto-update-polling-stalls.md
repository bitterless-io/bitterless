# Desktop Automatic-Update Polling Stalls Until Restart

Status: active

## Symptom

After a new version is published, an already-running older Bitterless process can fail to download
it or show the update button. Restarting the application makes the update appear immediately.

## Root cause

The updater has two independent gates. Bitterless first treats a newer
`version_info.json.versionCode` as an available release, while `electron-updater` separately compares
the semantic version in `latest-mac.yml` with the running app version.

The current implementation sets `isDownloading = true` after only the first gate. When the second
gate normally returns `isUpdateAvailable: false`—for example, during a temporary metadata mismatch
or a same-semver release-code change—the `update-not-available` path skips the download but never
resets `isDownloading`. Every later 60-second tick and manual check exits through the "already
downloading" guard without fetching metadata. A process restart reconstructs the service with a
clear flag, which explains the observed recovery.

The state-machine defect is confirmed from source and exists in previously packaged code. A
historical `0.0.44` tree contains two different `version_code` values that could trigger the dual-gate
path, but retained artifacts and logs do not prove that both variants reached the public feed; that
historical trigger remains an evidence-backed hypothesis rather than part of the root-cause claim.

## Secondary lifecycle gaps

- `startPolling()` is not idempotent, so a recreated Home renderer can add another interval while
  Main retains the earlier one.
- Home mounts the root app, whose `onMounted` starts polling, before registering the update
  subscriber; the immediate check can therefore broadcast before Home is listening.
- The Home subscriber reads the whole XPC callback payload as `UpdateInfo` instead of reading
  `payload.params`.

## Resolution contract

- Use one shared in-flight operation for timer and manual checks, and release it after every result.
- Treat the platform updater's returned `isUpdateAvailable` as the second authoritative gate.
- Enter downloading state only for `downloadUpdate`, and reset it in `finally`.
- Make timer startup idempotent and preserve immediate plus 60-second polling.
- Register Home's correctly typed subscriber before the first poll can start.
- Add behavioral regression coverage without packaging or publishing.

Delivery: [desktop-auto-update-polling-007](../plan/tasks/desktop-auto-update-polling-007.md)
