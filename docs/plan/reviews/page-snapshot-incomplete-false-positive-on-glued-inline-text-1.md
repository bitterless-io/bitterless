# `# INCOMPLETE` glued-inline-text false positive — independent review 1

Date: 2026-09-23. Independent verifier; did not implement the change.

Contract: [issue](../../issues/page-snapshot-incomplete-false-positive-on-glued-inline-text.md)
(ISS-14), with the [text-transform precedent](../../issues/page-snapshot-incomplete-false-positive-on-text-transform.md)
(ISS-13) for the invariants. Paired with Cowork, which has its own
[review](../../../../micromeet-cowork/docs/plan/reviews/page-snapshot-incomplete-false-positive-on-glued-inline-text-1.md).

Other sessions have unrelated uncommitted edits in these files (the walker `epoch`, ISS-1..13), so this
fix was isolated by diffing the pre-edit copies taken just before it started against the live
files: `debuggerCapture.ts`, `scripts/maestro/check-snapshot-selects.mjs`, the Cowork inject file and
guard, and the pasteable copy `areas/agent-runtime/browser-use/fixed-walker-console.js`.

Conclusion: **pass**. No P1 or P2 findings and nothing blocking. There are four P3 findings, all
non-blocking; P3-1 is a three-line guard addition worth making before close.

## Findings

### P3-1 — the third whitespace site (`ariaHidden`) is not pinned by any assertion (non-blocking)

- Contract: issue #Fix item 1 names three sites: `captured`, each line's `key`, and the `aria-hidden`
  text. Code: `debuggerCapture.ts:1481` (Cowork `snapshotWalker.inject.ts:453`).
- Power test in a scratch mirror: reverting **only** line 1481 to `replace(/\s+/g, ' ')` leaves both
  guards green (exit 0). Neither guard can see it, because the only aria-hidden fixture in either one
  is the single token `G-SECRET` (`check-snapshot-selects.mjs:240/:253`).
- Real effect of that partial revert, measured in Chrome with the live BL walker: a modal over an
  `aria-hidden="true"` app root goes from **0 → 3** false positives (`"Order history"`,
  `"Order 1042 shipped on Monday"`, …). That is exactly the "alarm always rings" failure the
  self-check must avoid, and the page shape is very common.
- Suggested pin, already proven in a mirror: add
  `new FakeElement('div', { 'aria-hidden': 'true' }, [new FakeElement('p', {}, ['Order 1042 shipped'])])`
  to `gluedBody`, and append `\nOrder 1042 shipped` to its `innerText`. The existing
  `missingLines === 1` assertion then stays green on the live walker and goes red on the revert
  (`got 2: ["HomeUNREACHED-7","Order 1042 shipped"]`).
- Lower-value gaps of the same kind, for completeness. Each of these mutations also stays green:
  - `!== 'visible'` weakened to `=== 'hidden'`, which would stop skipping `visibility: collapse`.
  - Deleting `captured += values`, which contradicts the contract's "它仍参与比对" (values are still compared).
  - The ISS-13 invariants: the `< 3` floor moved from `line` to `key`, or dedup keyed on `line`.
    ISS-13 never pinned these, so the gap predates this fix.

### P3-2 — close-out docs lag the landed three-part fix (non-blocking, docs)

- The issue's #Confirmed cause opens with "有两处口径不一致" (two mismatches) but lists three. The third,
  form-control values, was found during the fix. The Cowork issue has the same wording.
- `docs/INDEX.md:57-62` still says "fix in progress" and summarises only fixes 1–2. It leaves out the
  values-after-names change and the `SearchGo` shape. Cowork `docs/INDEX.md:809` has the same gap.
- The issue calls itself ISS-14, but `areas/agent-runtime/browser-use/page-snapshot-closeout.md` has
  no ISS-14 entry yet. #Verification still reads "修复落地后补" (to be filled in after the fix lands).
- All of this is for the orchestrator's close-out. None of it is an implementation defect.

### P3-3 — the pasteable copy throws on common pages; pre-existing and out of scope (non-blocking)

