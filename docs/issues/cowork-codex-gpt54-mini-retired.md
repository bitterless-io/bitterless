# CoWork Offers Retired GPT-5.4 Mini for ChatGPT Sign-In

Status: Implemented; code checks passed; owner testing pending (2026-09-14)

## Symptom

CoWork Control offers GPT-5.4 Mini, but a turn fails with
`The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account.`
The owner reports that GPT-5.6 Luna works through the same provider.

## Root cause and evidence

- OpenAI retired `gpt-5.4-mini` from Codex with ChatGPT sign-in on 2026-08-31.
  Its documented replacement is `gpt-5.6-luna`. API-key access is unaffected by that
  retirement. See [official model retirement guidance](https://learn.chatgpt.com/docs/models#deprecated-codex-models),
  checked 2026-09-14.
- The ID is spelled correctly: the [OpenAI API model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
  still lists `gpt-5.4-mini`. API availability does not establish ChatGPT-subscription availability.
- `src/main/maestro/llm/llmModels.ts` still includes that ID under `openai-codex` in
  `LLM_PRESETS`. Its 2026-09-11 comment intentionally retains Mini, but predates this
  investigation and conflicts with the provider's retirement policy.
- `src/main/maestro/settings/coachSettings.service.ts` accepts models from those presets,
  so the retired selection survives settings normalization.
- The runtime passes the selected ID through the Pi model catalog; it does not translate
  Mini into another model. The bundled catalog having an entry is not an account entitlement check.
- `src/main/agent/maestroAgent.service.ts` appends a generic retry/sign-in suggestion to
  provider errors. That suggestion does not diagnose this failure as an expired login.

The provider rejection is expected after retirement. The application defect is the stale
selectable preset and misleading recovery suggestion, not a misspelled model ID.

## Required behavior

The owner requested the Codex choices in CoWork and BL, from top to bottom:
GPT-6 Astra, GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna. Luna is the only remaining lowest-tier
choice; remove GPT-5.4 Mini from the selectable presets.

Migrate saved CoWork Mini selections to Luna when loading app settings and conversation targets,
preserving supported effort values. Keep the existing Astra default and all valid active selections.
Display Luna with its own name. Do not modify other providers or the generic error message in this
change. No release, live-account mutation, or Electron E2E is requested.

## Verification scope

Diagnosis: source trace, current official documentation, and the local Codex model cache refreshed
on 2026-09-14 (Luna present, Mini absent).

Implementation verification must cover preset order and Mini migration through saved settings and
conversation targets, including effort preservation and the unchanged Astra default. Human testing:
open the Control model picker in a build containing the change and verify the four choices and order;
restore a conversation previously using Mini and confirm it now selects Luna.

Completed checks:

- `node scripts/maestro/check-startup-settings.mjs`: passed; covers exact order, rejected new Mini
  selections, old settings read/save, provider aliases, supported effort preservation and Astra default.
- `node scripts/maestro/check-agent-runtime.mjs`: passed.
- `node scripts/maestro/check-pi-compaction-settings.mjs`: passed.
- Scoped `git diff --check`: passed.
- Scoped ESLint: the two changed TypeScript sources have zero errors. The existing startup check
  script still has four lint errors; rule/messages match its HEAD baseline (three explicit return-type
  errors and one regex-spacing error). No unrelated formatting cleanup was made.

No build, live model call, or Electron E2E was run. Runtime code is in
`src/main/maestro/llm/llmModels.ts` and `src/main/maestro/settings/coachSettings.service.ts`.
