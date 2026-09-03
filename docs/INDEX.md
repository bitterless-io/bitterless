# Bitterless Documentation

This directory is the entry point for current Bitterless design and delivery documents.
Older implementation notes remain under `doc/` and are reference-only unless linked from a current
design document.

## Feature contracts

- [Renderer language coordination](features/renderer-i18n.md) - one main-process language authority,
  live updates for every first-party renderer, and correct locale before recreated windows mount.
- [Maestro sub-application](features/maestro.md) - the Bitterless Mini App migrated from the
  Micromeet Cowork runtime.
- [Maestro Control chat behind Cowork](issues/maestro-control-chat-behind-cowork.md) - implemented;
  owner verification pending: migrated the current Turn/status/task and attachment/file-reading
  chat vertical slices from Cowork `67b056b` while preserving Maestro providers, i18n, replay,
  local Home, and Royal Blue/BEM UI; core [review 1](plan/reviews/maestro-cowork-chat-core-089-1.md)
  and files [review 1](plan/reviews/maestro-cowork-chat-files-090-1.md) passed.
- [Maestro SQLite build older than migration](issues/maestro-sqlite-build-version-behind-migration.md) -
  implemented; owner verification pending: advanced the canonical build after migration
  `260831200000`, retained history and the fail-closed guard, and passed the complete migration
  matrix plus [review 1](plan/reviews/maestro-sqlite-build-version-093-1.md).
- [Maestro external tools packaged inside ASAR](issues/maestro-tools-packaged-inside-asar.md) -
  implemented; owner initialization/package verification pending: initialize Bun, ripgrep, fd,
  Ouch, and AnyDoc once for macOS ARM, macOS Intel, and Windows, then stage one validated target
  offline into `Resources/maestro-tools` without ASAR cache duplication;
  [review 1](plan/reviews/maestro-external-tools-094-1.md) passed.
- [Unused youtube-dl-exec blocks dependency installation](issues/youtube-dl-exec-postinstall-rate-limit.md) -
  fixed: removed the unused helper and its unauthenticated GitHub Releases postinstall from the
  dependency graph; [review 1](plan/reviews/desktop-youtube-dl-removal-003-1.md) passed.
- [Maestro main-window IoC split](features/maestro-window-ioc.md) - controller plus native-view
  services with unchanged XPC and runtime behavior.
- [Maestro startup host flash and MenuBar](issues/maestro-startup-host-flash-and-menubar.md) -
  implemented; owner verification pending: keep authenticated Home hidden until ready Maestro and
  derive 44px chrome from Omni Browser.
- [Maestro Cowork MenuBar control parity](issues/maestro-cowork-menubar-controls-outdated.md) -
  implemented; owner verification pending: compact 36px chrome, current controls, and a bundled
  local Home fixed tab.
- [Maestro MenuBar tab inset](issues/maestro-menubar-tabs-not-inset.md) - implemented; owner
  verification pending: center four-corner rounded tabs inside the existing 36px strip and move
  macOS traffic lights down 1px; [review 1](plan/reviews/maestro-menubar-tab-inset-077-1.md) passed.
- [Maestro tab icon actions](issues/maestro-tab-icon-actions-not-iconbtn.md) - implemented; owner
  verification pending: render the tab close and New-tab controls through the shared `IconBtn`
  with centered Tabler SVG glyphs; [review 1](plan/reviews/maestro-tab-iconbtn-controls-078-1.md)
  passed.
- [Maestro compact address row](issues/maestro-address-row-too-tall.md) - implemented; owner
  verification pending: reduce the address row to 42px, align navigation and address at 28px, and
  keep Main's first-frame native-view offset synchronized at 78px;
  [review 1](plan/reviews/maestro-address-row-compact-082-1.md) passed.
- [Maestro Control entries and Arco theme](issues/maestro-control-connector-demo-and-arco-blue.md) -
  implemented; owner verification pending: retire the empty Control Connector and visible Demo
  entries while restoring the canonical Royal Blue theme for Maestro Arco Buttons.
