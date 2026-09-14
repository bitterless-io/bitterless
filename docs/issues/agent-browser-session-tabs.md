# Browser tools must keep each chat's operating tabs

Status: Implemented; code-verified; human testing pending (2026-09-14). Applies to Bitterless and CoWork.

## Report and root cause

Ral reports that browser tools move onto a newly foregrounded tab while the same chat is working.
A second tab can also be associated with that chat without authorizing a change of operation target.
The chat needs a structured set of operating tab IDs in prompt Table 3 and a clickable tab count.

The tool factories already receive a session key but browser tool implementations fall back to
mutable foreground capture/replay state. Activating another tab changes that state. A turn's
operationTabId is recorded but does not govern browser execution. CoWork's browser lock serializes
operations but does not fix the target identity.

## Contract

- Maintain a session-owned ordered set of operating browser tabs and one selected operation tab.
  Resolve the initial target from the initiating tab captured for that chat's turn. Freeze this
  identity before asynchronous work. Preserve it across subsequent turns in the same app lifetime.
  A chat with no browser target may establish one when browser work starts; do not enroll tabs for
  chat-only turns just because they are visible.
- Human foreground changes, chat selection, and tab-to-chat association do not select, add, remove,
  or replace operating targets. Tab-to-chat association and the operation set serve different purposes.
- A browser tool with an explicit tab ID, an agent tab switch/open, or a popup attributed to an
  agent-owned source tab can add a tab. Explicit switch selects the default operation target.
  An explicit observation/action on a secondary tab must preserve the default unless the tool says
  it switches. Multiple tabs can be used together. Unrelated user-opened tabs must not be enrolled.
- Route browser observation, actions, scripts, navigation, and relevant replay/API paths through
  the selected exact target; do not redirect by activating a tab and reading mutable global state
  after an await. Preserve existing drill anchors and product-specific browser locking.
- Table 3 retains foreground Active tab as user context and adds structured session browser state:
  selected tab ID and tabs containing ID, title, URL, health, and an error when present.
  The model must be told foreground context is not authority to change the operating target.
  Real sends, steering, and context export/graph pending prompts use the same session state.
- Validate tab existence, browser type, WebContents destruction, renderer crash, and known load
  failure before switching/acting. Never fall back to another healthy foreground tab. Return
  an explicit tool failure including target ID and recoverable details. Keep unavailable target
  metadata in session state so it can be inspected. Recovery is explicit: the AI can reload/reopen
  the intended URL through browser tools, inspect the new target, and continue; do not blindly
  replay the failed action or silently create a replacement tab.
- Temporary pages used by `deep_fetch` belong to the session while the fetch is running, without
  changing its selected target. Intentional transient-page cleanup releases that page from the
  operation set/count; unrelated completed fetches must not accumulate as operating tabs. Unexpected
  loss of a normal operation target still retains its diagnostic metadata.
- Operation state is live main-process session state. Across app restart old runtime IDs are not
  restored as live targets; a fresh turn establishes targets again. No SQLite schema migration
  or tab-to-chat persistence implementation is needed for this repair.
- UI uses the selected chat's state and does not change its chat or operation target when a user
  clicks a row to view a tab. Unavailable targets display their status/error. Failed activation
  must be visible. Busy wording applies only while that chat is running; idle wording is factual.

## Built-in navigation recovery (2026-09-14 additional request)

Ral supplied a screenshot where the AI navigated to the wrong WeChat section and asked the user
to return manually. Add discoverable one-page-back capability to both apps through the built-in
`web_nav` tool (`action: "back"`), using the session's selected operation tab, or an explicit
`tab_id`. CoWork already has `web_nav`; retain that name and its existing other actions instead
of inventing another overlapping tool. Bitterless currently exposes only human back navigation.

- The tool must be available for ordinary browser-agent work, documented in the built-in tool
  catalog, and described as the first recovery step after unintended navigation. A separate
  recorded website skill is not required.
- One call goes back exactly one native browser history entry, retaining the same session/tab.
  Human foreground changes while navigation settles must not affect the target.
- Return the exact target ID, resulting URL/title, and history availability. The AI should then
  call `page_snapshot` on that same target, confirm where it landed, and continue the original task.
  Simple wrong-page navigation is not, on its own, a reason to request manual navigation.
- No back entry, non-web/closed/crashed/destroyed target, navigation failure, or timeout must be
  explicit; never report that it went back when navigation failed. Do not silently navigate home,
  choose another tab, or run multiple back steps in a single call.
