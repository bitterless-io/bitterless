# Bitterless Documentation

This directory is the entry point for current Bitterless design and delivery documents.
Older implementation notes remain under `doc/` and are reference-only unless linked from a current
design document.

## Feature contracts

- [Renderer language coordination](features/renderer-i18n.md) - one main-process language authority,
  live updates for every first-party renderer, and correct locale before recreated windows mount.
- [Maestro sub-application](features/maestro.md) - the Bitterless Mini App migrated from the
  Micromeet Cowork runtime.
- [Maestro main-window IoC split](features/maestro-window-ioc.md) - controller plus native-view
  services with unchanged XPC and runtime behavior.
- [Trench sub-application](features/coin.md) - full-width trench analysis tabs with background Codex
  analysis and local resource configuration.
- [Coin layout](features/coin-layout.md) - full-width analysis console, Resources page, tab layouts,
  states, and responsive constraints.
- [Todo MCP integration](features/todo-mcp.md) - production-first local Todo access with isolated
  development instances.
- [Todoist-style Todo synchronization](features/todoist-sync.md) - independent encrypted
  per-customer SQLite, HTTP command/outbox sync, working-set-first bootstrap, and shared UI/MCP
  refresh without PowerSync or logical WAL.
- [Todo Domain board layout](features/todo-layout.md) - menu-bar Domain creation and wrapping
  300–480px Focus/Domain columns without horizontal board navigation.
- [EyesOnAgents Project filter](features/eyes-on-agents-project-filter.md) - Git-worktree-derived
  Project metadata and an All-column source filter.
- [EyesOnAgents Codex observation](features/eyes-on-agents-codex-observation.md) - global Hook
  lifecycle, lightweight reliable delivery, Codex trust review, and App Server independence.
- [EyesOnAgents last user prompt](features/eyes-on-agents-last-user-prompt.md) - narrow capture of one
  bounded latest user question per thread with content-free offline delivery and tiered All-thread
  App Server recovery.
- [Omni browser and mini-app cells](features/omni-miniapp-cells.md) - persistent per-cell browser
  or local Todo/EyesOnAgents/Translator/Motto operation views with development and packaged runtime
  mapping.
- [Shared model providers](features/model-provider.md) - SQLite-backed Codex configuration,
  cross-renderer XPC status, login synchronization, and persisted credential invalidation.
- [Translator mini app](features/translator.md) - fixed GPT-5.5 low-effort realtime bilingual
  translation inside Omni with strict Zod output.
- [Motto mini app](features/motto.md) - local title/subtitle reminder cards inside Omni with
  whole-array Web Storage persistence.
- [Chat entry visibility](features/chat-entry-visibility.md) - production-default hidden Chat menu
  with a persisted General override and Mini Apps production landing.
- [SQLite migration release gate](features/sqlite-migration-release-gate.md) - strict multi-version
  upgrade audit required before signed production packaging.
- [Startup diagnostics](features/startup-diagnostics.md) - SQLite-first but non-blocking GUI
  startup with main-owned failures surfaced from the Home menubar.
- [Application logging and diagnostics](features/application-diagnostics.md) - environment-isolated
  `electron-log`, sanitized Codex lifecycle evidence, and a Settings Log ledger for live paths,
  startup state, directories, and value-free environment status.
- [Top-level window state persistence](features/window-state-persistence.md) - normal bounds,
  window mode, physical-display affinity, off-screen recovery, and legacy geometry import for every
  user-visible Main-owned window.
- [Desktop application icon](features/desktop-app-icon.md) - one canonical artwork source, explicit
  macOS bundle icon generation, and bundle-only Dock rendering without a runtime override.
- [Desktop automatic updates](features/desktop-auto-update.md) - one non-overlapping main-process
  poll, retryable metadata disagreement, and compact Home, Maestro, and Omni update actions.

## Guides

- [Coin data source preparation](guides/coin-data-sources.md) - owner resources, GMGN setup,
  wallet cohorts, credential boundary, and production readiness gates.
- [GMGN CLI setup](guides/gmgn-cli.md) - Yarn installation, personal API key, read-only probes,
  allowlist, and second-machine setup.

## Integrations

- [EyesOnAgents](integrations/eyes-on-agents.md) - Codex-only App Server connection, raw inventory snapshots, Domain
  classification, Focus/unread semantics, Desktop status bridge, and persistence boundary.
- [EyesOnAgents layout](integrations/eyes-on-agents-layout.md) - standalone Mini App window,
  wrapping observation board, compact title/action cards, and responsive interaction states.
- [EyesOnAgents global title search](issues/eyes-on-agents-global-title-search.md) - two-line result metadata implemented; owner verification pending:
  separator-insensitive title lookup with custom Domain and runtime context.

## Design system

- [Design system](design/README.md)
- [Color system](design/colors.md) - Royal Blue theme, accent-orange provenance, menu states, and
  the Maestro icon contract.
