# A failed skill cloud sync kills every chat message

Status: Implemented and source verified; owner application testing pending. Reported 2026-09-22 against
**micromeet-cowork** in production (Ral, with a screenshot); bitterless carries the same defect, so it is
fixed here under the paired-development rule. Canonical write-up with the production evidence:
`micromeet-cowork/docs/issues/skill-cloud-sync-failure-blocks-chat.md`. Related:
[no-authorized-institution-blocks-chat-and-skills](../../../micromeet-cowork/docs/issues/no-authorized-institution-blocks-chat-and-skills.md)
(the authorization half of the same bug — bitterless was already correct there),
[Skills 三层来源与实时上下文设计](../features/skills-three-sources.md) #3/#4.

## Owner direction (2026-09-22)

Ral: 「cowork 聊天不依赖于技能同步成功，没同步应该也能跑，因为 dev 有机构技能拉取功能，但是 cowork 生产版暂时没有，
但是还是得能正常运行」 — chat must not depend on skill synchronization succeeding.

## The defect

`SkillCloudService.ensureCatalog()` threw whenever the first cloud sync had ended in `error`:

```ts
if (this.options.institution() && !this.initialized && this.status === 'error') throw new Error('The institution Skills catalog is not ready: ' + this.error)
```

All three callers are on the chat path — `maestroAgent.service.ts:1162` (context export), `:2085` (chat
send), `:2107` (prepared turn). So one bad round trip — offline, a 5xx, a rejected archive, a checksum
mismatch — took down **every** message, not just institution skills.

In Cowork the same shape had a permanent trigger: production Core does not acknowledge `scope=` on
`/skill/catalog`, so the sync could never succeed and chat was dead for as long as that server was
deployed. bitterless talks to its own backend and does not hit that specific mismatch, but the failure
mode is identical for any first-sync error.

## Why degrading is safe

A cloud round trip proves **freshness**, not authorization:

- An authoritative denial (401/403) sets `status = 'unauthorized'` and calls `resetAuthorization`, which
  clears the host fence so `institution()` goes null and the institution root drops out of the catalog.
  That is the mechanism that actually removes institution skills, and it is untouched.
- `status = 'error'` means stale. Packages on disk were verified when installed (hash + immutable
  version + atomic activation), and the scoped root is still `<accountScope>/<institutionId>`.
- Global and Workspace skills need no network at all, and #4 already says
  「全局、工作区和聊天不等待机构网络请求」.

## Fix

`ensureCatalog()` refreshes when the catalog has never run and otherwise **reports**. Workbench loses
nothing: `skill.service.ts#skillCatalog` already returns `cloudStatus` and `cloudError` on the snapshot.

A settled `error` status deliberately does not re-run per call — retrying a broken server once per message
would trade a dead chat for a slow one. The 60 s timer, `browser-window-focus`, and session/scope changes
own recovery. The now write-only `initialized` field went with the throw.

## Verification

- `tests/skillScopes/cloudSyncFailure.test.mjs` (new): a transport failure and a 500 both leave the turn
  runnable and the institution authorized; the failing server is not re-asked on the next message; a 403
  still drops the institution.
- `tests/skillScopes/institutionAuthFailure.test.mjs`: the case that asserted the old blocking contract now
  asserts the corrected one, with the reasoning inline.
- `yarn test:skill-scopes`: 45/46. The one failure,
  `actual file search never returns earlier private hits after logout during a later read`
  (`execution.test.mjs`), **reproduces on a clean tree** and is unrelated to this change.
- E2E not run (workspace rule: never launch Electron E2E unprompted).
