---
id: desktop-auto-update-state-replay-008-1
status: pass
reviewed_task: desktop-auto-update-state-replay-008
target: 9caeb75
base: c2dc188
compared_with: desktop-auto-update-state-replay-008
date: 2026-07-27
review_type: independent-code-and-contract
---

# Verdict

**PASS.** No P1, P2, or P3 finding remains. Commit `9caeb75` satisfies the ready-state replay
contract and is ready to merge within the stated non-packaging boundary.

# Findings

No findings.

# Evidence

- Main stores a defensive ready snapshot before both Home and Maestro broadcasts, returns a fresh
  copy or explicit `null`, and normalizes updater release notes from string, note-array, or absent
  input to Home's string contract.
- Home registers its live subscription before requesting replay, and Home initialization remains
  before App mount. A valid live ready event wins over an in-flight stale snapshot.
- Maestro registers both availability and downloaded subscriptions before requesting replay. Either
  valid live event wins over a stale snapshot; availability remains downloading and downloaded state
  becomes install-ready.
- Both renderers validate live and snapshot values before updating state. Malformed live data does
  not close replay, and a malformed non-null snapshot is logged even when valid live state arrived
  first.
- The prior single polling timer, shared in-flight check, 60-second cadence, two update gates,
  E2E-disable behavior, and install lifecycle remain unchanged.

# Verification

| Check | Result |
|---|---|
| `yarn test:desktop-auto-update` | pass — 14/14 |
| `node scripts/maestro/check-update-ux.mjs` | pass |
| `yarn check:renderer-i18n` | pass |
| `yarn test:customer-auth` | pass — 14/14 |
| focused strict Main TypeScript | pass |
| focused strict Home and Maestro TypeScript | pass |
| `yarn typecheck:node` | pass — configured preflight |
| targeted ESLint with `--quiet` | pass |
| `git diff --check c2dc188..9caeb75` | pass |

The additional whole-project strict Web check retains unrelated existing diagnostics. A whole-project
strict Node override exceeded the 4 GB heap, so semantic type verification stayed bounded to all
changed Main and renderer modules; those focused checks passed.

# Boundary

Verification did not launch Electron, build, package, sign, notarize, publish, upload, refresh a CDN,
or access or mutate the remote update feed. Real-device renderer recreation and published-update
installation remain the owner acceptance step for a later release.