- Navigation completion listeners must be in place before the history action starts and cleaned
  up afterwards. Cover normal navigation, same-document history, failure and unavailable history
  with Node-only behavior tests; no live Electron/E2E is requested.

## UI

The Table 3 payload uses `operation_tab_id` for the selected tool target,
`operation_tab_ids` for the ordered ID list, and `tabs` for their details. For example:

```json
{
  "operation_tab_id": "tab-a",
  "operation_tab_ids": ["tab-a", "tab-b"],
  "tabs": [
    { "id": "tab-a", "title": "Website A", "url": "https://example.com/a", "status": "ready" },
    { "id": "tab-b", "title": "Website B", "url": "https://example.com/b", "status": "crashed", "error": "Renderer process exited" }
  ]
}
```

Use the existing chat header/status area, typography and theme. A compact borderless trigger and
an in-panel popover/list retain the current layout. Titles and URLs truncate; lists scroll.

```
Chat header                         [Agent operating 2 tabs]
                                     Website A    Current target
                                     https://...  tab-id-a
                                     Website B    Crashed
                                     https://...  tab-id-b
                                     error detail
```

Use normal localized labels, keyboard-operable buttons, and explicit empty/loading/error states.
Do not add borders/dividers or unrelated controls.

## Verification and human handoff

Code-level regression tests must exercise foreground A → B without operation drift, selecting
chat A from tab B without target replacement, explicit multi-tab use, per-session isolation,
popup attribution, and destroyed/crashed/closed targets without fallback. Cover structured prompt
state and selected-chat UI data. Run relevant typechecks and targeted guards; record pre-existing
failures separately. No independent review, Electron E2E, live app launch or release is requested.

Ral's human test in both updated apps: start work in chat A/tab A, foreground tab B and select
chat A from B while work continues; operations must still affect A. Ask the agent to coordinate
A and B; check the count/list and Table 3 IDs. Close or crash an owned tab; verify a clear failure
and explicit AI recovery without acting on another tab.

## Bitterless delivery and verification

- Main owns session targets in `src/main/maestro/drive/agentBrowserSession.ts`; tool execution
  captures the exact capture/replay/URL across confirmation awaits, batches and recorded replay.
  Explicit secondary tools retain selection; agent activation/open changes it. Popup ownership
  comes from the actual in-flight source. Unexpected loss retains diagnostic metadata.
- `agentPrompt.ts`, actual sends/steering and pending context export/graph share the session
  projection. Foreground D3 remains user context; selected target determines execution/site skills.
- `AgentBrowserTabs.vue` and its store show localized count/status/error for the selected chat;
  viewing a row leaves the operation selection unchanged. Healthy deep-fetch cleanup releases
  its temporary target. `open_tab` provides explicit reopening.
- `browserNavigation.ts` implements `web_nav` back/forward/reload/where with precise target identity,
  pre-registered completion/error listeners, same-document history, timeout and cleanup.

Code verification:

- 46/46 combined tests passed:
  `node --test tests/maestro/maestroBrowserNavigation.test.mjs tests/maestro/maestroAgentBrowserSession.test.mjs tests/maestro/maestroContextExport.test.mjs tests/maestro/maestroChatTabIndependence.test.mjs`.
  Includes real request-execution paths, session isolation, awaited approval, popup ownership,
  drill anchors, UI-store races, Vue script/template and Less compilation, and navigation failures.
- Browser-exec workflow/auth, agent-runtime, context-graph and renderer i18n guards passed.
- Main typecheck remains 64 baseline diagnostics; Maestro renderer remains 4 baseline diagnostics.
  No new diagnostics in the changed implementation. The existing agent-activity guard still fails
  its pre-existing BaseAgent raw-tool-name assertion; neither source nor assertion was changed here.
- Scoped whitespace checks passed. No Electron/E2E, live model call, app launch, package build,
  installation, release, branch operation, Git sync or independent review was performed.

Human acceptance is recorded in Bitterless Todo and delivered to BotAndI in Chinese.

## Follow-up repair contract (2026-09-14)

Ral expanded the review into one optimization/fix pass. The chat may explicitly move from A to B
or coordinate both while the user views C. Human foreground changes must not alter the agent's
initial context, chosen browser target, page instance, popup evidence, or recording scope.

- Initial prompt/site-skill lookup uses the turn's frozen initiating tab until the session has an
  explicit selected target. Keep this separate from the foreground tab and do not enroll chat-only turns.
