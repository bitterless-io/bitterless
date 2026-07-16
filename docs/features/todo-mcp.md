# Todo MCP Integration

## Objective

Expose the running Bitterless Todo store to local MCP hosts while allowing production and local
development Bitterless instances to run at the same time. Real agent work must target production;
development instances are explicit test targets and must never replace or infer the production
route.

Bitterless Todo is a personal, multi-device-synchronized Todo manager. The production MCP writes
to the user's real personal Todo store; Bitterless, rather than the MCP helper, owns account and
device synchronization. Agents must treat these records as durable personal follow-ups, not as a
project issue tracker or scratch space for steps the agent can complete itself.

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

## Portable agent skill

The repository owns a portable skill source at `skills/bitterless-todo/`. One package works for
both Codex and Claude Code:

```text
bitterless-todo/
├── SKILL.md
├── agents/openai.yaml
└── references/
    ├── mcp-setup.md
    └── tools.md
```

`agents/openai.yaml` declares the production `bitterless` MCP dependency for Codex and is harmless
when Claude Code loads the same folder. `references/mcp-setup.md` explains installation and MCP
registration for both agents. The skill must describe Bitterless as personal multi-device Todo,
permit judgment-based creation only for concrete user-owned follow-ups worth persisting, avoid
duplicates, and never place real work in a DEBUG instance.

Export the distributable archive with:

```bash
yarn mcp:todo:skill:export
```

The archive contains one top-level `bitterless-todo/` directory and no credentials, user data, or
machine-specific helper path. The workspace `.agents/skills/`, `.claude/skills/`, and
`~/.codex/skills/` copies must remain byte-identical to this portable source.

## Agent onboarding contract

The in-app integration guide must present MCP registration and skill installation as two required,
distinct steps:

```text
┌──────────── Agent Todo access ─────────────┐
│ MCP exposes the Todo tools.                │
│ Skill teaches the agent when/how to use    │
│ them for personal, cross-device follow-up. │
├─────────────────────────────────────────────┤
│ 1. Connect MCP                              │
│    Helper path                         copy │
│    MCP config                          copy │
├─────────────────────────────────────────────┤
│ 2. Install bitterless-todo skill            │
│    Bundled skill folder                copy │
│    Codex / Claude installation hint         │
├─────────────────────────────────────────────┤
│ Complete setup instructions            copy │
└─────────────────────────────────────────────┘
```

MCP configuration alone only makes tool schemas callable. It does not reliably teach a general
agent that Bitterless is the user's durable personal, multi-device-synchronized Todo manager, when
a conversational follow-up is worth persisting, how to avoid duplicates, or why internal agent
steps and project issues must not be written. The `bitterless-todo` skill owns that judgment policy.

The guide exposes a real bundled skill directory and a complete copyable setup instruction that
contains both the current instance's MCP JSON and the skill path. Development integrations remain
explicit test targets: a `bitterless-debug` guide must identify that server as test-only, while the
portable skill keeps its production `bitterless` dependency for real personal Todo work.

The modal distinguishes request progress from an incompatible/stale main process. `Loading...` is
allowed only while integration info is genuinely pending. Once an integration response exists,
missing or empty required fields such as `skillPath` are a contract mismatch: the guide must show
an explicit restart-required error (or reject opening with that error), never leave a permanent
loading placeholder.

## Compatibility and safety

- The production key `bitterless`, existing tool names, schemas, and structured responses do not
  change.
- Production acceptance is read-only. Full smoke writes and cleanup run only against DEBUG unless
  Ral explicitly authorizes a production write test.
- Helper routing is local-only. No network port or SQLite access is exposed to MCP hosts.
- The skill package contains only instructions and MCP metadata. It never contains Todo data or
  authentication material.
- Release packaging copies the canonical `skills/bitterless-todo/` tree into a readable external
  resource directory so Codex and Claude Code can install the exact same package.
