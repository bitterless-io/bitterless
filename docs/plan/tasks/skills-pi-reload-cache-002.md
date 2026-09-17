---
id: skills-pi-reload-cache-002
scope: Pi-native skill cache/reload lifecycle and paired CJS startup repair
status: done
depends-on: [skills-pi-native-loading-001]
verify: passed
---

# Align skill refresh with Pi's cached resource lifecycle

Ral, 2026-09-17: 「尽量贴合 pi 的机制，继续优化」. The previous integration used native discovery APIs but still rescanned on catalog/getSkills reads and rebuilt the system prompt every turn. This task supersedes that refresh policy in task 001 and the three-source feature.

## Contract

- Load the configured sources when initializing each new Chat runtime, then serve cached catalog/Pi skill snapshots. Ordinary unchanged chat turns, model requests, /view_context and list reads must not walk/hash skill directories. No directory watcher or local polling.
- Use explicit native resource reload for user refresh and real resource changes: workspace or authorized account/institution context changes, successful cloud install/update, and host-owned create/import/delete/assignment. Keep invalidation small and scoped; no custom scheduler or new management framework.
- Remove the unconditional prompt-time setActiveToolsByName trick. Integrate Pi's public session.reload/resourceLoader.reload lifecycle for actual resource changes while preserving tools and conversation history; cheap revision/context checks are allowed but must not scan.
- The existing Skills refresh control must be available on Global and Workspace as well as Institution, reusing its current handler; a local refresh without a valid institution must not call institution APIs.
- External edits via an editor or native file tools follow Pi semantics: invoke the existing Skills refresh action or initialize a new Chat to reload the catalog. A regular next turn is not an implicit filesystem refresh. Keep /view_context consistent with the loaded catalog.
- No valid institution: immediately exclude that source and its references, preserve Global/Workspace and normal chat, and do not wait on institution authorization merely to load local skills. Old scope snapshots cannot revive after logout or a context switch.
- Preserve source roots, stable qualified references, same-name skills, complete catalogs, native authoring/file/process tools and bundled Bun guidance.

## Paired startup defect

Ral reports BL yarn dev:prod fails with ERR_PACKAGE_PATH_NOT_EXPORTED for pi-coding-agent. The failing pre-fix BL out/main/app.main.js and a shared chunk contained a bare require of that import-only package. The previous isolated Vite bridge test omitted electron-vite's real dependency externalization. Track diagnosis/fix in [Pi skill CJS startup](../../issues/pi-skill-cjs-startup.md), and verify both apps' actual dev/build main configurations without launching Electron.

## Verification

Count native scans: repeated unchanged reads/turns perform none after initial load; explicit refresh observes edits/additions/deletions; context changes and host mutations refresh the affected snapshot. Test no-institution and stale-scope exclusion, real native reload preserving tools/history, 251-skill completeness and /view_context/request parity. Run focused types and build checks. Do not run Electron E2E or launch the app; hand live yarn dev:prod acceptance to Ral.

## Delivery and verification — 2026-09-17

- Catalog/list/Pi skill reads now reuse a cached snapshot. Cheap source/context revision checks invalidate it; ordinary unchanged turns do not scan or hash directories.
- Actual resource changes use public Pi session reload; active tool selection and conversation history survive. Shared-resource consumed revisions and per-session applied revisions avoid redundant reloads without skipping another session's prompt update.
- The existing Refresh action is available on all three tabs. No institution means local-only refresh and normal chat. External/native-file-tool edits need explicit refresh or a new Chat runtime to enter the discovery catalog; a known SKILL.md can still be read directly.
- Bitterless skill facade uses the virtual module bridge described in the linked startup issue. Cowork's existing bridge passes the paired checks.

Code verification:

- `node --test tests/skillScopes/*.test.mjs tests/skillsThreeSources/catalog.test.mjs tests/skillsThreeSources/cloud.test.mjs tests/skillsThreeSources/requestParity.test.mjs` — 62/62 passed.
- Final `node --test tests/skillsThreeSources/nativeReload.test.mjs tests/skillsThreeSources/requestParity.test.mjs` — 3/3 passed, including real SDK reload, no redundant scans, tools/history preservation.
- `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false` — passed after the final revision bookkeeping adjustment.
- `yarn build` — passed (47.05s); output marker is debug_dev/dev/dev/debug and main output contains no bare CommonJS require of the Pi SDK. The subsequent small revision bookkeeping adjustment was verified by the final targeted tests and typecheck; the full build was not repeated.
- `node scripts/environment/runWithRuntimeProfile.cjs debug_prod -- node --test tests/skillsThreeSources/sdkBundle.test.mjs` — 2/2 passed using actual electron-vite serve/build presets with dependency externalization enabled, executing native skill APIs in the resulting focused CJS artifact. This profile check leaves the runtime profile selection at debug_prod.

Final UI wording: skillCatalog.messages.ts now says Refresh in English/Chinese and requires refresh after external edits or package repair. Its standalone TypeScript check and diff whitespace check passed. The broader `yarn check:renderer-i18n` did not pass: the existing script `scripts/renderer-i18n/check-renderer-i18n.mjs` fails its initialization-order assertion for the unmodified `maestroTabAlias` entry. This unrelated check was not repaired or presented as passing. No full rebuild was repeated for the final wording change.

No Electron app, E2E, packaged-app smoke, installation or release was run. No commit or branch change was made. Unrelated workspace edits were preserved.

## Human acceptance

1. In Bitterless, rerun `yarn dev:prod`; in Cowork's `apps/cowork`, run `yarn dev:prod`. Confirm application load no longer throws the Pi package-exports error.
2. With no valid institution, confirm ordinary chat and Global/Workspace skills work; Institution may remain empty and stale institution skills must be absent from /view_context.
3. Add/edit/remove a workspace SKILL.md externally. Ordinary sends in the existing Chat reuse the loaded catalog; click Skills Refresh (available on all tabs), then confirm the catalog and next model context reflect the change without restarting or losing chat history/tools. Separately add a skill and start a new Chat: its first request must load the new skill without an explicit Refresh. Switching back to an already running Chat alone must not rescan.
4. Switch workspace/account/institution context; confirm the previous scope's skills disappear. No institution login is required for acceptance.
5. Preserve authoring acceptance: selected workspace writes to .agents/skills; no selected workspace writes to profile skill-library/shared. JS/TS scripts prefer bundled Bun. After creating via native file tools, refresh or start a new Chat to register the new skill for future automatic matching.

## New Chat alignment — 2026-09-17 follow-up

Ral clarified that New Chat must follow Pi, with only the skill source directories expanded. The installed Pi runtime handles /new through AgentSessionRuntime.newSession → createRuntime → createAgentSessionServices → a new DefaultResourceLoader and await reload. Bare SDK createAgentSession does not reload a supplied host resource loader. The host adapters currently reuse registry snapshots on initialization, which misses this native lifecycle boundary.

Required change: initialize each newly created Chat runtime's skill resources through reload before Pi constructs its system skill prompt; load Global, selected Workspace and only a valid Institution. Existing lazy runtime initialization may remain, but the first request in the new Chat must discover skills added since the previous Chat. Subsequent unchanged turns stay cached. Keep the current explicit Refresh path for an existing Chat. Verify with a disk-added skill between two session initializations and scan counters showing one refresh per new runtime, zero per unchanged turn. No watchers, polling or broader framework changes.

New Chat delivery: piRuntimeAdapter.ts now awaits the host resource loader's reload before creating a new native Pi session. The existing lazy initialization remains. Real SDK/registry/adapter regression verifies external additions and edits appear in the new Chat's first native prompt/request catalog, with zero scan increments on later turns or return to a running old Chat. English/Chinese UI and authoring guidance allow Refresh or New Chat.

Final follow-up verification: `node --test tests/skillsThreeSources/requestParity.test.mjs tests/skillsThreeSources/nativeReload.test.mjs tests/skillsThreeSources/catalog.test.mjs` — 17/17 passed; scoped strict tsc and the standalone skillCatalog.messages.ts typecheck passed; relevant diff whitespace check passed. This follow-up did not repeat the prior full build or launch Electron.
