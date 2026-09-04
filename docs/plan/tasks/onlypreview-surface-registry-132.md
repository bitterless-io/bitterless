---
id: onlypreview-surface-registry-132
scope: replace the window helper's single-surface fields with a token-keyed surface registry that admits one live content surface
status: pending
depends-on: [onlypreview-mount-seam-131]
verify: node --test tests/onlypreview/onlyPreviewSurfaceRegistry.test.mjs && node --test tests/onlypreview/onlyPreviewCore.test.mjs && yarn typecheck:node && git diff --check
---

# A surface registry instead of three fields

## Objective

Stop expressing "the OnlyPreview instance" as `baseWindow` + `shellView` + `standaloneHost`, so a
second mount is a lookup rather than a rewrite — while keeping the current policy of one live
content surface.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (identity and instance count)
- `src/main/windows/onlyPreviewWindow.helper.ts:228-258` (the single-surface fields)
- `src/main/onlypreview/onlyPreviewHost.registry.ts` (`hostToken` is the identity, and stays so)
- Every content service still holds one runtime and guards on `hostToken`; this task does **not**
  multiplex them.

## Contract

- `Map<hostToken, OnlyPreviewSurface>` replaces the fields. `getStandaloneHost` /
  `getStandaloneWindow` / `requireStandaloneWindow` become surface lookups; the `standalone`
  vocabulary survives only where it genuinely means the standalone mount.
- Policy in exactly one place: at most one live surface with role `content`. A second open request
  resolves to the existing surface. The place that enforces it is named and commented so raising
  the limit is a policy edit.
- Host revocation removes the surface and disposes it; `destroy()` disposes every surface.
- `host.kind` gains `'cowork'` alongside `'standalone'`, and every `host.kind === 'standalone'`
  comparison in command execution becomes a surface lookup instead of a kind test.

## Verification

- Two open requests yield one surface; revocation disposes exactly that surface.
- `hostToken` from a revoked surface is refused with the existing contract error.
- The existing core test suite passes unchanged.
