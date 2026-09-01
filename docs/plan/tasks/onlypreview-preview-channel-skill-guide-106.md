---
id: onlypreview-preview-channel-skill-guide-106
scope: show one Preview-channel-specific MCP and skill mount sentence in the OnlyPreview Guide
status: implemented; owner verification pending
depends-on: [onlypreview-agent-skill-guide-009]
---

# OnlyPreview Preview Channel Skill Guide

## Objective

Make the Bitterless Preview edition's existing OnlyPreview Guide identify its own test-channel
mount in one sentence without changing the production Guide or adding a second setup contract.

## Contract

1. Exact `serverName === 'bitterless-preview'` is the channel identity already supplied by Main.
   The renderer must not add a second release-channel source.
2. The existing test warning shows one localized sentence stating that the current MCP mounts as
   `bitterless-preview`, the complete bundled `bitterless-preview` skill directory must be
   installed, and a later Production install needs only its new Guide copied to overwrite the
   same-named skill and use production `bitterless`.
3. Other test aliases keep the existing generic warning. Production `bitterless` keeps the current
   warning-free Guide.
4. Keep the current warning and one-card visual hierarchy, capability boundary, and skill package
   unchanged. Add one edition-supersession sentence to the complete English clipboard instruction
   so copying a later Production Guide is sufficient.

## Layout

```text
LOCAL MCP
Copy the skill to your agent

[ Test instance: bitterless-preview
  Preview channel: mount current MCP as bitterless-preview, install the complete
  bundled skill, then copy the Production Guide later to overwrite it and use bitterless. ]

[ Complete setup instructions                                      Copy ]
```

## Paths

- `docs/issues/onlypreview-preview-channel-skill-mount-guide.md`
- `docs/features/onlypreview.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/guide/src/App.vue`
- `tests/onlypreview/onlyPreviewAgentSkill.test.mjs`

## Verification

- Focused Node source test proves the exact Preview alias receives the channel-mount sentence,
  other test aliases retain the generic warning, and production remains warning-free.
- Node and renderer type checks, focused lint/format checks, `git diff --check`, and desktop build.
- Electron E2E is excluded by owner instruction.

## Delivery evidence

- The existing warning surface now selects `previewChannelMountGuide` only for the exact
  `bitterless-preview` server name. Production remains warning-free, and any other test alias keeps
  the existing generic warning.
- The localized Preview sentence names the current MCP alias and complete bundled skill directory,
  then tells the user to copy a later Production Guide to overwrite the same-named skill and use
  production `bitterless`.
- The complete English clipboard instruction now makes all later/newer edition Guides
  superseding and safe to rerun while retaining additive skill installation and other skills.
- `node --test tests/onlypreview/onlyPreviewAgentSkill.test.mjs` passed 5/5;
  `yarn typecheck:node`, renderer `vue-tsc --noCheck`, focused ESLint, `git diff --check`, and
  `yarn build` passed. The built Main and Guide renderer contain the new instruction strings.
- Repository-wide Prettier remains red on formatting already present in `App.vue`, the Agent Guide
  test, and two large documentation files; no new ESLint error was introduced. The renderer-i18n
  inventory check reaches an unrelated existing `Tray must follow Home creation` assertion.
- Electron, Playwright, and E2E were not run by owner instruction. Self-review found no open
  contract, capability-boundary, or channel-isolation issue; independent review was not delegated.
