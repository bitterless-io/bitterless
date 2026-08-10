---
name: bitterless-trench
metadata:
  version_code: "260809005952"
description: >-
  Research and persist BL Trench CA analyses, derived Index Wallet evidence, and explicitly
  human-tagged Negative Wallet holdings for BSC, Solana, or Robinhood through the production
  `bitterless` MCP server. Use when the user asks to analyze a token contract address, save a
  source-backed multi-chain CA record, inspect the current positive/negative wallet dictionaries,
  tag a negative wallet with the user's reason, or refresh that wallet's separate holdings record.
  This skill is read-only toward providers, never trades, and never handles credentials or writes
  Bitterless files directly.
---

# Bitterless Trench

Use read-only research to build bounded evidence, then persist it only through the production
`bitterless` MCP server. Bitterless Main validates, canonicalizes, atomically writes, and rereads the
record. Never open or modify Bitterless `userData`, SQLite, or Trench JSON directly. Never substitute
a DEBUG MCP alias for real work.

## Keep the boundary strict

- Use only read-only provider skills such as `gmgn-token` and `gmgn-portfolio`. Never invoke swap,
  cooking, order, signing, launch, transfer, or wallet-control tools.
- Never request, read, paste, forward, log, or persist an API key, private key, cookie, credential
  file, Keychain item, or secret-bearing environment value. An already-configured provider may use
  its own local credential internally; if it is not ready, record the provider step as unavailable.
- Treat Robinhood addresses as EVM addresses: `0x` plus 40 hexadecimal digits. Preserve Solana
  base58 case. BSC and Robinhood may share one EVM CA record; Solana must remain a separate record.
- Keep unknown values unknown. An unavailable provider produces an explicit reason in `result`, not
  zeroes, invented wallets, or fabricated holdings.

## Analyze and store a CA

1. Resolve the requested chain and canonical address. For an EVM address, analyze BSC, Robinhood,
   or both only when the request/evidence supports those chains. Never infer Solana from EVM or vice
   versa.
2. Before provider research, read both dictionaries with `trench.index_wallet.list` and
   `trench.negative_wallet.list`, paging with `limit: 100` until `nextCursor` is null. Filter the
   returned rows by each analyzed chain. If a dictionary exceeds the record's 1,000-exposure bound,
   retain a deterministic bounded subset and disclose the omitted count in that chain's `result`.
3. Gather source-backed token/security/pool and profit evidence with installed read-only provider
   skills. Select no more than the top 100 profit wallets for each chain result. Ranks must be unique
   and contiguous from 1; addresses must be unique after canonicalization.
4. Check the current Index and Negative dictionary wallets against the CA. Emit one exposure row per
   checked wallet with `holding: true`, `false`, or `null`. Use `null` plus evidence/reason when the
   source cannot determine holdings; never attach balance/value measurements unless `holding` is
   `true`.
5. Build one `bl-trench-ca-analysis-v1` record. Put chain-specific evidence in each chain's `result`,
   list only providers actually queried in `source.providers`, and identify this skill as
   `source.skill: "bitterless-trench"`.
6. Call `trench.analysis.put`. Do not use `replaceNewer: true` unless the user explicitly authorizes
   replacing an equal/older current record after seeing the conflict.
7. Reread once with `trench.analysis.get`. Compare `analysisId`, canonical `contractAddress`, ordered
   chain identities, and `contentHash` from the put result with the get result. Claim persistence
   only after every field matches.
8. If a put times out or disconnects, call get before any retry. An exact same-ID/same-document retry
   may return `changed: false`; never generate a second ID merely because the first response was
   ambiguous.

Read [references/schemas.md](references/schemas.md) before constructing records and
[references/tools.md](references/tools.md) for exact tool behavior.

## Curate a Negative Wallet

1. Require the human's explicit chain, address, and nonblank explanation. Never infer a negative tag
   from performance, a provider label, or the agent's opinion.
2. Call `trench.negative_wallet.put` with a stable request ID, then reread with
   `trench.negative_wallet.get`. Compare the returned tag ID, canonical chain/address, explanation,
   and tag content hash before claiming the tag exists.
3. When holdings analysis is requested, run it as a separate read-only provider step after the live
   tag exists. Build `bl-trench-negative-wallet-holdings-v1`; if the provider is unavailable, use an
   empty `holdings` array and a precise unavailable reason in `result` rather than inventing assets.
4. Call `trench.negative_wallet_holdings.put`, reread with
   `trench.negative_wallet_holdings.get`, and compare analysis ID, chain/address, and byte content
   hash. Reread `trench.negative_wallet.get` once more to confirm the composite tag-plus-holdings
   state.

Archive only after an explicit human request. First get the current record, then pass its exact ID
and current content hash to the matching archive tool. V1 has no MCP restore.

## Recover setup or provider failures

If the production MCP server or skill is not installed, read
[references/mcp-setup.md](references/mcp-setup.md). If a provider is not already configured, keep the
provider-dependent result unavailable; do not enter a credential-setup flow from this skill.
