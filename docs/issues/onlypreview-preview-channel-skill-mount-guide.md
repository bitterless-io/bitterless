# OnlyPreview Preview Channel Skill Mounting Is Not Obvious

Status: implemented; owner verification pending

## Symptom

The OnlyPreview Agent Guide can copy the complete MCP-plus-skill setup contract, but its visible
test-instance warning does not tell a Preview-channel user which MCP alias and bundled skill belong
together. A user must inspect the longer copied instruction to discover that this application is
mounted as `bitterless-preview` while the portable skill keeps its production dependency named
`bitterless`.

## Repair contract

- When the Guide reports the exact server name `bitterless-preview`, reuse the existing warning
  surface to show one localized sentence: mount the current MCP as `bitterless-preview`, install the
  complete bundled `bitterless-preview` skill directory, and keep the portable production
  dependency named `bitterless`. The same sentence tells the user that a later Production install
  needs only its new Guide copied to the agent; the same-named skill is overwritten and Production
  uses `bitterless`.
- Other non-production aliases retain the general test-instance warning. Production `bitterless`
  retains no warning or channel-mount sentence.
- Keep the existing one-card layout and complete-copy instruction unchanged; do not add another
  setup path, card, or release-channel configuration contract to the renderer. The complete copied
  instruction explicitly permits a later edition's Guide to supersede the current setup.

Delivery: [onlypreview-preview-channel-skill-guide-106](../plan/tasks/onlypreview-preview-channel-skill-guide-106.md).
