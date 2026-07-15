# Review: renderer-tailwind-removal (round 2)

## Findings

No P1, P2, or P3 finding was found in the round 2 owner-follow-up scope.

## Owner follow-up review

| Contract | Result | Evidence |
|---|---|---|
| Dormant packages declared | pass | `@tailwindcss/vite` and `tailwindcss` are both development dependencies at `^4.3.0`, and neither is present in runtime `dependencies` (`package.json:142,160`). `yarn list` resolves both direct packages to 4.3.2. |
| Dormant packages locked | pass | The lockfile contains `@tailwindcss/vite@^4.3.0` resolved to 4.3.2 with its node/oxide/Tailwind dependency chain, and the direct `tailwindcss@^4.3.0` selector resolves to 4.3.2 (`yarn.lock:2754-2859,9336-9339`). |
| Renderer build remains Tailwind-free | pass | `electron.vite.config.ts` has no Tailwind import. Its renderer plugin list contains only Vue, the Maestro SQLite CSP plugin, and Monaco (`electron.vite.config.ts:1-8,157-160`). Independent source search found no Tailwind CSS import/reference, `@apply`, `@tailwind`, or plugin activation under renderer source/config. |
| Two-sided regression guard | pass | The guard scans all renderer source plus the Electron Vite config for Tailwind activation while separately requiring both exact devDependency declarations, forbidding runtime dependency placement, and requiring compatible lock entries (`scripts/maestro/check-no-tailwind.mjs:218-275`). Package/lock files are no longer incorrectly treated as source activation. |
| Dynamic class and BEM protections retained | pass | The round 1 TypeScript-AST tracing of actual `:class` producers remains intact, and static/dynamic utility values, utility selectors, static Maestro style attributes, and classes with more than two `__` separators are still rejected (`scripts/maestro/check-no-tailwind.mjs:85-216`). The follow-up did not weaken the fixed 37-check discovery assertion. |

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused Tailwind/BEM guard | pass | `node scripts/maestro/check-no-tailwind.mjs` exited 0 with the dormant dependencies installed and locked. |
| Full Maestro suite | pass | `yarn check:maestro` ran all 37 registered checks and exited 0. |
| Production build | pass | `yarn build` transformed all main, preload, and renderer inputs and exited 0 in 14.50 seconds. Dormant Tailwind packages were not pulled into the renderer graph. |
| Build artifact inspection | pass | Searches under `out/main`, `out/preload`, and `out/renderer` found no `tailwindcss`, `@tailwind`, or `@apply` marker. A utility-selector scan of the emitted Maestro Home, Control, and Workbench CSS returned no result. |
| Installed dependency probe | pass | `yarn list --pattern 'tailwindcss|@tailwindcss/vite' --depth=0` reported direct `@tailwindcss/vite@4.3.2` and `tailwindcss@4.3.2`; reading their installed manifests returned the same versions. |
| Patch hygiene | pass | `git diff --check` exited 0. No renderer UI file changed in this follow-up, so round 1's Electron UI evidence remains applicable. |

## Conclusion

**pass** — the owner-requested compatibility packages are restored and locked as dormant
development dependencies, while renderer source and the Electron Vite plugin chain remain fully
Tailwind-free. The revised guard correctly enforces both sides of that boundary without weakening
the dynamic-class, BEM-depth, or fixed-suite protections, and the production artifacts confirm that
the installed packages are not activated.
