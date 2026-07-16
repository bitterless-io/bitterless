# Review: eyes-on-agents-project-filter-003 (round 1)

Baseline: `96a87dac1bda7450f7d7902530b1b4abc38e083e`

## Conclusion

**blocked** — Project resolution, Sync/hook propagation, SQLite migration and write semantics,
Domain/Focus isolation, filtering/counts, focused tests, strict type checks, and production build all
pass. The new Select nevertheless misses two explicit UI acceptance requirements in the rendered
Arco DOM: its background-led styles never match, and its focusable input has no accessible name.

## Findings

### [P2][blocking] The Project Select's visual/focus selectors cannot match the rendered Arco node

`ProjectFilter.less` styles `.project-filter__select .arco-select-view` as a descendant
(`src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.less:9-23`). Arco applies both
classes to the same root node. Rendering the installed `@arco-design/web-vue` Select produces the
following shape:

```html
<span class="arco-select-view-single arco-select project-filter__select arco-select-view ...">
  <input class="arco-select-view-input">
</span>
```

Consequently, the descendant selector matches nothing: `border: 0`, the intended quiet
background/hover state, and the `:focus-within` outline are all absent at runtime. This contradicts
the background-led, borderless, visible-focus contract in
`docs/features/eyes-on-agents-project-filter.md:102-103` and
`docs/integrations/eyes-on-agents-layout.md`.

Required correction: target the actual same element (for example,
`.project-filter__select.arco-select-view` and its state variants), then verify the computed/rendered
result rather than only matching stylesheet source. The current assertion at
`scripts/eyes-on-agents/ui-source.test.mjs:124-131` encodes the ineffective descendant selector and
therefore passes while the runtime style is missing.

### [P2][blocking] `aria-label` labels Arco's wrapper span, not the focusable Select input

`ProjectFilter.vue` passes `aria-label` to `<a-select>`
(`src/renderer/eyesOnAgents/src/components/ProjectFilter/ProjectFilter.vue:3-9`). In the installed
Arco implementation that attribute falls through to the ordinary wrapper `<span>`, while keyboard
focus is owned by its child `<input class="arco-select-view-input">`; the input receives no
`aria-label`, `aria-labelledby`, associated `<label>`, or placeholder. A screen reader focusing the
control therefore does not receive the promised explicit name. The source-only assertion at
`scripts/eyes-on-agents/ui-source.test.mjs:147-148` checks that the attribute text exists but cannot
detect where it lands.

Required correction: give the actual input an accessible name through a mechanism supported by
this Arco version, or wrap/associate the Select with a real label that names its nested input. Add a
rendered-DOM accessibility regression that asserts the focusable element has the expected name.

## Accepted implementation areas

- The resolver distinguishes `project`, confirmed `none`, and `unavailable`; uses native realpath,
  selects the nearest `.git` directory or bounded `gitdir:` file, and normalizes macOS Unicode and
  Windows separators/case without invoking a shell or reading repository content.
- Full Sync resolves and caches Project metadata for one pass, while trusted Codex hook events
  resolve their `cwd` before persistence. App Server lifecycle events without Project evidence
  preserve existing metadata.
- The migration is idempotent, repairs partial Project tuples to all-null, and adds the scoped
  index. Repository `undefined` / `null` / metadata writes preserve / clear / replace the tuple for
  both discovery upserts and runtime events; none of these paths changes `domain_id`.
- Focus remains derived from all threads, custom Domains remain unfiltered, and the Select is
  mounted only for Uncategorized. `All`, `No project`, exact Project counts, duplicate-name labels,
  visible/total counts, and a selected zero-result Project are implemented consistently with the
  design contract.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, resolver, repository, App Server, bridge, Project-filter, and six UI source tests exited 0. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped main/shared/preload strict check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped EyesOnAgents Vue strict check exited 0. |
| `yarn build` | pass | Main, preload, and all renderer bundles, including EyesOnAgents, emitted successfully. |
| `git diff --check 10fade5 96a87da` | pass | The fixed implementation commit has no whitespace errors. |
| `git diff --check` | pass | The current worktree diff has no whitespace errors. |
| Installed Arco Select SSR probe | exposes findings | Both custom and `arco-select-view` classes plus `aria-label` land on one wrapper span; the nested focusable input is unlabeled. |

## Re-review gate

Correct the Select selector and accessible-name wiring, replace or supplement the source-only
assertions with rendered-DOM checks, and rerun the focused suite, both scoped type checks, the build,
and `git diff --check` before requesting round 2.
