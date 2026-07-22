---
id: translator-miniapp-001
scope: omni-translator
status: done
depends-on: [chat-production-entry-flag-001]
---

# Objective

Add a SQLite-backed, cross-renderer Codex provider registry, a provider-first Home Model Config,
and a Translator Omni mini app using fixed Pi `openai-codex/gpt-5.5/low` realtime translation with
strict Zod output validation.

# Context

- `docs/plan/analysis/translator.md`
- `docs/features/model-provider.md`
- `docs/features/translator.md`
- `docs/features/omni-miniapp-cells.md`

# Path

- `docs/features/model-provider.md`
- `docs/features/translator.md`
- `docs/features/omni-miniapp-cells.md`
- `electron.vite.config.ts`
- `src/main/app.main.ts`
- `src/main/codex/`
- `src/main/modelProvider/`
- `src/main/translator/`
- `src/main/xpc/modelProvider.handler.ts`
- `src/main/xpc/translator.handler.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/preload/translator/`
- `src/renderer/translator/`
- `src/renderer/omni/omniControl/`
- `src/renderer/home/src/views/setting/components/LLMSetting/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/shared/modelProvider/`
- `src/shared/translator/`
- `src/shared/omni/omni.types.ts`
- `scripts/renderer-i18n/check-renderer-i18n.mjs`

# Verification

- Inspect SQLite state transitions, XPC snapshot broadcasts, cross-renderer login synchronization,
  and runtime auth-invalidation persistence.
- Inspect the `1_000 ms` leading/trailing scheduler, paste path, per-cell cancellation, and stale
  response fencing.
- Inspect fixed provider/model/effort constants and strict request/output Zod schemas.
- Inspect Omni dev/packaged renderer/preload mapping, navigation fencing, shared i18n, BEM/Less,
  and minimum-pane behavior.
- Run Node and Web TypeScript/static source checks only. Ral owns runtime and visual verification.