- [Maestro per-tab page loading](issues/maestro-global-page-load-progress.md) - implemented;
  owner verification pending:
  replace the global simulated progress bar with favicon-slot loading icons and a 30-second
  Main-process watchdog.
- [Maestro fixed Home workspace](issues/maestro-local-home-still-shows-chat.md) - implemented;
  owner verification pending: replace the duplicate Chat surface with Mini Apps and Connector on
  the familiar 56px rail, hide its Settings button, use Bitterless artwork for Home/New-tab
  branding, and keep fixed-Home DevTools available in debug runtimes.
- [Maestro fixed Home Login gate](issues/maestro-local-home-login-missing.md) - implemented; owner
  verification pending: retain Maestro as the only visible primary, reuse the original Login
  experience before Mini Apps, and keep the hidden Home renderer as the sole token/auth authority;
  [review 1](plan/reviews/maestro-local-home-auth-gate-096-1.md) passed.
- [Maestro Workbench Account tab](issues/maestro-workbench-account-tab-missing.md) - implemented;
  owner verification pending: moved identity/logout from General into Settings → Account and made
  logout close Workbench and deterministically reveal pinned Home on Login;
  [review 1](plan/reviews/maestro-workbench-account-logout-097-1.md) passed.
- [Mini Apps card action alignment](issues/miniapp-card-action-alignment.md) - implemented; owner
  verification pending: keep every fixed-Home card at `320 × 184px`, clamp descriptions to three
  lines, and pin Open actions to one bottom baseline; [review 1](plan/reviews/miniapp-card-layout-003-1.md)
  passed.
- [Maestro Cmd+Q reveals hidden Home](issues/maestro-quit-reveals-hidden-home.md) - implemented;
  owner verification pending: resolve dialog ownership across visible BaseWindows and never parent
  quit confirmation to the hidden legacy Home runtime; [review 1](plan/reviews/maestro-quit-dialog-parent-009-1.md)
  passed.
- [Maestro hot reload reveals legacy Home](issues/maestro-hot-reload-reveals-legacy-home.md) -
  implemented; owner verification pending: Maestro is the sole visible primary across startup,
  HMR, activation, logout, and invalidation; legacy Home is a hidden-only compatibility runtime.
- [Maestro window reopen performs a full cold boot](issues/maestro-window-reopen-cold-boot.md) -
  implemented; owner packaged verification pending: normal close reuse remains fast, cold Open now
  shows at primary Shell/Home host mount, optional startup is non-destructive, and Settings-only
  Monaco stays out of startup; [task 117 review 1](plan/reviews/desktop-first-visible-performance-117-1.md)
  passed.
- [OnlyPreview sub-application](features/onlypreview.md) - capability-scoped local indexing,
  standalone-only multi-view preview, EyesOnAgents-style MenuBar, settings, and OS file-open routing.
- [OnlyPreview Main filesystem I/O](issues/onlypreview-main-filesystem-io.md) - implemented; owner
  runtime verification pending: potentially large project-content traversal, mutation, open and
  byte delivery now stay inside trusted renderer preloads while Main retains bounded configuration
  and operational persistence; [Task 087 review 1](plan/reviews/onlypreview-main-fs-boundary-audit-087-1.md)
  passed.
- [OnlyPreview indexing benchmark](features/onlypreview-indexing-benchmark.md) - `tests/indexing/`
  measures open directory -> first Global Search over a deterministic corpus, in process and without
  Electron, and guards the machine-independent invariants under `node --test`.
- [OnlyPreview XLSX compatibility gaps](issues/onlypreview-xlsx-compatibility-gaps.md) - fixed in
  source; owner verification pending: replace arbitrary-byte benchmark XLSX fixtures and recover
  one bounded empty-sheet producer form through a Worker-normalized, single-load OOXML path;
  [review 1](plan/reviews/onlypreview-xlsx-compatibility-repair-088-1.md) passed.
