# Coding-agent Sessions Layout

Status: delivery contract

## Design principles

- This is an operational dashboard, not a transcript reader or chat client.
- Lead with sessions needing action, then active work, then idle/terminal history.
- Show the evidence source and freshness beside every runtime state; `unknown` is a first-class
  state, not an error placeholder.
- Use Bitterless Royal Blue for navigation and primary actions. Approval/input waits use amber,
  failure uses red, completed turns use green, and unknown remains neutral grey.
- Do not show prompts, transcript excerpts, tool inputs, or credentials.

## Overall structure

The page is a child route of the authenticated Bitterless Home layout and uses the existing 56px
sidebar. It owns the remaining viewport height and scrolls only its session list.

```text
┌────┬──────────────────────────── Coding Agents ────────────────────────────┐
│Home│ Coding Agents                              [Integrations] [Refresh]   │
│menu│ Observe and reopen local Codex and Claude work                        │
│    ├───────────────────────────────────────────────────────────────────────┤
│    │ [All 12] [Needs input 2] [Working 3] [Unknown 4]  [Provider: All ▾] │
│    │                                                       [+ Add session] │
│    ├───────────────────────────────────────────────────────────────────────┤
│    │ Codex   API pagination                         Waiting for approval   │
│    │ /repo/path · observed by Codex hook · just now                       │
│    │ Last turn: in progress                             [Open] [•••]      │
│    ├───────────────────────────────────────────────────────────────────────┤
│    │ Claude  background test repair                    Turn complete       │
│    │ /repo/path · Claude Agent View · 20s ago                            │
│    │ Last turn: completed                        [Attach] [•••]           │
│    └───────────────────────────────────────────────────────────────────────┘
```

## Header and filters

| Control | Behavior |
|---|---|
| Integrations | opens the status-bridge drawer |
| Refresh | runs provider capability/discovery refresh once; duplicate clicks are disabled |
| State chips | filter locally by all, needs input, working, or unknown |
| Provider select | all, Codex, or Claude |
| Add session | opens the registration dialog |

The header remains visible while rows scroll. A refresh retains existing rows and marks the page
busy; it never clears the list before provider responses arrive.

## Session row

Each row contains:

- provider and surface;
- user title, falling back to a shortened validated provider ID;
- working directory when known;
- runtime state plus last-turn state;
- status source and relative freshness;
- primary action: `Open`, `Attach`, or `Already open`;
- overflow actions: rename and remove.

`Already open` is disabled for a live foreground Claude CLI session because automatic second resume
could interleave transcript writes. Removal deletes only the Bitterless registry row; it does not
delete or stop the provider conversation.

## Registration dialog

```text
┌──────────────── Add session ────────────────┐
│ Provider     [Codex ▾]                      │
│ Surface      [Codex Desktop ▾]              │
│ Session ID   [xxxxxxxx-xxxx-....]            │
│ Title        [optional]                     │
│ Working dir  [optional absolute path]       │
│                         [Cancel] [Add]       │
└──────────────────────────────────────────────┘
```

- Provider controls the allowed surfaces.
- Session ID is required and validated before submission.
- Working directory is required only for inactive local Claude CLI resume.
- `Enter` submits when valid; `Esc` cancels; submitting disables duplicate actions.
- Provider validation errors stay inline and preserve all fields.

## Integration drawer

The drawer shows separate Codex and Claude rows:

```text
Provider   Discovery            Status bridge                  Action
Codex      Available 0.137.0    Not installed                  [Install]
Claude     Available 2.1.161    Installed                       [Remove]
```

Codex installation explains that the exact hook definition still requires trust review in Codex.
Claude installation explains that only lifecycle metadata is forwarded. Install/remove previews
the target settings path and never hides provider errors.

## State variants

| State | Visible behavior |
|---|---|
| Loading first list | compact skeleton rows; controls remain visible |
| Refreshing | existing rows retained; Refresh shows loading and is disabled |
| Empty | provider-neutral explanation plus `Refresh` and `Add session` actions |
| Provider unavailable | inline provider notice; manually registered rows remain available |
| Unknown status | grey `Unknown` label with last observation/source if any |
| Needs approval/input | amber label and row sorted before working/idle rows |
| Failed | red label, provider state, and retry/refresh action |
| Bridge drift | integration drawer shows `Repair`; no automatic settings overwrite |

## Responsive constraints

- Page root uses `height: 100%; min-height: 0; display: flex; flex-direction: column`.
- At 900px and above, rows use aligned columns.
- Below 900px, metadata and actions wrap below the title; no horizontal page scrollbar appears.
- At Bitterless minimum window size, the session list remains the sole vertical scroll owner and
  dialogs remain fully reachable.

## Component tree and entry points

```text
defaultRoutes.ts -> CodingAgentSessions.vue
  ├─ codingAgentSession.store.ts
  ├─ CodingAgentSessionRow.vue
  ├─ CodingAgentSessionDialog.vue
  └─ CodingAgentIntegrationDrawer.vue
        |
        v
codingAgentSession.emitter.ts -> CodingAgentSessionHandler (main)
```
