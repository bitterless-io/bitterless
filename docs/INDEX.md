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
- [OnlyPreview sub-application](features/onlypreview.md) - capability-scoped local indexing,
  standalone-only multi-view preview, EyesOnAgents-style MenuBar, settings, and OS file-open routing.
- [BL Trench INDEX](features/trench-index.md) - target CAs, GMGN profit Top 100, central wallet
  registry, hidden encrypted SQLite, and one global INDEX.
- [BL Trench INDEX layout](features/trench-index-layout.md) - count-free INDEX navigation, Add CA,
  Reanalyze, and responsive target/wallet columns.
- [BL Trench person registry](features/trench-person-registry.md) - one person to many wallets,
  profile provenance, current profit projection, X identity, and non-overwriting import.
- [BL Trench navigation and Trenchers layout](features/trench-navigation-layout.md) - Arco two-level
  module navigation plus the person master-detail workspace.
- [BL Trench Sniping workbench layout](features/trench-sniping-layout.md) - third first-level module,
  one quote token per Flap instance, pinned-state simulation, Canary qualification,
  component catalog, generated/JSON configuration, execution rail, readiness, and activity ledger.
- [BL Trench Long-term Monitoring layout](features/trench-long-term-monitoring-layout.md) - fourth
  first-level module, explicit CA watches, finalized Transfer-event buckets, Z-score evidence and
  anomaly history.
- [Legacy BL Trench record vault](features/coin.md) - retained JSON/MCP contract superseded for the
  visible renderer by INDEX.
- [Trench raw JSON detail is hard to read](issues/trench-raw-json-detail-hard-to-read.md) - fixed:
  domain components render readable evidence while exact canonical document copy remains available.
- [BL Trench MCP and skill](features/trench-mcp.md) - production MCP writes, atomic local storage,
  portable external-analysis workflow, and owner acceptance.
- [Todo MCP integration](features/todo-mcp.md) - production-first local Todo access with isolated
  development instances.
- [Todoist-style Todo synchronization](features/todoist-sync.md) - independent encrypted
  per-customer SQLite, HTTP command/outbox sync, working-set-first bootstrap, and shared UI/MCP
  refresh without PowerSync or logical WAL.
- [Todo Domain board layout](features/todo-layout.md) - menu-bar Domain creation, wrapping
  300–480px Focus/Domain columns capped at 80vh, and a detail panel that overlays with panel-width
  horizontal reveal instead of squeezing the board.
- [EyesOnAgents Focus-only board](features/eyes-on-agents-focus-board.md) - one full-width Focus
  column listing every visible thread, retired Domain and Project UI, and an always-visible title filter.
- [EyesOnAgents Project filter](features/eyes-on-agents-project-filter.md) - Git-worktree-derived
  Project metadata; its renderer filter is retired and only resolution/storage remains.
- [EyesOnAgents Codex observation](features/eyes-on-agents-codex-observation.md) - global Hook
  lifecycle, lightweight reliable delivery, Codex trust review, and App Server independence.
- [EyesOnAgents Claude observation](features/eyes-on-agents-claude-observation.md) - provider-aware
  local Claude discovery, Desktop archive metadata, plugin lifecycle Hooks, and Desktop UI Open.
- [EyesOnAgents last user prompt](features/eyes-on-agents-last-user-prompt.md) - narrow capture of one
  bounded latest user question per thread with content-free offline delivery and tiered All-thread
  App Server recovery.
- [Omni browser and mini-app cells](features/omni-miniapp-cells.md) - persistent per-cell browser
  or local Todo/EyesOnAgents/Translator/Motto/Trench/Submodules operation views with development and
  packaged runtime mapping.
- [Shared model providers](features/model-provider.md) - SQLite-backed Codex configuration,
  cross-renderer XPC status, login synchronization, and persisted credential invalidation.
- [Claude subscription accounts](features/claude-subscription-accounts.md) - Main-owned local
  multi-account unmodified-CLI authorization with CLI-owned isolated credentials,
  subscription-only execution, bounded failover, and a loopback Responses endpoint for Codex.
- [Claude subscription accounts layout](features/claude-subscription-accounts-layout.md) - the
  Maestro Workbench Configuration account pool, fixed Local endpoint, isolated sign-in flow, and
  truthful state variants.
- [Translator mini app](features/translator.md) - fixed GPT-5.5 realtime bilingual translation
  inside Omni with thinking disabled, one exact 60-second deadline, strict Zod output, and a
  dedicated sanitized translation log.
