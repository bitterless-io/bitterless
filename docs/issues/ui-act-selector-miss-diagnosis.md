# ui_act selector-miss diagnosis: paired assessment

Status: no source change needed; code verified · 2026-09-23 · owner report P3-01.

Cowork's `toolUiAct` incorrectly labels every `Selector not found` as a stale snapshot
reference. Bitterless's `src/main/maestro/drive/requestExec.service.ts:toolUiAct` has no
such diagnosis block: it returns the replay result and new-tab note. The reported
defect is absent in this implementation.

`node --test tests/maestro/uiActSelectorMiss.test.mjs` passed **3/3**. The small offline
harness extracts the actual tool method and uses the real parser and clipping helper;
ordinary selector misses, snapshot-reference misses and a mixed batch retain their
original results without asserting stale references or DOM changes. Targeted
`git diff --check` passed.

Existing runtime behavior is unchanged. No Cowork-only recovery functionality was
ported, no unrelated replay semantics were changed, and no Electron launch, E2E or
independent review was performed.
