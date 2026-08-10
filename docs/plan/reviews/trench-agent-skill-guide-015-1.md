# Review: trench-agent-skill-guide-015

## Reviewed code files

| # | File | Findings |
|---|---|---:|
| 1 | `src/main/mcp/trenchAgentOnboarding.service.ts` | 0 |
| 2 | `src/main/xpc/mcp.handler.ts` | 0 |
| 3 | `src/shared/trench/trenchAgentGuide.shared.ts` | 0 |
| 4 | `src/shared/trench/trenchAgentSkillVersion.shared.ts` | 0 |
| 5 | `src/renderer/coin/src/views/vault/trenchAgentGuide.client.ts` | 0 |
| 6 | `src/renderer/coin/src/views/vault/trenchAgentGuide.runtime.ts` | 0 |
| 7 | `src/renderer/coin/src/views/vault/trenchAgentGuide.store.ts` | 0 |
| 8 | `src/renderer/coin/src/views/vault/trenchAgentGuide.type.ts` | 0 |
| 9 | `src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue` | 0 |
| 10 | `src/renderer/coin/src/components/TrenchAgentGuideModal/TrenchAgentGuideModal.vue` | 0 |
| 11 | `tests/coin/trenchAgentGuide.test.mjs` | 0 |
| 12 | `tests/coin/specs/trench-vault.spec.ts` | 0 |
| 13 | `tests/coin/specs/trench-omni.spec.ts` | 1 |

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** `tests/coin/specs/trench-omni.spec.ts:1-921` is 921 lines, above the
  `code-review` TS-1 limit of 800. The task015 guide helper and three responsive invocations are
  behaviorally covered and passed, so this does not block delivery; extract the reusable guide and
  viewport helpers into a focused fixture/support module before adding another Omni scenario. This
  follow-up is recorded in `docs/plan/backlog.md`.

## Contract evidence

- Main owns the truthful payload. `src/main/xpc/mcp.handler.ts:28-47` resolves the current helper,
  current server identity, packaged/unpackaged skill path, bridge transport, and shared 12-digit
  version before returning the guide payload. `src/main/mcp/trenchAgentOnboarding.service.ts:9-15`
  defines the complete five-file bundle; lines 32-65 reject symlinked/non-directory parents and
  missing, empty, unreadable, non-regular, or symlinked files. Lines 37-43 select the real packaged
  `resourcesPath/agent-skills` or unpackaged `appPath/skills` directory.
- `electron-builder.tmp.yml:45-53` packages the whole `skills/bitterless-trench` tree.
  `scripts/package/desktopPackage.audit.cjs:201-218` validates the packaged directory and files, and
  `scripts/package/desktopPackageAudit.test.mjs:265-298` independently covers missing files plus file
  and directory symlinks.
- `src/main/mcp/trenchAgentOnboarding.service.ts:68-108` emits one ordered English three-step
  instruction. Production identifies real records; DEBUG retains the exact current name, calls it a
  test instance, forbids registering it as production `bitterless`, and forbids real Trench records.
  The payload includes the exact helper, config, full skill path, version, two install destinations,
  all 12 tools, and both invocation forms.
- `src/shared/trench/trenchAgentGuide.shared.ts:12-57` fails invalid/missing fields, unsupported
  transport, and renderer/Main version mismatch into an explicit restart-required state.
  `src/renderer/coin/src/views/vault/trenchAgentGuide.store.ts:40-88` provides generation-fenced
  loading/error/retry and copies only the four Main-returned strings: complete instruction, helper,
  config, and skill path.
- The shared header contains one stable native Robot action and one modal instance at
  `src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue:25-46`, so standalone and Omni use
  the same entry point. The modal exposes loading, retry, restart-required, visible DEBUG warning,
  three ordered sections, and four labeled copy actions at
  `src/renderer/coin/src/components/TrenchAgentGuideModal/TrenchAgentGuideModal.vue:21-156,198-234`.
