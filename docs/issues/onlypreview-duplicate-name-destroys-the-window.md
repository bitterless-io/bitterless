# OnlyPreview — a duplicate folder name destroys the window instead of reporting a conflict

- Status: fixed, awaiting owner verification
- Found: 2026-09-03, while building the alert-layer conflict dialog
  ([onlypreview-alert-dialogs](../features/onlypreview-alert-dialogs.md))
- Severity: the whole OnlyPreview window is torn down

## Symptom

Creating a folder whose name is already taken, or renaming an item onto an existing name, does not
show a conflict message. The file-search runtime stops and the OnlyPreview window is destroyed.

## Root cause

`src/main/fileSearch/fileSearchProjectAuthorityResponse.service.ts` holds the allowlist of error
codes the hidden `fileSearch` preload authority may report back to Main:

```ts
const PROJECT_AUTHORITY_ERROR_CODES = new Set<OnlyPreviewErrorCode>([
  'INVALID_INPUT', 'WORKSPACE_ACCESS_DENIED', 'PATH_NOT_FOUND', 'PATH_PERMISSION_DENIED',
  'PATH_OUTSIDE_WORKSPACE', 'PATH_NOT_REGULAR_FILE', 'PATH_UNSUPPORTED_DEVICE', 'OPERATION_FAILED'
]);
```

`NAME_EXISTS` and `NAME_INVALID` are missing, and both are ordinary outcomes of the two authoring
operations:

- `createDirectory` uses a non-recursive `mkdir` as its atomic collision check and maps `EEXIST` to
  `OnlyPreviewContractError('NAME_EXISTS', 'An item with this name already exists in this folder.')`
  (`src/preload/fileSearch/fileSearchProjectAuthority.service.ts`).
- `renameEntry` compares the destination's `dev`/`ino` against the item's and raises the same
  `NAME_EXISTS` for a *different* entry.
- `requireValidEntryName` raises `NAME_INVALID` as the last check before the syscall.

`toSafeProjectError` rethrows an `OnlyPreviewContractError` unchanged, so the response reaches Main
as `{ ok: false, error: { code: 'NAME_EXISTS', … } }`. A code outside the allowlist is not read as a
failed operation — it is read as the authority having **violated its private protocol**:

```text
unwrapOnlyPreviewProjectAuthorityResponse → OnlyPreviewProjectAuthorityProtocolError
  → callProjectAuthority catch → rejectProjectProtocol
      → this.stop()  +  privilegedRuntimeFatal()   ← the runtime and the window go
```

So the check that exists to catch a *compromised* authority fires on the most ordinary user mistake
there is: typing a name that already exists.

Both messages are path-free and under the 240-character bound, so the rest of the protocol check
already passes them; only the code was refused.

## Why it was never caught

`createUntitledProjectFolder` in Main loops `untitled folder`, `untitled folder 2`, … by catching
`NAME_EXISTS` — a loop that cannot ever have advanced. A project whose first folder creation was
always into a directory with no `untitled folder` in it never reaches the second iteration, and the
automated suites exercise the preload authority and Main separately, so no test carries a real
`NAME_EXISTS` across that boundary.

The rename path has a fully written duplicate-name dialog (`showRenameFailure`, with
`renameExistsMessage` localized in both catalogs) that could not have been reachable.

## Fix

`NAME_INVALID` and `NAME_EXISTS` are added to `PROJECT_AUTHORITY_ERROR_CODES`. They are authoring
outcomes, not protocol violations, so they now surface as typed failures: the untitled sequence
advances, the rename dialog appears, and the new-folder conflict reaches the alert error dialog.

The allowlist keeps its purpose — an authority reporting a code outside the set, or a message
carrying a path, still tears the runtime down.

## Verification

- `tests/onlypreview/onlyPreviewProjectAuthorityCodes.test.mjs` — a `NAME_EXISTS` response unwraps to
  a typed `OnlyPreviewContractError` and not to `OnlyPreviewProjectAuthorityProtocolError`; a code
  outside the set still raises the protocol error.
- Owner check: create a folder in a directory that already contains `untitled folder`, and rename an
  item onto a sibling's name. Both must report a conflict and leave the window open.
