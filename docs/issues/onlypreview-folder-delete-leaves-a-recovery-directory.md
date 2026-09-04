# OnlyPreview — deleting folders fails and leaves a `.bitterless-delete-recovery-*` directory behind

- Status: fixed, awaiting owner verification
- Found: 2026-09-04, owner report against `tmp/archtest` (three folders selected, Delete)
- Severity: multi-select delete unusable, and every failure littered the project with a
  visible directory the owner had not created

Owner report, verbatim:

> 1. delete 多个文件报错 `/Users/ral/Documents/projects/overmind/tmp/archtest/out-yes` 选中他们 3 个 delete 报错
> 4. `…/tmp/archtest/.bitterless-delete-recovery-4d321d88-…` 这时什么鬼，产生了极大困扰，不应该出现

Four more items from the same report are covered here because they are one change:
the still-present selected-row rail, detached DevTools for the shell view, and Reveal in folder
moving above Delete.

## 1 · A folder delete could never succeed

`commitDelete` in `src/preload/fileSearch/fileSearchProjectAuthority.service.ts` runs an
identity-pinning sequence around the removal:

```text
pin  →  isolate (rename into .bitterless-delete-recovery-<uuid>)  →  re-check  →  remove
```

`requirePinnedDeleteIdentity` compares the grant's recorded `dev`/`ino` against a fresh `lstat`
**of the original path**. It ran a second time after the isolate rename — at which point the
original path is gone by design, so the `lstat` raised `ENOENT` on every single folder delete.

A file survived this by accident: its grant holds an open `FileHandle`, and `handle.stat()` follows
the descriptor rather than the path, so the file branch never touched the vanished name. A folder
has no descriptor to hold, so it always took the path branch and always failed.

The post-isolate check now reads the isolated path:

```ts
await this.requirePinnedDeleteIdentity(prepared, { isolated: true });
```

## 2 · The recovery directory outlived the failure

The recovery directory was removed only on the success path. Because §1 made folder deletes fail
100% of the time, every attempt left one in the project — which is exactly what the owner saw.

Cleanup now runs in the failure path too, next to the restore:

```ts
if (isolated) {
  await this.restoreIsolatedDeleteEntry(isolated, prepared?.nodeKind ?? 'file');
  await this.fileOperations.rmdir(isolated.directoryPath).catch(() => undefined);
}
```

`rmdir`, deliberately, and not a recursive remove: if the restore itself failed, the isolated entry
is the owner's only remaining copy of their data. An empty-directory-only removal cannot destroy it.
A recovery directory that survives now means a restore failed, which is worth seeing.

## 3 · The selected row still had a right-hand rail

The rail the owner asked twice to remove was **not** the preview marker but a pre-existing
`::after` pseudo-element on the selected row itself, in
`src/renderer/onlypreview/shell/src/App.less`:

```less
.onlypreview-shell__tree-row--selected::after {
  content: ''; width: 3px; height: 15px; margin-left: auto;
  border-radius: 2px; background: var(--onlypreview-royal);
}
```

Removed. Its source guard now asserts the absence rather than the presence.

## 4 · The shell view had no DevTools

Only the preview and alert views opened DevTools under `isOnlyPreviewDevToolsEnabled()`. The shell
view — the Project tree, where every issue in this report lives — had none, so a renderer error had
no console. It now opens detached and inactive, so it never steals focus from the window.

## 5 · Reveal in folder sat below Delete

Destructive actions belong at the end of a menu. Reveal in folder now sits immediately above Delete.

## Verification

`tests/onlypreview/onlyPreviewProjectAuthority.test.mjs` gains two real-filesystem tests:

- a nested folder is deleted for real, and no `.bitterless-delete-recovery-*` entry remains
- a delete that fails **after** isolation (injected through the `removeTree` seam, the only point
  where a recovery directory exists at all) restores the folder and still cleans up

Both would have failed before this change: the first at the post-isolate `lstat`, the second by
leaving the recovery directory behind.
