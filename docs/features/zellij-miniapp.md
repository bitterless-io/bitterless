# Zellij miniapp

The manual initialization, enable preference and first-run-only defaults below are superseded
by [automatic opening, remembered cwd and ensured color defaults](zellij-auto-open-directory.md)
(owner decision 2026-09-12). Existing session identities and native-view protections remain.
The toolbar is 48px high; its gear opens shared Workbench Terminal settings instead of an
inline panel. KDL template versions upgrade old configurations after backup and validation.

Status: implemented; human testing pending. Owner request: 2026-09-10, launch the local
terminal from a miniapp, initialize it there, edit shortcuts, and copy/open its
configuration directory. This extends the existing default-off Terminal setting.

## Interface and flow

```text
Home → Miniapps → Zellij (one window)
  Zellij   [status]   [Enable terminal]   [Initialize and open]   [Settings]
  Settings: split down / split right / close pane shortcuts     [Save]
            Configuration directory                            [Copy] [Open]
  Local Zellij web: built-in session list and terminal panes
```

- Opening the miniapp only reads state. Terminal remains off by default; enabling
  the switch alone does not start a process. Explicit Initialize and open performs
  missing configuration creation, token provisioning, server start/reuse, login,
  and local terminal navigation. Errors remain visible and retryable.
- Use bundled Zellij 0.45.1, loopback `127.0.0.1:12877`; never silently select another
  port or a system binary. Require a matching Zellij HTTP version response before
  reusing a listener. Report occupied ports or unsupported versions.
- A local renderer owns the toolbar/settings. The terminal is a separate native
  WebContentsView, without preload or Node, with sandbox and normal web security.
  Zellij sends `X-Frame-Options: DENY`; do not use an iframe or strip response headers.
  Terminal navigation stays on its configured loopback origin; arbitrary URLs and
  popups cannot acquire application privileges. Keyboard events reach the terminal.
- Main process creates tokens using `zellij web --create-token` (no token-name flag),
  keeps credentials encrypted with Electron safeStorage in application data, and
  authenticates the terminal session using POST `/command/login` with remember_me.
  No token reaches renderer IPC, logs, URLs, repository files, or the clipboard.
  Debug/unpackaged builds follow the existing no-Keychain rule: retain a token only
  in main-process memory, never access the encrypted credential file or safeStorage,
  and provision again after restart. Packaged release requires encrypted persistence
  and reports encryption failure without falling back to plaintext or memory.
- Spawn only on explicit initialization. Track an owned foreground server child;
  closing the miniapp leaves it running until application quit or disabling Terminal.
  Stop only that owned child, never a reused server or shell session. Never call
  `zellij web --stop`, which stops every instance. Disabling hides/detaches the
  embedded terminal, including when changed from the existing Settings page.
- On macOS, every owned Zellij CLI/server child uses a private short socket base
  `/tmp/bz<base36 uid>-<runtime profile id>` unless `ZELLIJ_SOCKET_DIR` is explicitly
  supplied. Keep global `TMPDIR` and existing session names unchanged. The complete
  session socket path must fit macOS's 103-byte limit; HTTP health alone does not
  verify session creation. Native spawn errors, exit codes/signals and bounded,
  sanitized stderr reach the main log; token stdout never does. See
  [startup diagnosis and repair](../issues/zellij-terminal-no-error-trace.md).

## Configuration

- Resolve `ZELLIJ_CONFIG_FILE`, then `ZELLIJ_CONFIG_DIR/config.kdl`; otherwise use
  the first existing directory: on Unix `~/.config/zellij`, platform ProjectDirs,
  then `/etc/zellij`. macOS ProjectDirs is
  `~/Library/Application Support/org.Zellij-Contributors.Zellij` and ignores XDG;
  Linux uses an absolute `XDG_CONFIG_HOME/zellij` when supplied. Windows uses
  `%APPDATA%/Zellij/config`. If no directory exists, default to `~/.config/zellij`
  on Unix or the Windows ProjectDirs path.
  Pass the selected config file explicitly to the CLI. Missing configuration is
  created only by Initialize or explicit Save, never by opening the miniapp.
- macOS defaults: `Super d` creates a pane on the right (side by side), `Super Shift d`
  creates a pane below (stacked), and `Super w` closes the current pane. Other platforms
  retain down/right/close on `Ctrl Alt d`, `Ctrl Alt Shift d`,
  `Ctrl Alt w` to avoid Windows desktop/tab shortcuts. Display existing bindings
  when recognized, with editable Zellij key syntax and clear action labels.
- Read and edit only these single-action bindings in the first `keybinds` block's
  `normal` mode; preserve `pane`, `shared_except`, and other modes byte for byte.
  The settings hint explains Normal mode: use Ctrl+G from Locked or Esc from other
  modes first. Parse KDL
  v1 with `@bgotink/kdl/v1-compat` and use source locations to preserve unrelated
  source bytes; do not format the whole document as KDL v2 or append a second
  top-level `keybinds`. Remove superseded managed keys rather than leaving aliases.
- Reject duplicate/invalid shortcuts and changes to conflicting unrelated bindings.
  Read/check the latest source revision before writing; back up an existing file,
  validate a temporary candidate with `--config <file> setup --check`, requiring
  exit 0 and `[CONFIG FILE]: Well defined.`, then atomically replace it. Failures
  preserve the original. Keep unrelated settings such as `session_serialization false`.
- Copy and Open operate on the resolved directory through bounded main-process
  actions. No arbitrary-path or arbitrary-command IPC. Zellij owns live reload,
  session creation, selection, and pane rendering.

## Acceptance and verification

Verified on 2026-09-10 using mocks and temporary files:

- `yarn test:zellij`: 18 tests covering default-off/no implicit launch, service
  reuse/collision, authentication failure, owned-child shutdown and retry,
  development memory-only and packaged encrypted token storage, safe KDL edits,
  Normal-only preservation, backups/drift/rejected candidates, config resolution,
  singleton window, isolated native view, navigation bounds, and close lifecycle.
- Focused main/preload TypeScript and Zellij renderer Vue/TypeScript checks passed.
  New source-file ESLint and `yarn check:renderer-i18n` passed.
  Extending the renderer typecheck to both shared miniapp launch surfaces reports
  the existing `omniWindow.emitter.ts` import of `@main/xpc/omniWindow.handler`,
  which the renderer tsconfig intentionally does not resolve. No new Zellij
  diagnostic was reported; this unrelated main/renderer import was left unchanged.
- The real standalone Zellij renderer Vite build passed, including Vue, Less,
  localized text, and compiled borderless icon styling.
- The bundled macOS ARM binary accepted a generated temporary KDL candidate with
  `setup --check`, exit 0 and `[CONFIG FILE]: Well defined.`. Package dependency
  classification and macOS binary-signing registration checks passed.

No Electron app, live server, or token-creation command was started. Ral's real
configuration and token database were not read or written during verification.
Full application packaging and live macOS/Windows terminal behavior remain human
testing; there was no independent review or Electron E2E run.

Human flow: enable Terminal → open Zellij miniapp → Initialize and open → create or
select a session → return to Normal (Locked: Ctrl+G; other modes: Esc) → verify the
three shortcuts → save a changed shortcut → copy/open
configuration directory → switch/close/reopen miniapp → disable Terminal. Repeat in
both apps, with macOS/Windows packaged runtime testing still required.
