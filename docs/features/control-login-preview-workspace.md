# Control login inherits the current OnlyPreview Project

2026-09-17 paired requirement from Ral's Cowork report: a workspace selected in OnlyPreview
while logged out must continue into the authenticated Control Chat. Bitterless's matching
mount boundary is `ControlAuthApp.vue`.

## Contract

At authenticated Control initialization, bind the resulting active Maestro Chat (including a
restored Chat) to the settled live OnlyPreview Project, persist that Chat binding, and remember
it for future new Chats. Preserve other historical Chats and normal later history selection.
This is a login/initialization handoff, not continual bidirectional synchronization.

Resolve the Project in Main through the host adapter boundary. An external preview alone never
supplies a workspace, and a Project with an external file still supplies its Project root.
No live settled Project preserves normal restoration. Missing directories retain existing
workspace validation semantics. Adoption must not reopen Preview, change its selection/index,
or create a tab. Preserve account-generation and newer-session fences so stale results cannot
rewrite a new account or a different current Chat. Main tool binding and saved/UI workspace
must agree.

## Integration

Maestro's preview opener registry keeps the host module boundary; adapt that seam if needed
instead of importing OnlyPreview internals into portable Maestro services. Keep the existing
Bitterless auth lifecycle; do not replace it with Cowork's login implementation.

## Fenced adoption releases the Main binding

Main binds the session before the renderer's account/selection fence can run, and Main's per-session
binding is what `resolveWorkspacePath` gives the file tools. When the fence rejects the result the
renderer calls `releaseWorkspaceBinding({ sessionId, path })` with the path adoption returned, and
Main drops the binding **only while it still equals that path** — so a newer explicit choice for the
same session is never clobbered. Releasing is required rather than optional: `refreshWorkspace`
re-pushes an existing path before every send but returns early without one, so a Chat carrying no
workspace would otherwise keep Main resolving its tools inside a Project it never adopted. An
unbound session falls back to the shared default workspace by design. The remembered default is a
separate concern and is reconciled, not reverted.

## Verification

Real-source Main/renderer tests cover fresh/restored Chat adoption, future default, unaffected
history, no Project, external-only, Project plus external file, missing path, logout during
adoption and a newer active session. Run relevant scoped types and independent review.
No app launch, Electron E2E, build-output replacement, or live login.
