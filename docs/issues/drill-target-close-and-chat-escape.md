# Chat Escape uses the enabled Stop action

Status: Escape behavior verified; shared native Stop drain repair in progress. Requested by Ral on 2026-09-16.

## Triage

The current Maestro ChatPanel exposes a Stop button while the session is busy and disables it while aborting, but has no Escape binding to that action. This is the requested keyboard enhancement. The attached release/2608 branch contains the July Maestro migration and no drilling/explore implementation, so no unrelated drilling subsystem will be introduced into Bitterless. Cowork owns the reported target-tab drilling defect.

## Contract

- Plain Escape while the chat surface and its current session are active invokes exactly the same Stop action as its enabled Stop button, including the existing drilling confirmation where applicable.
- Hidden/disabled Stop, idle/stopping chat, another active session, another app/browser view, key repeat and IME composition do not trigger a second or unrelated stop. Existing dismissible overlays retain their normal Escape behavior; do not add a global OS shortcut.
- Preserve saved messages, model/provider behavior, tab switching, and unrelated sessions.
- Implement in an isolated worktree, independently review, merge into the original attached branch, and synchronize Git as Ral requested.

## Verification

Run behavioral regressions against the actual affected implementation, meaningful negative cases, focused types/build and affected existing tests. Do not substitute source-text checks or copied logic for behavioral coverage. Model/network and Electron boundaries may be stubbed, with limits reported. No live business operations are required.

## Native Stop follow-up

The Cowork actual-model-boundary regression found the shared BaseAgent Stop pattern returns after a 500 ms startup/1500 ms abort cap, resets busy, and can admit a replacement while the old normal prompt still delivers events. Bitterless uses the same pattern in Maestro BaseAgent.abort and its ordinary Stop service directly awaits that method. Apply the bounded parity fix here: synchronously invalidate the accepted turn, suppress its late events/results, hold admission until actual startup/prompt/abort cleanup settles, propagate cleanup failure, and keep idle/repeated Stop safe. Reuse the existing prompt/tool drain and auth generation protections; do not port Cowork steering or drilling features. Add an actual-runtime regression showing the original failure before repair, preserve ACP behavior, and independently reverify before syncing.
