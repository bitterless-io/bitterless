---
id: trench-single-page-workspace-008
scope: Single-page Trench workspace, bounded thesis review, and visible/hidden X Chrome
status: implemented-owner-verification-pending
depends-on: [coin-ai-analysis-004, coin-gmgn-only-local-mode-007]
---

# Trench Single-page Workspace

## Objective

Replace the existing top-tab Coin interface with one practical Trench research desk where Ral can
paste a CA, inspect scan/focus signals, keep one token's evidence visible, ask Codex to challenge a
thesis, and open a controlled X research session without losing context.

## Confirmed decisions

- The old Monitor/Screener/Meme/Strategy/History top-tab design is superseded; do not preserve it as
  an alternate mode.
- Use Arco and the existing Bitterless Royal Blue theme. Keep surfaces flat and remove unnecessary
  borders, nested cards, shadows, aggregate KPI counts, and decorative statistics.
- The command bar always exposes chain, CA, Paste and analyze, one-shot Terminal analysis, X Chrome,
  shared Codex status, model, and effort.
- Scan, Focus, active token evidence, and Decision share one page. Resources and History remain
  secondary surfaces and restore the same workspace context when closed.
- Decision input is one bounded user thesis attached to the current CA, evidence revision, strategy,
  model, and effort. It is not a general chat transcript.
- X uses Playwright only. A menubar switch chooses visible Chrome or hidden headless Chrome for the
  next query; visible is the deterministic default. Both modes use the same dedicated persistent
  profile. The user logs in once while visible; v1 does not mount/copy the regular Chrome profile or
  import its cookies.
- The display preference is safe Coin workspace state. Browser status, cookies, credentials, and
  profile contents remain machine-local Chrome-owned state. Changing the switch while a managed
  context is active closes and reopens the same query in the selected mode.
- Hidden mode never changes back to visible silently. If X requires login or a challenge, the UI
  tells the user to switch to visible mode. A configured external CDP session owns its own
  visibility, so the menubar switch is disabled for that mode.
- The later X extraction stage must use accessibility locators to identify targets and CDP for every
  mouse move/wheel/press/release action. Failed login, challenge, profile lock, or configured CDP
  attachment is explicit and never changes source or profile silently.

## Workspace contract

```text
┌ Command: chain / CA / paste / terminal / X | Codex / model / effort ┐
├──────────────────┬────────────────────────────┬─────────────────────┤
│ Scan             │ Active token               │ Decision            │
│ why now / risk   │ evidence document          │ user thesis         │
│                  │                             │ Codex review        │
│ Focus            │                             │ counter-evidence    │
│ quiet / triggered│                             │ invalidation        │
└──────────────────┴────────────────────────────┴─────────────────────┘
```

At `>=1280px`, all three content regions are visible. At `960-1279px`, Decision is a right dock. At
`800-959px`, both rails are docks and only one can be open. No body horizontal scrollbar is allowed.

## Implementation scope

### Renderer

- Replace `CoinAnalysisPane` tabs with a `TrenchWorkspace` composition.
- Add a persistent command bar and use Electron clipboard access through the scoped Coin bridge.
- Reuse Meme Discover as Scan input and existing watch persistence as the initial Focus list; do not
  fabricate monitor triggers that do not yet exist.
- Embed the existing Meme analysis document as the active token canvas without duplicating its CA
  toolbar or inline AI action.
- Add the bounded Decision dock and send the user's thesis with the current structured evidence.
- Reuse existing Coin Resources and History as secondary surfaces.
- Preserve stores as `reactive(new Class())`; class instances contain data only and methods remain on
  prototypes. Browser/timer/subscription handles remain outside reactive state.

### Main and bridge

- Add allowlisted, sender-checked clipboard read IPC returning only a bounded text value.
- Add `CoinXBrowserService` with one persistent Chrome context, explicit visible/hidden launch mode,
  lifecycle serialization, bounded status, and close-on-window/app shutdown.
