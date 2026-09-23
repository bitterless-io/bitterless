# web_fetch JSON responses crash in HTML extraction

Status: code complete; human acceptance pending · 2026-09-23 · paired repair of owner report P1-01.

## Problem and root cause

Maestro uses the same HTTP reader and article extraction path as Cowork. JSON responses
enter the HTML extractor because only markdown/plain text bypass it. A document without
a root then raises the linkedom `firstElementChild` TypeError through `document.body`.

## Fix contract

- Return `application/json` and `application/*+json` as bounded source text, matching MIME
  types case-insensitively and ignoring MIME parameters for routing. Do not JSON
  parse/stringify returned text, so large numeric literals retain their precision.
- Preserve the existing download/output limits, source metadata and truncation notice,
  as well as markdown/plain-text and normal HTML behavior.
- Missing HTML roots yield a typed `ExtractError`; registered tools retain explicit
  failure and browser recovery guidance. A failed read supplies no verified task data.
- Recovery stays model-directed, without implicit fetch/browser retry orchestration.
- Keep this shared behavior aligned with Cowork; no unrelated audit findings are included.

## Code verification

- `node --test tests/maestro/maestroWebFetchJson.test.mjs tests/maestro/maestroDeepFetch.test.mjs tests/maestro/maestroDeepFetchSkill.test.mjs` — **14/16 passed**.
- All 8 new real-module regressions and all 6 existing deep-fetch tests passed. Coverage
  includes JSON/`+json`, case/parameters, numeric literal and whitespace preservation,
  clipping, text/markdown, HTML, typed rootless errors and registered-tool recovery.
  A `sheet+json` subtype verifies JSON routing precedes binary keyword rejection.
- The 2 failures are in the unmodified `maestroDeepFetchSkill.test.mjs`: its extracted
  `agentSkillBriefs` test harness lacks `RELOAD_SKILLS_BUILTIN_SKILL`, and the prompt test
  expects `id: builtin:deep-fetch` in the generated prompt. That suite depends on
  `deepFetch.skill.ts`, `runtime/agentPrompt.ts` and `maestroAgent.service.ts`; none is
  changed by this repair. The suite is not green, and the failures remain unresolved.
- TypeScript semantic check using `tsconfig.node.json`, with the four changed modules
  as roots, project declarations and all transitive dependencies: **0 errors**
  (1,618 source/declaration files). This is not a whole-app build or frontend check.
- Changed-module transpilation and targeted `git diff --check` passed.

## Human acceptance

Use a build with the new main-process code to read a public JSON source and report a
specific returned field, then repeat the original currency-conversion task. Confirm
the answer cites successfully retrieved data and its applicable date, or explains the
remaining blocker. Code tests do not establish model behavior; no Electron E2E, release
or application restart is included in this repair.