- [Submodules mini app](features/submodules.md) - one watched directory, `.gitmodules`-derived
  inventory, live per-submodule branch state, differ-first ordering by name or update time with a
  per-view `Cmd+F` search, locate a submodule inside the running WebStorm, and one renderer hosted by
  both the standalone window and an Omni cell.
- [Submodules Open spawns a second WebStorm window](issues/submodules-open-spawns-second-webstorm-window.md) -
  fixed; owner verification pending: the workspace root is the only project argument and the submodule
  is revealed through a file inside it.
- [Submodules row presentation](issues/submodules-row-presentation.md) - fixed; owner verification
  pending: directory-name title, two-line row (name/branch/action then path/warnings), icon-only Open
  action, and no per-row border or state dot.
- [Submodules window DevTools and 480px minimum](issues/submodules-window-devtools-and-min-width.md) -
  fixed; owner verification pending: debug DevTools opens after show/focus instead of behind the
  window, and the window narrows to 480px with the restore path honoring it.
- [Motto mini app](features/motto.md) - local title/subtitle reminder cards inside Omni with
  whole-array Web Storage persistence.
- [Chat entry visibility](features/chat-entry-visibility.md) - production-default hidden Chat menu
  with a persisted General override and Mini Apps production landing.
- [SQLite migration release gate](features/sqlite-migration-release-gate.md) - strict multi-version
  upgrade audit required before signed production packaging.
- [Startup diagnostics](features/startup-diagnostics.md) - SQLite-first but non-blocking GUI
  startup with main-owned failures surfaced from the Home menubar.
- [Settings notification test](issues/settings-notification-test.md) - one direct native-notification
  smoke test routed from the Settings renderer to Main through XPC.
- [Trench GMGN verification fails under Electron Node mode](issues/trench-gmgn-electron-node-argv.md) -
  fixed: one constrained bootstrap gives Commander the verified Yarn entry as its script path
  while preserving every allowlisted GMGN argument.
- [Settings notification test silently does nothing](issues/settings-notification-test-silent-noop.md) -
  implemented; owner verification pending: retain the native object, observe its lifecycle, and
  return typed visible feedback instead of treating every no-op as success.
- [Application logging and diagnostics](features/application-diagnostics.md) - environment-isolated
  `electron-log`, sanitized Codex lifecycle evidence, and a Settings Log ledger for live paths,
  startup state, directories, and value-free environment status.
- [Command-line launch can reuse release mode](issues/command-line-launch-mode-mismatch.md) - fixed:
  every unpackaged CLI/E2E GUI is explicitly debug, every package is release, and Main rejects
  mismatches before paths, Keychain, SQLite, logging, or windows.
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

- [EyesOnAgents](integrations/eyes-on-agents.md) - Codex App Server plus local Claude observation,
  provider-aware persistence, retained-but-unexposed Domain storage, and Focus/unread semantics.
- [EyesOnAgents layout](integrations/eyes-on-agents-layout.md) - standalone Mini App window,
  single full-width Focus column, compact title/action cards, and responsive interaction states.
- [EyesOnAgents narrow-window reflow](issues/eyes-on-agents-narrow-window-no-reflow.md) - implemented; owner verification pending:
  the renderer root kept the retired 800px floor and clipped instead of re-laying out.
- [EyesOnAgents connections drawer renders behind the board](issues/eyes-on-agents-connections-drawer-behind-board.md) - implemented; owner verification pending:
  a container-anchored Arco drawer inherits no z-index, so the board painted over it.
- [A restarted working thread stays pinned with no visible reason](issues/eyes-on-agents-restart-unknown-pinned.md) - diagnosed; repair pending owner choice:
  after a restart the row is `unknown` + unread, which promotes it to the unread tier while neither the spinner nor the dot renders for it.
- [EyesOnAgents global title search](issues/eyes-on-agents-global-title-search.md) - modal surface superseded by the Focus filter:
  separator-insensitive title matching now narrows the Focus column itself.

## Design system

- [Design system](design/README.md)
- [Color system](design/colors.md) - Royal Blue theme, accent-orange provenance, menu states, and
  the Maestro icon contract.
- [Customer authentication](design/customer-authentication.md) - account lifecycle, deterministic
  login transition, password recovery, General account/logout controls, and login/home visual
  contract.
