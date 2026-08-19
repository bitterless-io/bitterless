# EyesOnAgents Layout

Status: Implemented; owner visual verification pending

## Product stance

EyesOnAgents is a daylight operations board for one person supervising several Codex and Claude
tasks. Its
single job is to answer: **what is running and what just finished?**

It borrows Todo's standalone window chrome, but none of Todo's Domain classification,
checkbox, due-date, repeat, subtask, or detail-editor behavior. Avoid a generic dark developer
dashboard: the surface remains calm Royal Blue, white, and cool grey, with status color used only
for live signals.

User-managed Domains were removed from this UI; the board is one `Focus` column that lists every
visible thread in attention order. Domain storage is retained but unexposed — see
[Focus-only board](../features/eyes-on-agents-focus-board.md).

The Claude extension keeps the existing palette, system typography, fixed 300px column,
and background-led hierarchy. Its one visual signature is a compact official product mark in the
title line: the transparent Codex GA mark at 16px and Claude Spark at 15px, both centered in a fixed
16×18px shell. A review rejected provider badges, a new metadata row, permanent card borders, and
provider brand-color panels because each would add height or compete with working/unread attention.

## Window and navigation

- EyesOnAgents appears as a card in Home > Mini Apps.
- Clicking the card opens/focuses one singleton standalone window.
- The obsolete authenticated Home `coding-agents` route and sidebar item are removed.
- Default size is approximately `1120 × 720`; minimum size is `800 × 600`.
- Window position, size, and always-on-top state follow the existing Mini App setting pattern.
- macOS uses a hidden titlebar with traffic-light inset; Windows uses the shared custom controls.

## Overall layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  EyesOnAgents            ● Connections [↻ Refresh] [Bridge] [Settings]      │
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌ ⌖ Focus     [⌕] [Read all]┐                                              │
│  │ [ Search titles      ][×] │                                              │
│  │ [ overmind (4)         ▾ ]│                                              │
│  │ API pagination refactor ◌ │                                              │
│  │ now              [⌂][↗]   │                                              │
│  │ Fix migrations          ◌ │                                              │
│  │ 1m               [⌂][↗]   │                                              │
│  │ Release notes             │                                              │
│  │ 4m               [⌂][↗•]  │                                              │
│  │ Project notes             │                                              │
│  │ 4h               [⌂][↗]   │                                              │
│  │        list scrolls ↓     │                                              │
│  └───────────────────────────┘                                              │
│   300px fixed · fills window height · empty canvas to the right              │
└──────────────────────────────────────────────────────────────────────────────┘
```

The 32px menu bar is the drag region. The board holds exactly one column: fixed 300px wide — the
former minimum — with no flex growth and no wrapping, and it stretches from below the menu bar to
the bottom board padding. The 600px height ceiling is gone; the thread list scrolls inside the
column body and the board no longer owns vertical page scrolling. Board padding stays 12px, so the
area right of the column is empty canvas.

Focus is the board. It shows every visible thread in attention order and is visually distinct
through its warm attention background. The persisted `uncategorized` system Domain and every stored
`domain_id` remain in SQLite as an unexposed storage fallback; no column, menu, or drag target
presents them.

## Visual system

Use the existing Bitterless color contract as the source of truth:

| role | token |
|---|---|
| menu bar / primary action | Royal Blue `#4E5882` |
| deep text | `#323955` / `#1E2237` |
| board canvas | near-white neutral `oklch(0.985 0 0)` |
| Focus column surface | warm attention tint `oklch(0.94 0.04 60)` |
| thread item surface | white `oklch(1 0 0)` |
| working loader | Royal Blue |
| unread Open dot | red |

Typography stays on the product's existing system-font stack. Hierarchy comes from size, weight,
spacing, and alignment rather than a new font dependency.

Surface hierarchy follows Todo: background contrast separates the board, the Focus column, and
thread items. The column shell, its header, and thread items have no
decorative outline or persistent shadow. A thread item may gain one quiet shadow
on pointer hover without moving; keyboard focus uses a visible outline and a light background
rather than reintroducing a permanent card border.

