---
id: acp-local-001
scope: Maestro local ACP server and client bridges
status: in-progress
depends-on: []
verify: strict types, socket and stdio integration, runtime wiring, independent review
---

## objective

Implement the complete local ACP integration described in the feature contract on codex/acp-local-socket. After independent verification, merge into the original checkout's attached branch release/2608, as Ral requested. After merging, sync Git upstream as requested; do not publish an application release.

## context

- docs/INDEX.md
- docs/features/local-acp.md
- docs/plan/README.md

## path

- Existing main-process app lifecycle, Maestro runtime/controller, permission and stream event boundaries
- New ACP server, types, host adapter, persistence and helpers
- Build entries, packaging and package manifests/lockfile
- Focused scripts/tests and docs/features/local-acp.md

## verification

All acceptance checks in docs/features/local-acp.md. Record exact commands and limitations below. Commit implementation before independent review.

## evidence

Pending.

Verification completed before independent review:

- `yarn typecheck:acp`: strict host, execution-context, lifecycle, transport, helper and core test types passed.
- `yarn test:acp`: 10 real socket/stdio/MCP tests plus native host integration passed. Native integration executes MaestroAgentService → MaestroAgent → BaseAgent and the existing SQLite DAO against an on-disk database. Only model/network output, Electron/XPC and the SQLite driver boundary are substituted. Tests cover exact-once reload hydration, session isolation, allow/deny tool effects, cancellation, GUI overlap, logout with pending permission, and provider/transport errors.
- `yarn build`: main, all preloads, all renderers and standalone Node ACP helpers passed.
- `node scripts/maestro/check-ai-crms-runtime.mjs`, `node --test scripts/auth/customer-authentication.test.mjs` (20 tests), `node scripts/startup/core-gated-startup.test.mjs`: passed.
- `node scripts/maestro/check-maestro.mjs`: blocked by 9 existing forbidden host-alias usages in unchanged window/renderer files. `check-agent-runtime.mjs`: existing test reads `@earendil-works/pi-ai/dist/providers/openai-completions.js`, which is absent from the project's pinned 0.80.10 package. Neither failure is caused by ACP source changes.

Dependency verification used a disposable Yarn environment with the existing package manifest except unused `node-llama-cpp` and packaging-only `electron-builder` omitted. Lifecycle/resource/signing hooks were ignored; required current-platform bundler binaries were installed. The tracked app dependency contract remains unchanged except new ACP/type/test/build dependencies. No credentials, live provider requests, signed installer, running GUI E2E or Windows pipe ACL checks were used. Windows inherits Node's native named-pipe security; macOS transport/security behavior is exercised by the tests.
