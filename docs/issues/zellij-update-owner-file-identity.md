# Issue — Zellij owner identity survives application updates

**Status:** Implemented; isolated native ownership/session checks passed. Packaged update acceptance remains with Ral.
**Date:** 2026-09-17
**Scope:** macOS native Zellij ownership, persistence and explicit close.

## Contract

Application exit retains native sessions. An explicit tab close ends only the session whose owner
this application can still verify. Updating or moving the application must not invalidate a recorded,
still-running native daemon.

A path identifies a location; a filesystem device/inode pair identifies the file currently mapped
into a process. Updates can rename the old bundle and replace the original location with another
binary. The recorded daemon must therefore be matched to its original mapped file, not the new file
at the original path.

- Initial adoption still requires the expected bundled executable's exact resolved path, its file
  device/inode, expected server arguments, process UID, and the socket's device/inode/UID.
- Read the first `txt` mapping from kernel-backed `lsof -F0pfnDi` output. A later library/data mapping
  of the bundled executable never proves ownership. Parse fields by their identifiers and require
  safe, non-negative device and positive inode integers.
- Persist `executableDevice` and `executableInode` together. During subsequent checks, compare them
  directly with the process's first mapped image, without resolving or statting its old path.
  PID birth time, UID, exact recorded arguments and socket checks remain mandatory.
- `executable` retains the original absolute path as diagnostic provenance for new records; changing
  only that string is not evidence of a different mapped image. Changing either mapped file ID is.
- A complete malformed pair or a partial pair is unknown ownership, never a legacy downgrade.
  Legacy records with neither field retain the strict resolved-path check. Unrecorded old daemons
  are not adopted merely because their path resembles an updater's temporary directory.
- Recorded ownership is checked before sending `KillSession`. A recorded mismatch cannot be
  bypassed by freshly adopting the same pathname. Forced signals retain the no-child-process and
  repeated owner/socket verification guards.

Device/inode values are not cryptographic or unforgeable. The existing app-owned userData record
remains the trust boundary. The process retains the mapped file while alive, so renames and unlinking
the old bundle do not require access to that path. Missing/ambiguous kernel evidence remains an error,
not proof the daemon died.

## Verification

Isolated tests cover exact initial adoption, first-image selection and field parsing, successive
renames and unlinking a copied fixture executable, wrong image/UID/argv, PID reuse/death, malformed
records, legacy paths, and refusing destructive close before ownership is verified. Existing native
lifecycle tests cover explicit close, half-shutdown cleanup, restart, and sibling isolation.

2026-09-17: 14 owner cases, 5 existing native lifecycle cases and 12 persistence/close cases passed (31 total).

The copied executable regression permits 15 seconds for its own first macOS launch; this does not change product startup deadlines.

No Electron E2E, real app, real Claude session, or existing user daemon is launched or modified.

