---
id: onlypreview-project-index-protocol-validation-080
scope: Repair rich-format Project index entry validation and fail current-generation search protocol violations immediately with truthful UI wording
status: implemented; owner verification pending
depends-on:
  - onlypreview-office-ooxml-renderers-077
  - onlypreview-drawio-readonly-032
verify: focused non-Electron relay, Shell/i18n, source and type checks; no Electron/Playwright/E2E
---

# Project index protocol validation and truthful failure

## Objective

Restore the documented cross-process Project index contract for Office and Draw.io files and make
an actual file-search protocol fault fail at its first active-generation event with a truthful
Project-specific message.

## Contract

- Main accepts `sheet`, `document`, `presentation`, `diagram`, and `unsupported` index entries only
  with `mediaType: 'unknown'` and `isText: false`. Existing direct media hints keep their matching
  media type; only `text` has `isText: true`.
- The file-search relay uses a dedicated Project index protocol error. It does not reuse or relabel
  the generic Preview `PROTOCOL_ERROR` shown for document/asset stream failures.
- A malformed recognized event for the active workspace/generation latches that error, rejects the
  event publication, wakes any pending runtime call, and makes later calls fail without waiting for
  timeout or a terminal response.
- A valid event belonging to another workspace/generation is stale and ignored. A late, otherwise
  valid batch whose search request is already superseded/cancelled is also ignored.
- No path, query, capability, file content, or raw protocol value is added to logs or UI errors.

## Verification

- Focused relay tests cover rich-format browse entries and snapshots, terminal initialize success,
  invalid hint/media pairs, immediate active-generation failure, future-call failure, stale-event
  tolerance, and cancelled-search late batches.
- Focused Shell/i18n tests assert Project index protocol wording while the generic Preview protocol
  wording remains unchanged.
- Run directed type/source checks, formatting, and `git diff --check` for touched paths.
- Do not run Electron, Playwright, packaged smoke, or E2E; Ral performs the live Project check.

## Delivery

- Main now accepts the complete Preview-hint/search-media matrix, including Office and Draw.io
  hints paired with `unknown`, while retaining exact-key, path, marker, memory, and nested-result
  validation.
- File-search protocol violations use the dedicated `INDEX_PROTOCOL_ERROR`; the Shell shows the
  localized Project search-index response error while the generic Preview stream message remains
  unchanged.
- A current-generation malformed event latches one failure, wakes pending calls, and rejects later
  calls immediately. A fixed 256-entry retired-request registry permits only known cancelled,
  superseded, terminal, or timed-out late batches; unknown current request IDs fail closed. Both
  workspace and generation fence late settlement after reinitialization.
- Protocol tests were split into a dedicated file, restored every prior deep-negative case, and
  added request lifecycle, memory-cap, mapping, immediate-failure, and cross-generation races.
- Focused tests passed 26/26. Node typecheck, scoped ESLint/Prettier, and `git diff --check` passed.
  [Independent review 3](../reviews/onlypreview-project-index-protocol-validation-080-3.md) passed
  with no P1/P2/P3 finding after reviews 1 and 2 were resolved.
- Electron, Playwright, packaged smoke, and E2E were not run by request. Ral performs the live
  Project initialization and error-wording check.
