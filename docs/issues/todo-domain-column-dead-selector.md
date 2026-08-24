# Todo Domain columns lose their equal-width contract when the rule selector is dead

Status: fixed; owner verification pending

Related: [Todo Domain board layout](../features/todo-layout.md),
[todo-detail-overlay-reveal-015](../plan/tasks/todo-detail-overlay-reveal-015.md)

## Report

Domain columns stopped honoring the 300–480px width contract: columns inside one row had different
widths, and the board packed two columns into the first row and three into the second. Expected
behavior is that a row holds as many equal-width columns as fit at the 300px basis, divides the row
width evenly between them, and wraps the rest to the next row.

## Confirmed cause

`src/renderer/todo/src/components/DomainColumn/DomainColumn.less` opened with `da.domain-column {`
instead of `.domain-column {`. That is valid CSS for a `<da>` element carrying the class, so it
matches nothing the renderer produces: the entire block — `min-width: 300px`, `max-width: 480px`,
`flex: 1 1 300px`, `display: flex`, `overflow: hidden`, and the Domain surface background — never
applied. Domain columns fell back to `flex: 0 1 auto` and sized to their own content, so each column
was as wide as its longest Todo title and each row fit a different number of them. `FocusedColumn`
kept its identical rule, which is why Focus stayed correct and only Domain columns misbehaved.

The regression net did not catch it. `scripts/todo/todo-column-layout.test.mjs` located rules with an
unanchored selector match, and `.domain-column {` is a substring of `da.domain-column {`, so the
dead rule satisfied every width, flex, and height assertion while the running UI had no rule at all.

## Fix contract

- Restore the `.domain-column` selector. The width, height, and flex contract in
  `docs/features/todo-layout.md` is unchanged — this was never a design change.
- Anchor CSS-rule lookup in the Todo column layout regression to the start of a line, so a selector
  that is merely a substring of a dead rule can no longer satisfy the contract.

## Acceptance

- In any row, every column has the same width, and every width is within 300–480px.
- Row packing is greedy at the 300px basis: a row holds as many columns as fit, divides its width
  evenly among them, and wraps the remainder to the next row.
- A prefixed or otherwise dead `.domain-column` / `.focused-column` rule fails the layout regression
  instead of passing it.

## Verification

- `node --test scripts/todo/todo-column-layout.test.mjs` — pass, 9/9, with the anchored matcher.
- Headless Chrome layout probe over the compiled Less at 800/1000/1280/1440/1700/2100px, detail panel
  closed and open, 1 Focus + 8 Domain columns: every row has one distinct width inside 300–480px,
  every column height stays within 80vh, per-row packing equals the greedy 300px-basis count, and
  wrapping is byte-identical with the panel open and closed. Example shapes — 1280px: `4×305`,
  `4×305`, `1×480`; 2100px: `6×336`, `3×480`.
- Direct probe of the old matcher confirms it accepted `da.domain-column { … }` as `.domain-column`
  and the anchored matcher rejects it.
- Electron E2E not run.
