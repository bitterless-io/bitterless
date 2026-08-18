# EyesOnAgents Provider Glyph Refresh — Independent Acceptance

Status: accepted

Date: 2026-08-18

## Verdict

**PASS — no open P1, P2, or P3 finding.** Codex uses Tabler `IconPrompt`, Claude uses
`IconSparkles`, both render at 13px in the existing fixed 13×18px shell, and the card/search
placements retain tooltip, localized accessible naming, muted provider colors, and their existing
row heights. The two silhouettes remain distinct without color and introduce no badge, border,
background, or shadow.

The re-review also confirms that the canonical feature and layout contracts consistently name the
new Tabler pair; no retired-glyph wording remains in the task scope.

## Findings

None. The first pass found one P3 wording conflict in the Thread-card section of the layout
contract. It was corrected to the Tabler Prompt/Sparkles pair and the current tree was re-reviewed;
the finding is closed.

## Product and accessibility evidence

| Contract | Evidence | Result |
|---|---|---|
| Codex mark | `ProviderGlyph.vue:10,18` uses Tabler `IconPrompt` at 13px | PASS |
| Claude mark | `ProviderGlyph.vue:11,18` uses Tabler `IconSparkles` at 13px | PASS |
| Fixed title-line footprint | `ProviderGlyph.less:1-8` remains 13×18px with a fixed 13px flex basis | PASS |
| No decorative regression | Glyph styles contain no background, border, shadow, or animation | PASS |
| Color-independent distinction | command prompt and three-spark silhouettes differ in geometry, not just hue | PASS |
| Tooltip and accessible name | one localized `providerLabel` supplies both tooltip content and `role="img"` ARIA label; child SVGs are hidden | PASS |
| Existing placements only | `ThreadCard.vue:15` and `ThreadSearch.vue:68` reuse the same component in their existing title headings | PASS |
| Compact optical check | Tabler's default outline paths remain recognizable at actual 13px; neither changes the 18px title-line box | PASS |

## Independent verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents:ui` | PASS — 56 tests |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn check:renderer-i18n` | PASS |
| `git diff --check` | PASS |
| stale retired-glyph search | PASS — no match in docs, implementation, or EyesOnAgents tests |

No Electron process was launched during this independent acceptance pass.