The single attention-tinted column and its background-led hierarchy are the product signature. Thread
cards contain no decorative signal rail, source badge, status row, or `New` badge. Every active
working/waiting thread gets a compact loading indicator beside its title. The Open control gets one
unread red dot after the thread reaches a terminal `idle`, `ended`, or `failed` state, so neither
state consumes another card row and a later SessionEnd cannot erase completion attention.

## Focus search

`Cmd+F` on macOS and `Ctrl+F` on Windows activate the Focus column's own title filter. There is no
search modal, no separate result list, and no second search surface:

```text
┌ ⌖ Focus                    [⌕] [Read all] ┐
│ [ ops git________________________ ]  [×]  │  filter row, expanded by ⌕ or Cmd+F
│ [ overmind (4)                        ▾ ] │  Project filter
│ ops-git sync failures                     │  matched card, normal card behavior
│ 12m                            [⌂][↗]    │
└───────────────────────────────────────────┘
```

The query is normalized (`NFKC`), lowercased, and split into tokens on whitespace plus `-`, `_`,
`.`, `/`, `\`, `:`, and `|`; the same split is applied to `thread.title`. Every query token must be
contained in some title token, and order does not matter, so `ops git` and `git ops` both match
`ops-git`. An empty, whitespace-only, or separator-only query is not a filter and the complete list
remains visible. Only `thread.title` is matched — never thread ID, `cwd`, Project name, prompt, or
response content — and a thread with no resolved title never matches a non-empty query.

Filtering narrows the real card list, so a matched row keeps its provider mark, working loader,
question echo, relative time, folder tooltip, Open/overflow controls, unread dot, and card-level
keyboard focus. The title filter composes with the Project filter; a card must satisfy both.

| input | behavior |
|---|---|
| `Cmd+F` / `Ctrl+F` | suppress native page Find, expand the filter row if collapsed, focus the input |
| repeated shortcut | keep the row open and refocus the input; the current query is preserved |
| `⌕` toggle | expand and focus, or clear and collapse |
| typing | narrow the visible Focus cards live |
| `×` clear | empty the query and keep the row open and focused |
| `Escape` in the row | clear the query and collapse the row so no invisible filter remains |

## Header behavior

The menu bar shows:

- application title;
- compact provider connection state;
- labelled `Refresh`, available from connected, disconnected, and error states and disabled while
  another board action, connection, or synchronization is in flight; while the renderer remains
  mounted, one idempotent store-owned poll requests a silent tiered field refresh every 10 seconds
  when connection intent allows it;
- independent Codex observation status/action;
- independent Claude observation/plugin status/action;
- a compact settings/always-on-top control and platform window controls.

Clicking the connection status opens a 540px master-detail panel. A fixed 60px Agent App rail uses
the official Codex and Claude PNG marks; its selected tab controls which provider detail pane is
visible. The selected pane contains:

- managed App Server status and `Connect`/`Disconnect`;
- last successful sync time and latest error, if any;
- an explicit note that this connection does not attach to Codex Desktop's private stdio process;
- Codex observation status with a fixed top-level `Check status` and a compact settings list for
  `Enable`, `Repair`, latest-question permission, and `Remove`;
- Claude provider switch plus one state-driven observation action: `Enable`, `Finish setup`,
  `Open new Claude session`, `Copy /reload-plugins`, `Retry listener`, `Repair`, or
  `Remove plugin` while enabled, plus its own default-off **Store latest user question** Switch;
- when review is required, one external Codex row naming `Settings → Hooks` and the exact four
  Bitterless hooks to turn on and trust; because the work happens in Codex, this row has no
  right-side action button.

The rail separates the two provider lifecycles without mixing navigation and enablement:

```text
┌ Agent connections ─────────────────────────────────────── × ┐
│ Codex │ App Server · Disconnected              [Connect]   │
│  logo │ Thread inventory and lifecycle notifications      │
│ Codex │ Codex observation · Needs review [Check status]   │
│       │ Status-specific one-line explanation              │
│       │ Codex → Settings → Hooks                          │
│       │ Trust SessionStart · UserPromptSubmit ·            │
│       │       PermissionRequest · Stop                     │
│       │ Store latest user question            [switch]    │
│       │ Remove Codex observation              [Remove]    │
│       │                                                   │
│ Claude│                                                   │
│  logo │                                                   │
│Claude │                                                   │
└───────┴───────────────────────────────────────────────────┘

