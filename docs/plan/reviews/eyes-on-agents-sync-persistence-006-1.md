# EyesOnAgents Sync Persistence Review — Round 1

Status: accepted

Date: 2026-07-16

## Contract result

- Active and archived `thread/list` objects are stored in a local-only raw snapshot table; the
  renderer still receives only normalized board DTOs.
- Domain, Project, archive, open markers, and persistent unread state remain in the normalized
  Bitterless overlay and survive database restart.
- Running discovery/status/start and terminal events set unread. A successful Open clears it, and a
  later running inventory observation sets it again. Focus remains active runtime OR unread.
- The header now exposes a labelled Refresh that runs the existing safe full reconciliation and can
  recover from disconnected or error state.

## Verification evidence

- `yarn test:eyes-on-agents` — passed all core, Project resolver, repository, App Server, bridge,
  Project filter, activation, rendered-DOM, and UI-source suites.
- Repository tests reopen a file-backed SQLite database and prove raw payload, Domain, archive, and
  read markers survive independently.
- Live read-only Codex 0.144.5 App Server check listed 93 active-inventory and 159 archived-inventory
  threads; all 252 returned objects were JSON-serializable, with no inventory overlap. No thread ID,
  title, preview, or working directory was printed.
- `yarn audit:sqlite-migrations` — passed 11 Core and 7 Maestro baselines, including exact
  `260716000003 -> 260716000004` and idempotent `260716000004` startup.
- `yarn test:sqlite-migrations`, `yarn typecheck:sqlite-migrations`,
  `yarn typecheck:eyes-on-agents:core`, `yarn typecheck:eyes-on-agents:ui`,
  `yarn typecheck:node`, and `yarn check:renderer-i18n` — passed.
- `yarn build` — production compilation passed without launching Electron.
- Targeted ESLint error-only check for changed production sources passed. Full-repository lint still
  reports the pre-existing baseline of 385 errors and 25,616 warnings outside this delivery.
- `git diff --check` — passed.

## Boundary confirmed

The live managed App Server reported every listed thread as `notLoaded`, which is expected because
Codex Desktop owns a separate private App Server process. Inventory/title/archive sync is direct;
Desktop running state still comes only from trusted metadata hooks. The implementation preserves
`notLoaded -> unknown` and never fabricates a runtime state.
