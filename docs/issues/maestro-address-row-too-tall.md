# Maestro address row is taller than its compact controls

Status: implemented; owner verification pending

## Observed behavior

The Maestro top chrome keeps a compact 36px tab strip but follows it with a 48px address row.
Inside that row, the navigation group and address input are also different heights: the navigation
group is effectively 36px (`32px` controls plus `2px` vertical padding) while the address is 32px.
The second row therefore reads heavier than the tab strip and its primary controls do not share one
baseline box.

```text
current:  36px tabs + 48px row = 84px chrome
          navigation 36px != address 32px
```

## Required behavior

```text
compact:  36px tabs + 42px row = 78px chrome
          navigation 28px == address 28px
          navigation action 24px + 2px vertical padding = 28px
```

- Reduce only the address row by 6px, from 48px to 42px; keep the reviewed 36px tab strip intact.
- Set both `.maestro-menu-bar__navigation` and `.maestro-menu-bar__address` to an exact 28px height.
  Shrink the navigation buttons to 24px so the group's existing 2px padding fits inside that height.
- Keep snapshot, action, URL, history, keyboard, focus, drag, native traffic-light, and all tab
  behavior unchanged.
- Update Main's first-frame toolbar fallback to 78px so native ContentViews do not initially mount
  6px below the renderer placeholders and then jump after DOM measurement.

## Acceptance

- The MenuBar is 78px total: 36px tab strip plus 42px address row.
- Navigation and address are both exactly 28px tall and visually share one vertical baseline.
- The Main first-frame fallback starts operation, Workbench, and Control views at `y = 78`.
- No Electron, Playwright/E2E, packaged smoke, or application launch is required; Ral performs the
  final visual check.

Implementation task:
[maestro-address-row-compact-082](../plan/tasks/maestro-address-row-compact-082.md).

[Review 1](../plan/reviews/maestro-address-row-compact-082-1.md) approved the implementation with
no remaining findings.
