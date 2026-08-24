# Claude Subscription Accounts — Maestro Workbench Layout

Status: Accepted

## Subject, audience, and job

The subject is a **local Claude subscription route**: Codex enters through one loopback endpoint and
Maestro directs each request to one eligible, CLI-owned Claude account. The audience is the owner
operating several paid Claude accounts on one Mac. The page has one job: make that local route
understandable, selectable as Maestro's Local model provider, and repairable without revealing a
credential, browser partition, or filesystem path.

The feature lives in **Maestro Workbench → Configuration**. Maestro's authenticated Mini App card
is visible and its Open action focuses or creates the existing singleton Maestro window.

## Visual direction

The page reuses Maestro's restrained control-room surface, then spends its one distinctive gesture
on a **routing rail**: `Codex :8741` enters from the left and crosses one state node per account.
Every node encodes real routing state; it is not decoration. A node moves only while that account
has an active request, and `prefers-reduced-motion` converts that motion to a static ring.

Palette tokens stay inside the existing Workbench family:

| Token | Hex | Role |
|---|---:|---|
| Sheet | `#ffffff` | primary working surface |
| Grid | `#f6f8fb` | roster and quiet technical regions |
| Ink | `#111827` | primary identity and values |
| Relay blue | `#165dff` | selected route and primary action |
| Online green | `#10b981` | usable subscription account |
| Attention amber | `#d97706` | cooldown, reconnect, or capability attention |

Typography uses the existing macOS/system UI stack for labels and actions, a restrained 17px/600
section display for the selected account, and the existing `ui-monospace, SFMono-Regular, Menlo`
stack only for the loopback endpoint and machine state. No font dependency is added.

The first pass considered a generic heading plus a grid of account cards and summary counters. That
could represent any cloud-account settings page and would obscure the actual multi-account route.
The accepted direction removes dashboard counters, keeps one dense roster/detail workspace, and
uses the routing rail to explain the feature's specific behavior at a glance.

## Workbench structure

`Configuration` sits after `Models` and before `About`. The tab row may horizontally scroll at its
smallest supported width instead of shrinking labels into unreadable abbreviations.

```text
┌──────────────────────────── Maestro Workbench ─────────────────────────────┐
│ Capture Skills Integrations Injections Tools Models Configuration About Log│
├────────────────────────────────────────────────────────────────────────────┤
│ LOCAL CLAUDE ROUTE                                      [Add account]      │
│ Codex :8741 ──● Personal Max ──● Backup Pro ──○ Disabled                  │
│               usable           limited          excluded                   │
├───────────────────────┬────────────────────────────────────────────────────┤
│ ACCOUNTS              │ Personal Max                         [Enabled ▣]    │
│ ● Personal Max   MAX  │ ral@example.com · Max subscription                 │
│ ◐ Backup Pro     PRO  │ Ready for local Codex requests                     │
│ ○ Travel         OFF  │                                                    │
│                       │ [Test] [Reconnect] [Rename]              [Remove]   │
│ + Add account         │                                                    │
├───────────────────────┴────────────────────────────────────────────────────┤
│ LOCAL MODELS    Local · Claude Sonnet · high              [Configure model] │
│ CODEX HANDOFF   http://127.0.0.1:8741/v1   Ready      [Copy configuration] │
└────────────────────────────────────────────────────────────────────────────┘
```

At narrow widths the rail becomes a vertical route, the account roster stacks above detail, and
the endpoint wraps before its action. The view owns vertical scrolling; the Workbench shell does
not gain a page-level horizontal minimum.

## Information and action contract

- The routing rail shows only local label, routing status, active-request presence, and local
  cooldown. It never presents a quota percentage or claims Anthropic's remaining allowance.
- The account roster shows the local label, verified email when available, paid subscription type,
  and a semantic state: `Checking`, `Ready`, `In use`, `At limit`, `Reconnect`, or `Disabled`.