- [OnlyPreview Project selection is too muted](issues/onlypreview-project-selection-blue-too-muted.md) -
  implemented; owner verification pending: replace the ordinary Project tree's grey-blue selected
  surface with a clearer light blue while preserving hover, focus, and Search-excluded orange
  semantics; [review 1](plan/reviews/onlypreview-project-selection-blue-091-1.md) passed.
- [OnlyPreview Global Search Office preview switching](issues/onlypreview-global-search-office-preview-switching.md) -
  implemented; owner verification pending: render XLSX/XLSM, DOCX, and PPTX in the bottom Search
  pane through an independent bounded preload lane, coalesce rapid selection to one latest-only
  Viewer session, and fail closed on stale/read-error resources;
  [review 1](plan/reviews/onlypreview-global-search-office-preview-092-1.md) passed.
- [OnlyPreview rejects a valid Draw.io file while its mount is not visible](issues/onlypreview-drawio-deferred-viewer-ready.md) -
  fixed in source; owner verification pending: preserve the local iframe-free viewer while waiting
  through a bounded cancellable pre-vendor visibility gate instead of treating a zero-width
  ContentView transition as a parse failure; [review 1](plan/reviews/onlypreview-drawio-deferred-viewer-ready-099-1.md)
  passed.
- [OnlyPreview PDF Search overlay and Find readiness](issues/onlypreview-pdf-search-overlay-and-find-readiness.md) -
  fixed in source; owner verification pending: full-window transparent native Search overlay,
  exact PDF document-frame readiness, topmost re-raise, and queued Chromium Find dispatch;
  [review 1](plan/reviews/onlypreview-pdf-search-overlay-find-100-1.md) passed.
- [OnlyPreview image rotation and media playback](issues/onlypreview-image-rotation-and-media-playback.md) -
  fixed in source; owner verification pending: keep native audio/video controls and add
  non-destructive quarter-turn image rotation with rotated fit/pan bounds;
  [review 1](plan/reviews/onlypreview-image-rotation-media-regression-101-1.md) passed.
- [OnlyPreview external file open replaces the current Project](issues/onlypreview-external-file-replaces-project.md) -
  implemented; owner verification pending: keep the visible Project while an explicit file outside
  it opens through an exact single-file Preview authority with no selected Project row; shared FIFO
  and revoke fencing passed [review 1](plan/reviews/onlypreview-external-file-preview-098-1.md).
- [OnlyPreview Project width is not persisted](issues/onlypreview-project-width-not-persisted.md) -
  implemented; owner verification pending: restore the renderer-local Project directory width,
  throttle drag persistence, and flush the final value on pointer and real page teardown;
  [review 1](plan/reviews/onlypreview-project-width-persistence-102-1.md) passed.
- [OnlyPreview action failures leave no diagnostic record](issues/onlypreview-operation-failure-has-no-log.md) -
  fixed; owner verification pending: name every Main API operation and record its sanitized cause in
  a dedicated per-profile `onlypreview/onlypreview.log`, so a generic
  `OnlyPreview could not complete this action.` is triageable instead of evidence-free.
- [OnlyPreview open latency is not fully traceable](issues/onlypreview-open-latency-is-not-traceable.md) -
  implemented; owner packaged verification pending: the native graph shows after Shell attachment
  and restored-Project initialization uses a cancelable microtask instead of the suppressed 750ms
  renderer timer, so root listing is deterministic; [task 117 review 1](plan/reviews/desktop-first-visible-performance-117-1.md)
  passed.
- [OnlyPreview restored Project index is scheduled but never starts](issues/onlypreview-restored-project-index-never-starts.md) -
  fixed in source; owner verification pending: bind the deferred microtask through a valid browser receiver, record schedule/action
  failures, and remove the unrelated hidden `fileSearch` Vite/CSP false alarm without weakening CSP.
