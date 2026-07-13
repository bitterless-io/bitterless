---
status: completed
verify:
  - yarn build
---

# Remove FS Window

## Goal

Remove the unused FS background window and its standalone XPC file-system handler.

## Scope

- Remove FS window startup, cleanup, and authentication-session preservation.
- Remove FS preload and renderer build entries.
- Delete the unused FS window, preload handler, and renderer files.
- Keep the SQLite background window and its authentication lifecycle unchanged.

## Verification

- `yarn build` passes without an FS preload or renderer entry.
- No FS window/helper references remain in the source tree.
- The build output contains neither `out/preload/fs.js` nor `out/renderer/fs`.