- [OnlyPreview dual preview views and find ownership](design/onlypreview-preview-merge-find.md) -
  Shell-hosted Preview toolbar plus mutually exclusive `chromePreviewView` / `vuePreviewView`,
  active-surface `Cmd+F` routing, and per-format find capabilities.
- [OnlyPreview preview format coverage](design/onlypreview-format-coverage.md) - per-format engine
  matrix for Chromium-direct HTML/PDF and Vue-rendered code/Markdown/Office/image/media, fidelity
  ceilings, truthful metadata failure states, and the Vue preview-engine dynamic-import exception.

The two OnlyPreview designs are closed at the documented non-E2E implementation level after the
[Task 025 completion audit PASS](plan/reviews/onlypreview-design-completion-025-1.md). Their ledger is
`implemented; owner verification pending`; only Ral's real-app/runtime/visual verification remains.

## Delivery

- [Delivery plan](plan/README.md)
- [Delivery backlog](plan/backlog.md)
- [BL Trench record-vault delivery analysis](plan/analysis/trench-record-vault.md)
- [BL Trench INDEX delivery analysis](plan/analysis/trench-index-analysis.md)
- [BL Trench person registry delivery analysis](plan/analysis/trench-person-registry-analysis.md)
- [BL Trench Sniping workbench design](plan/analysis/trench-sniping-workbench-design.html)
- [BL Trench Long-term Monitoring delivery analysis](plan/analysis/trench-long-term-monitoring-analysis.md)
- [BL Trench Long-term Monitoring visual design](plan/analysis/trench-long-term-monitoring-design.html)
- [Historical Coin delivery analysis](plan/analysis/coin-subapp.md)
- [EyesOnAgents delivery analysis](plan/analysis/eyes-on-agents.md)
- [EyesOnAgents Claude delivery analysis](plan/analysis/eyes-on-agents-claude.md)
- [Omni mini-app cells delivery analysis](plan/analysis/omni-miniapp-cells.md)
- [OnlyPreview MVP delivery analysis](plan/analysis/onlypreview.md)
- [Translator delivery analysis](plan/analysis/translator.md)
- [Motto delivery analysis](plan/analysis/motto.md)
- [SQLite migration release-gate analysis](plan/analysis/sqlite-migration-release-gate.md)
- [Claude subscription accounts delivery analysis](plan/analysis/claude-subscription-accounts.md)
- [Todoist-style Todo sync delivery analysis](plan/analysis/todoist-sync.md)

## Issues

- [E2E target-display routing](issues/e2e-target-display-routing.md) - fixed: isolated Playwright
  Electron windows route to an exact configured physical-display label before first show, without
  changing production placement or claiming a macOS Mission Control Space.
- [Settings notification test silently does nothing](issues/settings-notification-test-silent-noop.md) -
  implemented; owner verification pending: signed `0.0.68` exposed the failure; the next build
  retains the native instance and returns an observable lifecycle result.
- [Translator latency and GPT-5.5 thinking](issues/translator-timeout-and-thinking-off.md) -
  implemented; owner verification pending: preserve the exact 60-second request deadline and
  explicitly send GPT-5.5 reasoning effort `none` for Translator only.
- [Translator remains translating after successful Codex login](issues/translator-runtime-stall-and-missing-log.md) -
  implemented; owner verification pending: every translation preparation stage is deadline-bound
  and sanitized execution evidence persists outside the shared application log.
- [Settings notification test](issues/settings-notification-test.md) - implemented; owner
  verification pending: a top-level Notification module immediately above Log exposes one
  XPC-backed `notification test` action.
- [Packaged failures have no persistent application log](issues/application-file-logging-missing.md) -
  implemented; owner verification pending: environment-isolated UTC NDJSON logging, safe Codex
  lifecycle evidence, and a Settings Log diagnostics ledger are available.
- [GPT-5.5 removed by GPT-5.6 migration](issues/codex-gpt55-removed-by-gpt56-migration.md) -
  in progress: keep GPT-5.5 in shared, Coin, and Maestro model catalogs while retaining GPT-5.6
  additions and the fixed GPT-5.5 Translator target.
- [Codex Model login cancellation regression](issues/codex-model-login-cancel-regression.md) -
  reopened 2026-08-20: the spinning Cancel was a symptom of a wedged login attempt. Provider-level
  cancel is now deadline-bounded and instrumented, so it always settles and publishes `unavailable`.
