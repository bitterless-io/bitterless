# One home data root, created at boot

Date: 2026-09-20. Status: implemented, code-verified; owner verification pending.
Owner request (Ral 2026-09-20):「~ 下的 data 目录应该通过 pathhelper 通用的方式获取,review 一下其他
地方也用到了,如 global skills 应该通过统一的方式配置目录,例如现在我在 workflows 目录下看不到 skills
目录,首先这些目录都需要 ensure 的」, and on which shape is authoritative:「cowork 的环境目录设计对的,
以此为准」. Paired with micromeet-cowork.

## The problem

Three features each answered "where does my data live" on their own:

| | before |
| --- | --- |
| default workspace | `~/.bitterless{env}/default_workspace` |
| workflows | `~/.bitterless{env}/workflows` |
| global skills | `<userData>/cowork/skills` |

The first two duplicated the same root expression; the third was somewhere else entirely. Opening
the root told you nothing about where the rest of the app's data was — which is exactly how "I look
in the workflows folder and there is no skills folder next to it" happens.

## Contract

- **`src/main/paths/appData.ts` is the only module that resolves a home-level data path.** It owns
  the root, the list of directories under it, and their creation.
- **Root:** `~/.<appName lowercased>` — one directory per edition. The root is still *derived* from
  the runtime profile's `appName` rather than written out like Cowork's, because `appName` is
  literally what names `userData` and lowercasing it already produces the product-base-plus-
  environment-suffix shape the standard asks for. Deriving means a sixth edition gets its directory
  for free; hand-writing five names would add a table that can drift from `userData` unnoticed.
- **`APP_DATA_DIRS` is the single list** of owner-facing subdirectories — `default_workspace`,
  `workflows`, `skills`. It is what `ensureAppData()` creates, so a directory cannot be registered
  without also being created at boot.
- **`ensureAppData()` runs once at boot**, before the features that use the directories. None of them
  may wait for their feature's first write: a directory that appears only after something has been
  saved into it reads as the feature being broken.
- **Global skills moved** from `<userData>/cowork/skills` into the root. `SkillRegistryService` takes
  the directory as a parameter instead of deriving it — `userDataDir` still roots the app's own
  bookkeeping (scope storage, local state, and the legacy `.agents/skills` fallback, which stays put
  so older installs keep resolving).
- **Migration is a one-time move, never an overwrite.** A pre-unification directory is renamed into
  the root only when the new location does not exist, and only when it is really a directory. A
  failure leaves the old data where it is and logs; it never crashes the boot.

## Verification

`node --test tests/workflowLibrary/appData.test.mjs` — the root carries the environment, every
registered directory exists after one boot call and the call is idempotent, all five editions get
distinct roots, skills are adopted once and never overwritten by a later stale copy, and a
non-directory at the legacy path neither crashes boot nor destroys the file. Plus
`yarn test:workflow-library`, `node --test tests/skillScopes/execution.test.mjs`, and `yarn build`.
