# EyesOnAgents Search Input Loses Its Store Receiver

Status: fixed; owner verification pending

## Symptom

The search modal opens, but the first typed character throws:

```text
TypeError: Cannot read properties of undefined (reading 'titleDraft')
```

Search results therefore cannot be entered through the real Arco input.

## Root cause

`ThreadSearch` passes the class-store method `eyesOnAgentsStore.setTitleDraft` directly as the
`update:model-value` callback. Vue forwards that bare function to Arco Input, so the call no longer
has the store as its receiver and `this` is `undefined` inside `setTitleDraft()`.

The same receiver hazard exists on the Focus Search button, which passes
`eyesOnAgentsStore.openThreadSearch` directly as its click callback. Task 031 previously fixed and
guarded this exact failure mode with a local arrow wrapper; task 067 restored the modal but dropped
that guard and reintroduced the unsafe binding.

## Repair contract

- Component events call class-store methods only through local receiver-safe wrappers.
- Typing through the mounted Arco Input updates `titleDraft` and committed search results without
  throwing.
- Clicking the mounted Focus Search button opens the modal without losing the store receiver.
- Source coverage rejects any direct EOA store-method binding at these two event boundaries.
- Matching, throttling, selection, modal lifecycle, Open behavior, persistence, and provider
  behavior remain unchanged.

Delivery: [eyes-on-agents-search-receiver-safety-069](../plan/tasks/eyes-on-agents-search-receiver-safety-069.md).
