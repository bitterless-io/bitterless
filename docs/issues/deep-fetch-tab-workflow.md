# Deep fetch must load its tab and provide a browser workflow

- Date: 2026-09-15
- Status: code complete; offline verification complete; human acceptance pending
- Scope: Bitterless / CoWork browser retrieval, built-in text guidance and failure recovery.

## Evidence

Ral's Bitterless Preview screenshot shows deep_fetch failing, web_fetch then returning
text, and a later explicit open_tab + page_snapshot successfully reading search results.
The named agent-io directory contains prompts and zero-tool turn summaries, without the
actual errors, so it cannot alone establish the runtime failure cause.

Bitterless deepFetch.ts initialized win to null and used an injected tab's WebContents
when a surface existed, but doWork called win.loadURL. The tab path now loads through wc.
CoWork already used wc.loadURL. The runtime evidence below corroborates this defect.

## Contract

1. Fix the confirmed Bitterless tab-loading defect while preserving the temporary
   renderer's success/error/timeout cleanup, public URL checks and single-flight guard.
2. Add a discoverable built-in text skill, builtin:deep-fetch, to both apps' skill
   briefs, following the existing built-in drill/preview pattern. Triggers include
   deep fetch, deep_fetch, deep search and Chinese browser-search intent.
   This entry is not a recorded skill and must not load a nonexistent recipe.
3. An explicit user request such as "deep fetch Shanghai weather" uses the text
   workflow: reuse a suitable session web tab or open_tab a relevant public search/site
   entry (background by default), page_snapshot, ui_act to search/navigate, inspect
   results, read primary sources, and continue until answered or actually blocked.
   If no browser target exists, create it; do not ask the user to open the page.
4. Keep the native deep_fetch single-URL reader as an optional lower-level helper;
   distinguish it explicitly from the text workflow. It may create and dispose a
   temporary tab, so its snapshot refs are not a persistent target for ui_act.
   On non-policy failure, route to the ordinary browser workflow instead of stopping
   or repeatedly guessing URLs. Do not use alternate paths to bypass URL/access policy.
5. Keep tool descriptions, error guidance, the effective user-prefix route and the
   built-in brief consistent. get_skill_contract is for recorded skills only.
   Do not change pi's injection mechanics, browser ownership, user restrictions or
   model/runtime architecture.
6. For current/time-relative requests, use the current message date and verify source
   relevance and publication/forecast period. A page's old date is not today's date.
   A tool success or menu/app-shell output is not verified task information.
7. Correct the stale "hidden window" result wording so it accurately describes
   browser rendering without guessing which surface was used.

## Verification and human handoff

- Run offline behavior regression for the injected-tab navigation path, including
  successful reading and failure cleanup; do not launch Electron or access live sites.
- Check built-in text-skill registration/prompt assembly and related tool formatting,
  plus focused existing guards. No broad unrelated test repair or independent review.
- In a version containing the new main-process code, ask "deep fetch Shanghai weekend
  weather" with no operating tab. Expect autonomous open_tab/snapshot/action retrieval,
  correct date window, relevant sources and no request to manually open a page.
- Both apps need model-behavior acceptance; code tests do not prove model compliance.
- Existing search fallback contract remains in web-search-browser-fallback.md.

## Runtime evidence from the reported Preview session

- The exact session's main.log records web_search, deep_fetch and web_fetch in its first
  turn (3 calls), then open_tab and page_snapshot in its second turn (2 calls).
- deep_fetch failed after 7ms with a 76-character result. The logged structured reason
  is redacted. The null win.loadURL failure formatted by the current tool is exactly
  76 characters; this is source/length corroboration, not a recovered raw error message.
- web_fetch of the same Shanghai weather URL succeeded; the later normal browser
  snapshot succeeded. Do not classify this as proof that browser navigation is unavailable.
- The agent-io file's zero-tool summaries omit these actual calls. Logging repair is
  outside this change; the application log supplies the bounded diagnostic evidence.
- Both supplied session prompts were sent on September 15. The screenshot's earlier
  September 11 response / snapshot failure was not matched in this time window, so
  this task does not infer when that older response was written.

## Completed code verification

- Bitterless, from its project root:
  `node --test tests/maestro/maestroDeepFetch.test.mjs tests/maestro/maestroDeepFetchSkill.test.mjs`
  passed 8/8. The real deepFetch module runs against a fake Electron surface to cover
  navigation/extraction, success/error/timeout cleanup, single-flight and URL,
  redirect, permission and download restrictions. Other cases cover nine error
  categories, built-in registration and effective prompt assembly.
- Bitterless: `node scripts/maestro/check-natural-language-vars.mjs` passed 9 cases.
  `node scripts/maestro/check-agent-runtime.mjs` was blocked by an existing test stub
  missing `./steering/turnSteeringInbox` (`MODULE_NOT_FOUND`); not repaired here.
- CoWork, from `apps/cowork`:
  `node --test tests/unit/webFetch.test.mjs tests/unit/webFetchRecovery.test.mjs tests/unit/turnWorkspacePrompt.test.mjs tests/unit/foregroundTabSnapshot.test.mjs`
  passed 32/33, including all 27 directly related cases. The unrelated failure is an
  existing sendAgentMessage fixture without steeringTurns, failing on `.get()`.
- CoWork: `yarn check:host-tools` and `yarn check:deep-fetch` passed.
  `yarn check:preview-tool` retained two existing OnlyPreview structure failures;
  its built-in registration, catalog injection and prompt checks passed.
- Changed TypeScript source transpilation and scoped whitespace checks passed in
  both apps. Full-project type checks, live websites, model calls and Electron/E2E
  were not run. These offline checks do not establish actual model compliance.
- Deliverable: app-local `deepFetch.skill.ts`, built-in catalog registration, effective
  prompt guidance, native reader descriptions/error recovery/output formatting, and
  the Bitterless tab loader fix. No release or running-app restart was performed.
