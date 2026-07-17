# Desktop Helper Process Isolation Review — Round 4

Status: accepted

Date: 2026-07-17

## Conclusion

Pass. No confirmed P0, P1, or P2 findings. This follow-up verifies the two gates discovered only by
live `yarn dev` testing after Round 3: a hidden SQLite document that never reaches
`did-finish-load`, and a Home renderer that exists but never emits `ready-to-show`.

## Evidence

- Hidden SQLite document loading has a 3-second startup deadline. Timeout or load failure skips the
  persisted layout request and all SQLite-dependent optional integrations, then creates Home with
  default bounds.
- Degraded Home creation calls `show()` directly, so a stalled renderer first paint cannot leave the
  only main window hidden. Healthy startup retains the normal `ready-to-show` behavior.
- Todo MCP shim refresh runs before the hidden SQLite and Core readiness gates. The generated
  launcher uses `ELECTRON_RUN_AS_NODE=1` and the dedicated `out/main/mcpHelper.js` entry even when
  the GUI must continue in degraded mode.
- The shutdown guard is checked before Home creation, so neither document nor layout timeout can
  revive a window after cleanup starts.

## Verification

| Check | Result |
|---|---|
| `yarn check:renderer-i18n` | pass |
| `yarn test:mcp:multi-instance` | pass outside the sandbox for local Unix sockets |
| `yarn typecheck:node` | pass |
| `yarn build` | pass; dedicated MCP and Codex hook helper entries emitted |
| final live `yarn dev` | pass: one Bitterless top-level Electron PID, two renderer children, one visible window titled `BitterLess` |
| generated DEV_DEBUG Todo shim | pass: exports `ELECTRON_RUN_AS_NODE=1` and invokes `out/main/mcpHelper.js` |
| dev shutdown | pass: test PID exited and no uninitialized-i18n rejection was emitted |

The live run also reconfirmed that Core migration work is not the stall: the existing migration
audit passes, while the hidden renderer can remain before document completion. The broader
`electron-xpc` renderer-RPC teardown/timeout problem is intentionally outside this surgical fix.
