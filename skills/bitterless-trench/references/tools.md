# BL Trench MCP tools

Use `structuredContent` for decisions and verification. The production MCP server name is
`bitterless`; all DEBUG aliases are test-only. List calls default to 50 rows, cap at 100, and return
`items`, `total`, `limit`, `nextCursor`, `revision`, and bounded `issues`. Continue with the returned
cursor. Restart the query after `CURSOR_STALE`.

## CA records and Index Wallets

| Tool | Arguments | Result |
|---|---|---|
| `trench.analysis.put` | `{ record, replaceNewer? }` | persisted parsed record, exact `document`, `contentHash`, `references`, `revision`, `changed` |
| `trench.analysis.list` | `{ query?, cursor?, limit? }` | bounded CA metadata page |
| `trench.analysis.get` | `{ contractAddress }` | parsed record, exact `document`, `contentHash`, current references, revision |
| `trench.analysis.archive` | `{ contractAddress, expectedAnalysisId, expectedContentHash }` | archived document and revision |
| `trench.index_wallet.list` | `{ query?, cursor?, limit? }` | derived wallet summaries plus projection hash |
| `trench.index_wallet.get` | `{ chain, address, cursor?, limit? }` | wallet summary and bounded source-CA provenance page |

Index Wallets are a deterministic projection of active CA `topProfitWallets`; they have no write
tool. Full flexible evidence remains in the source CA returned by `trench.analysis.get`.

## Negative Wallets and holdings

| Tool | Arguments | Result |
|---|---|---|
| `trench.negative_wallet.put` | `{ requestId, chain, address, explanation }` | persisted tag, optional holdings state, composite hash, revision, `changed` |
| `trench.negative_wallet.list` | `{ query?, cursor?, limit? }` | bounded tag metadata and holdings availability |
| `trench.negative_wallet.get` | `{ chain, address }` | exact tag document, optional holdings document, individual hashes, composite hash |
| `trench.negative_wallet_holdings.put` | `{ record, replaceNewer? }` | persisted holdings record/document/hash, composite hash, revision, `changed` |
| `trench.negative_wallet_holdings.get` | `{ chain, address }` | parsed holdings record, exact document, byte content hash |
| `trench.negative_wallet.archive` | `{ chain, address, expectedTagId, expectedContentHash }` | archived whole tag-plus-holdings directory and revision |

Holdings put requires a live Negative Wallet tag. Tag and holdings are separate documents; never
embed holdings into the explanation or treat a tag response as holdings evidence.

## Write and reread rules

- Same ID plus the exact canonical document is an idempotent success with `changed: false`.
- Same ID plus different content fails with `IDEMPOTENCY_CONFLICT`.
- A different ID must have a strictly newer generated time; equal/older writes fail with
  `STALE_WRITE` unless the human explicitly authorizes `replaceNewer: true`.
- Timestamps more than five minutes ahead of Bitterless Main fail with `FUTURE_TIMESTAMP`.
- Archive is compare-and-swap. A stale expected ID or hash fails with `CONFLICT` and moves nothing.
- A timeout is indeterminate. Reread the target before retrying.

After every successful mutation, call the matching get once. Compare the record ID, canonical
identity, relevant chain set, and returned content hash. For a Negative tag, compare the tag hash;
for holdings, compare the holdings byte hash and then confirm the Negative composite state. Do not
claim persistence based only on a successful put response.
