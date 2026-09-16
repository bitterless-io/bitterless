# Development CSP blocks Maestro dialog hot reload

Status: implemented; code verified, owner runtime testing pending.

## Evidence and classification

Ral reported a `dev:prod` WebSocket CSP failure on 2026-09-16 at 17:14:13 local time.
The DEBUG_PROD log identifies `renderer:maestroTabAlias` at 09:14:13.614Z (`[vite] connecting`)
and 09:14:13.616Z (`ws://localhost:5174/` rejected by `connect-src 'none'`).

This is a development configuration defect. `dev:prod` still serves the renderer through Vite;
the production suffix selects the runtime profile, not packaged renderer delivery. Tab Alias and
History declare `connect-src 'none'`, but neither is covered by the existing serve-only CSP
transforms in `electron.vite.config.ts`.

The later OnlyPreview failure is independent: at 09:14:52.794Z its background index rebuild
reports SQLite primary error 11. See [corrupt project index](onlypreview-corrupt-project-index.md).

## Repair contract

- Permit the existing localhost Vite WebSocket sources for the Tab Alias and History pages only
  while serving in development, following the other renderer CSP transforms.
- Keep packaged HTML policy and the scriptless privileged runtime pages unchanged.
- Verify actual HTML transformation for both pages and the serve-only plugin registration with
  Node tests. Ral owns the final `dev:prod` runtime check; do not launch Electron or E2E.

## Verification

The new CSP regression and existing Tab Alias / History popup tests pass (25 tests).
Restart `yarn dev:prod`, open Tab Alias and History, and confirm Vite connects without CSP errors.
