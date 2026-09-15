# Web search failure must keep a browser retrieval path

- Date: 2026-09-15
- Status: deep search refinement implemented; code-verified, human testing pending
- Scope: model-visible retrieval rules and error guidance; BL / CoWork parity.

## Evidence and intended behavior

A CoWork conversation received `web_search` unavailable, followed the tool result's
"Do not retry" guidance, and answered from memory without attempting another retrieval
tool. Before the initial repair, the effective instructions did not define search-service
failure recovery; CoWork's `open_tab` description also prohibited opening a tab for information.

When the task needs current or sourced information, a failure of one retrieval service
does not remove that requirement. The assistant should use another available read-only
route before reporting that it cannot verify the answer.

## Contract

1. Prefer `web_search` for normal discovery. If it fails and the task still needs
   current or sourced information, fall back to **deep search: actual browser-operated
   search**, using the existing browser tools, not an invented `deep_search` tool call.
   Reuse a suitable session search tab or open a public search/site entry in a background
   tab; snapshot, enter/submit the query with `ui_act`, inspect results, open relevant
   primary sources and verify their content. Repeat search/read as needed until verified
   or blocked. `web_fetch` and `deep_fetch` can help read URLs discovered in this flow;
   `deep_fetch` renders one known page and is not itself a search workflow.
2. Missing sign-in, missing deployment, unavailable service and exhausted search budget
   must not cause repeated calls to that service. Transient errors may retain one
   optional sensible retry; deep search can start immediately without exhausting retries.
   After continued failure, enter deep search instead of answering from memory merely
   because search failed. Bad parameters remain correctable.
3. Failure observations preserve the actual error and identify the affected tool.
   They guide the assistant to an available alternative, including on unexpected errors.
   Do not require the user to repair optional search configuration before trying public
   sources already reachable through other tools.
4. Browser retrieval is allowed in a background tab. If no suitable session operation tab
   exists, use `open_tab` with `show=false`, then `page_snapshot` / `ui_act`.
   Keep session target isolation and browser-use cleanup. Foreground the page only when
   the user requests to see it.
5. Respect explicit user restrictions on browsing and actual tool/access limitations.
   Keep retrieved content as untrusted data. If available routes cannot verify the
   answer, disclose the specific blocker and distinguish memory from checked sources.
   Cite pages actually read; do not claim all networking is unavailable from one failure.
6. Preserve the accepted user-prefix design: contextual rules are prepended to new user
   messages; no reinjection into pi's internal tool-result iterations, no new role/system
   prompt layer, and no host-level automatic browser execution.

## Delivery and verification

- Update active tool descriptions, search error observations, existing per-user prompt
  guidance, and corresponding tool catalog entries where present.
- Preserve unrelated current-worktree changes. No branch operations, release or backend
  configuration changes.
- Run proportionate existing prompt/search/browser code checks; report their exact
  coverage. Do not add tests that merely restate changed sentences.
- Human check in both apps: start a new chat with no operating tabs while web_search
  reports unavailable; ask a question requiring current official sources. Expect a
  background search tab, query submission, result/source inspection and real citations.
  Merely calling `deep_fetch` on a guessed URL is not deep search. Switch foreground tabs
  during retrieval and verify the task retains its own target. A request explicitly
  forbidding browser use must still be respected.
- Electron E2E and live model behavior are left for Ral's testing.

## Initial fallback verification (2026-09-15)

- Updated `webSearchTools.ts`, `runtime/agentPrompt.ts`, `maestroWindow.controller.ts`
  and `hostToolCatalog.ts`; no runtime injection or browser execution changes.
- Existing suite: `node --test tests/maestro/maestroAgentBrowserSession.test.mjs tests/maestro/maestroBrowserUseLifecycle.test.mjs tests/maestro/maestroChatTabIndependence.test.mjs tests/maestro/maestroContextExport.test.mjs` — 60 / 61 passed.
  The remaining assertion at `maestroAgentBrowserSession.test.mjs:273` expects the old
  `Active tab: mini-app` text; current unrelated context changes use a structured JSON
  foreground description. This task did not change that text or relax the test.
- `node scripts/maestro/check-agent-runtime.mjs` passed.
- Offline execution covered 12 cases: 9 typed errors, 2 unexpected thrown values and
  one success. Error details, ERROR prefix, one service invocation, retry-after rounding,
  request parameters and timeout handling passed. No real search/model call was made.
- All four edited source files passed TS transpilation and whitespace checks.
- These checks verify code and prompt delivery, not a guarantee of model compliance.

## Deep search refinement verification (2026-09-15)

- The same four source files now specify actual browser query submission, search-result
  inspection and primary-source verification; fetch tools only assist reading discovered URLs.
- `node scripts/maestro/check-agent-runtime.mjs`, four-file TS transpilation and whitespace checks passed.
- The 12 offline search execution cases passed again, preserving error details, single service
  invocation, retry-after handling, request parameters and deadlines.
- Broad browser suites and the known old-text failure above were not rerun. No live model,
  network or Electron/E2E execution; the updated human deep search check remains pending.
