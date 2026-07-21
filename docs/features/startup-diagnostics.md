# Startup Diagnostics

Status: Active

## Contract

SQLite-first means the Core SQLite renderer is the first application runtime started after the
minimum main-process XPC/path prerequisites. It does **not** mean that Home or unrelated startup
work waits for SQLite readiness.

Startup has two concurrent lanes:

```text
app.whenReady
    |
    +-- initialize XPC/path prerequisites
    |
    +-- start Core SQLite renderer first ---------------------------+
    |                                                              |
    +-- initialize in-memory language fallback                     |
    +-- create Home with default layout                            |
    +-- refresh helper artifacts and initialize Tray               |
                                                                   |
                                                                   +-- explicit success
                                                                   |     hydrate persisted language
                                                                   |     start SQLite-dependent integrations
                                                                   |
                                                                   +-- explicit failure
                                                                         record startup issue
```

- No elapsed-time threshold may fail, abort, or delay the foreground startup lane.
- SQLite preload, renderer, navigation, database-read, schema, or migration errors are explicit
  failures and are recorded without exiting the GUI.
- SQLite-dependent integrations start only after Core readiness, but their pending state never
  blocks Home, helper refresh, Tray, or other independent work.
- Home receives an in-memory system-language fallback before it mounts. Successful Core readiness
  later hydrates and broadcasts the persisted language.
- Home's renderer must never await language IPC before mounting its shell. It starts the shared
  subscribe-before-fetch flow, mounts immediately with the explicit bootstrap locale, and applies
  the main-owned snapshot whenever that request or a later broadcast arrives.
- The Core SQLite BrowserWindow is an internal renderer and remains hidden in every build mode. It
  must never focus, cover, or visually compete with Home while the two startup lanes run together.
- Home may restore from the Main-owned atomic window-state file before first show. It never waits
  for SQLite; an SQLite-only legacy layout may hydrate later without delaying creation.
- Startup diagnostics are main-owned, in-memory state. They cannot depend on SQLite persistence.
- Each issue has a stable stage code and a concise error message. A later successful retry clears
  the issue for that stage.

## Menubar layout

The existing Royal Blue menubar remains the visual authority. An exception is visible only while
one or more startup issues exist.

```text
┌──────────────────────────────────────────────────────────────────┐
│ BitterLess                         [ ⚠ 2 ] [Proxy]  window controls│
└──────────────────────────────────────────────────────────────────┘
                                          hover / keyboard focus
                                                    |
                                  ┌──────────────────────────────┐
                                  │ Startup issues               │
                                  │ Core SQLite                  │
                                  │ file is not a database       │
                                  │ EyesOnAgents                 │
                                  │ listener could not start     │
                                  └──────────────────────────────┘
```

- The issue control is a compact orange-red background-led button with no decorative border.
- Hover or keyboard focus opens a tooltip listing localized stage names and raw concise messages.
- The control is absent when the issue list is empty; loading alone is not an error and shows no
  warning.
- The renderer subscribes to diagnostics changes before fetching the current snapshot so failures
  that happen before Home mounts are not lost.
- Diagnostics delivery starts after the Home shell mounts; diagnostics IPC itself cannot become a
  new mount gate.

## State boundary

| Owner | State | Delivery |
|---|---|---|
| Main process | revisioned startup issue snapshot | getter plus `electron-xpc` broadcast |
| Home MenuBar store | latest accepted snapshot | subscribe-before-fetch, ignore stale revision |
| MenuBar view | issue count, localized stages, messages | conditional button and hover/focus tooltip |
