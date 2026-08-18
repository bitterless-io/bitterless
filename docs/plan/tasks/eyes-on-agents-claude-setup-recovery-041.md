---
id: eyes-on-agents-claude-setup-recovery-041
scope: One-action Claude plugin setup, interrupted-install recovery, and compact actionable guidance
status: implemented; owner verification pending
depends-on: [eyes-on-agents-claude-provider-toggle-040]
---

# EyesOnAgents Claude Setup Recovery

## Objective

Make **Enable Claude observation** complete every Bitterless-owned installation and enablement step
that Claude exposes to an external app, recover an interrupted setup through one fail-closed
Finish action, and reduce the remaining Claude-session reload to one explicit action.

## Failure evidence

- On Claude Code `2.1.220`, an isolated user-scope install returned success and left the plugin
  enabled; an immediate explicit `plugin enable` of that same plugin returned exit code `1`.
- Ral's installed `bitterless-observer@bitterless-local` is present at user scope and reports
  `enabled: true`, while Bitterless bridge state remains at its pre-install checkpoint with
  `installed: false`.
- The same installation generation has pending metadata-only `SessionStart` and `SessionEnd`
  deliveries, including events emitted by plugin-management probes. Because setup never committed,
  they are not trusted as observation proof and must be cleared with that incomplete generation.
- Existing Claude Desktop Code processes predate the plugin install and therefore cannot load its
  Hook definitions until `/reload-plugins` or a fresh local Code session. Claude exposes no public
  external API that lets Bitterless execute that slash command inside an existing Desktop session.

## Required behavior

- Keep marketplace add/update, plugin install/reinstall, and plugin enable entirely inside the
  Bitterless action. After install, inspect the exact user plugin and run `plugin enable` only when
  inspection proves it is disabled; an already-enabled plugin is success, not an error.
- Project a strict setup action separately from observation health:
  `enable | finish | reload | retry | repair | none`.
- Recognize **finish** only when the intermediate bridge state and exact Bitterless ownership can be
  proven. Any ambiguity remains Repair/error and never adopts a third-party plugin.
- Finish through the existing fail-closed Repair boundary: stop intake, clear only the owned
  setup-period outbox, rotate the installation ID, reinstall the exact user plugin, verify its
  enabled state, then start the new listener generation. Do not adopt pre-commit deliveries as
  observation proof; plugin-management probes may have emitted them while setup was incomplete.
- Keep Repair's generation rotation and exact ownership checks for real drift, corruption, or
  recovery errors.
- Report fixed, bounded operation stages such as marketplace, install, enable, or final inspection;
  never surface arbitrary CLI output or Hook content.
- Replace the always-visible numbered Claude setup guide with one compact state-driven action:
  Enable, Finish setup, Reload in Claude, Retry listener, Repair, or Observing.
- For a newly installed plugin with no current-session receipt, provide one Main-owned, fixed
  **Open new Claude session** action using Anthropic's published `claude://code/new` Desktop route.
  Also provide a pathless **Copy `/reload-plugins`** action for users who prefer to keep the current
  Claude session. Explain that the card updates automatically after the first event; do not require
  a separate Check status click.
- Keep `/hooks` behind a secondary **Still not working?** troubleshooting disclosure. It is an
  inspection tool, not a normal enable step and not proof of workspace trust.
- If the exact plugin has previously delivered an event but the local listener is stopped, show
  **Listener paused** with one primary **Retry listener** action. A failed restart is a visible,
  bounded error; it is never relabelled as Awaiting activity.
- After a successful reload-command copy, change the button label to **Copied** and announce it
  through a polite live region. A failed copy keeps the original label and existing error surface.
- Preserve the Claude provider switch, directory controls, plugin removal, every unrelated Claude
  plugin/setting/Hook/transcript, and all Codex behavior.

## UI contract

```text
Not installed
┌ Claude observation · Not installed                     ┐
│ Lifecycle status needs the Bitterless Claude plugin.   │
│                         [Enable Claude observation]     │
└─────────────────────────────────────────────────────────┘

Interrupted after Claude installed and enabled the plugin
┌ Claude observation · Finish setup                      ┐
│ Claude already has the enabled plugin. Bitterless can  │
│ safely rebuild its local listener setup.               │
│                                     [Finish setup]      │
└─────────────────────────────────────────────────────────┘

Installed, existing Claude session has not loaded it
┌ Claude observation · Reload in Claude                  ┐
│ Existing Claude sessions need one plugin reload.       │
│ [Open new Claude session]  [Copy /reload-plugins]      │
│                              [Still not working?]      │
│ This card updates automatically after the first event. │
└─────────────────────────────────────────────────────────┘

Exact plugin, local listener stopped
┌ Claude observation · Listener paused                    ┐
│ The plugin is enabled, but the local listener stopped.  │
│                                  [Retry listener]       │
└─────────────────────────────────────────────────────────┘
```

