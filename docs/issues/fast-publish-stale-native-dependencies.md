# Fast publish omits stale native dependencies

Status: Fixed; owner packaging verification pending

## Symptom

`yarn fast_publish:mac_arm` reached Electron Builder's `afterPack` desktop package audit and failed
because both of these runtime assets were absent:

- `app.asar` had no `better-sqlite3-multiple-ciphers` package root;
- `app.asar.unpacked` had no `better_sqlite3.node` native binding.

Electron Builder also reported that it could not find the requested
`better-sqlite3-multiple-ciphers@12.11.1`. Most other missing-package messages in the same output
were platform-specific optional dependencies. The remaining `@rig-lib/semaphore`, `node-abi`, and
`@types/node` collector warnings were not named by the `afterPack` failure; the stale `node-abi`
version was another symptom of the same outdated installation. None was the missing runtime root
that stopped this package.

## Root cause

The intended runtime pair is Electron `40.10.6` plus
`better-sqlite3-multiple-ciphers@12.11.1`. The SQLite release publishes prebuilds for Electron
29–42, including Electron 40. A combined dependency change had incorrectly moved the manifest and
lockfile to Electron `43.2.0`, while the local Yarn installation still contained the intended
Electron `40.10.6` and the stale SQLite `12.6.2`. `yarn check --integrity` therefore failed.

`fast_publish:mac_arm` synchronized Git source and immediately patched the release version before
building. It never synchronized `node_modules` with the newly pulled lockfile. Electron Builder's
Yarn dependency collector requested `12.11.1`, could only find the stale `12.6.2` package on disk,
and omitted the entire native dependency from the application.

This is an installed-dependency freshness failure, not an ASAR-unpack, signing, locale, or 7zip
configuration failure.

## Fix contract

- Restore the exact Electron `40.10.6` manifest and lock entry, retain
  `better-sqlite3-multiple-ciphers@12.11.1`, and remove the `node-abi@4.33.0` resolution introduced
  only for Electron 43.
- Before version preparation, fast publish must run a frozen-lockfile Yarn install so the installed
  Electron and native modules match the current local lockfile.
- Fast publish must not mutate or synchronize Git. The current local working tree is the intentional
  release source; pulling, fetching, resetting, stashing, or checking out is an explicit operator
  action outside the command.
- A failed dependency install must stop before `patch.js`, preventing a release version bump when
  the build cannot safely start.
- Keep `electron-builder.tmp.yml` as the builder source of truth; no ASAR override is needed for a
  dependency that Electron Builder already handles when its installed metadata is correct.
- Lock the command order in the focused release-hook tests.
- Repair the current local installation and verify the required package version and native binding
  without running packaging, signing, notarization, upload, or publication.

## Acceptance

- `yarn check --integrity` passes after dependency repair.
- Installed Electron is `40.10.6` and installed `better-sqlite3-multiple-ciphers` is `12.11.1`.
- The arm64 `better_sqlite3.node` binding exists.
- The focused release-hook contract proves frozen install → patch → build → publish ordering and
  rejects an implicit `git_pull.js` step.

## Resolution — 2026-07-27

The manifest and lockfile now retain Electron `40.10.6`, upgrade SQLite to `12.11.1`, and remove
the Electron 43-only `node-abi` override. Fast publish installs the frozen lockfile immediately
after source synchronization and before `patch.js`, so dependency failure cannot consume a release
version or reach packaging. The focused suite passed 14/14 and independent review found no P1, P2,
or P3 finding. See
[`release-fast-publish-dependency-sync-003-1`](../plan/reviews/release-fast-publish-dependency-sync-003-1.md).

After merge, `yarn install --frozen-lockfile` completed with Electron Builder rebuilding the native
dependency for Electron `40.10.6` arm64. Yarn integrity passed, the installed SQLite package is
`12.11.1`, the binding is an arm64 Mach-O bundle, and an Electron-run-as-Node smoke opened and
closed an in-memory database under Electron ABI 143.

The owner will run the final signed macOS ARM package through `yarn fast_publish:mac_arm`.

## Local release-source update — 2026-07-29

The earlier source-synchronization prefix is superseded. `fast_publish:mac_arm` now starts from the
current local working tree and local `yarn.lock`, runs `yarn install --frozen-lockfile`, then patch,
signed build, and publication. The dependency-freshness fix remains intact; only the implicit Git
mutation is removed.
