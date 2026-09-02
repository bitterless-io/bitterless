---
id: release-preview-channel-007-3
target: working-tree-2026-08-31-dev-next
compared_with: release-preview-channel-007-2
scope: app.asar generated-release and temporary-root exclusions
---

# Verdict

**PASS. No blocking finding.**

`electron-builder.tmp.yml` excludes the complete project-root `dist/**` and `tmp/**` trees, so a
Preview build whose output is nested at `dist/preview` cannot recursively package Stable, Preview,
or historical release artifacts. The generated `electron-builder.yml` remains untouched in this
working tree; `scripts/before.js` continues to read the template and regenerate the active channel
configuration before every package script invokes Electron Builder.

# Findings

None.

# Evidence

| Requirement | Evidence | Result |
|---|---|---|
| Exclude every generated release artifact | `electron-builder.tmp.yml` contains the root-scoped `!dist/**` matcher; the focused audit test requires it for both `output: dist` and simulated `output: dist/preview`. | pass |
| Exclude transient workspace files | The same template and focused Stable/Preview assertions require the root-scoped `!tmp/**` matcher. | pass |
| Keep the template as the source of truth | `scripts/before.js` reads `electron-builder.tmp.yml`, applies channel substitutions, then writes `electron-builder.yml`; `git diff --exit-code -- electron-builder.yml` reports no direct working-tree edit. | pass |
| Preserve required runtime content | Compiled Main/Preload/renderer assets remain under `out`; the native SQLite binary, agent skills, CLI tools, tray artwork, and sounds remain explicit `extraResources`. Root-scoped `!dist/**` does not match dependency-internal paths such as `node_modules/<package>/dist/**`, and no packaged runtime resolver depends on a project-root `dist` or `tmp` file. | pass |
| Documentation matches implementation | Task 007 and `desktop-release-channels.md` both specify exclusion of the complete `dist` and `tmp` roots, including nested Preview output, and do not instruct maintainers to edit generated Builder YAML. | pass |

# Verification

| Check | Result |
|---|---|
| `yarn test:desktop-package-audit` | PASS, 25/25 |
| `yarn test:runtime-profile` | PASS, 9/9; includes real temporary Preview Builder generation from the template |
| scoped `git diff --check` | PASS |
| Code-review `TS-1` / `TS-2` scan | PASS; `desktopPackageAudit.test.mjs` is 691 lines and adds no eligible `function` declaration |
| Electron E2E | Not run — excluded by repository policy and unnecessary for this packaging-source review |

# Conclusion

The ASAR bloat fix is approved. It closes the nested `dist/preview` self-inclusion path and excludes
root temporary data without removing any runtime-owned bundle or resource path.
