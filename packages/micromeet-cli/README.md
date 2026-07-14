# Micromeet CLI

The `micromeet` CLI exposes separate `crms` and `sys` authentication domains, encrypted per-realm credentials, Core convenience commands, and an axios-backed curl surface.

```bash
yarn workspace @micromeet/cli build
node packages/micromeet-cli/dist/cli.js crms login
node packages/micromeet-cli/dist/cli.js crms mcu records
node packages/micromeet-cli/dist/cli.js sys login
```

Standalone releases use Bun compile and do not require Node.js on the target computer. See [MANUAL.md](MANUAL.md) for the complete command and packaging reference.