- Store the Chrome user-data directory below `userData/coin/x-research-profile/`; never expose its
  full path, cookies, or credentials to renderer/logs/persistence.
- Optional CDP configuration accepts loopback endpoints only and does not silently fall back to
  managed-profile mode.
- Extend AI input/receipts with a bounded user thesis. The prompt treats it as a claim to audit, not
  source evidence, and existing strict output/evidence validation remains in force.

### Persistence and migration

- Existing analyses, decisions, watch items, source-safe drafts, and AI receipts remain readable.
- Legacy `activePage` is accepted during migration but no longer drives a core tab.
- New optional fields receive deterministic defaults so existing `coin-state.json` loads without a
  destructive reset.
- X browser runtime state is Chrome-owned and must not enter `coin-state.json` or multi-device sync.
  Only the non-secret `visible | hidden` display preference is persisted with Coin workspace state.

## Acceptance

- Clicking Paste and analyze reads one clipboard value, validates it, updates the CA field, and
  immediately starts service analysis. Invalid/ambiguous input creates no run and remains editable.
- Terminal runs only the current CA through the explicit local path and never changes the default
  data path.
- Scan and Focus remain visible beside the active token on a 1360px window; selecting a row changes
  token context without implicit AI execution or Focus mutation.
- The active token report remains visible while a local refresh, X browser launch, or Codex review is
  in progress.
- User thesis, current CA, evidence revision, model, and effort are frozen into an AI receipt. Invalid
  JSON/evidence refs are rejected and earlier receipts remain unchanged.
- The menubar switch persists `visible | hidden`. Visible launch supports one-time manual sign-in;
  hidden launch reuses that dedicated session without showing a window. Switching an active managed
  session restarts the same query in the selected mode. Regular Chrome may remain open throughout.
- A hidden login requirement is explicit and asks for visible mode; no mode fallback is silent.
- Source/profile failures state the selected path and prerequisite; no fallback is silent.
- At 1360x860 and 800x600, text and controls do not overlap, long CAs do not resize the layout, and
  the page has no body-level horizontal overflow.
- The target UI contains no top business tabs, nested cards, dashboard KPI row, candidate/watch
  totals, decorative score tiles, gradients, or non-theme palette additions.

## Verification

- Static: focused TypeScript checks for main/preload/renderer and `git diff --check`.
- Contract fixtures: existing Coin state migration, clipboard sender denial, X status lifecycle,
  profile/CDP validation, and thesis-bound AI request validation.
- Visual owner pass: launch the real Electron Trench window at 1360x860 and 800x600, exercise the
  dropdowns, paste flow, dock behavior, X login, and one Codex review. Ral requested to perform the
  interactive test personally.

## Implementation result

- The tabbed renderer was replaced by the flat command/Scan/Focus/token/Decision workspace with
  responsive docks and secondary Resources/History views.
- Clipboard CA launch, explicit service/terminal paths, manual Focus, thesis-bound Codex receipts,
  shared model/effort selection, and machine-local Chrome profile ownership are wired.
- The menubar Arco switch persists `visible | hidden`, restarts an active managed context on the same
  query, and leaves external CDP visibility untouched.
- The Coin-only Vue typecheck, strict X-browser-service TypeScript check, and focused ESLint error
  check pass. The full web typecheck reaches no Trench diagnostics but remains red on pre-existing
  Connector, Poker, Home, EyesOnAgents, and path-helper errors. A strict full Node check exceeds the
  current 4 GB heap; a broader narrowed check reaches only pre-existing transitive diagnostics
  outside this task.
- Interactive Electron, responsive, X login, and Codex review verification remains with Ral by
  explicit request.

## Deferred

- Automatic drawdown/base/breakout trigger calculation and notification scheduling.
- Full X evidence extraction and heat scoring beyond opening/owning the stable managed session.
- A Chrome extension bridge for the regular daily profile.
- Wallet signing, order placement, and automated trading.
