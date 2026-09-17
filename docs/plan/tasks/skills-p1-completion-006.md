---
id: skills-p1-completion-006
scope: Complete approved skill selection, local enablement, diagnostics and managed installation
status: implemented
depends-on: [skills-installer-guidance-005]
verify: code-passed; owner-acceptance-pending
---

# Complete the remaining approved P1 skill capabilities

Ral, 2026-09-17: implement all remaining P1 items using the recommended cross-project design. Work serially in the current `dev/next` checkout, preserve unrelated edits, and do not commit, switch branches, launch Electron/E2E or start independent review. Root owns the cross-project assessment. This task owns Bitterless code and project evidence.

## Contract and serial checkpoints

1. **P1-1 qualified selection.** Add a discoverable Chat composer skill picker. Display name, source and path so duplicate names stay distinguishable. Send stable qualified references as structured request data; the host re-resolves them in that Chat's current workspace and authorization context before use. Explicit-only skills remain selectable. Deleted, revoked or disabled selections fail clearly rather than falling back to another same-name package.
2. **P1-3 local enablement.** Persist enabled/disabled state by stable qualified identity in application profile storage. Keep disabled packages visible and inspectable in Skills management, but exclude them from runtime usable catalogs and reject explicit host skill execution/selection. Restart retains state. Enabling cannot bypass source authorization. Files and cloud publishing state remain unchanged.
3. **P1-4 execution diagnostics.** Provide a read-only operation for the selected package's explicitly declared entry, interpreter and dependencies. Report actionable missing conditions and distinguish unknown/not-declared from verified availability. Do not run the skill, install dependencies, configure MCP or require unrelated institution login.
4. **P1-2 managed source installation.** Integrate the shared pure core from `tmp/skill-p1-core` with a real `skill_install` host tool and compact source-management affordances. Support GitHub HTTPS archives, npm tarballs and general HTTPS Git, explicit refs/versions and known `npx skills add` syntax. Preserve complete packages, destination/scope safety, no-overwrite, source ledger, update/remove local-edit protection, rollback and cache invalidation. Default destination is explicitly selected workspace `.agents/skills`, otherwise profile Shared. Use existing capabilities and host HTTPS; no default system-global runtime install or PATH change.

## UI contract

Preserve the existing Arco typography, light/dark theme variables (`--color-bg-1`, `--color-fill-1/2`, `--color-text-1/2/3`, `--primary-6`, `--danger-6`) and current 13px management text/20px detail heading. New controls are left-aligned, small and contextual. No new color palette, font, navigation shell or store. Use existing i18n, BEM/name attributes, keyboard focus and mobile detail/back behavior.

```text
Chat composer
┌─────────────────────────────────────────────────────────┐
│ [Selected skill: Name · Workspace  ×]                    │
│ Describe the task…                                      │
│ [Attach] [Skills ▾]                         [Send]       │
└─────────────────────────────────────────────────────────┘
Skills picker: search; name + source + location; Explicit only badge
Disabled/error rows explain why unavailable; close/cancel preserves text.

Skills (existing two-column page)
┌──────────────────────────┬──────────────────────────────┐
│ Global / Workspace / Org │ Name                Enabled │
│ search + state           │ path / source / revision    │
│ Name       Disabled      │ [Enable/Disable] [Diagnose] │
│ source/location          │ [source details / update /  │
│                          │  remove when managed]       │
│                          │ Diagnostic condition → fix │
└──────────────────────────┴──────────────────────────────┘
```

Selection belongs to one Chat draft. Each send carries the chosen identity, not a bare name. Source management acts only on the installation's exact root and ledger entry; it does not install automatically when opening the page. Diagnostic and installation errors remain visible with a concrete repair path.

## Verification and handoff

At each checkpoint run focused behavior/source tests and scoped types. Cover same-name identities, explicit-only selection, revoke/delete/disable rejection, restart persistence, management visibility, resource reload/cache boundaries, diagnostic missing/restored conditions, installer success/error/local-edit protection and no-institution operation. Finish with relevant renderer checks and one complete build. Record exact commands/results below. Application interaction, real remote/account-specific sources and live model experience remain human acceptance; root owns that handoff.

## Results

All four approved P1 checkpoints are implemented. No branch change, commit, app GUI/E2E or independent review was performed.

