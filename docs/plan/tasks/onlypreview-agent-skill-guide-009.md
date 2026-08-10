---
id: onlypreview-agent-skill-guide-009
scope: Add the portable Bitterless Preview skill, read-only MCP open tool, and MenuBar Guide window
status: implemented; owner verification pending
depends-on: [onlypreview-safe-markdown-selection-008]
---

# Objective

Make Bitterless Preview installable as a portable agent skill. Add one read-only production MCP
tool that opens an explicit local file or folder in the existing standalone OnlyPreview window, and
add an OnlyPreview MenuBar entry that opens a Todo-inspired Guide window. The Guide has one direct
English copy action whose complete instructions include both MCP connection and skill installation.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/features/window-state-persistence.md`
- `docs/design/colors.md`
- `docs/features/todo-mcp.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/todo-agent-skill-onboarding-002.md`
- `docs/plan/tasks/onlypreview-safe-markdown-selection-008.md`

# Layout

```text
┌────────────────────────────── OnlyPreview ───────────────────────────────┐
│ OnlyPreview / project                         Open Folder · Robot · Gear │
└──────────────────────────────────────────────────────────────────────────┘
                                              │
                                              v
┌──────────────────── parented Guide BrowserWindow ────────────────────────┐
│ LOCAL MCP                                                               │
│ Copy the skill to your agent                                            │
│ [test-instance warning when applicable]                                 │
│                                                                          │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Complete setup instructions                                    ⧉   │ │
│ │ Copy these instructions to your agent.                              │ │
│ │ They include the skill and MCP setup.                               │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

# Path

