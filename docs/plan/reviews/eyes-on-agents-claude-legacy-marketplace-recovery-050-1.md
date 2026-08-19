# EyesOnAgents Claude Legacy Marketplace Recovery — Independent Acceptance

Status: final accepted for non-Electron scope; owner packaged Repair and Claude reload E2E pending

Date: 2026-08-18

## Verdict

**Implementation: PASS.** No open P1, P2, or P3 finding blocks Ral's packaged test. Packaged
production derives the one allowed legacy source from its applied runtime profile, reclaims only an
exact Bitterless-owned unqualified DEBUG_PROD registration, and completes the current production
install without deleting the legacy directory. The migration is retryable across the uninstall to
marketplace-remove checkpoint.

Renderer snapshot actions now treat a null XPC result as a failure, preserve the last accepted
snapshot, fetch current status, surface a bounded Claude bridge/provider error, and reject stale
provider revisions. The task stays `in-progress` for Ral's packaged Repair and Claude reload test.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

### Resolved during review

- **P1 · production migration was unreachable.** The first freeze gated injection on a
  `Bitterless_PROD` userData basename, while the production runtime profile uses `Bitterless`.
  Main now calls a typed resolver that accepts only `{ id: 'production', appName: 'Bitterless' }`
  with userData exactly `<appData>/Bitterless`, then derives the deterministic sibling
  `<appData>/Bitterless_DEBUG_PROD/eyes-on-agents/claude-marketplace`. Custom E2E userData and every
  non-production profile return null.
- **P2 · interrupted migration could not be retried.** If the old plugin uninstall succeeded but
  marketplace removal failed or the app exited, the next Repair saw zero namespace plugins and
  incorrectly reported a shared namespace. The refreeze admits exactly two proven checkpoints:
  one exact user plugin, which it uninstalls, or zero plugins, which resumes at the repeated
  inspection/proof and marketplace removal. Wrong scope, another plugin, or more than one entry
  still fails before mutation. A deterministic remove-failure then retry regression covers this
  path.
- **P2 · capability/update errors were not retained for null-XPC recovery.** Candidate resolution
  originally ran outside the install error-retention boundary, so an old-only installation threw
  the correct update message in Main but left `claudeBridge.error` empty. Post-migration normal
  setup failures had the same gap. The final freeze wraps the complete install path, allowlists and
  bounds safe messages, retains conservative bridge status, and strips executable paths and raw
  CLI output. Regressions cover old-only update status, null-XPC propagation, and a later
  marketplace-registration failure.
- **P3 · compatible executables were capability-probed before every refresh.** The initial cache was
  only a candidate-order hint: each refresh still spawned `plugin --help` and marketplace-remove
  help. The final freeze returns the proven cached executable directly, invalidates it after a
  command launch failure, and never caches incompatible candidates. The focused test proves exactly
  one old-plus-current capability pass across Setup and a later refresh.

### Final copy follow-up

The Repair state renders exactly one direct action sentence in each locale:

- English: `Reinstall and enable the Bitterless Claude plugin, then restore local observation.`
- Chinese: `重新安装并启用 Bitterless Claude 插件，然后恢复本地观测。`

The former vague problem/“verified repair” copy is absent from renderer sources. The focused
rendered-DOM regression verifies the English replacement and absence of the former phrase; the
Chinese string remains type-coupled to the same i18n shape. This follow-up changed no component
markup, layout styling, or Codex behavior. Both focused task tests remain below 800 lines.

### Finder PATH capability follow-up

Read-only live inspection matched the owner report without mutating Claude configuration:

- the Finder/launch-services environment has no configured PATH override and a system-only PATH
  cannot resolve `claude`;
- `~/.local/bin/claude` resolves to Claude Code 2.1.138: plugin help advertises marketplace support,
  but marketplace-remove help does not advertise `--scope`;
- `/usr/local/bin/claude` resolves to Claude Code 2.1.220 and both required probes pass.

The fixed allowlist encounters those installations in that order when Finder supplies no useful
PATH. Selection skips 2.1.138, caches 2.1.220, and uses only the latter for inspection and mutation.
There is no unscoped marketplace-removal fallback.

## Recovery and safety matrix

