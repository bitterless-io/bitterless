---
id: onlypreview-project-index-protocol-validation-080
scope: Repair rich-format Project index entry validation and fail current-generation search protocol violations immediately with truthful UI wording
status: in-progress
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

Pending implementation and independent review.