Selecting Claude replaces only the right pane with the complete Claude card: Claude support,
Session directories, plugin/listener facts, a flat **Store latest user question** row whose small
Switch authorizes only live Claude Hook capture, and the state-driven setup/reload/repair surface.
```

The rail is a vertical tablist, not a connection control. Click, Arrow Up/Down, Home, and End select
and focus a provider with roving tabindex. It remains fixed while the two `v-show` detail panes own
independent scrolling and stay mounted, so switching never loses local setup or copy state. Claude
stays selectable while Claude support is Off. At less than 480px the rail shrinks to 52px, visible
labels hide, and accessible provider names remain.

App Server Connect/Disconnect never installs or removes observation. The observation header keeps
local installation, Codex trust, and current listener distinct through its aggregate label and
state-specific sentence. It reports **Installed, paused** rather than **Observing** when trusted
hooks exist but the listener is not running. A user who skipped trust or disabled a hook sees the
external Settings instruction and retains **Check status**; there is no unsupported in-app Review
action.

The Codex observation card is a flat status-first settings list, not a guide or wizard. Its header
always exposes aggregate status and **Check status**. Internal rows place their mini button or Switch
on the right. Install/Repair, external Settings, and Remove rows render only in states where they
are actionable: observing never repeats enable/trust instructions, and absent observation never
shows an empty Remove row. The external `Codex → Settings → Hooks` row appears only when review is
required, has no control, and names the exact owned set: `SessionStart`, `UserPromptSubmit`,
`PermissionRequest`, and `Stop`. Users turn on and trust those definitions in Codex; `/hooks`
remains a valid CLI inspection route. Only that attention row uses the existing pale amber
treatment. There are no numbered steps, nested cards, facts box, Hook chips, explanatory
paragraphs, or bottom action cluster.

The Codex observation card includes a default-off **Store latest user question** switch. Its
complete consent, busy, cleanup, error, and privacy contract lives in
[EyesOnAgents Last User Prompt](../features/eyes-on-agents-last-user-prompt.md). The connection
drawer never displays question text; the ThreadCard may display only the normalized bounded value
under the optional presentation contract below.

The Claude section reports metadata discovery, plugin installation, listener state, and last
committed Hook receipt separately. It does not enumerate unrelated plugins and never claims Hook
coverage merely because installation files exist. Its user-scope plugin is required for timely
working/completion status in local CLI and Desktop Code sessions. Archive/unarchive comes from the
read-only Desktop `isArchived` metadata scan, not from Hook trust.

The Claude latest-question Switch is independent from the Codex Switch and is also default-off. It
permits one bounded preview only on a live `UserPromptSubmit` delivery. Its helper/output queue stays
metadata-only, and Claude JSONL content is never parsed to backfill a missed question. The row uses
the same quiet label/copy-left, small-control-right settings-list treatment and adds no nested card.

The Claude setup surface is state-driven rather than an always-visible checklist. **Enable Claude
observation** performs marketplace, install, and enablement work; **Finish setup** safely rebuilds
an exact interrupted installation on a fresh listener generation; **Open new Claude session** uses Anthropic's
published Desktop route so the enabled plugin loads in a fresh session; **Copy `/reload-plugins`**
handles an already-open Claude session; **Repair** is reserved for proven drift/error.
The first committed event updates the card automatically, so Check status is secondary diagnostics,
not the final setup step. `/hooks` appears only under **Still not working?** troubleshooting.
An ordinary Bitterless update silently upgrades a strictly owned exact installation while retaining
its installation identity and pending deliveries; it does not present Repair just because the app
version changed. Check status also preserves an already-running listener and live working card.

The Claude header pairs the existing status pill with one small Arco Switch labelled
**Claude support**.
It is the provider-level support switch, not the plugin lifecycle action. Turning it off folds the
card to one neutral line and leaves no directory, receipt, setup guide, or plugin action visible:

```text
┌ Claude observation · Off                    Claude [off] ┐
│ Claude observation and tasks are paused. Codex continues.│
└────────────────────────────────────────────────────────────┘
```

The folded state adds no separator, border, shadow, or extra status row. Existing Claude cards are
removed from Focus and its Project/title filters in one snapshot update;
their persisted annotations return when the provider is enabled. The switch remains available when
the saved preference is invalid so it can replace the value. The existing plugin removal control is
labelled **Remove plugin**, avoiding ambiguity with the provider switch.

The Claude card also contains one compact **Session directories** block before the state-driven
setup action. It
uses the card's existing quiet neutral background hierarchy and no decorative border or shadow.
The current config directory appears in a bordered, read-only Arco Input so it can be selected and
copied but not edited into an untrusted renderer-supplied path. **Change** opens Main's native folder
picker. Custom mode adds **Use automatic**; unhealthy states add **Retry**. Canceling the picker is a
no-op, while a successful choice persists and immediately applies the directory.

```text
┌ Session directories ─────────────────────────────────────┐
│ Watching                                                  │
│ [ /Users/ral/.claude__________________________ ] [Change] │
│ Automatic · Desktop metadata detected                     │
│ Last successful scan 10:42                                │
│                                              [Retry]      │
└───────────────────────────────────────────────────────────┘
```

The block reuses system typography and Royal Blue actions. Its only emphasis is the state text;
there is no additional provider badge or animation. Long paths remain one line, ellipsize in the
input, and expose the full configured value through the input/tooltip. Buttons use the existing
mini size and wrap below the input on narrow drawers.

| directory state | visible behavior |
|---|---|
| automatic + watching | resolved config root, Automatic label, last successful scan |
| custom + watching | canonical selected root plus **Use automatic** |
| waiting | directory is valid but `projects` has not appeared; show next retry, not an error |
| degraded | another source remains watched while the configured transcript source is unavailable |
| retrying | retain path and persisted tasks; show bounded error, next retry, and **Retry** |
| error | malformed saved config or unsafe directory; watcher stopped, Change/Use automatic remain |
| stopped | signed-out/shutdown state; never claim watching |
| choosing/applying | disable competing Claude directory actions; keep the last snapshot visible |
| Claude provider disabled | fold the Claude card to its switch and one explanation; hide every Claude task without deleting it |
| Claude provider enabling/disabling | disable the switch and all connection actions; persisted Off immediately gates every subsequent snapshot, while On keeps Claude rows hidden until cleanup and the full refresh complete |

Changing directories does not clear the board. It removes stale Preview availability until the new
root rediscovers the matching UUID, then restores Preview without moving the card or changing its
Domain/unread/archive state. Hook plugin actions and directory actions have separate busy keys and
neither one implies the other is installed.

Clicking Add Domain opens a compact form anchored below the menubar control. The input receives
focus, uses the existing required/duplicate/`All` validation, and creates through the existing store
action. Escape, Cancel, outside dismissal, and success close and reset it. Domain creation is never
rendered as a board column.

Errors stay in this panel and as a compact board banner. They never clear already persisted threads.
The header Refresh action reconnects when necessary and reconciles active plus archived inventories;
it is always visible as the manual fallback for missed activation or lifecycle updates. The
automatic ten-second refresh skips rather than queues a tick while any snapshot load, connection,
sync, board action, or earlier poll is in flight. It never overrides an explicit Disconnect, starts
a second interval, or adds a Hook polling path. Its dedicated background promise does not drive
either Refresh loading indicator. Each tick processes the 40 most recent persisted All rows, then
one round-robin cold page of at most 40, updating title, runtime/activity, and opted-in
latest-question data; activation and manual Refresh retain full inventory reconciliation.

## Focus column

The Focus header contains the target glyph, the plain `Focus` title, one icon-only Search toggle, and
`Read all`. The title is a non-editable heading: there is no inline edit, content-measuring input,
overflow menu, Delete action, drag handle, or reorder affordance anywhere in the header. No thread or
filtered-result count is rendered there.

`Read all` is always present to keep the header stable and is disabled when no completed unread
attention item can be cleared. While its mutation is in flight it shows the existing mini-button
loading treatment and is disabled with the other foreground board actions.

Focus is one continuous warm attention background surface: its header has no divider or independent
card background, so its distinction does not depend on a border, top rule, or shadow.

The scrollable column body has no top padding, so the search row, Project filter, or first thread
begins directly below the header region. It retains 9px horizontal and bottom padding for
column-edge spacing.

The Search toggle expands a compact title-filter row directly under the header and moves focus into
its input; `Cmd+F` does the same. Its token matching, clear, and Escape contract is defined in
[Focus search](#focus-search). The row and its controls use quiet background contrast, mini sizing,
visible focus, and no decorative border or shadow.

Below the search row sits one compact Project filter. It is a searchable mini Select with `All`,
`No project`, and one option per current Git Project across every visible thread. Options include
counts; same-named Projects expose a shortened root. The Select uses a quiet background instead of a
decorative border and retains a visible keyboard focus outline. Filtering is renderer-session state
and never changes the stored Domain of any thread. Project option counts remain available inside the
filter, without adding a separate header count row.

Both filters narrow the same list and compose. The column empty state names the active narrowing
reason: title search, selected Project, or `No project`.

The Focus header's `Read all` is a compact text action with the same transparent, borderless header
treatment. Clicking it clears the persisted unread marker for every currently visible unread
thread in a confirmed terminal state — `idle`, `failed`, or `ended` — in one SQLite mutation. The
same snapshot removes each corresponding red Open dot in place; because Focus now lists every
visible thread, an acknowledged row stays on the board without its dot instead of leaving. Working,
waiting, and `unknown` rows are deliberately not acknowledged: they retain the
latent unread marker that makes a later idle transition visible even if its terminal event is
missed. The action is enabled only while such a terminal unread row exists, never opens Codex or
changes `last_opened_*`, and a later accepted active or terminal observation may set a cleared
thread unread again.

Thread cards are not draggable and there is no drop target: Domain assignment has no UI. Stored
`domain_id` values keep their last value and are never rewritten from this surface.

## Thread card

A card displays only observation metadata:

- a compact accessible official provider mark before the title: Codex GA or Claude Spark, with no
  badge, border, new row, or provider-colored card surface;
- title, falling back to a shortened UUID; its default/minimum height is one 18px line and it grows
  only when text wraps, up to a 36px/two-line maximum before clamping;
- a compact loading indicator to the title's right while the thread is actively working, waiting for
  approval, or waiting for input;
- one optional quiet question echo between title and actions: the bounded latest user question on
  `available`, localized **last user question pending** on `pending`, and no row on `unavailable`;
- relative last-activity time at the far left of the action row, derived from one renderer-global
  reactive clock that advances every 10 seconds so visible cards update without receiving a new
  thread snapshot;
- working-directory folder, icon-only `Open`, and the overflow control grouped
  at the right of the same action row; the folder exposes the full path through
  tooltip/accessibility text. Claude rows without a trusted Desktop Open route do not render;
- the overflow (`…`) control renders only when it owns an action — today the Claude
  **Preview transcript** option for a row with a canonical JSONL. There is no `Move to Domain`
  group, so a row with no available action shows no empty menu;
- an unread red dot at Open's upper-right when Open exists, otherwise at the overflow control, or as
  a standalone action-row marker when neither exists, when `isUnread` is
  true and runtime is terminal (`idle`, `ended`, or `failed`) after a reply finishes. Working,
  waiting, and unknown cards never show this dot.

The action row uses 20px control boxes so it, not Arco's default 24px mini-button height, determines
the compact card height. Its folder, Open, and More glyphs are respectively 10px, 9px, and 12px —
each 4px smaller than the preceding card treatment. Tooltips, focus, click targets, and loading state
remain attached to the full control box rather than the glyph alone.

The presentation clock is renderer-local and transient. One store-owned interval serves the whole
EyesOnAgents window; thread cards never create their own timers, and clock ticks never trigger IPC,
App Server synchronization, Hook inspection, or persistence.

The card has no separate status or metadata row. It is an unbordered white item with a compact
radius and no persistent shadow. Pointer hover
uses a slightly tinted background and Todo-strength light shadow, with no vertical lift. Keyboard
focus uses a light Royal Blue background plus an explicit focus outline. The loading indicator and
terminal-unread dot are the only visible status marks and do not create another visual region. The card
and Open control keep localized runtime/unread accessibility text for the state currently shown,
so these states do not depend on color alone.

Every rendered card has an interactive Open and participates in card-level keyboard focus; `Open`,
double-click, or `Enter` then launches the provider desktop UI and marks a confirmed terminal
observation read after the fixed deep link is accepted. Codex uses `codex://threads/<uuid>`. A
Claude row with a unique `desktopSessionId` uses
`claude://claude.ai/epitaxy/<desktopSessionId>`. Claude rows without that trusted Desktop route are
Main-private inventory and do not render in Focus, its Project filter, or its title filter. A
visible Claude card's More menu exposes **Preview transcript** when a canonical JSONL exists.
Selecting or previewing never marks read.

