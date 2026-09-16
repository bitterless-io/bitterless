# Copy Path shortcut ignores the Project multi-selection

Shift+Cmd+C used to copy only the original preview/tree anchor after selecting several rows.
The native shortcut reached the renderer correctly, but the authoring controller read only
`treeSelectedRelativePath`. Cmd/Shift selection gestures intentionally keep that preview anchor
unchanged, while the selected rows live in `onlyPreviewTreeSelection`.

The shortcut now reads the current selected entries and sends one copy request carrying the full
selection. Main validates every entry and authorizes all paths before the existing clipboard
service writes one string, with one absolute path per line (`\n`). A final authority check rejects
a batch whose workspace changed while authorization was pending. Single-item and project-root
copy retain their existing paths. Copy Name uses the same native intent route and selection.

Both Bitterless and Cowork receive the same change. No file content or filesystem copy behavior
changes; this task addresses the native Copy Path / Copy Name shortcut route.

Human check in a build containing this change: select three files with Cmd-click and Shift range,
including names with spaces or Chinese characters, press Shift+Cmd+C, and paste into a text editor.
Every selected path should appear once on its own line. Deselect the original preview anchor and
repeat: it must not be included. Finally verify single-file and project-root Copy Path.

No Electron/E2E, application launch, packaging, or release is performed for this fix.

## Code verification

The new end-to-end code-level copy-chain fixture passes 9/9 in each product, using the actual
native intent handler, selection controller, request parser, Main handler/service, registry, and
clipboard class with OS boundaries stubbed. The old event handler reproduces first-path-only
output in both products. The fix covers complete newline output, deselected anchors, single/root
compatibility, malformed requests, denied paths, and workspace/host invalidation before writing.

Existing BL clipboard/shortcut/selection checks pass 47 tests with one unchanged Shell store
800-line-budget failure; CW shortcut checks pass 17/17. Shared copy types/parser pass strict
TypeScript, focused ESLint passes, and shared implementation files match between products.
