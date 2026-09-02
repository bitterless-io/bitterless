# EyesOnAgents iTerm2 Open

Status: Draft

Date: 2026-09-02

## Decision

Extend [EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md) with a second,
independent Open route for local Claude Code CLI sessions running inside iTerm2. Today a Claude row
without a matched Claude Desktop identity is Main-private and never renders a card
(`claudeProviderProjectionEnabled && thread.desktopSessionId !== null` in
`eyesOnAgents.service.ts` `getSnapshot()`). This delivery makes such a row visible once Bitterless
has captured its iTerm2 session identity, and adds an **Open in iTerm2** action that jumps straight
to that terminal pane. It does not change Desktop routing, Desktop matching, archive/delete
semantics, or any Codex behavior.

## Why iTerm2 first

iTerm2 registers a system URL scheme, `iterm2:///reveal?sessionid=<ITERM_SESSION_ID>`, that brings
the exact session to the front and gives it keyboard focus. The `sessionid` value is the verbatim
`ITERM_SESSION_ID` environment variable iTerm2 sets for every session (format `w0t0p0:<uuid>`). This
is opened with `shell.openExternal`, the same mechanism already used for
`claude://claude.ai/epitaxy/<desktopSessionId>` — no AppleScript, no Python API, no new OS
permission prompt (URL schemes route through LaunchServices, not the Automation/TCC scripting
bridge). WezTerm and Ghostty are out of scope for this delivery: WezTerm needs a child-process
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
  validated by the same `w\d+t\d+p\d+:<uuid>` shape used when building the deep link (see below), so
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
attempt to detect or resolve a reused session ID from a closed-and-reopened pane; a stale value
simply fails silently at Open time (the `iterm2:///reveal` URL opens iTerm2 but the OS reports no
error when the session ID no longer exists — see Acceptance).

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

## Open

Claude Open gains a second, independent route. The existing Desktop route is unchanged:

| Claude evidence | Open action |
|---|---|
| `desktopSessionId` present | existing **Open in Claude Desktop** (`claude://claude.ai/epitaxy/<desktopSessionId>`) — unchanged |
| `iterm2SessionId` present | new **Open in iTerm2** (`iterm2:///reveal?sessionid=<iterm2SessionId>`) |
| both present | both actions are offered; neither suppresses the other |
| neither present | no card (unchanged: Main-private inventory) |

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

export const buildEyesOnAgentsIterm2DeepLink = (
  iterm2SessionId: unknown
): string => {
  const parsed = parseEyesOnAgentsIterm2SessionId(iterm2SessionId);
  if (parsed === null) throw new Error('iTerm2 session ID is required');
  return `iterm2:///reveal?sessionid=${encodeURIComponent(parsed)}`;
};
```

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
`claude:` branch of `openThread` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:2230-2264`):
resolve the stored thread by `sessionKey`, require `provider === 'claude'`, require
`iterm2SessionId !== null` (else throw — the row would not have a card if it were null, but the XPC
boundary still validates), build the deep link, call `this.dependencies.openExternal(url)`, then run
the same `markOpened` / `notify()` sequence `openThread` runs today. It does not call
`syncOpenedThreadStatus` or any Codex-only path. It is a new method, not a new branch inside
`openThread`, so the existing `openThread` contract and its tests are untouched.

`src/shared/eyesOnAgents/eyesOnAgents.contract.ts`'s `parseEyesOnAgentsSessionKeyParams` is reused
unchanged as the XPC parameter shape for the new method (same `{ sessionKey }` shape as `openThread`
and `previewClaudeTranscript`).

## XPC surface addition

```text
EyesOnAgentsHandler (main)
  openThreadInIterm2({ sessionKey })
```

No existing XPC method signature changes. Renderer input is still limited to a validated
`sessionKey`; it never supplies a URL, session ID, or terminal app name.

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
- Detecting or repairing a stale `iterm2SessionId` after its pane closes. `iterm2:///reveal` is
  fire-and-forget; a stale ID simply does not bring anything to front, and Bitterless does not treat
  a failed reveal as an error (`shell.openExternal` success proves only that iTerm2's URL handler
  accepted the request, matching the existing Desktop-route caveat in
  [EyesOnAgents Claude Observation](eyes-on-agents-claude-observation.md#open-and-transcript-preview)).
- Re-deriving terminal identity for a session that started before this delivery shipped. A session
  already running when Bitterless upgrades has no `SessionStart` event to capture from and remains
  Main-private (or Desktop-only visible) until it is restarted.
- Any AppleScript, Python API, or `osascript` invocation. Every interaction is a `shell.openExternal`
  URL.

## Acceptance

- A Claude Code CLI session started inside iTerm2 becomes visible in Focus after its `SessionStart`
  Hook delivery commits, with no Claude Desktop matching required.
- A Claude Code CLI session started inside Terminal.app, a plain shell with no terminal emulator
  environment, or a `claude` invocation that predates this delivery's `SessionStart` gains no
  `iterm2SessionId` and remains subject to the existing Desktop-only visibility rule.
- **Open in iTerm2** is offered only when `iterm2SessionId` is non-null and never replaces or hides
  **Open in Claude Desktop** when both identities are present on the same row.
- Opening a row via **Open in iTerm2** never calls the Codex or Claude-Desktop deep-link builder, and
  opening a row via the existing Codex/Desktop Open path never reads `iterm2SessionId`.
- A malformed `ITERM_SESSION_ID` value (unexpected shape) is rejected at hook-payload parse time and
  produces a row with no terminal identity, not a thrown Hook delivery failure and not a broken deep
  link.
- An existing V1/V2 offline outbox delivery parses and commits exactly as it does today; no migration
  rewrites persisted deliveries.
- A restart of Bitterless (or of the SQLite connection) preserves every previously captured
  `iterm2_session_id` exactly like `desktop_session_id` — an event that does not carry a terminal
  identity never clears a previously stored one.
- Repository, migration audit, core, bridge, UI-source, typecheck, and production build checks run
  without launching Electron windows.
- Manual, non-automatable verification: with iTerm2 installed, start a `claude` session in a pane,
  confirm the row appears in Focus, click **Open in iTerm2**, and confirm iTerm2 brings that exact
  pane to the front with keyboard focus. This step cannot run in CI and is owner-verified only.

## Sources

- [Command Selection and Command URLs — iTerm2](https://iterm2.com/documentation-command-selection.html)
  (`iterm2:///reveal?sessionid=<id>` route and `ITERM_SESSION_ID` value contract).
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks).