- [OnlyPreview holds a rendered document behind full pagination](issues/onlypreview-docx-waits-for-full-pagination.md) -
  fixed; owner verification pending: present DOCX/PPTX at the first laid-out unit and keep the
  remaining pagination behind the visible preview, with the full-document barrier retained as the
  fallback that still guards the empty check.
- [Markdown preview shows front matter instead of starting at the body](issues/onlypreview-markdown-front-matter-renders-as-heading.md) -
  fixed in source; owner verification pending: strip valid leading YAML front matter before
  Markdown compilation and render only the body, with no metadata card or replacement UI.
- [OnlyPreview Preview-channel skill mounting is not obvious](issues/onlypreview-preview-channel-skill-mount-guide.md) -
  implemented; owner verification pending: the existing Guide identifies the `bitterless-preview`
  MCP alias and bundled complete skill in one localized sentence, then makes a later Production
  Guide the direct overwrite path back to production `bitterless`.
- [OnlyPreview loses Project position and rerenders an unchanged Preview on a file update](issues/onlypreview-watch-update-resets-project-and-preview.md) -
  implemented; owner verification pending: browse capabilities survive a reconcile and every open
  directory is republished, so the tree keeps its selection/expansion/scroll; the Preview rebuilds
  only when the selected file's own metadata moved, and a deleted selection hands the tree row to
  its neighbour.
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
- [Preview reports a missing sign-in as a local data runtime failure](issues/preview-channel-todo-reports-runtime-failure.md) -
  fixed; owner verification pending: an install with no eligible customer session now asks for a
  sign-in instead of blaming local SQLite, on the board, its write path, and the home placeholder.
- [EyesOnAgents Focus-only board](features/eyes-on-agents-focus-board.md) - one full-width Focus
  column listing every visible thread, retired Domain and Project UI, and a keyboard-first search modal.
- [EyesOnAgents Project filter](features/eyes-on-agents-project-filter.md) - Git-worktree-derived
  Project metadata; its renderer filter is retired and only resolution/storage remains.
- [EyesOnAgents Codex observation](features/eyes-on-agents-codex-observation.md) - global Hook
  lifecycle, lightweight reliable delivery, Codex trust review, and App Server independence.
- [EyesOnAgents Claude observation](features/eyes-on-agents-claude-observation.md) - provider-aware
  local Claude discovery, Desktop archive metadata, plugin lifecycle Hooks, and Desktop UI Open.
- [EyesOnAgents last user prompt](features/eyes-on-agents-last-user-prompt.md) - narrow capture of one
  bounded latest user question per thread with content-free offline delivery and tiered All-thread
  App Server recovery.
- [EyesOnAgents iTerm2 Open](features/eyes-on-agents-iterm2-open.md) - implemented; owner runtime
  verification pending: Hook-captured iTerm2 terminal identity makes CLI-only Claude sessions
  visible and adds an independent `iterm2:///reveal` Open action beside the existing Claude Desktop
  route.
- [EyesOnAgents Claude Multi-Environment](features/eyes-on-agents-claude-multi-environment.md) -
  draft: N independently-managed `CLAUDE_CONFIG_DIR` environments (own watcher, own hook install
  target, Hook-attributed `claude_config_dir`), superseding the single-directory model.
- [Omni browser and mini-app cells](features/omni-miniapp-cells.md) - persistent per-cell browser
  or local Todo/EyesOnAgents/Translator/Motto/Trench/Submodules operation views with development and
  packaged runtime mapping.
- [Omni Open returns before the browser is ready](issues/omni-open-readiness-and-double-navigation.md) -
  implemented; owner packaged verification pending: the sub-100ms restored native graph now shows
  before renderer readiness while the shared Open promise, progressive content, focus behavior, and
  exact-once cleanup remain intact; [task 117 review 1](plan/reviews/desktop-first-visible-performance-117-1.md)
  passed.
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
  two-level inventory with expandable nested submodules, live per-submodule branch state, differ-first
  ordering by name or update time with a per-view `Cmd+F` search, locate a submodule inside the
  running WebStorm, and one renderer hosted by both the standalone window and an Omni cell.
