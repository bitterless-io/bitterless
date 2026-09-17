---
id: skills-installer-guidance-005
scope: Lightweight skill installation guidance with minimal extra software
status: done
depends-on: [skills-creator-004]
verify: passed
---

# Prefer existing tools when installing skills

Ral, 2026-09-17: prefer not installing extra software when possible; put this rule in an effective skill-installer or system/authoring prompt location. A lightweight installation guide is authorized. A managed Git/GitHub/npm/ref installer remains design-only.

## Contract

- Guide actual Chat installation requests through existing tools, bundled Bun and direct HTTPS retrieval when sufficient. Do not add a new installer tool, registration system, runtime bootstrapper or UI.
- Treat a pasted `npx` command as installation intent: first establish the requested skill, source, version/ref and actual CLI capability. Do not blindly run the supplied command.
- Run the original CLI with Bun only after verifying compatibility. If a runtime is genuinely missing, consider application-private Node/npm/Git; explain that automatic preparation is not implemented, and do not imply those runtimes are available. Necessary dependencies are allowed when existing capabilities are insufficient; this is a preference for avoiding unnecessary installation, not a blanket prohibition. Never default to global installation or changing system PATH.
- Preserve full skill resource trees, selected-workspace/Shared destinations, existing-name protection, existing validation and Refresh/New Chat rules. No valid institution must not block local skills. Do not claim a managed source ledger, update or uninstall capability that does not exist.
- Keep instructions aligned with Cowork. Verify the rendered Chat prompt and scoped types; no runtime behavior changes, Electron launch, E2E, independent review or repeated full build are required for this wording-only integration.

## Verification

Implemented as the named **Skill installer guidance** block in `buildAgentTurnPrompt`'s existing `skillAuthoring` section, alongside the actual selected-workspace/Shared root and bundled Bun path. It is model-facing guidance through existing tools, not a new registered skill ID, pseudo-tool or managed installer. Cowork uses the same common wording in its corresponding authoring prompt. No runtime loading, installer capability, tool registry or UI changed.

| Command | Result |
|---|---|
| `node --test --test-name-pattern='native prompt preserves|rendered installer guidance' tests/skillsThreeSources/catalog.test.mjs` | 2/2 passed. Tests the actual rendered prompt, full catalog and Bun path, with and without an explicitly selected workspace; confirms the dependency preference, source/compatibility checks, accurate capability limits, complete resources and existing destination/reload rules. |
| `yarn tsc --noEmit -p tests/skillsThreeSources/tsconfig.node.json --composite false` | Passed (2.43 s). |
| `git diff --check -- src/main/agent/runtime/agentPrompt.ts tests/skillsThreeSources/catalog.test.mjs docs/features/skills-three-sources.md docs/plan/tasks/skills-installer-guidance-005.md docs/INDEX.md docs/plan/README.md` | Passed. |

No dependencies were installed during implementation. This prompt-only follow-up reuses task 004's completed full build; no repeated build, live model, Electron/E2E or independent review was run. Root owns the cross-project HTML and human handoff. Managed remote installation and automatic app-private runtime preparation remain plan-only.
