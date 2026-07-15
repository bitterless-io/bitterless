# GMGN CLI Setup Guide

Last verified: 2026-07-15 (`gmgn-cli` `1.5.2`)

This guide configures GMGN as a **read-only local research source** for Bitterless Coin. Do not
configure swap, order, cooking, wallet signing, or `GMGN_PRIVATE_KEY`.

Official references:

- [GMGN Agent Skills and Quick Start](https://github.com/GMGNAI/gmgn-skills)
- [GMGN CLI command reference](https://github.com/GMGNAI/gmgn-skills/blob/main/docs/cli-usage.md)
- [GMGN personal API key page](https://gmgn.ai/ai)

The official project often shows npm/npx commands. This workspace uses Yarn, so use the Yarn
equivalents below.

## 1. Prerequisites

- Node.js 18 or newer.
- Yarn available in the current shell.
- A browser session that can sign in to GMGN.
- A personal GMGN API key. The public demo key is only an installation smoke test and must never be
  saved as the production/personal key.

Check the local tools:

```bash
node --version
yarn --version
```

## 2. Install or upgrade

Install globally:

```bash
yarn global add gmgn-cli
gmgn-cli --version
```

Upgrade later:

```bash
yarn global add gmgn-cli@latest
gmgn-cli --version
```

If the binary is not found after installation, inspect Yarn's global binary directory and add it to
the shell `PATH`:

```bash
yarn global bin
```

Coin's Resources page detects the executable and version but does not silently install a global
package. Use **Copy install command**, run it in a terminal, then choose **Recheck**.

## 3. Create the personal API key

GMGN's current agent setup asks for an Ed25519 public key when creating a personal API key. Generate
the request key on the local machine:

```bash
mkdir -p ~/.config/gmgn
chmod 700 ~/.config/gmgn
openssl genpkey -algorithm ed25519 -out ~/.config/gmgn/api-key-request-ed25519.pem
chmod 600 ~/.config/gmgn/api-key-request-ed25519.pem
openssl pkey -in ~/.config/gmgn/api-key-request-ed25519.pem -pubout
```

1. Open [gmgn.ai/ai](https://gmgn.ai/ai).
2. Paste only the printed public key into the API key creation form.
3. Create and copy the personal API key.
4. In Coin → Resources → GMGN CLI, choose **Configure API key**, paste the API key, and save.

Do not paste the Ed25519 private PEM into Bitterless. The current read-only integration neither asks
for it nor writes `GMGN_PRIVATE_KEY`. Keep or remove the request PEM according to GMGN account
recovery needs, but never sync it through Git/cloud notes.

## 4. Credential location

The main process writes the API key to GMGN's standard file:

```text
~/.config/gmgn/.env
```

Required content:

```text
GMGN_API_KEY=<personal-api-key>
```

The directory mode is `0700` and file mode is `0600`. Coin never reads the stored key back into the
renderer; it reports only `configured: true/false`. Do not place this file or key anywhere under
`projects/bitterless` or another project submodule.

For manual recovery, edit the file with a local editor rather than putting the key in a shell command
that may enter command history.

## 5. Read-only verification

From Resources choose **Verify read-only access**. The app runs a fixed allowlisted command without
a shell, a trading private key, or renderer-supplied arguments. Manual equivalent:

```bash
gmgn-cli market trending --chain sol --interval 1h --limit 3 --raw
```

Additional capability probes:

```bash
gmgn-cli market trenches --chain sol --type near_completion --type completed --limit 3 --raw
gmgn-cli market trending --chain bsc --interval 1h --limit 3 --raw
gmgn-cli market trending --chain robinhood --interval 1h --limit 3 --raw
```

A JSON response proves connectivity, not full production readiness. Save the version, command,
timestamp, response shape/hash, empty-result rate, and unsupported fields. Robinhood remains probing
until the seven-day coverage gate passes.

## 6. Allowed and forbidden capability

Initial allowlist:

```text
market trending / trenches / hot-searches / signal / kline
token info / security / pool / holders / traders
track kol / smartmoney
portfolio activity / stats / token-balance / created-tokens
```

The application must reject:

```text
swap *
order *
cooking *
track follow-wallet
portfolio holdings / info
any command requiring signed auth or GMGN_PRIVATE_KEY
```

Production polling should use a bounded GMGN OpenAPI adapter. The CLI is for setup, read-only
capability probes, schema discovery, and regression fixtures; do not spawn one process per production
poll request.

## 7. Move to another computer

Git sync transfers code and documentation only. On each machine:

1. Install Node/Yarn and `gmgn-cli`.
2. Open Coin → Resources and reconnect Codex.
3. Configure the personal GMGN API key locally.
4. Configure Alchemy endpoints locally.
5. Run Recheck and the read-only probe.

Credentials and `~/.config/gmgn/` are deliberately not synchronized by Git.

## Troubleshooting

| Symptom | Check |
|---|---|
| `gmgn-cli: command not found` | run `yarn global bin`, add that directory to `PATH`, restart Bitterless |
| unauthorized/API key error | replace the personal key from Resources; do not use the demo key |
| timeout or 429 | wait for the displayed cooldown; do not repeatedly retry |
| JSON/schema error | record CLI version and sanitized response shape; keep the prior valid result |
| command requests a private key | stop; it is outside the read-only allowlist |
