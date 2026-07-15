# Review: renderer-arco-bem-controls (round 1)

## Findings

No P1, P2, or P3 finding was found in the round 1 scope.

## Contract review

| Contract | Result | Evidence |
|---|---|---|
| Shared renderer `IconBtn` | pass | `IconBtn.vue` wraps Arco `Button`, forwards `$attrs`, and renders the default slot through Arco's `#icon` slot. `IconBtn.less` owns the 32 px rounded-square hover, focus, active, disabled, and `no-drag` treatment without Tailwind (`src/renderer/common/components/IconBtn/IconBtn.vue:1-19`; `src/renderer/common/components/IconBtn/IconBtn.less:1-50`). |
| One native MCP modal close | pass | `McpGuideModal` supplies Arco's title slot and start alignment, contains no content-level `IconX`, and delegates cancel/Escape to the existing close emit (`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue:1-15,68-95`). Live DOM inspection found one modal header, one native Arco close, and no second Tabler X. |
| Viewport-safe MCP content | pass | The modal is capped to `100vw - 32px`, switches to `100vw - 24px` below 480 px, and constrains the body to a viewport-relative scrolling region (`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.less:1-35,156-168`). At the requested 554×608 Todo viewport it measured 526.88 px wide with 13.56 px margins on both sides; the 473 px body scrolled through all 678 px of content. |
| MCP copy actions | pass | All three actions use the shared `IconBtn` and Tabler `IconCopy`, carry titles and accessible labels, and are disabled until their corresponding integration values exist (`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue:20-65`). Live inspection confirmed native Arco only-icon buttons and both title/ARIA attributes; Escape and the native close each dismissed the modal. |
| ChatPanel Arco/BEM migration | pass | The component imports Arco `Button`, the shared `IconBtn`, and sibling Less; its template contains no raw `<button>`, Tailwind utility class, or inline style block. Text/history/workspace/stop actions use Arco Button, while icon-only actions use `IconBtn` with Tabler icons and accessible names (`src/renderer/maestro/control/src/ChatPanel.vue:1-14,397-663`). |
| Chat behavior and selectors | pass | Existing send/keyboard, paste, drag/drop, attachment, history, workspace, recording, and stop paths remain wired, including all `maestro__*` selectors. The source guard exercises these contracts and the existing workspace/media checks pass (`scripts/maestro/check-chat-composer.mjs:23-124`). |
| Narrow layout and send theme | pass | `ChatPanel.less` establishes an inline-size container, shrinks workspace controls at 520 px, wraps the footer at 480 px, and gives the send action a scoped Royal Blue rule with stronger specificity than generic Arco styles (`src/renderer/maestro/control/src/ChatPanel.less:1-12,314-342,478-525`). At a 480 px control viewport the 447.5 px panel, document, body, card, root, and footer had equal client/scroll widths, no descendant crossed the panel, the footer wrapped, and the send button's right edge matched the panel edge. An enabled-state probe computed `rgb(78, 88, 130)`. |

## Verification

| Check | Result | Evidence |
|---|---|---|
| Task source guard | pass | `node scripts/maestro/check-chat-composer.mjs` exited 0 and covered shared IconBtn structure/attrs, rounded-square shape, native MCP header/close, three copy controls, BEM-only ChatPanel classes, container queries, selectors, and Royal Blue send specificity. |
| Affected behavior checks | pass | `node scripts/maestro/check-workspace-files.mjs` and `node scripts/maestro/check-media-upload.mjs` both exited 0. |
| Full Maestro parity suite | pass | `yarn check:maestro` ran all 36 registered checks and exited 0. |
| Targeted component/style compilation | pass | `@vue/compiler-sfc` parsed and compiled `IconBtn.vue`, `McpGuideModal.vue`, and `ChatPanel.vue`; Less compiled `IconBtn.less`, `McpGuideModal.less`, and `ChatPanel.less`. All six completed without errors. |
| Electron production build | pass | `yarn build` exited 0 in 18.32 seconds. |
| Isolated Electron visual check | pass | The temporary Playwright verification ran one test in 8.0 seconds and covered constrained MCP geometry/scroll/close/copy behavior plus ChatPanel overflow/wrap/IconBtn/send-color behavior. Screenshots: `/tmp/bitterless-mcp-guide-top-554x608.png`, `/tmp/bitterless-mcp-guide-bottom-554x608.png`, and `/tmp/bitterless-chat-panel-480.png`. The temporary spec was removed after the run. |
| Web typecheck | existing baseline blocker, not a task finding | `yarn typecheck:web` exits 2 on existing connector SDK mismatches, missing test globals, old renderer aliases/Window bridge declarations, and other unrelated files. The two reported ChatPanel bridge globals (`audioBridge` and `fileBridge`) are present in the pre-task Cowork source too; no new IconBtn or MCP guide error appeared, and the targeted SFC/Less compilation plus production build pass. |
| Patch hygiene | pass | `git diff --check` exited 0 after this review file was added. |

## Conclusion

**pass** — the MCP guide now has one correctly positioned native Arco close, safe constrained-window
geometry, reachable scrolling content, and accessible shared copy controls. ChatPanel uses Arco and
the shared Tabler-based `IconBtn`, carries its revised presentation in BEM/Less without Tailwind,
preserves the guarded interaction contracts, and remains unclipped at the real 480 px control
viewport. The repository-wide web typecheck remains red only on established out-of-scope baseline
errors; task-specific compilation, build, parity, and live Electron verification all pass.