| Case | Verified behavior | Result |
|---|---|---|
| Production source derivation | Only the live production profile at `<appData>/Bitterless` receives the exact DEBUG_PROD sibling root | PASS |
| Custom E2E/non-production | Resolver returns null; qualified debug/test identities cannot reclaim production | PASS |
| Finder candidate order | Fixed allowlist encounters live 2.1.138 before 2.1.220 when PATH has no Claude directory | PASS |
| Capability selection | Candidate must pass plugin marketplace help and marketplace-remove `--scope`; old candidate is skipped before mutation | PASS |
| Capability cache | Compatible executable is probed once and reused; incompatible candidate is never cached and is re-probed on a later attempt | PASS |
| Old-only failure | Setup stops before mutation with a bounded actionable update message retained in bridge status | PASS |
| CLI mutation scope | Every marketplace removal includes `--scope user`; no unsafe unscoped fallback exists | PASS |
| Operation errors | Install-path failures retain a bounded stage name without executable path, stdout, or stderr | PASS |
| Source identity | Registered source must resolve to the injected deterministic legacy root | PASS |
| Ownership proof | Profile/root/catalog directories are non-symlinks; marker and catalog are bounded regular files with exact schemas and values | PASS |
| Namespace proof | Initial namespace is either one exact user plugin or the proven zero-plugin interrupted checkpoint | PASS |
| Migration order | Exact uninstall, namespace reinspection, repeated root identity/ownership proof, exact marketplace remove, removal reinspection, then normal production install | PASS |
| Crash retry | Remove failure after successful uninstall leaves zero plugins; the next Setup/Repair resumes and completes | PASS |
| Fail-closed inputs | Unknown source, malformed ownership, extra plugin, wrong scope, and non-production identity issue no mutating Claude command | PASS |
| TOCTOU boundary | Source, namespace, marker/catalog, and root device/inode are rechecked after uninstall and before marketplace removal | PASS |
| Filesystem scope | Recovery never removes the legacy directory; normal artifact cleanup targets only the current profile root | PASS |
| Setup/Finish/Repair | The UI routes enable, finish, and repair through the same `installClaudeBridge()` lifecycle | PASS |
| Restart guidance | Reload/open-new-session appears only after exact installation; failed recovery remains Repair | PASS |
| Null XPC | Null action output triggers a fresh snapshot read and a bounded bridge/provider error without dereference | PASS |
| Snapshot ordering | A lower Claude provider revision cannot replace the last accepted snapshot or its error | PASS |
| Codex isolation | No Codex bridge, runtime-state, storage, or lifecycle mutation is introduced | PASS |

## Static evidence

- `resolveLegacyProductionDebugClaudeMarketplaceRoot()` validates the production profile and exact
  current userData path before returning the DEBUG_PROD sibling; Main is the only runtime injector.
- `recoverLegacyProductionDebugMarketplace()` validates the exact source, exact marker/catalog,
  exclusive user namespace, and interrupted zero-plugin checkpoint. It re-inspects and re-proves
  before removal, inspects again after removal, and never calls filesystem deletion on the legacy
  root.
- `performInstall()` runs recovery before current-profile ownership checks and the existing
  marketplace add/update, plugin install/enable, and final exact inspection.
- `resolveExecutable()` accepts only an allowlisted candidate whose two bounded help probes prove
  marketplace and scoped-removal capability, then reuses that cached executable across refreshes.
- `commandFailureStage()`, `safeInstallError()`, and `retainInstallError()` convert failures to
  bounded stage/action messages and keep them visible through the renderer's null-XPC refresh.
- `runSnapshotAction()` handles a null snapshot through `getSnapshot()`, the existing provider
  revision fence, and a 300-character action-error bound.
- `ClaudeObservationCard.vue` uses one install handler for enable, finish, and repair; reload and
  new-session guidance remains a post-install action.

## Independent verification

| Check | Result |
|---|---|
| `node --test scripts/eyes-on-agents/claude-legacy-marketplace-recovery.test.mjs` | PASS — 6/6 |
| `node scripts/eyes-on-agents/claude-setup-recovery.test.mjs` | PASS |
| `yarn test:eyes-on-agents:claude` | PASS — all stages, including recovery 6/6 plus admission 6/6 and provider suite 23/23 |
| `yarn typecheck:eyes-on-agents:core` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn check:renderer-i18n` | PASS |
| `node scripts/eyes-on-agents/claude-setup-render.test.mjs` | PASS — direct Repair copy rendered; former phrase absent |
| `git diff --check` | PASS |

No Electron process, browser E2E, packaging, commit, or sync command was run. This review changes
only this acceptance file and intentionally leaves task 050 `in-progress`.

## Owner acceptance remaining

In the newly packaged production app, press **Repair** once, confirm the status advances to
Reload/Open new session without manual Claude marketplace cleanup, reload plugins or open a new
Claude session, and verify the first Hook receipt. Confirm the DEBUG_PROD profile directory remains
on disk.

## Conclusion

**Accepted for the verified scope.** Production recovery is exact, bounded, fail-closed,
crash-retryable, and non-destructive. Ral's packaged Repair and Claude reload/new-session E2E is the
remaining completion gate.
