# EyesOnAgents Official Provider Logos — Independent Acceptance

Status: accepted

Date: 2026-08-18

## Verdict

**Implementation: Closed — PASS, with no open P1, P2, or P3 finding.** The frozen task-043 tree
uses the first-party Claude Spark and the Codex GA product mark as local transparent PNG assets.
The actual `ProviderGlyph` component remains optically balanced and clear at 100% CSS scale in both
ThreadCard title rhythms and ThreadSearch, without changing the established vertical geometry or
adding a logo background, border, shadow, badge, or provider-colored surface.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Acceptance object and lifecycle

- Entity: the provider identity mark shown to Ral while supervising mixed Codex and Claude tasks.
- Entry points: ThreadCard title row and global ThreadSearch result heading.
- Successful terminal state: each provider is immediately distinguishable, accurately branded,
  locally available, and accessibly named without increasing a card/search row's height.
- Product/design owner: Ral. Implementation owner: task-043 Develop agent. Independent acceptance:
  this review.

| Operation | User path | System behavior | Evidence | Status |
|---|---|---|---|---|
| Create | N/A | Static product marks are bundled release assets, not user-created records. | Task scope and local Vite imports | N/A — justified |
| Read | Open a card or search tasks | Shows the correct official mark with tooltip and accessible provider name. | Mounted component sample, source inspection, UI suite | Complete |
| Update | N/A | Runtime editing/recoloring is deliberately prohibited; a future brand revision is a code delivery. | Visual contract and pinned hashes | N/A — justified |
| Delete | N/A | Provider identity is required wherever a provider task is shown and has no user deletion lifecycle. | Card/search placement contract | N/A — justified |

## Official asset and integrity evidence

| Asset | Independent evidence | Result |
|---|---|---|
| Claude | The Anthropic-hosted SVG was fetched again as 2,558 bytes, SHA-256 `b150888bc7257af83e3b85d3c2be4294f88986026f8168f6c12fc1fde6697350`, with `248×248` viewBox and the original `#D97757` fill. Rasterizing that response with the task's documented Sharp settings reproduced the vendored PNG byte-for-byte: `b6eea4faa96962fc5911a3b897f067030dd0c00ca2a1419cee32802e52981cfc`. | PASS |
| Codex | `/Applications/ChatGPT.app` independently reports bundle ID `com.openai.codex`, version `26.810.52044` (build 6662), a stapled notarization ticket, and the signature `Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)`. Extracting `webview/assets/codex-app-ga-logo--UgmJjKM.png` directly from its signed `app.asar` produced SHA-256 `8e82b26c98a10e45798ce48124515720657f7735fb8d0853b3f087eaa8a6b74e`, exactly matching the vendored file. | PASS |
| Local PNG contract | `file`, Sharp, and the UI guard confirm 8-bit RGBA PNGs at 248×248 and 104×104. Both contain transparent and opaque pixels; neither component source nor its assets use SVG, a remote URL, or a data URI. | PASS |
| Built output | Existing production-renderer output contains both emitted PNGs with the same two source hashes. | PASS |

The intrinsic non-transparent bounds are 236×236 for Claude and 91×92 for Codex. At their
contracted CSS sizes, their visible silhouettes are therefore about 14.27px and 14.0×14.15px,
respectively, which explains and confirms the intended optical match rather than relying on equal
canvas dimensions alone.

## 100% component visual evidence

The real `ProviderGlyph.vue` SFC was mounted through Vite in headless system Chrome, with the exact
current ProviderGlyph, ThreadCard, and ThreadSearch styles injected directly from their checked-out
Less sources. No Electron process was launched. The original-resolution 820×620, DPR-1 capture was
inspected at `/tmp/eyes-on-agents-043-100pct.png`.

| Surface | Measured 100% CSS geometry | Visual result |
|---|---|---|
| One-line Codex / Claude card | card 58px; title row 18px; shell 16×18px; images 16×16px / 15×15px | Both marks are crisp, centered, and comparable in visible size; title baseline and action row do not move. |
| Two-line Codex / Claude card | card 76px; title row and title 36px; shell remains 16×18px at the first-line start | The mark does not stretch, center across both lines, collide with text, or change the two-line clamp rhythm. |
| Codex / Claude search result | result 47px; heading 18px; shell 16×18px; images 16×16px / 15×15px | Both rows retain the established two-line search rhythm with no clipping or vertical displacement. |
| Decoration | transparent shell, `border-style: none`, `box-shadow: none` | No background tile, badge, halo, provider panel, or card-color regression. |

The screenshot also confirms the brand artwork remains recognizable at its delivered size: Codex
retains its blue-purple gradient and white prompt, while Claude retains the complete orange Spark.
The only browser-console request failure was the synthetic harness's absent favicon; there was no
component, asset, Vue, or style error.

## Accessibility and source evidence

- `ProviderGlyph.vue:2-27` keeps one localized tooltip and outer `role="img"` / provider ARIA label.
  Mounted DOM exposed three correctly named Codex images and three correctly named Claude images.
- Inner PNG elements remain decorative with `alt=""`, `aria-hidden="true"`, and
  `draggable="false"`; assistive technology receives one provider name rather than a duplicate.
- `ProviderGlyph.vue:34-35` imports only the two local PNGs, and `ProviderGlyph.less:1-23` fixes the
  shell and provider-specific optical sizes without decoration.
- `ThreadCard.vue:14-16` and `ThreadSearch.vue:67-70` keep the shared component in their established
  heading positions; no provider-specific duplicate layout was introduced.
- `scripts/eyes-on-agents/ui-source.test.mjs:714-814` pins signature, RGBA format, intrinsic size,
  hash, local mapping, inner-image semantics, shell size, optical sizes, and decoration exclusions.

## Independent verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents:ui` | PASS — 57/57 |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn check:renderer-i18n` | PASS |
| `git diff --check` | PASS |
| Local source-to-official provenance and deterministic Claude raster comparison | PASS |
| Signed Codex bundle extraction and source/output hash comparison | PASS |
| DPR-1 mounted-component card/search visual inspection | PASS |

No Electron process, provider connection, user profile, database, Keychain, credential store, or
secret-bearing file was opened or mutated. This Verify delivery changes only this review file and
preserves the unrelated existing `package.json` change and all concurrent task work.

## Conclusion

**accepted** — the official Claude and Codex PNG marks meet provenance, local-delivery,
accessibility, optical-size, compact-layout, and visual-quality contracts with zero open finding.