```text
┌────────────────────────────────────────┐
│ ◉ Thread title, one or two lines     ◌ │
│ latest user question…                  │  available or pending only
│ now                         [⌂][↗][…] │
└────────────────────────────────────────┘
```

The question echo is 11px/14px, single-line, muted, and ellipsized. It has no icon, label badge,
border, background, or spinner. Display-only whitespace folding does not rewrite SQLite. Its native
tooltip and card accessibility label retain the full stored bounded preview and disclose
truncation. Pending says **待同步/pending**, not **fetching**, because the App Server may be offline.

Cards sort by attention first. Active cards use persisted `status_observed_at` descending within
the same attention rank, representing the time the task entered its current working/waiting state.
Reply, title, question, and `last_activity_at` refreshes cannot move an active card. A missing or
invalid active timestamp sorts as zero rather than falling back to message activity. Non-active
cards keep `last_activity_at` (then completion time) descending. Every equal-rank/equal-time result
uses immutable provider-qualified session key ascending, so SQLite input order cannot move a card.
Thread order is intentionally not separately persisted.

## Focus ordering

Focus lists every visible thread — not only attention items — and orders them with the same
comparator it always used. Expanding membership must not change ordering:

1. waiting for approval;
2. waiting for user input;
3. working;
4. newly completed unread;
5. newest current-state entry within the same active group;
6. newest activity within the same non-active group;
7. provider-qualified session key ascending as the stable final tie-breaker.

