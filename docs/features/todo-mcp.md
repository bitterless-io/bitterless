# Todo MCP Integration

## Objective

Expose the running Bitterless Todo store to local MCP hosts while allowing production and local
development Bitterless instances to run at the same time. Real agent work must target production;
development instances are explicit test targets and must never replace or infer the production
route.

## Instance routing

```text
Codex `bitterless`                         optional `bitterless-debug`
        │                                             │
        ▼                                             ▼
production shim (pinned endpoint)          DEBUG shim (pinned endpoint)
        │                                             │
        ▼                                             ▼
.../Bitterless/mcp/bridge.sock             .../Bitterless_DEBUG/mcp/bridge.sock
        │                                             │
        ▼                                             ▼
production GUI + production Todo DB        DEBUG GUI + DEBUG Todo DB
```

The bridge address is derived from the GUI's `userData` directory. Unix uses
`<userData>/mcp/bridge.sock`; Windows uses a named pipe whose suffix is a hash of `userData`.
`appId` and `productName` do not select the Todo store.

| Application identity | MCP host key | Purpose |
|---|---|---|
| `Bitterless` | `bitterless` | Production and all real Todo work |
| `Bitterless_DEBUG` | `bitterless-debug` | `debug_prod` testing only |
| `Bitterless_DEV` | `bitterless-dev` | Local development testing only |
| `Bitterless_DEV_DEBUG` | `bitterless-dev-debug` | `debug_dev` testing only |

The `bitterless-todo` skill depends only on `bitterless`. An agent may use another host key only
when Ral explicitly asks to test that local instance.

## Helper lifecycle

1. The GUI waits for the core SQLite preload to report that the Todo database is initialized.
2. The GUI starts one bridge on its own endpoint. A live existing socket is an ownership error;
   only a confirmed stale socket may be removed.
3. The GUI automatically writes `<userData>/bin/bitterless-mcp`; opening the integration guide may
   refresh the same file but is not required for helper installation.
4. The shim embeds the exact bridge endpoint that created it. The stdio helper uses this pinned
   endpoint instead of recalculating a target from a mutable development `package.json.name`.
5. Legacy helpers without a pinned endpoint continue to fall back to their own `userData` route.

SQLite readiness must fail explicitly. The bridge must not turn an unavailable/null DAO result into
an empty domain or Todo list, and must not expose raw JavaScript errors such as calling `.filter()`
on `null`.

## Operator commands

Production remains the default smoke target:

```bash
yarn mcp:todo:smoke --read-only
```

Development must be selected explicitly:

```bash
yarn mcp:todo:smoke --profile debug --read-only
yarn mcp:todo:smoke --profile debug
```

`--profile production|debug` selects the standard helper path. It cannot be combined with
`--helper`; `--helper` and `BITTERLESS_MCP_HELPER` remain available for custom/legacy commands.
The CLI prints the selected target and helper path before connecting.

Codex may load both servers, but the names must remain distinct:

```toml
[mcp_servers.bitterless]
command = "/Users/ral/Library/Application Support/Bitterless/bin/bitterless-mcp"

[mcp_servers.bitterless-debug]
command = "/Users/ral/Library/Application Support/Bitterless_DEBUG/bin/bitterless-mcp"
```

## Compatibility and safety

- The production key `bitterless`, existing tool names, schemas, and structured responses do not
  change.
- Production acceptance is read-only. Full smoke writes and cleanup run only against DEBUG unless
  Ral explicitly authorizes a production write test.
- Helper routing is local-only. No network port or SQLite access is exposed to MCP hosts.
