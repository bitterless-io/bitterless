---
id: decision-maker-card-202
scope: session list — the "waiting for your confirmation" dot becomes blue text "To confirm" / 「待确认」 so it can't be mistaken for the blue unread dot (Ral 2026-09-24「1A」)
status: done
depends-on: [decision-maker-card-198]
---

Paired with `micromeet-cowork` `docs/plan/tasks/decision-maker-card-003.md`.

# Session list: "To confirm" label instead of the confirm dot

Contract: `docs/features/decision-maker-naming-and-approval-card.md` #3, 「Ral 已定(2026-09-24,审查 N1:「1A 2A」)」.
Waits for the decision-maker-card-198 review, because that task changed the same `ChatPanel.less` rule.

## Objective

In `SessionsDrawer.vue` the `chat-panel__history-item-confirm` span (`name="maestro__history-item-confirm"`) is an empty dot, blue since 198, the same as `chat-panel__history-item-unread`. Give it text.

- The label is `i18nHelper.maestroControl.chat.awaitingConfirmTag`, a new key in `en.ts` `To confirm` and `zh.ts` 「待确认」.
- Keep its place before running and unread, the `name`, the class, and the `title` (`awaitingConfirmSession`).
- `ChatPanel.less` `.chat-panel__history-item-confirm` becomes a text style:
  - It drops the dot's width, height, radius and background.
  - Font size 11px, weight 500, `color: rgb(var(--primary-6))`, `white-space: nowrap`, `flex: 0 0 auto`.
  - No background, no border. Flat BEM.
- The title keeps truncating instead of the label wrapping.
- Unchanged: the unread dot, running, the header count, `SessionSearchModal` (it never showed a confirm dot, so this is not a new place to add one), and the stalled hint (stays amber, Ral 「2A」).

## Also (card-198 review, P3)

- F5: `task/ChatConfirmSheet.less` comments still say the colour is 未定 (undecided) and overstate the folded row's risk hint, which is not bold in BL. Correct the comments.
- F6: `decisionMakerCard.test.mjs` lacks the "visible text wins over value / title" order for `readLabel`. Add the two fixture elements; the two surviving mutants must die.

## Path

- `src/renderer/maestro/control/src/SessionsDrawer.vue`
- `src/renderer/maestro/control/src/ChatPanel.less`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `tests/maestro/decisionMakerCard.test.mjs` (it pins the dot today; F6 fixtures)
- `src/renderer/maestro/control/src/task/ChatConfirmSheet.less` (F5 comments only)

## Verification

- A source test asserts:
  - The span renders the i18n text.
  - The rule has the primary-6 colour and no `background`, `border` or `border-radius`.
  - The chain order is unchanged.
  - Both locales have the key.
- `yarn typecheck` (0 new diagnostics in changed files), i18n check. No E2E.

## Close-out (2026-09-24)

- Review 1: **pass**, nothing blocking — `docs/plan/reviews/decision-maker-card-202-1.md`.
  - `decisionMakerCard.test.mjs` 31/31; typecheck 92 diagnostics before and after, same set, 0 in changed files; `check-renderer-i18n` fails identically on HEAD, pre and working tree.
  - 36 of 41 reviewer mutations fail the tests; headless-Chromium layout probe: no background / border / radius / shadow / outline on the label, no wrap, long titles truncate to make room.
  - Compiled `ChatPanel.less`: the header dot + count is unchanged; only the split selector and the label's 4 declarations differ.
- Review F2 (stale comment at `SessionsDrawer.vue:132-133`): done at close-out — the comment now lists 「待确认」 before the spinner and the unread dot. `decisionMakerCard` 31/31 and `maestroSessionsDrawerLifecycle` 8/8 after the edit.
- Review F1 (P3, Less guard blind spots: `box-shadow` / `outline`, rules in other control `.less` files, a second unnamed label): **open**, same class as Cowork `decision-maker-card-002.md` (003 review F1); do both together after Decision Helper lands.
- #5 visual check by Ral is still pending, together with the Decision Helper E2E.