- [Customer authentication](design/customer-authentication.md) - account lifecycle, deterministic
  login transition, password recovery, General account/logout controls, and login/home visual
  contract.

## Delivery

- [Delivery plan](plan/README.md)
- [Delivery backlog](plan/backlog.md)
- [Coin delivery analysis](plan/analysis/coin-subapp.md)
- [EyesOnAgents delivery analysis](plan/analysis/eyes-on-agents.md)
- [Omni mini-app cells delivery analysis](plan/analysis/omni-miniapp-cells.md)
- [Translator delivery analysis](plan/analysis/translator.md)
- [Motto delivery analysis](plan/analysis/motto.md)
- [SQLite migration release-gate analysis](plan/analysis/sqlite-migration-release-gate.md)
- [Todoist-style Todo sync delivery analysis](plan/analysis/todoist-sync.md)

## Issues

- [Packaged failures have no persistent application log](issues/application-file-logging-missing.md) -
  implemented; owner verification pending: environment-isolated UTC NDJSON logging, safe Codex
  lifecycle evidence, and a Settings Log diagnostics ledger are available.
- [GPT-5.5 removed by GPT-5.6 migration](issues/codex-gpt55-removed-by-gpt56-migration.md) -
  in progress: keep GPT-5.5 in shared, Coin, and Maestro model catalogs while retaining GPT-5.6
  additions and the fixed GPT-5.5 Translator target.
- [Codex Model login cancellation regression](issues/codex-model-login-cancel-regression.md) -
  implemented; owner verification pending: Setting can cancel or reconnect Codex immediately,
  while credential, provider, and renderer generations ignore late superseded results.
- [Codex browser login success stuck in Setting](issues/codex-model-login-browser-success-stuck.md) -
  reopened: modern Pi OAuth owns the callback, while the follow-up proves current-process loopback
  ownership before opening the browser and records sanitized callback-through-promotion evidence.
- [Omni remote-browser identity profiles](issues/browser-identity-inconsistent-across-embedded-views.md) -
  implemented; owner verification pending: default sites now keep stock Electron identity while
  Google/YouTube use a dedicated session with the verified honest Bitterless UA.
- [Omni root-axis collapse size mismatch](issues/omni-root-axis-collapse-size-mismatch.md) -
  implemented; owner verification pending: immutable tree edits, lifecycle-event rejection, and one
  serialized Main commit keep `H[V,V]` renderer borders and native bounds on the same geometry.
- [Todo SQLCipher owned by Main](issues/todo-sqlite-owned-by-main-process.md) - fixed; owner verification pending:
  the complete synchronized Todo runtime now lives in Core SQLite preload; Main only routes XPC,
  hosts MCP, exposes narrow OS capabilities, and recovers the hidden process lifecycle.
- [Todo Domain refresh flicker](issues/todo-domain-refresh-flicker.md) - fixed; owner verification pending:
  atomic snapshot reconciliation and origin-aware broadcasts keep synchronized updates from
  emptying and rebuilding every visible column.
- [macOS notarization upload timeout](issues/macos-dmg-notarization-upload-timeout.md) -
  implemented; owner verification pending: retain Apple's accelerated route while adding visible,
  bounded network-only retry for application and DMG submissions.
- [Todo MCP empty-date rejection and missing Step CRUD](issues/todo-mcp-empty-date-and-step-crud-gap.md) - fixed:
  optional dates are validated before creation, and synchronized SubTodo operations now have a
  public, idempotent Step interface plus versioned agent guidance.
- [Desktop package includes build-only dependencies](issues/desktop-package-includes-build-only-dependencies.md) - fixed:
  renderer/build-only production dependencies and a duplicated CLI workspace inflated the macOS
  app to about 1.1 GiB; the committed package is now guarded at 220 MiB ASAR / 650 MiB app.
- [Fast publish omits stale native dependencies](issues/fast-publish-stale-native-dependencies.md) - fixed; owner packaging verification pending:
  a stale local installation can lag the local Electron and SQLCipher lock entries, while macOS ARM
  fast publish now preserves the current local working tree and begins with a frozen install.
- [EyesOnAgents Hook coverage recovery](issues/eyes-on-agents-hook-coverage-gap-deadlock.md) - fixed; owner verification pending:
  a historical outbox coverage marker permanently blocks a currently trusted listener and also
  prevents Refresh from reconciling the independent App Server inventory.
- [Todo sync device identity changes across login methods](issues/todo-sync-device-identity-node-mismatch.md) - fixed:
  one persisted installation identity must be shared by password and email-code login.
- [Todo sync stale local device binding](issues/todo-sync-stale-local-device-binding.md) - fixed; owner verification pending:
  a clean pre-release DEBUG database must safely rebind and bootstrap, while any unsynchronized
  local work remains fail-closed.
- [Todo batch SubTodo counts omit zero rows](issues/todo-subtodo-count-map-omits-zero.md) - fixed:
  dense repository counts keep a newly created zero-SubTodo Todo refreshable.
