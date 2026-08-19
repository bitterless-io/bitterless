# EyesOnAgents Codex Observation

Status: lifecycle and four-step consent guide implemented; owner verification pending for task 020

Date: 2026-07-17

## Decision

Codex Desktop observation is an explicit, global Bitterless capability. It is independent from the
long-lived App Server connection used to inventory threads. Enabling observation installs only the
Bitterless-owned user hooks; connecting or disconnecting App Server never installs, rewrites, or
removes them. Only the explicit **Disable Codex observation** action removes them.

The capability has two delivery units that ship together:

1. a lightweight Node-mode hook helper with durable offline delivery and commit-based
   acknowledgement;
2. global installation, Codex trust review, status recheck, and lifecycle/UI decoupling.

The reliable helper is a prerequisite because a global hook continues to run while Bitterless is
closed. Shipping the global lifecycle without an outbox would claim observation while knowingly
losing events.

## Product boundary

```text
Codex Desktop / CLI
        |
        | four allowlisted user hooks
        v
stable Bitterless shim
        |
        | ELECTRON_RUN_AS_NODE=1
        v
lightweight helper ---- socket ----> listener ----> SQLite transaction
        |                                  |              |
        | listener unavailable             | ACK only     | event + receipt
        v                                  | after commit  v
atomic file outbox ------------------------+         EyesOnAgents

Bitterless-managed App Server
        |
        +---- thread inventory and its own lifecycle events
        +---- hooks/list status inspection
        +---- exact owned-hook re-enable through config/batchWrite
```

The bridge remains metadata-only unless the separate default-off **Store latest user question**
preference is enabled. In that case only `UserPromptSubmit.prompt` may become one Unicode-safe,
8,192-byte preview in a live V2 frame. The main listener checks the preference again before the
preview can join the receipt/lifecycle SQLite transaction. A failed send or lost acknowledgement
projects the same delivery identity to metadata-only form before any outbox write. `Stop` may include
`last_assistant_message`, but that and every non-user-prompt content field are always discarded.

