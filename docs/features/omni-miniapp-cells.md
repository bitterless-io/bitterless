# Omni Browser And Mini-App Cells

Status: Accepted

## Purpose

Omni layout cells can render either a remote browser page or one of two first-party Bitterless
mini apps. The supported mini apps are exactly `todo` and `eyesOnAgents`. They render directly in
the cell operation `WebContentsView`; selecting one must not create or depend on its standalone
window.

## Overall Structure

```text
┌────────────────────────────── Omni BaseWindow ──────────────────────────────┐
│ Omni menubar                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ Cell A                                      │ Cell B                        │
│ ┌──────── browser chrome (browser only) ──┐ │ ┌──── local mini app ──────┐ │
│ │ back · forward · refresh · URL          │ │ │ own embedded app header  │ │
│ ├─────────────────────────────────────────┤ │ ├──────────────────────────┤ │
│ │ operation WebContentsView               │ │ │ operation WebContentsView│ │
│ │ remote webpage                          │ │ │ first-party renderer     │ │
│ └─────────────────────────────────────────┘ │ └──────────────────────────┘ │
├──────────────── layout mode overlay (when open) ────────────────────────────┤
│ Per-cell configuration panels: split · Browser/Mini App · target · close   │
└─────────────────────────────────────────────────────────────────────────────┘
```

The Omni shell owns cell creation, bounds, persistence, and content-runtime selection. Todo and
EyesOnAgents continue to own their business state and XPC handlers.

## Per-Cell Layout Panel

```text
Browser cell
┌───────────────────────────────────────────────────────────────────────────┐
│ [split controls]  [ Browser | Mini App ]  [ https://...             ] [×] │
│ ┌──────────────────────────── preview / cell id ─────────────────────────┐ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘

Mini-app cell
┌───────────────────────────────────────────────────────────────────────────┐
│ [split controls]  [ Browser | Mini App ]  [ Todo ▾ ]                [×] │
│                                             ├ Todo                         │
│                                             └ EyesOnAgents                 │
└───────────────────────────────────────────────────────────────────────────┘
```

- Use Arco controls for the binary mode selector, mini-app select, buttons, and inputs.
- Use Tabler icons for split, navigation, refresh, and close actions.
- Use business BEM classes in sibling Less files. Do not add Tailwind or atomic utility classes.
- All labels, tooltips, empty/error text, and accessible names come from shared renderer i18n.

## Persisted Content Contract

Each leaf persists these values inside the existing `omni_layout` tree:

| Field | Contract |
|---|---|
| `contentMode` | `'browser' | 'miniapp'` |
| `url` | Last browser URL. Preserved while the cell displays a mini app. |
| `miniAppId` | `'todo' | 'eyesOnAgents'`. Preserved while the cell displays a browser. |

Rules:

1. A newly created leaf starts as `browser`, using the existing default URL, with `todo` retained
   as its initial mini-app choice.
2. A legacy persisted leaf without `contentMode` migrates to `browser` and preserves its URL.
3. Switching modes is non-destructive: browser URL and mini-app selection survive round trips.
4. Selecting a mode or mini app applies immediately and persists the complete tree through the
   existing `SettingDao` key `omni_layout`.
5. Splitting preserves the original leaf's complete content configuration; the new leaf uses the
   default browser configuration.
6. Unknown modes and mini-app IDs fail explicitly. A failed persisted-layout load shows a localized
   recovery error and keeps a default browser leaf; it must not silently open an arbitrary target.

## Runtime Mapping

| Content | Operation preload | Development renderer | Packaged renderer | Session |
|---|---|---|---|---|
| Browser | `out/preload/omniCellContent.js` | user URL | user URL | `persist:omni` |
| Todo | `out/preload/todo.js` | `${ELECTRON_RENDERER_URL}/todo/index.html` | `out/renderer/todo/index.html` | default |
| EyesOnAgents | `out/preload/eyesOnAgents.js` | `${ELECTRON_RENDERER_URL}/eyesOnAgents/index.html` | `out/renderer/eyesOnAgents/index.html` | default |

