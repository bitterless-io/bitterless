---
status: superseded
depends-on: []
verify:
  - yarn dev:prod generates a prod/debug .env.rig
  - historical production desktop API resolved to https://api.bitterless.io
  - yarn typecheck
---

# Run Desktop Development Against Production

## Goal

Historical contract that made `yarn dev:prod` run against the Hong Kong custom-domain Core API.
It is superseded by the Shanghai direct-FC release gate in
[`customer-auth-login-account-001`](customer-auth-login-account-001.md).

## Scope

- Keep development and release commands unchanged.
- The completed historical change routed `debug_prod` and `release_prod` to
  `https://api.bitterless.io`.
- The current production target is
  `https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run`; update every production endpoint
  surface together only after the Shanghai backend gate passes.
- Keep development environments on `https://bl-test-api.terncloud.com`.

## Verification

- Historical verification used `VITE_ENV=prod`, `VITE_MODE=debug`, and the then-current production
  Core URL.
- `yarn build` passed for main, preload, and all renderer entries.
- Configuration assertions passed for the command, both production profiles, the development profile, and generated `.env.rig`.
- `yarn typecheck` could not complete because Node exhausted its heap in the Node `tsc` phase at both the default limit and an 8 GB limit; it emitted no specific type error before aborting.
