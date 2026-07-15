---
id: renderer-i18n-sync
scope: application language authority and all first-party UI renderer entrypoints
status: done
depends-on: []
verify:
  - main process loads and validates persisted language before creating Home
  - Home Settings persists through a typed main handler and main broadcasts only after success
  - every in-scope renderer installs Vue i18n and awaits current main language before mount
  - all live renderers react to language changes without reload
  - destroyed and recreated sub-application renderers start in the current language
  - invalid or unavailable required language state does not silently fall back
  - yarn check:renderer-i18n
  - yarn typecheck:node
  - yarn build
  - yarn test:e2e:maestro
---

# Synchronize Language Across Renderers

## Objective

Implement the contract in `docs/features/renderer-i18n.md`: make main the runtime language authority,
route Home language changes through main, initialize every first-party Vue renderer before mount,
and prove live broadcast plus destroy/recreate behavior.

## Context

- `docs/INDEX.md`
- `docs/features/renderer-i18n.md`
- `docs/features/README.md`
- `docs/features/maestro.md`
- `docs/plan/analysis/renderer-i18n-sync.md`

## Path

- `docs/features/renderer-i18n.md`
- `docs/plan/analysis/renderer-i18n-sync.md`
- `docs/plan/tasks/renderer-i18n-sync.md`
- `docs/plan/reviews/renderer-i18n-sync-*.md`
- `src/shared/i18n/**`
- `src/main/i18n/**`
- `src/main/xpc/**language**`
- `src/main/app.main.ts`
- `src/renderer/common/i18n/**`
- `src/renderer/home/src/**language**`
- first-party renderer Vue entry files for Home, Todo, Connector, Omni, and Maestro
- focused i18n checks/tests and their package scripts

## Implementation constraints

- Preserve unrelated Maestro, Todo MCP, customer-account, styling, and Electron/SQLite work already
  present in the dirty working tree.
- Use one shared `AppLanguage` type and reject values outside `en` / `zh`.
- Keep durable storage in the existing core SQLite language boundary; do not introduce a second
  preferences file or per-partition renderer-local source of truth.
- Main initialization must finish after core SQLite is ready and before Home is created.
- Home Settings must not broadcast directly. Main persists, updates main i18n/tray, then broadcasts.
- Subscribe/fetch/apply before Vue mount in every in-scope entry. Do not hide an initialization
  failure behind an English, browser-locale, or empty fallback.
- Set `document.documentElement.lang` whenever a renderer applies a language.
- Do not grant language APIs to arbitrary Maestro/Omni operation web pages.
- This task configures every renderer and translates existing shared-message consumers; full
  migration of Maestro's remaining hard-coded English product copy stays in the localization backlog.
- Follow the workspace arrow-function rule for new standalone functions.

## Verification

1. Add a source/contract guard that owns the complete renderer-entry inventory and fails when an
   in-scope entry does not await shared initialization or install Vue i18n.
2. Test main validation and persistence-before-broadcast behavior without real user data.
3. Build and run Electron E2E evidence for live update plus close/reopen initialization.
4. Run `yarn typecheck:node`, the focused i18n guard, `yarn build`, `yarn test:e2e:maestro`, and
   `git diff --check`.

## Result

Implemented a main-authoritative application-language flow backed by the existing core SQLite
boundary. Main now validates and hydrates the persisted language before creating Home, persists
Home changes before updating main UI and broadcasting, and exposes typed get/set operations to
renderers. All nine first-party Vue renderer entries subscribe, fetch, apply the authoritative
language (including the HTML `lang` attribute), install shared i18n, and only then mount. Focused
contract checks and Maestro E2E coverage prove live propagation and correct language after
destroy/recreate. The round-1 blocking review finding is resolved by serializing authoritative
mutations: each queued request compares against the latest committed snapshot only when it executes,
so an older delayed persistence write cannot overwrite a newer acknowledged user choice. A
deterministic reverse-change test holds the first write and verifies the final persisted/broadcast
snapshot follows the newer request while preserving revision and failure semantics.

Verification:

- `yarn check:renderer-i18n` — passed.
- `yarn typecheck:node` — passed.
- `yarn build` — passed; Vite reports a non-blocking existing mixed static/dynamic Home router
  import warning.
- `yarn test:e2e:maestro` — passed (`1 passed`).
- `git diff --check` — passed.
- `yarn typecheck:web` — the repository still has unrelated pre-existing type errors in Connector,
  Poker, Home, Maestro, Omni, Todo, and shared helpers; no task-owned i18n errors remain.

The round-1 blocking finding is fixed. Independent round-2 review found no P1, P2, or P3 findings
and passed the task: [renderer-i18n-sync-2](../reviews/renderer-i18n-sync-2.md).
