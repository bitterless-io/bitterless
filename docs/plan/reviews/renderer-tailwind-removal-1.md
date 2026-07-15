# Review: renderer-tailwind-removal (round 1)

## Findings

No open P1, P2, or P3 finding remains in the round 1 scope.

During review, the first version of the source guard was found to inspect dynamic class producers
from only two explicitly named Vue files. That would have allowed a future Tailwind return value in
helpers such as `WorkbenchToolsView.riskClass()` to escape detection. The implementation was revised
before this verdict: it now parses every actual `:class` expression, follows referenced local
functions/variables/maps with the TypeScript AST, and inspects only their class-producing strings
without a file whitelist (`scripts/maestro/check-no-tailwind.mjs:95-197`). A mutation of
`riskClass()` to return `bg-red-500` was rejected at the exact source line; the mutation was restored,
and the guard and full suite passed again.

## Contract review

| Contract | Result | Evidence |
|---|---|---|
| Renderer Tailwind removal | pass | Independent searches found no Tailwind import/reference/directive in renderer-owned source and no Tailwind plugin/package in `electron.vite.config.ts`, `package.json`, or `yarn.lock`. The renderer plugin list now contains Vue, the Maestro CSP plugin, and Monaco only (`electron.vite.config.ts:157-160`). Production output likewise contains no `tailwindcss`, `@tailwind`, or emitted utility selector in the three Maestro CSS bundles. |
| Component Less ownership | pass | All 23 Vue components in the task inventory import a same-directory sibling Less file. The already-migrated `ChatPanel` and shared `IconBtn` also satisfy the same rule, giving 25/25 historical Tailwind Vue surfaces with explicit sibling Less ownership. Host Home's two former `@apply` files are ordinary CSS declarations. |
| Business BEM and state classes | pass | Templates and Less use role-rooted blocks such as `control-app`, `message-item`, `maestro-menu-bar`, `workbench-recording`, and `capture-filter`. The guard rejects selectors/classes with more than two `__` separators and static Maestro style attributes (`scripts/maestro/check-no-tailwind.mjs:85-93,176-216`). Dynamic producers use semantic modifiers; shared record helpers return a semantic base plus range/type modifier. Stable `name` attributes remain independent and may retain their deeper automation vocabulary. |
| Deterministic regression guard | pass | The guard scans all renderer Vue/TS/CSS/Less plus Vite/package/lock inputs, rejects imports/directives/packages, static and dynamic utility values, utility selectors, and excess BEM depth (`scripts/maestro/check-no-tailwind.mjs:6-15,17-76,218-237`). It is registered in the fixed-count Maestro suite, whose discovery assertion is now 37 (`scripts/maestro/check-maestro.mjs:7-24`). |
| Explicit preflight replacement | pass | Shared Maestro CSS now imports only the two theme layers and owns the sizing/border reset, full-height app shell, text/list/form normalization, interactive cursor behavior, media defaults, and hidden behavior (`src/renderer/maestro/common/style.css:1-108`). Live Home, Control, and Workbench checks retained their constrained height/overflow behavior. |
| Shared agent styling rule | pass | Root `AGENTS.md:206-211` and `CLAUDE.md:204-209` state the same no-atomic-class, sibling-Less, business-rooted BEM, maximum-two-`__`, modifier, and stable-name rules. Extracting both complete sections produced byte-identical text. |

## Verification

| Check | Result | Evidence |
|---|---|---|
| No-Tailwind/BEM source guard | pass | `node scripts/maestro/check-no-tailwind.mjs` exited 0 after the dynamic-producer fix. The review-time mutation probe rejected a `bg-red-500` return in `WorkbenchToolsView.riskClass()` and passed again after restoration. |
| Full Maestro contract suite | pass | `yarn check:maestro` ran all 37 registered checks and exited 0. |
| Vue/Less compilation and production build | pass | Targeted component/style compilation passed, and `yarn build` transformed all main, preload, and renderer inputs and exited 0 in 19.89 seconds. All Maestro Home, Control, and Workbench CSS bundles were emitted. |
| Emitted artifact inspection | pass | Searches under `out/main`, `out/preload`, and `out/renderer` found no Tailwind package/directive marker. A utility-selector scan against the emitted Maestro Home/Control/Workbench CSS returned no match. |
| Isolated Electron baseline | pass | `yarn test:e2e:maestro` passed 1/1 in 7.6 seconds. It exercised the real Home/Control/Workbench graph, constrained horizontal overflow, visible controls and ARIA, singleton/reopen behavior, network isolation, and zero renderer errors (`tests/maestro/specs/baseline.spec.ts:15-115,260-270`). |
| All Workbench views | pass | A temporary isolated Electron spec opened Capture, Skills, Integrations, Injections, Tools, Models, About, and Log; every business root rendered, every page stayed within the viewport, and the renderer error list remained empty. It passed 1/1 in 6.0 seconds and was removed after the run. |
| Web typecheck | existing baseline blocker, not a task finding | `yarn typecheck:web` exits 2 on existing connector SDK mismatches, missing test globals, legacy renderer aliases/Window declarations, and other out-of-scope files. The only migrated-scope diagnostics are `ChatPanel`'s existing `window.audioBridge` and `window.fileBridge` declarations; the same calls exist in the pre-task Cowork source at lines 255/299, while targeted compilation, production build, and live Electron execution all pass. |
| Patch hygiene | pass | `git diff --check` exited 0 after the implementation and guard correction. The temporary review spec was removed. |

## Conclusion

**pass** — Tailwind has been removed from the Bitterless renderer source and build chain. Migrated
components own their presentation in sibling Less files with business BEM classes capped at two
`__` separators, semantic dynamic modifiers, and preserved automation names. The explicit reset,
production build, all 37 Maestro checks, baseline Electron flow, and every Workbench view pass. The
new guard also closes the dynamic-helper regression path found during this review. The remaining
repository-wide web typecheck failures are established, out-of-scope baseline issues rather than
styling migration regressions.
