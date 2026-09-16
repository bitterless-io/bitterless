# OnlyPreview workspace opening fails on a corrupt persistent index

Status: root cause confirmed; recovery implemented, owner testing pending (task160).

Ral reported `OPERATION_FAILED` at 2026-09-08T03:54:57.285Z after clicking the BL workspace.
The matching log is the DEBUG_PROD profile, not the installed PREVIEW profile. The directory
target was accepted at03:54:54.434Z; initialization logged reusable/reconcilable SQLite at
03:54:56.791Z, then failed at03:54:57.279Z before publishing the root listing. The contract masked
the underlying exception as a generic operation failure.

An earlier attempt at03:54:52 also hits a distinct cold-open readiness race. A second explicit
request returns the already allocated host before fileSearch startup finishes; the still-unregistered
authority returns no valid protocol envelope. This is reproducible with actual helper methods and
a delayed ready gate, without HMR. Task161 now serializes host readiness; task160 addresses the
independently confirmed database corruption after startup succeeds.

A read-only query against the existing derived index confirms SQLite error11 (`SQLITE_CORRUPT`):
`database disk image is malformed`. The files/metadata tables remain readable, but iteration of
search_tree fails after14,662 rows. The database is approximately4.8GB. No database, project file,
configuration or installed application was changed for diagnosis.

Fix: recognize only explicit corrupt/not-a-database errors, close failed handles and quarantine
that exact cache database with its sidecars before one clean rebuild in the search preload.
Do not scan/checksum/copy the large database on startup, silently treat every exception as
corruption, or delete the project/configuration. Preserve healthy warm-index reuse. Emit bounded
stage/error diagnostics without file contents. Recover the original data if quarantine fails;
do not loop forever on a fresh build failure. Inspect Cowork for the identical code path and port
the same correction if present. See task160 for verification.

Implemented recovery in both BL and Cowork's matching core; this does not assert that Cowork's
live cache is corrupt. Real small SQLite fixtures reproduce a malformed header and a damaged
search_tree under a valid header. Both recover searchable Files/Contents while retaining damaged
bytes in quarantine. No actual profile database was repaired during this session.

Storage note: a read-only capacity check found about11GiB available on the data volume. Preserving
the approximately4.8GB damaged cache means the new index needs additional space; no project files
or existing caches were deleted to make room. The cause of the original database corruption is
not established by these logs; the confirmed failure is its unhandled restoration error.

## 2026-09-16: corruption first observed during background reconciliation

Status: recovery extended; code verified, owner runtime testing pending.

Ral's copied error at 09:14:53.395Z matches DEBUG_PROD diagnostics: warm SQLite open and root
listing succeed, `candidate-backup mode=backup` finishes at 09:14:49.850Z, then initialization
fails at 09:14:52.794Z with `phase=rebuild sqliteCode=11`. The background failure is generalized
to `OPERATION_FAILED`. The precise damaged table and original cause of corruption are not yet
known. This is independent of the Tab Alias Vite CSP failure reported in the same session.

The current recovery wrapper covers SQLite open and tree restoration only. Backup/candidate
open/reconciliation run outside that wrapper, so corruption first accessed there is never repaired.

Extend recovery narrowly: an explicit SQLite corruption error during a warm candidate build may
retry once with a fresh candidate. Keep the current seed untouched until the fresh candidate has
completed. Under the existing reader-drain/promotion gate, preserve the suspect previous database
in quarantine instead of removing it. Quarantine failure must use the existing promotion rollback;
a failed fresh build, cancellation, ordinary I/O error or promotion failure must propagate without
another recovery attempt. Preserve healthy warm reconciliation and user project/configuration data.

Verify with a real small SQLite fixture whose tree is readable but content reconciliation is
corrupt, plus failure/cancellation/rollback tests. Keep the identical CoWork core aligned after
checking its current state. Do not repair a running user profile directly or launch Electron/E2E.

The implemented candidate retry covers backup, candidate open and traversal only. Promotion
errors do not retry. Recovery moves any surviving SQLite sidecars with the suspect database and
uses a `.recovery-<UUID>` predecessor outside ordinary interrupted-candidate cleanup, then
quarantines it after the replacement validates. A failed rebuild leaves the seed in place.

Verification: BL's focused corruption/recovery and query/promotion lifecycle suites pass (44
tests); the mirrored CoWork corruption/recovery suites pass (19 tests). The four corresponding
core/test files remain identical. Syntax checks and `git diff --check` pass. No live search-index
database was changed, and Electron/E2E was not run.

Ral's acceptance: restart `yarn dev:prod`, reopen the previously failing Project, wait for indexing
to finish, then search for a known filename and known file content and open a result. Confirm no
`OPERATION_FAILED` banner; on another restart confirm the healthy index is reused without another
corruption recovery. A full rebuild's duration depends on that Project's size and contents.
