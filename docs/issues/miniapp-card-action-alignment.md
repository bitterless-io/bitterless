# Mini Apps card actions shift with description length

Status: implemented; owner verification pending

## Observed behavior

The fixed Home Mini Apps grid uses Arco Cards whose height follows their description content. The
Open action is rendered after that content, so cards with one, two, or more description lines place
their Open buttons at different vertical positions.

```text
current
┌──────────────────┐  ┌──────────────────┐
│ icon  App A      │  │ icon  App B      │
├──────────────────┤  ├──────────────────┤
│ one-line copy    │  │ longer copy      │
│                  │  │ wraps to line 2  │
│           [Open] │  │                  │
└──────────────────┘  │           [Open] │
                      └──────────────────┘
```

The shared page is mounted by Maestro's fixed local Home. Workbench Apps is a separate compact
horizontal list and does not use this card DOM or stylesheet.

## Required behavior

```text
fixed 320 × 184px card
┌────────────────────────────────┐
│ icon  App title                │  fixed header
├────────────────────────────────┤
│ description line 1             │
│ description line 2             │  maximum three lines
│ description line 3             │
│                                │  flexible remainder
│                         [Open] │  bottom-pinned action
└────────────────────────────────┘
```

- Every `.mini-app-page__card` is exactly `320px` wide and `184px` high.
- The Arco Card body is a vertical flex container. Its actions stay at the bottom, so every Open
  button shares one baseline regardless of locale or description length.
- Descriptions show at most three lines. Overflow is clipped with Chromium's multiline clamp, and
  unbroken content may wrap instead of widening the card.
- Preserve the current grid gap, icon/title treatment, card border/background, Royal Blue Open
  button, per-card loading/disabled state, duplicate-open guard, failure message, and launch action.
- The shared stylesheet is the only implementation point. Maestro fixed Home inherits the change;
  do not copy styles into `localHome`.
- Workbench Apps keeps its existing compact single-line list layout.

## Acceptance

- One-, two-, three-, and longer-line descriptions all render cards with the same outer height and
  Open-button vertical position.
- A fourth description line is not visible.
- Loading an Open action does not move the action region or resize the card.
- Ral verifies Chinese and English copy in the real Electron window.

Implementation task:
[miniapp-card-layout-003](../plan/tasks/miniapp-card-layout-003.md).

Independent review:
[miniapp-card-layout-003 review 1](../plan/reviews/miniapp-card-layout-003-1.md) — approved with no
P0-P2 findings.
