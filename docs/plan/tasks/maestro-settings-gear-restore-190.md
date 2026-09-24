---
id: maestro-settings-gear-restore-190
scope: restore the address-bar Settings gear; account menu back to email / change password / log out
status: in-progress
depends-on: [bitterless-provider-readiness-189]
---

# Restore the Settings gear next to the avatar

## Objective

Implement `docs/issues/address-bar-settings-button-removed.md` #契约: put the Workbench gear back in the
Maestro address row (right of the Control-panel toggle, left of `<UserAvatar />`) exactly in its pre-`6bf96d09`
form, and drop the `Workbench` row from the native account menu (email disabled / Change password / Log out).

## Context

- `docs/issues/address-bar-settings-button-removed.md`
- `docs/plan/tasks/maestro-workbench-tab-167.md` (gear = idempotent open)
- `git show 6bf96d09 -- src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue` (removed code)
- Paired change in Cowork: `micromeet-cowork/docs/plan/tasks/menubar-settings-001.md`

## Path

- `src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue` — restore the button
  (`name="menubar__workbench__open"`, `:class="navBtn"`, `:title`/`:aria-label` =
  `i18nHelper.menuBar.maestro.showWorkbench`, `type="button"`, `@click="workbenchStore.openTab()"`,
  `<IconSettings :size="18" stroke="1.8" />`) immediately before `<UserAvatar />`; update the stale
  "Trailing actions" comment to list Snapshot, panel, Settings, account, Update. Nothing else changes.
- `src/main/maestro/windows/main/accountMenu.service.ts` — remove the `Workbench` row.
- `src/shared/accountMenu.ts` — `AccountMenuAction = 'password' | 'logout'`.
- `src/renderer/maestro/home/src/store/accountMenu.store.ts` — remove the `workbench` branch and the unused import.
- `tests/maestro/accountMenu.test.mjs` — three-row menu; email row `enabled: false` with no click; signed-out:
  both action rows disabled; dispatch covers password/logout only. Add a source guard: the gear exists in
  `MenuBar.vue`, calls `workbenchStore.openTab()`, and precedes `<UserAvatar />`.
- `grep -rn "'workbench'" src/renderer/maestro/home src/main/maestro/windows/main src/shared/accountMenu.ts` and
  update only account-menu references.
- Lessons from the paired Cowork review (`micromeet-cowork/docs/plan/reviews/menubar-settings-001-1.md`), apply
  them here from the start:
  - `accountMenu.store.ts`: type `action` as `AccountMenuAction | null` so a stray branch is a compile error.
  - Tests also assert: signed in → both action rows enabled; signed in without email → the `unavailable` label;
    the gear sits after the Control-panel toggle and before `<UserAvatar />`; no filled-icon variant / `aria-pressed`
    on the gear. Confirm new assertions can fail (mutate a scratch copy, not the worktree).
  - Fix any comment in `MenuBar.vue` / `MenuBar.less` that still describes the removed gear or claims it shares
    the panel toggle's pressed state.

Do NOT touch the unrelated uncommitted files listed in task 189.

## Verification

- `node --test tests/maestro/accountMenu.test.mjs` passes.
- `yarn typecheck:web` and `yarn typecheck:node` — no new diagnostics in touched files.
- No Electron launch / E2E, no commit, no branch operations.
