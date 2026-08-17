# EyesOnAgents Claude Delivery Analysis

## Goal decomposition

Extend the existing Codex observation board with local Claude Code sessions while keeping Codex
behavior unchanged. Claude delivery has four independently verifiable concerns:

1. provider-qualified persistence and renderer identity;
2. read-only Claude Desktop/JSONL inventory plus archive reconciliation;
3. lifecycle observation through a Bitterless Claude plugin and Agent View fallback;
4. provider-specific Desktop Open, transcript preview, iconography, and connection guidance;
5. persistent directory intent, Main-owned watcher recovery, and visible health;
6. a persisted provider pause that removes all Claude runtime/UI work without changing Codex.

The product contract is
[EyesOnAgents Claude Observation](../../features/eyes-on-agents-claude-observation.md).

## Resolved decisions

| question | decision |
|---|---|
| Claude scope | local Claude Code CLI and local Claude Desktop Code sessions only |
| canonical identity | `claude:<cliSessionId>`; retain separate `desktopSessionId` for Desktop routing |
| Desktop discovery | bounded read-only scan of `claude-code-sessions/<account>/<org>/local_*.json` |
| CLI discovery | bounded metadata-only scan of direct project UUID JSONL files |
| archive | explicit Desktop `isArchived`; CLI-only remains `unknown`; omission never means archive |
| live lifecycle | user-scope Bitterless Claude plugin Hook through local socket/outbox/receipt |
| interrupt fallback | Agent View when authoritative; otherwise expired Hook active evidence becomes unknown |
| Open | Desktop-only `claude://claude.ai/epitaxy/<desktopSessionId>`; never launch CLI |
| CLI-only interaction | explicit OnlyPreview JSONL action; no hidden import/resume side effect |
| content | no Claude prompt, reply, reasoning, tool, attachment, or raw metadata persistence |
| refresh | local socket invalidation plus one ten-second reconciliation trigger; unhealthy directory startup has one Main-owned bounded retry |
| provider switch | missing defaults on; off stops and hides Claude while retaining rows/config/plugin; Codex remains independent |

## Module decomposition

| module | responsibility |
|---|---|
| shared EyesOnAgents contract | provider/session-key identity, archive tri-state, Claude status and XPC DTOs |
| SQLite migration/repository | rebuild provider-blind keys, preserve Codex data, import legacy Claude rows |
| Claude path resolver | allowlisted platform roots and `CLAUDE_CONFIG_DIR` resolution |
| Claude directory watcher helper | standalone Node `fs.watch`; strict content-free ready IPC, fatal watcher-error exit, and bounded content-free invalidations over UDS/named pipe; no HTTP/TCP listener |
| Desktop metadata adapter | bounded changed-file scan and allowlisted metadata projection |
| JSONL inventory adapter | UUID filename/stat discovery and bounded metadata-only head/tail projection |
| Agent View adapter | capability probe and allowlisted `agents --json --all` runtime projection |
| Claude observation service | coalescing, joins by `cliSessionId`, freshness lease, repository commits |
| Claude plugin bridge | installation/status plus short-lived helper, socket, durable content-free outbox |
| provider Open/preview | fixed Desktop route or canonical OnlyPreview target derived by Main |
| renderer | provider icons, provider-qualified keys, Claude connection guide/actions |
| Claude directory config | Core setting intent, native picker, applied-root fencing, retry, and runtime health |
| Claude provider preference | strict Core setting, lifecycle gate, snapshot projection, and compact header switch |

## Integration chains

| chain | invariant |
|---|---|
| app startup -> Main socket server + one ready Node watcher -> scan | no scan-to-watch admission gap, HTTP/TCP port, second Electron app/Dock process, or duplicate watcher |
| filesystem change -> watcher -> socket invalidation -> Main scan | no conversation content or renderer-supplied path crosses the socket |
| Desktop metadata -> `cliSessionId` join -> repository | title/activity/archive update only on valid explicit fields |
| JSONL stat/metadata -> repository | malformed or missing files cannot delete/archive/erase existing fields |
| plugin Hook -> helper -> socket/outbox -> receipt -> repository | prompt/output content never reaches disk or XPC |
| Agent View -> runtime reconcile | partial/failing output preserves prior durable evidence |
| 10s poll -> Codex page + Claude batch | providers have independent in-flight fences and changed-only writes |
| Open -> row lookup -> fixed epitaxy URL | renderer cannot supply URL/path/command; CLI is never launched |
| Preview -> canonical stored JSONL -> OnlyPreview | explicit, read-only, and never marks the session read |
| archive/unarchive metadata -> projection | archived hides; unarchive restores Domain/read history |
| startup/config change -> hydrate/apply -> watcher | config survives restart; old scans and delayed retries cannot cross generations |
| child/socket termination -> cleanup -> replacement | old ready/exit/close callbacks cannot admit, stop, unlink, or downgrade a newer generation |
| native picker -> canonical config root -> repository cleanup | renderer supplies no path; stale Preview capability is revoked without deleting tasks |
| provider off -> lifecycle fence -> filtered snapshot | watcher/Hook/poll/notification stop; Claude rows remain durable and Codex keeps syncing |
| provider on -> persisted pending sentinel -> outbox reset -> finite cutoff -> observation/full refresh | disabled-period Hook events cannot replay; crash recovery is deterministic; saved Domain/unread/archive state returns |

## Primary risks and controls

| risk | control |
|---|---|
| Codex regression during key migration | transactional idempotent migration plus retained Codex behavior suites |
| Claude ID collision/duplicate import | canonical provider session key and separate validated Desktop ID |
| Claude private metadata schema changes | strict path/size/key allowlist; invalid shape produces no state mutation |
| archive guessed from absence | only explicit boolean changes archive state |
| Hook plugin overwrites existing settings | install one owned plugin; never rewrite unrelated Hook arrays/plugins |
| hook configured but withheld by trust | report configured and first committed receipt separately; guide `/hooks` |
| interrupt leaves stale working | Agent View authority or bounded active lease to unknown, never fake completed |
| deep link opens wrong surface | exact `epitaxy` route only when persisted Desktop ID exists |
| raw transcript leakage | no message parsing/persistence; preview is a distinct user action |
| hidden Claude rows mutated by global actions | Read all receives a Main-owned provider allowlist |

## Delivery order

1. `eyes-on-agents-provider-identity-036`: provider-qualified schema, repository, DTO, and UI keys.
2. `eyes-on-agents-claude-inventory-open-037`: singleton discovery, Desktop archive, Agent View, Open,
   and JSONL preview.
3. `eyes-on-agents-claude-observation-ui-038`: plugin Hook bridge, connection lifecycle, provider
   icons, guide, i18n, and end-to-end non-Electron verification.
4. `eyes-on-agents-claude-directory-runtime-039`: persisted directory choice, immediate safe
   reconfiguration, Main-owned retry, watcher health, and compact Connection controls.
5. `eyes-on-agents-claude-provider-toggle-040`: persisted provider pause, lifecycle/outbox fence,
   filtered projection, scoped Read all, and compact Claude header switch.

Each task is developed and independently reviewed serially. Ral owns live Electron verification.
