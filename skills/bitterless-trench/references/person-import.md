# Person-wallet import

This workflow converts a human-supplied local file; the production MCP never receives its path or
raw bytes. Keep the source read-only and choose the chain explicitly.

Create a fresh empty temporary directory, then run from the installed skill directory:

```bash
node scripts/convert-person-import.mjs \
  --input /absolute/path/to/source.json \
  --output /absolute/path/to/empty-temporary-directory \
  --chain bsc
```

Use `--chain solana` or `--chain robinhood` only when the human explicitly selected it. The source
must be strict UTF-8 JSON: one nonempty array whose elements contain exactly string fields
`address`, `rename`, and `emoji`. The converter trims and NFC-normalizes values, maps empty name or
emoji to null, canonicalizes the address for the explicit chain, rejects conflicting duplicate
addresses, sorts by canonical address, and emits at most 250 rows per chunk.

Stdout and `manifest.json` contain aggregates only. Generated `chunk-NNNNN.json` files contain exact
`trench.person.import` arguments and are sensitive working data: do not quote, log, summarize, or
persist them outside the temporary directory. Send them in numeric order, replay the exact final
chunk after completion, compare the aggregate receipt, then delete the whole temporary directory.

The converter generates stable UUIDv4-shaped IDs from the source/content hashes and chain. Running
it twice on identical bytes and explicit chain produces the same IDs, hashes, ordering, and chunks;
editing a generated chunk invalidates its hash and is forbidden.
