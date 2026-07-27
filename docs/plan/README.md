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
| [todoist-sync-desktop-001](tasks/todoist-sync-desktop-001.md) | independent encrypted SQLite/HTTP sync plus complete Todo UI, MCP, clock, migration-audit, and Electron cutover | done | — |
| [todo-sync-runtime-recovery-002](tasks/todo-sync-runtime-recovery-002.md) | v1-to-v2 Todo database recovery, session-ready renderer startup, and truthful XPC failures | done | todoist-sync-desktop-001 |
| [todo-subtodo-count-map-003](tasks/todo-subtodo-count-map-003.md) | dense zero-safe SubTodo batch counts after creating a Todo | done | todo-sync-runtime-recovery-002 |
| [todo-sync-refresh-identity-004](tasks/todo-sync-refresh-identity-004.md) | one Refresh/status control and stable installation device identity | done | todo-sync-runtime-recovery-002 |
| [todo-domain-board-layout-005](tasks/todo-domain-board-layout-005.md) | menu-bar Domain creation and wrapping 300–480px Todo columns | done | todo-sync-refresh-identity-004 |
| [todo-ai-source-corner-006](tasks/todo-ai-source-corner-006.md) | overlay the AI source marker into the Todo item's top-left corner | done | todo-domain-board-layout-005 |
| [todo-mcp-domain-catalog-skill-version-007](tasks/todo-mcp-domain-catalog-skill-version-007.md) | active/archived MCP Domain catalog, description updates, and versioned skill attention | done | todo-agent-skill-onboarding-002, todo-mcp-domain-create |
| [todo-mcp-step-crud-009](tasks/todo-mcp-step-crud-009.md) | safe optional-date create recovery and synchronized Step CRUD | done | todo-mcp-domain-catalog-skill-version-007, todoist-sync-desktop-001 |
| [todo-mcp-important-intent-013](tasks/todo-mcp-important-intent-013.md) | star/important intent for Todo create, edit, and Focus placement | done | todo-mcp-step-crud-009 |
| [todo-note-editor-height-010](tasks/todo-note-editor-height-010.md) | 480px default Todo Note editing canvas | done | todoist-sync-desktop-001 |
| [todo-renderer-refresh-stability-011](tasks/todo-renderer-refresh-stability-011.md) | atomic board refresh and origin-aware cross-renderer invalidation | implemented; owner verification pending | todo-sync-refresh-identity-004 |
| [todo-sqlite-process-ownership-012](tasks/todo-sqlite-process-ownership-012.md) | move synchronized Todo SQLCipher ownership out of Main into Core SQLite preload | implemented; owner verification pending | todoist-sync-desktop-001, todo-renderer-refresh-stability-011 |
| [todo-sync-device-binding-recovery-008](tasks/todo-sync-device-binding-recovery-008.md) | guarded recovery of stale local Todo device and Snowflake-node bindings | implemented; owner verification pending | todo-sync-refresh-identity-004 |
| [maestro-source-layout-migration](tasks/maestro-source-layout-migration.md) | rename Sidekick to Maestro and keep sources distributed by Electron process | done | cowork-subapp-001, cowork-subapp-002 |
| [renderer-arco-bem-controls](tasks/renderer-arco-bem-controls.md) | MCP guide modal and Maestro ChatPanel control consistency | done | maestro-source-layout-migration, todo-mcp-domain-create |
| [renderer-tailwind-removal](tasks/renderer-tailwind-removal.md) | remove renderer Tailwind usage, retain dormant dependencies, and enforce shallow business BEM | done | renderer-arco-bem-controls, maestro-source-layout-migration |
| [todo-archived-domains-modal-refresh](tasks/todo-archived-domains-modal-refresh.md) | compact Archived domains management and restore flow | done | renderer-arco-bem-controls |
| [renderer-i18n-sync](tasks/renderer-i18n-sync.md) | main-owned language state, live renderer updates, and correct recreated-window locale | done | — |
| [customer-account-recovery](tasks/customer-account-recovery.md) | customer recovery, lifecycle enforcement, and Royal Blue home surface | done | — |
| [login-shared-window-shell](tasks/login-shared-window-shell.md) | shared MenuBar and update controls across login and authenticated routes | done | customer-account-recovery |
| [customer-auth-login-account-001](tasks/customer-auth-login-account-001.md) | deterministic login transition, General account identity, and manual logout | implemented; owner verification pending | customer-account-recovery, login-shared-window-shell |
| [coin-subapp-shell-001](tasks/coin-subapp-shell-001.md) | Coin singleton window, scoped bridge, and full-width analysis shell | done | — |
| [coin-resource-settings-002](tasks/coin-resource-settings-002.md) | Codex/GMGN/service configuration and secure local probes; Alchemy adapter deferred | implemented; owner verification pending | coin-subapp-shell-001 |
| [coin-analysis-workspace-003](tasks/coin-analysis-workspace-003.md) | Coin analysis tabs, truthful source adapters, persistence, and decisions | implemented; owner verification pending | coin-resource-settings-002 |
| [coin-ai-analysis-004](tasks/coin-ai-analysis-004.md) | background Codex structured analysis without chat UI | implemented; owner verification pending | coin-analysis-workspace-003 |
| [coin-subapp-integration-005](tasks/coin-subapp-integration-005.md) | end-to-end lifecycle, resources, data, AI, and visual acceptance | owner verification pending | coin-ai-analysis-004 |
| [coin-gmgn-only-local-mode-007](tasks/coin-gmgn-only-local-mode-007.md) | remove Alchemy from the active release and make local Meme analysis GMGN-only | implemented; owner verification pending | coin-analysis-workspace-003, coin-holder-universe-filter-006 |
| [coding-agent-sessions-core-001](tasks/coding-agent-sessions-core-001.md) | storage, Codex/Claude discovery, normalization, and safe opening | done | — |
| [coding-agent-sessions-bridge-002](tasks/coding-agent-sessions-bridge-002.md) | lifecycle helper, local bridge, and reversible hook settings | done | coding-agent-sessions-core-001 |
| [coding-agent-sessions-ui-003](tasks/coding-agent-sessions-ui-003.md) | authenticated Home dashboard and real XPC interactions | done | coding-agent-sessions-bridge-002 |
| [coding-agent-sessions-integration-004](tasks/coding-agent-sessions-integration-004.md) | real-boundary and Electron acceptance | done | coding-agent-sessions-ui-003 |
| [eyes-on-agents-001](tasks/eyes-on-agents-001.md) | Codex-only standalone observation board and persistent App Server | done | — |
| [eyes-on-agents-focus-002](tasks/eyes-on-agents-focus-002.md) | Codex Desktop lifecycle connection and long-running Focus correctness | done | eyes-on-agents-001 |
| [eyes-on-agents-project-filter-003](tasks/eyes-on-agents-project-filter-003.md) | Git Project metadata and Uncategorized source filter | done | eyes-on-agents-focus-002 |
| [eyes-on-agents-activation-refresh-004](tasks/eyes-on-agents-activation-refresh-004.md) | refresh thread metadata whenever the EyesOnAgents window regains focus | done | eyes-on-agents-project-filter-003 |
| [eyes-on-agents-archive-sync-005](tasks/eyes-on-agents-archive-sync-005.md) | reconcile Codex archive/unarchive state into EyesOnAgents visibility | done | eyes-on-agents-activation-refresh-004 |
| [eyes-on-agents-sync-persistence-006](tasks/eyes-on-agents-sync-persistence-006.md) | persist raw Codex inventory, explicit unread attention, and disconnected Refresh fallback | done | eyes-on-agents-archive-sync-005 |
| [eyes-on-agents-hook-delivery-007](tasks/eyes-on-agents-hook-delivery-007.md) | lightweight Hook helper, durable outbox, commit ACK, and persistent dedupe | done | eyes-on-agents-sync-persistence-006 |
| [eyes-on-agents-global-onboarding-008](tasks/eyes-on-agents-global-onboarding-008.md) | global Hook lifecycle, trust review/recheck, and App Server decoupling | done | eyes-on-agents-hook-delivery-007 |
| [eyes-on-agents-thread-card-009](tasks/eyes-on-agents-thread-card-009.md) | remove decorative thread-card signals/source and reduce Open to an icon | done | eyes-on-agents-global-onboarding-008 |
| [eyes-on-agents-reactive-time-010](tasks/eyes-on-agents-reactive-time-010.md) | update visible thread relative times from one renderer-global 10-second clock | done | eyes-on-agents-thread-card-009 |
| [eyes-on-agents-all-board-011](tasks/eyes-on-agents-all-board-011.md) | All projection, Todo-style title editing, and wrapping 600px Domain columns | done | eyes-on-agents-reactive-time-010 |
| [eyes-on-agents-compact-card-012](tasks/eyes-on-agents-compact-card-012.md) | remove Domain counts and compact status/meta into title plus action rows | done | eyes-on-agents-all-board-011 |
| [eyes-on-agents-hook-guide-013](tasks/eyes-on-agents-hook-guide-013.md) | actionable Codex Hook trust guide in the connection drawer | done | eyes-on-agents-compact-card-012, eyes-on-agents-global-onboarding-008 |
| [eyes-on-agents-menubar-domain-guide-014](tasks/eyes-on-agents-menubar-domain-guide-014.md) | menubar Domain creation and always-visible connection Hook guide | done | eyes-on-agents-hook-guide-013 |
| [eyes-on-agents-refresh-polling-015](tasks/eyes-on-agents-refresh-polling-015.md) | one non-overlapping ten-second thread refresh poll | done | eyes-on-agents-menubar-domain-guide-014 |
| [eyes-on-agents-last-user-prompt-016](tasks/eyes-on-agents-last-user-prompt-016.md) | trusted live Hook capture with content-free offline recovery | done | eyes-on-agents-silent-focus-polling-018, eyes-on-agents-hook-delivery-007 |
| [eyes-on-agents-all-title-search-017](tasks/eyes-on-agents-all-title-search-017.md) | simple title substring search in the All column | done | eyes-on-agents-refresh-polling-015 |
| [eyes-on-agents-silent-focus-polling-018](tasks/eyes-on-agents-silent-focus-polling-018.md) | silent field-level title, state, and opted-in question refresh for Focus | done | eyes-on-agents-refresh-polling-015, eyes-on-agents-hook-delivery-007 |
| [eyes-on-agents-tiered-all-polling-019](tasks/eyes-on-agents-tiered-all-polling-019.md) | hot-page plus round-robin cold-page field refresh across All | done | eyes-on-agents-silent-focus-polling-018, eyes-on-agents-last-user-prompt-016 |
| [eyes-on-agents-thread-ingestion-prompt-card-020](tasks/eyes-on-agents-thread-ingestion-prompt-card-020.md) | tolerant thread admission, title repair, compact latest-question echo, and consent guide | implemented; owner verification pending | eyes-on-agents-tiered-all-polling-019, eyes-on-agents-last-user-prompt-016 |
| [eyes-on-agents-focus-read-all-021](tasks/eyes-on-agents-focus-read-all-021.md) | persistent Focus Read all action without falsifying Codex opens | implemented; owner verification pending | eyes-on-agents-sync-persistence-006, eyes-on-agents-compact-card-012 |
| [eyes-on-agents-hook-coverage-recovery-022](tasks/eyes-on-agents-hook-coverage-recovery-022.md) | recover durable Hook coverage gaps without blocking App Server inventory | implemented; owner verification pending | eyes-on-agents-hook-delivery-007, eyes-on-agents-global-onboarding-008 |
| [eyes-on-agents-flex-columns-023](tasks/eyes-on-agents-flex-columns-023.md) | 300–500px flex-width wrapped Domain columns | implemented; owner verification pending | eyes-on-agents-all-board-011 |
| [eyes-on-agents-focus-acknowledgement-024](tasks/eyes-on-agents-focus-acknowledgement-024.md) | preserve Hook working authority and acknowledge current active Focus on Open | implemented; owner verification pending | eyes-on-agents-tiered-all-polling-019, eyes-on-agents-focus-read-all-021 |
| [eyes-on-agents-stop-reconciliation-025](tasks/eyes-on-agents-stop-reconciliation-025.md) | reconcile stale Hook working from metadata-only latest-turn terminal proof | implemented; owner verification pending | eyes-on-agents-focus-acknowledgement-024, eyes-on-agents-tiered-all-polling-019 |
| [eyes-on-agents-app-server-frame-overflow-026](tasks/eyes-on-agents-app-server-frame-overflow-026.md) | bounded one-turn prompt recovery without App Server connection loss | implemented; owner verification pending | eyes-on-agents-last-user-prompt-016, eyes-on-agents-tiered-all-polling-019 |
| [desktop-helper-process-isolation-001](tasks/desktop-helper-process-isolation-001.md) | Node-only Codex helpers, GUI singleton, and observable SQLite-first startup | in-progress | todo-mcp-multi-instance, eyes-on-agents-global-onboarding-008 |
| [preload-linkedom-worker-003](tasks/preload-linkedom-worker-003.md) | canvas-free LinkeDOM preload bundling and production development startup | done | desktop-helper-process-isolation-001 |
| [desktop-package-size-002](tasks/desktop-package-size-002.md) | production dependency boundary and pre-sign desktop package-size gate | done | — |
| [desktop-mac-dock-icon-004](tasks/desktop-mac-dock-icon-004.md) | current macOS bundle icon plus runtime Dock refresh | implemented; owner verification pending | desktop-package-size-002 |
| [desktop-electron-locales-005](tasks/desktop-electron-locales-005.md) | seven-locale Electron package allowlist before macOS signing | in-progress | — |
| [desktop-mac-dock-icon-size-006](tasks/desktop-mac-dock-icon-size-006.md) | preserve bundle-default macOS Dock icon size while running | done | desktop-mac-dock-icon-004 |
| [desktop-auto-update-polling-007](tasks/desktop-auto-update-polling-007.md) | recoverable, idempotent desktop automatic-update polling | implemented; owner verification pending | — |
| [desktop-auto-update-state-replay-008](tasks/desktop-auto-update-state-replay-008.md) | race-safe download-ready replay after renderer rebuild | implemented; owner verification pending | desktop-auto-update-polling-007 |
| [desktop-update-menubars-009](tasks/desktop-update-menubars-009.md) | compact `upate` action in Home, Maestro, and Omni Menu Bars | implemented; owner verification pending | desktop-auto-update-state-replay-008 |
| [release-fast-publish-version-code-002](tasks/release-fast-publish-version-code-002.md) | restore version preparation before macOS ARM fast-publish build | done | — |
| [release-fast-publish-dependency-sync-003](tasks/release-fast-publish-dependency-sync-003.md) | restore Electron 40 and install locked dependencies before macOS ARM version preparation | implemented; owner verification pending | release-fast-publish-version-code-002 |
| [chat-production-entry-flag-001](tasks/chat-production-entry-flag-001.md) | production-hidden Chat entry and persisted General override | done | — |
| [translator-miniapp-001](tasks/translator-miniapp-001.md) | shared Codex registry plus fixed GPT-5.5 low Translator in Omni | done | chat-production-entry-flag-001 |
| [translator-language-direction-002](tasks/translator-language-direction-002.md) | explicit-range direction detection and English-abbreviation Chinese meanings | done | translator-miniapp-001 |
| [translator-inline-retry-003](tasks/translator-inline-retry-003.md) | inline retry action for unchanged-source translation failures | done | translator-language-direction-002 |
| [miniapp-entry-visibility-001](tasks/miniapp-entry-visibility-001.md) | temporarily hidden Maestro and Coin Home entries | done | — |
| [omni-miniapp-cells-001](tasks/omni-miniapp-cells-001.md) | persistent browser/Todo/EyesOnAgents Omni cells | pending | eyes-on-agents-focus-002 |
| [omni-layout-axis-collapse-002](tasks/omni-layout-axis-collapse-002.md) | root/inner-axis collapse, Splitpanes lifecycle, and native bounds consistency | implemented; owner verification pending | — |
| [sqlite-migration-release-gate-001](tasks/sqlite-migration-release-gate-001.md) | final three-family SQLite audit and production packaging proof | pending | todoist-sync-desktop-001 |
| [window-state-persistence-001](tasks/window-state-persistence-001.md) | unified bounds, mode, and physical-display persistence for every visible top-level window | implemented; owner verification pending | — |

Analysis: [Cowork sub-application migration](analysis/cowork-subapp-migration.md),
[Coin sub-application](analysis/coin-subapp.md),
[Coding-agent sessions](analysis/coding-agent-sessions.md),
[EyesOnAgents](analysis/eyes-on-agents.md), and
[Translator](analysis/translator.md),
[Omni mini-app cells](analysis/omni-miniapp-cells.md), and
[SQLite migration release gate](analysis/sqlite-migration-release-gate.md).

Todo synchronization: [Todoist-style HTTP sync](analysis/todoist-sync.md).

## Concurrency guard

`package.json`, `yarn.lock`, and `tasks/pin-electron-sqlite-compatibility.md` contain another
in-progress change that pins Electron `40.10.6`. Maestro work may add dependencies and scripts only by
surgically preserving that exact Electron pin and all unrelated hunks.
