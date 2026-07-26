---
id: omni-layout-axis-collapse-002-1
target: working-tree-2026-07-25
compared_with: omni-layout-axis-collapse-002
status: pass
---

# Verdict

**PASS after resolving all independent-review findings. No task-related P0-P2 finding remains.**

# Findings resolved

- **P2:** Setting DAO previously truncated serialized values at 10,000 characters, which could
  corrupt a larger persisted Omni tree. Serialization now either preserves the complete value or
  rejects payloads over 4 MiB measured as UTF-8 bytes; ASCII and Chinese boundary tests cover the
  old truncation and byte-versus-code-unit cases.
- **P2:** The shared Model Cancel UI had two comparisons made unreachable by Vue template type
  narrowing. The dead loading comparisons were removed, and Web type checking no longer reports a
  touched Model file.

# Evidence

- Removing both top leaves from `V[H(A,B),H(C,D)]` promotes the remaining horizontal child without
  copying the former vertical weights. Splitting above and below then produces asserted x, y,
  width, and height values with the shared 4px divider.
- Structural revision remounting and lifecycle-event guards prevent old Splitpanes callbacks from
  writing sizes after root ID or axis changes.
- Browser and mini-app cells share outer leaf bounds; only browser content is inset by the 36px URL
  header. Main owns serialized apply plus persistence and replays its normalized tree on reopen.

# Verification

- `yarn test:omni-layout` - pass, 5/5.
- `yarn test:model-provider` - pass, 13/13.
- `yarn typecheck:node`, targeted ESLint, `yarn check:renderer-i18n`, `yarn build`, and
  `git diff --check` - pass.
- `yarn typecheck:web` - no task-related diagnostic; unrelated existing repository diagnostics
  remain.

# Boundary

DAO rejection propagation is inspected through the focused source contract rather than a complete
Electron behavior-level rejection injection. Ral requested manual visual verification, so no screen
recording or screenshot run was performed.