- Protect all browser targets of a running chat across tool/model-thinking gaps. Release this runtime
  protection on completion/abort. No implicit page-instance loss from LRU while the task is active.
- Attribute new-tab notices by source session; user-opened tabs never become tool-result popups.
  Register popup ownership before agent open_tab begins navigation.
- After any tool ran, a transient model error must not resubmit the whole user task automatically.
  Preserve completed results and report explicit recovery; pre-tool transient retries remain available.
- Network interception defaults to the resolved target tab; applying/clearing rules must not affect
  unrelated tabs. The confirmation identifies the target.
- The browser-tabs popover stays within the chat panel at 380/480px in Chinese/English. Keep existing
  borderless theme and keyboard behavior. Count wording distinguishes total associated records from
  live operating tabs; preserve unavailable target diagnostics.

### Drill tab membership and capture

- Each live drill run owns an explicit main tab ID and structured member states keyed by tab ID.
  Record role (main/branch), source/parent ID where relevant, and lifecycle (active/closed/unavailable).
  Reuse existing drill state/branch stack where possible rather than invent a second parallel controller.
- Final clarification: agent takeover means operation ownership, not permanent chat-tab exclusivity
  and not mandatory foreground takeover. Keep the human foreground independent: the user may continue
  viewing C while AI works on A/B/D in the background. Agent target selection and human view activation
  are separate operations; drill should not activate its tab before every action. Ral permits takeover
  when needed but prefers the human to keep seeing their own page.
- The agent may select another relevant tab at any time, including D showing the same URL as A.
  These remain distinct tab IDs/page instances; freeze the exact ID for each in-flight action and never
  share snapshot refs by URL. The session target is a mutable default, not an exclusive permanent lock.
  Agent open/target selection is background by default; deliberate human Show/preview remains explicit.
  Existing open_tab/activate_tab may accept show=true when the user explicitly asks to see that page;
  default false. Human row-click/show APIs continue to activate the visible tab. No new UI switch.
- Treat active drill-member pages as an agent-controlled area. Any popup from an active member joins
  that run as a branch, including a human click within that controlled page; no attempt is made to
  distinguish physical and CDP clicks there. Electron popup details do not reliably expose that actor.
  A separate user-created C and popups from C remain excluded unless explicitly chosen as a target.
  Global isDrillExploring alone never admits an unrelated source. No action-token/adopt workflow needed.
- The agent may decide a user-opened C belongs in the drill and explicitly take it over using the
  existing activate_tab/open_tab or explicit drill navigation selection. That action admits C as a
  member/branch, preserving the original main tab, and permits recording it. Merely listing, opening
  from the human UI, or foregrounding C is not admission. Do not add a separate approval/adopt step.
  Ral accepts avoiding manual interaction with pages that the drill has taken over.
- Recording/capture for drilling is allowed only for active members. Human foreground switching or
  opening another page cannot enroll or start recording it. Preserve ordinary manual recording behavior.
- Closing a branch stops/detaches its recording and removes it from active IDs, retaining a closed
  diagnostic. Closing/crashing/replacing the main tab pauses/fails the drill explicitly; never hand
  capture to an arbitrary surviving foreground tab. Abort/end clears active capture/protection.
- Present the drill main/member/active IDs and lifecycle in the existing drill status/tool state so
  the agent can inspect scope. Existing chat target UI remains session-scoped; no separate dashboard.

### UI layout

```text
Chat header       [Browser tabs: total] [New chat]
+ (existing panel background; no border added)
  List aligned inside panel bounds
  Page title                 Ready / Closed
  URL                        Current target
```

### Verification scope

Use focused Node behavior tests with real registry/controller/recording paths, Vue/Less compilation,
relevant source guards and typechecks. Capture existing diagnostics before edits and report only new
ones as regressions. No Electron E2E/live model/app launch/release/branch change. After code-level
verification, hand exact acceptance steps to Ral without starting another independent review cycle.

## Follow-up repair delivery

The expanded review repair is complete at code level. Final behavior and verification are in
[Browseruse and drill isolation repair](../plan/tasks/browseruse-isolation-001.md).

76/76 Node tests; 6 relevant guards; 32/32 layout cases; main 64 and Vue 49 existing type diagnostics, no additions.

The final contract separates human foreground from dynamic agent operation targets, permits explicit
takeover of relevant tabs, and restricts drilling capture to managed members. No Electron/E2E, live
model, packaging or release was run. Human acceptance is tracked in the existing shared Todo.
