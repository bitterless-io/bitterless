---
id: onlypreview-devtools-004-1
status: pass
reviewed_task: onlypreview-devtools-004
target: 20cec72f6914a448415c9e2eb2ab1dedc4a0d119
base: 4bb3207fb9173d3a8b6d7d12232440cffafedca6
date: 2026-08-08
review_type: independent-source-node-and-electron-runtime
---

# Verdict

**PASS — no P1, P2, or P3 blocking or non-blocking finding was identified.**

Commit `20cec72f6914a448415c9e2eb2ab1dedc4a0d119` satisfies the accepted per-view
DevTools contract on its exact documentation parent
`4bb3207fb9173d3a8b6d7d12232440cffafedca6`. The required source, Node, build, and
Electron runtime gates all pass.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Contract Conformance

| Requirement | Evidence | Result |
|---|---|---|
| Shell/Preview input ownership and no new renderer boundary | `createView` installs the listener directly on every standalone child `webContents`, after the existing native-shortcut listener. The closure retains only that exact `webContents`; there is no XPC, preload, renderer state, MenuBar action, or load-time automatic-open path (`src/main/windows/onlyPreviewWindow.helper.ts:115-126,436-451`). | Pass |
| Exact standard shortcuts and auto-repeat rejection | The matcher accepts only non-repeating `keyDown`; unmodified `F12`; macOS `meta+alt+I`; or Windows `control+shift+I`. Every extra modifier, key-up, auto-repeat, unsupported platform, and other key returns before `preventDefault()` (`src/main/windows/onlyPreviewWindow.helper.ts:101-125`). | Pass |
| Independent toggle and detached target | The input owner's own `isDevToolsOpened()` state selects `closeDevTools()` or `openDevTools({ mode: 'detach' })`. The Electron test opens Shell only, then Preview independently, closes Shell while Preview stays open, and finally closes Preview. Each open target resolves to `devtools://` (`tests/onlypreview/specs/onlyPreview.spec.ts:767-867`). | Pass |
| Debug/E2E guard and release no-open/no-consume | Registration returns before adding `before-input-event` unless `VITE_MODE === 'debug'` or `BITTERLESS_E2E === '1' && !app.isPackaged` (`src/main/windows/onlyPreviewWindow.helper.ts:97-126`). Both release profiles declare `VITE_MODE: 'release'` (`env.rig.json5:8-10,20-22`), so ordinary release startup has no listener to open DevTools or consume these keys. Packaged E2E remains rejected by the existing startup guard covered at `tests/onlypreview/onlyPreviewCore.test.mjs:1082-1089`. | Pass |
| Detach preserves the native multi-view geometry | The implementation changes no bounds constant or setter. Electron snapshots both Shell and Preview bounds before the first toggle and compares both after every open/close transition (`tests/onlypreview/specs/onlyPreview.spec.ts:778-867`). All comparisons passed. | Pass |
| Security, capability, chrome, Settings, and Omni remain unchanged | The target changes only the standalone helper plus focused tests/delivery records. Existing sandbox, context isolation, disabled Node integration, web security, capability host, navigation fences, 32px/180px/5px/25px geometry, and window controls remain byte-for-byte outside the added listener. No Settings, Omni, shared contract, preload, renderer, dependency, or package file is in the commit diff. The complete Settings E2E still passes, and the Node source gate still proves OnlyPreview is absent from Omni (`tests/onlypreview/onlyPreviewCore.test.mjs:866-1054`). | Pass |
| Documentation agreement | The feature contract names the two input owners, exact shortcuts, detached/manual toggle, ignored auto-repeat, release no-registration/no-consumption, unpackaged E2E exception, unchanged bounds, and Electron verification (`docs/features/onlypreview.md:352-376,399-438`). The delivery analysis and task describe the same Main-owned boundary without a conflicting API or fallback. | Pass |

# Scope Audit

- The target is the direct child of the supplied base and changes exactly five files:
  `docs/plan/README.md`, `docs/plan/tasks/onlypreview-devtools-004.md`,
  `src/main/windows/onlyPreviewWindow.helper.ts`,
  `tests/onlypreview/onlyPreviewCore.test.mjs`, and
  `tests/onlypreview/specs/onlyPreview.spec.ts`.
- No dependency or lockfile changed. No Settings, Omni, preload, renderer, shared-contract, or
  packaging implementation changed.
- The pre-existing uncommitted `package.json` DEBUG-name change remains outside the reviewed
  commit and unchanged by verification. Its diff SHA-256 is
  `3d1803a21e22dd01c928cd459520d6c0dc0a6b8c769571b505960d0bc032b5cd`.

# Verification

- `node --test tests/onlypreview/*.test.mjs` — pass, 29/29.
- `yarn typecheck:node` — pass.
- `yarn eslint --no-cache --quiet src/main/windows/onlyPreviewWindow.helper.ts tests/onlypreview/onlyPreviewCore.test.mjs tests/onlypreview/specs/onlyPreview.spec.ts` — pass.
- `yarn build` — pass; emits Main, `out/preload/onlypreview.js`, and all three OnlyPreview renderer entries.
- `yarn test:e2e:onlypreview` — pass, 4/4. The focused DevTools test proves independent Shell/Preview open and close, `devtools://` targets, detached geometry, and unchanged bounds; the Settings test also remains green.
- `git diff --check 4bb3207fb9173d3a8b6d7d12232440cffafedca6..20cec72f6914a448415c9e2eb2ab1dedc4a0d119` — pass.
- Current `git diff --check` before this review file — pass.

The build retains its existing mixed static/dynamic-import advisory and the E2E runner retains its
existing `NO_COLOR` / `FORCE_COLOR` warning. Neither is a task regression. No signed packaged
release was launched; the release no-registration/no-consumption result is established by the
compile-time profile guard and unchanged packaged-E2E rejection, which is the verification boundary
defined by this task.

# Conclusion

**pass**
