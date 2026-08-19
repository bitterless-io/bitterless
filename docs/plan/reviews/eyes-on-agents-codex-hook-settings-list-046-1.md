# EyesOnAgents Codex Hook Settings List — Independent Static Acceptance

Status: static accepted; owner E2E pending

Date: 2026-08-18

## Verdict

**Static acceptance: Closed — PASS, with no open P1, P2, or P3 finding.** The refrozen source now
matches the requested status-first settings surface: current status and **Check status** stay at the
top, internal rows always pair a task with a control, and the only control-free row is the
Codex-external Hooks instruction. Full implemented-product closure remains pending Ral's requested
end-to-end run.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None open. The first frozen candidate's three P2 findings were resolved:
  complete rows are now state-filtered, the latest-question support text is one short line, and the
  integration/feature contracts no longer describe the removed Review wizard.
- **P3 · non-blocking:** None.

## Acceptance object and closure matrix

- Entity: the Bitterless-owned Codex observation Hook set and its user-visible aggregate status.
- User: Ral connecting Codex observation from the Agent connections drawer.
- Entry point: **Agent connections → Codex → Codex observation**.
- Successful terminal state: the header truthfully reports **Observing** or **Installed, paused**;
  every visible internal row has an executable control, every external row is relevant guidance,
  and **Check status** can re-evaluate the state.
- Product/design owner: Ral. Implementation owner: task-046 Develop agent. Independent static
  acceptance: this review. Runtime acceptance owner: Ral.

| Operation | User path | System behavior | Static evidence | Status |
|---|---|---|---|---|
| Create/repair | Enable when absent; Repair on drift | Calls the existing semantic install action | The complete row appears only for `not_installed` or `drifted`, with exactly one matching button | Complete at static level |
| Read/check | Read header; select Check status | Shows aggregate label plus reason-specific sentence and refreshes status | Status pill, bounded sentence, and permanent top action are present for every state | Complete at static level |
| Update externally | Follow Codex → Settings → Hooks | Names all four owned hooks; Codex owns enable/trust | The amber control-free row appears only for `needs_trust` | Complete at static level |
| Update privacy | Toggle Store latest user question | Uses the existing independent preference action | The Switch remains paired with one concise local-preview line | Complete at static level |
| Remove | Select Remove when installation may exist | Calls the existing semantic remove action | The complete row is absent for `not_installed` and present for the remaining aggregate states | Complete at static level |

## State and recovery acceptance

| State | Header truth | Visible recovery/settings rows | Result |
|---|---|---|---|
| `not_installed` | Not installed plus Enable guidance | Enable, question Switch; no empty Remove or external Settings row | PASS |
| `drifted` | Needs repair | Repair, question Switch, Remove | PASS |
| `needs_trust: untrusted` | Needs review in Codex | Amber Settings → Hooks instruction naming all four Hooks, question Switch, Remove | PASS |
| `needs_trust: disabled` | Disabled in Codex | Same external row instructs turning on the exact set; no unsupported in-app Review action | PASS |
| `needs_trust: modified` | Definitions changed | Same external row instructs review/trust of the current set | PASS |
| `installed/listening` | Observing; listener receiving events | Question Switch and Remove only; no repeated install/trust instruction | PASS |
| `installed/not listening` | Installed, paused | Question Switch, Remove, and top Check status; never claims observation | PASS |
| `error` | Status unavailable with bounded generic error | Top Check status, question Switch, Remove; no guessed Hook or trust claim | PASS |

## Product and design evidence

- The top hierarchy is concise and scan-oriented: title on the left; current status and
  **Check status** grouped on the right; one status sentence directly below.
- The flat list uses one white card, 1px hairlines, 50px row rhythm, 12px labels, and compact 10px
  support copy. It adds no nested card, numbered guide, facts box, chip set, shadow, or bottom
  action cluster.
- An internal operation never remains as an empty label row. The external Codex instruction is the
  sole intentional no-control row and appears only while Codex-side work is required.
- The external row names `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, and `Stop`
  exactly, with no fake deep link or per-Hook mutation control.
- The latest-question row now reads `Off by default · one local question preview` /
  `默认关闭 · 仅保存一条本地问题预览`; the full privacy and clearing contract remains in the
  feature documentation instead of expanding this settings list.
- Amber emphasis is limited to `needs_trust`. Error copy is bounded upstream and does not expose
  raw Hook keys, commands, hashes, or filesystem paths.
- The provider tablist and the mounted Claude pane remain intact in the refrozen source; no
  task-046 change redirects Codex actions into Claude or provider navigation.

## Documentation consistency

- The installation/trust matrix maps each aggregate state to the new Enable/Repair, external
  Settings, Check status, and Remove paths.
- The integration acceptance matrix explicitly covers absent, drifted, review-required, disabled,
  error, installed/paused, and observing states without retaining Review/Check again language.
- The older semantic `reviewCodexBridge()` helper is documented as compatibility-only and is not
  rendered by this UI.

## Owner E2E checklist

- [ ] Confirm each aggregate state shows the expected status sentence and only its relevant rows.
- [ ] Confirm **Check status** refreshes trust/listener state without changing App Server intent.
- [ ] Confirm Enable, Repair, question Switch, and Remove retain their existing effects and busy
  behavior.
- [ ] Confirm the Codex Settings instruction is present only for review states and all four Hook
  names fit legibly.
- [ ] Switch Codex/Claude tabs and confirm Claude state/actions remain unchanged.

## Verification boundary

Per Ral's instruction, this review ran no automated test, typecheck, build, renderer, Electron,
browser automation, or visual harness. It is based only on the refrozen source and documentation
diff. The review writes only this file and does not modify the implementation. Runtime/E2E behavior
is intentionally not claimed until Ral completes the handoff checklist.

