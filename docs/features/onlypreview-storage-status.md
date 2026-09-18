# OnlyPreview footer — disk free and index size

Status: proposed. Owner request, 2026-09-18:

> bl cowork onlypreview footer 右下角需要展示 userdata 目录所在磁盘的剩余空间，以及 index 文件占用空间

Applies to **both** BL and micromeet-cowork; the shell is vendored.

## Why this earns a permanent place in the chrome

This is the instrument for the failure that broke search on 2026-09-17. The index needs roughly
**twice its own size** in free disk to reconcile (`backup()` copies the whole database before the
rebuild), the caches never evicted, and three editions reached 24.5 GB on a 926 GB volume with
881 MiB left. None of that was visible anywhere until the disk was already full. Task 183 made the
build refuse rather than fill the volume; this makes the two numbers that decide it readable before
they matter.

The two numbers are deliberately the pair, not one of them:

- **Free space on the volume holding `userData`** — the denominator. Not the volume the *workspace*
  is on; the index is written beside the app's data, and that is the disk that runs out.
- **Index size** — the numerator, and the part OnlyPreview is responsible for. Seeing 16 GB there is
  the whole point.

## Placement

The status rail is already `justify-content: space-between`: breadcrumb left, file-state cluster
right. The storage pair joins the **right** cluster, after the file state.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ project / src / main.ts            1,204 chars · TypeScript · 18 KB   12.4 GB free · 5.6 GB index │
└──────────────────────────────────────────────────────────────────────────────┘
```

- It shows **whether or not a file is previewed** — the file-state cluster is conditional on a
  preview; this is not. A workspace with nothing open is exactly when someone checks the disk.
- It is text in the existing muted status style, not a control and not a meter. No border, no
  background — the rail has neither today.
- `title` carries the full sentence for a narrow window, where the rail already truncates.

## Where the numbers come from

Main owns both, because Main is what knows `userData`:

```text
free  = statfs(userData).bavail * bsize
index = Σ file sizes under <userData>/onlypreview/search-index-v6
```

- The index directory is the one `onlyPreviewSearchBootstrap.registry.ts` writes into
  (`join(userDataPath, 'onlypreview', 'search-index-v6', …)`), and it holds **every workspace's**
  database, not just the open one. That total is the number that matters, and it is the number that
  reached 16 GB.
- One level of files, summed by `stat`. On the reference machine that is ~70 entries, so it is a
  cheap call — but it is still filesystem work, so it is **cached with a short TTL** and never
  computed per render.
- A missing directory is `0 bytes`, not an error: a fresh install has no index yet.

## Refresh

- Once when the shell mounts.
- On an interval while the OnlyPreview surface is visible. The index only changes size during a
  build, and a build is minutes, so the interval is coarse (30s) rather than live. A footer that
  updates every second would cost more than it tells anyone.
- The interval stops when the surface is hidden or unmounted. This is a status readout, not a
  monitor; it must not keep a timer alive behind a closed window.

Failure is silent: if the read throws, the pair keeps its last values, and shows nothing at all
before its first successful read. A footer that renders an error is worse than a footer that renders
nothing.

## Verification

- Main service: free bytes come from `statfs` of the userData path; index bytes sum the directory
  and return 0 when it is absent; the TTL actually suppresses a second filesystem walk.
- The XPC method requires a host capability like every other, and returns only two numbers — no
  paths cross the boundary.
- Renderer: the pair renders with no preview open; the interval is cleared on unmount; a failed read
  leaves the previous values in place.
- Both catalogs carry the label, and the compiled CSS shows no border or background on the element.
- No Electron/E2E.
