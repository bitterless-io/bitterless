---
id: translator-fast-mode-006
scope: omni-translator
status: in-progress
depends-on: [translator-llm-direction-005]
---

# Objective

Enable Codex Fast mode for every Translator request by mapping the Translator-only Fast selection
to the provider `priority` service tier without changing other shared Codex runtime consumers or
silently downgrading failed Fast requests to Standard.

# Context

- `../../../../../areas/agent-runtime/mini-apps/translator/design.md`
- `docs/features/translator.md`
- Official Codex Fast mode:
  `https://learn.chatgpt.com/docs/agent-configuration/speed#fast-mode`

# Path

- `../../../../../areas/agent-runtime/mini-apps/translator/design.md`
- `src/main/codex/codexRuntime.service.ts`
- `src/main/translator/translator.service.ts`
- `tests/coin/unit/codexRuntime.service.test.ts`
- `tests/translator/`

# Verification

- Verify Translator passes an explicit Fast tier to the shared runtime.
- Verify the installed Pi Agent and Codex provider produce the final wire field
  `service_tier: "priority"` for Fast.
- Verify a Standard/unspecified runtime call remains unchanged and Fast cannot silently downgrade.
- Run the focused Codex runtime and Translator tests.
- Run Node type checking and `git diff --check`.
