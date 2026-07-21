# EyesOnAgents Hook Guide Review — Round 1

Status: blocked

Date: 2026-07-20

## Findings

### P2 · blocking — the new guide colors violate the Bitterless `oklch()` CSS contract

The task explicitly requires the guide to follow the project's `oklch`/BEM conventions, while the
new rules introduce hex colors for the summary, headings, markers, CLI hint, and trust boundary,
plus `rgb(...)` backgrounds for the steps and boundary
(`src/renderer/eyesOnAgents/src/components/ConnectionPanel/ConnectionPanel.less:145-198`).
Bitterless CSS requires colors to use `oklch()`. Convert every color introduced by this task to
`oklch(...)` (including alpha colors) or an existing `oklch` token. The new BEM names themselves
are within the project's depth limit.

No other P1, P2, or P3 finding was found.

## Conclusion

**Blocked.** The user-visible behavior matches the Hook trust-guide contract, but the explicit
Bitterless color-format rule remains unmet. Re-review after the added hex/rgb declarations are
converted to `oklch()` values or existing compliant tokens.

## Static contract assessment

- The guide remains visible for the existing `needs_trust` and `error` guidance states, retains the
  reason-specific summary, and limits the live `role="status"` region to that summary.
- Disabled-state copy uses the existing `Re-enable and review` action label and tells users to
  select Trust only for definitions Codex marks for review; it does not claim all four Hooks always
  require a new Trust action.
- Step 1 says the action opens Codex Settings. Step 2 separately tells the user to navigate to
  Settings → Hooks or use `/hooks`, so `codex://settings` is not presented as a direct Hooks link.
- The component renders one semantic ordered list with exactly three steps. The guide uses the
  existing amber container plus background contrast and adds no border, shadow, modal, or settings
  surface.
- English and Chinese expose the same guide keys, including the `{action}` interpolation, and the
  component contains no hardcoded user-facing guide copy.
- The reviewed diff leaves Review, Check again, and Disable handlers wired to
  `reviewCodexBridge()`, `refreshCodexBridgeStatus()`, and `removeCodexBridge()` respectively. It
  adds no renderer hook key/hash/config payload or trust mutation path.

## Verification

Per owner instruction, this review ran no tests, build, formatter, typecheck, or Electron process.
The assessment used only the task/context documents, current source, source guards, and `git diff`.
Only this review document was added by the reviewer.
