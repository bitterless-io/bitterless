---
id: unit-test-hang-201
scope: copy the fixed shared controlLoginPreviewWorkspace test from Cowork; per-test timeout for the script that runs it
status: pending
depends-on: [decision-helper-199]
---

Paired with `micromeet-cowork` `docs/plan/tasks/unit-test-hang-001.md`. **Start after Cowork unit-test-hang-001 is done.**

# Shared test that hangs after fixture drift (BL side)

## Objective

- Copy `tests/unit/controlLoginPreviewWorkspace.test.mjs` from micromeet-cowork to `tests/onlypreview/controlLoginPreviewWorkspace.test.mjs`
  byte-for-byte (`cmp` silent). The Cowork fix already carries the BL binding `subscribeControlChannel`.
- Whatever `package.json` script runs `tests/onlypreview/*` gets `--test-timeout=60000` (only that script).

## Context

- `docs/issues/unit-tests-hang-after-fixture-drift.md`

## Path

- `tests/onlypreview/controlLoginPreviewWorkspace.test.mjs`, `package.json` (that one script)

## Verification

- The file exits on its own with every test passing; a broken fixture fails within seconds. No E2E.
