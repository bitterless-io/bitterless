# Maestro Control chat is behind current Cowork

Status: implemented; owner verification pending

## Observed behavior

Maestro Control still uses the pre-Turn chat state and older attachment presentation. Compared with
Cowork `67b056b`, an active reply locks the composer, response/task/confirmation state is not
anchored near the composer, long tool activity remains inside one reply bubble, folders and archives
are not first-class attachments, and file-reading behavior differs across the two forks.

Copying Cowork's renderer files alone cannot fix this. The current behavior depends on shared XPC
contracts, Main agent/runtime policy, task persistence, workspace path rules, thumbnail/archive
services, and the document-conversion runtime.

## Required behavior

- Use a per-session Turn with lazy assistant segments and inactivity-based timeout handling.
- Let text and voice steer the active turn while Stop remains available. Keep attachments,
  workspace mutation, provider/model/effort selection, and new-session actions locked while active.
- Keep response/retry/task state and pending confirmation actions immediately above the composer.
- Store tasks and confirmations as independent chronological messages.
- Use one bounded attachment-card component for composer inputs, sent files, and assistant artifacts.
- Preserve directories through attach/status/persistence/prompt paths; show bounded image thumbnails
  and explicit per-entry attachment failures.
- Add archive and isolated document-reading support without weakening workspace or packaging bounds.
- Preserve Maestro replay, i18n, Local/Claude provider configuration, Royal Blue Arco/BEM styling,
  fixed local Home, and existing compatibility identifiers.
- Do not reintroduce Connector, Demo, AI-CRMS fixed-tab/login/profile UI, Cowork's standalone shell,
  or Tailwind styles.
- Preserve Maestro's currently deferred context-compaction implementation; Cowork's five-segment
  replacement remains outside this migration until its own acceptance contract is complete.

## Acceptance

The complete renderer → shared contract → Main/XPC → persistence/runtime call chains are present,
the exclusions remain absent, and an independent source review finds no unresolved P1/P2 defects.
Ral performs Electron E2E and visual/runtime acceptance.

Implementation tasks:

- [maestro-cowork-chat-core-089](../plan/tasks/maestro-cowork-chat-core-089.md)
- [maestro-cowork-chat-files-090](../plan/tasks/maestro-cowork-chat-files-090.md)

## Resolution

Both vertical slices are implemented. The core review and file/archive/anydoc review report no
unresolved P0-P2 findings:

- [core review 1](../plan/reviews/maestro-cowork-chat-core-089-1.md)
- [files review 1](../plan/reviews/maestro-cowork-chat-files-090-1.md)

Static source and diff inspection is complete. Tests, typecheck, lint, build, Electron/Playwright
E2E, application launch, staging scripts, and runtime/network checks were intentionally not run;
Ral owns runtime and visual acceptance.
