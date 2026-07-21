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
overflow marker also invalidates live hook evidence so EyesOnAgents never presents incomplete
coverage as current. Receipt cleanup may remove old committed IDs only after no matching outbox file
remains.

All SQLite timestamps are integers. The migration is idempotent and must pass the retained
multi-version migration audit before packaging.

## Installation and trust states

Local installation and Codex runtime trust are separate facts. `hooks/list` is the runtime source of
truth after the local definition check succeeds.

| local definition | `hooks/list` result | product state | action |
|---|---|---|---|
| missing | not inspected | `not_installed` | Enable |
| exact | all exact entries enabled and `trusted` or `managed` | `installed` | Check status / Disable |
| exact | any exact entry `untrusted` | `needs_trust: untrusted` | Review in Codex / Check again / Disable |
| exact | any exact entry `modified` | `needs_trust: modified` | Review in Codex / Check again / Disable |
| exact | any exact entry disabled | `needs_trust: disabled` | Re-enable and review / Check again / Disable |
| missing, duplicate, or definition mismatch | any | `drifted` | Repair / Disable |
| unsupported method, malformed response, warning, or transport failure | unavailable | `error` | Check again; retain last persisted board |

Codex 0.144.5 exposes only `managed`, `untrusted`, `trusted`, and `modified`; it has no durable
`denied` state. Choosing to continue without trusting leaves the definition `untrusted`, so the same
review action remains available.

`installed` means the exact definitions are trusted. `listening` independently reports whether the
current Bitterless process can receive them. The UI must say **Installed, paused** when trusted but
not listening, never **Observing**.

## Review and recheck contract

```text
┌ Codex observation ────────────────────────────────────────────┐
│ Current state · actions remain state-specific                  │
│                                                              │
│ Codex observation setup                                     │
│ 1. Enable when absent; Repair only for definition drift.     │
│ 2. If review is requested, Trust only Codex-flagged items.   │
│    CLI users can enter /hooks.                               │
│ 3. Check again while pending; Check status after install.    │
│ 4. Optional question preview is separate and Off by default. │
│    Enabling stores one bounded local preview; Off clears it. │
│ Only Codex grants trust; Bitterless never bypasses review.   │
│                                                              │
│ [Review in Codex]  [Check again]                   [Disable]  │
└──────────────────────────────────────────────────────────────┘
```

- **Review in Codex** first obtains a fresh `hooks/list` result. For exact Bitterless-owned entries
  that are only disabled, it may set `enabled: true` with `config/batchWrite`, then rechecks. It
  never writes `trusted_hash` or any managed policy.
- The re-enable write uses only fresh, exact-match keys from `hooks/list`; those keys are private,
  position-dependent, and never persisted or exposed to the renderer.
- Review then opens the supported fixed deep link `codex://settings`. There is no supported Hook
  page deep link or trust RPC, so the UI truthfully instructs the user to select Settings → Hooks
  (or enter `/hooks` in the CLI). Bitterless never automates the Trust click.
- Whenever the connection drawer is open, it presents the complete conditional lifecycle: Enable
  only when absent or Repair drift, use Review in Codex and Trust only Codex-flagged items when
  review is requested, then Check again while pending or Check status after installation. A fourth
  step says the separate **Store latest user question** permission is off by default, retains one
  bounded local preview only, and clears previews when disabled; Hook trust never grants that
  permission, and replies/history remain prohibited. The same
  neutral guide remains visible for absent, drifted, review-needed, error, and installed states;
  action buttons still expose only valid current-state operations. A disabled Hook may retain trust
  and need only re-enabling. Reason-specific review text remains a separate amber live summary, and
  the guide explicitly says that only Codex can record trust.
- **Check again** performs a new `hooks/list`. If the long-lived App Server is connected it is
  reused. Otherwise Bitterless starts a short inspection connection, checks status, terminates it,
  and leaves the user's App Server auto-connect choice unchanged.
- Window activation performs the same Hook-trust recheck whenever observation is installed or
  awaiting review. There is no independent Hook polling timer. The single ten-second poll uses the
  separate parameter-free `refreshThreadPages()` operation. It never inspects Hook definitions,
  rewrites trust state, or performs full inventory discovery; explicit Disconnect prevents it from
  reconnecting when auto-connect intent is disabled.
- **Repair** is reserved for missing/drifted definitions. Review and Check never rewrite an exact
  definition merely to provoke a new trust prompt.

If `hooks/list` or `config/batchWrite` is unavailable in another Codex version, EyesOnAgents fails
closed, keeps the manual review instructions available, and does not claim trusted observation.

## XPC surface

Renderer actions stay semantic and parameter-free:

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
- Shutdown, sign-out/resume, Disconnect, Disable, and overlapping actions preserve their separate
  intent and write-drain fences.
- Core, bridge, App Server, repository, activation, UI-source, i18n, migration-audit, typecheck, and
  production-build verification run without launching Electron windows.
