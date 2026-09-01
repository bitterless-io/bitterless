# OnlyPreview external file open replaces the current Project

Status: implemented; owner verification pending

## Problem

`preview.open`, Finder/Explorer file-open, and the development CLI route currently treat every
regular file as a new Project: OnlyPreview derives the file's parent directory, replaces the
current Project, and selects the file's basename in the tree. That is wrong for a one-off file
outside the Project the user is already browsing.

The portable Preview skill also needs to hand Bitterless an explicit file from anywhere on the
machine. Project membership must not be a prerequisite for read-only preview.

## Accepted correction

```text
current Project: /work/project-a              explicit target: /tmp/report.pdf

Project tree                                  Preview
/work/project-a                               report.pdf
  src/                                        (read-only external file)
  docs/
  README.md
  no selected row
```

- A directory target still becomes the current Project.
- A file inside the current Project uses that Project capability and becomes the selected tree
  item.
- A file outside the current Project preserves the current Project, clears its tree selection, and
  opens the external file in the Preview region through a separate host-bound, read-only authority.
- With no current Project, an external file opens with an empty Project surface and no selected
  item.
- External-file authority is never persisted as the recent Project and never exposes an absolute
  path to a visible renderer. A later Project selection, directory open, external-file open, host
  close, auth invalidation, or app quit revokes/supersedes it.
- The production `bitterless` MCP `preview.open({ path })`, macOS `open-file`, packaged Windows
  targets, and the explicit `--onlypreview-open=<absolute-path>` route share this behavior.

## Acceptance

- Opening a file outside Project A leaves Project A visible and unselected while Preview renders
  the requested file.
- Opening a file inside Project A selects its Project-relative row and renders it.
- Opening a directory replaces the Project and clears Preview as before.
- A cold external-file open cannot be overwritten by recent-Project restore.
- Renderers receive opaque workspace/file references and bounded metadata only; no new broad
  filesystem API or absolute-path payload is introduced.

## Resolution

[Task 098](../plan/tasks/onlypreview-external-file-preview-098.md) implements this contract;
[independent review 1](../plan/reviews/onlypreview-external-file-preview-098-1.md) passed after the
explicit-open FIFO, revoke fence, and exact-file reader boundary were independently hardened.