Generated preload and packaged renderer paths are anchored at `app.getAppPath()/out`; they never
depend on a Rollup chunk's `__dirname`. Development first-party renderers use the Electron Vite dev
server URL, while packaged renderers use `loadFile`.

Changing `contentMode` or `miniAppId` recreates the affected operation view with the correct
preload. It does not recreate the Omni BaseWindow or open a standalone Todo/EyesOnAgents window.
Remote-browser notification interception, Chrome user agent, persistent browser session, and URL
navigation hooks apply only to browser cells.

Mini-app operation views are privileged because their preload exposes first-party XPC. They must
reject top-level navigation away from the expected local renderer target. New-window requests and
external `http`/`https` links may be handed to the system browser, but must never load inside the
privileged operation view. Remote browser cells can never receive a Todo or EyesOnAgents preload.

## Embedded Mini-App Behavior

- Todo and EyesOnAgents receive static preload context identifying `home`, `standalone`, or `omni`
  hosting as applicable. Todo refreshes its own store when embedded; it must not call a window
  handler that only tracks the Home and standalone Todo views. It may offer an explicit “open in
  window” action, but its in-cell operation does not require that window.
- EyesOnAgents in the Omni host hides
  standalone-window actions such as pin, minimize, maximize, close, and title-bar double-click,
  while keeping board, sync, connection, and bridge actions available.
- Mini-app cells do not render Omni's browser chrome above the app's own header. Embedded host
  styles remove standalone drag regions, macOS traffic-light padding, and fixed 800×600 renderer
  minimums so split panes can shrink without forcing overflow.
- Multiple cells may show the same mini app. Each renderer reads the same authoritative local
  services and remains synchronized through existing XPC broadcasts.
- Closing a cell destroys only that cell's chrome and operation views.

## Interaction Contract

| Input | Scope | Behavior |
|---|---|---|
| Browser/Mini App selector | Layout panel | Switch content runtime, apply, and persist immediately. |
| Mini-app select | Mini-app panel | Allow only Todo or EyesOnAgents; recreate operation view and persist. |
| URL Enter | Browser panel | Normalize/load the URL and persist navigation updates. |
| Refresh | Browser chrome / mini-app header | Reload browser content or refresh the mini app's own data. |
| Back/forward | Browser cell only | Navigate browser history; hidden/disabled for mini apps. |
| Split | Layout panel | Preserve original content and create a default browser sibling. |

## State Variants

- **Legacy:** missing content fields migrate to browser without losing the saved URL.
- **Loading:** operation view remains bounded while its selected remote/local target loads.
- **Invalid persisted state:** show a localized layout-load error and retain one default browser
  cell.
- **Packaged target missing:** fail with a target-specific error containing the expected renderer
  or preload path; never fall back from a mini app to an unrelated remote URL.
- **Constrained:** the panel keeps the mode selector and close action reachable; the target input
  may shrink but must not force the cell outside its split bounds.

## Integration Flow

```text
Omni layout panel
  -> layout.store mutates leaf + flattens complete cell config
  -> OmniWindowHandler.updateLayout
  -> OmniWindowHelper compares each cell runtime signature
  -> recreate changed operation WebContentsView
  -> load remote URL OR first-party dev/file renderer

SettingDao.omni_layout
  -> normalize legacy/current tree
  -> restore complete leaf configs
  -> create matching browser/mini-app operation views
```

## Verification Contract

- Contract tests cover legacy migration, allowed variants, round-trip persistence fields, and
  rejection of unsupported mini apps.
- Runtime tests cover browser/Todo/EyesOnAgents preload selection and dev versus packaged targets.
- UI guards cover Arco mode/select controls, exactly two mini-app choices, i18n, business BEM/Less,
  embedded sizing/window-action behavior, and the absence of Tailwind classes.
- Build verification confirms both mini-app renderer HTML files and both preload bundles exist in
  `out/` and are referenced by generated-asset-safe paths.
