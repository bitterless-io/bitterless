---
id: browseruse-lifecycle-002
scope: browseruse lifecycle and favicon activity
status: done
depends-on: [browseruse-isolation-001]
---

# Explicit browser-use lifecycle and existing favicon animation

## Objective and authority

Ral requested `start_browser_use` / `end_browser_use` with a tab ID for both ordinary chat browser work and drilling, reusing the previously designed favicon animation and completing lifecycle cleanup. These are agent-callable built-in host tools, available across runtime adapters. Implementation is authorized on the existing branch. Preserve the isolation contract in [browseruse-isolation-001](browseruse-isolation-001.md).

Ral subsequently requested a targeted review of the previous nine fixes and synchronized BL/CoWork optimization. Recheck initial context, LRU retention, popup attribution, post-tool retry, initial popup ownership, interception scope, narrow popover, historical count and drill membership/capture. Repair only demonstrated remaining defects; preserve already-correct behavior.

## Contract

- `start_browser_use({ tab_id: string })`: require an existing available browser tab and begin this task's active-use marker for the exact ID. It is a status switch only: it does not select the operation target, activate the foreground, navigate, enroll a drill member or alter recording. This follows Ral's latest clarification that start/end simply switch the agent-use indicator. Never infer identity from URL or foreground.
- `end_browser_use({ tab_id: string })`: release only this task's active-use marker for that ID. It does not close the tab, move human foreground, erase session history, stop the whole drill, or change the recording whitelist. Drill membership and recording remain governed by the existing drill tools. A later actual browser operation can begin use again.
- Missing/empty IDs and unknown starts fail explicitly. Repeating a start for the same task/ID is idempotent; repeating an end, including cleanup after tab closure, succeeds without underflow. Other tasks' active use and independent in-flight work keep their own markers.
- Distinguish active use, short-lived in-flight use, LRU retention, historical session targets, and drill recording membership. The renderer's existing `controlled` output is true only while an active-use owner or actual in-flight owner exists. Retaining an old page or merely starting a text-only chat must not light the icon.
- Actual directed page work automatically begins use, including selected/opened tabs and popup branches from a controlled source. Mere global tab listing and human foreground/new unrelated tabs do not. Ordinary use persists across model-thinking gaps and ends explicitly or in turn completion/error/abort cleanup; do not rely on the model remembering the end tool.
- Drill member acquisition begins use. This persists across automatic continuation turns until explicit end or drill pause/end/abort/main loss; membership updates must not accidentally re-light explicitly ended unchanged members. A subsequent explicit selection or actual operation may re-start use. Removing/closing/crashing/replacing a member releases its marker; all run markers release on terminal cleanup.
- The two tools share the same current-task active-use owner as automatic use; do not create a second drill marker which makes the end tool ineffective. Independent temporary work such as deep_fetch keeps its own reference. Ending one task cannot extinguish another task's work.
- A use marker alone does not establish popup attribution. Ordinary popups retain the existing in-flight source-owner rule; drill popups retain active-member/run attribution. Do not infer an ordinary popup owner from historical targets or the marker set. Clear unconsumed ordinary-turn popup notices at completion so they cannot become the next turn's action results.
- Keep the fixed 16px core-and-orbit favicon indicator and add the expanding/contracting halo requested on 2026-09-15 below; controlled precedes loading, favicon returns afterwards, reduced-motion retains a static indicator. No foreground switching.
- Preserve background A/B/D operation while human C stays visible; dynamic takeover, same-URL distinct identity, member-source popup inclusion, unrelated recording exclusion and prior cleanup/retry/interception fixes remain intact.
- A drill run's mutable state belongs to its initiating task. Other tasks must not implicitly mutate that run through explore_session/visit/record; return an explicit ownership error. This protects run state only: ordinary browser tools and start/end remain free to use the same tab in another task. Keep the existing singleton/busy behavior rather than adding an ownership-transfer workflow.

## Implementation path

### Halo addition — 2026-09-15

Ral requested a soft circular halo whose radius repeatedly expands and contracts while
the agent operates a tab, synchronized between Bitterless and CoWork.

```text
tab: [ (core + orbit + breathing halo)  page title                  × ]
       <------ fixed 16px slot ------>
halo: small radius → large radius → small radius (2.4s, ease-in-out)
```

- Preserve the current blue palette, core, satellite and all controlled-state logic.
- Add one decorative radial-gradient halo on the controlled wrapper; use opacity and
  transform only for motion. At full expansion its 20px paint area extends 2px beyond
  the slot without reflow, hit-target changes or covering the title/close control.