- [Submodules Open spawns a second WebStorm window](issues/submodules-open-spawns-second-webstorm-window.md) -
  fixed; owner verification pending: the workspace root is the only project argument and the submodule
  is revealed through a file inside it.
- [Submodules row presentation](issues/submodules-row-presentation.md) - fixed; owner verification
  pending: directory-name title, two-line row (name/branch/action then path/warnings), icon-only Open
  action, and no per-row border or state dot.
- [Submodules window DevTools and 480px minimum](issues/submodules-window-devtools-and-min-width.md) -
  fixed; owner verification pending: debug DevTools opens after show/focus instead of behind the
  window, and the window narrows to 480px with the restore path honoring it.
- [Motto mini app](features/motto.md) - directly editable, persistently ordered title/subtitle
  reminder cards inside Omni with whole-array Web Storage persistence.
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
- [Desktop release channels](features/desktop-release-channels.md) - Stable and Preview share the
  production API while keeping package identity, local persistence, artwork, updater feeds, and
  published artifacts strictly separate.
- [Development package metadata blocks Stable publication](issues/stable-publish-dev-dist-contamination.md) -
  implemented; owner release verification pending: Development release artifacts now use
  `dist/dev/` and can no longer replace Stable's `dist/version_info.json` with `channel: dev`.
- [Preview publication missing release-version helper](issues/preview-publish-version-log-helper-missing.md) -
  implemented; owner publication completion pending: restored the valid-existing-remote preflight
  branch without a task-owned bump or release mutation; a later operator retry advanced to
  `0.0.81 / 260901100557` and entered the build; [review 1](plan/reviews/release-preview-version-log-008-1.md)
  passed.
- [Stable and Preview can publish the same release identity](issues/cross-channel-release-version-identity-collision.md) -
  implemented; owner release verification pending: publication now refuses a `version` or
  `version_code` another channel already published, and one canonical cut is reused across every
  platform; macOS ARM Preview auto-cuts while `yarn release:cut` remains the explicit alternative.
- [Preview macOS ARM publish does not cut a new version](issues/preview-mac-arm-publish-does-not-cut-version.md) -
  fixed in source; owner publication verification pending: the ordinary macOS ARM Preview command
  is the single one-step cut/build/publish entry while Intel and Windows reuse its identity;
  [review 1](plan/reviews/release-preview-mac-arm-auto-cut-115-1.md) passed.
- [Packaged app-update.yml points at a placeholder host](issues/packaged-update-feed-url-placeholder.md) -
  implemented; owner package verification pending: `afterPack` writes the exact channel/platform
  updater directory from the mapping shared with the runtime, and the package audit rejects a
  placeholder, cross-channel, or cross-platform feed before signing.

## Guides

- [Maestro CLI executable installation](guides/maestro-cli-executable-installation.md) - pinned
  three-platform external-tool initialization, offline package staging, resource layout, upgrades,
  integrity checks, and recovery.
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
- [EyesOnAgents global title search](issues/eyes-on-agents-global-title-search.md) - restored as a
  keyboard-selected modal whose results reuse the complete normal thread card; shortcut/button
  opening focuses the input, and every close path clears transient state without stale callback
  revival; [review 072-1](plan/reviews/eyes-on-agents-search-shortcut-focus-reset-072-1.md) passed.
- [EyesOnAgents search input loses its store receiver](issues/eyes-on-agents-search-input-unbound-store-method.md) -
  fixed; owner verification pending: receiver-safe component wrappers and mounted Arco interaction
  coverage prevent the first-keystroke crash and the same Focus Search-button failure.
- [EyesOnAgents card context menu and Codex archive](issues/eyes-on-agents-card-context-menu-archive.md) -
  implemented; owner verification pending: right-click opens and repositions the complete shared
  card menu at the pointer with viewport fitting, while Codex cards expose provider-authoritative
  Archive; [review 1](plan/reviews/eyes-on-agents-card-context-menu-archive-071-1.md) passed.

