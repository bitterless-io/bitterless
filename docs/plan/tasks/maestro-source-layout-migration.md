---
id: maestro-source-layout-migration
scope: Maestro product naming and Electron source layout
status: done
depends-on:
  - cowork-subapp-001
  - cowork-subapp-002
verify:
  - src/cowork no longer exists
  - No Sidekick-named source, script, test, icon, or user-facing identifier remains
  - Maestro sources live under src/main, src/preload, src/renderer, and src/shared
  - Existing Cowork data, SQLite, Chromium partition, and XPC behavior remain compatible
  - Maestro Home, Control, Workbench, SQLite, and operation views still load
  - yarn check:maestro
  - yarn typecheck:node
  - yarn build
  - yarn test:e2e:maestro
---

# Rename Sidekick To Maestro

## Objective

Rename the current embedded Bitterless feature from Sidekick to Maestro. Keep the process-separated
layout introduced during the Cowork migration and preserve the complete window graph and runtime
behavior.

## Source layout

| Process boundary | Target path |
|---|---|
| Main process | `src/main/maestro/` |
| Preload process | `src/preload/maestro/` |
| Renderer process | `src/renderer/maestro/` |
| Cross-process contracts | `src/shared/maestro/` |

The four Maestro render surfaces live under `src/renderer/maestro/{home,control,workbench,sqlite}`.
No renderer wrapper may point back into another process-shaped source root.

## Compatibility constraints

- Keep the persisted directory value `userData/cowork` and Chromium partition
  `persist:bitterless-cowork` in this migration. They are legacy storage identifiers, not current
  product names; changing them without a data migration would orphan existing local state.
- Preserve SQLite table names and XPC persistence contracts where renaming would require a schema
  or profile migration. New TypeScript symbols and user-facing labels use Maestro.
- Sidekick was only an interim source/product name and introduced no persisted schema, directory,
  partition, or external protocol contract, so it does not require a compatibility alias.
- Preserve the untracked booking demo service while moving the main-process tree.
- Do not alter unrelated Todo MCP work already present in the working tree.
- Keep operation pages unprivileged and keep auth invalidation, quit cleanup, proxy ownership,
  update delegation, window geometry, and singleton focus behavior unchanged.

## Design and icon contract

- Replace the Mini Apps asset with the supplied `200x200` Maestro icon and name it `maestro.png`.
- The supplied icon source color is exactly menu idle `#8188A2`.
- Document the historical source and semantic role of active orange `#C2410C`; it remains a
  navigation-selection accent and must not replace Royal Blue primary actions.

## Node type-check policy

`yarn typecheck:node` is a fast daily compilation preflight, not a semantic strictness migration for
the imported legacy runtime. The Node config disables strict-family and implicit-return rules, and
the command uses TypeScript's `--noCheck` mode to process the complete source graph without loading
the existing multi-gigabyte semantic type graph. Production bundling and Maestro's runtime/Electron
checks remain required gates for imports, aliases, process boundaries, and behavior.

## Verification

1. Confirm `find src -maxdepth 1 -type d -name cowork` returns no path.
2. Confirm Vite and TypeScript aliases resolve only through the four standard process roots.
3. Run the Maestro parity checks, relaxed Node type check, and production build.
4. Launch Bitterless through Electron, open Maestro from Mini Apps, and verify all renderer
   surfaces plus close/reopen singleton behavior.
5. Run `git diff --check` and confirm unrelated working-tree changes are preserved.

## Result

- No Sidekick-named source, script, test, icon, build entry, or generated output remains. Maestro
  lives under the four standard process roots and uses Maestro-named host handlers and emitters.
- Cowork data-root, Chromium partition, SQLite table, chat-source, host-tool-scope, and CLI-auth
  literals remain unchanged as documented compatibility identifiers.
- `yarn typecheck:node` now runs the complete TypeScript graph in relaxed `--noCheck` mode and
  completes in about three seconds instead of exhausting 4 GB or 8 GB heaps.
- All 36 `yarn check:maestro` contract checks passed.
- The targeted ESLint check for the renamed host wiring passed.
- `yarn build` passed and emitted `maestroCoach.js`, `maestroSqlite.js`, and all four nested Maestro
  renderer entries.
- `yarn test:e2e:maestro` passed against the built Electron app, including singleton lifecycle,
  renderer surfaces, host Todo isolation, and denied-network logging.
