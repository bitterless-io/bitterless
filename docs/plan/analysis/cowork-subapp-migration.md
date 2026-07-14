# Cowork Sub-application Migration Analysis

## Goal

Move the complete main-window capability of `projects/micromeet-cowork` at commit `689832d` into
Bitterless as a Mini App, using Todo's effective opening pattern: authenticated card → XPC command →
single independent window.

## Module decomposition

| Module | Input | Output | Dependencies |
|---|---|---|---|
| Mini App registration | authenticated home renderer, i18n | Cowork card and Open action | home router, XPC emitter |
| Cowork host handler | Open/auth/quit events | singleton focus/create/destroy | Cowork DB boot, window helper |
| Cowork window graph | renderer bounds and browser actions | Home + operation + Control + Workbench | Electron WebContentsView, CDP |
| Cowork XPC/preload contracts | typed renderer calls | main services and DB calls | `electron-xpc` center |
| Cowork persistence | namespaced data root/partition | config, tabs, chat, filters, auth, skills | SQLCipher, safeStorage |
| Agent/skill/file runtime | user messages, page/workspace evidence | streamed replies, tools, artifacts | pi SDK, parsers, relay APIs |
| Capture/replay runtime | active operation view | trace, evidence, replay, exports | CDP, SQLite/files |
| CLI integration | packaged CLI resource and Cowork session | integration commands/reports | `@micromeet/cli`, credentials |
| Host adapters | Cowork lifecycle/update/shortcut requests | Bitterless-owned behavior | updater, auth handler, cleanup |
| Verification harness | built Bitterless app | parity smoke and E2E evidence | source `check:*`, Playwright |

## Integration enumeration

Every connection below must use a real implementation in the delivered app.

1. Mini Apps card → `CoworkWindowHandler.openCoworkWindow()`.
2. Cowork host handler → hidden Cowork SQLite window → boot-ready XPC result.
3. Cowork host handler → Cowork window helper → Home renderer.
4. Home renderer measured placeholders → main window helper → operation/Control/Workbench bounds.
5. Home/Control/Workbench renderers → coach preload → `CoachXpcHandler`.
6. `CoachXpcHandler` → Cowork window, agent, capture, skill, file, integration, and auth services.
7. Cowork renderers/main → namespaced DAO emitters → hidden SQLite preload.
8. Operation WebContentsView → DebuggerCapture/ReplayEngine; no privileged preload crosses this edge.
9. Pinned AI-CRMS tab → trusted-host auth bridge → namespaced Cowork session DAO → chat/CLI session.
10. Cowork updater calls/events → Bitterless update service; no Cowork feed may update Bitterless.
11. Cowork tab shortcuts → Cowork-partition web contents only; no Todo/Home interception.
12. Bitterless auth invalidation and quit → Cowork runtime cleanup.
13. Integration Workbench → bundled Micromeet CLI path → packaged `extraResources` executable.
14. Bitterless build → all Cowork main/preload/renderer entries and native/runtime dependencies.
15. Bitterless-launched Playwright test → Mini Apps → real Cowork window graph.

## Source-to-target strategy

- Vendor the upstream Cowork runtime into a clearly namespaced Bitterless source subtree.
- Mechanically rewrite source aliases to Cowork-specific aliases; do not let `@main` or `@shared`
  resolve to unrelated Bitterless modules.
- Exclude the standalone Cowork `app.main.ts`, publish/signing/update entrypoint, generated output,
  generated CLI binaries, `.env` files, and credentials.
- Preserve current Cowork behavior and source structure. Make only embedding changes: lifecycle,
  paths/partition, handler collisions, update adapter, scoped shortcuts, and build entries.
- Vendor the Micromeet CLI source as a Yarn workspace and build/stage its platform binary during
  Bitterless packaging; never commit generated release binaries.

## Compatibility decisions

- Keep the concurrently pinned Electron `40.10.6` and current native SQLite package unless a concrete
  build/runtime error proves a version change is required.
- Disable main-process bytecode because Cowork requires dynamic module loading and function-source
  serialization.
- Retain the upstream Cowork UI styling for parity. Import the Bitterless shared theme before
  Cowork-specific styles so base host behavior is available without rewriting the work surface.
- Use a persistent Cowork Chromium partition and a `userData/cowork` data root to prevent collision
  with Bitterless's own `skills`, database, cookies, and model settings.
- Host update events back the Cowork Update affordance; the embedded code never contacts the
  standalone Cowork release feed.

## Risks and checks

| Risk | Required check |
|---|---|
| Only renderers are copied | Assert window graph, preloads, XPC, DB, agents, capture, CLI all exist. |
| XPC name collision (`SessionDao`) | Namespace handler and every emitter string; exercise login/session. |
| Data collision (`skills`, `config`) | Assert all Cowork writes resolve under Cowork data root. |
| Bytecode breaks dynamic import/CDP source | Build without bytecode and run parser/snapshot checks. |
| Cowork shortcuts affect host | Focus Todo/Home and prove Cowork Cmd/Ctrl+T/W handlers do not fire. |
| Wrong updater/feed | Assert only Bitterless manifest/feed is used in embedded process. |
| Native SQLite ABI mismatch | Load/open encrypted DB under Electron `40.10.6`. |
| CLI absent in package | Package smoke resolves and executes platform CLI resource. |
| Hidden-window leak | Auth invalidation and host quit destroy all Cowork web contents/timers. |
| Legacy fixed/derivable encryption keys | New profile rejects missing keys; CLI/main share a random local v2 key. |
| Proxy setting leaks or survives Cowork teardown | Redact logs; scope dispatcher ownership to Cowork lifecycle and conditionally restore it. |
| Upstream drift during port | Record source commit and run a tracked-file parity inventory. |

## Delivery split

- `cowork-subapp-001`: runtime vendor, host integration, persistence isolation, dependencies, CLI
  workspace/resource wiring, and compile/build success.
- `cowork-subapp-002`: migrate/adapt source checks, add Bitterless entry E2E, and verify the real
  opening/focus/window graph path.
