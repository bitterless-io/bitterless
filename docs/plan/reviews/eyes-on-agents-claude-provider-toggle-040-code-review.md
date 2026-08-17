# Code Review 报告

- 范围：`eyes-on-agents-claude-provider-toggle-040` 最终冻结树的专属 TS/JS/Vue/MJS 变更文件集
- 日期：2026-08-17
- 增量结论：040 新增/拆分文件均未超过 800 行，未新增 TS-1；下列 5 项均是本任务开始前已经超过上限的既有超长文件债务。本次范围未发现 TS-2、FE-1 或 FE-2 问题。

## 文件清单

| # | 文件 | 问题数 |
|---|------|--------|
| 1 | `src/main/eyesOnAgents/claudeProviderPreference.service.ts` | 0 |
| 2 | `src/main/eyesOnAgents/claudeHookBridge.server.ts` | 0 |
| 3 | `src/main/eyesOnAgents/claudeHookOutbox.service.ts` | 0 |
| 4 | `src/main/eyesOnAgents/eyesOnAgents.service.ts` | 1 |
| 5 | `src/main/xpc/eyesOnAgents.handler.ts` | 0 |
| 6 | `src/preload/sqlite/dao/eyesOnAgents.dao.ts` | 1 |
| 7 | `src/shared/eyesOnAgents/eyesOnAgents.contract.ts` | 0 |
| 8 | `src/shared/eyesOnAgents/eyesOnAgents.type.ts` | 0 |
| 9 | `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts` | 0 |
| 10 | `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue` | 0 |
| 11 | `src/renderer/common/i18n/en.ts` | 0 |
| 12 | `src/renderer/common/i18n/zh.ts` | 0 |
| 13 | `scripts/eyes-on-agents/activation-refresh.test.mjs` | 0 |
| 14 | `scripts/eyes-on-agents/core.test.mjs` | 1 |
| 15 | `scripts/eyes-on-agents/repository.test.mjs` | 1 |
| 16 | `scripts/eyes-on-agents/ui-source.test.mjs` | 1 |
| 17 | `scripts/eyes-on-agents/claude-provider-toggle.test.mjs` | 0 |
| 18 | `scripts/eyes-on-agents/claude-provider-outbox.test.mjs` | 0 |
| 19 | `scripts/eyes-on-agents/claude-hook-admission.test.mjs` | 0 |
| 20 | `scripts/eyes-on-agents/claude-provider-snapshot-race.test.mjs` | 0 |
| 21 | `scripts/eyes-on-agents/claude-provider-isolation.test.mjs` | 0 |

## 问题清单

### 4. `src/main/eyesOnAgents/eyesOnAgents.service.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 4.1 | 1-3436 | TS-1 | 既有文件 3436 行，超过 800 行上限；040 开始前已为超长文件，本任务未新增该债务 | 后续按 Codex、Claude provider 生命周期、Hook 提交、状态投影和通知职责拆分服务 |

### 6. `src/preload/sqlite/dao/eyesOnAgents.dao.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 6.1 | 1-2042 | TS-1 | 既有文件 2042 行，超过 800 行上限；040 开始前已为超长文件，本任务未新增该债务 | 后续按 Codex/Claude 读写、Domain 标记与状态协调拆分 DAO |

### 14. `scripts/eyes-on-agents/core.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 14.1 | 1-4927 | TS-1 | 既有文件 4927 行，超过 800 行上限；040 开始前已为超长文件，本任务未新增该债务 | 后续按 Main 生命周期、provider 隔离和 Hook 行为拆分测试文件 |

### 15. `scripts/eyes-on-agents/repository.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 15.1 | 1-3228 | TS-1 | 既有文件 3228 行，超过 800 行上限；040 开始前已为超长文件，本任务未新增该债务 | 后续按 repository 能力域拆分测试文件 |

### 16. `scripts/eyes-on-agents/ui-source.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 16.1 | 1-1927 | TS-1 | 既有文件 1927 行，超过 800 行上限；040 开始前已为超长文件，本任务未新增该债务 | 后续按 Connections、Provider Toggle、Thread Card 与 Search 等 UI 合同拆分测试文件 |
