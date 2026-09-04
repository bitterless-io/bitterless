# EyesOnAgents iTerm2 Open

Status: Removed by
[eyes-on-agents-remove-iterm2-claude-097](../plan/tasks/eyes-on-agents-remove-iterm2-claude-097.md)

Date: 2026-09-02 (Open route corrected 2026-09-04 — see
[Open in iTerm2 does nothing](../issues/eyes-on-agents-open-in-iterm2-does-nothing.md))

## Removal decision (2026-09-04)

EyesOnAgents no longer exposes an iTerm2 product integration. Agent connections contains only
Codex and Claude; CLI-only `iterm2SessionId` no longer makes a row visible; Open-in-iTerm2, its
AppleScript transport/logging, and the macOS Automation entitlement are removed. Claude
multi-environment configuration remains supported under the Claude section because
`CLAUDE_CONFIG_DIR`, watcher isolation, and per-directory Hook installation are not terminal
features.

The nullable persisted identity and old Hook payload fields remain inert solely so upgrades and
queued deliveries stay readable. They authorize no UI, visibility, or action. The remaining text in
this document records the retired implementation and is not a current product contract.

## Historical design

Extend [EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md) with a second,
independent Open route for local Claude Code CLI sessions running inside iTerm2. Today a Claude row
without a matched Claude Desktop identity is Main-private and never renders a card
(`claudeProviderProjectionEnabled && thread.desktopSessionId !== null` in
`eyesOnAgents.service.ts` `getSnapshot()`). This delivery makes such a row visible once Bitterless
has captured its iTerm2 session identity, and adds an **Open in iTerm2** action that jumps straight
to that terminal pane. It does not change Desktop routing, Desktop matching, archive/delete
semantics, or any Codex behavior.

## Why iTerm2 first

iTerm2 is the only terminal in scope that gives a hook subprocess a per-pane identity *and* an
external way to bring that exact pane to the front. The identity is the `ITERM_SESSION_ID`
environment variable iTerm2 sets for every session (format `w{window}t{tab}p{pane}:<uuid>`); the
transport is AppleScript, which can address a specific window → tab → session by the session's own
id and `select` it.

**Correction (2026-09-04).** This section originally claimed a system URL scheme,
`iterm2:///reveal?sessionid=<ITERM_SESSION_ID>`, and chose it over AppleScript specifically to avoid
the macOS Automation permission prompt. That capability does not exist: the `iterm2:` scheme is
registered to iTerm2 and the URL is delivered, but no `/reveal` route acts on it — measured with both
the full `ITERM_SESSION_ID` and its bare UUID, neither changed the focused session. The iTerm2 doc
page it was designed from describes URLs iTerm2 generates for clickable commands inside its own UI,
not an external "reveal this session" capability. AppleScript is therefore the transport, and the
one-time Automation prompt is part of the flow rather than something this design avoids. See
[Open in iTerm2 does nothing](../issues/eyes-on-agents-open-in-iterm2-does-nothing.md) for the
measurements.

WezTerm and Ghostty are out of scope for this delivery: WezTerm needs a child-process
`wezterm cli activate-pane` call instead of a URL, and Ghostty has no per-pane environment variable
yet (tracked upstream as `ghostty-org/ghostty#10603`), so it cannot be identified reliably from a
hook subprocess.

## Identity capture

Bitterless cannot read iTerm2 session identity from any local file the way it reads Claude Desktop's
`claude-code-sessions` metadata — iTerm2 keeps no such disk record. The only place this identity is
observable is the hook subprocess itself, which inherits the shell environment of the pane that
started the Claude Code session.

