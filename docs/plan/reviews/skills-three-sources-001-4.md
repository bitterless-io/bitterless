# Skills A10 — independent export/request parity review

Date: 2026-09-16. Scope: only the new [requestParity.test.mjs](../../../tests/skillsThreeSources/requestParity.test.mjs), its exercised production call path, and the A10 evidence gap. No production/test code, branch, cloud, or deployment changes were made.

**PASS for the tested export/request boundary. No blocking finding.**

Independently executed from this repository:

```sh
node --test --test-timeout=15000 tests/skillsThreeSources/requestParity.test.mjs
```

Result: **1 test passed, 0 failed**, exit 0 (approximately 3.1 seconds). This review did not rerun the unrelated full build or claim the workers' combined 47-test result as an independently executed run.

The harness compiles complete production modules. The real `MaestroAgentService.copyNextTurnContext` builds and renders the export; the real `handleAgentTurn` registers its catalog provider before its existing idle-steering exit. Real `BaseAgent.init` and `PiRuntimeAdapter.createSession` install the request transform on a synthetic SDK session. The test invokes that installed transform, including its prior native transform. Neither the export method nor request formatter is extracted or replaced with a test implementation.

The assertions meaningfully check:

- A real Registry snapshot from **251 filesystem skills**, with three same-name skills across Global, Workspace and Institution and 251 distinct qualified references.
- Byte equality of every extracted historical/current catalog payload in export versus request; every current metadata entry is compared field-by-field with the real snapshot. Skill bodies remain absent.
- Updating one skill's metadata and supporting file changes its revision and the catalog revision in both paths while preserving its reference; exactly one catalog entry changes.
- Prior messages, including a historical catalog, remain byte-identical. The SDK session is created once and its chained transform executes twice, so the test cannot pass by silently resetting history.

Limitations: clipboard, authorization/cloud readiness, logs and the SDK shell are synthetic boundaries. The request evidence stops at the real Pi transform output; no provider network call, real SDK model loop, Electron IPC or installed desktop profile is exercised. This proves catalog parity for a prepared next input, not that a remote model already received it. The idle-steering branch is used only to install the production provider without sending. Ral's actual desktop `/view_context` review remains separate.
