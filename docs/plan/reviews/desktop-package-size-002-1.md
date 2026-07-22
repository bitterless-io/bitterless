---
id: desktop-package-size-002-1
target: 24a3b77a3bed4a5ff22d3ccb0d62ce3005d3a322
---

# Verdict

**BLOCKED. One P2 blocking runtime-dependency finding remains.**

# Findings

1. **P2 · blocking — the bundled Feishu SDK leaves an undeclared external `protobufjs` runtime
   root.** The contract requires every package imported by built Main/Preload output to remain a
   production dependency (`docs/issues/desktop-package-includes-build-only-dependencies.md:25-31`;
   `docs/plan/tasks/desktop-package-size-002.md:25-31`). `@larksuiteoapi/node-sdk` is selected for
   bundling (`electron.vite.config.ts:34-48,122-141`) and is imported by the Connector preload
   (`src/preload/connector/feishu.handler.ts:4`), but a fresh `yarn build` leaves the real,
   top-level runtime statement `require("protobufjs/minimal")` in
   `out/preload/connector.js:5566`. `protobufjs` is absent from root production dependencies
   (`package.json:103-126`). The inspected app happens to contain it only through the unrelated
   production chain `@earendil-works/pi-coding-agent -> @earendil-works/pi-ai -> @google/genai`, so
   a future change to that chain can make Connector preload startup fail even though the Feishu
   code did not change. The dependency contract test does not detect this: it compares hard-coded
   expected arrays and config text without building or parsing the generated Main/Preload imports
   (`scripts/package/desktopPackageAudit.test.mjs:129-243`). Declare the generated external root as
   a production dependency or make Electron Vite bundle it, and make the contract check derive its
   assertion from built output so this failure cannot pass again.

No additional P1, P2, or P3 finding was identified.

# Verification

- `yarn test:desktop-package-audit` passed 7/7.
- `yarn build` passed. An Acorn AST scan of every generated Main/Preload JavaScript file confirmed
  that LangChain/LangSmith grep hits are comments or strings, not executable imports. All literal
  external imports and dynamic imports were accounted for except the `protobufjs/minimal` finding
  above; the lazy Pi agent, Playwright, `node-llama-cpp`, and native SQLite roots remain external.
- `@langchain/core@1.1.25` is the single installed version and satisfies the `^1.1.25` peer contract
  declared by both `@langchain/anthropic@1.3.18` and `@langchain/google-genai@2.1.19`.
- `yarn test:sqlite-migrations` passed 11/11.
- Direct CLI audit of `dist/mac-arm64/Bitterless.app` passed: `app.asar` is 205,876,006 bytes
  (196.34 MiB) and the application is 573,414,758 bytes (546.85 MiB).
- Direct ASAR inspection found zero banned `@micromeet/cli` entries, zero source maps, and zero
  `@langchain/core` or `langsmith` package trees. The compiled
  `Contents/Resources/maestro-tools/micromeet` resource exists as a real executable file. All 14
  bundle symlinks resolve inside the application.
- Electron Builder 26.0.12 calls the configured `afterPack` hook after extra resources are copied
  and before fuses and `signApp`; the template-generated macOS and Windows output paths resolve to
  the expected bundle layouts. The audit rejects symlink application roots and symlink ASAR files,
  uses `lstat` without following nested symlinks for deterministic size accounting, and throws on
  missing/ambiguous resources or any size/banned-root failure.
- `scripts/publish.js` audits after any requested build and before DMG finalization, notarization,
  artifact discovery/upload, and CDN refresh. A thrown audit error therefore stops publication.
- `git diff --check 24a3b77^ 24a3b77` passed.

# Conclusion

**blocked** — fix the undeclared generated `protobufjs/minimal` external and strengthen the
external-runtime contract check, then re-run the package audit, build, unsigned package, direct
ASAR audit, and SQLite release tests.
