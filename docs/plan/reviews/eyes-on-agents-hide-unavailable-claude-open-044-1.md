# EyesOnAgents Hide Unavailable Claude Open — Independent Acceptance

Status: accepted

Date: 2026-08-18

## Verdict

**Implementation: Closed for the frozen non-Electron scope — PASS, with no open P1, P2, or P3
finding.** CLI/Hook-only Claude cards no longer advertise a Desktop Open action that cannot be
resolved. Codex and Desktop-mapped Claude cards retain Open, while unread, More, Preview, Domain,
keyboard, layout, and Main/store safety contracts remain intact.

This verdict follows a refreeze. The first candidate wrapped More in a new `span` while its button
still stopped click propagation, which prevented Arco Dropdown from receiving its trigger and made
Preview/Domain unavailable. That P1 was reported before acceptance. The final candidate restores
the button as Dropdown's direct child, moves the visual unread dot to a non-layout CSS pseudo-element,
and adds a mounted real-Arco regression test. The repaired tree was reviewed and executed again from
scratch; the earlier failure is not waived.

## Findings

- **P1 · blocking:** None open. The broken More trigger found in the first candidate is resolved and
  covered by an interaction test.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Acceptance object and product closure

- Entity: the task-card Open capability shown to Ral while supervising Codex and Claude sessions.
- Entry point: an EyesOnAgents task card and its More menu.
- Successful terminal state: Desktop-openable tasks expose Open; CLI-only Claude tasks omit it but
  retain every truthful action and state signal.
- Product/design owner: Ral. Implementation owner: task-044 Develop agent. Independent acceptance:
  this review.

| Operation | User path | System behavior | Evidence | Status |
|---|---|---|---|---|
| Create | N/A | Open capability is derived from provider identity and verified Desktop metadata, not created in this UI. | `canOpenThread` projection | N/A — justified |
| Read | View a task card | Codex and mapped Claude show Open; CLI-only Claude shows no button, tooltip, disabled box, or reserved gap. | SSR DOM matrix and source inspection | Complete |
| Update | Desktop mapping, runtime, or unread state changes | Rendering and accessible text follow the current capability/runtime without guessing a deep link. | mounted provider/gesture/unread matrix | Complete |
| Delete | N/A | Removing a mapping makes Open disappear; there is no user-owned Open record to delete. | conditional rendering contract | N/A — justified |

## Interaction and DOM evidence

1. `ThreadCard.vue:8-11,176-177,213-225` keeps card-level focus and gestures only for a real Open
   capability. Mounted Enter and double-click events each called Open for Codex and Desktop-mapped
   Claude, and called it zero times for CLI-only Claude. The latter card had no `tabindex`.

2. `ThreadCard.vue:51-70` conditionally removes the complete tooltip/control subtree, so CLI-only
   Claude has neither a misleading disabled action nor an empty 20px control box. Codex remains
   openable without a Desktop ID; mapped Claude remains openable with one.

3. `ThreadCard.vue:72-107` keeps More as Arco Dropdown's direct button trigger. The mounted test
   clicked that real trigger, observed the teleported menu, invoked CLI **Preview transcript**, and
   invoked a normal Codex Domain move. Neither path bubbled into card Open.

4. `ThreadCard.vue:178-195` exposes unread only for `isUnread && runtimeState === "idle"`. Openable
   tasks retain the existing dot and localized Open label; CLI-only tasks put localized unread text
   on both card and More. A mounted working/unread row exposed no dot class and no unread ARIA text.

5. Preview remains explicit and capability-gated. `ThreadCard.vue:84-91,218-220` calls the existing
   preview path only after selecting the menu option. `eyesOnAgents.store.ts:428-447` and
   `eyesOnAgents.service.ts:2241-2257` preview a validated Claude transcript without calling
   `markOpened`, applying a read snapshot, or changing unread state.

6. The renderer and Main defenses were not weakened. `eyesOnAgents.store.ts:409-425` still rejects
   Claude without `desktopSessionId`, and `eyesOnAgents.service.ts:2205-2238` re-resolves the stored
   target and throws before constructing/opening a deep link when no verified Desktop ID exists.

## Visual, layout, and accessibility evidence

- The final CSS adds only a positioned class on the existing 20×20 More button and an absolute 6px
  pseudo-dot. Card padding, title geometry, action-row gap, 20px control sizing, and the 3px control
  gap are unchanged, so hiding Open contracts the action group without changing card height.
- The direct-button repair avoids an extra wrapper and therefore preserves the established action
  baseline and hit target.
- The decorative pseudo-dot contributes no duplicate accessibility node. Localized English and
  Chinese card/control labels carry the unread meaning in text, so status does not depend on color.
- Folder, provider mark, More, Domain movement, and explicit Preview remain independently available;
  no new badge, card row, tooltip, or alternate Open affordance was introduced.

## Independent verification

| Check | Result |
|---|---|
| `node --test scripts/eyes-on-agents/thread-card-open-capability.test.mjs` | PASS — 5/5; SSR provider matrix plus mounted real-Arco More, Preview, Domain, Enter, double-click, and non-idle unread cases |
| `yarn test:eyes-on-agents:ui` | PASS — 63/63 |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn check:renderer-i18n` | PASS |
| `git diff --check` | PASS |
| Frozen source/diff inspection of renderer, store, Main, locales, and layout rules | PASS |

No Electron process, provider connection, task database, user profile, credential store, or
secret-bearing file was opened or mutated. This Verify delivery changes only this review file and
preserves the unrelated existing `package.json` change and concurrent task work.

## Acceptance checklist

- [x] Codex and Desktop-mapped Claude retain Open and card Enter/double-click behavior.
- [x] CLI-only Claude has no Open subtree, reserved action gap, or card-level tab stop.
- [x] CLI-only Enter/double-click remain safe no-ops at renderer, store, and Main layers.
- [x] Idle unread moves to More with localized card/control text; non-idle unread stays hidden.
- [x] More opens after the refreeze; Preview and Domain actions execute without triggering Open.
- [x] Preview remains explicit, capability-gated, and does not acknowledge unread.
- [x] Card height, action-row rhythm, provider mark, and folder behavior are unchanged.

## Conclusion

**accepted** — task 044 meets its truthful capability-disclosure, interaction, accessibility,
layout, Preview, Domain, and defense-in-depth contracts with zero open finding.
