---
id: todo-context-copy-markdown
scope: todo
status: done
depends-on: [todo-source-ai-tag]
---

# Todo Context Copy Markdown

## Objective

Add copy actions to the todo row context menu so a human can copy a todo title, title with steps, or title with steps and note as readable Markdown.

## Context

- `src/renderer/todo/src/components/TodoRow/` owns the todo row context menu.
- `src/renderer/todo/src/store/todo.store.ts` owns todo/subtodo state and renderer-side actions.
- `src/preload/sqlite/dao/subTodo.dao.ts` exposes step reads through `subTodoEmitter`.
- `src/renderer/common/i18n/` owns visible menu labels and copied status labels.

## Path

- Add three context menu actions: copy title, copy with all steps, and copy all.
- Copy title writes only the todo title.
- Copy with all steps writes Markdown with the todo title and all steps.
- Copy all writes Markdown with title, steps, and note.
- Mark each step with natural completed/incomplete text instead of JSON-style fields.
- Keep copy formatting in the store so the component stays thin.

## Verification

- `yarn build`
- `yarn typecheck:web --pretty false` filtered for touched todo/subtodo files
- `git diff --check`

## Result

- Added three todo row context menu actions: copy title, copy with all steps, and copy all.
- Generated Markdown from todo title, sorted steps, and note.
- Step lines include explicit completed/incomplete labels.
- Kept menu labels and copied Markdown section/status labels in i18n.