- `skills/bitterless-preview/`
- `electron-builder.tmp.yml`
- `electron.vite.config.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreviewAgentSkillVersion.shared.ts`
- `src/shared/window/window.types.ts`
- `src/preload/onlypreview/onlypreview.preload.ts`
- `src/preload/onlypreview/onlypreview.preload.type.ts`
- `src/main/app.main.ts`
- `src/main/mcp/mcpBridge.server.ts`
- `src/main/mcp/mcpStdio.helper.ts`
- `src/main/onlypreview/onlyPreviewAgentSkill.service.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/main/logging/logPolicy.service.ts`
- `scripts/package/desktopPackage.audit.cjs`
- `scripts/package/desktopPackageAudit.test.mjs`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/guide/`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `scripts/renderer-i18n/check-renderer-i18n.mjs`
- `scripts/mcp/preview-open.test.mjs`
- `tests/onlypreview/onlyPreviewAgentSkill.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/features/window-state-persistence.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-agent-skill-guide-009.md`

# Implementation Constraints

1. Add the canonical portable skill `skills/bitterless-preview/` with `SKILL.md`,
   `agents/openai.yaml`, `references/mcp-setup.md`, and `references/tools.md`. The skill depends only
   on the production stdio server named `bitterless`, has a monotonic 12-digit `version_code`, and
   teaches explicit-intent, read-only Preview use. It must contain no machine-specific path,
   credential, file content, or private user data.
2. Expose exactly one new MCP tool, `preview.open`, with the strict input `{ path: string }`. Reject
   unknown fields, empty/multiline/NUL/relative paths, and overlong input. The bridge delegates the
   validated absolute target to the existing `openOnlyPreviewAbsoluteTarget` orchestration and
   returns only `{ opened: true }`; it does not read or return file contents, enumerate directories,
   mutate files, echo the path, or create another OnlyPreview implementation.
3. Inject the Preview opener into `McpBridgeServer` from Main so bridge unit tests remain independent
   of Electron window creation and the bridge has no XPC-handler import cycle. A missing injected
   opener fails explicitly. Preserve all existing Todo and in-progress Trench MCP methods and their
   constructor/test seams.
4. Add an icon-only Tabler Robot action between Open Folder and Settings in the 32px MenuBar. The
   Shell store issues a typed capability-scoped `openAgentSkillGuide` request; the SFC only renders
   and binds localized state. Do not add a badge, red dot, acknowledgement, or renderer-local
   installation persistence.
5. Use a separate, non-modal, singleton `BrowserWindow` parented to the active OnlyPreview
   `BaseWindow`. A Shell DOM modal is forbidden because the sibling Preview `WebContentsView` would
   cover it. Register `onlypreview-guide`, retain only its saved size, and center/clamp it against
   the current parent display on every open. Use the native frame/close control, `minWidth: 800`,
   `minHeight: 600`, `autoHideMenuBar: true`, safe web preferences, exact-target navigation fence,
   explicit render-failure/parent/auth/quit cleanup, and no `modal: true` workflow blocking.
6. Issue the Guide its own `guide` host/role. Content may open the Guide; only the active Guide host
   may call `getAgentSkillGuideInfo`. The Guide must not receive or exercise content workspace/file,
   Settings, native file-menu, external-open, recent-directory, or standalone window-control
   capabilities. Its renderer-side XPC client is an exact
   `Pick<OnlyPreviewApi, 'getAgentSkillGuideInfo'>` and does not import the full content client. The
   existing tokenless Home `openOnlyPreviewWindow` endpoint remains a separate idempotent global
   launch action, not Guide-token authority. The shared preload remains static data only and
   recognizes the new `guide` mode.
7. Build Guide information in Main at load time: ensure the current MCP shim, derive the current
   server name/config, resolve the fixed dev or packaged `bitterless-preview` directory, and
   fail-close unless every required skill file is a readable regular non-symlink file. Return to the
   renderer only the server name, an English complete-setup instruction, and the expected skill version. That single
   instruction includes the helper/config, complete skill directory, Codex/Claude destinations,
   production-versus-DEBUG warning, and new-session guidance. Do not return separate helper, config,
   skill, bridge, workspace, content, or token fields.
8. The Guide UI contains only `LOCAL MCP`, the direct title `Copy the skill to your agent`, the
   existing test-instance warning when the server is not `bitterless`, and one
   `Complete setup instructions` copy card with the hint `Copy these instructions to your agent.
   They include the skill and MCP setup.` Remove the explanatory MCP-versus-skill summary and all
   detailed step cards/fields. Copy only the English instruction. Show localized pending, copied,
   copy-failed, and restart-required feedback without adding another setup path.
9. Copy the complete skill directory through `extraResources` because normal Markdown is excluded
   from the application package. The existing `afterPack` desktop audit must fail unless all four
   required Preview-skill files are present as non-empty real regular files under packaged
   `Resources/agent-skills/bitterless-preview`; symlinks and partial packages are invalid. Add the
   Guide renderer to Vite, CSP/output audits, renderer i18n, first-party logging, and exact inventory tests. Reuse the existing OnlyPreview light palette,
   Royal Blue accent, system type, Arco mini controls, Tabler Copy icon, BEM/name attributes, and a
   quiet centered reading column. Clipboard writes occur only after an explicit click, with no
   preload clipboard bridge.
10. Preserve unrelated Coin/Trench/Todoist work already present in the shared working tree. Do not
    reformat or stage whole overlapping files. Do not run Electron, Playwright, E2E, the full
    Bitterless application, `yarn build`, or any path that can access the owner's Keychain.

# Verification

- Pure Node tests for `preview.open` schema/dispatch, absolute-path validation, unknown-field
  rejection, missing-opener failure, exact `{ opened: true }`, and propagation to one injected
  opener without Electron startup
- Pure Node tests for dev/packaged skill-path resolution, complete-file/no-symlink fail-close,
  English production-versus-DEBUG setup wording, version/frontmatter/sidecar dependency, complete
  `extraResources`, afterPack packaged-file enforcement, and absence of machine paths or credentials
- Source/integration guards for exact API allowlists, content-to-Guide and Guide-only-info role
  boundaries, singleton parent/bounds/window-state/security/navigation/teardown, MenuBar wiring,
  static preload mode, one-card Guide UI, Vite/i18n/log registration, clipboard click handling, and
  no path/content capability expansion
- `node --test tests/onlypreview/*.test.mjs`, `yarn typecheck:node`, renderer i18n check, focused
  ESLint, skill frontmatter validation, and `git diff --check`
- No Electron/Playwright/E2E/full-app/build/Keychain execution. Ral manually opens the Guide,
  copies the complete setup text, installs the skill, starts a new agent session, and asks it to
  open one explicit file and one folder in OnlyPreview.

# Delivery Evidence

- Implemented on 2026-08-09. The canonical `skills/bitterless-preview/` package contains exactly
  `SKILL.md`, `agents/openai.yaml`, `references/mcp-setup.md`, and `references/tools.md`, with
  version `260809003838` and one production stdio dependency named `bitterless`. It teaches only
  explicit known-path, read-only human inspection and contains no machine path or credential.
- The stdio catalog exposes one `preview.open` tool. Main injects the existing
  `openOnlyPreviewAbsoluteTarget` orchestration into the bridge; strict validation rejects
  non-object, unknown, empty, multiline, NUL, relative, and over-16,384-character inputs. Success
  delegates one unchanged absolute target and returns only `{ opened: true }`.
- The MenuBar places an icon-only Tabler Robot between Open Folder and Settings. It opens one
  parented, non-modal native Guide with its own `guide` host, size-only restoration, per-open
  parent-display centering/clamping, strict no-external navigation fence, sandboxed static preload,
  render/parent/auth/quit teardown, and no Guide DevTools binding.
- Main verifies the real skill root, intermediate directories, and all four non-empty readable leaf
  files without following symlinks. The renderer receives exact
  `{ serverName, skillVersionCode, instruction }`; its only setup surface is `LOCAL MCP`, the title
  `Copy the skill to your agent`, the conditional test-instance warning, and one
  `Complete setup instructions` card whose icon-only copy action writes the English instruction.
  Its XPC client is the exact info-only `Pick` and does not import the full content client; Home's
  tokenless idempotent launch endpoint remains an independent public action.
- Electron Builder copies the complete skill to `Resources/agent-skills/bitterless-preview`. The
  afterPack audit rejects missing, empty, leaf-symlink, and intermediate-directory-symlink packages.
  Guide renderer/CSP output, logging, i18n, and the retained MenuBar E2E inventory are updated.
- `node --test tests/onlypreview/*.test.mjs` passed 62/62; `node --test
  scripts/mcp/preview-open.test.mjs` passed 1/1; focused desktop-package audit cases passed 3/3;
  application diagnostics passed 10/10; `yarn typecheck:node`, `yarn typecheck:mcp`, renderer i18n,
  focused error-level ESLint, and `git diff --check` passed.
- Full desktop-package audit execution reached 14/16: the new Preview-skill gates passed, while two
  unrelated shared-tree baselines remain in the package dependency inventory and publish ordering.
  Full `yarn typecheck:web` likewise reported only existing connector, poker-test, Home, and shared
  diagnostics, with no OnlyPreview diagnostic. Skill-creator `quick_validate.py` was blocked because
  local Python lacks PyYAML; the new pure Node test validated the same YAML through `js-yaml`.
- Electron, Playwright, E2E, the full Bitterless application, `yarn build`, and Keychain paths were
  not run by explicit instruction. Ral should manually open the Robot Guide, copy the instruction,
  install the complete skill in a fresh agent session, and ask it to open one explicit file and one
  folder in OnlyPreview.
- Independent review `onlypreview-agent-skill-guide-009-1` passed with no open P1, P2, or P3
  finding after the Guide renderer client was narrowed to `getAgentSkillGuideInfo` only.