- `fixed-walker-console.js:338` (`collapseWrappers`) references `COLLAPSE_INTO_ROLES`. That constant
  lives at module level in `debuggerCapture.ts:1715` and was never extracted into the copy.
- Pasting the copy on the ISS-4 construct page throws
  `ReferenceError: COLLAPSE_INTO_ROLES is not defined` before anything is printed. The pre-fix copy
  throws the same error, so this fix did not introduce it.
- `inline-fp.cjs` and the probe page never build an unnamed single-child wrapper, which is why it went
  unnoticed. The copy's stated purpose is pasting on the real billing page, where such wrappers are
  likely. Fix separately.

### P3-4 — note for Cowork only (non-blocking)

The Cowork direct-text pass has no inner `try`, whereas BL wraps it at `debuggerCapture.ts:1432-1444`.
Under linkedom, the new `getComputedStyle` line therefore aborts Cowork's self-check, and
`check:injected-scripts` now reports 15 linkedom-only swallows instead of 14. Chromium is unaffected.
The details are in the Cowork review. In BL the same line sits inside the pass's own `try`, so the
effect is contained.

### Checked and found correct

- **Comparison-only.** The only BL hunks are the self-check changes at lines 1414-1426, 1434-1437,
  1454-1462 and 1481. The walk and capture code is untouched, and every hunk in all five files is
  described by the contract; there are no concurrent-session edits among them. The BL and Cowork
  walker hunks are identical line for line once indentation is stripped (`diff` exit 0). The new
  guard blocks are identical apart from BL's pre-existing trailing blank line. The pasteable copy's
  self-check equals an esbuild compile of the live BL self-check (whitespace-normalised, `raw2`↔`raw`).
- **The three fixes match #Fix exactly.**
  - Whitespace is dropped for the comparison at three sites (`:1457` / `:1462` / `:1481`).
  - `missingSample` still quotes `line.raw` (`:1489`).
  - The direct-text pass skips `visibility !== 'visible'` (`:1437`).
  - Values collect in their own string and are appended after `soak` (`:1417-1426`).
- **Invariants unchanged:**
  - dedup is on the comparison `key`, and the `line.length < 3` floor is on the collapsed original line (`:1463`);
  - the 500-line cap (`:1466`) and the aria-hidden/`[hidden]` filter are kept;
  - so are the `truncated` early exit and the 500 KB early exit (`:1412`);
  - comparison uses `toLowerCase`, not `toLocaleLowerCase`.
- **`stripTs` needs no new rule.** The only new binding is `let values = ''`, which has no annotation,
  and the guard's vm run proves the stripped text parses.
- **Comments are accurate English** at the surrounding density. Each claim was confirmed in Chrome:
  - innerText adds no separator between adjacent inline elements;
  - it skips `visibility: hidden` text together with that block's line breaks;
  - it never renders input or textarea values.