`src/main/eyesOnAgents/claudeHookHelper.main.ts` → `claudeHookBridge.helper.ts` already runs as that
subprocess for every Hook event (`SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `Stop`,
`StopFailure`, `SessionEnd`). At `SessionStart` it now also reads `process.env.ITERM_SESSION_ID`. A
present, well-formed value is attached to the event payload; a missing or malformed value is treated
exactly like "not iTerm2" — the field is omitted, not defaulted to an invalid placeholder. No other
event carries this field: an already-open session's terminal identity cannot change mid-session, and
attaching it on every event would waste payload bytes without adding information.

## Hook payload schema (V3)

`src/shared/eyesOnAgents/claudeHookBridge.type.ts` gains a third payload version, following the same
event-conditional-optional-field precedent V2 used for `UserPromptSubmit.userPromptPreview`. V1 and
V2 deliveries already on disk (offline outbox) or already committed remain valid and are parsed
unchanged; nothing is migrated or rewritten.

```ts
type ClaudeHookTerminalFieldsAbsent = {
  terminalApp?: never;
  terminalSessionId?: never;
};

type ClaudeHookEventV3Payload =
  | (Omit<ClaudeHookEventV2Payload, 'hookEventName'> & {
      hookEventName: Exclude<ClaudeHookEventName, 'SessionStart'>;
    } & ClaudeHookTerminalFieldsAbsent)
  | (Omit<ClaudeHookEventV2Payload, 'hookEventName'> & {
      hookEventName: 'SessionStart';
    } & (
      | ClaudeHookTerminalFieldsAbsent
      | {
          terminalApp: 'iterm2';
          terminalSessionId: string;
        }
    ));

interface ClaudeHookEventV3 {
  schemaVersion: 3;
  eventId: string;
  occurredAt: number;
  payload: ClaudeHookEventV3Payload;
}

type ClaudeHookEvent = ClaudeHookEventV1 | ClaudeHookEventV2 | ClaudeHookEventV3;
```

- `terminalApp` is a closed enum with one member today (`'iterm2'`). WezTerm/Ghostty additions
  extend this enum later; they do not need a new schema version, only a new accepted value.
- `terminalSessionId` is the raw `ITERM_SESSION_ID` value (e.g. `w0t0p0:2EAAC309-9A33-4F6B-A579-E813C968DCF2`),
  validated by the same `w\d+t\d+p\d+:<uuid>` shape the Open route re-checks (see below), so
  a malformed environment variable is rejected at parse time and produces the field-absent shape, not
  a thrown parse failure — Hook observation must never block Claude Code.
- `createClaudeHookEventV3` (implemented as such) reads `process.env.ITERM_SESSION_ID` only when
  `hookEventName === 'SessionStart'` and `process.env.TERM_PROGRAM === 'iTerm.app'`, and never reads
  it for any other event. Unlike the V1→V2 rollout, which wrapped every event in the new envelope,
  `createClaudeHookEventV3` bumps `schemaVersion` to `3` only for a genuine `SessionStart` event; every
  other `hookEventName` delegates to the unchanged `createClaudeHookEventV2` and keeps emitting
  `schemaVersion: 2` exactly as before. This is deliberate, not an oversight: the Main service layer's
  `UserPromptSubmit` prompt-capture check (`event.schemaVersion === 2`, task-047/task-081-adjacent)
  only ever inspects `UserPromptSubmit` events, which never carry terminal identity, so leaving their
  wire shape at `schemaVersion: 2` avoids a silent, out-of-scope regression in "Store latest user
  question" capture while task 081 touches only the Hook payload contract and helper.
- `toMetadataOnlyClaudeHookDelivery` and the outbox quarantine/coverage paths carry `terminalApp` /
  `terminalSessionId` through unchanged — they are already content-free identifiers (not prompt or
  transcript content) and do not need stripping the way `userPromptPreview` does.

## Persisted identity

`eyes_on_agents_thread` gains one nullable column, parallel to `desktop_session_id`:

| column | meaning |
|---|---|
| `iterm2_session_id` | nullable validated `ITERM_SESSION_ID` value; used only for UI routing, exactly like `desktop_session_id` |

`upsertClaudeInventory` (`src/preload/sqlite/dao/eyesOnAgents.dao.ts`) already preserves
`desktop_session_id` when an incoming write omits it:
`thread.desktopSessionId ?? row?.desktop_session_id ?? null`. `iterm2SessionId` follows the identical
COALESCE-preserve rule: `thread.iterm2SessionId ?? row?.iterm2_session_id ?? null`. An incoming
`null` never clears an already-stored value; only a new non-null value can set or replace it. Unlike
`desktop_session_id`, there is no ambiguity/ownership-collision check to port — a given
`ITERM_SESSION_ID` is unique to one pane for the lifetime of that pane, and this delivery does not
attempt to detect or resolve a reused session ID from a closed-and-reopened pane. A stale value is
reported, not swallowed: the AppleScript walk finds no session with that id and Open surfaces a
`not_found` error ("That iTerm2 session is no longer open") without raising or launching iTerm2 —
see Open and Acceptance.

`commitClaudeHookDeliveryInternal` (`src/main/eyesOnAgents/eyesOnAgents.service.ts`) passes
`iterm2SessionId: payload.terminalApp === 'iterm2' ? payload.terminalSessionId : null` into the same
`upsertClaudeInventory` call that already sends `desktopSessionId: null` on every event. This is
still a per-event call with `desktopSessionId: null`, so the existing Desktop-identity preserve rule
is untouched; only the new column follows its own preserve rule independently.

## Visibility

`getSnapshot()`'s Claude projection filter changes from:

```ts
claudeProviderProjectionEnabled && thread.desktopSessionId !== null
```

to:

```ts
claudeProviderProjectionEnabled &&
  (thread.desktopSessionId !== null || thread.iterm2SessionId !== null)
```

This is the only visibility change. Every other Claude capability-boundary rule in
[EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md) — archive state (`unknown`
for CLI-only rows), delete tombstones, Focus/unread semantics, Agent View/Hook runtime precedence —
is unchanged and applies identically to a row made visible only by `iterm2SessionId`. A CLI-only row
with an iTerm2 identity still has `archiveState = "unknown"` and no archive/unarchive control; it
becomes visible for the same reason a Desktop-matched row is visible, not because CLI-only archive
semantics changed.

## Concurrent sessions

Running several Claude Code CLI sessions in different iTerm2 panes at the same time on one machine
needs no additional mechanism beyond what tasks 081/082/083 already built. Each identity path is
independently keyed:

- `payload.sessionId` (the Claude CLI session UUID) is the `thread_id`/`session_key` primary
  identity for every hook delivery — two concurrently running sessions have two distinct
  `sessionId`s and therefore two distinct rows from the first `SessionStart` delivery onward.
- `ITERM_SESSION_ID` is unique per pane for the lifetime of that pane (iTerm2's own contract), so two
  panes started at the same or different times never share a `terminalSessionId`.
- `upsertClaudeInventory`'s COALESCE-preserve rule operates per row (`WHERE thread_id = ?`); writing
  one session's `iterm2_session_id` never touches another session's row.
- `getSnapshot()`'s visibility filter and `openThreadInIterm2` both resolve by `sessionKey`, so
  Focus shows one card per concurrent session and each card's **Open in iTerm2** action opens only
  its own pane.

This delivery adds no new locking, batching, or session-count limit; N concurrent iTerm2 Claude
sessions produce N independent, correctly routable rows the same way N concurrent Claude Desktop
sessions already do — a direct consequence of the per-row design above, not a separately built
mechanism.

Configuring and observing **additional** `CLAUDE_CONFIG_DIR` environments (e.g. a `claude2`/`claude3`
setup) is a distinct, larger capability covered by
[EyesOnAgents Claude Multi-Environment](eyes-on-agents-claude-multi-environment.md), including the
Agent Connections guidance for it — that doc supersedes what was originally sketched here for that
purpose.

## Open

Claude Open gains a second, independent route. The existing Desktop route is unchanged:

| Claude evidence | Open action |
|---|---|
| `desktopSessionId` present | existing **Open in Claude Desktop** (`claude://claude.ai/epitaxy/<desktopSessionId>`) — unchanged |
| `iterm2SessionId` present | new **Open in iTerm2** (AppleScript `select` of the session whose id is the UUID half of `iterm2SessionId`) |
| both present | both actions are offered; neither suppresses the other |
| neither present | no card (unchanged: Main-private inventory) |

**Two identifiers, one stored value.** The stored `iterm2_session_id` is the verbatim
`ITERM_SESSION_ID` (`w{window}t{tab}p{pane}:<uuid>`) — that is what the hook subprocess observes and
it is captured faithfully. iTerm2's *own* session id, the value `id of session` returns and the only
value a `select` can be keyed on, is the **bare UUID** with no `w0t1p1:` prefix. The UUID is
therefore derived at Open time; nothing is re-captured, migrated, or rewritten.

`src/shared/eyesOnAgents/eyesOnAgents.contract.ts` gains:

```ts
export const parseEyesOnAgentsIterm2SessionId = (
  value: unknown
): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('iterm2SessionId must be a string');
  if (!CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN.test(value)) {
    throw new Error('iterm2SessionId must be a valid ITERM_SESSION_ID value');
  }
  return value;
};

// Returns null (never throws) so an unexpected stored value is an actionable, logged outcome.
export const extractEyesOnAgentsIterm2SessionUuid = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  if (!CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN.test(value)) return null;
  const uuid = value.slice(value.indexOf(':') + 1);
  return UUID_PATTERN.test(uuid) ? uuid.toLowerCase() : null;
};
```

There is deliberately **no** `buildEyesOnAgentsIterm2DeepLink`: a builder for a URL scheme that
accepts and ignores every request is a trap, and its absence is asserted by
`scripts/eyes-on-agents/claude-iterm2-open.test.mjs`.

### Transport: AppleScript, injected

`src/main/eyesOnAgents/iterm2Reveal.helper.ts` owns the transport and is injected into
`EyesOnAgentsService` as `revealIterm2Session(sessionUuid) => 'revealed' | 'not_found' | 'denied'`
from the composition root (`src/main/xpc/eyesOnAgents.handler.ts`), beside the existing
`openExternal`. Fixed properties of that implementation:

- `child_process.execFile('osascript', ['-e', script, uuid])` — no shell, ever.
- The session UUID is **never** interpolated into the script text. The script is `on run argv` and
  reads `item 1 of argv`; the UUID is re-validated against the strict UUID shape before the spawn,
  so nothing but a UUID can reach the process boundary.
- `application id "com.googlecode.iterm2" is running` is checked *before* any `tell`, because a bare
  `tell application …` launches the app. Nothing is launched, raised, or activated without a match.
- On a match: `select` window, `select` tab, `select` session, then `activate` iTerm2, and print
  `bitterless-iterm2-reveal:revealed`. With no match: print
  `bitterless-iterm2-reveal:not_found`. The caller parses the token; a stdout it does not recognize
  is a failure, not a success.
- The call is bounded: a 20s timeout (long enough to answer the Automation consent dialog, short
  enough that a wedged iTerm2 cannot pin an XPC call open past the 120s Apple Event default) and a
  4KB output cap.
- `-1743` / `errAEEventNotPermitted` in osascript's stderr is read as `denied` — a separate,
  separately actionable state from `not_found`. Any other failure surfaces the first line of
  osascript's own stderr, length-bounded, never the command line (which contains the whole script).

**Implementation note (task 082):** rather than a locally redefined `ITERM2_SESSION_ID_PATTERN`
constant, `parseEyesOnAgentsIterm2SessionId` imports and reuses task 081's exported
`CLAUDE_HOOK_ITERM2_SESSION_ID_PATTERN` from `claudeHookBridge.contract.ts` — that file's own comment
anticipates exactly this reuse. This makes `eyesOnAgents.contract.ts` and `claudeHookBridge.contract.ts`
mutually import from each other (each only inside function bodies, never at module top level), which
is a safe ESM cycle; `yarn typecheck:eyes-on-agents:core` and every bundled test confirm it resolves
cleanly. `EyesOnAgentsClaudeInventoryThread.iterm2SessionId` (in `eyesOnAgents.type.ts`) is declared
optional (`iterm2SessionId?: string | null`), unlike the required-but-nullable `desktopSessionId` on
the same interface, so `claudeObservation.service.ts`'s pre-existing Desktop/transcript inventory call
(which never carries a terminal identity) needed no change.

`eyesOnAgents.service.ts` gains `openThreadInIterm2({ sessionKey })`, structured like the existing
`claude:` branch of `openThread`: resolve the stored thread by `sessionKey`, require
`provider === 'claude'`, require `iterm2SessionId !== null` (else throw — the row would not have a
card if it were null, but the XPC boundary still validates), derive the session UUID, reveal it, and
only then run `markOpened` / `notify()`. It does not call `syncOpenedThreadStatus` or any Codex-only
path. It is a new method, not a new branch inside `openThread`, so the existing `openThread` contract
and its tests are untouched.

It returns `{ snapshot }`, **not** `{ url, snapshot }`: there is no deep link to hand back, and
returning a synthetic one is exactly how the original defect stayed invisible. Failure is the
rejection channel, with three distinguishable, actionable messages:

| condition | reported as |
|---|---|
| stored id yields no UUID | `The stored iTerm2 identity carries no session UUID` |
| no session with that id | `That iTerm2 session is no longer open` |
| Apple Event refused (-1743) | `macOS blocked Bitterless from controlling iTerm2. Allow it under System Settings > Privacy & Security > Automation, then try again` |

`markOpened` runs **only** on `revealed`. The replaced implementation marked opened unconditionally
after `openExternal` resolved, which is why a completely inert action reported success and left no
trace.

### Logging

`src/main/eyesOnAgents/claudeIterm2Log.helper.ts` logs every attempt and every outcome under the
`[claude-iterm2]` scope tag, matching the `[claude-bridge]` / `[claude-environment]` /
`[claude-watcher]` convention:

```text
[claude-iterm2] action=reveal stage=attempt id=claude:<sessionId> session=<uuid>
[claude-iterm2] action=reveal stage=revealed|not_found id=claude:<sessionId> session=<uuid>
[claude-iterm2] action=reveal stage=denied|failed id=claude:<sessionId> session=<uuid> error=<bounded>
```

`attempt` / `revealed` / `not_found` go to `info`; `denied` / `failed` to `error`. Identification is
by session id only — never a `cwd`, transcript path, or `configDirectory` — and error text is
sanitized and capped at 300 characters. The absence of any line here is the reason a non-functional
Open action was invisible in `main.log`; the line shape is asserted by the test suite.

### Packaging prerequisites

`hardenedRuntime: true` means a signed build must carry both halves of the Apple Events permission
or the OS refuses the event before iTerm2 ever sees it:

- `build/entitlements.mac.plist` → `com.apple.security.automation.apple-events`.
- `electron-builder.tmp.yml` → `mac.extendInfo.NSAppleEventsUsageDescription` (without the usage
  string macOS refuses silently instead of prompting), and an explicit `mac.entitlements` pointing at
  the same plist as `entitlementsInherit`.

Consequence for the owner: the **first** Open in iTerm2 from a freshly packaged build raises the
one-time macOS "Bitterless wants to control iTerm2" prompt, which must be allowed. A build that
predates these keys reports `denied` and cannot be fixed from inside the app.

`src/shared/eyesOnAgents/eyesOnAgents.contract.ts`'s `parseEyesOnAgentsSessionKeyParams` is reused
unchanged as the XPC parameter shape for the new method (same `{ sessionKey }` shape as `openThread`
and `previewClaudeTranscript`).

## XPC surface addition

```text
EyesOnAgentsHandler (main)
  openThreadInIterm2({ sessionKey })
```

No existing XPC method signature changes; `openThreadInIterm2` itself returns `{ snapshot }` (see
*Open*). Renderer input is still limited to a validated `sessionKey`; it never supplies a URL,
session ID, or terminal app name.

## Renderer

`ThreadCard.vue` gains an independent action, not a change to the existing primary Open button:

- `canOpenThread` (line 174-175) and `openLabel` (line 190-192) are unchanged — they still govern
  only the existing single-target Codex/Desktop-Claude Open button.
- A new computed `canOpenInIterm2 = props.thread.iterm2SessionId !== null` controls a new dropdown
  action (alongside the existing **Copy session path** / read-state toggle entries in the
  `a-dropdown` at line 59) with a new i18n label `eyesOnAgents.actions.openInIterm2`
  ("Open in iTerm2" / "在 iTerm2 中打开", added to both `en.ts` and `zh.ts`).
- A new `handleOpenInIterm2` calls a new store method
  `eyesOnAgentsStore.openThreadInIterm2(props.thread.sessionKey)`, mirroring the existing
  `handleOpen` / `openThread` pair in both the component and
  `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`.
- A CLI-only row (no `desktopSessionId`) still renders its card — that visibility comes from the
  `getSnapshot()` filter change above — but `canOpenThread` stays `false` for it (provider `claude`,
  `desktopSessionId === null`), so the primary Open button/enter-key/double-click path stays hidden
  for that row exactly as it does today; only the new dropdown action is available.

## Non-goals

- WezTerm and Ghostty support (see *Why iTerm2 first*).
- *Repairing* a stale `iterm2SessionId` after its pane closes. A stale id is detected and reported
  (`not_found`), because the AppleScript walk observes iTerm2 rather than firing and forgetting, but
  the row keeps its stored identity and nothing re-derives a new pane for it. This is stricter than
  the Desktop-route caveat in
  [EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md#open-and-transcript-preview),
  where `shell.openExternal` success proves only that the URL handler accepted the request.
- Re-deriving terminal identity for a session that started before this delivery shipped. A session
  already running when Bitterless upgrades has no `SessionStart` event to capture from and remains
  Main-private (or Desktop-only visible) until it is restarted.
- The iTerm2 Python API, and any AppleScript beyond the single session-`select` script above. No
  other Apple Event is sent, and no other application is scripted.

## Acceptance

- A Claude Code CLI session started inside iTerm2 becomes visible in Focus after its `SessionStart`
  Hook delivery commits, with no Claude Desktop matching required.
- A Claude Code CLI session started inside Terminal.app, a plain shell with no terminal emulator
  environment, or a `claude` invocation that predates this delivery's `SessionStart` gains no
  `iterm2SessionId` and remains subject to the existing Desktop-only visibility rule.
- **Open in iTerm2** is offered only when `iterm2SessionId` is non-null and never replaces or hides
  **Open in Claude Desktop** when both identities are present on the same row.
- Opening a row via **Open in iTerm2** never calls the Codex or Claude-Desktop deep-link builder,
  never opens a URL through the shell, and opening a row via the existing Codex/Desktop Open path
  never reads `iterm2SessionId`.
- A malformed `ITERM_SESSION_ID` value (unexpected shape) is rejected at hook-payload parse time and
  produces a row with no terminal identity, not a thrown Hook delivery failure.
- **Open in iTerm2** marks the thread opened only when iTerm2 actually revealed the session. A
  `not_found`, a `denied` Apple Event, and an osascript failure each leave the row's read/opened
  state untouched and surface a distinct error.
- The session UUID reaches `osascript` as a process argument; the script text never contains it, and
  a value that is not a strict UUID never reaches a spawn.
- An existing V1/V2 offline outbox delivery parses and commits exactly as it does today; no migration
  rewrites persisted deliveries.
- A restart of Bitterless (or of the SQLite connection) preserves every previously captured
  `iterm2_session_id` exactly like `desktop_session_id` — an event that does not carry a terminal
  identity never clears a previously stored one.
- Repository, migration audit, core, bridge, UI-source, typecheck, and production build checks run
  without launching Electron windows.
- Manual, non-automatable verification, from a **freshly packaged build** carrying the Apple Events
  entitlement and usage description: with iTerm2 installed, start a `claude` session in a pane,
  confirm the row appears in Focus, click **Open in iTerm2**, allow the one-time macOS Automation
  prompt, and confirm iTerm2 brings that exact pane to the front with keyboard focus. Then close the
  pane and click **Open in iTerm2** again to confirm the `not_found` error instead of a silent
  success. This step cannot run in CI and is owner-verified only.

## Sources

- [Command Selection and Command URLs — iTerm2](https://iterm2.com/documentation-command-selection.html)
  — the `ITERM_SESSION_ID` value contract. **Not** a source for an external reveal capability: the
  `iterm2:` URLs it documents are the ones iTerm2 generates for clickable commands inside its own UI,
  and reading them as a "reveal this session" route is what produced this feature's original defect.
- [Open in iTerm2 does nothing](../issues/eyes-on-agents-open-in-iterm2-does-nothing.md) — the
  measurements against a running iTerm2: the URL scheme is inert with either identifier, `id of
  session` returns the bare UUID, and the AppleScript `select` walk moves focus.
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks).
