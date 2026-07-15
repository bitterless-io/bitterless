---
id: renderer-arco-bem-controls
scope: Todo MCP guide and Maestro ChatPanel UI
status: done
depends-on: [maestro-source-layout-migration, todo-mcp-domain-create]
---

# Renderer Arco and BEM Controls

## Objective

Align the Todo MCP guide and Maestro ChatPanel with Bitterless's Arco/Royal Blue design system:
standard actions use Arco controls, icon-only actions use a shared `IconBtn` with Tabler icons, and
the revised components use BEM classes in sibling Less files instead of Tailwind utilities.

## Context

- `docs/design/README.md`
- `docs/design/colors.md`
- `docs/features/maestro.md`
- The user-provided MCP guide screenshot shows a duplicate/misplaced close affordance and an
  over-wide modal in the constrained standalone Todo window.

## Layout contract

```text
┌──────────── Arco modal (viewport-safe width) ─────────────┐
│ LOCAL MCP                                                ×│ native Arco close
│ Agent todo access                                        │
├───────────────────────────────────────────────────────────┤
│ Summary                                                   │
│ ┌ Helper path                                      [copy] │
│ │ monospace helper path                                  │
│ └─────────────────────────────────────────────────────────│
│ ┌ MCP config                                       [copy] │
│ │ monospace JSON                                         │
│ └─────────────────────────────────────────────────────────│
│ ┌ One sentence for agents                          [copy] │
│ │ instruction hint                                       │
│ └─────────────────────────────────────────────────────────│
└───────────────────────────────────────────────────────────┘
```

```text
┌──────────────────── Maestro ChatPanel ────────────────────┐
│ [history icon]                              [New chat]     │
├────────────────────────────────────────────────────────────┤
│ message list / history drawer                              │
├────────────────────────────────────────────────────────────┤
│ attachment chips                                          │
│ composer textarea                         recording state  │
│ [skills][attach][workspace actions]  context [voice][send] │
└────────────────────────────────────────────────────────────┘
```

## Contract

- `McpGuideModal` uses one Arco Modal header with its native close affordance. Remove the duplicate
  content-level close button, keep Escape/cancel behavior, and constrain width to the Todo viewport.
- MCP copy actions are accessible icon-only `IconBtn` controls with Tabler's copy icon. Disabled
  actions must not write empty loading values.
- Introduce one renderer-shared `IconBtn` backed by Arco Button; it uses BEM/Less rather than
  Tailwind and preserves ordinary button attributes/events.
- `ChatPanel.vue` contains no Tailwind utility classes after this task. Move its layout, state,
  hover/focus/disabled, and voice-wave styles into `ChatPanel.less` using the `chat-panel` BEM block.
- Standard text/primary/danger actions in ChatPanel use Arco Button. Secondary icon-only actions use
  `IconBtn`, with Tabler icons and explicit accessible names.
- Preserve all chat behavior, stable `name` attributes, keyboard handling, attachment/workspace
  behavior, voice states, history drawer behavior, and smoke/E2E selectors.
- Do not migrate unrelated Maestro components or remove Tailwind from the renderer entry in this
  task; this is a touched-component migration only.

## Path

- `docs/design/README.md`
- `src/renderer/common/components/IconBtn/`
- `src/renderer/todo/src/components/McpGuideModal/`
- `src/renderer/maestro/control/src/ChatPanel.vue`
- `src/renderer/maestro/control/src/ChatPanel.less`
- `src/renderer/maestro/common/components/IconBtn.vue`
- `scripts/maestro/check-chat-composer.mjs`
- `docs/plan/reviews/renderer-arco-bem-controls-1.md`

## Verification

- Run a source contract check proving the native Arco modal header, shared IconBtn usage, stable
  selectors, and absence of Tailwind utilities in `ChatPanel.vue`.
- Run the existing chat composer, workspace, media upload, and Maestro parity checks affected by the
  template refactor.
- Run targeted Vue/TypeScript checking or the renderer build, plus `git diff --check`.
- Inspect the live Todo MCP guide and Maestro ChatPanel at the constrained desktop size; verify one
  correctly positioned close button, viewport margins, copy actions, hover/focus states, and no
  clipped controls.

## Result

Completed and independently verified in
[`renderer-arco-bem-controls-1.md`](../reviews/renderer-arco-bem-controls-1.md). The production
build and isolated Electron visual check pass: the 554×608 Todo view has one native Arco close and
scroll-reachable MCP content, while the 480 px Maestro control view has no horizontal overflow and
keeps the enabled send action on Royal Blue.
