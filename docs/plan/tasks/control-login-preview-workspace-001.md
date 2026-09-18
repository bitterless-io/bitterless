---
id: control-login-preview-workspace-001
scope: OnlyPreview Project handoff into authenticated Maestro Chat
status: done
depends-on: []
verify: real-source workspace/auth tests, scoped types, independent review
---

# Inherit Preview workspace after Control login

## Objective and context

Implement `docs/features/control-login-preview-workspace.md`, paired with the Cowork task of
the same name. Read `docs/features/control-login.md`, preserve the host preview adapter and
existing auth/session guards. This is shared behavior in both applications.

## Path

Maestro preview host adapter/contract, workspace service and XPC, Control initialization stores,
and focused tests. Preserve unrelated LLM and package changes.

## Verification

Exercise the feature contract scenarios through real-source tests with native/storage edge
stubs, relevant types, and independent review in
`docs/plan/reviews/control-login-preview-workspace-001-1.md`.
No branch operations, app launch, Electron E2E, packaging, or publication.

## Delivery

Main resolves the settled Project through the preview-opener adapter
(`getMaestroPreviewOpener()?.currentProjectDirectory?.()`), so no OnlyPreview internals reach
portable Maestro services; Control's `channel.store` adopts it once per authenticated
initialization behind the existing `authActive`/`authGeneration` fences. Independent review
returned pass-with-findings; the P2 (a fenced adoption leaving Main's tool binding inside a Project
the Chat never adopted, unhealable for a Chat with no workspace) and all three P3s were repaired in
this task via a compare-and-release `releaseWorkspaceBinding`, a guarded XPC call, a non-poisoning
default-write chain, and new Main-binding assertions.

Scoped suite 88/88 including the paired 14/14 file, which is byte-identical to Cowork's. Full
`tests/onlypreview` 1346/1372 with no new failure versus the pre-change run; typecheck surfaces
63/3/4, identical to baseline. `tests/maestro` was not run in full — `maestroConcurrentTurns` hangs
under the default runner on a pre-existing steering case. See
[review](../reviews/control-login-preview-workspace-001-1.md).

No desktop launch, Electron E2E, packaging, or live login.
