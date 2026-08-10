# BL Trench record schemas

All records are strict JSON objects. Unknown top-level or typed child fields are rejected. Flexible
provider facts belong only in an `evidence` or `result` object and must never contain credentials,
private material, local secret paths, or trade instructions.

## CA analysis

```json
{
  "schema": "bl-trench-ca-analysis-v1",
  "analysisId": "trench:2026-08-09T00:00:00.000Z",
  "contractAddress": "0x0000000000000000000000000000000000000001",
  "generatedAt": "2026-08-09T00:00:00.000Z",
  "source": {
    "kind": "agent",
    "agent": "codex",
    "skill": "bitterless-trench",
    "providers": ["gmgn-cli"]
  },
  "chains": [
    {
      "chain": "bsc",
      "token": { "name": "Synthetic Token", "symbol": "TEST" },
      "topProfitWallets": [
        {
          "address": "0x0000000000000000000000000000000000000002",
          "rank": 1,
          "profitUsd": 120.5,
          "winRate": 0.6,
          "evidence": { "provider": "gmgn-cli", "observed": true }
        }
      ],
      "indexWalletExposure": [
        {
          "address": "0x0000000000000000000000000000000000000003",
          "holding": null,
          "evidence": { "status": "unavailable", "reason": "provider query unavailable" }
        }
      ],
      "negativeWalletExposure": [],
      "result": { "status": "complete", "evidenceSource": "gmgn-cli" }
    }
  ]
}
```

Rules:

- `chain` is exactly `bsc`, `solana`, or `robinhood`.
- BSC and Robinhood use lowercase EVM identity (`0x` plus 40 hex digits) and may coexist as two
  chain blocks for the same CA. Solana uses one case-preserved base58 address and cannot coexist
  with an EVM chain block.
- `chains` contains one or two unique compatible blocks. `topProfitWallets` contains 0–100 unique
  wallets with contiguous ranks from 1. `winRate` is 0–1, not 0–100.
- `indexWalletExposure` and `negativeWalletExposure` each contain at most 1,000 unique wallets.
  `holding` is `true`, `false`, or `null`. Balance/share/value fields are legal only with `true`.
- `source.providers` lists only providers actually queried. It may be empty when research is
  unavailable; explain the reason in each affected chain's `result`.
- `source.agent` identifies the agent that actually performed the analysis. The `"codex"` value in
  the example is illustrative; a Claude Code caller records its own truthful identity instead of
  copying the example provenance.

## Negative Wallet tag

Do not construct the stored tag document. Call `trench.negative_wallet.put` with:

```json
{
  "requestId": "negative:2026-08-09T00:00:00.000Z",
  "chain": "robinhood",
  "address": "0x0000000000000000000000000000000000000004",
  "explanation": "The human-provided reason for this negative classification."
}
```

Bitterless Main owns `tagId`, `source`, `createdAt`, and `updatedAt`. The explanation is required,
trimmed, and capped at 2,000 Unicode code points. A new request ID intentionally corrects an
existing tag; reuse the same ID only for an exact retry.

## Negative Wallet holdings

```json
{
  "schema": "bl-trench-negative-wallet-holdings-v1",
  "analysisId": "holdings:2026-08-09T00:00:00.000Z",
  "chain": "robinhood",
  "address": "0x0000000000000000000000000000000000000004",
  "generatedAt": "2026-08-09T00:00:00.000Z",
  "holdings": [
    {
      "contractAddress": "0x0000000000000000000000000000000000000005",
      "symbol": "TEST",
      "balance": "10.5",
      "valueUsd": 25,
      "portfolioPercent": 12.5,
      "evidence": { "provider": "gmgn-cli", "observed": true }
    }
  ],
  "result": { "status": "complete", "evidenceSource": "gmgn-cli" }
}
```

Rules:

- The chain and canonical address must match an active Negative Wallet tag.
- `holdings` contains at most 1,000 unique asset identities. Omit an unavailable measurement rather
  than using a fake zero. Balances are nonnegative fixed-point decimal strings.
- A native asset may omit `contractAddress`; only one native entry is allowed.
- When the provider is unavailable, persist `holdings: []` only when a holdings attempt was
  requested, and put the precise status and reason in `result`.

All analysis/request IDs are 1–128 characters, begin with an alphanumeric character, and contain
only alphanumerics plus `.`, `_`, `:`, or `-`. Every timestamp is ISO-8601 and no more than five
minutes in the future.
