# EyesOnAgents Claude Setup Recovery — Final Product Acceptance

Status: accepted

Date: 2026-08-18

## Verdict

**Implementation: Closed for the frozen non-Electron acceptance scope. PASS — no open P1, P2, or
P3 finding.** The failed state shown by Ral now has a direct **Finish setup** recovery action;
normal Enable owns install plus enablement; a paused listener has its own retry action; and the only
remaining Claude-session step is presented as an executable Desktop/open-or-copy choice with
visible feedback.

This verdict includes the follow-up refreeze that added the explicit `retry` projection, bounded
listener restart failures, and accessible copy-success feedback. The updated tree was re-reviewed
and re-run independently; no earlier acceptance claim is being carried forward without recheck.

The acceptance object is one Bitterless-owned Claude observation plugin and listener generation,
managed by Ral from the EyesOnAgents Connections drawer. Success means the exact plugin is enabled,
the Bitterless listener is active, the current Claude session has loaded the plugin, and a
current-generation event changes the card to **Observing** automatically.

## Product closure

| Operation | User path | System behavior | Evidence | Status |
|---|---|---|---|---|
| Create / Enable | Claude support on → **Enable Claude observation** | Adds or updates the exact local marketplace, installs the user plugin, inspects enablement, enables only when explicitly disabled, starts the listener | `claudePluginBridge.service.ts`; setup recovery fixture | Complete |
| Read / status | Open Connections → Claude observation | Separates provider, plugin, listener, receipt, and directory state; projects `enable \| finish \| reload \| retry \| repair \| none` | rendered-DOM fixture; English/Chinese copy | Complete |
| Update / recover | **Finish setup**, **Retry listener**, **Open new Claude session**, **Copy /reload-plugins**, or **Repair** according to state | Exact interrupted setup rotates to a verified generation; paused listener retries start plus replay; reload opens only the fixed Desktop route or copies only the fixed command | service and rendered-DOM fixtures | Complete |
| Delete / remove | **Remove plugin** | Removes only the Bitterless-owned user plugin, marketplace, artifacts, and outbox; unrelated Claude and all Codex state remain untouched | existing removal contract and regression suite | Complete |

## Acceptance evidence

1. **The screenshot failure is recoverable without a manual plugin-enable step.** An install that
   already enabled the exact user plugin skips the redundant `plugin enable`; an explicitly disabled
   plugin receives one enable command; unknown enablement fails closed. The strict interrupted
   checkpoint exposes **Finish setup** instead of the former dead-end review instructions
   (`src/main/eyesOnAgents/claudePluginBridge.service.ts:377-519`).

2. **Every active setup state has the correct primary action.** Enable, Finish, Reload, Retry, and
   Repair each render one compact state-driven surface. Observing removes the setup surface. When an
   exact installation is healthy but its listener is stopped, `setupAction = retry` takes precedence
   and the card says **Listener paused / 监听已暂停** with one **Retry listener / 重试监听** primary
   action; the duplicate Check status action is hidden
   (`src/main/eyesOnAgents/claudePluginBridge.service.ts:297-310`;
   `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue:132-230`).

3. **Listener retry has truthful failure feedback.** Retry stops the old intake, re-inspects the
   plugin, starts the listener, and replays the outbox. A start or replay failure stops intake again
   and returns the fixed bounded error `Claude listener retry failed`; the renderer keeps Retry
   available and shows the existing action-error banner rather than silently returning to an
   apparently healthy state (`src/main/eyesOnAgents/eyesOnAgents.service.ts:2734-2766`).

4. **The remaining Claude-session action is direct and bounded.** The primary action opens only
   `claude://code/new`, Anthropic's documented Claude Desktop Code route. The secondary action copies
   only `/reload-plugins`. Both APIs are parameterless and reject while Claude support is off. The
   Desktop route is documented by Anthropic in
   [Open Claude Desktop with a link](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link).

5. **Copy success and failure both close visibly.** A successful copy changes the button label to
   **Copied / 已复制** inside a polite live region. Leaving Reload resets the acknowledgement. A copy
   failure restores the actionable label and flows through the existing action-error banner
   (`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue:151-158,312-321,412-419`).

6. **Observation completes automatically.** A committed live event records current-generation
   receipt proof, broadcasts the change, and the subscribed renderer reloads the snapshot. The card
   then changes to Observing and removes Reload without requiring Check status. **Still not working?**
   remains collapsed by default, so `/hooks` is genuinely secondary diagnostics rather than a normal
   setup step.

7. **Codex and Claude remain unambiguous and isolated.** The Claude card is labelled **Local Claude
   observation** with a separate **Claude support** switch and Claude-only actions. The existing
   Codex observation card, guide, provider behavior, and monitoring paths are unchanged by the
   Claude setup projection.

## Blocking gaps

None.

## Minimum closure proposal

No further product or implementation change is required for task 041. Ral retains only the live
owner check because this independent pass intentionally did not launch Electron: verify that Open
new session reaches Claude Desktop, copied `/reload-plugins` works in an existing session, and the
first real lifecycle event changes Reload to Observing.

## Acceptance checklist

- [x] Failed partial install projects **Finish setup**, not an instruction-only dead end.
- [x] Enable includes exact install and conditional enablement.
- [x] Enable, Finish, Reload, Retry, and Repair each expose the correct primary action.
- [x] Paused listener retry succeeds through start plus replay and reports bounded failures.
- [x] Copy reports **Copied**, announces it accessibly, resets on state exit, and restores on failure.
- [x] `/hooks` stays collapsed under **Still not working?**.
- [x] First current-generation receipt updates the card automatically.
- [x] Claude support and plugin lifecycle controls remain distinct from Codex.

## Independent verification

| Check | Result |
|---|---|
| `node scripts/eyes-on-agents/claude-setup-recovery.test.mjs` | PASS — conditional enable, strict Finish, fixed Desktop/copy actions, listener start/replay failures |
| `node --test scripts/eyes-on-agents/claude-setup-render.test.mjs` | PASS — all setup states, retry primary action, copied live feedback, reset, and failure restoration |
| `yarn test:eyes-on-agents` | PASS — full Core, resolver, repository, App Server, Codex bridge, project-filter, Claude, and 56-test UI aggregate |
| `yarn typecheck:eyes-on-agents:core` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn check:renderer-i18n` | PASS — English/Chinese renderer keys remain aligned |
| `yarn audit:sqlite-migrations` | PASS — all current and historical upgrade baselines |
| `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` | PASS — production build completed |
| `git diff --check` | PASS |

No Electron process was launched during this independent acceptance pass.
