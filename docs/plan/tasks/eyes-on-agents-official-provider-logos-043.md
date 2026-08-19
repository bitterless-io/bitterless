---
id: eyes-on-agents-official-provider-logos-043
scope: Replace the rejected Tabler approximations with official Claude and Codex product marks
status: done
depends-on: [eyes-on-agents-provider-glyph-refresh-042]
---

# EyesOnAgents Official Provider Logos

## Objective

Replace the rejected Tabler approximations with the real Claude Spark and Codex product marks,
preserving their official artwork while fitting the existing compact task-card and global-search
title lines without adding a row or increasing line height.

## Context

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/tasks/eyes-on-agents-provider-glyph-refresh-042.md`
- `src/renderer/eyesOnAgents/src/components/ProviderGlyph/`

## Official asset provenance

Assets are vendored so the renderer never loads a remote logo at runtime.

| Provider | First-party source | Exact asset | SHA-256 |
|---|---|---|---|
| Claude | [Anthropic-hosted Claude asset](https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1/cd02a42d9-Vq_H3mgS.svg), cross-checked against the [Anthropic press kit](https://www.anthropic.com/press-kit) | 248×248 transparent RGBA PNG, rasterized at the source SVG's intrinsic size with the original `#D97757` path | `b6eea4faa96962fc5911a3b897f067030dd0c00ca2a1419cee32802e52981cfc` |
| Codex | [OpenAI Codex](https://openai.com/codex/) and the current notarized OpenAI desktop bundle (`com.openai.codex`, version `26.810.52044`) | `webview/assets/codex-app-ga-logo--UgmJjKM.png`, 104×104 transparent PNG | `8e82b26c98a10e45798ce48124515720657f7735fb8d0853b3f087eaa8a6b74e` |

The Codex source bundle is signed by `OpenAI OpCo, LLC (2DC432GLL2)` and accepted by macOS as a
Notarized Developer ID application. The transparent GA product mark is used instead of the larger
Dock icon or the OpenAI Blossom: it identifies Codex specifically and keeps its original gradient.
The assets were retrieved and verified on 2026-08-18.

## Visual contract

EyesOnAgents is a compact daylight operations surface for Ral supervising mixed coding-agent tasks.
The provider mark remains its only title-line brand signature:

```text
│ [Codex product mark] Codex task title   │  16px mark in a 16×18px shell
│ [Claude Spark]       Claude task title  │  15px mark in a 16×18px shell
```

- Preserve each first-party mark: no tracing, recoloring, cropping, masking, or effects. Keep the
  Codex PNG byte-for-byte and rasterize the Claude source only onto its intrinsic transparent
  248×248 canvas.
- Render the Codex PNG at 16×16 CSS pixels and the Claude PNG at 15×15 CSS pixels. Their built-in
  optical bounds make the visible silhouettes comparable.
- Keep one fixed 16×18px title-line shell. The extra three horizontal pixels improve logo clarity;
  the established 18px title-line height and card/search row heights do not change.
- Keep the existing tooltip, localized outer `role="img"` label, and provider mapping. Inner images
  are decorative (`alt=""`, `aria-hidden="true"`) and not draggable.
- Keep the logo background transparent. Do not add a badge, border, shadow, provider-colored card
  surface, remote asset request, or dark-theme variant in this light-only surface.

## Path

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-provider-glyph-refresh-042.md`
- `src/renderer/common/assets/icons/providers/claude.png`
- `src/renderer/common/assets/icons/providers/codex.png`
- `src/renderer/eyesOnAgents/src/components/ProviderGlyph/ProviderGlyph.vue`
- `src/renderer/eyesOnAgents/src/components/ProviderGlyph/ProviderGlyph.less`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `scripts/eyes-on-agents/provider-logos.test.mjs`

## Verification

- Pin both vendored PNG files by signature, RGBA format, dimensions, and SHA-256; reject SVG or
  remote renderer URLs.
- Source tests require deterministic provider-to-asset mapping, empty inner `alt`, hidden inner ARIA,
  non-draggable images, the 16×18 shell, 16px Codex mark, and 15px Claude mark.
- Existing ThreadCard and ThreadSearch placements, tooltip, localized accessible label, and
  decoration-free shell remain unchanged.
- Run the EyesOnAgents UI aggregate, strict UI typecheck, renderer i18n check, production renderer
  build, and `git diff --check` without launching Electron.
- Inspect a 100% scale rendered sample containing a card title and search-result title before
  independent acceptance; source-shape tests alone do not complete visual verification.
- Independent review must report no open P1, P2, or P3 before completion.

## Implementation evidence

- `ProviderGlyph.vue` imports only the two local PNG assets through Vite and maps them explicitly by
  provider. The outer tooltip and localized accessible label remain on the fixed shell; each inner
  image is decorative, hidden from accessibility APIs, and non-draggable.
- The Codex source is vendored byte-for-byte. The Claude source was rasterized deterministically at
  its intrinsic 248×248 size with the installed `sharp 0.34.5` / libvips `8.17.3` stack using:
  `sharp(source, { density: 72 }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, progressive: false })`.
  The result remains transparent RGBA and retains the source mark's complete bounds and color.
- CSS renders Codex at 16×16px and Claude at 15×15px inside one 16×18px decoration-free shell, so
  neither existing card-title nor search-result line height changes.

## Verification evidence

- `node --test scripts/eyes-on-agents/provider-logos.test.mjs` — passed 2/2. The focused 98-line
  guard pins both PNG signatures, 8-bit RGBA IHDR fields, intrinsic dimensions, and SHA-256 digests;
  it also rejects Tabler, SVG, remote, and data-URL regressions and requires the card/search
  placement, decorative-image accessibility contract, and optical CSS sizes.
- The provider-logo contract moved out of the pre-existing oversized `ui-source.test.mjs`; that
  legacy file is now 1,945 lines, 25 fewer than its 1,970-line HEAD baseline, so 043 no longer
  expands the recorded TS-1 debt. The focused test is included in `test:eyes-on-agents:ui`.
- `yarn test:eyes-on-agents:ui` — passed 58/58, including rendered-DOM card/search placement and the
  complete source contract after the split.
- `yarn typecheck:eyes-on-agents:ui` and `yarn check:renderer-i18n` — passed.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn electron-vite build` —
  passed without the package-mutating release prebuild and without launching Electron. Vite emitted
  both PNG files byte-for-byte with the pinned source hashes.
- `git diff --check` — passed. Independent 100% Chrome rendering verified the real ThreadCard and
  ThreadSearch geometry at DPR 1: the 18/36px title rows, 58/76px card heights, and 47px search row
  stayed unchanged. Both independent product acceptance and code review report zero open findings;
  Electron was not launched.