The single Focus list owns this comparator. The hot/cold SQLite refresh
pages continue to use activity order for fetch-budget allocation; they do not define presentation
order. A genuine runtime transition may change `status_observed_at` and reposition a card, while a
reply-only metadata update may not.

Opening any card records deep-link evidence only after the deep link succeeds, and acknowledges
unread only for a confirmed terminal card. An acknowledged card drops out of the unread rank and
sorts among ordinary threads by activity; it stays on the board. A working,
waiting, or `unknown` card keeps its active rank and its latent unread marker
until its state actually resolves.

## States

| state | visible behavior |
|---|---|
| first launch, disconnected | connection callout plus persisted board if any |
| connecting | dot and button spinner; existing content remains interactive |
| syncing or connecting | existing cards retained; duplicate Refresh disabled |
| no threads | concise prompt to connect/sync; no fake sample rows |
| threads exist, no filter | every visible thread in comparator order; a read thread stays listed |
| working unread | title-side loader; no Open unread dot |
| working opened | card keeps its active rank and loader; only a terminal observation can retire it |
| working completes to idle unread | loader disappears; unread dot appears at Open's upper-right |
| new idle/unread completion | the supplied tone plays once and one localized system notification names the thread |
| latest question available | one muted, ellipsized question line; tooltip/accessibility retain the bounded preview and disclose truncation |
| latest question pending | one muted localized pending line; no spinner or false claim that a request is running |
| latest question unavailable/default-off | no question line and no additional card height |
| Project filter has no matches | selected option remains available with scoped empty text |
| search row collapsed | Search icon remains in the Focus header; no title query narrows the list |
| search row open, empty query | compact focused input plus explicit Clear control appears above the Project filter; the full list remains |
| search query has no matches | title-search-specific empty text appears inside the column |
| both filters active, no matches | title-search empty text takes precedence over the Project message |
| `Cmd+F` pressed again | the row stays open, the input regains focus, and the query is preserved |
| App Server error | neutral/error banner with retry; header Refresh remains available and persisted states are not rewritten |
| bridge absent | App Server remains usable; Desktop coverage note appears in connection panel |
| any Codex bridge state | aggregate status sentence, **Check status**, and the default-off latest-question Switch remain visible; other rows are state-specific |
| Codex bridge absent | show **Install Bitterless hooks → Enable**; hide external Settings and Remove rows |
| Codex bridge drifted | show **Install Bitterless hooks → Repair** and Remove; hide external Settings until Codex actually requests review |
| Codex bridge needs review | show only the amber `Codex → Settings → Hooks` instruction with the exact four Hook names, plus question permission and Remove; no in-app Review action |
| Codex bridge trust inspection unavailable | status stays unavailable with **Check status**; no ordered/manual guide or claim that Hooks are trusted |
| Codex bridge disabled | external Settings row tells the user to turn on the exact four Hooks in Codex; Bitterless exposes no Review/re-enable control |
| Codex bridge installed, listener stopped | explicit `Installed, paused`; hide enable/trust instructions and never claim live observation |
| Codex bridge observing | show question permission and Remove only below the header; do not repeat installation or trust instructions |
| unknown runtime | accessible runtime label remains `Unknown`; no active loader is shown |
| Claude Desktop archived | explicit metadata transition hides the row; unarchive restores its Domain/read state |
| Claude Desktop deleted | explicit `deleted_<uuid>` tombstone removes the row from every board/search surface; residual JSONL and late Hooks do not restore it |
| Claude CLI-only inventory | retained internally for reconciliation but absent from board/search until a trusted Desktop mapping exists |
| Claude provider off | Claude rows and controls are absent from the board/search; Codex remains fully interactive |
| Claude setup interrupted after exact install | one **Finish setup** action rebuilds the owned plugin generation; no dead-end Needs review guide |
| Claude plugin installed, receipt pending | **Open new Claude session** is primary, Copy `/reload-plugins` is secondary, and status updates automatically |
| exact Claude plugin, listener stopped | explicit **Listener paused** with one primary **Retry listener**; failure stays visible |
| Claude observing | setup action and troubleshooting stay hidden; Check status and Remove plugin remain secondary controls |
| long title/path | title grows from one 18px line to at most two/36px; folder metadata stays icon-only with full-path tooltip |

