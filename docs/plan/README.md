# Bitterless Delivery Plan

Tasks are executed serially in the existing working directory because this Electron project shares a
large native dependency installation and the current branch contains an unrelated in-progress
Electron/SQLite pin. Coin runtime verification is currently handed to the owner by request.

## Active delivery

| id | scope | status | depends-on |
|---|---|---|---|
| [cowork-subapp-001](tasks/cowork-subapp-001.md) | original Cowork runtime and host integration | done | — |
| [cowork-subapp-003](tasks/cowork-subapp-003.md) | dev-local SQLCipher key without OS Keychain | done | cowork-subapp-001 |
| [cowork-subapp-002](tasks/cowork-subapp-002.md) | parity checks and Bitterless-launched Electron E2E | done | cowork-subapp-001, cowork-subapp-003 |
| [todo-mcp-smoke-cli-and-skill](tasks/todo-mcp-smoke-cli-and-skill.md) | Todo MCP smoke CLI and agent skill | done | — |
| [todo-mcp-domain-create](tasks/todo-mcp-domain-create.md) | explicit MCP domain creation and live bootstrap | done | todo-mcp-smoke-cli-and-skill |
| [todo-mcp-multi-instance](tasks/todo-mcp-multi-instance.md) | simultaneous production/DEBUG MCP with production-first routing | verified-source; production deploy pending | todo-mcp-smoke-cli-and-skill, todo-mcp-domain-create |
| [todo-mcp-portable-skill](tasks/todo-mcp-portable-skill.md) | exportable Codex/Claude personal multi-device Todo skill package | done | todo-mcp-multi-instance |
| [todo-preload-runtime-001](tasks/todo-preload-runtime-001.md) | chunk-safe Todo preload and renderer asset resolution | done | renderer-i18n-sync |
| [todo-agent-skill-onboarding-002](tasks/todo-agent-skill-onboarding-002.md) | two-step MCP plus portable skill onboarding | done | todo-mcp-portable-skill, renderer-arco-bem-controls |
| [maestro-source-layout-migration](tasks/maestro-source-layout-migration.md) | rename Sidekick to Maestro and keep sources distributed by Electron process | done | cowork-subapp-001, cowork-subapp-002 |
| [renderer-arco-bem-controls](tasks/renderer-arco-bem-controls.md) | MCP guide modal and Maestro ChatPanel control consistency | done | maestro-source-layout-migration, todo-mcp-domain-create |
| [renderer-tailwind-removal](tasks/renderer-tailwind-removal.md) | remove renderer Tailwind usage, retain dormant dependencies, and enforce shallow business BEM | done | renderer-arco-bem-controls, maestro-source-layout-migration |
| [todo-archived-domains-modal-refresh](tasks/todo-archived-domains-modal-refresh.md) | compact Archived domains management and restore flow | done | renderer-arco-bem-controls |
| [renderer-i18n-sync](tasks/renderer-i18n-sync.md) | main-owned language state, live renderer updates, and correct recreated-window locale | done | — |
| [customer-account-recovery](tasks/customer-account-recovery.md) | customer recovery, lifecycle enforcement, and Royal Blue home surface | done | — |
| [coin-subapp-shell-001](tasks/coin-subapp-shell-001.md) | Coin singleton window, scoped bridge, and full-width analysis shell | done | — |
| [coin-resource-settings-002](tasks/coin-resource-settings-002.md) | Codex/GMGN/Alchemy/service configuration and secure local probes | implemented; owner verification pending | coin-subapp-shell-001 |
| [coin-analysis-workspace-003](tasks/coin-analysis-workspace-003.md) | Coin analysis tabs, truthful source adapters, persistence, and decisions | implemented; owner verification pending | coin-resource-settings-002 |
| [coin-ai-analysis-004](tasks/coin-ai-analysis-004.md) | background Codex structured analysis without chat UI | implemented; owner verification pending | coin-analysis-workspace-003 |
| [coin-subapp-integration-005](tasks/coin-subapp-integration-005.md) | end-to-end lifecycle, resources, data, AI, and visual acceptance | owner verification pending | coin-ai-analysis-004 |
| [coding-agent-sessions-core-001](tasks/coding-agent-sessions-core-001.md) | storage, Codex/Claude discovery, normalization, and safe opening | done | — |
| [coding-agent-sessions-bridge-002](tasks/coding-agent-sessions-bridge-002.md) | lifecycle helper, local bridge, and reversible hook settings | done | coding-agent-sessions-core-001 |
| [coding-agent-sessions-ui-003](tasks/coding-agent-sessions-ui-003.md) | authenticated Home dashboard and real XPC interactions | done | coding-agent-sessions-bridge-002 |
| [coding-agent-sessions-integration-004](tasks/coding-agent-sessions-integration-004.md) | real-boundary and Electron acceptance | done | coding-agent-sessions-ui-003 |
| [eyes-on-agents-001](tasks/eyes-on-agents-001.md) | Codex-only standalone observation board and persistent App Server | done | — |
| [eyes-on-agents-focus-002](tasks/eyes-on-agents-focus-002.md) | Codex Desktop lifecycle connection and long-running Focus correctness | done | eyes-on-agents-001 |
| [eyes-on-agents-project-filter-003](tasks/eyes-on-agents-project-filter-003.md) | Git Project metadata and Uncategorized source filter | done | eyes-on-agents-focus-002 |
| [eyes-on-agents-activation-refresh-004](tasks/eyes-on-agents-activation-refresh-004.md) | refresh thread metadata whenever the EyesOnAgents window regains focus | done | eyes-on-agents-project-filter-003 |
| [eyes-on-agents-archive-sync-005](tasks/eyes-on-agents-archive-sync-005.md) | reconcile Codex archive/unarchive state into EyesOnAgents visibility | done | eyes-on-agents-activation-refresh-004 |
| [omni-miniapp-cells-001](tasks/omni-miniapp-cells-001.md) | persistent browser/Todo/EyesOnAgents Omni cells | pending | eyes-on-agents-focus-002 |
| [sqlite-migration-release-gate-001](tasks/sqlite-migration-release-gate-001.md) | audit multi-version SQLite upgrades before production packaging | in-progress | — |

Analysis: [Cowork sub-application migration](analysis/cowork-subapp-migration.md),
[Coin sub-application](analysis/coin-subapp.md),
[Coding-agent sessions](analysis/coding-agent-sessions.md),
[EyesOnAgents](analysis/eyes-on-agents.md), and
[Omni mini-app cells](analysis/omni-miniapp-cells.md), and
[SQLite migration release gate](analysis/sqlite-migration-release-gate.md).

## Concurrency guard

`package.json`, `yarn.lock`, and `tasks/pin-electron-sqlite-compatibility.md` contain another
in-progress change that pins Electron `40.10.6`. Maestro work may add dependencies and scripts only by
surgically preserving that exact Electron pin and all unrelated hunks.