## Design system

- [Design system](design/README.md)
- [Color system](design/colors.md) - Royal Blue theme, accent-orange provenance, menu states, and
  the Maestro icon contract.
- [Customer authentication](design/customer-authentication.md) - account lifecycle, deterministic
  login transition, password recovery, Settings Account/logout controls, and login/home visual
  contract.
- [OnlyPreview dual preview views and find ownership](design/onlypreview-preview-merge-find.md) -
  Shell-hosted Preview toolbar plus mutually exclusive `chromePreviewView` / `vuePreviewView`,
  active-surface `Cmd+F` routing, and per-format find capabilities.
- [OnlyPreview preview format coverage](design/onlypreview-format-coverage.md) - per-format engine
  matrix for Chromium-direct HTML/PDF and Vue-rendered code/Markdown/Office/Draw.io/image/media,
  fidelity ceilings, truthful metadata failure states, adapter size policy, lazy Vue components,
  and `.cjs` parity with `.js` across Monaco, Project Search, and file associations.
- [OnlyPreview Office OOXML renderers](plan/tasks/onlypreview-office-ooxml-renderers-077.md) -
  implemented unification of XLSX/XLSM, DOCX, and PPTX on pinned, per-format lazy
  `@silurus/ooxml` viewers with bounded worker-mode rendering and complete model-backed
  search/highlight.
- [OnlyPreview OOXML Viewer runtime failure](issues/onlypreview-ooxml-viewer-runtime-failure.md) -
  fixed in source; owner verification pending: XLSX/XLSM, DOCX, and PPTX use the sandboxed pinned
  OOXML Viewer path with preload-owned reads, Find/highlight, and phase-specific diagnostics;
  [review 1](plan/reviews/onlypreview-ooxml-viewer-runtime-repair-081-1.md) passed.
- [OnlyPreview unsupported default-app action](plan/tasks/onlypreview-unsupported-default-app-078.md) -
  implemented in-page, capability-scoped recovery for every file-backed metadata failure state
  while Main remains the sole owner of real-path resolution and system opening.
- [OnlyPreview Project error dismissal and tree typography](plan/tasks/onlypreview-project-error-dismiss-tree-typography-079.md) -
  implemented localized dismissal for Project errors plus 13px/500 Project tree entry names with
  unchanged row geometry and interactions; owner verification remains pending.
- [OnlyPreview Project index protocol failure is reported as a Preview stream error](issues/onlypreview-project-index-protocol-preview-error.md) -
  implemented pending owner verification: the rich-format `previewHint`/search `mediaType`
  contract is restored, malformed current-generation index events fail immediately with dedicated
  Project wording, and [independent review 3](plan/reviews/onlypreview-project-index-protocol-validation-080-3.md)
  passed with no finding.
- [OnlyPreview Global Search and result preview](design/onlypreview-global-search.md) - remove the
  Project-side search field, place Contents and Files in parallel result columns above one bounded
  lazy file-content Preview, make the workspace root the first Project tree row, fence visible rows
  by the exact current literal query, immediately rerun non-empty queries when Contents scope
  changes, and float the complete rounded workspace inside a transparent Search view with a 24px
  body gutter.
- [Global Search bottom Preview shows match context instead of the file](issues/onlypreview-global-search-context-preview-wrong.md) -
  implemented pending owner verification: preserve the Contents row snippet while replacing its
  enlarged context panel with the same bounded VuePreview-style file-head rendering used by Files;
  [task 073 review 1](plan/reviews/onlypreview-global-search-file-content-preview-073-1.md) passed
  with no finding.
- [OnlyPreview directory selection and Global Search file scope](issues/onlypreview-directory-selection-and-global-file-scope.md) -
  tasks 038 and 072 implemented pending owner verification: single-click Current directory
  selection, double-click row-body expansion, one-click arrow disclosure, project-wide
  file/directory names, directory-scoped Contents, and a deliberately plaintext disposable
  file-search SQLite index; [task 072 review 1](plan/reviews/onlypreview-tree-disclosure-toggle-072-1.md)
  passed with no finding.