## Accessibility and responsive behavior

- Interactive controls have visible keyboard focus and accessible labels.
- Status never depends on color alone: the card's accessible label retains normalized runtime and
  unread text, the active loader has a status label, and visible idle-unread augments Open.
- At every supported window size the Focus column keeps its fixed 300px width and full available
  height; it never shrinks, stretches, or wraps, and the board does not scroll horizontally.
- A long thread list scrolls inside the column body, so the board itself never scrolls vertically.
- Dialogs and connection panels remain within the viewport and own their vertical scrolling.
- The Focus filter row is a plain search input over the real card list, so filtered results keep
  normal card semantics and card-level keyboard focus.
- The only card-level animation is the working loader; it becomes static under reduced-motion.

## Component boundary

```text
MiniApp card -> EyesOnAgentsWindowHandler -> standalone renderer

EyesOnAgentsApp
  ├─ EyesOnAgentsMenuBar
  ├─ ConnectionPanel
  │    ├─ CodexConnectionSection
  │    └─ ClaudeConnectionSection
  └─ AgentBoard
       └─ FocusColumn (every visible thread)
            ├─ title filter row
            ├─ ProjectFilter
            └─ ThreadCard × N
```

Components may follow Todo's interaction pattern, but they must not import Todo-private stores or
business components. State lives in a dedicated reactive class store; Vue components remain thin.
