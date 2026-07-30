---
id: eyes-on-agents-token-title-search-032
scope: separator-insensitive token matching and query-gated results in global task search
status: implemented; owner verification pending
depends-on: [eyes-on-agents-global-title-search-031]
---

# EyesOnAgents Token Title Search

## Objective

Make global task lookup feel semantic enough for title conventions such as `ops-git` without using
an LLM or vector index, and keep every thread hidden until the user enters a meaningful query.

## Context

- [EyesOnAgents global title search issue](../../issues/eyes-on-agents-global-title-search.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [Original global title search](eyes-on-agents-global-title-search-031.md)

## Required behavior

```text
open / clear
┌ Search tasks ────────────────────────────────────────────┐
│ [ Search thread titles_______________________________ ] │
├─────────────────────────────────────────────────────────┤
│              Type a title to search tasks               │
└─────────────────────────────────────────────────────────┘

query: "ops git"
┌ Search tasks ────────────────────────────────────────────┐
│ [ ops git____________________________________________ ] │
├─────────────────────────────────────────────────────────┤
│ > ops-git                                               │
│   git_ops release                                       │
└─────────────────────────────────────────────────────────┘
```

- Opening the modal with an empty query returns no rows and leaves selection `null`. Clearing the
  input returns immediately to that state. A query containing only supported separators is also
  empty.
- Normalize query and title with `String.prototype.normalize('NFKC')` plus locale-aware lowercase.
- Split normalized text on whitespace and common title separators: hyphen, underscore, period,
  forward slash, backslash, colon, and vertical bar.
- A title matches when every non-empty query token occurs as a substring of at least one title
  token. Query-token order does not matter. Preserve partial-token convenience while ensuring an
  unmatched token rejects the title.
- `ops git` and `git ops` both match `ops-git`; `ops missing` does not. Repeated whitespace and
  mixed supported separators normalize identically.
- Search only `thread.title`. Do not match ID, cwd, Project, Domain, latest question, response,
  source payload, or All-column filters.
- When meaningful input first produces matches, select the first result. Query changes continue
  selecting the first match. Clearing selects nothing. Enter with no selection remains a no-op.
- Distinguish the empty-input guidance from the non-empty no-match message. Neither state renders a
  thread result.
- Keep the existing modal lifecycle, shortcut, height, scroll, Open persistence, accessible
  combobox/listbox relationship, and thread-ID selection stability unchanged.

## Interaction contract

| input/state | behavior |
|---|---|
| open with empty input | zero results, null selection, focused input, start-typing guidance |
| type meaningful query | token-match titles and select the first match |
| clear input | zero results, null selection, keep modal/input active |
| separator-only query | same as empty input |
| `ops git` / `git ops` | both match title `ops-git` |
| non-empty no match | zero results and localized no-match message |
| Enter without selection | no-op |

## Expected paths

- `docs/issues/eyes-on-agents-global-title-search.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/INDEX.md`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/global-title-search.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- The real store harness covers empty/open/clear/separator-only queries, NFKC and case
  normalization, separator-insensitive and order-insensitive token matching, partial tokens,
  unmatched-token rejection, title-only scope, first/null selection, and Enter no-op.
- Source guards protect the tokenizer contract, separate empty guidance, and independence from the
  All-column search.
- Run the normal EyesOnAgents UI suite, renderer i18n check, focused renderer typecheck, and
  `git diff --check`. Do not launch Electron; Ral owns runtime UI verification.

## Review

- [eyes-on-agents-token-title-search-032-1](../reviews/eyes-on-agents-token-title-search-032-1.md)
  accepted the implementation with no P1, P2, or P3 finding.

## Delivery evidence

- Completed on 2026-07-30 with one module-local tokenizer and no new dependency, XPC, persistence,
  App Server request, or polling path.
- Empty, cleared, and separator-only queries produce zero rows and null selection. Meaningful
  queries use NFKC, locale-aware lowercase, supported-separator tokenization, and unordered
  all-token title matching.
- The normal EyesOnAgents UI suite passes 46/46, including 8/8 real-store search contract cases;
  renderer i18n and diff checks pass.
- Focused renderer typecheck remains blocked only by the pre-existing unresolved `@preload/*`
  alias in `eyesOnAgentsEnv.bridge.ts`; no changed file produces a diagnostic.
- No Electron process was launched. Ral owns the final visual and keyboard runtime check.
