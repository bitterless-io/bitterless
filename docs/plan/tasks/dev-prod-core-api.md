---
status: completed
depends-on: []
verify:
  - yarn dev:prod generates a prod/debug .env.rig
  - production desktop API resolves to https://api.bitterless.io
  - yarn typecheck
---

# Run Desktop Development Against Production

## Goal

Make `yarn dev:prod` run the Electron development app against the Bitterless production Core API.

## Scope

- Keep development and release commands unchanged.
- Route `debug_prod` and `release_prod` to `https://api.bitterless.io`.
- Use the production domain as the renderer fallback whenever `VITE_ENV` is `prod`.
- Keep development environments on `https://bl-test-api.terncloud.com`.

## Verification

- `yarn dev:prod` started Electron successfully with `VITE_ENV=prod`, `VITE_MODE=debug`, and the production Core URL.
- `yarn build` passed for main, preload, and all renderer entries.
- Configuration assertions passed for the command, both production profiles, the development profile, and generated `.env.rig`.
- `yarn typecheck` could not complete because Node exhausted its heap in the Node `tsc` phase at both the default limit and an 8 GB limit; it emitted no specific type error before aborting.
