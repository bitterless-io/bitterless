# EyesOnAgents Codex Observation

Status: implemented and independently verified

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
        | four metadata-only user hooks
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

The hook payload remains metadata-only. It may identify a thread, lifecycle transition, working
directory, and observation time; it never includes prompts, responses, tool payloads, diffs, or
transcripts.

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
2. The listener asks the SQLite repository to record the delivery receipt and apply the runtime
   event in one transaction.
3. Only after that transaction commits does the listener return `committed`.
4. A connection error, timeout, lost acknowledgement, or closed Bitterless process writes the same
   delivery ID and event as one atomic outbox file (`temporary file -> rename`).
5. Listener startup and each successful intake drain the outbox oldest-first. A replayed delivery
   already present in the receipt table is acknowledged without applying the event twice; its file
   is then deleted.

This covers the ambiguous case where SQLite commits but the acknowledgement is lost. Dedupe is
persistent across Bitterless restarts, not an in-memory set.

Outbox inputs are bounded by schema, file size, and file count. Invalid or corrupt files move to a
quarantine directory and surface a bounded observation error; an overflow marker also invalidates
live hook evidence so EyesOnAgents never presents incomplete coverage as current. Receipt cleanup
may remove old committed IDs only after no matching outbox file remains.

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
│ Needs review · hooks are installed but Codex has not trusted  │
│                                                              │
│ [Review in Codex]  [Check again]                   [Disable]  │
│ Open Codex Settings → Hooks and review Bitterless Hooks.      │
│ CLI users can enter /hooks.                                  │
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
- **Check again** performs a new `hooks/list`. If the long-lived App Server is connected it is
  reused. Otherwise Bitterless starts a short inspection connection, checks status, terminates it,
  and leaves the user's App Server auto-connect choice unchanged.
- Window activation performs the same recheck whenever observation is installed or awaiting
  review. It does not poll continuously or silently restore a deliberately disconnected App Server.
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
