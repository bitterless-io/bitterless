---
id: eyes-on-agents-claude-profile-isolation-048
scope: isolate Claude marketplace, plugin, artifacts, and lifecycle ownership by Bitterless runtime profile
status: implemented; owner verification pending
depends-on: [eyes-on-agents-claude-setup-recovery-041]
---

# EyesOnAgents Claude Profile Isolation

## Objective

Allow packaged production and development/debug Bitterless profiles to install and manage their own
Claude observation plugin without a shared marketplace-name collision or an ineffective Repair
action. Preserve the released production identity while assigning every non-production runtime a
deterministic, disjoint Claude identity.

## Required behavior

- Derive one strict Claude bridge identity from the applied `ApplicationRuntimeProfileId` before
  constructing the bridge service.
- Preserve production compatibility:
  - marketplace: `bitterless-local`
  - plugin: `bitterless-observer`
  - artifact root: `eyes-on-agents/claude-marketplace`
- Isolate each non-production profile with its exact profile ID:
  - marketplace: `bitterless-local-<profile-id>`
  - plugin: `bitterless-observer-<profile-id>`
  - artifact root: `eyes-on-agents/claude-marketplace-<profile-id>`
- Use the derived marketplace name, plugin name, plugin ID, and artifact root consistently for CLI
  inspection, ownership/exclusivity checks, add/update/install/enable/uninstall/remove commands,
  generated marketplace/plugin manifests, owner marker validation, cache verification, Repair, and
  Remove.
- Fail fast for an unknown runtime profile. Renderer/XPC callers may not supply or override the
  identity.
- Do not adopt, overwrite, disable, uninstall, or remove another Bitterless profile's registration.
  A legacy unqualified registration owned by an older debug build remains an explicit one-time
  cleanup item instead of being guessed as production or debug ownership.
- Two profile plugins may be installed concurrently. Each helper keeps its profile-local endpoint,
  installation ID, and outbox. If both provider switches are enabled, both profiles intentionally
  observe the same Claude events; the unused profile should be switched off to prevent duplicate
  updates or alerts.
- Keep the existing connection UI, setup actions, provider switch, receipt proof, content-free Hook
  payload, and Codex behavior unchanged.

## Paths

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/plan/README.md`
- `src/main/environment/runtimeProfile.*`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/main/eyesOnAgents/claudePluginBridge.service.ts`
- focused Claude bridge tests

## Verification

- Focused identity tests cover all four runtime profiles and reject unknown values.
- Production keeps the released names and path byte-for-byte.
- Production and `production-debug` fixtures can both be listed, installed, enabled, repaired, and
  removed without either command targeting the other profile.
- A marketplace entry belonging to another profile is ignored rather than classified as a
  collision; a collision under the current profile name remains fail-closed.
- Generated manifests, owner markers, CLI arguments, and artifact paths contain only the current
  profile identity.
- Run the focused Claude test, `yarn test:eyes-on-agents:claude`, core typecheck, and
  `git diff --check`. Do not launch Electron; Ral owns packaged production reinitialization and the
  end-to-end Claude check.

## Implementation evidence

- `resolveClaudePluginBridgeIdentity` maps the four exact runtime profiles to one immutable bridge
  identity shape and throws for every unknown value. Production retains the released marketplace,
  plugin, plugin ID, and artifact path; non-production names include the complete profile ID.
- Main derives the identity from `getRuntimeProfile().id` before constructing
  `ClaudePluginBridgeService`. XPC and renderer calls have no identity input.
- Bridge inspection, namespace exclusivity, ownership markers, manifests, cache repair, every
  mutating Claude CLI argument, and artifact paths now use the derived identity. Registrations for
  other profiles remain outside the current namespace and are neither classified as collisions nor
  mutated.
- The focused bridge fixture installs production and `production-debug` concurrently, exercises
  inspection and Repair for both, verifies profile-exact manifests/owner markers/commands, and
  removes each without affecting the other. Existing same-name collision fixtures remain
  fail-closed.

## Verification evidence

- `node scripts/eyes-on-agents/claude-hook.test.mjs` — passed.
- `yarn test:eyes-on-agents:claude` — passed, including 6 Hook admission and 23 provider tests.
- `yarn typecheck:eyes-on-agents:core` — passed.
- `git diff --check` — passed.
- Electron was not launched. Packaged production reinitialization and end-to-end Claude receipt
  verification remain with Ral.
- Independent review accepted the non-Electron scope with no P1/P2 finding:
  [profile-isolation review](../reviews/eyes-on-agents-claude-profile-isolation-048-1.md).
