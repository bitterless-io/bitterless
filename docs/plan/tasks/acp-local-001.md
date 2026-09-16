---
id: acp-local-001
scope: Maestro local ACP server and client bridges
status: in-progress
depends-on: []
verify: strict types, socket and stdio integration, runtime wiring, independent review
---

## objective

Implement the complete local ACP integration described in the feature contract on codex/acp-local-socket. Keep this worktree for Ral; do not merge or publish.

## context

- docs/INDEX.md
- docs/features/local-acp.md
- docs/plan/README.md

## path

- Existing main-process app lifecycle, Maestro runtime/controller, permission and stream event boundaries
- New ACP server, types, host adapter, persistence and helpers
- Build entries, packaging and package manifests/lockfile
- Focused scripts/tests and docs/features/local-acp.md

## verification

All acceptance checks in docs/features/local-acp.md. Record exact commands and limitations below. Commit implementation before independent review.

## evidence

Pending.
