# EyesOnAgents Claude Observation And UI Review — Round 1

Status: accepted

Date: 2026-08-17

## Findings

No open P1, P2, or P3 finding remains in the reviewed task 038 scope.

## Blocking-fix closure

- **Claude plugin artifact compatibility — closed.** The generated local marketplace and plugin
  include the strict-required description and author metadata. The six lifecycle events use the
  current command Hook exec form: a real executable plus an argument vector, with
  `${CLAUDE_PLUGIN_ROOT}` substitution and a two-second timeout. Both generated roots pass Claude
  Code 2.1.220 `plugin validate --strict`.
- **Owned mutation boundary — closed.** Enable, Repair, and Disable use fixed user-scope Claude CLI
  arguments and never edit a settings file. Read-only inspection proves the exact marketplace
  source, catalog, target plugin, scope, version, artifact tree, and namespace exclusivity before
  mutation. The ownership gate is repeated after artifact staging, and removal re-inspects after
  target uninstall before deleting only the exact marketplace and Bitterless-owned artifact root.
- **Repair, removal, and state recovery — closed.** Repair rotates the installation generation,
  stops intake, clears the old private outbox before enabling the new wrapper, and forces an exact
  uninstall/install/enable cycle so Claude does not retain a same-version cached wrapper. Corrupt
  bridge state remains visible as a Repair/Disable-capable error; Disable is idempotent and clears
  every Bitterless-owned outbox generation without touching another plugin or Hook.
- **Content-free durable delivery — closed.** Hook input is bounded and reduced before socket or
  disk delivery to event name, UUID, canonical-candidate transcript path, and cwd. Prompt, reply,
  reasoning, tool, attachment, and raw Hook fields cannot enter the socket frame, offline outbox,
  SQLite, or logs. The private bounded outbox has ordered replay, commit-only ACK, receipt dedupe,
  quarantine, and a persistent coverage-gap barrier; a failed gap callback retries instead of
  falsely committing observation proof.
- **Truthful connection and freshness state — closed.** Persisted intent is not reported as enabled
  before a fresh Claude CLI inspection. Observing additionally requires a current-generation live
  receipt with no restart or recovery condition. Drift, listener state, restart-required state,
  coverage loss, and corrupt state remain distinct. Canonical JSONL mtime advancement renews an
  active Claude Hook lease without changing working order; poll completes before expiry, and a
  future mtime cannot indefinitely renew a stopped session.
- **Cross-platform helper runtime — closed.** macOS and Windows persist the packaged executable;
  packaged Linux prefers only an absolute, regular, non-symlink, executable `APPIMAGE` path instead
  of the ephemeral mount path. POSIX uses an executable wrapper, Windows uses `powershell.exe` with
  arguments, and both set `ELECTRON_RUN_AS_NODE=1`, so Hook helpers do not create an Electron Dock
  process or depend on a user-installed `node` being on `PATH`.

## Contract assessment

- Claude Code's current [official Hook reference](https://code.claude.com/docs/en/hooks) documents
  `args` as shell-free exec form,
  `${CLAUDE_PLUGIN_ROOT}` substitution, and `StopFailure` as a lifecycle event. Local Claude Code
  2.1.220 exposes the expected plugin lifecycle commands; its JSON list shapes match the bounded
  parsers used by the bridge.
- Claude observation and inventory are provider-qualified. Codex App Server, Codex Hook, archive,
  raw snapshot, prompt, unread, completion, and Open paths remain explicitly scoped and the full
  existing EyesOnAgents suite passes.
- Claude Hook lifecycle evidence cannot fabricate an archive state. Only validated Claude Desktop
  metadata owns Claude archive/unarchive state; CLI-only sessions remain `unknown`.
- The provider-aware migrations retain existing Codex data and add only the Claude/private runtime
  fields needed by the feature. All retained and fresh SQLite baselines converge in the migration
  audit.
- Renderer contracts expose provider identity and capabilities without exposing transcript paths,
  generated commands, socket paths, or plugin internals. Ral's live Electron visual acceptance is
  intentionally separate from this source/backend review.

## Verification

- `yarn test:eyes-on-agents` — pass, including Claude inventory, Claude Hook bridge, repository,
  core/project resolver, Codex App Server/bridge/durable Hook, project filter, and all 52 UI tests.
- `yarn test:eyes-on-agents:claude` — pass again after the strict-manifest fix.
- `yarn audit:sqlite-migrations` — pass across 14 Core, 7 Maestro, 10 Todoist, and 8 Trench
  baselines.
- `yarn typecheck:eyes-on-agents:core` — pass.
- `yarn typecheck:eyes-on-agents:ui` — pass.
- `yarn build` — pass; standalone `claudeHookHelper.js` and `claudeDirectoryWatcher.js` entries are
  emitted.
- A temporary artifact generated directly by the current bridge passes local Claude Code 2.1.220
  `claude plugin validate --strict` for both the marketplace root and plugin root.
- Local read-only CLI inspection confirmed Claude Code 2.1.220 `plugin list --json` and
  `plugin marketplace list --json` field shapes used by the implementation.
- `git diff --check` — pass before this review file was authored and again after the final
  strict-manifest verification.
- No Electron process or UI automation was launched.

## Conclusion

**Pass.** Task 038's backend, Claude plugin/Hook lifecycle, persistence, provider isolation, and
source-level UI integration are accepted. The implementation is ready for Ral's requested live
Electron plugin-installation and visual/runtime acceptance.
