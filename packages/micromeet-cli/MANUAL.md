# micromeet CLI Manual

`micromeet` is the Micromeet command line client bundled with Bitterless Maestro. Its primary domains match the Core authentication boundaries: `crms` for tenant/institution work and `sys` for platform administration.

## Quick Start

```bash
micromeet crms login
micromeet crms auth status --check
micromeet crms mcu records --page 1 --page-size 20

micromeet sys login
micromeet sys auth status --check
micromeet sys me
```

When `--email` or `--password` is omitted in an interactive terminal, the CLI prompts for it. Password input is hidden. For automation, use realm-specific environment variables:

```bash
MICROMEET_CRMS_EMAIL=user@example.com \
MICROMEET_CRMS_PASSWORD='...' \
micromeet crms login --region SG --json

MICROMEET_SYS_EMAIL=admin@example.com \
MICROMEET_SYS_PASSWORD='...' \
micromeet sys login --json
```

Prefer the hidden password prompt for human use because `--password` can be visible in shell history or process listings.

## Command Tree

```text
micromeet
+-- crms
|   +-- login | logout
|   +-- auth status | auth set-password
|   +-- curl
|   +-- mcu
|   +-- mapping
|   +-- patients
|   +-- corporates
|   +-- migration
|   +-- settings
+-- sys
|   +-- login | logout
|   +-- auth status
|   +-- me
|   +-- curl
+-- help [command path]
+-- manual
+-- modules
```

The previous top-level CRMS forms remain aliases, so `micromeet mcu records` and `micromeet crms mcu records` behave the same.

## Help And Manual Output

Every command path supports the same three discovery forms:

```bash
micromeet help crms mcu records
micromeet crms mcu records help
micromeet crms mcu records --help
```

They return the same plain-text help. A group such as `micromeet crms mcu --help` lists its child commands; a leaf such as `micromeet crms mcu records --help` returns usage and command-specific options. Help is resolved before credentials or network configuration, so an agent can explore the CLI before login.

`micromeet help` returns the short starting page. `micromeet modules` returns the compact complete command tree. `micromeet manual` writes this complete Markdown document to stdout; it is not wrapped in JSON, which makes it directly readable and redirectable by humans and agents.

## Authentication

### CRMS

```bash
micromeet crms login [--email <email>] [--password <password>] [--region <SG|HK|ID>]
micromeet crms logout
micromeet crms auth status [--check] [--json]
micromeet crms auth set-password [--password <password>] [--json]
```

Login calls `POST /share/auth/password-login`. A standalone login must pass `--region`, set `MICROMEET_CRMS_REGION`/`MICROMEET_REGION`, or inherit the region from a credential last written by Maestro. Otherwise an interactive terminal asks for `SG`, `HK`, or `ID`; non-interactive use exits with guidance to pass `--region`. `--check` calls `POST /share/user/profile/detail` using the stored token. If login reports `activationRequired: yes`, the account is still invited and Core intentionally blocks business endpoints. Run `micromeet crms auth set-password`; it calls `POST /share/auth/set-password`, activates the account, and keeps using the stored token. Omit `--password` to enter it through the hidden prompt.

### Sys

```bash
micromeet sys login [--email <email>] [--password <password>] [--region SG]
micromeet sys logout
micromeet sys auth status [--check] [--json]
micromeet sys me [--json]
```

Login calls `POST /sys/auth/login`. `--check` and `sys me` call `GET /sys/me`.

## Encrypted Credentials

The realms use separate files:

```text
~/.micromeet/credentials/crms.json
~/.micromeet/credentials/sys.json
```

Each file is an AES-256-GCM envelope. The key is derived deterministically by normalizing the login email, applying Micromeet's fixed version-1 obfuscation, and hashing the result with SHA-256. A random 96-bit IV and authentication tag protect each write. The password is never saved.

The envelope keeps the normalized email in clear metadata because it is needed to derive the decryption key. The token, workspace, API base, region, account metadata, auth source, and update time are encrypted. macOS/Linux directories use mode `0700`; credential files use `0600`.

This protects against casual plaintext disclosure and gives CLI/Electron a shared deterministic format. It is not equivalent to macOS Keychain security because a known email makes the derived key reproducible.

Credential overrides:

```text
--credential-file <path>
MICROMEET_CRMS_CREDENTIAL_FILE
MICROMEET_SYS_CREDENTIAL_FILE
MICROMEET_CREDENTIAL_FILE
```

Token resolution order is `--token`, realm token environment variable, `MICROMEET_TOKEN`, encrypted credential, then the legacy CRMS `~/.micromeet/session.json` compatibility file. A legacy JWT with an email claim is migrated into the encrypted CRMS file and the plaintext file is deleted on first use.

Maestro is authoritative when it logs in. It writes a complete CRMS credential with the legacy
protocol source value `cowork` through a temporary file and atomically replaces the previous
credential. A Maestro SG login therefore replaces an earlier standalone ID token, account,
workspace, and region together. Maestro logout removes the shared CRMS credential.

## CRMS Examples

```bash
micromeet crms mcu records --page 1 --page-size 20 --keyword Jane --json
micromeet crms mcu record diagnostic-data update --body @diagnostic.json --json
micromeet crms corporates list --page 1 --page-size 20
micromeet crms corporates projects create --name "MCU Batch" --code BATCH-001
micromeet crms mapping data-map list --mcu-type laboratory_examination
micromeet crms settings detail --json
```

Migration commands are dry-run by default:

```bash
MICROMEET_MIGRATION_TOKEN=... micromeet crms migration account \
  --source old@example.com --target new@example.com
```

## HTTP Requests

```bash
micromeet crms curl POST /mcu/record/list -d '{"page":1,"page_size":10}'
micromeet sys curl GET /sys/me --json
micromeet curl --no-auth https://example.com/status -i
```

Run `micromeet curl --help` for request methods, headers, bodies, queries, output files, and auth controls.

## Global Options

```text
--base-url <url>
--region <SG|HK|ID>
--token <jwt>
--workspace-id <id>
--credential-file <path>
--session-file <path>       Legacy CRMS compatibility only
--json
--debug
```

## Standalone Packaging

Source is TypeScript/Node-compatible code, but release binaries do not require Node.js on the user's computer. `yarn workspace @micromeet/cli package <platform>` runs Bun's `build --compile`, which bundles the CLI code, dependencies, and Bun runtime into one native executable.

```text
mac_arm   -> release/micromeet-macos-arm64
mac_intel -> release/micromeet-macos-x64
win64     -> release/micromeet-win-x64.exe
```

Maestro stages only the current platform binary into the host's `build/maestro-tools` directory. electron-builder copies it to `Resources/maestro-tools` through `extraResources`, and the macOS signing configuration lists `Contents/Resources/maestro-tools/micromeet` in `mac.binaries`.

At startup Maestro creates `~/.micromeet/bin/micromeet`, prepends that directory to child-process `PATH`, and synchronizes the AI CRMS browser login into the encrypted CRMS credential. Maestro-started coding-agent sessions can therefore run `micromeet` immediately. External Terminal sessions need `~/.micromeet/bin` on their shell `PATH`.

The bundled CLI updates together with Maestro's application auto-update. The MVP does not rewrite shell startup files or provide a separate CLI self-update command.

## Public Installation

Public releases are compiled for macOS Apple Silicon, macOS Intel, and Windows x64 and uploaded to Micromeet's Singapore OSS bucket behind the overseas CDN. Each release uses an immutable timestamp path:

```text
https://assets.micromeet.ai/apps/micromeet-cli/<YYMMDDHHmmss>/
```

Install the latest macOS release:

```bash
curl -fsSL https://assets.micromeet.ai/apps/micromeet-cli/install.sh | sh
```

Install the latest Windows x64 release from PowerShell:

```powershell
irm https://assets.micromeet.ai/apps/micromeet-cli/install.ps1 | iex
```

Both installers select the correct binary, verify its embedded SHA-256 checksum, install it under the current user's `~/.micromeet/bin` directory, and add that directory to the user's shell path. The public executables include their JavaScript runtime and do not require Node.js or Bun on the user's computer.

Release maintainers publish all platforms with:

```bash
yarn cli:publish
yarn cli:publish:dry-run
```

The public install page is generated and deployed by this Maestro-owned command at `https://assets.micromeet.ai/apps/micromeet-cli/install.html`.