- [OnlyPreview Search-exclusion Project markers](issues/onlypreview-search-exclusion-tree-markers.md) -
  implemented pending owner verification: pale-orange rows for excluded files, directories, and
  descendants, with solid accent-orange excluded folder icons and no extra filesystem I/O;
  [independent review 2](plan/reviews/onlypreview-search-exclusion-markers-039-2.md) passed.
- [OnlyPreview Global Search concurrency and directory UX](issues/onlypreview-global-search-concurrency-and-directory-ux.md) -
  implemented pending owner verification: cooperative Files/Contents work, folder-first Files
  results, live Current directory rebinding, nested folder reveal/focus, and truthful `folder`
  display type; [independent review 1](plan/reviews/onlypreview-global-search-concurrency-directory-ux-040-1.md)
  passed.
- [OnlyPreview first search waits for startup reconciliation](issues/onlypreview-first-search-startup-delay.md) -
  implemented pending owner verification: the live sample showed a 33.024s initial-tree
  gate while post-gate Contents/Files take only 0.665s/0.817s. Task 042 serves the last committed
  snapshot immediately and terminal-replaces it after background reconciliation;
  [independent review 2](plan/reviews/onlypreview-warm-search-before-reconcile-042-2.md) passed, as
  did the diagnostic timeline's
  [independent review 3](plan/reviews/onlypreview-search-startup-diagnostics-041-3.md).
- [OnlyPreview cold folder search and PDF overlay ordering](issues/onlypreview-cold-folder-search-and-native-search-overlay.md) -
  implemented pending owner verification: task
  [043](plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md) derives provisional warm
  directory ancestors, bounds watcher/cache recovery, and moves Search into a dedicated topmost
  `WebContentsView`; [independent review 10](plan/reviews/onlypreview-cold-folders-native-search-overlay-043-10.md)
  passed with no P1/P2/P3 finding.
- [OnlyPreview Files section rescans every tree entry on every query](issues/onlypreview-files-section-per-query-rescan.md) -
  proposed: the Files group is answered by a scope-blind in-memory rescan costing 1.5us per tree entry
  per query - about 200ms on a 130,000-entry workspace - while the normalised name it recomputes is
  already stored in `files.normalized_title`. Task
  [071](plan/tasks/onlypreview-files-section-sql-lookup-071.md) is blocked on one product decision:
  does the Files group stay project-wide.
- [OnlyPreview indexing plan comparison and evaluation](design/onlypreview-indexing-plan-evaluation.md) -
  four indexing designs behind one interface, ten evaluation dimensions with the first four as gates,
  a 39-gate lifecycle battery that was mutation-tested, and the measured ranking.
- [OnlyPreview indexing throughput](design/onlypreview-indexing-throughput.md) - measured
  open-directory-to-first-search cost: a 6000-file project takes 24.1s cold and 2.4s on every later
  launch, 30% of the warm path is the redundant count plus candidate copy, and the cold build is
  chunking, FTS trigram insert, commit frequency, and work-slicer pauses. Ranks seven repairs and
  concludes that a `worker_threads` pool (4.8x) replaces the case for a Rust chunker (6.0x).

The pre-Draw.io OnlyPreview designs were closed at the documented non-E2E implementation level after the
[Task 025 completion audit PASS](plan/reviews/onlypreview-design-completion-025-1.md). Their ledger is
`implemented; owner verification pending`; task 032 extends that contract with an implemented
no-iframe Draw.io viewer and adapter-driven Vue component loading. Its
[final independent review 3](plan/reviews/onlypreview-drawio-readonly-032-3.md) passed after both
earlier review rounds were remediated; Ral's runtime/visual verification remains pending.

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
- [Translator provider failure detail missing from production logs](issues/translator-provider-error-log-detail-missing.md) -
  implemented; owner verification pending: transport fallback and typed terminal evidence remain
  independently diagnosable without persisting provider text or response bodies.
