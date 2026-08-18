# Code Review 报告

- 范围：`eyes-on-agents-claude-setup-recovery-041` 最终冻结树的专属 TS/JS/Vue/MJS 变更文件集；排除 docs、Less 和外部 `package.json` name 变更
- 日期：2026-08-18
- 增量结论：041 新增文件与其余修改文件均未越过 800 行，未新增 TS-1；`claude-provider-toggle.test.mjs` 最终仍为 800 行。下列 4 项在 HEAD 基线已超过上限，是既有 TS-1 债务，不要求 041 做大量重构。本次范围未发现 TS-2、FE-1 或 FE-2 问题；`git diff --check` 通过。

## 文件清单

| # | 文件 | 问题数 |
|---|------|--------|
| 1 | `src/main/eyesOnAgents/claudePluginBridge.service.ts` | 1 |
| 2 | `src/main/eyesOnAgents/eyesOnAgents.service.ts` | 1 |
| 3 | `src/main/xpc/eyesOnAgents.handler.ts` | 0 |
| 4 | `src/shared/eyesOnAgents/eyesOnAgents.type.ts` | 0 |
| 5 | `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts` | 0 |
| 6 | `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue` | 0 |
| 7 | `src/renderer/common/i18n/en.ts` | 0 |
| 8 | `src/renderer/common/i18n/zh.ts` | 0 |
| 9 | `scripts/eyes-on-agents/claude-hook.test.mjs` | 0 |
| 10 | `scripts/eyes-on-agents/claude-provider-isolation.test.mjs` | 0 |
| 11 | `scripts/eyes-on-agents/claude-provider-toggle.test.mjs` | 0 |
| 12 | `scripts/eyes-on-agents/core.test.mjs` | 1 |
| 13 | `scripts/eyes-on-agents/global-title-search.test.mjs` | 0 |
| 14 | `scripts/eyes-on-agents/ui-source.test.mjs` | 1 |
| 15 | `scripts/eyes-on-agents/claude-setup-recovery.test.mjs` | 0 |
| 16 | `scripts/eyes-on-agents/claude-setup-render.test.mjs` | 0 |

## 问题清单

### 1. `src/main/eyesOnAgents/claudePluginBridge.service.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 1.1 | 1-951 | TS-1 | 既有文件 951 行，超过 800 行上限；HEAD 基线已为 874 行，041 未新增该债务 | 留作后续债务，可按安装检查、artifact 生成、安全边界与状态持久化职责拆分；不在 041 内扩大改动 |

### 2. `src/main/eyesOnAgents/eyesOnAgents.service.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 2.1 | 1-3460 | TS-1 | 既有文件 3460 行，超过 800 行上限；HEAD 基线已为 3436 行，041 未新增该债务 | 留作后续债务，可按 Codex、Claude provider 生命周期、Hook 提交、状态投影和通知职责拆分；不在 041 内扩大改动 |

### 12. `scripts/eyes-on-agents/core.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 12.1 | 1-4928 | TS-1 | 既有文件 4928 行，超过 800 行上限；HEAD 基线已为 4927 行，041 未新增该债务 | 留作后续债务，可按 Main 生命周期、provider 隔离和 Hook 行为拆分测试；不在 041 内扩大改动 |

### 14. `scripts/eyes-on-agents/ui-source.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 14.1 | 1-1970 | TS-1 | 既有文件 1970 行，超过 800 行上限；HEAD 基线已为 1927 行，041 未新增该债务 | 留作后续债务，可按 Connections、Provider Toggle、Thread Card 与 Search 等 UI 合同拆分测试；不在 041 内扩大改动 |
