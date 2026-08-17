# Code Review 报告

- 范围：`eyes-on-agents-claude-directory-runtime-039` 最终冻结树的专属 TS/JS/Vue/MJS 变更文件集
- 日期：2026-08-17
- 增量结论：039 新增/拆分的测试文件均未超过 800 行，未新增 TS-1；下列 4 项均是本任务涉及的既有超长文件债务。

## 文件清单

| # | 文件 | 问题数 |
|---|------|--------|
| 1 | `src/main/eyesOnAgents/claudeDirectoryConfig.service.ts` | 0 |
| 2 | `src/main/eyesOnAgents/claudePath.resolver.ts` | 0 |
| 3 | `src/main/eyesOnAgents/claudeObservation.service.ts` | 0 |
| 4 | `src/main/eyesOnAgents/claudeWatcher.supervisor.ts` | 0 |
| 5 | `src/main/eyesOnAgents/eyesOnAgents.service.ts` | 1 |
| 6 | `src/main/xpc/eyesOnAgents.handler.ts` | 0 |
| 7 | `src/preload/sqlite/dao/setting.dao.ts` | 0 |
| 8 | `src/preload/sqlite/dao/eyesOnAgents.dao.ts` | 1 |
| 9 | `src/shared/eyesOnAgents/eyesOnAgents.type.ts` | 0 |
| 10 | `src/renderer/eyesOnAgents/src/components/ConnectionPanel/ClaudeObservationCard.vue` | 0 |
| 11 | `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts` | 0 |
| 12 | `src/renderer/common/i18n/en.ts` | 0 |
| 13 | `src/renderer/common/i18n/zh.ts` | 0 |
| 14 | `scripts/eyes-on-agents/claude-directory-runtime.test.mjs` | 0 |
| 15 | `scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs` | 0 |
| 16 | `scripts/eyes-on-agents/claude-inventory.test.mjs` | 0 |
| 17 | `scripts/eyes-on-agents/repository.test.mjs` | 1 |
| 18 | `scripts/eyes-on-agents/ui-source.test.mjs` | 1 |

## 问题清单

### 5. `src/main/eyesOnAgents/eyesOnAgents.service.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 5.1 | 1-2911 | TS-1 | 既有文件 2911 行，超过 800 行上限；039 未新增该债务 | 后续按会话同步、状态投影和调度等职责拆分服务 |

### 8. `src/preload/sqlite/dao/eyesOnAgents.dao.ts`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 8.1 | 1-2029 | TS-1 | 既有文件 2029 行，超过 800 行上限；039 未新增该债务 | 后续按 Codex/Claude 读写、Domain 标记与状态协调拆分 DAO |

### 17. `scripts/eyes-on-agents/repository.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 17.1 | 1-3205 | TS-1 | 既有文件 3205 行，超过 800 行上限；039 未新增该债务 | 后续按 repository 能力域拆分测试文件 |

### 18. `scripts/eyes-on-agents/ui-source.test.mjs`

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 18.1 | 1-1925 | TS-1 | 既有文件 1925 行，超过 800 行上限；039 未新增该债务 | 后续按 Connections、Thread Card、Search 等 UI 合同拆分测试文件 |
