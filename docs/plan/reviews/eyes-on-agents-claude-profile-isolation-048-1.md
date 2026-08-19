# EyesOnAgents Claude Profile Isolation — Independent Acceptance

Status: accepted for non-Electron scope; owner packaged reinitialization and Claude E2E pending

Date: 2026-08-18

## Verdict

**Implementation: PASS.** No open P1 or P2 finding blocks packaging. Production preserves the
released Claude identity, the three non-production profiles receive disjoint identities, and every
bridge mutation remains scoped to the identity derived by Main from the applied runtime profile.

The only findings are two non-blocking TS-1 file-size debts. They do not change the isolation
behavior or require task-scope expansion before Ral's packaged verification.

## File list

| # | File | Findings |
|---|---|---:|
| 1 | `src/main/eyesOnAgents/claudePluginBridge.service.ts` | 1 |
| 2 | `src/main/xpc/eyesOnAgents.handler.ts` | 0 |
| 3 | `scripts/eyes-on-agents/claude-hook.test.mjs` | 1 |
| 4 | `scripts/eyes-on-agents/claude-setup-recovery.test.mjs` | 0 |
| 5 | `docs/features/eyes-on-agents-claude-observation.md` | 0 |
| 6 | `docs/plan/tasks/eyes-on-agents-claude-profile-isolation-048.md` | 0 |

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:**
  - `src/main/eyesOnAgents/claudePluginBridge.service.ts:1-1015` · **TS-1** — the bridge service is
    1,015 lines, above the 800-line rule. HEAD was already 951 lines and this task grows it while
    keeping the isolation logic in one ownership boundary. Follow up by extracting identity and
    artifact-generation responsibilities without changing lifecycle ordering.
  - `scripts/eyes-on-agents/claude-hook.test.mjs:1-931` · **TS-1** — the focused fixture grew from
    789 to 931 lines and now exceeds the 800-line rule. Follow up by moving the profile-registry
    harness and coexistence cases into a dedicated focused test file.

No TS-2 finding was introduced. The reviewed implementation and fixtures use arrow functions where
the rule applies. FE-1 and FE-2 are not applicable, and the BE rule set is currently empty.

## Isolation matrix

| Case | Verified behavior | Result |
|---|---|---|
| Production legacy compatibility | `production` remains exactly `bitterless-local`, `bitterless-observer`, `bitterless-observer@bitterless-local`, and `eyes-on-agents/claude-marketplace` | PASS |
| Three non-production identities | `production-debug`, `test-debug`, and `test-release` each use their complete profile ID in marketplace, plugin, plugin ID, and artifact root | PASS |
| Unknown profile | Resolver throws before bridge construction; there is no fallback identity | PASS |
| Main-owned identity | XPC constructs the singleton from `getRuntimeProfile().id`; renderer calls expose no profile or bridge-identity parameter | PASS |
| Other-profile registration | Profile inspection filters only its exact marketplace/plugin namespace; the coexistence fixture lists both profiles and both remain installed | PASS |
| Current-profile collision | A same-name marketplace from a different source remains `collision`; install and remove stop before mutation | PASS |
| Dynamic CLI lifecycle | Marketplace update/add/remove and plugin install/uninstall/enable all use the derived current-profile identity | PASS |
| Dynamic artifacts | Artifact root, plugin root, marketplace manifest, plugin manifest, Hook paths, cache verification, and owner marker all use the derived identity | PASS |
| Repair isolation | Reinstall rotates only the current profile installation and never targets the other profile's plugin or marketplace | PASS |
| Remove isolation | Production removal preserves production-debug; debug lifecycle command history contains neither the production plugin ID nor production marketplace argument | PASS |
| Profile-local delivery | Endpoint, installation state, installation ID, and outbox remain under the profile-specific `userDataPath` | PASS |
| Concurrent installed state | Production and production-debug can both remain registered, installed, and enabled because names, cache namespaces, artifact roots, endpoints, and outboxes are disjoint | PASS |

## Legacy debug cleanup boundary

An older debug build's unqualified `bitterless-local` registration is intentionally not migrated or
deleted automatically:

- a new non-production profile ignores that unqualified registration and installs its own qualified
  identity;
- production treats an unqualified same-name registration from a different source as a current-name
  collision and fails closed;
- resolving that one-time legacy collision still requires explicit cleanup before production can
  install its released identity.

This boundary prevents the app from guessing whether an unqualified registration belongs to real
production or an older debug build. After cleanup, production and `Bitterless_DEBUG_PROD` can remain
installed together. If both provider switches are enabled, both intentionally receive the same
Claude Hook events, so only the profile actively being used should stay enabled to avoid duplicate
updates and alerts.

## Static evidence

- `claudePluginBridge.service.ts:93-117` exhaustively maps the four allowed profiles and throws in
  the default branch.
- `eyesOnAgents.handler.ts:113-116` derives the singleton identity from the already-applied Main
  runtime profile before constructing the bridge.
- `claudePluginBridge.service.ts:384-428` inspects only the exact current plugin and marketplace
  namespace while leaving other profile entries outside collision and drift calculations.
- `claudePluginBridge.service.ts:500-539,575-607` uses the identity for Repair/install/enable and
  Remove commands.
- `claudePluginBridge.service.ts:769-818,946-952` uses the identity for the owner marker,
  marketplace/plugin manifests, Hook tree, and ownership validation.
- `claude-hook.test.mjs:30-48,271-385` covers all identity mappings, unknown rejection, concurrent
  production plus production-debug installed state, Repair, dynamic manifests/owner marker, command
  isolation, and removal preservation.
- Existing collision, namespace-race, catalog-drift, cache-repair, and bounded-state fixtures still
  exercise the same fail-closed behavior through the preserved production identity.

## Independent verification

| Check | Result |
|---|---|
| `node scripts/eyes-on-agents/claude-hook.test.mjs` | PASS |
| `yarn test:eyes-on-agents:claude` | PASS — Hook admission 6/6 and combined provider suite 23/23, with every preceding Claude stage passing |
| `yarn typecheck:eyes-on-agents:core` | PASS |
| `git diff --check` | PASS |

No Electron process was launched. Ral owns the final packaged flow: explicitly remove the one-time
legacy unqualified debug registration, initialize production, initialize the newly qualified debug
profile if still needed, restart or reload Claude sessions, and verify each profile's first receipt.

## Conclusion

**PASS for the verified scope.** The implementation removes the permanent production/debug name
collision without adopting or deleting another profile's registration. Production and
`Bitterless_DEBUG_PROD` may both stay installed; the remaining owner action is legacy cleanup plus
packaged Claude receipt verification.
