# Maestro Workbench Settings has no dedicated Account tab

Status: implemented; owner verification pending

## Observed behavior

Workbench embeds the shared Bitterless Settings surface, but the signed-in email and Logout action
are buried inside `General`. That mixes account lifecycle controls with language, search, and menu
preferences, and makes the account entry difficult to discover from Workbench.

The underlying Home-shell bridge already owns customer identity and logout. This issue is about the
visible Settings information architecture and the post-logout window/tab outcome; it does not add a
second authentication authority.

## Required behavior

```text
┌──────────── Workbench → Settings ──────────────────────────────────────┐
│ Proxy         │                                                        │
│ General       │ Account                                                │
│ Account       │                                                        │
│ LLM           │ Email                                                  │
│ System Prompt │ signed-in@example.test                                 │
│ Notification  │                                                        │
│ Log           │ [Logout]                                               │
│ About         │                                                        │
└───────────────┴────────────────────────────────────────────────────────┘
                                      │ Logout
                                      ▼
                  Workbench closes → fixed Home becomes active → Login
```

- Add `Account` immediately after `General` in the shared Settings sidebar used by Workbench.
- Move the existing account email and Logout action out of General; do not leave two account
  surfaces.
- Display only the authenticated email supplied by the token-free Home-shell session summary. Do
  not expose a token, session ID, device ID, customer ID, or raw customer record.
- Keep the page flat and consistent with the existing Royal Blue Settings rhythm. Do not add a
  bordered account card or a new Workbench top-level pane.
- Account loading and bridge failure must have explicit, localized states. A failed identity read
  must not disable Logout, because clearing a possibly valid local session remains recoverable.
- Logout first lets the hidden Home authority clear its local session and publish signed-out state,
  then deactivates authenticated runtimes. Workbench must close, Maestro must remain/reappear, and
  the pinned fixed Home tab must be active on the Login surface. A stale last-active web tab or
  startup URL must not win this transition.
- Preserve the hidden Home renderer as the sole customer-auth authority and preserve the existing
  local Home fail-closed gate.

## Acceptance

- Workbench Settings shows a localized Account tab after General with the current signed-in email
  and a localized Logout action.
- General contains no account identity or Logout duplicate.
- Account loading, read failure/retry, and logout-in-progress states are visible and re-entry safe.
- Clicking Logout closes Workbench and leaves Maestro focused on pinned Home showing Login; Mini
  Apps and previously active web tabs are not shown first.
- Reopening Workbench after signing in again obtains the current email from Home rather than using
  renderer-local cached identity.
- Focused source/contract tests cover the Settings route, token-free account data, logout ordering,
  and fixed-Home post-logout selection. Ral performs Electron/runtime and visual E2E acceptance.

Implementation task:
[maestro-workbench-account-logout-097](../plan/tasks/maestro-workbench-account-logout-097.md).

## Resolution

- Added `Account` immediately after `General` in the shared Settings sidebar and moved the current
  email plus Logout into a dedicated flat Royal Blue surface with loading, retry, failure, and
  in-progress states.
- Kept the hidden Home bridge as the only customer-auth authority. Account reads only the current
  email and General no longer duplicates identity or logout state.
- Auth teardown now activates pinned Home and hides Workbench before destroying Maestro. A
  versioned one-boot intent survives failed replacement attempts, skips custom startup and stale
  last-active activation, then is consumed only after a successful forced-Home boot.
- Focused source tests passed 13/13, Node typecheck and the debug build passed, and
  [independent review 1](../plan/reviews/maestro-workbench-account-logout-097-1.md) found no
  unresolved P0-P2 issue. Electron/runtime visual E2E remains with Ral.