- [Codex browser login success stuck in Setting](issues/codex-model-login-browser-success-stuck.md) -
  root cause found 2026-08-20: a succeeded login never returned because the IPv6 callback
  companion's `server.close()` waited on a browser socket forever. Teardown now forces connections
  shut behind a deadline.
- [Connected Codex account is not identified](issues/codex-connected-account-not-identified.md) -
  open: no surface names which ChatGPT account Bitterless is signed into, so a Bitterless-vs-CLI
  account difference is invisible.
- [Omni remote-browser identity profiles](issues/browser-identity-inconsistent-across-embedded-views.md) -
  implemented; owner verification pending: default sites now keep stock Electron identity while
  Google/YouTube use a dedicated session with the verified honest Bitterless UA.
- [Omni root-axis collapse size mismatch](issues/omni-root-axis-collapse-size-mismatch.md) -
  implemented; owner verification pending: immutable tree edits, lifecycle-event rejection, and one
  serialized Main commit keep `H[V,V]` renderer borders and native bounds on the same geometry.
- [Omni inactive-window first-click focus](issues/omni-inactive-window-first-click-focus.md) -
  implemented; owner verification pending: the macOS activation click reaches the exact Website or
  Mini App child `WebContentsView` so a different cell's input can focus without a second click.
- [OnlyPreview PDF preview paints blank](issues/onlypreview-pdf-blank-in-memory-partition.md) -
  implemented; owner verification pending: the raw Chromium view's in-memory session partition stopped
  Chromium's PDF viewer from creating its document frame, so it now uses one constant `persist:`
  partition and serves the PDF from Chromium's network service instead of Main-process IO.
- [OnlyPreview raw view has no DevTools or Inspect menu](issues/onlypreview-chrome-view-devtools-and-inspect-menu.md) -
  reported 2026-08-21: debug auto-opens DevTools only for the Vue preview view, and no OnlyPreview
  view offers a right-click Inspect entry.
- [Todo SQLCipher owned by Main](issues/todo-sqlite-owned-by-main-process.md) - fixed; owner verification pending:
  the complete synchronized Todo runtime now lives in Core SQLite preload; Main only routes XPC,
  hosts MCP, exposes narrow OS capabilities, and recovers the hidden process lifecycle.
- [Todo Domain refresh flicker](issues/todo-domain-refresh-flicker.md) - fixed; owner verification pending:
  atomic snapshot reconciliation and origin-aware broadcasts keep synchronized updates from
  emptying and rebuilding every visible column.
- [Todo Domain column dead selector](issues/todo-domain-column-dead-selector.md) - fixed; owner
  verification pending: `da.domain-column` silenced the whole width/flex contract, and the layout
  regression now anchors selector lookup so a dead rule cannot satisfy it.
- [macOS notarization upload timeout](issues/macos-dmg-notarization-upload-timeout.md) -
  implemented; owner verification pending: retain Apple's accelerated route while adding visible,
  bounded network-only retry for application and DMG submissions.
- [OSS release large-artifact timeout](issues/oss-release-large-artifact-timeout.md) - fixed:
  production `0.0.60` proved multipart ZIP/DMG upload, remote-size verification, semantic release
  ordering, manifest-last publication, and post-upload CDN refresh.
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
- [Customer session disappears after restart](issues/customer-auth-restart-session-loss.md) -
  implemented; owner restart verification pending: transient `/auth/me` failures preserve the
  saved token and offer retry without opening protected routes or requiring credentials again.
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
- [EyesOnAgents completed unknown task stays in Focus after Open](issues/eyes-on-agents-completed-unknown-stuck-focus.md) - implemented; owner verification pending:
  valid newest-turn terminal evidence now settles a stale `unknown + unread` row, and Open performs
  that sync before its final acknowledgement.
- [EyesOnAgents working cards reorder during replies](issues/eyes-on-agents-working-order-churn.md) - implemented; owner verification pending:
  active presentation now follows current-state entry time plus an immutable tie-breaker rather
  than message-driven activity.
- [EyesOnAgents completion alert](issues/eyes-on-agents-completion-alert.md) - fixed and runtime verified:
  each newly accepted successful completion should play the supplied tone and send one localized
  native notification without duplicate alerts from Hook, App Server, or polling races.
- [EyesOnAgents global title search](issues/eyes-on-agents-global-title-search.md) - modal surface superseded by the Focus filter:
  `Cmd+F` now activates the Focus column's own token title filter instead of a separate result list.
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