The task-019 tiered All-thread refresh may separately call
`thread/read({ includeTurns: false })` for metadata and one bounded
`thread/turns/list(itemsView: "full")` page for the latest question; it never calls
`thread/read({ includeTurns: true })` or `thread/turns/items/list`. See the official
[Codex Hooks](https://learn.chatgpt.com/docs/hooks) and
[App Server](https://learn.chatgpt.com/docs/app-server) contracts.

The complete exception is [EyesOnAgents Last User Prompt](eyes-on-agents-last-user-prompt.md): task
018 owns consent and storage, task 019 expands bounded recovery across All, and task 016 adds trusted
live Hook capture while every offline artifact remains content-free. Responses, reasoning, tools,
diffs, approvals, attachments, earlier questions, and transcripts remain prohibited.

## Independent user intents

EyesOnAgents persists and respects two unrelated choices:

| choice | enabled behavior | disabled behavior |
|---|---|---|
| App Server auto-connect | keep the Bitterless-owned inventory process connected | do not reconnect except for an explicit Refresh or a short hook-status inspection |
| Codex observation | keep the listener available and retain the global hook definitions | reject hook intake and remove only Bitterless-owned definitions and helper artifacts |

Their actions have the following exact effects:

| action | App Server | Codex observation |
|---|---|---|
| Connect App Server | connect; persist auto-connect | unchanged; may refresh status if already enabled |
| Disconnect App Server | disconnect; clear auto-connect | hook, listener, trust evidence, and unread data remain |
| Enable Codex observation | unchanged apart from a temporary inspection if needed | install/repair, start listener, inspect trust |
| Disable Codex observation | unchanged | fence intake, drain accepted writes, stop listener, remove owned definitions and artifacts |
| application shutdown | stop process for this run; preserve intent | stop listener for this run; preserve installed definitions and intent |
| next launch/sign-in | reconnect only when auto-connect is enabled | restart listener whenever observation is installed, even if App Server auto-connect is disabled |

Disabling observation invalidates only live evidence owned by `codex_hook`. It does not clear
Domain assignment, completion history, unread markers, snapshots, or App Server evidence.

## Installation and stable launcher

Bitterless owns exactly four user-level command hooks: `SessionStart`, `UserPromptSubmit`,
`PermissionRequest`, and `Stop`. Installation edits `~/.codex/hooks.json` surgically, preserves all
unrelated hooks, and writes a stable shim under Bitterless `userData`.

The command stored in Codex always points to that stable shim. The shim invokes a separate bundled
helper entry with `ELECTRON_RUN_AS_NODE=1`; it must not import `app.main`, create a `BrowserWindow`,
initialize renderers, or launch the full Bitterless application. Upgrades may atomically replace
the shim/helper contents without changing the command in the hook definition. A definition is
rewritten only when it is absent or genuinely drifted, because a command change creates a new
Codex trust hash.

macOS and Windows launchers use quoted argument arrays or equivalent fixed scripts. No user input,
shell fragment, executable path, or arbitrary command crosses the renderer boundary.

## Reliable delivery

Every invocation receives one random delivery ID before attempting delivery. The helper validates
and bounds the event, then follows this protocol:

1. If the authenticated local listener is available, send `{ deliveryId, event }` and wait for an
   acknowledgement.
2. The listener asks the SQLite repository to record the delivery receipt, apply the runtime event,
   and conditionally replace the one latest prompt in one transaction.
3. Only after that transaction commits does the listener return `committed`.
4. A connection error, timeout, lost acknowledgement, or closed Bitterless process retains the same
   delivery/event identity but removes prompt fields before writing one atomic outbox file
   (`temporary file -> rename`).
5. Listener startup and each successful intake drain the outbox oldest-first. A replayed delivery
   already present in the receipt table is acknowledged without applying the event twice; its file
   is then deleted.

This covers the ambiguous case where SQLite commits but the acknowledgement is lost. Dedupe is
persistent across Bitterless restarts, not an in-memory set.

Outbox inputs are bounded by schema, file size, and file count. Invalid or corrupt bytes are deleted
and replaced by a content-free quarantine descriptor that surfaces a bounded observation error; an
overflow or storage marker invalidates live hook evidence so EyesOnAgents never presents incomplete
coverage as current. A marker pauses replay until a fresh trusted Hook inspection establishes a
recovery fence. Under the outbox lock, Bitterless discards only the untrustworthy prefix through the
marker cutoff, acknowledges the marker last, and then replays the preserved suffix oldest-first.
The cutover is bound to the exact durable marker inspected before recovery; a changed marker deletes
nothing and starts a new generation. Failure to acquire the recovery lock does not fabricate a new
delivery gap or move the cutoff.
Removing observation is never a recovery instruction because it deletes the outbox. Receipt cleanup
may remove old committed IDs only after no matching outbox file remains.

Listener startup invalidates active Hook evidence before the socket accepts a new lifetime. That
successful invalidation is the lifetime boundary: a durable delivery committed by the current
listener may restore active state even when its provider occurrence time predates listener startup.
The repository grants that current-listener authority only over `discovery + unknown`; newer
concrete App Server or Hook evidence still wins by provider time. This permits offline replay without
allowing a pre-start persisted working row to remain current.

The independent App Server used for inventory and `thread/read` metadata does not own Codex
Desktop's turns. Its thread read status is therefore never allowed to overwrite Hook runtime
evidence in the tiered poll. If terminal Hook delivery is missed, the poll may make one narrow,
content-free reconciliation request for one selected row: the newest turn through
`thread/turns/list`, descending, limit one, with `itemsView: notLoaded`. For an already-active row,
only a matching `completed`, `interrupted`, or `failed` turn with the exact active turn ID and a
persisted completion time may clear the active state; `inProgress`, missing-time, mismatched,
malformed, or unavailable evidence is a no-op. The completion remains unread.
The same request also repairs the opposite gap. A listener lifetime boundary leaves a task as
unread `discovery + unknown` with no active turn, and Codex never replays `UserPromptSubmit` for a
turn that started earlier. For such a row a latest `inProgress` turn with a real ID and a persisted
start time no later than the poll restores `working` under a distinct `app_server_turn` source,
compare-and-set against the exact selected candidate. A latest `completed`, `interrupted`, or
`failed` turn with a real ID and persisted completion time instead settles that exact candidate to
`idle`, `ended`, or `failed` while keeping it unread. ID-less, time-less, future-dated, malformed,
or unavailable evidence changes nothing.
A successful `Open` triggers that same single-thread sync on demand, best effort, after the deep
link succeeds and before final `markOpened`, so a newly settled terminal task is acknowledged in
one click while active or unresolved tasks retain attention. It also reclaims the other `unknown`
shape: when a persisted-active Hook row's authority is currently absent and App Server confirms the
same exact turn is `inProgress`, the row moves to `app_server_turn` while keeping its observed
runtime state and flags. `inProgress` stays a no-op whenever authority is present.
EyesOnAgents deliberately does not infer a paused state from private transcript/rollout formats or
elapsed time. A successful Open records deep-link evidence but acknowledges unread only for a
confirmed terminal row, so an active or `unknown` thread stays in Focus while it is open; a later
`UserPromptSubmit` supplies newer working evidence and keeps it there.

All SQLite timestamps are integers. The migration is idempotent and must pass the retained
multi-version migration audit before packaging.

## Installation and trust states

Local installation and Codex runtime trust are separate facts. `hooks/list` is the runtime source of
truth after the local definition check succeeds.

| local definition | `hooks/list` result | product state | action |
|---|---|---|---|
| missing | not inspected | `not_installed` | Enable |
| exact | all exact entries enabled and `trusted` or `managed` | `installed` | Check status / Remove |
| exact | any exact entry `untrusted` | `needs_trust: untrusted` | Settings → Hooks instruction / Check status / Remove |
| exact | any exact entry `modified` | `needs_trust: modified` | Settings → Hooks instruction / Check status / Remove |
| exact | any exact entry disabled | `needs_trust: disabled` | Settings → Hooks instruction / Check status / Remove |
| missing, duplicate, or definition mismatch | any | `drifted` | Repair / Check status / Remove |
| unsupported method, malformed response, warning, or transport failure | unavailable | `error` | Check status; retain last persisted board |

Codex 0.144.5 exposes only `managed`, `untrusted`, `trusted`, and `modified`; it has no durable
`denied` state. Choosing to continue without trusting leaves the definition `untrusted`, so the
external **Settings → Hooks** instruction remains visible until a later Check status confirms trust.

`installed` means the exact definitions are trusted. `listening` independently reports whether the
current Bitterless process can receive them. The UI must say **Installed, paused** when trusted but
not listening, never **Observing**.

## Settings list and recheck contract

```text
┌ Codex observation ───────────────────────────────────────────┐
│ Current state                           [Check status]       │
│ One status-specific sentence                                 │
│ Install Bitterless hooks                         [Enable]    │
│ Codex → Settings → Hooks                                   │
│ Turn on and trust SessionStart · UserPromptSubmit ·          │
│ PermissionRequest · Stop                                    │
│ Store latest user question                     [switch]     │
│ Remove Codex observation                       [Remove]     │
└──────────────────────────────────────────────────────────────┘
```

- The header always shows the aggregate state, one concise current-state sentence, and
  **Check status**. There is no nested guide, facts box, or bottom action cluster.
- Internal rows expose only operations Bitterless owns: Enable/Repair, the independent default-off
  latest-question Switch, and Remove. The external `Codex → Settings → Hooks` row has no button and
  names `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, and `Stop`; only Codex can enable
  and record trust for those definitions. CLI users may inspect the same state with `/hooks`.
- **Check status** performs a new `hooks/list`. If the long-lived App Server is connected it is
  reused. Otherwise Bitterless starts a short inspection connection, checks status, terminates it,
  and leaves the user's App Server auto-connect choice unchanged. When a durable coverage marker is
  present, the same explicit check performs the fenced cutover and preserved-suffix replay after
  trust is confirmed.
- Window activation performs the same Hook-trust recheck whenever observation is installed or
  awaiting review. There is no independent Hook polling timer. The single ten-second poll uses the
  separate parameter-free `refreshThreadPages()` operation. It never inspects Hook definitions,
  rewrites trust state, or performs full inventory discovery; explicit Disconnect prevents it from
  reconnecting when auto-connect intent is disabled.
- **Repair** is reserved for missing/drifted definitions. Check status never rewrites an exact
  definition merely to provoke a new trust prompt.

If `hooks/list` or `config/batchWrite` is unavailable in another Codex version, EyesOnAgents fails
closed, shows **Status unavailable** with **Check status**, and does not claim trusted observation.

## XPC surface

The XPC surface remains semantic and parameter-free. The settings list uses install, refresh, remove,
and question permission; the older review helper remains compatible but is not rendered as an
external-action button:

```text
getCodexBridgeStatus()
installCodexBridge()       # explicit Enable or Repair
reviewCodexBridge()        # safe re-enable + fixed Settings deep link
refreshCodexBridgeStatus() # fresh hooks/list, possibly with a short inspector
removeCodexBridge()        # explicit Disable only
```

No hook key, hash, command, path, URL, `config/batchWrite` payload, or arbitrary App Server method is
accepted from the renderer.

## Acceptance criteria

- Connecting and disconnecting App Server does not change `~/.codex/hooks.json`.
- An installed bridge starts listening after launch even when App Server auto-connect is disabled.
- Disabling observation works while App Server is connected and leaves that connection intact.
- Returning from Codex automatically changes `needs_trust` to `installed` after the user trusts the
  exact definitions, without reinstalling them.
- A disabled exact owned definition is safely re-enabled; untrusted or modified definitions still
  require the user to click Trust in Codex.
- Hook invocation never creates a Bitterless window or full Electron application process.
- Events emitted while Bitterless is closed replay after launch; a lost acknowledgement cannot
  duplicate a runtime transition across restart.
- Corrupt and overflowed outbox states fail visibly and invalidate live hook evidence.
- A trusted recheck recovers a durable coverage marker without deleting the valid post-cutover
  suffix; a failed or racing recovery retains truthful error state and remains retryable.
- Shutdown, sign-out/resume, Disconnect, Disable, and overlapping actions preserve their separate
  intent and write-drain fences.
- Core, bridge, App Server, repository, activation, UI-source, i18n, migration-audit, typecheck, and
  production-build verification run without launching Electron windows.
