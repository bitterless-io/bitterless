# Bitterless Documentation

- [Zellij chrome 改成终端的样子](features/zellij-terminal-chrome.md) — implemented; owner testing pending;
  工具条降到 42px(与 Cowork 地址栏一致),配色整条取自终端**自己**的 `web_client.theme`
  (背景 `#1a1b26`、主题绿 `#9ece6a`),等宽字 + 状态点;高度与背景各收敛成一个 shared 常量,
  三份调色板副本由 `tests/zellij/zellijChromeTheme.test.mjs` 逐值钉住。

- [The Maestro chat list can scroll sideways as a whole](issues/chat-list-scrolls-sideways.md) — fixed, source-verified;
  the list scroller was `overflow: auto` on both axes and `.message-item__content` had no `min-width`,
  so a descendant's min-content width could widen the row and drag the whole conversation sideways.
  Paired with Cowork (whose scrollbars also had no styling at all and now mirror this repo's).

- [Every save recounts every message of every session](issues/every-save-recounts-the-whole-history.md) — open; identical here, same LEFT JOIN + COUNT + preview subquery after every save.
- [Turn and compaction saves still rewrite the whole session](issues/turn-and-compaction-saves-still-rewrite.md) — open; same call sites over queueSessionSave/saveSessionNow, convert together with Cowork.

- [Reading the workspace announced a change](issues/workspace-read-announces-a-change.md) — hardened with Cowork; same query-announces-a-change defect here, loop never closed only because the skill catalog reads through a pure lookup.

- [Control login inherits OnlyPreview Project](features/control-login-preview-workspace.md) — implemented; 88/88 scoped tests and independent review passed after repairing a fenced-adoption tool-binding leak; paired with Cowork, Maestro host adapter preserved.

- [Cowork Project authority parity](issues/onlypreview-cowork-project-authority-parity.md) — canonical script-free fileSearch HTML already present; paired Cowork repair and reference verification.

- [Context-window lookup logs a timeout after success](issues/context-window-timeout-false-warning.md) — fixed; losing timers are cleared; independent review and 8/8 tests passed; paired with Cowork.

- [Plain Escape stops the running turn](features/maestro-chat-escape-to-stop.md) — implemented, code-verified;
  net-new port of cowork's contract, built against cowork's own 2026-09-17 correction (tooltip-selector
  fix included from the start). No drill-confirmation branch (bl has no explore_session feature) and
  no cross-WebContentsView broadcast fallback (bl has no competing operation view today) — both
  deliberately deferred, see [task 182](plan/tasks/maestro-escape-stop-182.md). Test authoring pending.

- [The unread badge can misfire for the active session](issues/maestro-unread-badge-active-session-race.md) —
  fixed, code-verified; `channelStore.activeSessionId` / `messageStore.activeSessionId` two-field race
  (same root cause as cowork), plus a bl-specific port regression that dropped a warm-session
  short-circuit and so paid the race window on every click, not just cold loads. Amends
  [maestro-session-list-unread.md](features/maestro-session-list-unread.md).

- [An unbounded hidden-renderer load latches OnlyPreview dead until restart](issues/onlypreview-unbounded-renderer-load-latches-preview-dead.md) —
  fixed in both apps; owner verification pending. The hidden file-search renderer's `loadURL` was the
  only unbounded await on the startup chain, and a load that is never *answered* (as opposed to
  failed) left `surfaceOpening` set forever, so every later open/select/navigate hung silently until
  restart. Bounded at 30s; the existing recovery path needed no change. Also records the evidence
  that OnlyPreview does **not** cause the boot stall Ral reported — it never ran during those
  episodes; that stall is `getLlmConfig` inside the host-mutation FIFO.

- [Control login frame](issues/control-login-frame-mismatch.md) — implemented; 2/2 focused checks plus Vue/Less/lint pass. Existing warm rounded Control card and renderer-focus shadow retained while signed out. E2E cancelled by Ral.

- [Pi native automatic compaction](features/pi-native-compaction.md) — implemented; scoped checks and shared real-source native threshold test passed; owner desktop UI testing pending.

- [A 3s context-window timeout silently downgraded every preset to 256K](issues/llm-context-window-timeout-downgrades-presets.md) —
  fixed in both apps; owner verification pending; `applyResolvedContextWindows` discarded the
  configured window whenever pi did not answer within 3s, so every cold boot could quietly drop the
  four Codex presets from their measured 266K to 256K — and the compression trigger, reserve budget
  and summary cap are all computed from that number. pi still wins when it answers; configuration is
  now the fallback instead of a flat 256K (Ral 2026-09-17:「你配置好就行,压缩后面再处理」).

- [Control-owned login](features/control-login.md) — implemented and code-verified; visual acceptance pending. Anonymous browsing, login only in Control, protected chat/miniapps remain account-gated. Replaces the [dedicated loginRenderer](features/login-renderer.md).

- [Complete remaining skill P1](plan/tasks/skills-p1-completion-006.md) — implemented; qualified Chat selection, profile enablement, runtime diagnostics and managed source install/update/remove; code verification and owner handoff in task.

- [Skill installer guidance](plan/tasks/skills-installer-guidance-005.md) — implemented; prefer existing tools and avoid unnecessary installs, allow necessary dependencies, report current capability limits accurately. Prompt-only checkpoint; managed installation is implemented by task 006.

- [Standard skill creator](plan/tasks/skills-creator-004.md) — implemented and code-verified; instruction/script templates, native Pi format checks and separate behavior evidence. Owner Chat acceptance pending.

- [Skill P0 completeness](plan/tasks/skills-p0-completeness-003.md) — implemented and code-verified; complete resource-tree import/export, staged publication and preserved Pi authoring baseline. Owner UI acceptance pending.

- [Workspace picker auto-opens OnlyPreview](issues/onlypreview-workspace-picker-auto-open.md) — implemented; human testing pending;
  one native-picker success path for Chat and agent-requested choices, independent of Chat's save queue;
  preserve startup/session-restore behavior and show a separate preview failure warning.

- [独立窗口占着 OnlyPreview 时,tab 留下一张占位页](features/onlypreview-deferred-tab-placeholder.md) —
  bl 侧已实现,owner 验收待做;cowork 侧(PQ-4 的 re-vendor ＋ host adapter)待做,
  via [task 181](plan/tasks/onlypreview-deferred-tab-placeholder-181.md);
  反转 2026-09-07 的「独立窗口打开就关掉 tab」(那条在 `defaultHome: true` 之后已经执行不了 —— pinned
  tab 的 `closeTab` 静默返回),并取代 [默认固有 tab](features/onlypreview-default-homepage.md) #4
  「降级成内置本地 Home」这个补救手段;吸收一直挂着 pending 的 136 / 137。

- [A widened error payload latches the search relay's protocol failure](issues/onlypreview-search-failure-payload-latches-protocol-error.md) —
  fixed in both apps; owner verification pending, via [task 180](plan/tasks/onlypreview-search-failure-payload-180.md);
  the optional `causeCode` that [task 179](plan/tasks/onlypreview-error-detail-operation-cause-179.md) added to every
  failure payload is a third own key, and the search wire's second validator accepts an exact two-key
  set — so the first cancelled or superseded search latched `INDEX_PROTOCOL_ERROR` and Global Search
  stayed dead for the life of the runtime; the fix admits and re-constrains both new fields and binds
  the real producer to that validator in one test process, which is the check whose absence let it ship.

- [The protocol latch is unrecoverable](issues/onlypreview-protocol-latch-is-unrecoverable.md) — recorded, not fixed;
  a single malformed wire payload disables Project search until the runtime re-attaches, with no
  operator-visible reason and no retry path. Design ruling pending from Ral.

- [OnlyPreview Copy-detail block has no operation and no cause](issues/onlypreview-error-detail-lacks-operation-and-cause.md) —
  fixed in both apps; owner verification pending, via [task 179](plan/tasks/onlypreview-error-detail-operation-cause-179.md);
  distinct from the earlier [no-log fix](issues/onlypreview-operation-failure-has-no-log.md), which
  only made Main write `onlypreview.log` — the renderer-visible Copy block itself was still capped at
  `code`/`name`/`message` because the wire payload has no slot for operation identity or a cause
  class, and a raw `error.message` cannot be forwarded (`onlyPreviewCore.test.mjs` locks that a leaked
  path must not cross the boundary).

- [OnlyPreview index disk budget](features/onlypreview-index-disk-budget.md) — phase 0+1 implemented
  ([task 183](plan/tasks/onlypreview-index-scratch-and-leaks-183.md)); owner verification pending.
  A reconcile copies the whole index before rebuilding it, so a 5.6 GB index silently needed 11.2 GB
  free, retried the copy until the volume hit zero, and turned `SQLITE_FULL` into `SQLITE_CORRUPT` —
  that, not the payload latch, is what actually broke search. Now it plans against free space and
  refuses, falls back to the copy-free build, caps the WAL, and reclaims the orphan journals the
  regex never matched. Measurements: [disk efficiency review](design/onlypreview-index-disk-efficiency.md).
  Phase 2 ([184](plan/tasks/onlypreview-index-derived-copies-184.md)) drops two derived copies behind
  a benchmark and carries the in-place v8→v9 migration; phase 3
  ([185](plan/tasks/onlypreview-index-cache-budget-185.md)) is blocked on the cache cap.
  Phase 1b ([187](plan/tasks/onlypreview-index-reclaim-before-rebuild-187.md)) closes the hole 183
  opened: the refusal is computed against the index already on disk, so a workspace whose config
  changed charged its own 6 GB corpse — unreadable and unreconcilable — to the requirement *and* let
  it occupy the space the rebuild needed, and the only thing that frees it, promotion, is downstream
  of the refusal. It now reclaims that corpse and re-plans, keeps one quarantine per database instead
  of stacking ~10 GB of them, ages out the recovery/quarantine residue the sweep never matched, and
  latches a refusal so the next attempt costs one `statfs` rather than another 1.7M-file walk. No
  `search-index-v7`: `SEARCH_ENGINE_IDENTITY` already invalidates in place, and a new directory would
  strand the old one.

- [OnlyPreview paste feedback](features/onlypreview-paste-feedback.md) — implemented
  ([task 186](plan/tasks/onlypreview-paste-feedback-186.md)); owner verification pending. A paste
  name conflict moves off the Project rail's banner into the alert layer, a pasted file is scrolled
  to and flashed once without opening the preview, and the Copy-detail control becomes a borderless
  tabler icon button.

- [OnlyPreview footer storage status](features/onlypreview-storage-status.md) — implemented;
  owner verification pending. The footer's right cluster now carries free space on the volume holding
  `userData` and the total size of every workspace's search index — the numerator and denominator of
  the 2026-09-17 disk exhaustion, neither of which was visible anywhere until the volume was full.

- [Agent cwd follows the workspace](features/agent-cwd-follows-workspace.md) — implementing; code-verified, human testing pending;
  cwd is resolved per session from the project root (else the shared default workspace), never from process.cwd(); pi gets an in-memory settings manager first.

- [Maestro 控制面板启动报 `An object could not be cloned.`](issues/maestro-control-config-clone-workspace-proxy.md) — 已修并验证；
  响应式 `workspace` Proxy 过 xpc 边界抛错，卡死 `loadControlConfig`；2026-09-10 修过一次，守卫只扫一个文件，六天后从 `channel.store.ts` 原样复发；
  守卫改成扫整个 control renderer 并对回归行先判红后转绿，7/7 通过。

- [`getLlmConfig` 会挂住几分钟 —— pi 的 availability refresh 没封顶](issues/maestro-llm-config-unbounded-availability-refresh.md) — 已修并验证；
  `describeContextWindows` 传 `refreshOnCreate: false` + 调用方封顶，provider 就绪探测改并行封顶；
  其余 `ModelRuntime.create()` 逐个核过**不跟着改**（跳了会把所有 provider 报成未登录）。

- [Zellij 恢复次数封顶与重建兜底](issues/zellij-bounded-session-recovery.md) — implemented; code-verified, packaged human acceptance pending;
  原身份最多两次准备，仍失败就在同一次操作里重建一次；重建失败停止，避免无限 Retry。
- [Zellij 更新后仍识别已拥有的终端进程](issues/zellij-update-owner-file-identity.md) — implemented; code-verified, packaged human acceptance pending;
  首次认领核对 bundled binary，后续以进程实际映射的文件编号识别搬动或已删除的旧程序文件，保留进程与 socket 校验。
- [Zellij renderer 加载超时与恢复](issues/zellij-renderer-load-timeout.md) — implemented; code-verified, packaged human acceptance pending;
  controls 与 terminal 导航分别封顶 15 秒，错误可重试；页面加载失败不更换 native session。
  **R10（关 backgroundThrottling）已被 Ral 否决并回退** —— Electron 文档载明：同一窗口里只要有一个
  webContents 关了它，整个窗口的其他 tab 都跟着不再节流。替代方案 R11：tab 重新激活时自动重连，
  loading 状态显示为「Reconnecting…」，不碰节流。
  登出契约（Ral 2026-09-17 裁决）：omni 与 zellij 不依赖账号，**登出/401 失效都不得让它们不可用**；
  同一裁决覆盖 OnlyPreview 与 browser（现状已满足：登出只 suspend 唯一标了 `requiresAuthentication`
  的 Trench tab，其余一律跳过）。守卫已改为「退出保留顺序断言 + 登出反向钉住不拆这些能力 + 钉住只有
  Trench 需要登录」，三条都经变异验证；Cowork 无对应物、无需改动。
- [更新重启后 Zellij 阻塞半天，新开 tab 报 operation-failed](issues/zellij-update-restart-blocks-and-new-tab-fails.md) — R1–R6 + R9 已落盘；
  `[zellij]` 现在每阶段一行带 `elapsedMs`（之前 80 分钟日志里整个子系统只有 3 行），`code=` 被自己的脱敏器擦成 `***` 的问题一并修掉；
  瞬态 IPC 失败与所有权审计超时各自自愈一次；2026-09-17 接手补齐上面三条修复，代码验证完成，待打包复验。

- [Omni Browser window session restore](features/omni-window-session-restore.md) — implemented;
  independent review, 74/74 tests and build passed; restore open/closed intent and saved geometry.

- [Browser history popup stays closed](issues/browser-history-popup-reload.md) — duplicate XPC tab subscription root cause repaired; 70 tests/build/review pass; owner runtime acceptance pending.

- [Zellij text selection contrast](issues/zellij-selection-contrast.md) — implemented; independent review and actual renderer comparison passed; Zellij 195/195; owner package testing pending.

- [Packaged Zellij cannot find installed commands](issues/zellij-packaged-shell-misses-login-path.md) — fixed; owner confirmed session rebuild restores commands. Existing panes retain their old environment.

- [Zellij native selection Cmd+C](issues/zellij-terminal-cmd-copy-paste.md) — repaired; 211/211 regressions and six real native/browser acceptance groups pass; published Preview 0.0.122 (260917010242), owner package acceptance pending.

- [OnlyPreview 后台索引全量 reconcile 自激,整机被拖慢](issues/onlypreview-index-full-reconcile-runaway.md) — fixed; 源码 + 回归测试已验证,打包重启后由 Ral 实机确认;
  全量 reconcile 的代价随工作区大小走,触发它的兜底轮询(30s)与 FSEvents 溢出升级(400ms)却是固定节奏 ——
  97,914 文件的树上一轮 ≈ 60s,26 小时跑了 238 轮全量;现在按上次实际耗时 × 4 退避,只挡全量不挡增量。

- [关闭 Zellij tab 需要确认](features/maestro-zellij-close-confirm.md) — implemented; owner testing pending;
  关闭**范围**里有 Zellij 就先弹一次覆盖层确认(`×` / 右键 Close / Close others / Close right / `Cmd+W`),
  范围里 N 个也只问一次;程序发起的关闭不问;覆盖层起不来时放行而不是把 tab 锁死。

- [双击 Zellij tab 就地改名](features/zellij-tab-inline-rename.md) — implemented; owner testing pending;
  chip 里就地编辑,宽度跟着字走、20 字截断,回车/失焦保存、Escape 放弃,清空即退回 `Zellij`;
  落盘复用既有 alias 那条路,跨重启存活。

- [Workbench chip 右边多一条分隔线,右键什么都不弹](issues/maestro-workbench-chip-divider-and-menu.md) — implemented; owner verification pending;
  开着的 Workbench chip 占掉「收尾 pinned 组」那个槽位(只留左分隔),右击它弹出和 mini-app tab 逐项对齐的原生菜单,不适用的五项置灰。

- [Pi 技能缓存与启动修复](plan/tasks/skills-pi-reload-cache-002.md) — implemented and code-verified; Pi-style New Chat loading, cached turns and explicit reload, with paired dev/build CJS startup regressions. Owner live startup/refresh acceptance pending.

- [Skills 三层来源与实时上下文设计](features/skills-three-sources.md) — approved 2026-09-16; [page mockup](design/skills-three-sources.html); implemented; [independent acceptance](plan/reviews/skills-three-sources-001-3.md) passed with documented verification limits.
  2026-09-17 addendum: [discovery/reload mechanism superseded](issues/skill-catalog-watcher-reinvents-pi-native-loading.md) —
  Ral redirected the hand-rolled walker/watcher to Pi SDK's native `loadSourcedSkills`/`DefaultResourceLoader`;
  [task](plan/tasks/skills-pi-native-loading-001.md) implemented and code verified (59 focused tests, final 2-test runtime regression, strict types and build); owner application testing pending. Native per-source loading replaces the directory watcher; no valid institution skips only that layer.
  2026-09-17: Ral's 「无机构的话也别阻塞 正常的功能」 checked here — bitterless already degrades (both chat-path
  `skillScopeContext.authorize().catch(() => null)` calls, and `skillCloud.ensureCatalog()`'s throw gated on an institution
  actually being authorized), so it is **verified, not changed**, per the paired development rule. Three separately claimed
  bitterless blockers were adversarially checked and refuted. Now pinned by `tests/skillScopes/institutionAuthFailure.test.mjs`
  and `tests/skillScopes/noInstitution.test.mjs` so the Pi-native swap cannot regress it; `yarn test:skill-scopes` 40/40.
  The paired defect and its fix are in
  [micromeet-cowork](../../micromeet-cowork/docs/issues/no-authorized-institution-blocks-chat-and-skills.md).

- [OnlyPreview background index corruption](issues/onlypreview-corrupt-project-index.md) — recovery extended; code verified, owner testing pending;
  SQLite corruption first reached during warm reconciliation gets one clean rebuild with the suspect database preserved.

- [Development CSP blocks Maestro dialog hot reload](issues/dev-csp-blocks-maestro-dialog-hmr.md) — implemented; code verified, owner testing pending;
  Tab Alias and History need the existing serve-only localhost WebSocket CSP allowance.

- [Workbench institution workflows](features/workbench-institution-workflows.md) — list, detail, Kimchi diagram and safe cloud update synchronization; independently verified.

- [A blank New tab paints black instead of the Bitterless splash](issues/maestro-blank-new-tab-paints-black.md) — fixed; owner verification pending;
  the prewarmed `about:blank` document covered the host splash (near-black in macOS dark mode), so a blank tab keeps its view hidden until a real document commits.

- [`Alias…` 点了没反应](issues/maestro-tab-alias-does-nothing.md) — root cause proven and fixed; owner verification pending;
  the menu handler called the controller seam unbound, so it threw synchronously and died as an unhandled rejection; the whole path now logs under scope `tab-alias`.

- [Background workflows and active tasks](features/background-workflow-tasks.md) — implemented and code-verified; concurrent chat, pause/resume, Tasks history modal, completion delivery.
- [Workflow grouping, waiting, and planning](features/workflow-grouping-and-wait.md) — in progress; task bar counts workflows and Agents, roster groups by workflow, main chat can wait for runs, non-interactive planner.

- [Windows locale pruning drops Chinese and English](issues/windows-locale-pruning-drops-chinese-and-english.md) — **open, not fixed**;
  the electronLanguages allowlist uses macOS `.lproj` naming, which cannot match Windows/Linux `.pak` basenames; needs one real Windows pack to settle.

- [app.asar packs the build toolchain](issues/asar-packs-the-build-toolchain.md) — fixed; packaged build verified;
  exclude the build-time payloads, assert them against the artifact, and re-base both size gates off real headroom.

- [Kimchi workflows and /workflow shortcuts](features/kimchi-workflow.md) — code verified; human model/UI testing pending; [task](plan/tasks/kimchi-workflow-001.md).

- [Workbench LAN address](features/workbench-lan-address.md) — implemented; code-verified, human testing pending;
  Settings shows this machine LAN IPv4, resolved once in Main and re-resolved only by the Refresh button.

- [Deep fetch tab loading and built-in browser workflow](issues/deep-fetch-tab-workflow.md) — code complete; human acceptance pending;
  repair the tab loader and route explicit deep-fetch requests through ordinary browser controls.

- [Queued steering throughout a running turn](features/maestro-turn-steering.md) — implemented; code-verified, human testing pending;
  keep preparing/safe-point additions in order, continue late messages after normal completion, and preserve earlier unfinished requests unless replaced.

- [Browser history single-click navigation](issues/browser-history-single-click.md) — implemented; code-verified, human testing pending;
  remove the popup mouseup focus transfer that precedes candidate click handling.

- [Browser retrieval after web search failure](issues/web-search-browser-fallback.md) — implemented; code-verified, human testing pending;
  fall back to deep search through browser query submission, result inspection and source verification.

- [Miniapp tab title on switch](issues/miniapp-tab-title-on-switch.md) — implemented; code-verified, human testing pending;
  publish the target name before mounting and ignore callbacks from replaced miniapps.

- [Project-root AGENTS.md in the system prompt](features/maestro-system-prompt-layers.md) — implemented; code-verified, human testing pending;
  A6 reads one explicit session project file between turns; A7 supplies ten shared rules, with no extra browser role and model identity retained.

- [Project directory loading gates](features/onlypreview-project-loading-gates.md) — implemented; code-verified, human testing pending;
  hide bookmarks and disable Locate until the current directory list is ready, with list-area loading.

- [Current preview header and locate action](issues/onlypreview-current-file-controls-missing.md) — implemented; code-verified, human testing pending;
  repair missing current-file state and unavailable Project location, with BL/COWORK parity.

- [Effective context export after compaction](issues/view-context-includes-compacted-history.md) — implemented; code-verified; human testing pending;
  export the current branch's latest summary and effective tail without absorbed history or metadata.

- [New chat during running work](plan/tasks/browseruse-new-chat-003.md) — implemented; code-verified; human testing pending;
  keep the existing task running while creating/selecting a fresh conversation.

- [Explicit browser-use lifecycle and favicon animation](plan/tasks/browseruse-lifecycle-002.md) — implemented; code-verified; human testing pending;
  start/end host tools, task-scoped activity and ordinary/drill cleanup; expanding/contracting halo added and compiled.

- [Browseruse and drill isolation repair](plan/tasks/browseruse-isolation-001.md) — implemented; code-verified; human testing pending;
  review fixes, explicit drill membership and recording boundaries.

- [Restored browser tab navigation delay](issues/restored-browser-tab-navigation-delay.md) — implemented; code-verified, human testing pending;
  per-view navigation initiation, useful prewarming and separating required first-request setup from full debugger attachment.

- [Clearing workspace retains the OnlyPreview tab](issues/onlypreview-workspace-clear-retains-tab.md) — implemented; code-verified, human testing pending;
  unbind Project, show the guide and reuse the host and valid directory indexes on reselect.

- [Browser tools keep per-chat operating tabs](issues/agent-browser-session-tabs.md) — implemented; code-verified; human testing pending;
  session-owned targets, structured Table 3 state, tab-count UI, lifecycle errors and built-in back navigation.

- [Runtime adapter responsibilities and system prompt contract](issues/runtime-adapter-responsibility.md) — implemented; code-verified, human testing pending;
  require the host system prompt and separate session policy/execution from pi mapping, aligned with CoWork.

- [SQLite Node/Electron ABI mismatch](issues/sqlite-native-abi-mismatch.md) — native module rebuilt for Electron 40; DEBUG startup guard and encrypted roundtrip verified.

- [Browser history and address suggestions](features/browser-history-suggestions.md) — implemented; code-verified, human testing pending; encrypted SQLite, 1000 URLs, title matching and Google search popup.

This directory is the entry point for current Bitterless design and delivery documents.
Older implementation notes remain under `doc/` and are reference-only unless linked from a current
design document.

## Feature contracts

- [Sessions, undo, search and background titles](features/session-management.md) — implemented; code-verified, human testing pending;
  title-only search, one business undo, native text undo, and isolated first-message naming with late-result protection.

- [EyesOnAgents restore Read all](plan/tasks/eyes-on-agents-restore-read-all-102.md) — implemented; owner verification pending;
  Search-right bulk acknowledgement clears non-active unread red dots without ending work.

- [OnlyPreview workspace selection guide](features/onlypreview-workspace-onboarding.md) — implemented; human testing pending;
  visible workspace picker and guide in the shared Project/Recents empty state for BL/COWORK.

- [Preview Shiki requests obsolete `vs` theme](issues/onlypreview-shiki-vs-theme-not-found.md) — implemented; owner testing pending;
  load GitHub theme independently from on-demand grammar readiness in BL/COWORK.

- [Project tree background width on horizontal scroll](issues/onlypreview-tree-background-scroll-width.md) — implemented; owner testing pending;
  BL/COWORK row backgrounds must cover the full scrollable content width.

- [Reference links, chat identity and tooltip dismissal](issues/reference-link-tab-chat-tooltip.md) — implemented; owner testing pending;
  browser tabs keep the current chat while page context updates; dismiss URL tooltips on activation.

- [CoWork offers retired GPT-5.4 Mini](issues/cowork-codex-gpt54-mini-retired.md) — implemented; owner testing pending;
  remove Mini, migrate saved Mini selections to Luna, order Codex choices Astra → Sol → Terra → Luna.

- [Mini-app favicon 由配置决定](features/miniapp-favicon.md) — implemented; owner testing pending;
  `MaestroCompositeTabSpec.favicon` 本来就通,这次给 Zellij / OnlyPreview 填上内联 SVG data URI;
  Trench 不配,走默认图标。OnlyPreview 的标记重做成「方框 ＋ 居中的眼睛」(品牌色 `#4E5882`),
  同一个形的单色版换掉了它菜单条上那枚通用的 tabler `IconFiles`。

- [Tab ↔ 聊天会话绑定与提示词分层](features/tab-chat-binding.md) — contract, not yet implemented;
  `tabId → sessionId` 一张小账,**只从聊天写向 tab**(建 tab / new chat / history 切换三个写入点),
  所以「切 tab 不切聊天」不被推翻。多对一(两个 tab 可绑同一条聊天)⇒ 反查不成立。
  所有打开的 tab(id/url/title)进**表 2**、当前激活的 tab 进**表 3**;这要求
  `createPiResourceLoader` 那个捕获常量的 `getSystemPrompt` 闭包改成每轮求值。
  bl 侧要先给 `SavedTab` 补一格跨重启稳定的 `id`(cowork 已有)。

- [Tab 别名 Alias](features/tab-alias.md) — designed, not yet implemented;右键 `Alias…` 弹表单,
  alias 优先于页面 title,清空即还原;alias 必须是独立字段(title 会被页面反复覆写),
  表单需要一个新的覆盖层 `WebContentsView`。

- [自定义固有 tab(Set as homepage)](features/custom-homepage-tab.md) — designed, not yet implemented;
  核心是把 `pinned`(结构)与 `kind`(行为)拆开,`kind: 'home'` 继续专指内置入口 ——
  登出落地与第一方 preload 都只认它。两个 PQ 要 Ral 拍板。
  **G5 已被 [onlypreview-default-homepage.md](features/onlypreview-default-homepage.md) 改写。**

- [bl 的固有 tab 默认装 OnlyPreview](features/onlypreview-default-homepage.md) — implemented;
  owner testing pending(需重新打包);默认值住在 registry 的 `spec.defaultHome` 而不是默认设置,
  于是「还原默认主页」清空即回默认;`isDefaultHomeTab` 改问「用户设没设过」(默认那一格改名会被
  settings 归一静默丢掉);OnlyPreview 已有活着的承载时 `open` 改为抛,固有槽位这一发降级成内置
  Home 而不是一格空白。

- [页面类型切换器 `menubar__pagetype__button`](features/maestro-page-type-switcher.md) — implemented;
  owner testing pending;地址栏左侧的原生菜单把**当前 tab** 在 Website 与已注册 composite
  mini-app 之间就地切换;从 Zellij 切走走 `close(host)`,那条会话被强关(pane 里有进程也关)。

- [Zellij 终端里 Cmd+C / Cmd+V 没反应](issues/zellij-terminal-cmd-copy-paste.md) — implemented;
  owner testing pending(需重新打包);两个键各坏在不同层:Cmd+C 被 Zellij 自己的
  `key-handler.js` 当成 Kitty 序列吞掉,Cmd+V 被 `setIgnoreMenuShortcuts(true)` 掐断了 macOS 的
  Edit 菜单 paste role。两者都改由 Main 在 `zellijKeyBridge` 里执行。

- [Zellij 终端吞掉 Esc、Shift+Enter 和 macOS 行编辑键](issues/zellij-terminal-mac-editing-keys-and-esc.md) —
  implemented;owner testing pending(需重新打包);字节探针实测:Esc 到 pty 的字节是**零**,
  Shift+Enter 只到 `0d`(Shift 被丢),Option+Enter 到 `1b 0d`(正常)。四个层各自独立:
  (1) `encode_kitty_key` 用 `ev.key.charCodeAt(0)`,四个方向键首字母都是 `A`,Cmd+←/→/↑/↓
  **编码成同一串** `\x1b[65;9u`;(2) 修饰键闸要求「≥2 个或含 Cmd」,Shift+Enter 被漏掉;
  (3) zellij 默认把 `Alt left/right` 绑成 `MoveFocusOrTab`,吃掉了 word 移动;(4) Esc 落单时
  丢失。修法:Esc 与两个换行键由 `zellijPageKeyPatch.ts` 注入页面、**capture 阶段**直接写字节
  (Esc 发完整 `CSI 27;1u`,换行发 `ESC CR`),Cmd+←/→ 仍走 `zellijKeyBridge` 译成 Ctrl+A/E,
  Option+←/→ 与 `mac_option_is_meta` 写进配置模板。**注意**:zellij server 只在启动时读一次
  配置且跨 app 重启存活,模板写到磁盘 ≠ 生效。

- [从 Zellij 终端复制出来是 Mac OS Roman 乱码](issues/zellij-terminal-copy-is-mac-os-roman-mojibake.md) —
  implemented; owner verification pending(需重新打包);`没有` 复制出来变成 `Ê≤°Êúâ`,屏幕上却是对的。
  `iconv -f MACINTOSH` 精确复现:UTF-8 字节被按 Mac OS Roman 解 —— 而这个编码在 macOS 上只来自
  C/POSIX locale 下的系统编码。launchd 启动的 GUI app 根本没有 `LANG`,
  `resolveZellijChildEnvironment` 又只规范化了 `TERM`/颜色、没管 locale,于是 web server、session
  和每个 pane 的 shell 一起继承了 C。缺口补 `LANG=en_US.UTF-8`,launcher 和 KDL `env` 仍然优先。

- [OnlyPreview Agent Guide 恒显 "Restart Bitterless"](issues/onlypreview-guide-contract-guard-rejects-kind.md) —
  fixed; owner testing pending;契约 2026-09-10 加了第四个字段 `kind`,渲染层的精确形状校验还停在
  三键,于是拒掉每一个合法 payload;重启永远修不好。同一处缺陷在 micromeet-cowork 的 vendored
  拷贝里潜伏着,已一并修复。

- [Zellij session-enumeration timeout](issues/zellij-session-enumeration-timeout.md) —
  [repair task 177](plan/tasks/zellij-session-lifecycle-177.md) fixed and verified. Bounded exact
  session operations and isolated web bridges prevent an unhealthy session from blocking siblings.
  170 tests, independent review, build and manual app open/close/restart acceptance passed.

- [Zellij automatic opening and working-directory memory](features/zellij-auto-open-directory.md) — implemented and verified;
  [task 176](plan/tasks/zellij-auto-open-directory-176.md) removes manual enable/init, adds loading,
  remembers active cwd, closes exact sessions, versions KDL defaults, and moves shared settings
  to Workbench with a 48px terminal toolbar. Fresh-session input highlighting and ANSI output
  verified in the development app; [review 176-1](plan/reviews/zellij-auto-open-directory-176-1.md).

- [Terminal setting](features/terminal-toggle.md) - historical enable switch retired;
  the Terminal category now edits shared configuration under task 176.
- [Zellij miniapp](features/zellij-miniapp.md) - implemented; owner testing pending;
  native terminal view and Normal-mode shortcuts; task 176 supersedes the manual startup UI.
- [Zellij distribution](features/terminal-zellij-distribution.md) - pinned Zellij
  binaries join `tools:init`, platform manifests, offline staging, and macOS signing.
- [Zellij DEBUG misses initialized tools](issues/zellij-debug-runtime-misses-initialized-tools.md) — fixed and tooling-verified;
  [task 174](plan/tasks/external-tools-init-dev-ready-174.md) makes `tools:init` prepare host staging
  and package caches with verified reuse; repeated real initialization made zero download attempts.
- [Zellij startup loses native errors](issues/zellij-terminal-no-error-trace.md) — fixed and actual dev startup verified;
  macOS session socket path reaches 108 bytes, beyond the native 103-byte limit. Repair adds a
  short socket directory and captures the previously discarded native failure details.
- [多个 Zellij tab,每个一条会话](features/zellij-multi-tab.md) — implemented; owner testing pending;
  + 按钮的 hover mini-app 菜单、per-spec `singleton`/`restorable` opt-in、Maestro 铸造并落盘的
  `instanceId`,以及「新开即新会话、重启即恢复」两条由同一个 id 决定的行为。
- [Zellij 多实例:仍然共享的那几样东西](issues/zellij-multi-instance.md) — task 176 已修复并验证；
  独立 surface 状态、主动关闭时清理会话、隔离并发 stop/start。

- [INDEX CA list and Generate](plan/tasks/trench-index-generate-031.md) - Add saves metadata;
  Generate explicitly rebuilds the selected chain.

- [macOS and Windows tray artwork](plan/tasks/tray-mac-document-master-runtime-171.md) — implemented; owner testing pending;
  approved larger/raised-eye cat head, macOS 22px / Retina 44px assets and Windows `#4E5882` multi-size ICO.

  control 展开时内容区左右各让 8px、前台 view 走原生 16px 圆角。内缩只在唯一入口做一次
  (`layout()` 的缓存分支不再回灌 `setViewBounds`),圆角只在翻转 / 成为前台时设,不进每帧路径。
  姊妹落地在 micromeet-cowork,两份要一起改。

- [Folding icons render as boxes](issues/onlypreview-folding-icons-render-as-boxes.md) — fixed in BL/Cowork; owner testing pending;
  the API-only Monaco entry never loaded the codicon font the fold chevrons are drawn with.

- [第一次打开工作区外的文件没反应](issues/onlypreview-first-external-open-is-replaced-by-the-restored-project.md) — fixed; owner testing pending;
  恢复项目时顺手呈现了那个项目记住的文件,把刚呈现的外部文件静默换掉。是同日另一个修复引入的回归。

- [OnlyPreview 承载方式持久化](features/onlypreview-host-mount-persistence.md) — implemented; owner testing pending;
  上次 tab 就 tab、上次窗口就窗口(尺寸/位置/屏幕本来就已经持久化了)。含「先问承载再问偏好」的顺序理由。

- [Project 树按文件类型换图标](features/onlypreview-tree-file-icons.md) — implemented; owner testing pending;
  docx/xlsx/pptx/md 各自的 tabler 图标(刻意不用 `IconFileType*`:14px 下那几个字读不出来)。
  含一条实测坑:HTML 注释插进 v-if 链会让 `v-else` 那一支编译成注释节点。

- [Address bar takes a local absolute path](features/address-bar-local-path.md) — implemented; owner testing pending;
  maestro 顶栏敲一条 `/…` 或 `C:\…` 路径:在 → OnlyPreview 独立窗口,不在 → Chromium 自己的
  「文件不存在」页。判据与 micromeet-cowork 共用 vendored 的那一份,落点刻意不同。

- [INDEX contract](features/trench-index.md) - CA-list metadata import and selected-chain Generate;
  [historical incremental delivery](plan/tasks/trench-index-incremental-030.md) superseded by 031.

- [Trench Tab and Window Hosting](features/trench-host-toggle.md) - implemented; owner testing pending; one ordinary
  surface shared across window/tab, with independent multi-renderer Omni panels retained.

- [Project bookmark list and state SQLite](features/onlypreview-project-bookmarks.md) — implemented; owner testing pending;
  fixed Project-only list, direct removal, preload commit-driven UI and per-Project state DB.

- [Codex login writes a store the turn never reads](issues/codex-login-writes-a-store-the-turn-never-reads.md) — fixed, packaging verification pending (2026-09-10):
  one userData root holds TWO pi auth stores — the AI Login button, its logout and the "connected" indicator all use
  `<userData>/cowork/pi/auth.json`, while every chat turn reads `<userData>/.pi/auth.json`. The only bridge is a
  copy-if-absent migration, and pi's own `AuthStorage` creates the target as literal `"{}"` on first construction, which
  makes that miss permanent: the UI reports a successful login, the turn reports "not signed in", and re-logging in
  rewrites the file nobody reads. Also records that logout cannot log the turn out and that "connected" is true for an
  EXPIRED token (pi's `checkProviderAuth` never looks at `expires`). Fix = one store + cowork's forward-merge (without
  cowork's cross-channel inheritance, deliberately) + a diagnostic that names the account and the expiry.

- [Maestro model-io log path](issues/maestro-model-io-chain-is-dead.md) — implemented; code-verified, human testing pending (2026-09-15):
  connect existing diagnostics to `<userData>/agent-io`; wait for queued writes before copying a saved
  session directory, and report missing historical logs accurately without recreating them.

- [Maestro · AI-CRMS 链路整体退役](features/maestro-crms-retirement.md) — 删除契约,实施中(2026-09-10):
  Ral 定「bl 的 Maestro 不能包含 crms 的东西」,代价是 bl 从此没有 `ai-crms` 这个 LLM provider,
  连带撤掉 Workbench Integration 子系统(13 条 agent 工具)、Control 的语音录音/转写、vendored 的
  `packages/micromeet-cli` 及其打包链。#3「保留面」比 #2「删除面」重要 —— 删错那几处是静默的。

- [Maestro context-structure modal](features/maestro-context-graph.md) — implemented; owner testing pending (2026-09-09):
  `/view_context_graph` draws the live context as a vertical block stack (types, sizes, context turns, compaction
  boundary) in a semi-transparent in-panel modal; clicking a user/assistant block jumps to that chat message and
  blocks with no UI carrier deliberately cannot be clicked. Ported from Cowork with six deliberate divergences —
  reuses BL's own `compactionBoundary()` (it has pi's `firstKeptEntryId` fallback that Cowork's version lacks),
  two-table `i18nHelper` with no interpolator, sibling `.less` + flat BEM, borderless, and no jsonl footer.
  Saved log paths are available separately through `/copy_session_path` and `/view_context`.

- [Maestro slash commands](features/maestro-slash-commands.md) — implemented; owner testing pending: Cowork-style
  `/clear` and `/view_context` menu, preserving BL runtime and composer behavior.

- [Maestro default workspace](features/maestro-default-workspace.md) — implemented 2026-09-10; owner E2E pending:
  with nothing bound, EVERY workspace tool (`write_file` / `create_artifact` included) resolves against ONE shared
  `~/.bitterless_<edition>/default_workspace` (2026-09-18: the directory name carries the edition the same way userData does — derived from the profile's `appName`, so Production is `~/.bitterless` and Preview is `~/.bitterless_preview`; its absolute path is named in the system prompt while the UI still shows "none selected"), `mkdir -p` at boot.
  Retires the per-chat `<userData>/cowork/chat_workspaces/<chat id>` fallback and `resolveWritablePath`; relative reads
  now share the writes base. Explicit workspace still wins; `isInsideRoot` + realpath checks unchanged.

- [Chat resize interrupted by OnlyPreview focus](issues/maestro-chat-resize-interrupted-by-preview-focus.md) — implemented; owner testing pending;
  BL-only repair preserves sibling focus and Cowork-style pointer gesture lifecycle.

- [OnlyPreview structured-text folding](plan/tasks/onlypreview-structured-text-folding-172.md) — implemented in BL/Cowork;
  JSON/XML/YAML previews fold, open with five levels expanded and copy folded lines; owner testing pending.

- [Project Cmd+Delete](plan/tasks/onlypreview-project-delete-shortcut-166.md) — implemented in BL/Cowork;
  focused Shell opens the existing delete confirmation; owner testing pending.

- [OnlyPreview bookmarks and focus](plan/tasks/onlypreview-bookmarks-focus-165.md) — implemented;
  Project-scoped file/folder bookmarks and renderer-focus selection emphasis; owner testing pending.

- [macOS Open With](plan/tasks/onlypreview-macos-open-with-164.md) — implemented; packaged-app testing pending:
  BL/Cowork file registration, workspace-safe OS opens and default-viewer self-open protection.

- [OnlyPreview header file menu](plan/tasks/onlypreview-header-file-menu-163.md) — implemented; owner testing pending:
  one dots IconBtn opens native Open/Reveal actions in BL and Cowork, fenced to the current preview.

- [Main-process layout refactor](plan/tasks/main-process-layout-162.md) - implemented; owner testing
  pending: the Claude subscription (sub2api) feature is removed outright, including Maestro's `Local`
  LLM provider, which existed only to point pi at that local server. `src/main/maestro/agent/` is
  hoisted to `src/main/agent/` and `src/main/onlypreview/` moves under a new `src/main/miniapps/`,
  matching Cowork. `src/main/modules/` is created empty for the next step. The `claude-subscription-*`
  and `sub2api` documents below are kept as the record of a feature that no longer ships.

- [pi agent dir moved off `~/.pi/agent`](issues/pi-agent-dir-uses-global-home.md) - implemented; owner
  testing pending: pi's `agentDir` was never set, so the user's own `~/.pi/agent/AGENTS.md` (a git-sync
  rulebook) was reaching every maestro session's **system** prompt uncompressed, and `TOOLS_DIR` pointed
  into the pi CLI's managed `bin`. Now `<userData>/.pi`, set via `PI_CODING_AGENT_DIR` at boot **and** an
  explicit `agentDir` per session, with a one-time forward migration of auth/models off
  `<userData>/cowork/pi` that deliberately does not carry `bin/`. Cowork aligned to the same path.

- [Control-chat link policy](features/maestro.md) - implemented; owner testing pending: a web link in a
  chat reply becomes a new operation tab instead of a bare BrowserWindow; the Control view had no
  window-open handler and no navigation fence at all. Ported from Cowork (the parity source for
  Control chat) and held byte-equal by `scripts/maestro/check-control-link-policy.mjs`.

- [Workspace open readiness](plan/tasks/onlypreview-open-readiness-161.md) - implemented; owner testing pending:
  repeated opens await the same initialized OnlyPreview surface; BL/Cowork parity.

- [Maestro Control providers](plan/tasks/maestro-control-providers-159.md) - implemented; owner testing pending:
  remove Micromeet/Local choices without silently changing saved providers.
- [Corrupt Project index recovery](issues/onlypreview-corrupt-project-index.md) - implemented; owner testing pending:
  confirmed SQLite corruption; recover the derived cache and preserve project files.

- [Maestro workspace appearance](plan/tasks/maestro-workspace-ui-158.md) - implemented; owner testing pending:
  Cowork-aligned compact typography, control alignment and independent tooltips; BL only.

- [Cold-index search](issues/onlypreview-cold-index-blocks-search.md) - implemented; owner testing pending:
  early metadata Files results and background indexing without false RPC failures; BL/Cowork.
- [Embedded search Escape](plan/tasks/onlypreview-tab-search-escape-157.md) - implemented; owner testing pending:
  close the active global-search layer in a browser tab; check Cowork parity.

- [Maestro composer/history parity](plan/tasks/maestro-composer-history-parity-155.md) - implemented; owner testing pending:
  Cowork footer structure and history keyboard interactions while preserving BL workspace styling.

- [Maestro Chat width handle](plan/tasks/maestro-chat-width-handle-154.md) - implemented; owner testing pending:
  8px left-edge drag handle; Cowork's 380–480px limits, existing Maestro default preserved.

- [Agent preview preserves Project selection](plan/tasks/onlypreview-agent-preserve-project-153.md) - implemented; owner testing pending:
  MCP file opens update preview/Recents without changing the selected directory or workspace.

- [OnlyPreview listing readiness](plan/tasks/onlypreview-project-browse-ready-152.md) - implemented; owner testing pending:
  Select a file once the Project listing is available, independently of indexing progress.

- [Renderer language coordination](features/renderer-i18n.md) - one main-process language authority,
  live updates for every first-party renderer, and correct locale before recreated windows mount.
- [Maestro sub-application](features/maestro.md) - the Bitterless Mini App migrated from the
  Micromeet Cowork runtime.
- [Maestro composer cleanup](plan/tasks/maestro-composer-cleanup-149.md) - implemented; owner verification pending, BL only:
  full workspace name, no Refresh action, and no synthetic greeting in empty chats.
- [Maestro workspace name opens OnlyPreview](plan/tasks/onlypreview-cowork-workspace-preview-138.md) -
  in progress with another agent, as assigned by Ral; workspace-chain edits preserved here.
- [OnlyPreview tab address](plan/tasks/onlypreview-composite-tab-address-145.md) - implemented; owner verification pending:
  publish the active composite tab URL/title rather than retaining the previous Home address.
- [Maestro Chat overlays tab content](issues/maestro-chat-overlays-tab-content.md) - implemented; owner verification pending:
  preserve reported sidebar geometry through deferred view creation and resize, and hide closed
  Chat at the native-view layer.
- [Maestro Control chat behind Cowork](issues/maestro-control-chat-behind-cowork.md) - implemented;
  owner verification pending: migrated the current Turn/status/task and attachment/file-reading
  chat vertical slices from Cowork `67b056b` while preserving Maestro providers, i18n, replay,
  local Home, and Royal Blue/BEM UI; core [review 1](plan/reviews/maestro-cowork-chat-core-089-1.md)
  and files [review 1](plan/reviews/maestro-cowork-chat-files-090-1.md) passed.
- [Maestro SQLite build older than migration](issues/maestro-sqlite-build-version-behind-migration.md) -
  fixed 2026-09-12; restart verification pending: [task 173](plan/tasks/maestro-sqlite-agent-build-173.md)
  refreshes DEBUG timestamps, aligns both SQLite preloads to the compiled version and uses
  Maestro diagnostics; migration audit and the original DEBUG_PROD build pass.
- [两处 `await import()` 从来没有真的延迟过](issues/dynamic-imports-that-never-split.md) —
  fixed(2026-09-14):`llmPaths` 与 `eyesOnAgents.handler` 同时被动态与静态引用,Rollup 不能切出独立
  chunk,于是两处 `import()` 只是「对同一文件里已求值模块的一次 Promise 包装」——产物里 handler 的
  `new LastUserPromptPreferenceService(app.getPath("userData"))` 是顶层语句,进程一启动就执行了。改成
  静态 import(顺序约束本来就在**调用点**上,不在 import 写法上),两条构建告警消失。
- [`afterPack` 那条用例从 9/10 红到现在](issues/afterpack-context-typeerror-and-unexercised-associations-gate.md) —
  fixed(2026-09-14):合成 context 没有 `packager`,关联闸 `context.packager.appInfo.productFilename`
  直接 TypeError,用例在跑到任何断言前就死了 —— 而它守的正是 electron-builder 的 afterPack。两边都改:
  关联闸改为**显式校验 context 并说清缺什么**(与 afterPack 对 appOutDir 的做法一致);合成产物补上由
  builder 模板生成的 `Contents/Info.plist`,`afterPack` 拆成 darwin-only 的完整链路用例(带反向锁:把
  plist 里的 `public.data` 改坏必须红)与跨平台的残缺-context 用例。
- [打包被产物审计拦下:`canvas` 缺失 + asar 268 MiB 超限](issues/preview-package-audit-canvas-and-vendored-cli.md) —
  fixed(2026-09-14):两条同日(09-12)进来的独立原因。① 主进程新引入 linkedom,而它的
  `try { require("canvas") } catch { shim }` 被 Vite 原样内联,审计把这个**自带回退的可选 require**
  当成了缺包 —— 现在由 `OPTIONAL_EXTERNAL_PACKAGES` 白名单放行(表外仍硬红)。② AI-CRMS 退役契约
  D3 说「`packages/micromeet-cli/` 整目录删」,builder 排除行与 .gitignore 行删了、目录没删,于是
  61MB 的 mac-arm64 CLI 二进制先被 `chore: sync` 提交进仓库、又被打进 asar(+60.8 MiB,正好是全部
  增量)—— 补做删除后 asar 回到 ~207 MiB。
- [`tools:init` entry and unaudited packaged tool platform](issues/tools-init-entry-and-unaudited-packaged-tool-platform.md) —
  implemented; owner initialization/package verification pending (2026-09-10): the initialization
  command is now `yarn tools:init` in both this repository and `micromeet-cowork` (all three stores,
  any host), and the packaged-application audit gained a `Resources/maestro-tools` gate — platform
  and architecture read from each shipped binary's own header, since signing invalidates digests and
  a cross-built win64 package cannot be executed here.
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
  verification pending: reduce the address row to 42px and keep Main's first-frame native-view
  offset synchronized at 78px; internal control dimensions now follow Cowork (entry below);
  [review 1](plan/reviews/maestro-address-row-compact-082-1.md) passed.
- [Maestro address row matches Cowork spacing and icons](issues/maestro-address-row-cowork-spacing.md) -
  implemented; owner testing pending: match Cowork's actual 13px-root spacing, 26px buttons and
  SVG sizes; preserve the 42px outer row and 78px native-view offset. Geometry 3/3 and four
  static Chromium layout comparisons passed.
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
- [Maestro fixed Home Login gate](issues/maestro-local-home-login-missing.md) - historical placement
  superseded by [Control login](features/control-login.md); original Login behavior and hidden
  Home token/auth authority are retained, but login no longer renders in the Home tab;
  [review 1](plan/reviews/maestro-local-home-auth-gate-096-1.md) passed.
- [Maestro Workbench Account tab](issues/maestro-workbench-account-tab-missing.md) - implemented;
  owner verification pending: moved identity/logout from General into Settings → Account and made
  logout close Workbench; the former pinned-Home login destination is superseded by Control login;
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
  multi-view preview behind a mount, EyesOnAgents-style MenuBar, settings, and OS file-open routing.
- [OnlyPreview tree density](plan/tasks/onlypreview-tree-density-151.md) - implemented; owner testing pending:
  14px file/directory names, 600-weight root and uniform 22px rows, mirrored to Cowork.
- [OnlyPreview collapse directories](plan/tasks/onlypreview-collapse-directories-146.md) - implemented; owner verification pending:
  vertical-collapse action left of Locate; root stays open and descendant expansion is cleared.
- [OnlyPreview Python/Go index exclusions](plan/tasks/onlypreview-python-go-index-exclusions-147.md) - implemented; owner verification pending:
  hard dependency/cache directories and persisted-index policy identity, mirrored to Cowork.
- [OnlyPreview config quiet reconciliation](plan/tasks/onlypreview-config-quiet-reconcile-148.md) - implemented; owner verification pending:
  sixty-second trailing config adoption, serialized adjustments and restart-safe policy comparison.
- [OnlyPreview Tab/window toggle](plan/tasks/onlypreview-host-toggle-139.md) - implemented; owner verification pending:
  one two-state Tabler control right of Settings, with single-surface relocation and restore.
- [OnlyPreview Tab MenuBar alignment](plan/tasks/onlypreview-tab-menubar-alignment-144.md) - implemented; owner verification pending:
  keep traffic-light space in standalone windows only and center the icon-only Open folder action.
- [OnlyPreview embeddable mount](features/onlypreview-embeddable-mount.md) - proposed: the
  four-layer composite gains its own container `View` and asks a mount for geometry, window services
  and shortcut arbitration, so one OnlyPreview surface can live either in its own window as today or
  as a Mini App tab inside the Maestro (Cowork) browser window. Amends that document's former
  "Standalone-only boundary" — Omni stays excluded, the container mode does not.
- [OnlyPreview delete never tells the tree](issues/onlypreview-delete-never-tells-the-tree.md) -
  fixed; owner verification pending: New Folder and Rename each broadcast their result to the shell
  but Delete announced nothing, so removed rows stayed on screen and every later right-click, copy or
  delete on one failed against a path that was gone; a delete now announces what it removed and the
  tree drops every pointer into a removed folder before re-reading the index.
- [OnlyPreview browse targets and history](features/onlypreview-browse-history.md) - task 150 implemented; owner testing pending:
  external-file previews preserve Project; Project/Recents lists100 files; Back/Forward walk that
  unchanged order, Reload only reloads preview, and Markdown local-file links use exact authority.
- [The Project index never latches ready, so the pane stays on "Loading project"](issues/onlypreview-index-never-latches-ready.md) -
  implemented; owner verification pending: `initialize` and `refresh` hand their snapshot back as an
  RPC result, which never passed the only place the index state was observed, so a Project whose
  index was already usable rendered its whole tree while Main still reported `building`; both
  methods now observe the snapshot they return.
- [Locate file leaves the row unhighlighted after opening from global search](issues/onlypreview-locate-file-leaves-no-highlight.md) -
  implemented; owner verification pending: the tree highlight answers from the click anchor before it
  falls back to the anchored row, and a file opened from search was never clicked, so every path that
  re-anchors without a click — locate, an inherited watch selection, an explicit reveal — now
  collapses the tree selection onto that row.
- [Agent onboarding calls the Preview edition a test instance](issues/preview-edition-treated-as-test-instance.md) -
  implemented; owner verification pending: `bitterless-preview` is a shipped edition with its own
  bridge and storage, but the copied setup instruction, all three bundled skills, and the workspace
  rules classified it as development-only, so a Preview-only machine had no sanctioned server; one
  shared classifier now marks it real and the setup docs name its helper path directly.
- [Packaged Preview opens OnlyPreview DevTools by itself](issues/onlypreview-devtools-auto-open-in-packaged-preview.md) -
  implemented; owner verification pending: the shell view's auto-open used the shortcut-binding
  predicate instead of the debug-only one, so the packaged Preview build opened DevTools on startup;
  every auto-open is now debug-only while the Preview shortcut stays.
- [Deleting the selected file shows "Loading project" instead of "Select a file"](issues/onlypreview-preview-stuck-loading-after-delete.md) -
  fixed; owner verification pending: the index placeholder is ordered ahead of the empty state and a
  Project whose index never latches `ready` kept it true all session, so the first pane with nothing
  else to render was the delete; the placeholder now retires once a Project has resolved a real file.
- [OnlyPreview folder delete leaves a recovery directory](issues/onlypreview-folder-delete-leaves-a-recovery-directory.md) -
  fixed; owner verification pending: the post-isolate identity check re-`lstat`ed the renamed-away
  original path, so every folder delete failed and left its `.bitterless-delete-recovery-*` directory
  in the project; cleanup now runs on the failure path, the selected row loses its right-hand rail,
  the shell view opens detached DevTools, and Reveal in folder sits above Delete.
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
- [EyesOnAgents local session removal](plan/tasks/eyes-on-agents-local-delete-098.md) - delete a
  Bitterless-only session mirror from either card-menu entrance without changing Codex or Claude.
- [EyesOnAgents Search after long uptime](issues/eyes-on-agents-search-after-long-uptime.md) -
  fixed; owner verification pending: the reproduced interrupted-composition state no longer survives
  modal close; each lifecycle gets a fresh Input, while matching remains renderer-local.
- [EyesOnAgents IME-safe search rerender](plan/tasks/eyes-on-agents-search-ime-render-101.md) - implemented; owner verification pending:
  native composition-aware input retains the computed adapter and preserves Pinyin during refresh.
- [EyesOnAgents raw search input](plan/tasks/eyes-on-agents-search-raw-input-100.md) - implemented; owner verification pending:
  bind raw text with `v-model`, derive normalized tokens through read-only computed state, and
  preserve input through background rerenders; the installed Preview still lacks task 099's key.
- [EyesOnAgents Project filter](features/eyes-on-agents-project-filter.md) - Git-worktree-derived
  Project metadata; its renderer filter is retired and only resolution/storage remains.
- [EyesOnAgents Codex observation](features/eyes-on-agents-codex-observation.md) - global Hook
  lifecycle, lightweight reliable delivery, Codex trust review, and App Server independence.
- [EyesOnAgents Claude observation](features/eyes-on-agents-claude-observation.md) - provider-aware
  local Claude discovery, Desktop archive metadata, plugin lifecycle Hooks, and Desktop UI Open.
- [EyesOnAgents last user prompt](features/eyes-on-agents-last-user-prompt.md) - narrow capture of one
  bounded latest user question per thread with content-free offline delivery and tiered All-thread
  App Server recovery.
- [EyesOnAgents iTerm2 Open](features/eyes-on-agents-iterm2-open.md) - removed by task 097:
  the third connection entry, CLI-only visibility, Open-in-iTerm2 action, AppleScript transport, and
  Automation entitlement are retired; inert schema/storage compatibility remains.
- [Open in iTerm2 does nothing](issues/eyes-on-agents-open-in-iterm2-does-nothing.md) - closed by
  feature removal; no packaged runtime verification remains necessary.
- [EyesOnAgents Claude Multi-Environment](features/eyes-on-agents-claude-multi-environment.md) -
  implemented; owner runtime verification pending: N independently-managed `CLAUDE_CONFIG_DIR`
  environments (own watcher, own hook install target, Hook-attributed `claude_config_dir`),
  superseding the single-directory model.
- [Claude inventory socket path exceeds the unix `sun_path` limit](issues/eyes-on-agents-claude-inventory-socket-path-too-long.md) -
  fixed in source; owner runtime verification pending: the per-environment socket name embedded a raw
  36-char UUID, producing a 134-byte path that `bind(2)` rejected with `EINVAL`, so every Claude
  environment sat in `Retrying` despite passing tests.
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
- [EyesOnAgents Search shortcut dies when another Omni view holds focus](issues/eyes-on-agents-omni-search-shortcut-focus.md) -
  diagnosed; repair pending owner choice: `Cmd+F` is a renderer-local `window` listener, so in the
  Omni Mini App host it only fires while that cell's `WebContentsView` holds keyboard focus, and
  Omni never focuses a cell's content view.
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
  [071](plan/tasks/onlypreview-files-section-sql-lookup-071.md) is unblocked - the product decision
  landed as "no" on 2026-09-16 - but the SQL lookup itself is not started.
- [OnlyPreview Global Search Files section scope](plan/tasks/onlypreview-files-section-scope-178.md) -
  implemented; owner verification pending: one scope now fences Files and Contents alike, reversing
  the Files half of
  [the directory-selection decision](issues/onlypreview-directory-selection-and-global-file-scope.md);
  the scan resolves the scope once per query, so a narrow scope makes it cheaper rather than dearer,
  and the search panel's shadow became a ring instead of sitting below the panel.
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

- [聊天工具条的 `…` 飘到中间,Session tabs 先隐藏](issues/chat-toolbar-overflow-drifts-to-the-middle.md) — fixed;
  owner verification pending。工具条是 `space-between`,它自己的注释早就写明**只能有两个孩子**,
  却长到了四个 —— 中间两个被均分推到三等分处。所以这不是间距问题,调 `gap` 永远修不好它。
  把 `…` 与 `+` 收进一个 `chat-panel__toolbar-actions` 组(组内 8px),两孩子不变量就回来了。
  Session tabs 是**注释掉**而非删除,`import` 必须一起注释(否则 `noUnusedLocals` 直接编译报错)。
  cowork 同改。

- [Zellij tab 里焦点不在终端上时 `Cmd+W` 关掉整扇窗](issues/maestro-zellij-chrome-cmd-w-closes-window.md) — fixed, code-verified;
  owner verification pending: 迷你应用的 chrome 跑在 default session,Maestro 的 partition 判定看不见它,
  于是 `Cmd+W` 穿到应用菜单的 `close` role。认领改成按键当刻求值的判定,chrome 只在 docked 进 Maestro
  tab 时认领 —— 独立 Zellij 窗口照旧关窗。cowork 侧核对过:它的仲裁结构不同,不存在这个缺陷。

- [External file tabs and current-preview identity](issues/onlypreview-external-file-tab-and-current-preview.md) — implemented; owner testing pending: OS files open new tabs without OnlyPreview history; footer and current Recents highlight follow the live preview.

- [AI-CRMS 退役前的安全契约 —— 留档](issues/maestro-crms-retirement-security-record.md) — 留档,不再是活约束:
  专用登录 tab 的隔离要求与 bundled CLI 凭据信封两段从 `features/maestro.md` 正文移出。正文只描述
  今天成立的契约,但「当年为什么要这么严」值得留给下一个往 Maestro 接远端后端 + 落盘凭据的人。
- [AI-CRMS 残留清理到 2026-12-31 到期删除](issues/maestro-crms-residue-cleanup-sunset.md) — 待到期执行:
  退役时加的一次性开机清理(pi `models.json` 的明文 JWT、CLI 凭据、隐藏 sqlite 窗口的四个
  localStorage 键、指向 crms.micromeet.ai 的历史 tab 行)是有寿命的代码;这条账记的是到期要删
  哪些文件与那个 config marker 键。
- [A watch commit revokes a Global Search session that began after the commit started](issues/onlypreview-watch-commit-revokes-a-newer-search-session.md) -
  fixed: `engine.search()` never serialized against the watch reconcile, and the writer lease
  scheduled rather than prevented the clash - the commit waited for exactly the query it then
  destroyed, so editing any file and searching within 400ms could return an un-previewable result
  list. The reconcile now marks the session it observed on entry and revokes only that one; ported to
  the micromeet-cowork vendored copy.
- [OnlyPreview preview-token test races its own live watcher](issues/onlypreview-preview-token-test-races-live-watcher.md) -
  fixed in the test: macOS delivers FSEvents for fixture writes into the watcher `initialize()` just
  attached, and the resulting reconcile - queued behind the build - revokes the whole global search
  session after the next query has issued its tokens, so the token-lifetime test lost a valid token
  under parallel-run contention. Fail-closed, so no token-lifetime defect; one product observation
  left open on the scope and ordering of that revoke.
- [OnlyPreview verification checks red at HEAD](issues/onlypreview-verification-checks-red-at-head.md) -
  fixed: repinned the stale tray-ordering, Global Search layout, and shell-view assertions, brought
  the three files that had crept past the 800-line TS-1 limit back under budget by extraction, gave
  the pending-initialize test a workspace root the Office binding accepts, and removed a dead
  `webFrameMain` import.
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
  app to about 1.1 GiB; the committed package is guarded by an `afterPack` size gate.
  Superseded limits — see [app.asar packs the build toolchain](issues/asar-packs-the-build-toolchain.md)
  for the current 195 MiB ASAR gate and the per-target application gate.
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
- [A skill's declared entry outside its package could not run](issues/skill-declared-entry-outside-package.md) — fixed here too; same run_skill_file confinement. No shell gap on this side: bitterless has only PiRuntimeAdapter, so pi's `bash` is live.
- [Tool approval had no clickable button](issues/tool-approval-has-no-clickable-button.md) — not present here (confirm sync already precedes the task binding); the unbounded detail height was, and is capped.
- [斜杠命令回执、工具超时与脚本流式输出](issues/command-notice-tool-timeout-and-script-streaming.md) — fixed here too; same per-tool timeout removal, script output streaming and muted command receipts, paired with Cowork.
  missing from Focus when lifecycle observation is absent or expires too early.

## Legacy references

- `doc/colors.md` - historical palette exploration; the current contract is
  [`docs/design/colors.md`](design/colors.md).
- `doc/plan/tasks/` - historical Todo and release tasks.
- `docs/plan/tasks/` - current task files, including tasks created before this index.
- `docs/integrations/coding-agent-sessions*.md` - historical Codex/Claude implementation superseded
  by EyesOnAgents.