The action surface reuses the current quiet Claude card background. It adds no nested decorative
card, border, shadow, status row, or full-time instructional checklist.

## Expected paths

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/main/eyesOnAgents/claudePluginBridge.service.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/shared/eyesOnAgents/**`
- `src/renderer/eyesOnAgents/**`
- `src/renderer/common/i18n/{en,zh}.ts`
- `scripts/eyes-on-agents/**`

## Verification

- Isolated Claude runner tests prove install-default-enabled skips `plugin enable`, while an exact
  disabled user plugin receives one enable command.
- Partial-state tests prove exact enabled setup exposes Finish, rotates to one verified generation,
  clears only its owned stale outbox, and starts observation; mismatched ownership fails closed.
- UI tests prove every setup state has one primary action, the Desktop action opens only the fixed
  `claude://code/new` route, `/hooks` is secondary troubleshooting, copy is a strict pathless
  action with visible success feedback, listener retry errors remain visible, and no Check status
  step is required after receipt.
- Existing install, Repair, Remove plugin, provider pause, directory observation, receipt, and
  Codex isolation suites remain green.
- Run full EyesOnAgents, Core/UI typechecks, renderer i18n, SQLite migration audit, production build,
  and `git diff --check` without launching Electron.
- Independent verification must report no open P1, P2, or P3 finding before completion.

## Implementation evidence

- Claude plugin setup now inspects the exact user-scoped plugin after install/reinstall. It skips
  the redundant `plugin enable` command when Claude already enabled the plugin, enables only an
  explicitly disabled plugin, and accepts a non-zero enable result only after a fresh exact
  inspection proves that enablement committed.
- Strict bridge projection separates setup from observation health with
  `enable | finish | reload | retry | repair | none`. Exact interrupted state exposes Finish;
  ambiguous ownership remains fail-closed Repair; a stopped listener exposes Retry even when the
  installation already has receipt history.
- Finish retains the owned-generation safety boundary: Main stops intake, clears the incomplete
  Bitterless outbox, rotates the installation ID, performs an exact reinstall, and starts only the
  verified new listener generation. Old setup-period events never become observation proof.
- The Claude card now renders one compact state-owned action instead of the persistent four-step
  guide. Reload offers the fixed **Open new Claude session** route and fixed
  **Copy `/reload-plugins`** action; copy success is visible and accessible, while `/hooks` remains
  collapsed read-only diagnostics.
- Listener start or replay failure closes intake, stops the listener, reports a bounded error, and
  preserves the Retry listener action. Provider pause, directory configuration, plugin removal,
  and all Codex flows remain independent.

## Verification evidence

- `yarn test:eyes-on-agents` — passed the complete non-Electron EyesOnAgents suite, including the
  Claude setup recovery aggregate and 56 UI tests.
- `yarn typecheck:eyes-on-agents:core` and `yarn typecheck:eyes-on-agents:ui` — passed.
- `yarn check:renderer-i18n` — passed with aligned English and Chinese setup/retry/copy strings.
- `yarn audit:sqlite-migrations` — passed 14 Core, 7 Maestro, 10 Todoist sync, and 8 Trench
  baselines.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` — passed
  and emitted the Claude Hook and directory watcher helpers without launching Electron.
- `git diff --check` — passed.
- Electron was not launched. Live Claude Desktop routing, copied command execution, first-event
  transition to Observing, and final visual acceptance remain with Ral.

## Review

- Independent product and functional acceptance:
  [eyes-on-agents-claude-setup-recovery-041-1](../reviews/eyes-on-agents-claude-setup-recovery-041-1.md)
  — accepted with no open P1, P2, or P3 finding after the listener-retry and copy-feedback refreeze.
- Standard code review:
  [eyes-on-agents-claude-setup-recovery-041-code-review](../reviews/eyes-on-agents-claude-setup-recovery-041-code-review.md)
  — no task-041-introduced TS-1, TS-2, FE-1, or FE-2 finding; four pre-existing oversized files
  remain recorded as structural debt outside this task.
- Implementation is complete. The only remaining boundary is Ral's live Electron/Claude Desktop
  verification described above.