- Animate scale from 0.6 to 1 and back over 2.4 seconds; keep it visible throughout
  the cycle, with softer opacity at the widest radius. Do not reset via a one-way ripple.
- Respect prefers-reduced-motion with a static visible halo. Do not add JS timers,
  configuration, dependencies or changes to loading/favicon restoration.
- Verify both actual Vue/CSS styles compile and the scoped diff is clean. This is a
  reversible visual change: no new test suite or Electron launch. Ral checks the live
  animation in both applications during browser work, and its disappearance on completion.

Implemented in the controlled wrapper's ::before pseudo-element. Both products use
the same gradient, scale, opacity and timing; no template/state changes were needed.
Actual Vue template and scoped style compilation passed in both products; Bitterless's
imported Less also passed less.render. Scoped git diff --check passed. No new test suite,
Electron/E2E or live UI run; human visual acceptance remains pending.

### Lifecycle implementation

Session active-use state and host tool registration/catalog/prompt; browser controlled output separated from retention; ordinary and drill lifecycle hooks; close/crash/view replacement cleanup; existing renderer channel and favicon animation; focused behavioral tests. No exclusive chat/tab locking.

## Verification

1. Both built-in tools are exposed with required tab_id and documented usage.
2. Start/end are idempotent, target exact IDs, do not alter foreground, preserve independent owners and temporary work, and report invalid starts.
3. Actual work starts automatically, persists between calls, and cleans on success/error/abort; pure text/list/history retention stays unmarked.
4. Multiple drill members retain markers across continuation; end is effective for this task; unchanged membership does not undo end; actual reuse restarts; terminal/member-loss cleanup cannot leak.
5. Existing renderer mapping and animation compile; previous isolation tests and relevant guards pass. Compare type diagnostics with the existing checkout baseline.
6. No Electron E2E or installed-app smoke run; finish code verification and hand off exact real-app checks to Ral.

## Delivery

Implemented and code-verified in the existing checkout; human testing pending.

- Registered both built-in tools with required tab_id and prompt/catalog guidance. Status switches validate and mark only; they do not prepare/navigate/select/activate a tab or change recording membership.
- Actual page work starts use automatically; explicit end is effective, and later work restarts it. Task/tab markers are idempotent and coexist with other tasks and temporary work. Existing controlled broadcasts drive the unchanged favicon core-and-orbit animation.
- Drill scope updates act only on added/removed members, preserving explicit end across unchanged scope notifications. Continuation retains use; terminal/member-loss cleanup releases it. Turn validity checks prevent late async preparation/popups from reviving ended use and old cleanup from extinguishing a new turn.
- Separated persistent task use from short-lived controlDepth; added activeUseTabIds to session state without changing the historical tab count. Corrected snapshot/inject/default-target and explore_visit background wording. Ordinary turn cleanup now discards only its own undelivered popup notes. Existing cross-task drill ownership checks remain, with a new regression case.

Verification:

- 94/94 focused Node tests passed (76 prior regressions + 18 new lifecycle tests). Six guards passed: agent-runtime, drill-continuation, renderer-i18n, capture-gating, capture-provenance and capture-persistence. Main TypeScript diagnostics remain 64 and Maestro Vue diagnostics remain 49; normalized additions/removals are both zero.
- Shared UI fixture: 64/64 layout scenarios across both products (32 each) and 10/10 favicon state checks (5 each). These use actual Vue template branches and Less in isolated headless Chromium, not Electron. Controlled precedes loading, end restores loader/favicon, dimensions stay 16px, and reduced motion retains a static indicator.
- Evidence under overmind tmp/browseruse-review: bl-lifecycle-combined.txt, bl-lifecycle-typecheck-comparison.json, bl-lifecycle-{main,renderer}-{before,after}.txt and bl-lifecycle-*-guard.txt; UI results are ui/both-popup-layout-review-nine.json and ui/favicon-state-review-nine.json.
- The prior nine repair areas were rechecked; only demonstrated code or description/translation leftovers were repaired. Detailed conclusions are recorded in overmind areas/agent-runtime/browser/browseruse-lifecycle-2026-09-14.md.

No Electron/E2E, installed-app/live-model execution, build/release, branch switch or sync. Existing unrelated edits are preserved. Human test both apps: start/end an exact A while C remains visible and target/recording remain unchanged; ordinary work retains animation between actions but releases it on completion/stop; two tasks on A remain independent; drill continuation, explicit end/reuse, branch closure and main loss leave truthful indicators and the prior recording scope intact.
