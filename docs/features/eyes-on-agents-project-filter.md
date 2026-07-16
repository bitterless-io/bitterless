# EyesOnAgents Project Filter

Status: implemented and locally verified

Date: 2026-07-16

## Decision

Add a source filter inside the system `Uncategorized` Domain so Project work can be separated from
threads that have no known Git Project. Project is derived metadata; it is not a Domain, never
creates a Domain, and never changes `domain_id`.

Codex App Server does not expose a Project catalog. EyesOnAgents therefore defines a Project as the
nearest current Git worktree root found by walking upward from a thread's `cwd`.

## User-visible contract

```text
┌ Uncategorized ───────────────────┐
│ 4 of 18 threads                  │
│ [ Project: overmind (4)       ▾ ]│
│                                  │
│ thread item                      │
│ thread item                      │
└──────────────────────────────────┘

Filter choices:
  All (18)
  No project (6)
  bitterless (3)
  overmind (4)
  ...
```

- The control appears only in `Uncategorized`.
- `All` shows every Uncategorized thread.
- `No project` shows threads without a known current Git worktree root.
- Each Project option filters by its stable `project_key` and shows its Uncategorized count.
- Project options are sorted by display name, then root. Same-named Projects show a shortened root
  to disambiguate them.
- While filtered, the column count is `{visible} of {total} threads`; `All` keeps the existing total
  count.
- The selected filter is renderer-session state and is not written to SQLite settings.
- If the last matching thread leaves `Uncategorized`, the selected option remains visible with zero
  results until the user changes the filter. This makes a drag result explicit.
- Focus and every custom Domain remain unfiltered.

`No project` is deliberately not a promise about conversational intent. A normal conversation
started inside a Git worktree belongs to that Project, while a code task started in a non-Git
folder has no known Project.

## Project resolution

The main process resolves Project metadata without invoking a shell or `git`:

1. Missing, non-absolute, inaccessible, or non-directory `cwd` is `unavailable`.
2. Resolve `cwd` through the native realpath implementation.
3. Walk toward the volume root; the nearest valid `.git` directory or bounded `gitdir:` file wins.
4. Reaching the volume root without a marker is confirmed `none`.
5. Preserve the native canonical root for display. Build `project_key` by normalizing Unicode,
   separators, and trailing separators; compare Windows keys case-insensitively.
6. Cache results only within one Sync pass so a later Sync can observe a newly created, moved, or
   removed worktree.

Resolution has three outcomes:

| outcome | repository update |
|---|---|
| `project` | write all Project metadata fields |
| `none` | explicitly clear all Project metadata fields |
| `unavailable` | preserve prior Project metadata; a new row remains unknown/no Project |

App Server lifecycle notifications without `cwd` preserve existing metadata. Trusted Codex hook
events include `cwd`, so a hook-discovered thread is classified without waiting for the next Sync.

## Storage contract

`eyes_on_agents_thread` adds three nullable text columns:

| column | meaning |
|---|---|
| `project_key` | normalized Project identity used only for grouping/filtering |
| `project_root` | canonical native worktree root for display and disambiguation |
| `project_name` | basename of the root for a compact label |

The fields must be either all null or all non-null. Existing databases receive an idempotent
migration; legacy rows remain null until current evidence classifies them. Project changes never
modify the manually assigned Domain.

## States and recovery

| state | behavior |
|---|---|
| no Uncategorized threads | filter remains reachable; existing empty Domain message is shown |
| `All` selected | total count and all Uncategorized threads |
| `No project` selected | only rows whose Project metadata is null |
| Project selected, zero results | `0 of {total}` plus a Project-specific empty message |
| duplicate Project names | shortened roots disambiguate options |
| Project lookup unavailable | last known metadata is preserved; no sync failure is raised |
| Project path later changes | the next Sync recomputes and updates only Project metadata |

The Select uses a background-led Todo-style surface without a decorative border, supports search,
has a visible focus outline, and exposes an explicit accessible label.

## Privacy boundary

Project discovery reads only path metadata and the bounded `.git` marker needed to identify a
worktree. It never reads repository content, remotes, prompts, transcripts, diffs, or credentials.

## Acceptance criteria

- A repo root, child directory, nested repo, symlinked cwd, and `.git` worktree file resolve to the
  correct nearest Project.
- A valid non-Git cwd is `No project`; unavailable paths preserve prior metadata.
- Project metadata survives SQLite restart and updates without changing Domain assignment.
- `Uncategorized` supports `All`, `No project`, and per-Project filtering with truthful counts and
  empty states.
- Focus and custom Domain contents are unchanged by the filter.
- macOS and Windows path normalization is covered by tests.
