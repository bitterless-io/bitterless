# Bitterless Delivery Plan

Tasks are executed serially in the existing working directory because this Electron project shares a
large native dependency installation and the current branch contains an unrelated in-progress
Electron/SQLite pin. Development and verification are performed by different agents.

## Active delivery

| id | scope | status | depends-on |
|---|---|---|---|
| [cowork-subapp-001](tasks/cowork-subapp-001.md) | original Cowork runtime and host integration | done | — |
| [cowork-subapp-003](tasks/cowork-subapp-003.md) | dev-local SQLCipher key without OS Keychain | done | cowork-subapp-001 |
| [cowork-subapp-002](tasks/cowork-subapp-002.md) | parity checks and Bitterless-launched Electron E2E | done | cowork-subapp-001, cowork-subapp-003 |
| [todo-mcp-smoke-cli-and-skill](tasks/todo-mcp-smoke-cli-and-skill.md) | Todo MCP smoke CLI and agent skill | done | — |
| [todo-mcp-domain-create](tasks/todo-mcp-domain-create.md) | explicit MCP domain creation and live bootstrap | done | todo-mcp-smoke-cli-and-skill |
| [todo-mcp-multi-instance](tasks/todo-mcp-multi-instance.md) | simultaneous production/DEBUG MCP with production-first routing | verified-source; production deploy pending | todo-mcp-smoke-cli-and-skill, todo-mcp-domain-create |
| [maestro-source-layout-migration](tasks/maestro-source-layout-migration.md) | rename Sidekick to Maestro and keep sources distributed by Electron process | done | cowork-subapp-001, cowork-subapp-002 |
| [renderer-arco-bem-controls](tasks/renderer-arco-bem-controls.md) | MCP guide modal and Maestro ChatPanel control consistency | done | maestro-source-layout-migration, todo-mcp-domain-create |
| [renderer-tailwind-removal](tasks/renderer-tailwind-removal.md) | remove renderer Tailwind usage, retain dormant dependencies, and enforce shallow business BEM | done | renderer-arco-bem-controls, maestro-source-layout-migration |
| [todo-archived-domains-modal-refresh](tasks/todo-archived-domains-modal-refresh.md) | compact Archived domains management and restore flow | done | renderer-arco-bem-controls |
| [renderer-i18n-sync](tasks/renderer-i18n-sync.md) | main-owned language state, live renderer updates, and correct recreated-window locale | done | — |
| [customer-account-recovery](tasks/customer-account-recovery.md) | customer recovery, lifecycle enforcement, and Royal Blue home surface | done | — |
| [coin-subapp-shell-001](tasks/coin-subapp-shell-001.md) | Coin singleton window, scoped bridge, and full-width analysis shell | in-progress | — |
| [coin-resource-settings-002](tasks/coin-resource-settings-002.md) | Codex/GMGN/Alchemy/service configuration and secure local probes | pending | coin-subapp-shell-001 |
| [coin-analysis-workspace-003](tasks/coin-analysis-workspace-003.md) | Coin analysis tabs, truthful source adapters, persistence, and decisions | pending | coin-resource-settings-002 |
| [coin-ai-analysis-004](tasks/coin-ai-analysis-004.md) | background Codex structured analysis without chat UI | pending | coin-analysis-workspace-003 |
| [coin-subapp-integration-005](tasks/coin-subapp-integration-005.md) | end-to-end lifecycle, resources, data, AI, and visual acceptance | pending | coin-ai-analysis-004 |

Analysis: [Cowork sub-application migration](analysis/cowork-subapp-migration.md),
[Coin sub-application](analysis/coin-subapp.md).

## Concurrency guard

`package.json`, `yarn.lock`, and `tasks/pin-electron-sqlite-compatibility.md` contain another
in-progress change that pins Electron `40.10.6`. Maestro work may add dependencies and scripts only by
surgically preserving that exact Electron pin and all unrelated hunks.
