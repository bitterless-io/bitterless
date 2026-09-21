# `INDEX_PROTOCOL_ERROR` names neither the rule nor the row

Status: implemented; code verified (BL `onlyPreviewFileSearchRelayProtocol.test.mjs` 19/19,
cowork `tests/unit/onlyPreviewFileSearchRelayProtocol.test.mjs` 19/19); owner testing pending.

Ral, 2026-09-21: 「The Project search index returned an invalid response. 检查日志，为啥会报错，
需要记住这种情况的原因，现在无法搜索文件了」. This is the second occurrence. The first
(2026-09-17) was disk exhaustion and is fixed under
[the index disk budget](../features/onlypreview-index-disk-budget.md); this one is not that, and the
log could not say what it was.

## What the log could and could not answer

The 2026-09-17 signature is unmistakable: `initialize-failure phase=rebuild sqliteCode=13/11` with
repeated `candidate-backup mode=backup`. The 2026-09-21 log has none of it — every preceding search
is `outcome=success`, there is no `sqliteCode` anywhere, and the failure lands around
`search-section-terminal count=250 truncated=true`. So the index was healthy and a **result batch**
was judged to violate the wire protocol.

Which rule judged it is unrecoverable from the log. `isOnlyPreviewGlobalSearchBatch` answers yes/no
over roughly fifteen rules — exact key sets, `parentRelativePath === parentOf(relativePath)`,
`name === basenameOf(relativePath)`, closed sets for `previewHint`/`nodeKind`/`mediaType`, snippet
bounds, a grapheme-counted highlight bound, per-section and total caps — and every `no` produced the
same sentence. Neither the rule, the section, nor the row index was recorded anywhere.

That is made much worse by the latch. `_latchProtocolFailure` stores the error on the active runtime
and `publish()` rethrows it before doing anything else, so **one rejected batch kills search for the
whole runtime until the app restarts** — a rebuilt index does not clear it. Every later error in the
log is an echo of the first.

## Two defects

1. **The diagnostic does not exist.** A class of failure that latches a subsystem reported one
   undifferentiated sentence. It was not that the log was missing; it was that nothing was ever
   written down to log.

2. **`Math.min(ONLY_PREVIEW_SEARCH_MAX_BATCH_RESULTS, matchingSearch.maxResults ?? 0)`.**
   `_expectationOf` records `maxResults: null` for any request whose value is absent or outside
   `[0, ONLY_PREVIEW_SEARCH_MAX_RESULTS]`, so an unknown per-search cap became a cap of **zero** and
   the first non-empty batch of such a search latched the runtime — for every other search too. The
   retired-request branch never had this, because `rememberExpectation` refuses a null `maxResults`
   outright. Whether this is what fired on 2026-09-21 is not established; it is a live path to the
   same symptom either way.

## Fix

`describeOnlyPreviewGlobalSearchBatchRejection` re-walks the same rules in the same order **only
after** a rejection, and returns a named reason — `contents[0] relativePath-shape`,
`files[1] duplicate-relativePath`, `files over-cap count=3 maximum=2`. `_latchProtocolFailure` writes
it once, on the first rejection, as
`[onlypreview-search] event=protocol-latched reason=…`; every later rejection is an echo of a latch
that already happened and logs nothing.

It re-walks rather than instruments the predicate on purpose: reporting from inside the predicate
means threading a channel through every `&&`, and the first edit that forgets to would silently
return to a bare `false` — the exact failure being fixed.

**The reason carries no path, name, or snippet text.** Not only for privacy: `onlypreview.log` goes
over the failure wire, which rejects any message containing a path separator, so a leaked path would
silently drop the whole diagnostic. Every field the reason echoes is producer-chosen, and the rule
failed *because* that field holds something unexpected — a result that misfiles a path into
`previewHint` would put it straight in the log. `echoValue` therefore echoes a string only when it
already looks like the short token the rule expected, and reports anything else as
`<string:14>` / `<object>`.

The cap now falls back to the wire's own per-batch cap: an unknown per-search cap is not evidence
that zero results are allowed. The terminal-response path still refuses an uncapped search — that
contract is unchanged, and the test pins it. What the fix removes is a malformed request taking the
runtime down before any result is seen.

## Verification

`tests/onlypreview/onlyPreviewFileSearchRelayProtocol.test.mjs` (cowork: `tests/unit/…`) pins the
reason string for eight distinct rules, that a non-batch rejection says `non-batch-event` rather
than naming a stale batch rule, that only the first rejection is reported, that an uncapped search
streams instead of latching — and, with a path deliberately planted in `previewHint`, `mediaType`,
`nodeKind` and an object key, that no reason ever contains a path separator.

Not covered: which rule actually fired on 2026-09-21. The index was deleted before this landed, so
that instance is unrecoverable; the diagnostic is what makes the next one answerable.
