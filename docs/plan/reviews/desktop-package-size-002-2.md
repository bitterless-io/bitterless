---
id: desktop-package-size-002-2
target: 0560828ddec2bd6ddb5dc1ee9dcf8295d4324cfc
compared_with: desktop-package-size-002-1
---

# Verdict

**PASS. The P2 packaged-runtime dependency finding is closed.**

# Findings

No open P1, P2, or P3 finding was identified.

# P2 Closure

- `protobufjs` is now an explicit production dependency (`package.json:103-127`), independent of
  the unrelated Pi agent dependency tree. A clean build of commit `0560828` still emits the real
  top-level `require("protobufjs/minimal")` in `out/preload/connector.js:5566`, as expected.
- The package audit parses every `/out/main/**/*.js` and `/out/preload/**/*.js` entry inside the
  actual ASAR with Acorn (`scripts/package/desktopPackage.audit.cjs:126-227`). It derives package
  roots from literal `require`, static import/export, and dynamic import expressions; ignores
  comments, ordinary strings, relative paths, URL/scheme imports, Node built-ins, and Electron
  built-ins; and normalizes package subpaths to their root.
- Missing Main/Preload JavaScript, extraction failures, parse failures, and referenced package
  roots absent from ASAR all make the audit fail (`scripts/package/desktopPackage.audit.cjs:183-227,265-298`).
  The focused tests exercise comments/string false positives, built-ins and relative paths,
  static/dynamic subpath imports, present roots, and a missing-root failure
  (`scripts/package/desktopPackageAudit.test.mjs:67-169`).
- Direct inspection of the existing application found `protobufjs@7.5.4` in ASAR and the audit's
  derived external-root set includes `protobufjs`. Thus the generated Connector preload import and
  packaged runtime root agree.

# Verification

- `yarn test:desktop-package-audit` passed 9/9.
- A clean `git archive 0560828` build using the installed dependency tree passed `yarn build`.
  The shared working tree build first reached successful Main and Preload output, then failed only
  on an unrelated concurrent, uncommitted Translator renderer missing `App.vue`; no project files
  were reverted or changed for verification.
- `yarn test:sqlite-migrations` passed 11/11.
- Direct CLI audit of `dist/mac-arm64/Bitterless.app` passed: `app.asar` is 219,941,361 bytes
  (209.75 MiB) and the application is 571,155,210 bytes (544.70 MiB).
- The existing ASAR audit derived all expected external roots, including the lazy Pi agent,
  Playwright, `node-llama-cpp`, native SQLite, and `protobufjs`; none was missing.
- `git diff --check 24a3b77 0560828` and `git diff --check 0560828^ 0560828` passed.
- No signing, notarization, publication, upload, or CDN operation was run.

# Conclusion

**pass** — the previous blocking dependency declaration and false-positive contract-test gap are
fixed, and the desktop package-size task is ready for delivery.
