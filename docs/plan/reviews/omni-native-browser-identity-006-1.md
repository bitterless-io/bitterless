---
id: omni-native-browser-identity-006-1
status: pass
reviewed_task: omni-native-browser-identity-006
target: working-tree-2026-08-31
base: dev/next
date: 2026-08-31
review_type: independent-source-contract-build
---

# Findings

No P1, P2, or P3 blocking or non-blocking finding was identified in the reviewed scope.

# Contract Evidence

- The task and current feature contract require native Electron/Chromium identity in both
  persistent browser profiles, no Omni request-header identity mutation, and retention of the
  Google cookie partition and hostname-boundary routing
  (`docs/plan/tasks/omni-native-browser-identity-006.md:7-12,45-56`;
  `docs/features/omni-miniapp-cells.md:145-169`). The issue correction uses the same contract,
  explicitly avoids claiming that the shim was the proven cause of the ChatGPT rejection, and
  records the WhatsApp compatibility tradeoff
  (`docs/issues/browser-identity-inconsistent-across-embedded-views.md:5-28,172-183`).
- The implementation removes the Omni `Session` type import, the shim registration set, the entire
  `installChromeClientHintShim` request hook, and its browser-view installation call. The remaining
  browser factory obtains the selected persistent session and passes it directly into the new
  `WebContentsView`, with no replacement UA, UA-CH, JavaScript, or CDP identity mechanism
  (`src/main/windows/omniWindow.helper.ts:625-642`). A complete search of the Omni Main helper and
  remote-content preload found no remaining `onBeforeSendHeaders`, `Sec-CH-UA`, `setUserAgent`,
  `setUserAgentOverride`, `debugger.attach`, or `navigator.userAgent` identity path.
- Both persistent partitions remain declared and remain in the shared service-worker cleanup list
  (`src/main/windows/omniWindow.helper.ts:70-74,298-301`). The Google hostname resolver still uses
  exact-label or subdomain matching for `google.com`, `youtube.com`, and `youtu.be`, so lookalike
  hosts remain on the default profile (`src/main/windows/omniWindow.helper.ts:92-103`).
- URL entry still resolves the destination profile and recreates only the affected content view
  when the profile changes (`src/main/windows/omniWindow.helper.ts:558-575`). The replacement path
  creates the destination-profile view before loading the URL and updates the cell's profile while
  preserving the existing cell/layout object (`src/main/windows/omniWindow.helper.ts:1081-1124`).
  The task-scoped source diff does not alter cookies, permissions, cleanup, navigation, layout, or
  the separate Maestro capture-identity implementation.
- The new source regression test positively locks both partition constants, profile-to-partition
  selection, `session.fromPartition(partition)`, and the `webPreferences.session` binding. Its
  negative identity assertions are limited to the Omni Main helper and remote-content preload, so
  they do not reject the separate Maestro or DuckDuckGo identity implementations elsewhere in the
  repository (`tests/omni/omniLayoutLifecycle.test.mjs:566-589`). The `debugger.attach` token guard
  is conservative, but it is confined to the two task-owned Omni identity surfaces and does not
  create a material cross-module or maintenance restriction for this contract.
- The feature document, issue correction, legacy module note, documentation index, delivery index,
  historical task marker, and task 006 all describe the same current native-identity target. The
  older experimental history remains explicitly superseded rather than silently rewritten.

# Verification

| Check | Result |
|---|---|
| `yarn test:omni-layout` | pass — 12/12, including the new native-identity source contract |
| `yarn typecheck:node` | pass |
| `yarn build` | pass — Main, preload, and renderer bundles built; only existing Vite chunking warnings were emitted |
| `git diff --check` | pass for the complete current dirty worktree |
| task-scoped source and documentation audit | pass — removal is complete; both partitions and routing paths remain intact |
| Electron E2E | not run, as required; no Electron application was launched during review |

# Owner Acceptance

Ral retains the live acceptance because the static checks cannot establish whether ChatGPT accepts
the current proxy exit or embedded-browser risk profile:

1. Fully restart the delivered Bitterless build, open Omni, and perform a fresh top-level
   navigation to `https://chatgpt.com/` (including the restored-cell path if that reproduced the
   original failure).
2. Confirm that the site loads with the native identity. If the edge rejection remains, record the
   time, displayed Ray ID, and displayed exit IP without treating the failed result as proof of an
   identity or proxy root cause.
3. When attribution is needed, compare daily Chrome and Omni on the same exit, then retry Omni on an
   alternate exit. Google/YouTube sign-in is a separate regression check; WhatsApp may return to its
   documented “Chrome 100+” card.

# Conclusion

**Pass.** The contradictory global Omni UA-CH shim is fully removed without a replacement identity
override. Both persistent browser partitions, hostname routing, and profile-crossing view
replacement remain intact, the focused source test is appropriately scoped, and every required
non-E2E verification passed. Delivery remains subject only to Ral's live fresh-navigation
acceptance above.