- The guide path has no Keychain, `safeStorage`, provider credential, Trench repository, or record
  mutation dependency. `tests/coin/trenchAgentGuide.test.mjs:118-270` verifies non-secret output,
  DEBUG non-aliasing, invalid payload/version behavior, retry, four exact copy strings, and the
  guide-only dependency boundary.

## Accessibility, responsive, and mutation evidence

- The native Arco close is placed in keyboard order, receives focus after open, and returns focus to
  the Robot after close at `TrenchAgentGuideModal.vue:2-12,178-196`. Copy controls retain native
  button semantics, localized title/tooltip/accessible name, and polite status text at lines 198-231.
- The modal body is the bounded scroll owner with horizontal overflow suppressed at
  `TrenchAgentGuideModal.less:1-34`; long code/path content wraps internally at lines 190-205, narrow
  layouts remove the dependency-rail indent at lines 277-298, and the short-height modal/body bounds
  are reduced at lines 300-318.
- Standalone Electron compares all four operating-system clipboard values byte-for-byte with the
  live Main payload, retains one window/no child view, preserves record count, and asserts no denied
  network, unexpected mock request, `safeStorage` tripwire, or renderer error at
  `tests/coin/specs/trench-vault.spec.ts:507-570,590-593`.
- Omni focuses the trigger, native close, and all four copy controls, scrolls each action and the
  restart step into reach, limits document overflow to one pixel, preserves record count, closes the
  single modal, and proves focus return at `tests/coin/specs/trench-omni.spec.ts:364-470`. The same
  helper passed at 800x568, 398x568, and 800x282 at lines 643-648, 665-698, and 783-803.

## Verification evidence

- PASS: `node tests/coin/trenchAgentGuide.test.mjs` — 6/6.
- PASS: `node tests/coin/run-trench-unit.mjs` — 16/16.
- PASS: `node --test tests/omni/trenchOmniEmbedding.test.mjs` — 6/6.
- PASS: `node --test scripts/package/desktopPackageAudit.test.mjs` — 18/18.
- PASS: Trench Node, renderer, and strict E2E TypeScript checks.
- PASS: renderer i18n, task-scoped `git diff --check`/new-file whitespace scan, and task-scoped
  ESLint with zero errors. The first intentionally broad lint probe also selected the repository's
  legacy CommonJS package-audit script; its pre-existing incompatible lint rules were excluded from
  the task TS/Vue/test lint result rather than modifying unrelated code.
- PASS: fresh `yarn build` emitted `debug_dev`, `VITE_ENV=dev`, and `VITE_MODE=debug` output.
- PASS: standalone Trench Electron E2E 1/1 on exact display `DELL S2721QS` with `e2e: 1`,
  `packaged: false`, and `mockKeychain: true`.
- PASS: Omni Trench Electron E2E 1/1 on exact display `DELL S2721QS`.
- PASS: original-resolution inspection of
  `trench-agent-guide-1360x860.png`, `trench-agent-guide-800x600.png`,
  `trench-agent-guide-omni-800x568.png`, `trench-agent-guide-omni-398x568.png`, and
  `trench-agent-guide-omni-800x282.png`. The refreshed images show the title/native close, readable
  wrapped exact paths, complete three-step document, and modal-body scrollbar without document
  overflow or clipped required actions.

No Keychain, credential store, Ops secret, or secret-bearing file was read during verification. The
real Electron acceptance ran on macOS; Windows paths are statically covered but no Windows runtime
claim is made.

## Conclusion

**pass** — task015 has no blocking P1/P2 finding. The current-instance payload, complete skill
bundle, DEBUG safety, exact-copy boundary, shared standalone/Omni modal, retry/restart states,
keyboard focus, responsive scroll behavior, and no-mutation boundary are independently verified.
The sole P3 file-size debt is tracked for later decomposition.
