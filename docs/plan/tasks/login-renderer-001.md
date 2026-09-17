---
id: login-renderer-001
scope: desktop application authentication
status: done
depends-on: []
---

# Dedicated loginRenderer

## Objective

Implement the owner's dedicated, lightweight, full-content account gate. Login must never live
in a browser tab; success destroys its webContents, logout recreates it.

## Context

- [Feature and lifecycle contract](../../features/login-renderer.md)
- Current application authentication services and native main-window view lifecycle.

## Path

- Main authentication/native-view integration; login-only preload/XPC and renderer entry.
- Existing visible login destinations, build entries, auth-related tests.
- docs/features/login-renderer.md and this task (orchestrator owned).

## Verification

Focused behavior tests, touched TypeScript/Vue/Less/build-entry validation and existing auth
regressions. No independent review or Electron E2E; Ral performs the listed live acceptance.

## Result

Implemented and code-verified, human acceptance pending. See the feature's Delivery evidence:
21/21 login integration, 29/29 impacted layout/shortcuts, 19/19 history/first-visible;
focused types/lint/build pass. Existing broad compiler/test limitations are explicitly recorded.
