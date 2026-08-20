# EyesOnAgents Connections Drawer Renders Behind the Board

Status: implemented; owner verification pending

## Symptom

Clicking the connection status opens the Agent connections drawer, but the Focus board paints over
it, so the panel is unusable.

## Root cause

Anchoring the drawer to the board region
([task 059](../plan/tasks/eyes-on-agents-connections-drawer-anchor-059.md)) silently drops Arco's
drawer z-index. Arco decides between two modes by comparing the resolved container with
`document.body` (`@arco-design/web-vue/es/drawer/drawer.js`):

```js
const isFixed = computed(() => containerRef?.value === document.body);
// …
style: isFixed ? { zIndex } : { zIndex: 'inherit', position: 'absolute' }
```

With `popup-container=".eyes-on-agents__main"` the container is not `body`, so Arco writes
`style="z-index: inherit; position: absolute"` **inline**. That inline declaration overrides the
stylesheet's `.arco-drawer-container { z-index: 1001 }`, and `inherit` resolves against
`.eyes-on-agents__main`, whose `z-index` is `auto`. The drawer therefore ends up at the same stacking
level as the board and depends on nothing but paint order against the board's positioned descendants
(`.agent-domain` and every `.thread-card` are `position: relative`).

Verified against a real Arco render in JSDOM rather than by reading CSS:

```text
container found: true
parent: eyes-on-agents__main
inline style: "z-index: inherit; position: absolute;"
classes: arco-drawer-container eyes-connection-panel
parent children order: [ 'agent-board', 'arco-drawer-container eyes-connection-panel' ]
```

The probe also confirms the useful half of task 059: the drawer really is a child of the board region
(so it cannot cover the menu bar) and our `eyes-connection-panel` class lands on the same element
that carries the inline style.

## Resolution contract

- The container-anchored drawer declares its own stacking position instead of inheriting one. Because
  Arco writes the value inline, the override needs `!important` — that is the only way to beat an
  inline declaration, and the comment in the LESS must say so.
- The z-index sits above the board's positioned descendants and stays local to the region: the drawer
  must not need a global stacking value, since it is clipped to `.eyes-on-agents__main` anyway.
- Everything task 059 delivered stays: the menu bar is never covered, the drawer is clipped to the
  board region, and `max-width: 100%` keeps it inside the region at the 480px window minimum.
- Any future move back to a body-rendered drawer must restore Arco's own `z-index` handling rather
  than keep this override.

Delivery:
[eyes-on-agents-connections-drawer-anchor-059](../plan/tasks/eyes-on-agents-connections-drawer-anchor-059.md)
