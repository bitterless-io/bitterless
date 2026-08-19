# Code Review 报告

- 范围：`eyes-on-agents-claude-desktop-visibility-lifecycle-052` 冻结改动中的 7 个 TS/JS/Vue/MJS 文件；排除共享工作树中其他任务的改动
- 日期：2026-08-18

## 文件清单

| # | 文件 | 问题数 |
|---|------|--------|
| 1 | `src/main/eyesOnAgents/eyesOnAgents.service.ts` | 1 |
| 2 | `src/preload/sqlite/dao/eyesOnAgents.dao.ts` | 1 |
| 3 | `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue` | 0 |
| 4 | `scripts/eyes-on-agents/claude-visibility-lifecycle.test.mjs` | 0 |
| 5 | `scripts/eyes-on-agents/thread-card-open-capability.test.mjs` | 0 |
| 6 | `scripts/eyes-on-agents/repository.test.mjs` | 1 |
| 7 | `scripts/eyes-on-agents/ui-source.test.mjs` | 1 |

## 问题清单

### 1. src/main/eyesOnAgents/eyesOnAgents.service.ts

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 1.1 | 1-3592 | TS-1 | 文件 3592 行，超过 800 行上限。该债务在任务 052 前已存在，任务 052 又在此文件增加 Claude 投影、生命周期失效 helper 与调用点，属于继续扩大的生产代码债务。 | 将 Claude 可见性投影和 Hook/listener 生命周期失效编排拆入独立 service，当前 service 只保留跨 provider 协调入口。 |

### 2. src/preload/sqlite/dao/eyesOnAgents.dao.ts

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 2.1 | 1-2429 | TS-1 | 文件 2429 行，超过 800 行上限。该债务在任务 052 前已存在，任务 052 又加入 Hook 优先级、lease 与 expiry guard，属于继续扩大的生产代码债务。 | 按 Claude Hook 状态写入、Agent View reconcile、inventory/identity 三个职责拆分 DAO 模块。 |

### 6. scripts/eyes-on-agents/repository.test.mjs

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 6.1 | 1-3791 | TS-1 | 文件 3791 行，超过 800 行上限；这是任务 052 前已有的测试债务，本任务仅修改既有 Hook lease/transcript-mtime 断言，未新增 052 专属测试块。 | 按 repository 的 Hook、Agent View、Desktop identity、archive/delete 行为拆分测试文件。 |

### 7. scripts/eyes-on-agents/ui-source.test.mjs

| # | 行 | 规则 | 问题 | 建议 |
|---|----|------|------|------|
| 7.1 | 1-1927 | TS-1 | 文件 1927 行，超过 800 行上限；这是任务 052 前已有的测试债务，本任务仅修改既有 spinner 源码断言。 | 按 Connection Panel、Thread Card、store/IPC 等 UI 单元拆分源码契约测试。 |