- [Customer login session transition](issues/customer-auth-login-session-transition.md) - client
  fix implemented; Shanghai backend gate and owner verification pending: valid Core login is no
  longer blocked or misreported by optional local runtime activation, and General now exposes the
  current account and Logout.
- [EyesOnAgents existing-thread normalized ingestion](issues/eyes-on-agents-thread-normalization-drops-existing-sessions.md) - implemented; owner verification pending:
  valid Codex threads can be omitted from All and remain Untitled when an optional preview is
  multiline or longer than the display bound.
- [EyesOnAgents working state and Focus acknowledgement](issues/eyes-on-agents-working-focus-stale.md) - implemented; owner verification pending:
  independent App Server thread status must not overwrite Hook working evidence, while guarded
  content-free terminal-turn polling repairs a missed Stop. Its Open-acknowledges-active rule is
  superseded by the active Focus and read semantics issue below.
- [EyesOnAgents Open does not resolve an unknown task](issues/eyes-on-agents-open-does-not-resolve-unknown.md) - implemented; owner verification pending:
  an explicit Open was strictly weaker than waiting for a poll tick; it now runs the same
  content-free newest-turn sync for that one thread and can reclaim an active row whose Hook
  authority is currently absent.
- [EyesOnAgents missed working recovery](issues/eyes-on-agents-working-recovery-gap.md) - implemented; owner verification pending:
  a task left unread `discovery + unknown` by a Hook listener boundary shows no working spinner and
  neither polling nor `Refresh` repairs it; content-free newest-turn metadata now restores `working`
  under a distinct `app_server_turn` source.
- [EyesOnAgents active Focus and read semantics](issues/eyes-on-agents-active-focus-read-semantics.md) - implemented; owner verification pending:
  a still-working thread must not leave Focus after Open or `Read all`; Focus is `active runtime OR
  unread`, and both acknowledgement paths clear unread only for confirmed terminal rows.
- [EyesOnAgents completion alert](issues/eyes-on-agents-completion-alert.md) - fixed and runtime verified:
  each newly accepted successful completion should play the supplied tone and send one localized
  native notification without duplicate alerts from Hook, App Server, or polling races.
- [EyesOnAgents global title search](issues/eyes-on-agents-global-title-search.md) - two-line result metadata implemented; owner verification pending:
  empty input reveals nothing; matched rows show title plus custom Domain/runtime context.
- [EyesOnAgents App Server frame overflow](issues/eyes-on-agents-app-server-frame-overflow.md) - implemented; owner verification pending:
  opted-in latest-question recovery must not aggregate ten complete turns into a frame that kills
  the managed Codex App Server connection.
- [macOS stale Dock icon](issues/macos-dock-icon-stale.md) - superseded: explicit ICNS generation
  remains, while the size-mismatch follow-up below removes the runtime PNG refresh.
- [macOS Dock icon runtime size mismatch](issues/macos-dock-icon-runtime-size-mismatch.md) - fixed;
  owner verification pending: the running tile now keeps the bundle-default size without a PNG override.
- [Desktop automatic-update polling stalls](issues/desktop-auto-update-polling-stalls.md) - fixed;
  owner verification pending: metadata disagreement now releases the shared check so later polls retry.
- [Desktop update-ready state lost after renderer rebuild](issues/desktop-auto-update-ready-state-replay.md) - fixed;
  owner verification pending: Main retains ready state and recreated Home or Maestro renderers replay it safely.
- [Desktop helper Dock and Home startup](issues/desktop-helper-dock-and-home-startup.md) - active:
  retain Node-only helper isolation while restoring strict SQLite-first GUI startup.
- [Translator language-direction detection](issues/translator-language-direction-detection.md) - fixed:
  use a shared explicit-range classifier, default non-Chinese-majority input to Simplified Chinese,
  and list common Chinese interpretations for English abbreviations.
- [Translator inline retry](issues/translator-inline-retry.md) - fixed: place a clickable
  `Try again` action directly beside retryable translation failures and resubmit the unchanged source.
- [Translator semantic auto direction](issues/translator-llm-direction.md) - fixed: let one LLM
  request infer direction and translate, then reveal the validated `Translate to …` target.
- [EyesOnAgents surface hierarchy](issues/archived/eyes-on-agents-surface-hierarchy.md) - fixed:
  decorative borders replaced by Todo-style background-led Domain and thread-item hierarchy.
- [EyesOnAgents Desktop Focus](issues/archived/eyes-on-agents-desktop-focus.md) - fixed: active Codex Desktop tasks
  missing from Focus when lifecycle observation is absent or expires too early.

## Legacy references

- `doc/colors.md` - historical palette exploration; the current contract is
  [`docs/design/colors.md`](design/colors.md).
- `doc/plan/tasks/` - historical Todo and release tasks.
- `docs/plan/tasks/` - current task files, including tasks created before this index.
- `docs/integrations/coding-agent-sessions*.md` - historical Codex/Claude implementation superseded
  by EyesOnAgents.
