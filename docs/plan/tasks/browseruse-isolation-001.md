---
id: browseruse-isolation-001
scope: bitterless browseruse and drill tab isolation
status: done
depends-on: []
---

# Browseruse and drill isolation repair

## Objective

Implement the follow-up repair contract in [agent-browser-session-tabs](../../issues/agent-browser-session-tabs.md#follow-up-repair-contract-2026-09-14), including initial target context, active-turn tab retention, popup source attribution, safe retry, target-scoped interception where available, drill membership/capture lifecycle, and browser tab list UI.

## Context

- [Issue and contract](../../issues/agent-browser-session-tabs.md).
- Review baseline: overmind areas/agent-runtime/browser/browseruse-review-2026-09-14.md (#1–#8; fix only entries applying to this product).
- User explicitly authorized implementation after review; the current dev/next branch and unrelated changes are preserved.

## Path

Browser session state, agent turn/prompt, browser/controller/view LRU, drill/capture services, target-scoped request execution, browser-tabs renderer + i18n, focused Node tests and existing guards.

## Verification

1. First send in A then foreground C: prompt site and default tool still agree on A; explicit switch to B survives user C.
2. Across model-thinking gaps and >4 warm tabs, chat-owned A/B page instances survive; completion/abort releases protection.
3. Popup ownership and notices stay in the source session, including agent open_tab initial navigation.
4. After a completed tool, a 503 does not re-submit the whole task; interception does not alter unrelated pages.
5. Drill selects main A/current branch B independently of foreground C; agent can also explicitly choose same-URL D while keeping human C visible. Popups from controlled drill members join the run regardless of who clicks inside that controlled page; separate human C and its popups remain excluded until the agent explicitly takes C over via an existing target-selection tool; then C becomes a recorded drill member while main A remains unchanged. Closing branch updates active IDs; loss of main explicitly pauses/fails without takeover.
6. Browser tab list fits 380/480px; totals do not claim closed targets are operating.
7. Proportionate Node tests, Vue/Less and relevant typecheck/guards. No Electron E2E or release.

## Delivery evidence

Implemented and code-verified in the current checkout; human acceptance pending.

- Frozen initiating-tab metadata now reaches the prompt and site-skill selection before the first browser call. Running turns protect their initiating and enrolled page instances from LRU eviction; completion/abort releases that protection.
- Browser tools retain exact tab targets independently of human foreground. Agent open_tab and activate_tab default to background operation, with optional show=true for an explicit request to display the page. Human list-row display remains a separate action.
- Popup owners are registered before initial navigation, and new-tab notes drain only into their owning chat. Interception rules and approval context are scoped to the resolved tab.
- Drill state exposes main/current/active tab IDs plus branch parent, availability, and closed diagnostics through the existing explore tools. Explicit selection takes over another tab, including a second instance of the same URL. Popups from a controlled drill member become branches; unrelated human tabs and their popups remain outside recording. This is controlled-page attribution, not input-actor detection.
- Capture accepts only drill members, preserves exact snapshot identity, and keeps main recording alive after branch closure. Main closure/crash/WebContents replacement pauses the run without adopting the foreground. Stop/end releases drill scope and agent-started recording. Existing operator-capture provenance remains conservative.
- The browser-tab popup is positioned under the whole toolbar and fits the narrow pane. Its Chinese/English count says session tabs, so retained unavailable entries are not described as currently operating.

Code verification:

- 76/76 tests passed across maestroAgentBrowserSession, maestroBrowserNavigation, maestroContextExport, maestroChatTabIndependence, maestroBrowserIsolation, and drillRunInvariants (Node test runner). The new isolation suite contributes 16 cases, including duplicate-URL refs, explicit takeover, popup attribution, LRU, branch/main loss, interception, recording, and show=true.
- Six guards passed: check-drill-continuation, check-agent-runtime, check-renderer-i18n, check-capture-gating, check-capture-provenance, and check-capture-persistence. Capture guards were updated to assert the member-set contract and changed facade parameters.
- Scoped main TypeScript diagnostics: 64 before / 64 after. Scoped Maestro Vue diagnostics: 49 before / 49 after (45 existing GTO test-global errors and 4 other existing diagnostics). Comparing diagnostic path/code/message with line numbers normalized finds zero additions or removals. The checkout is not typecheck-clean; this change adds no diagnostic relative to the captured baseline.
- UI geometry fixture: 32/32 passed at 380/480 px across Chinese/English, idle/running, empty/normal/unavailable/long-label scenarios. This uses real Less in an isolated layout fixture, not the desktop application.
- Local evidence is under overmind tmp/browseruse-review: bl-targeted-tests.txt, bl-typecheck-comparison.json, bl-main-{baseline,current}.txt, bl-renderer-{baseline,current}.txt, the six guard logs, and ui/bitterless-popup-layout-after-fix.json.

No Electron launch, E2E, build/release, branch switch, sync, or independent follow-up review was performed. Human testing should exercise background A/B/D operations while viewing C, explicit show=true, member-source popup branches, unrelated C recording exclusion, and branch/main closure in the running app.
