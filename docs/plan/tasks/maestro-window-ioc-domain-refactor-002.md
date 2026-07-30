---
id: maestro-window-ioc-domain-refactor-002
scope: Maestro main-process domain-service split
status: implemented; owner verification pending
depends-on: [maestro-window-ioc-refactor-001]
verify: node typecheck + Maestro source guards + build + independent review + owner runtime smoke
---

# maestro-window-ioc-domain-refactor-002 - Split Maestro controller domains into IoC services

## Objective

Complete the Maestro main-process refactor by moving workspace, integration, capture, skill,
request-execution, and agent implementations out of `MaestroWindowController` into leaf IoC
services, following Micromeet Cowork's service boundaries while retaining Bitterless-specific state
machines and runtime behavior.

## Context

- `docs/features/maestro-window-ioc.md`
- `docs/plan/tasks/maestro-window-ioc-refactor-001.md`
- Reference:
  `projects/micromeet-cowork/apps/cowork/src/main`

Cowork is a structural reference, not a source replacement. Bitterless capture persistence, agent
hydration, channels, model defaults, skill APIs, and XPC contracts remain authoritative.

## Requirements

1. Add leaf services for workspace files, integration workflows, capture, skills, request execution,
   and Maestro agent/session orchestration.
2. Give every service a local narrow state interface, explicit `@inject` constructor parameters,
   one controller `setState(this)` call, and one entry in the shared `iocHelper.bind` registration.
   Services must not import the controller or bind themselves.
3. Move mutable domain state with its implementation. Preserve readonly controller-facing state
   where cross-domain callbacks need it, and reset service-owned window/session state during
   shutdown.
4. Extract pure trace, HAR, recorded-site row mapping, network exchange, skill-contract, prompt, and
   broadcast helpers where doing so makes service ownership clear. Pure helpers must not depend on
   Electron window lifecycle.
5. Keep top-level window/view lifecycle, layout, settings, one-shot LLM bootstrap, browser
   interception confirmation, and narrow XPC/tool facades on the controller.
6. Preserve the existing Bitterless capture state machine and persistence format. Do not substitute
   Cowork's incompatible capture-session writer/retention handshake.
7. Preserve XPC method names, parameter and return shapes, broadcast channels, agent context
   hydration, tool semantics, approval flow, capture target switching, and user-visible behavior.
8. Update all affected `scripts/maestro/check-*.mjs` guards to inspect the complete new source family
   with bounded assertions. No check may silently read a retired path or only one fragment of a moved
   invariant.
9. Reduce `MaestroWindowController` to coordination and facade responsibilities comparable to the
   Cowork reference; no extracted domain implementation may remain duplicated in the controller.

## Extraction order

1. Pure helpers and `WorkspaceFileService`.
2. Recorded-site helpers and `IntegrationService`.
3. Bitterless-native `CaptureService`.
4. `SkillService`.
5. `RequestExecService`.
6. `MaestroAgentService`, followed by controller and guard cleanup.

Each step must build before the next step moves code.

## Paths

- `src/main/maestro/windows/main/`
- `src/main/maestro/integration/`
- `src/main/maestro/capture/`
- `src/main/maestro/skills/`
- `src/main/maestro/drive/`
- `src/main/maestro/agent/`
- `scripts/maestro/check-*.mjs`
- `docs/features/maestro-window-ioc.md`

## Verification

- `yarn typecheck:node`
- strict node TypeScript check without `--noCheck` when memory permits
- `yarn check:maestro`
- `yarn build`
- `git diff --check`
- independent code review against this task, the first-stage task, and the Cowork reference
- owner manual runtime smoke after handoff