- **The fakes model Chromium faithfully (Chrome 153.0.8010.54).**
  - The exact guard markup renders `"HomeAboutPricing"`, `"SaveCancel"`,
    `"Under modal buttonInvisible button"` (both glued and with the probe's source newlines) and `"SearchGo"`.
  - The whole `gluedBody`, with the gap row written as the realistic
    `<div><a>Home</a>UNREACHED-7</div>`, renders byte-for-byte the string the guard hard-codes.
  - On that DOM the live BL walker produces the same tree as the fake, and reports the same
    `missingLines=1 ["HomeUNREACHED-7"]`.
  - Real `querySelectorAll('[data-coach-ref]')` returns exactly the fake's order, with
    `ul/li/a` computed as `hidden` by inheritance.
- **Each new assertion can go red** (independent power test, scratch mirrors only):
  - Reverting fix 1 turns 5 assertions red. Reverting only its `captured` site gives 7 red (the ISS-13
    ones included); reverting only its `key` site gives 4.
  - Reverting fix 2 gives 2 red, and reverting fix 3 gives 2.
  - A 4-char-prefix over-loosening turns `HomeUNREACHED-7` red.
  - Leaking the key into the sample turns the verbatim assertion red.
  - Making the walk drop visibility:hidden elements, or stop recording input values, turns exactly
    the matching precondition red. That holds even with fix 2 also reverted, where the visibility
    assertion alone would pass for the wrong reason.

## Evidence re-run

All scratch runs lived under this session's scratchpad `verify/`. Both `package.json` files were
byte-identical before and after, and the sha256 of every reviewed file was unchanged at the end.

```text
# orchestrator harness, byte-identical copy run from verify/h (REAL=1 = live BL source,
# live Cowork inject file, git-HEAD walker + live self-check)
$ REAL=1 node harness.mjs current
  nav / buttons / CJK / uppercase / aria-label chevron, glued .... BL 0  CW 0  HEAD+ 0
  visibility:hidden block (probe c13/c16/c17) / inline span ...... BL 0  CW 0  HEAD+ 0
  label + filled input + button (with / without whitespace) ..... BL 0  CW 0  HEAD+ 0
  TRUE GAP mixed content ["Total due: $200.00"] ................. BL 1  CW 1  HEAD+ 1
  TRUE GAP svg ["SVG-ONLY-9"] ................................... BL 1  CW 1  HEAD+ 1
■ probe index.html (modal)
   BL current   missing=3   ["Aug","Sep","Total $200.00"]
   CW current   missing=3   ["Aug","Sep","Total $200.00"]
■ ISS-4 construct page
   BL current   missing=1   ["J-ROW-DEEP"]  [deepened]
   CW current   missing=1   ["J-ROW-DEEP"]  [deepened]
   HEAD+current missing=6   ["B-ROW","7/4/2026","SGD 275.23","B2-ROW","6/4/2026"]
```

Re-running the same harness on the pre-fix copies, including its `A` / `A1` / `A1V` variants,
reproduces every column of the issue's measurement table. It also shows that the live code gives
exactly the `A1V` results on all 23 pages. Figures are BL/CW/HEAD+:

| page | pre-fix | A | A1 | A1V = live |
| --- | --- | --- | --- | --- |
| nav / buttons / CJK / uppercase / chevron, glued | 1/1/1 | 0 | 0 | 0 |
| visibility:hidden block or span between | 1/1/1 | 1/1/1 | 0 | 0 |
| label + filled input + button | 1/1/1 | 1/1/1 | 1/1/1 | 0 |
| true gaps (svg, `Total due:`) | 1 | 1 | 1 | 1 |
| ISS-4 construct page | 1/1/6 | 1/1/6 | 1/1/6 | 1/1/6 |

```text
$ node areas/agent-runtime/tooling/browser_use/probe/inline-fp.cjs
inline, no whitespace (JSX-style): (no INCOMPLETE)
inline, with whitespace: (no INCOMPLETE)
flex, no whitespace: (no INCOMPLETE)
inline-block buttons, no whitespace: (no INCOMPLETE)
# (same probe against the pre-fix copy: "HomeAboutPricing" and "SaveCancel" reported)

$ node scripts/maestro/check-snapshot-selects.mjs        # cwd projects/bitterless
[check-snapshot-selects] ok
$ node scripts/maestro/check-snapshot-prune.mjs
[check-snapshot-prune] ok — 4 actionable refs preserved, 26366 bytes dropped
```

Cost of the visibility check, re-measured with the orchestrator's `perf.mjs` over 7,500 stamped
elements: 5.3–5.6 ms → 7.2–7.9 ms, so **+1.8–2.6 ms**, consistent with the issue's "+2 ms".

## Limits

- The BL typecheck was not re-run. `scripts/typecheck/surfaces.mjs` writes temporary
  `tsconfig.surface.*.json` files into the repo root, which is outside this review's read-only
  mandate. The develop agent's logs show no diagnostic in `debuggerCapture.ts`, and the change adds
  only an unannotated string `let` plus DOM calls that are already typed.
- No Electron E2E, app launch, packaging, `yarn build`, or live-site run was performed.