- [Translator final input is not dispatched](issues/translator-final-input-not-dispatched.md) -
  implemented; owner verification pending: a trailing-only debounce and source-revision submission
  identity prevent the final complete input from being suppressed as a text duplicate.
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
- [Codex network requests bypass the local proxy](issues/codex-network-bypasses-local-proxy.md) -
  implemented; owner verification pending: strict Clash TUN routing plus an explicit profile-local
  Bitterless proxy protect OAuth token exchange and model requests while keeping both localhost
  callback families direct.
- [Connected Codex account is not identified](issues/codex-connected-account-not-identified.md) -
  open: no surface names which ChatGPT account Bitterless is signed into, so a Bitterless-vs-CLI
  account difference is invisible.
- [Omni remote-browser identity profiles](issues/browser-identity-inconsistent-across-embedded-views.md) -
  implemented; owner verification pending: both profiles now use native Electron/Chromium
  identity while the Google session remains only an isolated cookie jar; [review 1](plan/reviews/omni-native-browser-identity-006-1.md)
  passed.
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
- [Preview release-channel analysis](plan/analysis/desktop-preview-release-channel.md) and
  [delivery task](plan/tasks/release-preview-channel-007.md) - completed: production-backed Preview
  runtime isolation, dedicated artwork, three one-step publishers, and the signed/notarized macOS
  ARM `0.0.79` release proof without mutating Stable manifests. Intel and Windows remain unpublished.
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
  longer blocked or misreported by optional local runtime activation; account controls are being
  moved from General into the dedicated Workbench Settings Account category.
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
  a still-working thread must retain active attention after Open; runtime attention and read
  acknowledgement remain separate facts.
- [EyesOnAgents completed unknown task stays in Focus after Open](issues/eyes-on-agents-completed-unknown-stuck-focus.md) - implemented; owner verification pending:
  valid newest-turn terminal evidence now settles a stale `unknown + unread` row, and Open performs
  that sync before its final acknowledgement.
- [EyesOnAgents working cards reorder during replies](issues/eyes-on-agents-working-order-churn.md) - implemented; owner verification pending:
  visible unread-dot sessions precede working, while active rows still use current-state entry time
  plus an immutable tie-breaker rather than message-driven activity.
- [EyesOnAgents completion alert](issues/eyes-on-agents-completion-alert.md) - fixed and runtime verified:
  each newly accepted successful completion should play the supplied tone and send one localized
  native notification without duplicate alerts from Hook, App Server, or polling races.
- [EyesOnAgents global title search](issues/eyes-on-agents-global-title-search.md) - restored by task 067:
  `Cmd+F` toggles a separate card-result modal without narrowing the Focus board.
- [EyesOnAgents App Server frame overflow](issues/eyes-on-agents-app-server-frame-overflow.md) - implemented; owner verification pending:
  opted-in latest-question recovery must not aggregate ten complete turns into a frame that kills
  the managed Codex App Server connection.
- [macOS stale Dock icon](issues/macos-dock-icon-stale.md) - superseded: explicit ICNS generation
  remains, while the size-mismatch follow-up below removes the runtime PNG refresh.
- [macOS Dock icon runtime size mismatch](issues/macos-dock-icon-runtime-size-mismatch.md) - fixed;
  owner verification pending: the running tile now keeps the bundle-default size without a PNG override.
- [Desktop automatic-update polling stalls](issues/desktop-auto-update-polling-stalls.md) - fixed;
  owner verification pending: metadata disagreement now releases the shared check so later polls retry.
- [Claude subscription decision schema rejected](issues/claude-subscription-decision-schema-rejected.md) -
  fixed; owner verification pending: the `--json-schema` decision contract used a top-level `oneOf`,
  which the API rejects as a tool `input_schema`, so every subscription inference failed with a 400
  before reaching the model. Flattened to an enum `action`; the per-variant rule stays in validation.
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
