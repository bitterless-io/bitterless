# The Maestro chat list can scroll sideways as a whole

Status: Implemented; source verification complete; owner visual testing pending — 2026-09-18.

Ral 2026-09-18:「聊天页不应该出现整体横向滚动的滚动条!」— raised against COWORK's Control chat,
paired here because chat is common functionality and Maestro's message list has the same structure.

## Defect and contract

Contract: the chat page never scrolls sideways. Wide content — a code block, a table, the attachment
strip — scrolls inside its own container. Dragging the whole conversation sideways is a layout
defect, never a feature.

`MessageList.less`'s scroller declares `overflow: auto` — **both** axes — and
`MessageItem.less`'s `.message-item__content` is a flex item with the default `min-width: auto`, so
its content-based minimum size, not the row width, decides how wide the row becomes. Anything inside
a bubble whose min-content width exceeds the column's `max-width: 88%` pushes that row past the list
and turns on the list's own horizontal scrollbar — and because the scrollbar belongs to the list,
every other message slides with it.

## Scope and evidence

One concrete 800px source is present. `markstream-vue`'s renderer root carries
`content-visibility: auto; contain-intrinsic-size: 800px 600px`
(`.markdown-renderer[data-v-d64c1cf5]` in `markstream-vue/dist/index.css` — the only 800px in that
stylesheet). `MessageItem.less` tries to neutralize it:

```less
.message-item__markdown .markdown-renderer { contain: content; content-visibility: visible; contain-intrinsic-size: 0 0; }
```

but `MarkdownRender`'s root element *is* the renderer root, and the class passed at the call site
lands on that same element — so it ends up as
`class="message-item__markdown markstream-vue markdown-renderer"` and a **descendant** combinator
cannot match it. Measured in Chromium against the real `markstream-vue` declarations, the renderer
root computes `contain: layout`, `content-visibility: auto`,
`contain-intrinsic-size: auto 800px auto 600px` — the override never applies. While a message has a
last-remembered size it stays harmless; a message skipped before it has ever been laid out
contributes 800px of min-content width, which is more than the Control panel is wide.

The repair deliberately does not touch that override: re-enabling full rendering for every off-screen
message is a containment/performance change nobody asked for. It removes the *leak* instead — with
`min-width: 0` a row can no longer be sized by a descendant's min-content, and `overflow: hidden auto`
makes the invariant hold for any future content.

BL's scrollbar appearance needed no change: `src/renderer/common/assets/style/theme.less` already
styles it globally (8px, transparent track, `oklch(0.7 0 0 / 0.3)` thumb) and Maestro Control loads
that file through `src/renderer/maestro/common/style.css`. COWORK had none and now mirrors it —
see `micromeet-cowork docs/issues/chat-scrollbars-unstyled-and-list-scrolls-sideways.md`.

## Change

- `src/renderer/maestro/control/src/MessageList.less` — `.message-list__scroll` becomes
  `overflow: hidden auto`.
- `src/renderer/maestro/control/src/MessageItem.less` — `.message-item__content` gets
  `min-width: 0`.

## Verification and human acceptance

`node --test tests/maestro/maestroChatListScroll.test.mjs` — compiles both stylesheets with `less`
and asserts the scroller is vertical-only, the message column declares `min-width: 0`, and Maestro
Control still reaches the global scrollbar theme through `common/style.css`.

`yarn typecheck` passes with 0 errors. Not run (Ral 2026-09-18:「UI 调整而已别跑单位测试了」):
`yarn lint` and `yarn build`. Per `CLAUDE.md` no Electron E2E was run.

Human acceptance, in the rebuilt app: open Maestro chat, send enough messages to scroll, and confirm
no horizontal scrollbar appears under the conversation — including with a reply containing a wide
code block or table, which must scroll inside its own box.
