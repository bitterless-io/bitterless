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

1. GUI startup starts the Core SQLite renderer first, then refreshes the owned helper artifact
   without waiting for Core readiness. SQLite failure does not leave a legacy GUI-entry shim in
   place.
2. The GUI writes `<userData>/bin/bitterless-mcp`; opening the integration guide may refresh the
   same owned file. The SQLite-dependent bridge itself starts only after Core succeeds.
3. The shim sets `ELECTRON_RUN_AS_NODE=1` and invokes the dedicated bundled
   `out/main/mcpHelper.js` entry through Electron's executable. It never enters the GUI application,
   creates a `BrowserWindow`, or owns a Dock application.
4. The shim embeds the exact bridge endpoint that created it. The stdio helper uses this pinned
   endpoint instead of recalculating a target from a mutable development `package.json.name`.
5. The GUI starts one bridge on its own endpoint. A live existing
   socket is an ownership error; only a confirmed stale socket may be removed.

Previously generated app-entry launchers remain compatible only as a transition: current app-main
helper mode is windowless and does not acquire the GUI singleton. The next launch of the owning
Bitterless profile rewrites the shim to the dedicated Node entry.

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

The skill contract carries a quoted 12-digit `metadata.version_code` in `SKILL.md`. The same value
is hard-coded in the application as an independent Todo-skill revision; it advances only when the
portable skill or its installation contract changes, not for every application build.

## Domain catalog contract

MCP keeps the active and archived catalogs explicit so an agent can understand the user's grouping
without accidentally targeting an archived Domain:

| Tool | Result | Write policy |
|---|---|---|
| `domain.list` | `{ domains, focus }`; only active, non-deleted Domains | read-only |
| `domain.archived.list` | `{ domains }`; only archived, non-deleted Domains | read-only |
| `domain.description.update` | `{ domain }`; one active Domain after the persisted update | explicit user-authorized write |

Every returned Domain row includes at least `id`, `title`, `description`, `archived`, `position`,
`created_at`, and `updated_at`. `domain.list` remains the default discovery tool before creating or
moving a Todo. `domain.archived.list` is an opt-in historical lookup and its results are never valid
targets for `todo.create` or `todo.move`.

`domain.description.update` accepts one 20-digit Domain ID and a trimmed 0–500-character
description. It resolves the ID from `domain.list`, rejects archived/deleted/missing Domains, writes
through `TodoistSyncRepository.updateDomainDescription`, and returns a validated reread. It must not
write legacy Core tables or bypass the Todoist-style outbox/synchronization path.

## Todo and Step tool contract

Todo writes validate every optional field before creating the base row. `dueAt` and `remindAt` are
safe, nonnegative Unix-millisecond integers. New agents omit unspecified dates; `todo.update` uses
`null` only to clear one. For compatibility, create-time `null` is treated as unspecified, while an
empty string remains an input error and cannot create data.

`todo.create` is intentionally non-idempotent because identical intentional Todos are valid. After
a clear validation rejection, an agent checks active Todos in the resolved Domain and retries the
sanitized request at most once only when no obvious duplicate exists. A timeout or missing response
may represent a delayed commit, so the agent waits and rechecks rather than treating one immediate
empty list as permission to write again.

The public Step surface maps directly to the synchronized `sub_todo` repository and its existing
outbox commands:

| Tool | Result | Contract |
|---|---|---|
| `step.list` | `{ todo, steps }` | live validated parent plus stable ordered live Steps |
| `step.create` | `{ step }` | one trimmed 1–200-character user-owned sub-action |
| `step.update` | `{ step }` | title-only persisted update |
| `step.complete` | `{ step }` | deterministic, idempotent completed state |
| `step.uncomplete` | `{ step }` | deterministic, idempotent active state |
| `step.delete` | `{ deleted: true, id, todoId }` | synchronized soft deletion after exact-ID resolution |

The MCP never exposes the repository's toggle operation as state assignment. Complete and
uncomplete use a deterministic setter so retrying a request or racing another refresh cannot flip a
Step into the opposite state. These tools need no new HTTP endpoint or database migration: normal
SubTodo mutations already enqueue synchronization, refresh Todo renderers, and request the next
sync cycle.

## Agent onboarding contract

The in-app integration guide must present MCP registration and skill installation as two required,
distinct steps:

```text
┌──────────── Agent Todo access ──────────────┐
│ Complete setup instructions            copy │  ← primary, first
├──────────────────────────────────────────────┤
│ Detailed instructions                       │
│ 1. Connect MCP                              │
│    Helper path                         copy │
│    MCP config                          copy │
│ 2. Install bitterless-todo skill            │
│    Bundled skill folder                copy │
│    Codex / Claude installation hint         │
└──────────────────────────────────────────────┘
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

## Skill revision attention

The Todo menubar Robot/AI entry shows an Arco red dot when setup instructions for the current
portable skill revision have not been acknowledged on this Bitterless installation:

```text
Todo opens
   │
   ├─ atomically ensure SQLite baseline `000000000000` if the setting is absent
   ├─ read `todo_agent_skill / acknowledged_version_code`
   └─ compare stored revision with hard-coded current revision
          │
          ├─ stored < current ──► Robot red dot ──► copy Complete setup ──► store current
          ├─ stored = current ──► no dot
          └─ stored > current ──► no downgrade and no update dot
```

The baseline insert is `ON CONFLICT DO NOTHING` followed by a reread, so two Todo renderers cannot
overwrite a newly acknowledged revision with the baseline. Comparisons use `compare-versions` on
the 12-digit strings; JavaScript numeric comparison is forbidden.

The stored value deliberately means "the setup instructions for this revision were copied and
acknowledged", not proof that an external Codex or Claude process completed installation. Opening
or closing the modal, copying an individual helper/config/path field, or a failed clipboard write
does not update SQLite. Only a successful copy of the top-level Complete setup instructions records
the exact revision returned by the current main process. A missing or mismatched main-process
revision is a restart-required contract error, preventing a new renderer from acknowledging an old
bundled skill. Successful acknowledgement is broadcast to other Todo renderers without forcing a
full Todo data refresh.

## Compatibility and safety

- The production key `bitterless`, existing tool names, and structured responses remain compatible;
  Step tools are additive. Legacy create-time `null` remains accepted even though current skill
  instructions omit unspecified dates.
- Production acceptance is read-only. Full smoke writes and cleanup run only against DEBUG unless
  Ral explicitly authorizes a production write test.
- Helper routing is local-only. No network port or SQLite access is exposed to MCP hosts.
- The skill package contains only instructions and MCP metadata. It never contains Todo data or
  authentication material.
- Release packaging copies the canonical `skills/bitterless-todo/` tree into a readable external
  resource directory so Codex and Claude Code can install the exact same package.
