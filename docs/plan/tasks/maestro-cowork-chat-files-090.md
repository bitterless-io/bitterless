---
id: maestro-cowork-chat-files-090
scope: Maestro unified attachment cards, directories, thumbnails, archives, and bundled-CLI document reading
status: pending
depends-on: [maestro-cowork-chat-core-089]
verify: source inspection, task-scoped diff check, independent review; no tests/typecheck/lint/build/Electron/E2E/network
---

# Migrate current Cowork chat file capabilities into Maestro

## Objective

Backport Cowork `67b056b` attachment and file-reading behavior after the Turn/task message model is
in place, using Maestro names, data paths, packaging, and visual contracts.

## Context

- `docs/plan/analysis/maestro-cowork-chat-parity.md`
- `docs/issues/maestro-control-chat-behind-cowork.md`
- `docs/plan/tasks/maestro-cowork-chat-core-089.md`
- Cowork `docs/features/{agent-folder-attachments,agent-archives,agent-file-reading}.md`

## Path

- `src/renderer/maestro/control/src/{AttachmentCard,ChatPanel,MessageItem,MessageList}.{vue,less}`
- `src/renderer/maestro/control/src/store/{message.store,message.type}.ts`
- `src/shared/maestro/{coach,maestroChat}.api.ts`
- `src/main/maestro/files/{thumbnail,archive,anydoc.service,fileReader}.ts`
- `src/main/maestro/agent/{BaseAgent,maestroAgent.service,hostToolCatalog,tools/**,prompt/**}`
- `src/main/maestro/windows/main/{workspaceFile.service,maestroWindow.controller}.ts`
- `src/main/maestro/xpc/coach.handler.ts`
- `electron.vite.config.ts`, `electron-builder*.yml`, `package.json`, `yarn.lock`, and Maestro runtime
  staging/packaging scripts only where required by anydoc or archive tools

## Contract

- Use one AttachmentCard for pending inputs, sent attachments, and assistant artifacts. Its fixed
  52px row uses a directory icon first, then a bounded image thumbnail, then an extension label;
  missing entries have explicit text and attachment rails scroll horizontally.
- Preserve `isDirectory` through file status, attach result, renderer state, prompt construction,
  and JSON persistence. Directories do not consume media-reference or byte-upload quotas.
- Finder/Explorer clipboard file paths and directories use the path lane; pasted screenshots retain
  the existing materialized-image lane. Stage results match inputs by index and expose each failure.
- Directory list/search results outside the workspace remain absolute so `read_file` resolves the
  same entry. Absolute local Markdown links reveal in Finder/Explorer; `http(s)` remains normal.
- Thumbnails are UI-only, source-bounded, dimension-bounded, and data-URL-bounded.
- Add archive list/extract/create tools with reads restricted to approved locations and writes
  restricted to the explicit workspace or a safe session directory under `maestroDataRoot()`.
  Keep the archive ceiling separate from the ordinary attachment ceiling. Reject password-protected
  creation, never place supplied passwords in child-process arguments, and retain path traversal
  protection.
- Run anydoc as a version-pinned, platform-staged CLI bundle following the existing `rg` model. The
  staged directory contains the official `cli.js`/loader files and exactly one verified native
  binding; Main launches it out of process with Electron's Node mode, a 30-second timeout, bounded
  stdout/stderr, and local-only OCR rejection. Do not add `@firecrawl/anydoc` or
  `@firecrawl/anydoc-wasm` as an application dependency, do not add a UtilityProcess/Vite worker,
  and do not download at runtime. Preserve text/CSV line numbering and unknown-extension UTF-8
  sniffing. Do not remove existing document dependencies until all other consumers are audited.
- Add the safe activity target label from Cowork while retaining its denylist and length cap.
- Do not copy Cowork captureDisk, bun/rg/fd staging, skill runner, hardening/fuses, standalone app
  bootstrap, Connector/Demo/CRMS, or unrelated browser/system-prompt changes.
- Preserve unrelated current-worktree changes.

## Verification

- Inspect attachment, directory, thumbnail, archive, and anydoc CLI calls from renderer contract
  through Main and packaging.
- Specifically review archive password transport, destination boundaries, utility-process resource
  paths, anydoc platform/checksum mapping, old persisted-row compatibility, and the three
  AttachmentCard call sites.
- Run task-scoped `git diff --check` and an independent source review for P1/P2 defects.
- Do not run tests, typecheck, lint, build, Electron, Playwright/E2E, application launch, or network
  probes. Ral performs E2E after handoff.
