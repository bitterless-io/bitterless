---
id: eyes-on-agents-unknown-dot-session-path-066
scope: show the unread dot for authority-lost rows, and replace transcript preview with copying the session file path
status: implemented; owner verification pending
depends-on: [eyes-on-agents-manual-read-state-063]
---

# EyesOnAgents Unknown Dot and Session Path

## Objective

Two changes to the thread card:

1. Fix [the restart pinning issue](../../issues/eyes-on-agents-restart-unknown-pinned.md) with its
   option **A**: any non-active unread row shows the unread dot, so an `unknown` row promoted to the
   unread tier finally explains its own position.
2. Retire **Preview transcript** from the overflow menu and put **Copy session path** in its place,
   which copies the absolute path of the session's JSONL file.

## Context

- [A restarted working thread stays pinned with no visible reason](../../issues/eyes-on-agents-restart-unknown-pinned.md)
- [Manual read state](eyes-on-agents-manual-read-state-063.md) — the menu this edits
- [EyesOnAgents Claude observation](../../features/eyes-on-agents-claude-observation.md) — where the
  transcript path comes from

## Required behavior

### Unread dot

- `showUnreadDot` becomes `isUnread && !isActiveRuntime`: working and waiting rows still show only
  their spinner, while `idle`, `failed`, `ended`, **and `unknown`** show the dot when unread.
- Nothing else about attention changes: ranks, `Read all` eligibility, the latent-marker rule, and the
  completion alert are untouched. This is presentation only.
- Accept the cost stated in the issue: a completed-unread row and an authority-lost unread row now
  look the same. The alternative — a second glyph for `unknown` — stays available if that turns out to
  matter.

### Copy session path

- The overflow menu item **Copy session path** copies the absolute path of the session JSONL to the
  clipboard through the existing main-process clipboard dependency, the same way
  `Copy /reload-plugins` already works.
- The path is validated before it is copied, reusing the transcript validator that checks the file
  belongs to the expected thread ID, so a stale or mismatched row cannot leak an unrelated path.
- The item appears only when the snapshot says a path exists. Today that is Claude rows with a known
  transcript: the app never discovers Codex rollout files, so a Codex row has no path to copy and the
  item is omitted rather than shown broken.
- The snapshot field is renamed from `canPreviewTranscript` to `canCopySessionPath`, because that is
  what it now gates. It keeps the same derivation (`provider = 'claude' AND transcript_path IS NOT
  NULL`) and the same `transcript_path` column.
- `Preview transcript` leaves the renderer entirely: the menu item, the store's `previewThread`
  action, and `previewingSessionKeys`. The Main/XPC preview capability stays in place but unexposed,
  like the retained Domain and Project plumbing, so restoring it is cheap.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/issues/eyes-on-agents-restart-unknown-pinned.md`
- `docs/plan/README.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/thread-card-open-capability.test.mjs`
- `scripts/eyes-on-agents/focus-board-store.test.mjs`
- `scripts/eyes-on-agents/claude-provider-snapshot-race.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:node` and `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents`
- `yarn check:renderer-i18n`
- `yarn build`
- Rendered-DOM coverage: an `unknown` unread row shows exactly one dot and no spinner; the copy item
  appears only with a path and calls the store with the session key; no preview symbol remains.

## Result

Implemented.

The dot rule is now one predicate — `isUnread && !isActiveRuntime` — so the intersection that produced
the unexplained pinned card (`unknown` + unread, failing both indicator gates) cannot happen again.
The rendered-DOM suite pins it: an `unknown` unread row renders one dot and no spinner, while
working/waiting rows still render a spinner and no dot.

`copySessionPath` runs through the Claude bridge-lifecycle wrapper, requires the provider to be
enabled, reads `transcript_path` via the existing `getClaudeOpenTarget` query, validates it against
the thread ID with `validateClaudeTranscript`, and writes it with `writeClipboardText`. The renderer
short-circuits when `canCopySessionPath` is false, so it never asks for a path the snapshot says does
not exist.

Two deliberate scope calls:

- **Claude only.** `transcript_path` is a Claude column; nothing in the app resolves Codex rollout
  JSONL files, so the item is simply absent on Codex rows. Adding Codex path discovery would be its
  own task.
- **Copies the file path, not its directory.** The owner asked for "会话 jsonl 的绝对目录"; the useful
  paste target is the file itself, so that is what lands on the clipboard. Switching to the containing
  directory is a one-line change if wanted.

Also cleaned up with the change: the store's `previewThread` and `previewingSessionKeys` are gone
because nothing could reach them any more; Main keeps its preview capability unexposed.

Verified: `yarn typecheck:node`, `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents`
(70 UI assertions plus every core/repository/bridge/Claude suite), `yarn check:renderer-i18n`,
`yarn build`. Electron E2E not run.
