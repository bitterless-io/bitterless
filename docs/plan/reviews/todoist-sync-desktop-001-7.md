# Todoist Sync Desktop Review 7

Commit reviewed: `3c25c2389557e9a616ad9185d9ac453bbeb08c82`
Prior review: `docs/plan/reviews/todoist-sync-desktop-001-6.md`

## Outcome

**Todo web gate slice: PASS. Overall task: BLOCKED.**

The Todo diagnostics introduced by the previous full-web baseline are resolved in the
focused strict project. The focused project includes the real Todo renderer, its Vue
components/stores, shared Todoist-sync and MCP contracts, preload setting types, the
Todo environment bridge, and the common files actually imported by Todo.

`strict`, `noImplicitAny`, `noImplicitReturns`, and `noCheck: false` are enabled in
`scripts/todoist-sync/tsconfig.todo-web.json`. The generated boundary check emits the
Main handler declarations from the real source classes and compares both snapshots
byte-for-byte before running `vue-tsc`. The generated preload declaration is consumed
through the focused `@preload/todo/todo.preload` path. Two consecutive generations
produced identical hashes for both Main declarations and the preload declaration.

The Todo emitter contracts preserve the real public methods of
`TodoWindowHandler` and `WindowControlHandler`, including parameter object shapes,
nullable `WindowLayout` results, and `Promise` return types. The committed contracts
are byte-identical to declarations emitted from the corresponding Main handlers;
private implementation members are not exposed as callable renderer methods.

The `es-toolkit` throttle option now uses its actual `edges: ['leading', 'trailing']`
contract. A runtime smoke produced the expected leading and trailing calls. Delayed
Todo callbacks capture stable IDs and values, while guarded synchronous handlers and
post-await store methods check `selectedTodo` before dereferencing it.

## Findings

No blocking or non-blocking finding was identified in the requested Todo gate review.

## Verification

- `yarn typecheck:todo-web` — PASS.
- `yarn typecheck:mcp` — PASS.
- `yarn test:todoist-sync` — PASS, 17/17 tests.
- `yarn build` — PASS.
- `yarn typecheck:web` — FAILS only on the unrelated baseline below; no diagnostic
  path begins with `src/renderer/todo/`.
- `git diff --check` — PASS.
- Boundary generation repeated twice with identical Main/preload declaration hashes;
  generated Main declarations matched the committed contracts exactly.

## Unrelated Full-Web Baseline

The full `yarn typecheck:web` failure is outside Todo: connector preload API/type
drift (`dingtalk`, `feishu`, `wechat`), Coin component/store typing, Poker GTO test
globals, Connector `rigchatApi`, Home emitter/module/window typings and chat/store
typing, Home menu/plugin/about/update typing, Maestro bridge typings, Omni throttle,
Omni layout typing, and shared Eyes-on-Agents/path-helper typing. No
`src/renderer/todo/` diagnostic was emitted.

## Remaining Gate

The desktop task remains blocked until `bitterless-private` tasks
`todoist-sync-backend-001` and `todoist-sync-backend-integration-002` pass and the
non-production two-client Core/PostgreSQL HTTP smoke runs against their real endpoint.
The Electron GUI/manual handoff and the separate Todo-window runtime check were not
run in this review and remain outside the automated evidence above.