- Selecting a row opens its detail; selection does not alter routing priority.
- Detail actions are Test, Reconnect, Rename, Enable/Disable, and Remove. Remove requires a dialog
  naming the local label and returns focus to the invoking control on cancel.
- The Codex handoff strip exposes the fixed loopback URL, supported model aliases, server state,
  and Copy configuration. It never writes Codex files automatically.
- Local model configuration selects one accepted alias and effort for Maestro. The endpoint is
  fixed to Bitterless loopback and is not an editable arbitrary-provider URL. `Models` lists Local
  beside existing providers and opens this Configuration section when setup or repair is needed.
- Capability attention explains that this Claude CLI build cannot prove isolated credential
  storage; Add/Reconnect and routing stay disabled. No fallback to a shared CLI account is offered.

## Add and reconnect flow

```text
Add account → enter local label → Open Claude sign-in
                                      │
                                      ▼
                         isolated first-party BrowserWindow
                         email login / CAPTCHA / consent
                                      │ optional manual code
                                      ▼
                         CLI verifies paid Claude.ai account
                                      │
                                      ▼
                         roster selects the usable account
```

The progress region replaces the Add control while one authorization flow is active. It describes
what the owner must do next and offers only valid actions. Bitterless may show the official URL and
accept a manual authorization code for the unmodified CLI process, but it never reads, copies,
persists, or returns an OAuth/session token. The CLI exclusively owns its isolated Keychain item.

## Interaction contract

| Input | Scope | Behavior |
|---|---|---|
| `Enter` | Valid local-label form | Open Claude sign-in once |
| `Enter` | Non-empty manual-code field | Submit once to the exact active CLI flow |
| `Esc` | Label dialog | Close without creating an account |
| Cancel | Active flow | Terminate the exact PTY and close its isolated window |
| Enable switch | Selected account | Include/exclude it from new requests |
| Copy configuration | Codex handoff | Copy the profile template and announce bounded feedback |
| Remove confirm | Selected account | CLI logout, verify local credential removal, then clear owned metadata |

All interactive controls have a visible `:focus-visible` ring. Busy actions remain labelled and
disabled instead of disappearing. Status is never conveyed by color alone.

## State variants

| Region | State | Visible contract |
|---|---|---|
| Route | Ready | endpoint, usable account nodes, Add and Copy actions |
| Route | Attention | exact sanitized next step; never a false Ready state |
| Accounts | Loading | compact progress; no fake empty state |
| Accounts | Empty | “No Claude subscription accounts” plus Add account |
| Accounts | Error | sanitized failure and Retry/restart guidance |
| Account | Limited | local cooldown time; no allowance estimate |
| Authorization | Starting/browser/awaiting code/verifying | one exact progress message and valid controls |
| CLI isolation | Unsupported | account actions disabled with upgrade/review guidance |

## Component tree

```text
WorkbenchApp
└── WorkbenchConfigurationView
    ├── ClaudeRouteRail
    ├── ClaudeAccountRoster
    ├── ClaudeAccountDetail
    ├── ClaudeAuthorizationProgress
    ├── ClaudeLocalModelConfiguration
    └── ClaudeCodexHandoff
```

The implementation may keep these as semantic regions in one SFC while small. Structural and
repeated nodes use stable `name="claudeConfiguration__…"` attributes and
`workbench-claude-config__*` business BEM classes with a sibling Less file. Static inline styles,
Tailwind/utility classes, and credential-shaped renderer state are forbidden. Credentials, config
directories, secure-storage directories, partitions, authorization output, and token-shaped data
must never reach the DOM.

## Verification boundary

Source/store tests cover tab reachability, initial-snapshot versus live-event revision ordering,
every action fence, selection recovery, localized empty/error/progress states, destructive
confirmation, focus restoration, reduced motion, and absence of credential/path-shaped fields.
Electron E2E and live Claude login remain owner-only acceptance steps under the workspace rule.
