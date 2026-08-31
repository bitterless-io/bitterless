---
id: eyes-on-agents-search-receiver-safety-069
scope: restore receiver-safe Vue event bindings for the EyesOnAgents search input and Search button
status: implemented; owner verification pending
depends-on: [eyes-on-agents-search-modal-067]
---

# EyesOnAgents Search Receiver Safety

## Objective

Repair the production search crash caused by passing class-store methods as bare Vue event
callbacks, and prevent the same failure from returning.

## Required behavior

- `ThreadSearch` binds `update:model-value` to a local arrow handler that calls
  `eyesOnAgentsStore.setTitleDraft(value)` through the owning store object.
- `DomainColumn` binds the Search button to a local arrow handler that calls
  `eyesOnAgentsStore.openThreadSearch()` through the owning store object.
- No direct `@update:model-value="eyesOnAgentsStore.*"` or receiver-losing Search-button binding
  remains.
- A mounted component interaction test exercises the real Arco input event boundary and proves a
  typed value reaches the store without an uncaught exception.
- The mounted Search-button boundary is covered as well, or an equivalent compiled-handler proof
  demonstrates that it calls through the local wrapper.
- Existing token matching, throttling, query/selection reconciliation, keyboard navigation,
  modal lifecycle, and Open behavior do not change.

## Expected paths

- `docs/INDEX.md`
- `docs/issues/eyes-on-agents-global-title-search.md`
- `docs/issues/eyes-on-agents-search-input-unbound-store-method.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- mounted EyesOnAgents search interaction coverage and its normal UI test wiring

## Verification

- Mounted input update changes `titleDraft` / search results without throwing.
- Mounted Search-button click opens the modal without throwing.
- Source guards reject direct store-method event callbacks at both repaired boundaries.
- `yarn test:eyes-on-agents:ui`
- `yarn typecheck:eyes-on-agents:ui`
- `git diff --check`
- Electron E2E is not run; Ral performs the real-app check.

## Result

Implemented. Both affected Vue event boundaries now use local arrow wrappers that call the
class-based store through its owning object. The UI source guard rejects direct store-method
bindings, and a new mounted JSDOM suite drives the real Arco Input and Button components.

[Independent review 1](../reviews/eyes-on-agents-search-receiver-safety-069-1.md) passed with no
finding. The reviewer also restored the unsafe bindings in an isolated counterfactual run and
confirmed that both mounted cases fail with an undefined receiver, proving the regression test
detects the production fault. The EyesOnAgents UI suite passed 73/73, UI typecheck passed, and
whitespace validation passed. Electron E2E was not run; Ral owns the real-app verification.