- **P1-1:** `skillPicker.store.ts` + ChatPanel carry an exact qualified reference in each selected Chat draft/request. `skillSelection.ts` resolves the current authorized package and reads its instructions before the turn; bare names, deleted packages, revoked institutions and disabled skills fail instead of selecting a namesake. Explicit-only entries remain selectable. The original site restriction for recording recipes remains.
- **P1-3:** `skillState.ts` persists disabled stable references in profile `skill-state.json` with atomic replacement. Registry management entries retain `enabled:false`; runtime Pi catalogs and host selection/execution reject them. Revision and institution generation changes do not reset this setting. Management can inspect or re-enable the package, subject to source authorization. Generic native read/bash remain general file tools, so this is not an OS permissions sandbox.
- **P1-4:** `skillDiagnostics.ts` + real `skill_diagnose` + Skills “Check runtime” report declared entry, executable interpreter, command dependencies and local package dependencies with repair text. Instruction-only packages have no required entry; undeclared/incompatible conditions remain unverified. The operation is read-only and always returns `behaviorVerified:false`; the restored fixture was separately executed to demonstrate the distinction.
- **P1-2:** `skillInstaller.ts` and `skillInstallerGit.ts` are the final shared 21-test core, copied unchanged from the approved scratch delivery. `skillInstallTools.ts` provides real `skill_install` inspect/install/list/update/remove, workspace-first/Shared and global-flag routing, identity/root guards and success-only registry invalidation. The Skills page explicitly loads source/ref/status/path details and can update/remove by owned installation ID; opening an ordinary catalog does not hash installation trees. GitHub archives, npm tarballs and general HTTPS Git need no external Node/npm/Git CLI or source lifecycle execution. Whole source layout/resources are retained; only selected SKILL.md entry points activate. Local modifications block update/removal, while failures restore prior state.

### Confirmation and cancellation evidence

`AgentToolSpec.deferConfirmation` makes only this trusted installer defer the existing HostToolRegistry policy decision until concrete source/version/destination are available. Inspect/list do not call the callback. Install includes selected candidates; update includes previous and new resolved source. Bypass proceeds, disabled policy omits the tool, and confirm must accept before mutation. No new unconditional approval rule was introduced.

The existing Pi tool signal now flows through `executeHostTool`, the BaseAgent timeout wrapper and controller workspace wrapper to the installer. Timeout aborts the signal. A focused test drives the real BaseAgent wrapper → Pi binding → installer, aborts during archive retrieval and verifies no package/ledger/cache mutation. Rejection and workspace/account-context changes also leave existing packages intact. These narrow signal/context additions are necessary for the approved installation cancellation contract; they do not add a new runtime framework.

### Code verification

| Command | Result |
|---|---|
| `node --test tests/skillsThreeSources/*.test.mjs tests/skillScopes/*.test.mjs` | **118/118 passed** (11.41 s). Includes 21 pure installer cases, 5 host installer cases, 7 P1 selector/state/diagnostic cases, native/cache/New Chat/request parity, creator/full-tree roundtrip and auth/no-institution regressions. The first run had 25 scope fixture import-stub errors; the fixture was updated for the new separately tested diagnostics imports, scope 26/26 passed, then the complete final run passed. |
| `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json` | Passed, strict scoped node types (4.73 s). |
| `yarn vue-tsc --noEmit -p tests/skillsThreeSources/tsconfig.web.json` | Passed, strict Chat/Skills renderer types (5.72 s); includes the existing Maestro window bridge declarations. |
| `node scripts/maestro/check-host-tools.mjs` | Passed: disabled, confirmation, duplicate and catalog contracts. |
| `node scripts/maestro/check-agent-runtime.mjs` | Passed. Updated its stale loader source assertion to the already approved host loader variable/initial reload contract. |
| `yarn check:renderer-i18n` | Existing unrelated failure: `scripts/renderer-i18n/check-renderer-i18n.mjs:66`, “maestroTabAlias must start language initialization before evaluating product UI”. New labels are paired in the typed English/Chinese catalogs. |
| `yarn tsc --noEmit --composite false --incremental false -p tsconfig.node.json` | Whole-project attempt exhausted Node's default heap and exited SIGABRT; no full-project type pass is claimed. Scoped strict checks passed. |
| `yarn build` | **Passed, 53.89 s**, debug_dev. Initial attempt stopped because dependency relinking with ignored lifecycle scripts left the exact locked Electron 40.10.6 package without its binary install artifacts. `yarn --cwd node_modules/electron run postinstall` restored those artifacts (3.20 s); retry's existing ensure-native hook rebuilt and verified SQLite for Electron 40.10.6/ABI 143/darwin-arm64. No GUI was launched. |

Dependencies were added with Yarn only: production isomorphic-git 1.42.2, explicit minimatch v3 and semver, and their missing TypeScript declarations. Existing archive/YAML dependencies are reused. No private runtime bootstrap, system-global package install or PATH change was added.

### Bounded support and human acceptance

Supported managed sources are public HTTPS GitHub/npm/Git. Embedded credentials, SSH sources, unknown arbitrary CLI commands and shell expansions are rejected. Automatic private-source authentication setup, app-private runtime provisioning and full dependency-environment/behavior validation are not implemented. Source installation proves validated owned files/catalog availability, not successful execution. Diagnostic package lookup checks declared package presence, not semver/runtime compatibility. For local changes, preserve or reconcile them before requesting managed update/remove; there is no force-overwrite path.

Root owns the cross-project assessment and human handoff. Owner acceptance: select same-name Global/Workspace skills (including explicit-only), disable/restart/re-enable, observe declared missing conditions, paste a supported source command, inspect and install chosen candidates, then exercise update/remove, local modification refusal, confirmation and Stop. Public real-network and private-account-specific cases were not exercised by the fixture tests. Ordinary turns must continue using cached skills and work without a valid institution.
